import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies GitHub's `X-Hub-Signature-256` header against the raw request body.
 *
 * The body must be the exact bytes GitHub sent. Parsing the JSON and
 * re-serializing it changes the bytes and the signature will not match, so the
 * caller must use `await request.text()` and pass that string here before
 * parsing it.
 *
 * Uses timingSafeEqual rather than `===` so that the comparison takes the same
 * amount of time regardless of where two signatures first differ. A plain
 * comparison returns faster on an early mismatch, which leaks information about
 * the expected value to an attacker who can measure response times.
 */
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  // timingSafeEqual throws if the lengths differ, so this check is required
  // before calling it. Length alone reveals nothing useful.
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
