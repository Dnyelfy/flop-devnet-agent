// Identity: one Ed25519 seed is both the Technocore did:key and a FLOP devnet account.
//   did:key = 'did:key:z' + base58btc(0xed 0x01 || pubkey)     (same as technocore-did-kit)
//   SS58    = base58(prefix || pubkey || blake2b512("SS58PRE" || prefix || pubkey)[0..2])
// For an ed25519 key the Substrate AccountId is the raw 32-byte public key.
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}

export function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  const h = hex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^([0-9a-f]{2})*$/.test(h)) throw new Error('invalid hex');
  return new Uint8Array((h.match(/../g) ?? []).map(x => parseInt(x, 16)));
}

export function seedFromHex(hex) {
  const seed = fromHex(hex);
  if (seed.length !== 32) throw new Error('seed must be 64 hex characters');
  return seed;
}

export function randomSeed() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function publicKey(seed) {
  return ed25519.getPublicKey(seed);
}

export function didFromPublicKey(pub) {
  const prefixed = new Uint8Array(2 + pub.length);
  prefixed.set([0xed, 0x01]); prefixed.set(pub, 2);
  return 'did:key:z' + base58(prefixed);
}

// Simple-format SS58 (prefix 0..63), which covers the devnet's prefix 42.
export function ss58Address(pub, prefix = 42) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 63) throw new Error('unsupported SS58 prefix');
  const payload = new Uint8Array(1 + pub.length);
  payload[0] = prefix; payload.set(pub, 1);
  const pre = new TextEncoder().encode('SS58PRE');
  const input = new Uint8Array(pre.length + payload.length);
  input.set(pre); input.set(payload, pre.length);
  const checksum = blake2b(input, { dkLen: 64 }).slice(0, 2);
  const full = new Uint8Array(payload.length + 2);
  full.set(payload); full.set(checksum, payload.length);
  return base58(full);
}

export function identityFromSeed(seed, ss58Prefix = 42) {
  const pub = publicKey(seed);
  return { seed, publicKey: pub, did: didFromPublicKey(pub), address: ss58Address(pub, ss58Prefix) };
}

// Raw Ed25519 signature over the UTF-8 message, hex with 0x prefix (Substrate style).
export function signMessage(seed, message) {
  return '0x' + toHex(ed25519.sign(new TextEncoder().encode(message), seed));
}

export function verifyMessage(pub, message, signatureHex) {
  return ed25519.verify(fromHex(signatureHex), new TextEncoder().encode(message), pub);
}
