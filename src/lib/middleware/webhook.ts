import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function verifyGitHubSignature(input: {
  rawBody: string | Buffer;
  signatureHeader: string | null;
  secret: string;
}): boolean {
  const signature = input.signatureHeader?.trim() ?? "";
  if (!signature.startsWith(SIGNATURE_PREFIX)) return false;

  const expectedHex = createHmac("sha256", input.secret)
    .update(input.rawBody)
    .digest("hex");
  const actualHex = signature.slice(SIGNATURE_PREFIX.length);

  if (!/^[a-f0-9]{64}$/i.test(actualHex)) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
