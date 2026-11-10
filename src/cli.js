#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { identityFromSeed, signMessage } from './identity.js';
import { Chain, formatFlop } from './chain.js';
import * as gw from './gateway.js';
import * as store from './store.js';

const MIN_BALANCE = 10n ** 18n; // 1 FLOP, the balance the gateway's enrollment expects

const HELP = `flop-agent — a Technocore did:key identity as a FLOP devnet agent account

Usage: flop-agent <command> [options]

  keygen              create a new throwaway identity in the local store
  whoami              show the did:key and the devnet address of the identity
  status              check the devnet: genesis match, faucet, model catalog
  balance             finalized FLOP balance of the identity
  fund                request the faucet grant and wait until it is finalized
  enroll              sign the gateway challenge and store a gateway key
  key                 quota and expiry of the stored gateway key
  chat <prompt>       run one inference request and show its receipt
  receipt <id>        look up the receipt of an earlier request

Options:
  --key <file>        identity file from technocore-did-kit (default: local store)
  --model <id>        model for chat (default: the model the key is scoped to)
  --max-tokens <n>    completion limit for chat (default: 32)
  --json              machine-readable output

The devnet is a disposable test network: it earns nothing and has no airdrop weight.`;

function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      key: { type: 'string' },
      model: { type: 'string' },
      'max-tokens': { type: 'string', default: '32' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return { values, command: positionals[0], rest: positionals.slice(1) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function identity(values) {
  return identityFromSeed(await store.loadSeed(values.key));
}

// The faucet and the RPC must describe the same chain before anything is funded or signed.
async function checkedGenesis(chain) {
  const [rpcGenesis, faucet] = await Promise.all([chain.genesisHash(), gw.faucetChain(gw.DEVNET.faucet)]);
  if (faucet.genesisHash !== rpcGenesis) {
    throw new Error(`genesis mismatch: RPC ${rpcGenesis}, faucet ${faucet.genesisHash}; refusing to continue`);
  }
  return rpcGenesis;
}

async function credential() {
  const stored = await store.loadCredential();
  if (!stored) throw new Error('no gateway key yet: run "flop-agent enroll"');
  if (stored.gateway !== gw.DEVNET.gateway) throw new Error('stored gateway key belongs to a different gateway');
  return stored;
}

const commands = {
  async keygen() {
    const { seed, path } = await store.createIdentity();
    const id = identityFromSeed(seed);
    return {
      data: { did: id.did, address: id.address, path },
      text: `Created ${path}\n  did      ${id.did}\n  address  ${id.address}\nThat file is the identity. Keep it private and back it up.`,
    };
  },

  async whoami({ values }) {
    const id = await identity(values);
    return { data: { did: id.did, address: id.address }, text: `did      ${id.did}\naddress  ${id.address}` };
  },

  async status() {
    const chain = new Chain(gw.DEVNET.rpc);
    const [rpcGenesis, faucet, limits, models] = await Promise.all([
      chain.genesisHash(), gw.faucetChain(gw.DEVNET.faucet), gw.faucetLimits(gw.DEVNET.faucet), gw.listModels(gw.DEVNET.gateway),
    ]);
    const match = rpcGenesis === faucet.genesisHash;
    const data = {
      network: faucet.network, chain: faucet.chain, genesis: rpcGenesis, genesisMatch: match,
      faucetStatus: limits.faucet?.status, faucetGrantFlop: limits.faucet?.anonymous?.grantFlop,
      models: models.data.map((m) => m.id),
    };
    return {
      data,
      text: [
        `network  ${data.network} (${data.chain})`,
        `genesis  ${rpcGenesis}  ${match ? 'RPC and faucet agree' : 'MISMATCH between RPC and faucet'}`,
        `faucet   ${data.faucetStatus}, ${data.faucetGrantFlop} FLOP per address per day`,
        `models   ${data.models.join(', ') || 'none listed'}`,
      ].join('\n'),
      failed: !match,
    };
  },

  async balance({ values }) {
    const id = await identity(values);
    const raw = await new Chain(gw.DEVNET.rpc).finalizedFreeBalance(id.publicKey);
    return { data: { address: id.address, raw: raw.toString(), flop: formatFlop(raw) }, text: `${id.address}  ${formatFlop(raw)} FLOP` };
  },

  async fund({ values }) {
    const id = await identity(values);
    const chain = new Chain(gw.DEVNET.rpc);
    await checkedGenesis(chain);
    const before = await chain.finalizedFreeBalance(id.publicKey);
    await gw.faucetFund(gw.DEVNET.faucet, id.address);
    const deadline = Date.now() + 180_000;
    let now = before;
    while (now <= before) {
      if (Date.now() >= deadline) throw new Error('the faucet accepted the request but the grant is not finalized yet; check "balance" later');
      await sleep(3000);
      now = await chain.finalizedFreeBalance(id.publicKey);
    }
    return { data: { address: id.address, raw: now.toString(), flop: formatFlop(now) }, text: `Funded ${id.address}: ${formatFlop(now)} FLOP` };
  },

  async enroll({ values }) {
    const id = await identity(values);
    const chain = new Chain(gw.DEVNET.rpc);
    const genesis = await checkedGenesis(chain);
    if (await chain.finalizedFreeBalance(id.publicKey) < MIN_BALANCE) {
      throw new Error('the account holds less than 1 FLOP: run "flop-agent fund" first');
    }
    const { message } = await gw.enrollChallenge(gw.DEVNET.gateway, id.address);
    gw.validateChallenge(message, id.address, gw.DEVNET.gateway, genesis);
    const issued = await gw.enrollSubmit(gw.DEVNET.gateway, id.address, message, signMessage(id.seed, message));
    if (typeof issued.key !== 'string' || !issued.key.startsWith('flop_') || typeof issued.model !== 'string') {
      throw new Error('enrollment returned an invalid credential');
    }
    const path = await store.saveCredential({ gateway: gw.DEVNET.gateway, address: id.address, did: id.did, model: issued.model, key: issued.key });
    const data = { address: id.address, model: issued.model, remainingQuota: issued.remaining_quota, expiresAt: issued.expires_at, path };
    return {
      data,
      text: `Enrolled ${id.address}\n  model    ${issued.model}\n  quota    ${issued.remaining_quota}\n  expires  ${new Date(issued.expires_at).toISOString()}\n  key saved to ${path} (not shown)`,
    };
  },

  async key() {
    const stored = await credential();
    const status = await gw.keyStatus(gw.DEVNET.gateway, stored.key);
    const data = { address: stored.address, model: stored.model, remainingQuota: status.remaining_quota, expiresAt: status.expires_at, modelAllowlist: status.model_allowlist };
    return {
      data,
      text: `address  ${stored.address}\nmodel    ${stored.model}\nquota    ${status.remaining_quota}\nexpires  ${new Date(status.expires_at).toISOString()}`,
    };
  },

  async chat({ values, rest }) {
    const prompt = rest.join(' ').trim();
    if (!prompt) throw new Error('usage: flop-agent chat <prompt>');
    const maxTokens = Number(values['max-tokens']);
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error('--max-tokens must be a positive integer');
    const stored = await credential();
    let model = values.model;
    if (!model) {
      // The key is scoped to a registry model; the request needs that model's catalog id.
      const catalog = await gw.listModels(gw.DEVNET.gateway);
      model = catalog.data.find((m) => m.id === stored.model || m['x-flop']?.registry_model === stored.model)?.id;
      if (!model) throw new Error(`the key's model "${stored.model}" is not in the live catalog; pass --model`);
    }
    const requestId = randomUUID();
    await store.logRequest({ requestId, at: new Date().toISOString(), model, maxTokens });
    if (!values.json) console.error(`request id ${requestId} (logged before sending)`);
    let completion;
    try {
      completion = await gw.chatCompletion(gw.DEVNET.gateway, stored.key, requestId, {
        model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens,
      });
    } catch (error) {
      if (!(error instanceof gw.HttpError)) {
        error.message += `\nThe outcome of request ${requestId} is unknown. Do not resend it; run "flop-agent receipt ${requestId}".`;
      }
      throw error;
    }
    const answer = completion.choices?.[0]?.message?.content ?? '';
    let rcpt = null;
    try { rcpt = await gw.receipt(gw.DEVNET.gateway, stored.key, requestId); } catch { /* shown as unavailable */ }
    return {
      data: { requestId, model, answer, usage: completion.usage, receipt: rcpt },
      text: [
        answer,
        '',
        `model    ${model}`,
        `tokens   ${completion.usage?.prompt_tokens ?? '?'} in, ${completion.usage?.completion_tokens ?? '?'} out`,
        rcpt ? `receipt  ${rcpt.state}${rcpt.settled_spend != null ? `, settled ${rcpt.settled_spend} FLOP` : rcpt.reserved_spend != null ? `, reserved ${rcpt.reserved_spend} FLOP` : ''}`
          : `receipt  not available yet; run "flop-agent receipt ${requestId}"`,
      ].join('\n'),
    };
  },

  async receipt({ rest }) {
    if (!rest[0]) throw new Error('usage: flop-agent receipt <request id>');
    const stored = await credential();
    const rcpt = await gw.receipt(gw.DEVNET.gateway, stored.key, rest[0]);
    return { data: rcpt, text: Object.entries(rcpt).map(([k, v]) => `${k.padEnd(20)} ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join('\n') };
  },
};

async function main(argv) {
  let parsed;
  try { parsed = parse(argv); } catch (error) { console.error(error.message); return 2; }
  const { values, command } = parsed;
  if (values.help || !command || command === 'help') { console.log(HELP); return 0; }
  if (!Object.hasOwn(commands, command)) { console.error(`unknown command "${command}"\n\n${HELP}`); return 2; }
  try {
    const result = await commands[command](parsed);
    console.log(values.json ? JSON.stringify(result.data, null, 2) : result.text);
    return result.failed ? 1 : 0;
  } catch (error) {
    console.error(`error: ${error.message}`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
