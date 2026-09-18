import crypto from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { runDigests } from "@/lib/notifications/digest";
import { digestCadencesDue } from "@/lib/notifications/recipients";
import { sendDm } from "@/lib/slack/client";

/**
 * The digest sender, invoked hourly by the Vercel cron in `vercel.json`.
 *
 * Hourly rather than at one fixed UTC hour, because 9am in the school's timezone is a different
 * UTC hour for half the year — `digestCadencesDue` reads the school's wall clock and answers null
 * on the other twenty-three invocations, which cost one comparison each.
 *
 * **The bearer check below is the whole of the authorization.** `lib/supabase/proxy.ts` excludes
 * `/api` from the sign-in redirect, so this path is reachable with no cookie; Vercel attaches
 * `Authorization: Bearer <CRON_SECRET>` to cron invocations once that env var exists. Compared in
 * constant time through a hash, the discipline the webhook route's signature check follows —
 * hashing first is what makes two different-length strings comparable at all.
 *
 * A missed 9am invocation — a deploy in flight, say — delays digests by a day and loses nothing:
 * the watermark every digest reads from only advances when a digest actually goes out.
 */

/** Terse on purpose, like the calendar route's `notFound`: a message explaining which part of a
 *  guess was wrong is a message that helps somebody probe the endpoint. */
function refused(status: number): NextResponse {
  return NextResponse.json({ error: "refused" }, { status });
}

function authorized(header: string | null, secret: string): boolean {
  const expected = crypto.createHash("sha256").update(`Bearer ${secret}`).digest();
  const presented = crypto.createHash("sha256").update(header ?? "").digest();
  return crypto.timingSafeEqual(expected, presented);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return refused(503);
  if (!authorized(request.headers.get("authorization"), secret)) return refused(401);

  const now = new Date();
  const cadences = digestCadencesDue(now);
  if (!cadences) {
    return NextResponse.json({ skipped: "not the digest hour in school time" });
  }

  const counts = await runDigests(now, cadences, { send: sendDm });
  return NextResponse.json({ cadences, ...counts });
}
