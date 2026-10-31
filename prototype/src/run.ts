// Hoproll prototype: CSV payout list -> MultiHopper Multi-Send batches -> evidence CSV.
//
//   node src/run.ts examples/payouts.csv                 (MOCK, default, offline)
//   node src/run.ts examples/payouts.csv --mode devnet   (needs MH_API_KEY=mh_test_... and DEVNET_KEYPAIR)
//
// There is deliberately no mainnet mode in this prototype.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parsePayees, toBatches, fromRaw } from "./payout.ts";
import { HttpMultiHopper, type MultiHopperApi, type PreparedTxs, type Transfer } from "./client.ts";
import { MockMultiHopper } from "./mock.ts";

const DEVNET_API = "https://devnet.multihopper.com/api/v1";
const DEVNET_RPC = "https://api.devnet.solana.com";
const WSOL = "So11111111111111111111111111111111111111112";

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--")) ?? "examples/payouts.csv";
const mode = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "mock";
const campaign = args.includes("--campaign") ? args[args.indexOf("--campaign") + 1] : `demo-${Date.now()}`;
// Optional prototype/.env (gitignored) holding MH_API_KEY and DEVNET_KEYPAIR.
try { process.loadEnvFile(".env"); } catch {}

const token = { mint: WSOL, decimals: 9, symbol: "SOL" };
const hops = 3;
const arrivalSeconds = 300;

// Prepared txs are base64. Some groups are arrays of { base64 } objects (routeInitTxs), some plain strings;
// null/empty means "already on chain, skip" (see /api-reference/transfers/prepare).
type PreparedTx = string | { base64: string } | null | undefined;
const b64Of = (t: PreparedTx) => (t == null ? null : typeof t === "string" ? t : t.base64);
type Signer = { owner: string; signAndSend(txs: PreparedTx[]): Promise<string[]> };

async function devnetSigner(): Promise<Signer> {
  const path = process.env.DEVNET_KEYPAIR;
  if (!path) throw new Error("set DEVNET_KEYPAIR to a devnet-only keypair JSON (solana-keygen new -o devnet.json)");
  const web3 = await import("@solana/web3.js");
  const kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const conn = new web3.Connection(DEVNET_RPC, "confirmed");
  return {
    owner: kp.publicKey.toBase58(),
    async signAndSend(txs) {
      const sigs: string[] = [];
      for (const t of txs) {
        const b64 = b64Of(t);
        if (!b64) continue;
        // Docs: orchestratorInitTx is a legacy Transaction, everything else a VersionedTransaction.
        const bytes = Buffer.from(b64, "base64");
        let sig: string;
        try {
          const vtx = web3.VersionedTransaction.deserialize(bytes);
          vtx.sign([kp]);
          sig = await conn.sendTransaction(vtx);
        } catch {
          const tx = web3.Transaction.from(bytes);
          tx.partialSign(kp);
          sig = await conn.sendRawTransaction(tx.serialize());
        }
        await conn.confirmTransaction(sig, "confirmed");
        sigs.push(sig);
      }
      return sigs;
    },
  };
}

function mockSigner(): Signer {
  return {
    owner: "MockSourceOwner1111111111111111111111111111",
    async signAndSend(txs) {
      return txs.map(b64Of).filter((t): t is string => !!t).map((t) => t.replace("MOCK_tx", "MOCK_sig"));
    },
  };
}

async function sendBatch(api: MultiHopperApi, signer: Signer, b: ReturnType<typeof toBatches>[number]): Promise<Transfer> {
  const externalId = `${campaign}-batch-${b.index}`;
  const est = await api.estimate({ tokenMint: token.mint, amountRaw: b.totalRaw.toString(), tokenDecimals: token.decimals, hops, destinationCount: b.destinations.length });
  console.log(`  estimate:`, JSON.stringify(est));

  const created = await api.create(
    {
      tokenMint: token.mint,
      amountRaw: b.totalRaw.toString(),
      amountTokens: fromRaw(b.totalRaw, token.decimals),
      tokenDecimals: token.decimals,
      tokenSymbol: token.symbol,
      sourceOwner: signer.owner,
      destinations: b.destinations,
      hops,
      arrivalSeconds,
      externalId,
    },
    `${externalId}-${randomUUID()}`,
  );
  console.log(`  created ${created.id} (${created.status})`);

  const { preparedTxs: p } = await api.prepare(String(created.id));
  // Documented order: keeperFundingTx first (null if keeper already funded) and recorded on its own, then the rest.
  const [keeperFundingSignature] = await signer.signAndSend([p.keeperFundingTx]);
  if (keeperFundingSignature) await api.confirmBroadcast(String(created.id), { keeperFundingSignature });
  const rest = await signRest(signer, p);
  const confirmed = await api.confirmBroadcast(String(created.id), { keeperFundingSignature, ...rest });
  console.log(`  broadcast confirmed (${confirmed.status})`);

  for (let i = 0; i < 60; i++) {
    const t = await api.get(String(created.id));
    if (["completed", "failed", "refunded", "expired"].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, mode === "mock" ? 0 : 10_000));
  }
  return api.get(String(created.id));
}

async function signRest(signer: Signer, p: PreparedTxs) {
  const routeInitSignatures = await signer.signAndSend((p.routeInitTxs ?? []) as PreparedTx[]);
  const [orchestratorInitSignature] = await signer.signAndSend([p.orchestratorInitTx as PreparedTx]);
  const sessionInitSignatures = await signer.signAndSend(p.sessionInitTxs ?? []);
  const dispersionInitSignatures = await signer.signAndSend(p.dispersionInitTxs ?? []);
  return { routeInitSignatures, orchestratorInitSignature, sessionInitSignatures, dispersionInitSignatures };
}

async function main() {
  let api: MultiHopperApi;
  let signer: Signer;
  if (mode === "devnet") {
    const key = process.env.MH_API_KEY ?? "";
    if (!key.startsWith("mh_test_")) throw new Error("devnet mode requires MH_API_KEY starting with mh_test_ (never a mh_live_ key)");
    api = new HttpMultiHopper(DEVNET_API, key);
    signer = await devnetSigner();
  } else if (mode === "mock") {
    api = new MockMultiHopper();
    signer = mockSigner();
  } else {
    throw new Error(`unknown mode "${mode}" (mock | devnet; mainnet is intentionally not supported)`);
  }

  const payees = parsePayees(readFileSync(csvPath, "utf8"), token.decimals);
  const batches = toBatches(payees);
  console.log(`[${mode.toUpperCase()}] ${api.label}`);
  console.log(`${payees.length} payees -> ${batches.length} Multi-Send batch(es), campaign "${campaign}"`);

  const rows = ["mode,transferId,externalId,status,wallet,amount,payoutSignature,paidAt"];
  for (const b of batches) {
    console.log(`batch ${b.index}: ${b.destinations.length} wallets, ${fromRaw(b.totalRaw, token.decimals)} ${token.symbol}`);
    const t = await sendBatch(api, signer, b);
    for (const d of t.destinations ?? []) {
      rows.push([mode, t.id, t.externalId ?? "", t.status, d.wallet, fromRaw(BigInt(d.amountRaw), token.decimals), d.payoutSignature ?? "", d.paidAt ?? ""].join(","));
    }
    console.log(`  final: ${t.status}`);
  }

  mkdirSync("out", { recursive: true });
  const out = `out/evidence-${mode}-${campaign}.csv`;
  writeFileSync(out, rows.join("\n") + "\n");
  console.log(`evidence written to ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
