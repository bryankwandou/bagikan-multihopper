// Verifies x-multihopper-signature: hex HMAC-SHA256 of the raw body with the endpoint secret.

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(rawBody: string | Buffer, signatureHex: string | undefined, secret: string): boolean {
  if (!signatureHex) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signatureHex, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
