// Hoproll prototype: CSV payout list -> MultiHopper Multi-Send batches -> evidence CSV.
//
//   node src/run.ts examples/payouts.csv                 (MOCK, default, offline)
//   node src/run.ts examples/payouts.csv --mode devnet   (needs MH_API_KEY=mh_test_... and DEVNET_KEYPAIR)
//   node src/run.ts payouts.csv --mode mainnet --quote-only   (needs MH_LIVE_KEY; quotes only, sends nothing)
//   node src/run.ts payouts.csv --mode mainnet   (real funds: MH_LIVE_KEY, MAINNET_KEYPAIR, MAINNET_MAX_SOL,
//                                                 then a typed confirmation in an interactive terminal)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parsePayees, toBatches, fromRaw } from "./payout.ts";
import { HttpMultiHopper, type MultiHopperApi, type PreparedTxs, type Transfer } from "./client.ts";
import { MockMultiHopper } from "./mock.ts";

const DEVNET_API = "https://devnet.multihopper.com/api/v1";
const DEVNET_RPC = "https://api.devnet.solana.com";
const MAINNET_API = "https://multihopper.com/api/v1";
const WSOL = "So11111111111111111111111111111111111111112";

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--")) ?? "examples/payouts.csv";
const mode = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "mock";
const quoteOnly = args.includes("--quote-only");
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

async function keypairSigner(path: string | undefined, rpc: string, envName: string): Promise<Signer & { balanceLamports(): Promise<number> }> {
  if (!path) throw new Error(`set ${envName} to a keypair JSON file`);
  const web3 = await import("@solana/web3.js");
  const kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const conn = new web3.Connection(rpc, "confirmed");
  return {
    owner: kp.publicKey.toBase58(),
    balanceLamports: () => conn.getBalance(kp.publicKey),
    async signAndSend(txs) {
      const sigs: string[] = [];
      for (const t of txs) {
        const b64 = b64Of(t);
        if (!b64) continue;
        // Docs: orchestratorInitTx is a legacy Transaction, everything else a VersionedTransaction.
        // Only the parse is guarded; send and confirm errors must surface, never fall through silently.
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
        const sig = await conn.sendRawTransaction(raw, { maxRetries: 5 });
        const res = await conn.confirmTransaction(sig, "confirmed");
        if (res.value.err) throw new Error(`transaction ${sig} failed on chain: ${JSON.stringify(res.value.err)}`);
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
  if (keeperFundingSignature) await api.confirmBroadcast(String(created.id), { keeperFundingSignature, routeInitSignatures: [] });
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
  // Docs ask for a short pause after route-init and orchestrator-init so the accounts are visible.
  const pause = () => new Promise((r) => setTimeout(r, mode === "mock" ? 0 : 3_000));
  const routeInitSignatures = await signer.signAndSend((p.routeInitTxs ?? []) as PreparedTx[]);
  await pause();
  const [orchestratorInitSignature] = await signer.signAndSend([p.orchestratorInitTx as PreparedTx]);
  await pause();
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
    signer = await keypairSigner(process.env.DEVNET_KEYPAIR, DEVNET_RPC, "DEVNET_KEYPAIR");
  } else if (mode === "mainnet") {
    const key = process.env.MH_LIVE_KEY ?? "";
    if (!key.startsWith("mh_live_")) throw new Error("mainnet mode requires MH_LIVE_KEY starting with mh_live_");
    api = new HttpMultiHopper(MAINNET_API, key);
    signer = quoteOnly ? mockSigner() : await keypairSigner(process.env.MAINNET_KEYPAIR, process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com", "MAINNET_KEYPAIR");
  } else if (mode === "mock") {
    api = new MockMultiHopper();
    signer = mockSigner();
  } else {
    throw new Error(`unknown mode "${mode}" (mock | devnet | mainnet)`);
  }

  const payees = parsePayees(readFileSync(csvPath, "utf8"), token.decimals);
  const batches = toBatches(payees);
  console.log(`[${mode.toUpperCase()}] ${api.label}`);
  console.log(`${payees.length} payees -> ${batches.length} Multi-Send batch(es), campaign "${campaign}"`);

  if (mode === "mainnet") {
    await mainnetPreflight(api, signer, batches);
    if (quoteOnly) return;
  }

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

// Real funds: quote every batch, check the cap and the balance, then require the operator to type the total.
async function mainnetPreflight(api: MultiHopperApi, signer: Signer, batches: ReturnType<typeof toBatches>) {
  const total = batches.reduce((s, b) => s + b.totalRaw, 0n);
  let upFront = 0n;
  for (const b of batches) {
    const est = (await api.estimate({ tokenMint: token.mint, amountRaw: b.totalRaw.toString(), tokenDecimals: token.decimals, hops, destinationCount: b.destinations.length })) as { percentFeeRaw?: string; sol?: { requiredSolUpFrontLamports?: number } };
    upFront += BigInt(est.sol?.requiredSolUpFrontLamports ?? 0);
    console.log(`  quote batch ${b.index}: ${b.destinations.length} wallets, ${fromRaw(b.totalRaw, 9)} SOL, fee ${fromRaw(BigInt(est.percentFeeRaw ?? "0"), 9)} SOL, up-front ${fromRaw(BigInt(est.sol?.requiredSolUpFrontLamports ?? 0), 9)} SOL`);
  }
  console.log(`MAINNET total ${fromRaw(total, 9)} SOL, required up-front about ${fromRaw(upFront, 9)} SOL`);
  if (quoteOnly) return;

  const cap = process.env.MAINNET_MAX_SOL;
  if (!cap) throw new Error("set MAINNET_MAX_SOL (spending cap in SOL) before a mainnet run");
  const capRaw = BigInt(Math.round(Number(cap) * 1e9));
  if (total > capRaw) throw new Error(`total ${fromRaw(total, 9)} SOL exceeds MAINNET_MAX_SOL=${cap}; nothing was sent`);
  const bal = BigInt(await (signer as Signer & { balanceLamports(): Promise<number> }).balanceLamports());
  if (bal < upFront) throw new Error(`treasury ${signer.owner} holds ${fromRaw(bal, 9)} SOL, needs about ${fromRaw(upFront, 9)} SOL; nothing was sent`);
  if (!process.stdin.isTTY) throw new Error("mainnet sends need an interactive terminal for the confirmation; nothing was sent");

  const expected = `SEND ${fromRaw(total, 9)}`;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`From ${signer.owner}. Type "${expected}" to send real SOL, anything else cancels: `)).trim();
  rl.close();
  if (answer !== expected) throw new Error("cancelled; nothing was sent");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1; // process.exit() can abort on Windows while fetch sockets close
});
