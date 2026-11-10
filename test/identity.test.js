import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHex, identityFromSeed, seedFromHex, signMessage, ss58Address, verifyMessage } from '../src/identity.js';

const SEED = seedFromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');

test('did:key matches technocore-did-kit for the same seed', () => {
  assert.equal(identityFromSeed(SEED).did, 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd');
});

test('devnet address matches the Polkadot ed25519 keyring for the same seed', () => {
  assert.equal(identityFromSeed(SEED).address, '5C9TqVEs5Q51zUdjvp6tSsjHAfLseJKq1Dq6ULcuSLqEuRSf');
});

test('SS58 encoding matches the well-known Alice address', () => {
  const alice = fromHex('d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d');
  assert.equal(ss58Address(alice), '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
});

test('signature matches the Polkadot ed25519 keyring byte for byte and verifies', () => {
  const message = 'api.flop.network wants you\nline2';
  const signature = signMessage(SEED, message);
  assert.equal(signature, '0x29b2a263cfd5429317d5aa6a3d3a219b8178c9cb3e4807af1dea2120b90388abfa79215106405cda706c8c2e02274c60142466c3ff709bb4a50d65e541b89c04');
  assert.ok(verifyMessage(identityFromSeed(SEED).publicKey, message, signature));
  assert.ok(!verifyMessage(identityFromSeed(SEED).publicKey, message + ' ', signature));
});

test('a seed of the wrong length is rejected', () => {
  assert.throws(() => seedFromHex('abcd'), /64 hex/);
});
