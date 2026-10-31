// MOCK MultiHopper. Simulates the documented request/response shapes locally.
// Nothing here touches any network or chain; every id and signature is fake and prefixed "MOCK".

import { randomBytes } from "node:crypto";
import type { ConfirmBody, CreateTransferBody, MultiHopperApi, PreparedTxs, Transfer } from "./client.ts";

const fake = (p: string) => `MOCK_${p}_${randomBytes(6).toString("hex")}`;

export class MockMultiHopper implements MultiHopperApi {
  readonly label = "MOCK (offline, no real API, no chain)";
  private transfers = new Map<string, Transfer & { body: CreateTransferBody }>();
  private byIdem = new Map<string, string>();

  async estimate(b: { amountRaw: string; hops: number; destinationCount: number }) {
    return {
      tier: 0,
      percentFeeBps: 50,
      percentFeeRaw: ((BigInt(b.amountRaw) * 50n) / 10000n).toString(),
      totalFlatFeeLamports: 0,
      note: "MOCK estimate: 0.5% percent fee per pricing docs; real per-hop SOL fee comes from the API",
    };
  }

  async create(body: CreateTransferBody, idempotencyKey: string): Promise<Transfer> {
    const existing = this.byIdem.get(idempotencyKey);
    if (existing) return this.transfers.get(existing)!;
    const sum = body.destinations.reduce((s, d) => s + BigInt(d.amountRaw), 0n);
    if (sum !== BigInt(body.amountRaw)) throw new Error("MOCK MH_017-like: destination shares must sum to amountRaw");
    if (body.destinations.length > 20) throw new Error("MOCK: max 20 destinations");
    const id = fake("tr");
    const t = {
      id,
      status: "awaiting_signature",
      externalId: body.externalId,
      recipientWallet: null,
      destinationCount: body.destinations.length,
      destinations: body.destinations.map((d) => ({ ...d, status: "pending", payoutSignature: null, paidAt: null })),
      body,
    };
    this.transfers.set(id, t);
    this.byIdem.set(idempotencyKey, id);
    return t;
  }

  async prepare(id: string): Promise<{ transfer: Transfer; preparedTxs: PreparedTxs }> {
    const transfer = this.must(id);
    const preparedTxs: PreparedTxs = {
      keeperFundingTx: fake("tx"),
      routeInitTxs: [fake("tx")],
      orchestratorInitTx: fake("tx"),
      sessionInitTxs: [fake("tx")],
      dispersionInitTxs: [fake("tx")],
      recentBlockhash: fake("blockhash"),
      lastValidBlockHeight: 0,
    };
    return { transfer, preparedTxs };
  }

  async confirmBroadcast(id: string, b: ConfirmBody): Promise<Transfer> {
    const t = this.must(id);
    if (b.sessionInitSignatures?.length) t.status = "processing";
    return t;
  }

  async get(id: string): Promise<Transfer> {
    const t = this.must(id);
    if (t.status === "processing") {
      t.status = "completed";
      for (const d of t.destinations!) {
        d.status = "paid";
        d.payoutSignature = fake("sig");
        d.paidAt = new Date().toISOString();
      }
    }
    return t;
  }

  private must(id: string) {
    const t = this.transfers.get(id);
    if (!t) throw new Error(`MOCK: unknown transfer ${id}`);
    return t;
  }
}
