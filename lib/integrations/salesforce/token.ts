import { createHash, timingSafeEqual } from "node:crypto";

const SCHEME = "Bearer ";

/**
 * Whether a request presented the feed's token.
 *
 * **Compared over digests, not over the strings.** `timingSafeEqual` refuses buffers of unequal
 * length by throwing, and a caller who sends a short token must be answered with a 401 rather than
 * a stack trace. Hashing both sides first makes the two buffers the same length whatever was sent,
 * and the comparison stays constant-time in the length that matters.
 *
 * **An empty expected value refuses everything.** That is what an unset `SALESFORCE_FEED_TOKEN`
 * becomes, and failing closed is the only acceptable way for a missing secret to fail. Without
 * this line, `Bearer ` with nothing after it would hash equal to an empty expected value and be
 * let in.
 */
export function bearerTokenMatches(authorization: string | null, expected: string): boolean {
  if (expected === "") return false;
  if (authorization === null || !authorization.startsWith(SCHEME)) return false;

  const presented = authorization.slice(SCHEME.length);
  return timingSafeEqual(digest(presented), digest(expected));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
