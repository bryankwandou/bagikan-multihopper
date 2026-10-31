# Research notes

Read on 31 October 2026. Every number below comes from the linked source. Where a source is silent, it says so.

## The problem

Teams that pay many wallets after a campaign (creator and KOL payouts, bounty and hackathon prizes, DAO grants, contributor pay) usually do it from one treasury wallet, one transfer at a time. Three costs follow:

1. **Time.** Each payout is a copy, paste, check and sign cycle.
2. **Irreversible mistakes.** A wrong address cannot be charged back.
3. **Exposure.** Direct payouts from one wallet are public. The recipient list, amounts and timing can be read from any explorer.

## Existing tools

| Tool | What it covers | Source |
|---|---|---|
| Streamflow Payouts | Recurring and bulk payments for payroll, CSV import, payout history and status, address book, any supported SPL token. Routing is not described. | [Streamflow help: Payouts](https://docs.streamflow.finance/en/articles/12639121-payouts) |
| Multisender and similar airdrop tools | Sending SPL tokens to many wallets from a CSV in few transactions. | [MadeOnSol comparison](https://madeonsol.com/compare/multisender-vs-streamflow) |
| Solana batch payments guide | Several transfers can be packed into one transaction, and large lists are split across transactions because of the transaction size limit. | [solana.com: batch payments](https://solana.com/docs/payments/send-payments/payment-processing/batch-payments) |

Conclusion: CSV bulk sending is solved. What these tools do not describe is routing the payout through intermediate hops with a chosen arrival time, compliance screening, and a per-wallet evidence record tied to a transfer ID. That is the gap Hoproll fills by building on MultiHopper.

## MultiHopper facts used in the build

Sources: [quickstart](https://dev-docs.multihopper.com/quickstart), [multi-destination guide](https://dev-docs.multihopper.com/guides/multi-destination), [create](https://dev-docs.multihopper.com/api-reference/transfers/create), [prepare](https://dev-docs.multihopper.com/api-reference/transfers/prepare), [pricing](https://dev-docs.multihopper.com/concepts/pricing), [webhook events](https://dev-docs.multihopper.com/api-reference/webhooks/events), [environments](https://dev-docs.multihopper.com/concepts/environments.md).

- **Environments.** Devnet `https://devnet.multihopper.com/api/v1` with `mh_test_` keys, production `https://multihopper.com/api/v1` with `mh_live_` keys. Auth via `x-api-key`.
- **Multi-Send.** `destinations: [{ wallet, amountRaw }]`, at most 20 wallets, unique, shares must sum exactly to `amountRaw`. The fee is taken once from the total and the rest is split proportionally. For SOL, every destination must receive at least the rent-exempt minimum after fees (`MH_017`).
- **Route parameters.** `hops` 3 to 10, `arrivalSeconds` 60 to 2,592,000 (30 days). `externalId` must be unique per integration (`MH_033` on reuse). `Idempotency-Key` header prevents duplicate transfers.
- **Signing order.** `keeperFundingTx`, then `routeInitTxs`, `orchestratorInitTx`, `sessionInitTxs`, `dispersionInitTxs`. All base64. The orchestrator init is a legacy transaction, the rest are versioned. Null groups are already on-chain and are skipped. Blockhashes last about 60 seconds, and `/prepare` can be called again to resume.
- **Status.** Each destination moves `pending → paid`. The transfer becomes `completed`, and `transfer.completed` fires, only after every destination is paid.
- **Webhooks.** `x-multihopper-signature` is a hex HMAC-SHA256 of the raw body with the endpoint secret, compared with `timingSafeEqual`. Five retries: immediately, 30 s, 5 min, 30 min, 2 h.
- **Rate limits per key.** `POST /transfers` 10 per 60 s, estimate 30 per 60 s, GET 60 per 60 s.

## Costs

- 0.5% of the hop amount, paid in the transferred token.
- Per-hop flat fee in SOL, tiered by USD value: zero at $50 or less, up to 0.002 SOL above $500.
- Mainnet compliance screening: 0.002 SOL per screened wallet, non-refundable. About 0.04 SOL for a 20-recipient batch.

Worked example, 43 recipients and 45 SOL total: 3 batches, 0.225 SOL routing fee, 0.086 SOL screening, 0.311 SOL before per-hop fees. For one or two payments a plain transfer is cheaper. The product fits teams that pay a list on a schedule.

## Open questions for the MultiHopper team

1. Whether SPL Multi-Send (USDC, USDT) is live on devnet and mainnet, and which devnet USDC mint is supported.
2. Whether a `mh_live_` key requires any business verification.
