import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChallenge } from '../src/gateway.js';

const GATEWAY = 'https://api.flop.network';
const ADDRESS = '5C9TqVEs5Q51zUdjvp6tSsjHAfLseJKq1Dq6ULcuSLqEuRSf';
const GENESIS = '0x99c172c095340ace980631f9123544c6bebd4839f3437e463533422d8be2d631';
const NOW = Date.parse('2026-11-10T19:24:00.000Z');

// Shape copied from a live devnet challenge.
function challenge(overrides = {}) {
  const lines = {
    host: 'api.flop.network wants you to enroll a FLOP devnet gateway key with your account:',
    address: ADDRESS,
    blank: '',
    action: 'Action: flop-devnet-enroll/v1',
    genesis: `Genesis: ${GENESIS}`,
    nonce: 'Nonce: aa18b1d3bf4b50d8941b765dbf5fb243d6e4a2d7ede4375035a5d51023a1d070',
    issued: 'Issued At: 2026-11-10T19:23:39.658Z',
    expires: 'Expiration Time: 2026-11-10T19:28:39.658Z',
    ...overrides,
  };
  return Object.values(lines).join('\n');
}

const check = (message, now = NOW) => validateChallenge(message, ADDRESS, GATEWAY, GENESIS, now);

test('a genuine challenge is accepted', () => {
  assert.doesNotThrow(() => check(challenge()));
});

test('a challenge for another account is refused', () => {
  assert.throws(() => check(challenge({ address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' })), /address/);
});

test('a challenge naming another host is refused', () => {
  assert.throws(() => check(challenge({ host: 'evil.example wants you to enroll a FLOP devnet gateway key with your account:' })), /host/);
});

test('a challenge for another chain is refused', () => {
  assert.throws(() => check(challenge({ genesis: 'Genesis: 0x' + '11'.repeat(32) })), /genesis/);
});

test('a challenge with a different action is refused', () => {
  assert.throws(() => check(challenge({ action: 'Action: transfer-all/v1' })), /action/);
});

test('an expired challenge is refused', () => {
  assert.throws(() => check(challenge(), Date.parse('2026-11-10T19:30:00.000Z')), /validity/);
});

test('a challenge valid for longer than five minutes is refused', () => {
  assert.throws(() => check(challenge({ expires: 'Expiration Time: 2026-11-10T20:23:39.658Z' })), /validity/);
});

test('extra lines are refused', () => {
  assert.throws(() => check(challenge() + '\nAction: something-else'), /line count/);
});
