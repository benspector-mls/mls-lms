import crypto from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { syncCurriculum } from "@/lib/lessons/sync";
import { db } from "@/lib/prisma";

/**
 * The lesson sync for every curriculum, invoked every 15 minutes by the Vercel cron in
 * `vercel.json`.
 *
 * Every 15 minutes because an author who pushes a correction expects fellows to see it within the
 * class period, and a run with nothing changed costs about four requests to GitHub per curriculum.
 * The cron runs at 10, 25, 40 and 55 minutes past the hour, which keeps each run from starting at
 * the same moment as the notifications cron on the hour. An admin who cannot wait presses "Sync
 * now" on Admin → Lessons, which runs the same function for one curriculum.
 *
 * **One curriculum at a time, and one failing does not stop the rest.** A curriculum whose
 * repository was renamed should not leave every other course's lessons behind.
 *
 * **The bearer check below is the whole of the authorization**, as in
 * `app/api/cron/notifications/route.ts`, which explains why: `/api` is outside the sign-in
 * redirect, and Vercel sends `Authorization: Bearer <CRON_SECRET>` with every cron invocation.
 *
 * The problems the run finds are written to the function log, because nobody is watching this
 * request. The next "Sync now" shows them to an admin.
 */

function refused(status: number): NextResponse {
  return NextResponse.json({ error: "refused" }, { status });
}

function authorized(header: string | null, secret: string): boolean {
  const expected = crypto.createHash("sha256").update(`Bearer ${secret}`).digest();
  const presented = crypto
    .createHash("sha256")
    .update(header ?? "")
    .digest();
  return crypto.timingSafeEqual(expected, presented);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return refused(503);
  if (!authorized(request.headers.get("authorization"), secret)) return refused(401);

  const curricula = await db.curriculum.findMany({
    select: { id: true, name: true, repo: true, ref: true },
    orderBy: { createdAt: "asc" },
  });

  const results = [];
  for (const curriculum of curricula) {
    try {
      const result = await syncCurriculum(db, curriculum);
      if (result.problems.length > 0) {
        console.warn(`Lesson sync found problems in ${curriculum.name}`, result.problems);
      }
      results.push({
        curriculum: curriculum.name,
        commitSha: result.commitSha,
        lessons: result.lessons,
        changed: result.changed,
        removed: result.removed,
        problems: result.problems.length,
      });
    } catch (err) {
      console.error(`Lesson sync failed for ${curriculum.name}`, err);
      results.push({ curriculum: curriculum.name, failed: true });
    }
  }

  return NextResponse.json({ results });
}
