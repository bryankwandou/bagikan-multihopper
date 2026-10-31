// CSV payout list -> validated Multi-Send batches (max 20 distinct wallets each).

export const MAX_DESTINATIONS = 20;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface Payee {
  wallet: string;
  amountRaw: bigint;
  note: string;
}

export interface Batch {
  index: number;
  destinations: { wallet: string; amountRaw: string }[];
  totalRaw: bigint;
}

export function toRaw(amount: string, decimals: number): bigint {
  const m = amount.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`invalid amount "${amount}"`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`amount "${amount}" has more than ${decimals} decimals`);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function fromRaw(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}

/** CSV columns: wallet,amount[,note]. Header row optional. Same wallet twice is merged. */
export function parsePayees(csv: string, decimals: number): Payee[] {
  const merged = new Map<string, Payee>();
  csv.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const [wallet, amount, ...rest] = t.split(",").map((c) => c.trim());
    if (i === 0 && wallet.toLowerCase() === "wallet") return;
    if (!BASE58.test(wallet)) throw new Error(`line ${i + 1}: invalid Solana address "${wallet}"`);
    const raw = toRaw(amount ?? "", decimals);
    if (raw <= 0n) throw new Error(`line ${i + 1}: amount must be > 0`);
    const prev = merged.get(wallet);
    merged.set(wallet, {
      wallet,
      amountRaw: (prev?.amountRaw ?? 0n) + raw,
      note: [prev?.note, rest.join(",")].filter(Boolean).join("; "),
    });
  });
  if (merged.size === 0) throw new Error("no payees in CSV");
  return [...merged.values()];
}

/** Each batch's destination shares sum exactly to its total, as the API requires. */
export function toBatches(payees: Payee[]): Batch[] {
  const batches: Batch[] = [];
  for (let i = 0; i < payees.length; i += MAX_DESTINATIONS) {
    const chunk = payees.slice(i, i + MAX_DESTINATIONS);
    batches.push({
      index: batches.length,
      destinations: chunk.map((p) => ({ wallet: p.wallet, amountRaw: p.amountRaw.toString() })),
      totalRaw: chunk.reduce((s, p) => s + p.amountRaw, 0n),
    });
  }
  return batches;
}
