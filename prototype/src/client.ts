// Minimal MultiHopper Transfer API client. Field names follow
// https://dev-docs.multihopper.com/quickstart and /guides/multi-destination.

export interface CreateTransferBody {
  tokenMint: string;
  amountRaw: string;
  amountTokens: string;
  tokenDecimals: number;
  tokenSymbol: string;
  sourceOwner: string;
  destinations: { wallet: string; amountRaw: string }[];
  hops: number;
  arrivalSeconds: number;
  externalId: string;
}

export interface PreparedTxs {
  keeperFundingTx: string | null;
  routeInitTxs: (string | { base64: string })[];
  orchestratorInitTx: string | null;
  sessionInitTxs: string[];
  dispersionInitTxs?: string[];
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface Transfer {
  id: string | number;
  status: string;
  externalId?: string;
  destinations?: { wallet: string; amountRaw: string; status: string; payoutSignature: string | null; paidAt: string | null }[];
  [k: string]: unknown;
}

export interface ConfirmBody {
  keeperFundingSignature?: string;
  routeInitSignatures?: string[];
  orchestratorInitSignature?: string;
  sessionInitSignatures?: string[];
  dispersionInitSignatures?: string[];
}

export interface MultiHopperApi {
  readonly label: string;
  estimate(b: { tokenMint: string; amountRaw: string; tokenDecimals: number; hops: number; destinationCount: number }): Promise<Record<string, unknown>>;
  create(b: CreateTransferBody, idempotencyKey: string): Promise<Transfer>;
  prepare(id: string): Promise<{ transfer: Transfer; preparedTxs: PreparedTxs }>;
  confirmBroadcast(id: string, b: ConfirmBody): Promise<Transfer>;
  get(id: string): Promise<Transfer>;
}

export class HttpMultiHopper implements MultiHopperApi {
  readonly label: string;
  private baseUrl: string;
  private apiKey: string;
  constructor(baseUrl: string, apiKey: string) {
    this.label = this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async call<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    // Every mutation needs an Idempotency-Key (MH_070); create passes its own, the rest get a fresh one.
    if (method === "POST" && !extra["Idempotency-Key"]) extra = { ...extra, "Idempotency-Key": crypto.randomUUID() };
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      // Fastify rejects content-type: application/json with an empty body, so only send it with a body.
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-api-key": this.apiKey, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text) as T;
  }

  estimate(b: Parameters<MultiHopperApi["estimate"]>[0]) {
    return this.call<Record<string, unknown>>("POST", "/transfers/estimate", b);
  }
  create(b: CreateTransferBody, idempotencyKey: string) {
    return this.call<Transfer>("POST", "/transfers", b, { "Idempotency-Key": idempotencyKey });
  }
  prepare(id: string) {
    return this.call<{ transfer: Transfer; preparedTxs: PreparedTxs }>("POST", `/transfers/${id}/prepare`);
  }
  confirmBroadcast(id: string, b: ConfirmBody) {
    return this.call<Transfer>("POST", `/transfers/${id}/confirm-broadcast`, b);
  }
  get(id: string) {
    return this.call<Transfer>("GET", `/transfers/${id}`);
  }
}
