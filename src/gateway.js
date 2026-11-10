// Faucet and gateway HTTP calls. The flow mirrors `flop agent credential` in the
// official @flop-labs/cli, with an Ed25519 (did:key) account instead of sr25519.

export const DEVNET = {
  network: 'devnet',
  rpc: 'wss://rpc.devnet.flop.network',
  faucet: 'https://faucet.flop.network',
  gateway: 'https://api.flop.network',
};

export class HttpError extends Error {
  constructor(what, status, body) {
    const code = typeof body?.error === 'string' ? `: ${body.error}`
      : typeof body?.error?.code === 'string' ? `: ${body.error.code}` : '';
    const detail = typeof body?.message === 'string' ? ` — ${body.message}` : '';
    super(`${what} returned HTTP ${status}${code}${detail}`);
    this.status = status;
    this.body = body;
  }
}

async function request(what, url, init = {}, timeoutMs = 30_000) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), ...init });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new HttpError(what, response.status, body);
  return body;
}

const json = (body, headers = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

export const faucetChain = (faucet) => request('faucet /chain', `${faucet}/chain`);
export const faucetLimits = (faucet) => request('faucet /limits', `${faucet}/limits`);
export const faucetFund = (faucet, address) => request('faucet /fund', `${faucet}/fund`, json({ address }), 60_000);

export const listModels = (gateway) => request('model catalog', `${gateway}/v1/models`);

export const enrollChallenge = (gateway, address) =>
  request('enrollment challenge', `${gateway}/v1/enroll/wallet/challenge?address=${encodeURIComponent(address)}`);

export const enrollSubmit = (gateway, address, message, signature) =>
  request('key enrollment', `${gateway}/v1/enroll/wallet`, json({ address, message, signature }), 120_000);

const bearer = (key) => ({ Authorization: `Bearer ${key}` });

export const keyStatus = (gateway, key) => request('key status', `${gateway}/v1/keys/me`, { headers: bearer(key) });

export const receipt = (gateway, key, requestId) =>
  request('receipt lookup', `${gateway}/v1/keys/me/receipts/${encodeURIComponent(requestId)}`, { headers: bearer(key) });

// One paid POST, never retried. The caller owns `requestId` and must keep it: after a
// timeout the outcome is unknown and is resolved with `receipt`, not by sending again.
export const chatCompletion = (gateway, key, requestId, body, timeoutMs = 120_000) =>
  request('chat completion', `${gateway}/v1/chat/completions`,
    json({ ...body, stream: false }, { ...bearer(key), 'Idempotency-Key': requestId }), timeoutMs);

// The gateway's sign-in text is checked line by line before it is signed, so the key
// only ever signs an enrollment for this address, this gateway and this chain.
export function validateChallenge(message, address, gateway, genesis, now = Date.now()) {
  const invalid = (why) => new Error(`gateway returned an invalid enrollment challenge (${why})`);
  if (typeof message !== 'string') throw invalid('not text');
  if (!/^0x[0-9a-f]{64}$/.test(genesis)) throw invalid('bad genesis');
  const lines = message.split('\n');
  if (lines.length !== 8) throw invalid('line count');
  if (lines[0] !== `${new URL(gateway).host} wants you to enroll a FLOP devnet gateway key with your account:`) throw invalid('host line');
  if (lines[1] !== address) throw invalid('address');
  if (lines[2] !== '') throw invalid('separator');
  if (lines[3] !== 'Action: flop-devnet-enroll/v1') throw invalid('action');
  if (lines[4] !== `Genesis: ${genesis}`) throw invalid('genesis mismatch');
  if (!/^Nonce: [0-9a-f]{64}$/.test(lines[5])) throw invalid('nonce');
  const issued = Date.parse(lines[6].replace(/^Issued At: /, ''));
  const expires = Date.parse(lines[7].replace(/^Expiration Time: /, ''));
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) throw invalid('timestamps');
  if (lines[6] !== `Issued At: ${new Date(issued).toISOString()}`) throw invalid('issued format');
  if (lines[7] !== `Expiration Time: ${new Date(expires).toISOString()}`) throw invalid('expiry format');
  // 60 s of slack for a local clock that runs slightly behind the gateway.
  if (issued > now + 60_000 || expires <= now || expires <= issued || expires - issued > 5 * 60_000) throw invalid('validity window');
}
