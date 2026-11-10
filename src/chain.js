// Read-only chain access over the node's HTTP JSON-RPC. No signing happens here.
import { blake2b } from '@noble/hashes/blake2.js';
import { toHex, fromHex } from './identity.js';

// twox128("System") || twox128("Account"): the fixed prefix of the System.Account map.
const SYSTEM_ACCOUNT_PREFIX = '26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9';

export function httpRpcUrl(rpc) {
  return rpc.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

// Storage key of System.Account[accountId], hashed with Blake2_128Concat.
export function accountStorageKey(pub) {
  return '0x' + SYSTEM_ACCOUNT_PREFIX + toHex(blake2b(pub, { dkLen: 16 })) + toHex(pub);
}

// AccountInfo = nonce u32, consumers u32, providers u32, sufficients u32, then
// AccountData whose first field is `free` (u128, little endian).
export function decodeFreeBalance(storageHex) {
  if (storageHex == null) return 0n;
  const bytes = fromHex(storageHex);
  if (bytes.length < 32) throw new Error('unexpected System.Account encoding');
  let free = 0n;
  for (let i = 31; i >= 16; i--) free = (free << 8n) | BigInt(bytes[i]);
  return free;
}

export function formatFlop(raw, decimals = 18) {
  const base = 10n ** BigInt(decimals);
  const frac = (raw % base).toString().padStart(decimals, '0').slice(0, 4);
  return `${raw / base}.${frac}`;
}

export class Chain {
  constructor(rpc, fetchImpl = fetch) {
    this.url = httpRpcUrl(rpc);
    this.fetch = fetchImpl;
    this.id = 0;
  }

  async call(method, params = []) {
    const response = await this.fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`RPC ${method} failed: ${body.error.message ?? 'unknown error'}`);
    return body.result;
  }

  genesisHash() {
    return this.call('chain_getBlockHash', [0]);
  }

  // Balance at the finalized head, so a grant that could still be reorged does not count.
  async finalizedFreeBalance(pub) {
    const head = await this.call('chain_getFinalizedHead');
    return decodeFreeBalance(await this.call('state_getStorage', [accountStorageKey(pub), head]));
  }
}
