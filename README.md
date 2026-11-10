# flop-devnet-agent

Use a [Technocore](https://technocore.chat) `did:key` identity as an agent account on the
**FLOP devnet**: check the network, take the faucet grant, enroll for a gateway key, run
one inference request and read its receipt.

It is the companion of [technocore-did-kit](https://github.com/Dnyelfy/technocore-did-kit).
The kit makes the identity; this tool puts the same 32-byte Ed25519 seed to work on chain.
One seed gives both names:

| | |
| --- | --- |
| Technocore identity | `did:key:z6Mk…` |
| FLOP devnet account | SS58 address, prefix 42 |

> **The devnet earns nothing.** FLOP's own docs say it has no rewards and no airdrop
> weight, and it can be reset. No FLOP token exists and there is nothing to buy; anything
> offering a claim, a mint or a presale is a scam. This tool is for learning the flow
> before a public testnet publishes its endpoints.

## Use

Needs Node.js 22 or later.

```bash
npm install
```

```bash
node src/cli.js status
```

```bash
node src/cli.js whoami --key technocore-identity-xxxx.json
```

`--key` takes the identity file the DID kit downloads. Without it, the tool uses its own
store in `~/.flop-devnet-agent/`; `keygen` creates a throwaway identity there.

| Command | What it does |
| --- | --- |
| `keygen` | Create a throwaway identity in the local store. Never overwrites one. |
| `whoami` | Show the `did:key` and the devnet address. |
| `status` | Compare the RPC and faucet genesis, show faucet state and the model catalog. |
| `balance` | FLOP balance at the finalized head. |
| `fund` | Request the faucet grant (25 FLOP per address per day) and wait for finality. |
| `enroll` | Sign the gateway's challenge and store a gateway key. |
| `key` | Quota and expiry of the stored gateway key. |
| `chat <prompt>` | One inference request, then its receipt. |
| `receipt <id>` | Look up the receipt of an earlier request. |

Add `--json` to any command for machine-readable output.

## What was verified, and what was not

Checked on 2026-11-10 against the live devnet with a throwaway key:

- `status`, `balance` and `fund` work end to end; the faucet grant arrived and finalized.
- The gateway **accepts an Ed25519 `did:key` signature** for enrollment: a wrong
  signature is refused with `401 invalid_signature`, the real one passes that check.
- `enroll` then stopped at `503 wallet_enrollment_cap_reached`, the gateway's own daily
  limit. So `enroll`, `key`, `chat` and `receipt` are **not yet exercised against the live
  gateway**; their request shapes follow the official CLI and are covered by unit tests.

The identity code is checked against two references: the DID equals the one
technocore-did-kit derives from the same seed, and the address and signature equal what
the Polkadot Ed25519 keyring produces, byte for byte.

## Safety

- **The identity file is the identity.** Losing it orphans the DID; leaking it hands the
  identity to someone else. It never leaves your machine: the tool sends signatures and
  the public address, nothing else.
- **The key only signs a checked enrollment.** The gateway's challenge is validated line
  by line (this address, this gateway host, this chain's genesis, at most five minutes
  valid) before it is signed. Nothing else is ever signed, and no transaction is built.
- **Paid requests are sent once.** Each request id is logged before sending. After a
  timeout the outcome is unknown: look it up with `receipt`, do not send it again.
- Gateway keys are stored owner-only (`0600`) and are never printed.
- Using your real DID here links it publicly to a devnet address. Use `keygen` if you
  would rather try with a throwaway first.

## How it works

No SDK, two small dependencies ([`@noble/curves`](https://github.com/paulmillr/noble-curves),
[`@noble/hashes`](https://github.com/paulmillr/noble-hashes)). The flow mirrors
`flop agent credential` in the official `@flop-labs/cli`, with an Ed25519 account in place
of its sr25519 one:

1. Read the genesis hash from the RPC and from the faucet's `/chain`; stop if they differ.
2. `POST faucet /fund`, then poll `System.Account` at the finalized head.
3. `GET /v1/enroll/wallet/challenge`, validate, sign, `POST /v1/enroll/wallet`.
4. `POST /v1/chat/completions` with the issued key and an `Idempotency-Key`.
5. `GET /v1/keys/me/receipts/{id}`.

Endpoints: RPC `wss://rpc.devnet.flop.network` (used over HTTPS), faucet
`https://faucet.flop.network`, gateway `https://api.flop.network`.

```bash
npm test
```

## License

Apache-2.0
