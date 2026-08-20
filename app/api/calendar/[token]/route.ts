import { db } from "@/lib/prisma";
import { distributedToStudent } from "@/lib/assignments/scope";
import { dueDateEvent } from "@/lib/calendar/due-dates";
import { buildDueDateCalendar } from "@/lib/calendar/ics";

/**
 * A student's due dates, as a calendar feed.
 *
 * **Why a route handler and not a procedure.** Google Calendar fetches this on its own schedule
 * from its own servers. It sends no cookie, it speaks no tRPC, and it wants `text/calendar` rather
 * than JSON. So the token in the path is the whole of the authorization, and the response is a
 * document rather than a payload.
 *
 * It is reachable without a session already: `lib/supabase/proxy.ts` excludes `/api` from the
 * sign-in redirect for the GitHub webhook's sake, so a request with no cookie passes through
 * instead of being answered with an HTML login page — which is what a calendar would then try to
 * parse as a calendar.
 *
 * **What it may say.** Titles, cohorts, deadlines, and a link back into the application. Never a
 * score, never a status, never whether the work was handed in. The address is a credential a
 * student may paste into a shared calendar, forward, or lose, and a leaked deadline is an
 * inconvenience where a leaked grade is not. That rule is kept by what is selected below rather
 * than by what the builder is asked to print.
 *
 * **No rate limit, deliberately.** The handler does one indexed lookup and one query, and the token
 * is 122 bits of randomness, so guessing is not a threat worth spending anything on.
 * `lib/audit/rate-limit.ts` exists for the operations that cost money, and this one costs a query.
 */

/** 32 hexadecimal characters, which is what `newJoinToken` produces. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Terse on purpose. A message explaining which part of a guess was wrong is a message that helps
 * somebody probe the endpoint, and there is nobody on the other end of this who would read it —
 * a calendar application shows its user "could not fetch" whatever the body says.
 */
function notFound(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Checked before the database is touched, so a crawler pulling on this path costs a regular
  // expression rather than a query.
  if (!TOKEN_PATTERN.test(token)) return notFound();

  const profile = await db.profile.findUnique({
    where: { calendarToken: token },
    select: { id: true },
  });

  // A replaced token lands here too, which is what "replacing the link" is for: the old address
  // stops working the moment a new one is written.
  if (!profile) return notFound();

  const assignments = await db.assignment.findMany({
    where: {
      ...distributedToStudent(profile.id),
      // Work with no deadline is not a calendar entry. It is still on the student's dashboard.
      dueAt: { not: null },
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      courseId: true,
      updatedAt: true,
      course: { select: { name: true } },
    },
    // Only so the document reads sensibly to a person opening the raw file. A calendar sorts by
    // date itself and does not care what order the events arrive in.
    orderBy: [{ dueAt: "asc" }, { title: "asc" }],
  });

  /*
    The host the request actually arrived on, so a link in the feed opens on the deployment the
    student subscribed from. This is the one thing the handler contributes to an event — and note
    that the UID deliberately does *not* come from here, for the reason `UID_DOMAIN` gives.
  */
  const origin = new URL(request.url).origin;

  // Read once so every DTSTAMP in one document agrees.
  const now = new Date();

  const body = buildDueDateCalendar({
    events: assignments.map((assignment) =>
      dueDateEvent({
        // `dueAt` is non-null by the query above; the column is nullable, so this is where the
        // narrowing happens rather than inside the pure module, which should not have to know.
        assignment: { ...assignment, dueAt: assignment.dueAt! },
        origin,
      }),
    ),
    now,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      /*
        **No `Content-Disposition`, deliberately.** That header describes a file to save, and this is
        a feed to poll — the two are the difference between subscribing and importing, and an import
        copies today's deadlines once and then never changes. Advertising a filename put the wrong
        path in front of the first person to try this: the browser offered the `.ics` file, and
        importing it looked like success while producing a calendar that would never update again.
      */
      /*
        No caching anywhere. A calendar polls this roughly daily on its own, so there is no load to
        relieve, and a cached copy would only add to the delay before a moved deadline reaches
        somebody — which is already this feature's one real limit.
      */
      "Cache-Control": "no-store",
    },
  });
}
