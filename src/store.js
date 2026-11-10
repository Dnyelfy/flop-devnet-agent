// Local files. Everything secret is written owner-only (0600) in an owner-only directory.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomSeed, seedFromHex, toHex } from './identity.js';

export function homeDir() {
  return process.env.FLOP_AGENT_HOME || join(homedir(), '.flop-devnet-agent');
}

const identityPath = () => join(homeDir(), 'identity.json');
const credentialPath = () => join(homeDir(), 'credential.json');
const requestLogPath = () => join(homeDir(), 'requests.jsonl');

async function ensureHome() {
  await mkdir(homeDir(), { recursive: true, mode: 0o700 });
}

async function writePrivate(path, text, flag) {
  await ensureHome();
  await writeFile(path, text, { mode: 0o600, flag });
  await chmod(path, 0o600);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Accepts the file technocore-did-kit downloads ({ ed25519_seed_hex, ... }).
export async function loadSeed(keyFile) {
  const path = keyFile || identityPath();
  const stored = await readJson(path);
  if (!stored) {
    throw new Error(keyFile
      ? `identity file not found: ${keyFile}`
      : 'no identity yet: run "flop-agent keygen", or pass --key <technocore-identity file>');
  }
  if (typeof stored.ed25519_seed_hex !== 'string') throw new Error(`${path} has no ed25519_seed_hex field`);
  return seedFromHex(stored.ed25519_seed_hex);
}

// Refuses to overwrite: an existing identity is never replaced silently.
export async function createIdentity() {
  const seed = randomSeed();
  try {
    await writePrivate(identityPath(), JSON.stringify({ ed25519_seed_hex: toHex(seed) }) + '\n', 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`an identity already exists at ${identityPath()}; it was left untouched`);
    throw error;
  }
  return { seed, path: identityPath() };
}

export const loadCredential = () => readJson(credentialPath());

export async function saveCredential(credential) {
  await writePrivate(credentialPath(), JSON.stringify(credential) + '\n', 'w');
  return credentialPath();
}

// Written before a paid request is sent, so its id survives a crash or a timeout.
export async function logRequest(entry) {
  await ensureHome();
  await appendFile(requestLogPath(), JSON.stringify(entry) + '\n', { mode: 0o600 });
  return requestLogPath();
}
