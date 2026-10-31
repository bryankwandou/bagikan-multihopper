# Hoproll CLI

CSV payout list → validation → Multi-Send batches of up to 20 wallets → MultiHopper API flow (estimate, create, prepare, sign, confirm-broadcast, status) → evidence CSV.

**Status:** `mock` mode is tested offline (placeholders prefixed `MOCK_`). `devnet` mode completed a real Multi-Send on 31 Oct 2026, transfer #1541, see [`../proof/devnet-transfer-1541.csv`](../proof/devnet-transfer-1541.csv). There is no mainnet mode in this CLI, on purpose.

Set the key without editing files by hand: copy it, then run `node scripts/set-key.mjs --clipboard`. If a run stops halfway (for example `MH_041`), finish it with `node scripts/resume.ts <transferId>`.

## Run (Node 23.6 or newer, no install needed for mock)

```bash
node src/run.ts examples/payouts.csv --mode mock
```

```bash
node --test test/payout.test.ts
```

Output goes to `out/evidence-mock-<campaign>.csv`. Addresses in `examples/payouts.csv` are random, not anyone's wallet.

## Devnet

1. Create a devnet key (`mh_test_...`) at https://devnet.multihopper.com/developer/dashboard. Never paste it into chat, the repo or a public channel.
2. Create a devnet-only keypair and fund it:
   ```bash
   solana-keygen new -o devnet.json --no-bip39-passphrase
   ```
   ```bash
   solana airdrop 2 $(solana-keygen pubkey devnet.json) --url devnet
   ```
3. Install the Solana SDK:
   ```bash
   npm install @solana/web3.js@1.98.0
   ```
4. Put `MH_API_KEY=mh_test_...` and `DEVNET_KEYPAIR=devnet.json` in `prototype/.env` (git-ignored), then:
   ```bash
   node src/run.ts examples/devnet-payouts.csv --mode devnet
   ```

Guards: devnet mode refuses any key that does not start with `mh_test_`, and both the API base URL and the RPC are pinned to devnet.

`/prepare` returns base64 transactions: `routeInitTxs` as `{ base64 }` objects, `orchestratorInitTx` as a legacy transaction, the rest versioned. Null groups are skipped. SOL Multi-Send requires every recipient to receive at least the rent-exempt minimum after fees (`MH_017`), so avoid tiny amounts on devnet.

## Mainnet (real funds, run by the treasury owner)

Prerequisites, all done by the owner in the MultiHopper production dashboard: a `mh_live_` key, a rewards wallet holding the rent-exempt minimum (`MH_091` otherwise), and attribution confirmed in the builder chat.

Store the key without seeing it: copy it in the dashboard, then run `node scripts/set-key.mjs --live --clipboard` (it writes `MH_LIVE_KEY`, clears the clipboard and checks the key). Also add to `prototype/.env` (git-ignored): `MAINNET_KEYPAIR=<path to the payout wallet>`, `MAINNET_MAX_SOL=<cap>`, optionally `MAINNET_RPC=<your RPC>`.

1. Quote only, sends nothing:
   ```bash
   node src/run.ts payouts.csv --mode mainnet --quote-only
   ```
2. Send:
   ```bash
   node src/run.ts payouts.csv --mode mainnet
   ```

Before the first transaction the CLI quotes every batch, refuses if the total is above `MAINNET_MAX_SOL` or the wallet cannot cover the up-front SOL, and asks the operator to type `SEND <total>` in an interactive terminal. Anything else cancels. Use a dedicated payout wallet funded with the campaign budget only.

## Files

| File | Purpose |
|---|---|
| `src/payout.ts` | CSV parsing, address validation, duplicate merge, batches of 20, exact share sums in BigInt |
| `src/client.ts` | HTTP client (`x-api-key`, `Idempotency-Key`) |
| `src/mock.ts` | Offline API with the same response shapes as the docs, labelled MOCK |
| `src/webhook.ts` | `x-multihopper-signature` check (hex HMAC-SHA256) |
| `src/run.ts` | End-to-end CLI and evidence export |
