/**
 * The calendar feed: the token, the route, and what the route will and will not say.
 *
 *   npm run verify:calendar
 *
 * The format itself is covered by `tests/lib/calendar/` — escaping, folding, the half-hour block,
 * the stable UID — and none of that is repeated here. What a Jest case cannot reach is everything
 * this file is about: whether the route answers at all without a session, whether its headers are
 * the ones a calendar application needs, and above all **whether the feed shows exactly the work
 * `assignments.listMine` shows and not one row more**. Prisma is not restricted by row level
 * security, so the `where` clause the two share is the only thing standing between one student's
 * feed and another's deadlines.
 *
 * **It needs the application running**, because the point is to fetch the address a student would
 * paste into Google Calendar. `npm run dev` in another terminal, or `--base=<url>` for a deployment.
 *
 * Two things it writes, and both are put back.
 *
 * **It rotates a real person's token.** Generating an address is the only way to reach the route,
 * and doing it to a student who has already subscribed would silently break their subscription — so
 * the prior value is restored in a `finally`, including when a check fails partway through. A test
 * student is preferred as the fixture for the same reason, and used when the cohort has one.
 *
 * **It creates one assignment and deletes it.** The exclusion of unpublished work is the most
 * consequential rule here and the seeded data does not happen to exercise it, so rather than skip
 * the check the script makes the row it needs: unpublished with a deadline, then published, so the
 * same row is checked for absence and then for presence. A negative check on its own cannot tell
 * "the rule works" from "the row was never there".
 */
import { createChecker, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

/** Where the application is answering. A deployment works as well as a local dev server. */
const BASE =
  process.argv.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ??
  process.env.APP_URL ??
  "http://localhost:3000";

/** 32 hexadecimal characters, which is what `newJoinToken` produces and the route insists on. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/**
 * What a parser sees: the folded lines joined back up.
 *
 * Every check about *content* below reads this rather than the raw body. A `URL` line for a real
 * assignment is about 118 octets, so it is folded across two physical lines — and a check that
 * searched the raw text for a whole address would fail on a feed that is perfectly correct. Found
 * exactly that way.
 */
const unfold = (body: string) => body.replace(/\r\n /g, "");

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { formatSchoolTime } = await import("../lib/school-time");
  const { UID_DOMAIN } = await import("../lib/calendar/due-dates");

  const createCaller = createCallerFactory(appRouter);
  const as = (userId: string) => createCaller({ db, user: { id: userId } } as never);

  /** The feed as a parser would read it, plus the response it came in. */
  const fetchFeed = async (token: string) => {
    const response = await fetch(`${BASE}/api/calendar/${token}`);
    const raw = await response.text();
    return { response, raw, text: unfold(raw) };
  };

  /*
    Selected by having an active enrollment in a cohort that is still running, which is the property
    every check below actually needs — an account with the STUDENT role and no cohort would pass a
    role-based selection and then measure nothing. A test student first, because rotating its token
    and adding an assignment to its cohort cost nobody anything.
  */
  const fixtureSelect = {
    studentId: true,
    courseId: true,
    student: { select: { email: true, calendarToken: true } },
  } as const;

  const enrollment =
    (await db.enrollment.findFirst({
      where: {
        status: "ACTIVE",
        course: { archivedAt: null },
        student: { testStudentNumber: { not: null } },
      },
      select: fixtureSelect,
      orderBy: { createdAt: "asc" },
    })) ??
    (await db.enrollment.findFirst({
      where: { status: "ACTIVE", course: { archivedAt: null } },
      select: fixtureSelect,
      orderBy: { createdAt: "asc" },
    }));

  if (!enrollment) {
    skip("no active enrollment in a cohort that is still running");
    return finish();
  }

  // Is the application answering at all? Asked before anything is written, so a script run without
  // a dev server reports why rather than rotating a token and then failing every check.
  const reachable = await fetch(`${BASE}/api/calendar/notatoken`)
    .then(() => true)
    .catch(() => false);

  if (!reachable) {
    skip(`nothing is answering at ${BASE} — start the application, or pass --base=<url>`);
    return finish();
  }

  const student = as(enrollment.studentId);
  const priorToken = enrollment.student.calendarToken;

  /*
    Somewhere to hang the assignment this script creates. Any unit of the student's own cohort will
    do — what is being checked is `distributedAt`, and the unit only has to exist because an
    assignment cannot be created without one.
  */
  const unit = await db.courseUnit.findFirst({
    where: { courseId: enrollment.courseId },
    select: { id: true },
    orderBy: { position: "asc" },
  });

  /** Set once the row exists, so the `finally` knows whether there is anything to delete. */
  let createdAssignmentId: string | null = null;

  console.log(`Base     ${BASE}`);
  console.log(`Student  ${enrollment.student.email ?? enrollment.studentId}`);
  console.log(`Token    ${priorToken ? "had one already, will be restored" : "had none"}\n`);

  try {
    // --- the token ---------------------------------------------------------

    const before = await student.calendarSubscription();
    check("calendarSubscription agrees with the column", before.token, priorToken);

    const created = await student.newCalendarToken();
    checkThat(
      "newCalendarToken returns 32 hex characters",
      TOKEN_PATTERN.test(created.token ?? ""),
      created.token ?? "null",
    );

    const after = await student.calendarSubscription();
    check("the query then reports what the mutation wrote", after.token, created.token);

    const token = created.token!;

    // --- the response -----------------------------------------------------

    const feed = await fetchFeed(token);

    check("the feed answers 200 with no cookie at all", feed.response.status, 200);
    checkThat(
      "...as text/calendar",
      feed.response.headers.get("content-type")?.startsWith("text/calendar") === true,
      feed.response.headers.get("content-type") ?? "none",
    );
    checkThat(
      "...and is not cached anywhere",
      feed.response.headers.get("cache-control") === "no-store",
      feed.response.headers.get("cache-control") ?? "none",
    );
    checkThat(
      "...and offers a filename without forcing a download",
      feed.response.headers.get("content-disposition")?.startsWith("inline") === true,
      feed.response.headers.get("content-disposition") ?? "none",
    );

    checkThat(
      "the body is a calendar, opened and closed",
      feed.raw.startsWith("BEGIN:VCALENDAR\r\n") && feed.raw.endsWith("END:VCALENDAR\r\n"),
    );
    checkThat("every line ends CRLF", !feed.raw.replace(/\r\n/g, "").includes("\n"));
    checkThat(
      "no physical line exceeds the 75-octet limit",
      feed.raw.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75),
    );

    // --- the scoping, which is the point of the file ------------------------

    /*
      What the dashboard shows, filtered to the rows that are calendar entries at all. If the feed
      and `listMine` ever stop sharing `distributedToStudent`, this is the check that says so.
    */
    const dashboard = await student.assignments.listMine();
    const expected = dashboard.filter((row) => row.dueAt !== null);
    const uidsIn = (text: string) => [...text.matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim());

    check(
      "the feed holds one event per dated assignment the dashboard shows",
      uidsIn(feed.text).length,
      expected.length,
    );
    checkThat(
      "...and they are the same assignments",
      expected.every((row) => uidsIn(feed.text).includes(`${row.id}@${UID_DOMAIN}`)),
      `${expected.length} expected, ${uidsIn(feed.text).length} in the feed`,
    );

    if (expected.length === 0) {
      skip("the fixture student has no dated assignments, so the contents cannot be measured");
    } else {
      const soonest = expected[0];

      checkThat(
        "an event's title carries the deadline as an instructor set it",
        feed.text.includes(`Due at ${formatSchoolTime(soonest.dueAt!)}:`),
        `Due at ${formatSchoolTime(soonest.dueAt!)}`,
      );
      checkThat(
        "...and the cohort's name, so a student knows which class it is for",
        feed.text.includes(soonest.course.name),
        soonest.course.name,
      );
      checkThat(
        "...and a link back into the application",
        feed.text.includes(`URL:${BASE}/courses/${soonest.course.id}?assignment=${soonest.id}`),
      );
    }

    /*
      Everything the student must NOT see: work in a cohort they are not in, work in an archived
      cohort, work in a cohort they were removed from, and every other student's work. One query for
      all of it, because the answer is the same — an assignment id outside the expected set has no
      business appearing in the body.
    */
    const forbidden = await db.assignment.findMany({
      where: { id: { notIn: expected.map((row) => row.id) }, dueAt: { not: null } },
      select: { id: true, title: true },
      take: 500,
    });

    const leaked = forbidden.filter((row) => feed.text.includes(row.id));
    checkThat(
      "no assignment outside the caller's own dated work appears",
      leaked.length === 0,
      leaked.length > 0
        ? `leaked: ${leaked.map((row) => row.title).join(", ")}`
        : `${forbidden.length} other dated assignments checked`,
    );

    // --- unpublished work, on a row made for the purpose --------------------

    if (!unit) {
      skip("the fixture student's cohort has no unit to attach an assignment to");
    } else {
      const fixture = await db.assignment.create({
        data: {
          courseId: enrollment.courseId,
          courseUnitId: unit.id,
          title: "verify:calendar — a deadline nobody was given",
          pointValue: 10,
          dueAt: new Date("2099-12-31T23:59:00Z"),
          // The whole point of the row. Unpublished, in the student's own cohort, with a deadline —
          // so the only reason to leave it out of the feed is the rule being checked.
          distributedAt: null,
        },
        select: { id: true },
      });
      createdAssignmentId = fixture.id;

      const withDraft = await fetchFeed(token);
      checkThat(
        "an unpublished assignment in the student's own cohort stays out of the feed",
        !withDraft.text.includes(fixture.id),
      );

      /*
        The positive control, and the reason the row is created rather than merely looked for. On its
        own the check above cannot tell "unpublished work is excluded" from "that row was never
        going to appear anyway". Publishing the same row and finding it is what closes that.
      */
      await db.assignment.update({
        where: { id: fixture.id },
        data: { distributedAt: new Date() },
      });

      const withPublished = await fetchFeed(token);
      checkThat(
        "...and appears the moment it is published",
        withPublished.text.includes(fixture.id),
      );
      /*
        The half-hour block, end to end, on a real row rather than a fixture. The deadline above is
        23:59 UTC on the last day of 2099, so the block runs 23:30 to 00:00 and its end crosses into
        the next century — which is the same arithmetic an 11:59 PM deadline gets every day.
      */
      checkThat(
        "...as a half-hour block ending at the deadline's half hour",
        withPublished.text.includes("DTSTART:20991231T233000Z") &&
          withPublished.text.includes("DTEND:21000101T000000Z"),
      );
    }

    /*
      A grade must never be in here. The feed's address is a credential a student may paste into a
      shared calendar, so a leaked deadline is an inconvenience and a leaked grade is not.
    */
    const graded = await db.submission.findMany({
      where: { studentId: enrollment.studentId, finalScore: { not: null } },
      select: { finalScore: true, feedbackMarkdown: true },
      take: 50,
    });

    checkThat(
      "the feed declares no status and no category",
      !/^(STATUS|CATEGORIES):/m.test(feed.text),
    );
    checkThat(
      "no released feedback of this student's appears in the feed",
      graded.every((row) => {
        const opening = row.feedbackMarkdown?.slice(0, 40);
        return !opening || !feed.text.includes(opening);
      }),
      `${graded.length} graded submission(s) to check against`,
    );

    // --- what the route refuses -------------------------------------------

    check("a malformed token is not found", (await fetch(`${BASE}/api/calendar/nope`)).status, 404);
    check(
      "a well-formed token belonging to nobody is not found",
      (await fetch(`${BASE}/api/calendar/${"a".repeat(32)}`)).status,
      404,
    );
    check(
      "an upper-case rendering of a real token is not found",
      (await fetch(`${BASE}/api/calendar/${token.toUpperCase()}`)).status,
      404,
    );

    // Nothing anonymous may mint one. The two procedures are the only way an address is handed out.
    const anonymous = createCaller({ db, user: null } as never);
    check(
      "an unauthenticated caller cannot ask for a calendar address",
      await refusal(() => anonymous.newCalendarToken()),
      "UNAUTHORIZED",
    );

    // --- replacing it ------------------------------------------------------

    const replaced = await student.newCalendarToken();
    checkThat(
      "replacing gives a different address",
      replaced.token !== token,
      replaced.token ?? "",
    );
    check(
      "...the old address stops working immediately",
      (await fetch(`${BASE}/api/calendar/${token}`)).status,
      404,
    );
    check(
      "...and the new one works",
      (await fetch(`${BASE}/api/calendar/${replaced.token}`)).status,
      200,
    );
  } finally {
    /*
      Put everything back, including a null token. In a `finally` so a failed check above does not
      leave a real student holding an address they never asked for, or a cohort holding an
      assignment nobody authored.
    */
    if (createdAssignmentId) {
      await db.assignment.delete({ where: { id: createdAssignmentId } });
    }
    await db.profile.update({
      where: { id: enrollment.studentId },
      data: { calendarToken: priorToken },
    });
    console.log(
      `\nCleaned up: token restored (${priorToken ? "a value" : "null"})${
        createdAssignmentId ? ", fixture assignment deleted" : ""
      }.`,
    );
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
