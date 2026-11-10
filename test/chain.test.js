import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountStorageKey, Chain, decodeFreeBalance, formatFlop, httpRpcUrl } from '../src/chain.js';
import { fromHex } from '../src/identity.js';

const ALICE = fromHex('d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d');

test('System.Account storage key matches the well-known key for Alice', () => {
  assert.equal(accountStorageKey(ALICE),
    '0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9de1e86a9a8c739864cf3cc5ec2bea59fd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d');
});

test('free balance is read as a little-endian u128 after the four u32 counters', () => {
  const counters = '05000000' + '00000000' + '01000000' + '00000000';
  const free = '000064a7b3b6e00d0000000000000000'; // 10^18
  assert.equal(decodeFreeBalance('0x' + counters + free + '00'.repeat(48)), 10n ** 18n);
  assert.equal(decodeFreeBalance(null), 0n);
  assert.throws(() => decodeFreeBalance('0x00'), /encoding/);
});

test('amounts are formatted with 18 decimals', () => {
  assert.equal(formatFlop(25n * 10n ** 18n), '25.0000');
  assert.equal(formatFlop(10n ** 18n + 5n * 10n ** 17n), '1.5000');
});

test('the websocket RPC address maps to its HTTP form', () => {
  assert.equal(httpRpcUrl('wss://rpc.devnet.flop.network'), 'https://rpc.devnet.flop.network');
});

test('balance is read at the finalized head', async () => {
  const calls = [];
  const fakeFetch = async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    calls.push([method, params]);
    const result = method === 'chain_getFinalizedHead' ? '0xhead' : '0x' + '00'.repeat(16) + '01' + '00'.repeat(15);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  };
  assert.equal(await new Chain('wss://example.invalid', fakeFetch).finalizedFreeBalance(ALICE), 1n);
  assert.deepEqual(calls[1], ['state_getStorage', [accountStorageKey(ALICE), '0xhead']]);
});

test('an RPC error is surfaced', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'boom' } }));
  await assert.rejects(new Chain('wss://example.invalid', fakeFetch).genesisHash(), /boom/);
});
