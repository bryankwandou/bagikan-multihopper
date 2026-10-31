# Hoproll

Batch payouts on Solana, routed by [MultiHopper](https://dev-docs.multihopper.com/quickstart).

Upload a payout list (`wallet,amount,note`). Hoproll validates every address, merges duplicates, splits the list into Multi-Send batches of up to 20 wallets, runs each batch through the MultiHopper API in the signing order the docs require, and writes a per-wallet evidence CSV for finance.

Live page: https://hoproll.vercel.app

## Why

Creator campaigns, bounties, hackathons and DAO grants end with one treasury paying 30 to 200 wallets by hand. That is slow, one typo is final, and every direct payout from one wallet publishes the whole roster and its rates on an explorer. Bulk senders solve the first two. Hoproll uses MultiHopper routing (multi-hop, scheduled arrival, compliance screening) to also reduce simple linkage between the treasury and its recipients. It does not guarantee anonymity and is not marketed that way.

Background and sources: [RESEARCH.md](RESEARCH.md).

## Repo

| Path | What |
|---|---|
| [`prototype/`](prototype/) | TypeScript CLI: CSV parsing and batching, API client, ordered signer, webhook HMAC check, evidence export. Modes: `mock` (offline) and `devnet`. |
| [`web/`](web/) | The landing page and in-browser dry-run console (no API calls, no chain access). Deployed on Vercel. |
| [`RESEARCH.md`](RESEARCH.md) | Problem, alternatives, MultiHopper API facts and costs, with sources. |

## Status

- Done: docs read end to end, CLI with 4 passing unit tests, production attribution cleared with the MultiHopper team, devnet treasury funded.
- Done: first live devnet Multi-Send. Transfer #1541 sent 0.25 SOL to 5 wallets over 3 hops and completed on 31 Oct 2026 at 02:54 UTC with all 5 recipients paid. Evidence with explorer links: [`proof/devnet-transfer-1541.csv`](proof/devnet-transfer-1541.csv).
- Next: wallet-adapter signing on the web, a webhook endpoint, and a first mainnet campaign payout.
- No mainnet transfer has happened yet. IDs on the web console are `DRYRUN_` placeholders; the devnet proof above is real.

Built by Bryan Kwandou, Makassar.
