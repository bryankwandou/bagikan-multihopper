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
- Next: first devnet Multi-Send transfers, then wallet-adapter signing on the web, a webhook endpoint, and a first mainnet campaign payout.
- No devnet or mainnet transfer has happened yet. Every ID on the web console is a `DRYRUN_` placeholder.

Built by Bryan Kwandou, Makassar.
