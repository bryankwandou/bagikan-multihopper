// Resume a devnet transfer: call /prepare again, broadcast every pending group in order,
// report each transaction's real result, then confirm-broadcast.
// Usage: node scripts/resume.ts <transferId>
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as web3 from "@solana/web3.js";

process.loadEnvFile(".env");
const id = process.argv[2];
const key = process.env.MH_API_KEY ?? "";
if (!id || !key.startsWith("mh_test_")) throw new Error("usage: node scripts/resume.ts <transferId> (needs a mh_test_ key)");
const API = "https://devnet.multihopper.com/api/v1";
const conn = new web3.Connection("https://api.devnet.solana.com", "confirmed");
const kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.DEVNET_KEYPAIR!, "utf8"))));

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "x-api-key": key };
  if (method === "POST") headers["Idempotency-Key"] = randomUUID();
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function send(label: string, b64: string | null | undefined): Promise<string | null> {
  if (!b64) return null;
  const bytes = Buffer.from(b64, "base64");
  let raw: Uint8Array;
  try {
    const vtx = web3.VersionedTransaction.deserialize(bytes);
    vtx.sign([kp]);
    raw = vtx.serialize();
  } catch {
    const tx = web3.Transaction.from(bytes);
    tx.partialSign(kp);
    raw = tx.serialize({ requireAllSignatures: false });
  }
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
  const res = await conn.confirmTransaction(sig, "confirmed");
  if (res.value.err) throw new Error(`${label} failed on chain: ${JSON.stringify(res.value.err)} (${sig})`);
  console.log(`  ${label}: ${sig}`);
  return sig;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const { preparedTxs: p } = await api("POST", `/transfers/${id}/prepare`);
console.log("resume state:", JSON.stringify(p.resume));

const keeperFundingSignature = await send("keeperFunding", p.keeperFundingTx);
const routeInitSignatures: string[] = [];
for (const [i, t] of (p.routeInitTxs ?? []).entries()) {
  const s = await send(`routeInit[${i}]`, t?.base64 ?? t);
  if (s) routeInitSignatures.push(s);
}
await sleep(3000);
const orchestratorInitSignature = await send("orchestratorInit", p.orchestratorInitTx);
await sleep(3000);
const sessionInitSignatures: string[] = [];
for (const [i, t] of (p.sessionInitTxs ?? []).entries()) {
  const s = await send(`sessionInit[${i}]`, t);
  if (s) sessionInitSignatures.push(s);
}
const dispersionInitSignatures: string[] = [];
for (const [i, t] of (p.dispersionInitTxs ?? []).entries()) {
  const s = await send(`dispersionInit[${i}]`, t);
  if (s) dispersionInitSignatures.push(s);
}

const body: Record<string, unknown> = { routeInitSignatures };
if (keeperFundingSignature) body.keeperFundingSignature = keeperFundingSignature;
if (orchestratorInitSignature) body.orchestratorInitSignature = orchestratorInitSignature;
if (sessionInitSignatures.length) body.sessionInitSignatures = sessionInitSignatures;
if (dispersionInitSignatures.length) body.dispersionInitSignatures = dispersionInitSignatures;
const confirmed = await api("POST", `/transfers/${id}/confirm-broadcast`, body);
console.log("confirm-broadcast:", confirmed.status ?? JSON.stringify(confirmed).slice(0, 200));
