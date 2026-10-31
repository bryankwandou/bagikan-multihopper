import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parsePayees, toBatches, toRaw, fromRaw } from "../src/payout.ts";
import { verifyWebhook } from "../src/webhook.ts";

const W = (c: string) => c.repeat(44);

test("amount conversion round-trips", () => {
  assert.equal(toRaw("1.5", 9), 1_500_000_000n);
  assert.equal(fromRaw(1_500_000_000n, 9), "1.5");
  assert.throws(() => toRaw("0.0000000001", 9));
});

test("duplicate wallets merge, batches cap at 20 and sum exactly", () => {
  const csv = ["wallet,amount", `${W("A")},1`, `${W("A")},2`, ...Array.from({ length: 24 }, (_, i) => `${W("B").slice(0, 43)}${"CDEFGHJKLMNPQRSTUVWXYZabcd"[i]},0.1`)].join("\n");
  const payees = parsePayees(csv, 9);
  assert.equal(payees.length, 25);
  assert.equal(payees[0].amountRaw, 3_000_000_000n);
  const batches = toBatches(payees);
  assert.deepEqual(batches.map((b) => b.destinations.length), [20, 5]);
  for (const b of batches) assert.equal(b.destinations.reduce((s, d) => s + BigInt(d.amountRaw), 0n), b.totalRaw);
});

test("rejects bad address", () => {
  assert.throws(() => parsePayees("not-a-wallet,1", 9), /invalid Solana address/);
});

test("webhook signature", () => {
  const body = '{"event":"transfer.completed"}';
  const sig = createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(verifyWebhook(body, sig, "s3cret"), true);
  assert.equal(verifyWebhook(body, sig, "wrong"), false);
  assert.equal(verifyWebhook(body, undefined, "s3cret"), false);
});
