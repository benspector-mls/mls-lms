import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertTeaches, enrollmentsIn } from "@/lib/courses/membership";
import { groupSelectionInput, parseGroupSelection } from "@/lib/courses/groups";
import { dateColumnFor, schoolDayFromColumn, schoolDaySchema } from "@/lib/school-time";

import { createTRPCRouter, courseProcedure, instructorProcedure, profileProcedure } from "../init";
import { personSelect } from "../selects";

/**
 * The General Coding Framework: CodeSignal results, recorded against a person.
 *
 * **Nothing here is coursework, and no procedure in this file touches a submission.** A GCF result
 * arrives from outside the application entirely — there is no assignment behind it, nothing was
 * handed in, and nothing was graded. That is why the rows are keyed on a `Profile` rather than an
 * enrollment and carry no course: a result follows a fellow through the program, and CodeSignal
 * has no idea what a cohort is.
 *
 * Which makes the authorization here a different shape from every other router. There is no
 * course on the row to gate on, so:
 *
 * - **reading a cohort's results** gates on the *course* named in the input and then narrows to
 *   the students enrolled in it, so an instructor sees the fellows they teach and nobody else;
 * - **reading your own** takes no student id at all — `mine` is scoped to `ctx.profile.id`, which
 *   is what makes pointing it at somebody else impossible rather than merely refused;
 * - **writing** gates on a course the caller teaches *and* checks the student is enrolled in it,
 *   because a bare `studentId` would otherwise let any instructor write a score onto any person
 *   in the deployment.
 *
 * Prisma connects as the table owner and is not restricted by row level security, so every one of
 * those checks is made here explicitly and none of them is the database's job.
 */

/** Everything a screen draws an attempt from. */
const attemptFields = {
  id: true,
  studentId: true,
  kind: true,
  score: true,
  scorePossible: true,
  takenOn: true,
  integrityFlagged: true,
  note: true,
  resultUrl: true,
  externalId: true,
  createdAt: true,
} as const;

/**
 * A day, as `YYYY-MM-DD`, and the pair of conversions around it.
 *
 * From `lib/school-time.ts` rather than written again here, because a `@db.Date` is the one shape
 * in this application that reliably goes wrong: Postgres stores a civil date with no zone, Prisma
 * hands it back as UTC midnight, and reading or formatting that in Brooklyn time gives the
 * previous day. That module holds both dangerous conversions so there is one of each.
 *
 * A string rather than a `Date` all the way in, because what identifies an attempt is the day.
 * Accepting an instant would make the answer depend on the sender's offset: an attempt submitted
 * at nine in the evening in New York is already tomorrow in UTC, and the row it merges with would
 * change with the clock.
 */
const dayInput = schoolDaySchema;

const asDay = dateColumnFor;

const kindInput = z.enum(["PROCTORED", "MOCK"]);

/**
 * One row of a parsed export, as the browser sends it.
 *
 * Validated here in full even though `lib/gcf/import.ts` produced it, because the browser parsed
 * the file: what arrives is whatever the page chose to send, and the reader running there decides
 * what to *show* rather than what is true. `.strict()` so a field somebody adds to the parser and
 * forgets here is a loud failure rather than a column quietly dropped.
 */
const importRowInput = z
  .object({
    externalId: z.string().max(200),
    email: z.string().max(320),
    fullName: z.string().max(200),
    kind: kindInput,
    score: z.number().int().min(0).max(10_000),
    scorePossible: z.number().int().min(1).max(10_000).nullable(),
    takenOn: dayInput,
    assessmentName: z.string().max(500),
    integrityFlagged: z.boolean(),
    resultUrl: z.string().max(2000).nullable(),
  })
  .strict();

/** How many rows one upload may carry. A term's export is 274; this is room without being a hole. */
const MAX_IMPORT_ROWS = 5000;

export const gcfRouter = createTRPCRouter({
  /**
   * Every attempt by the students of one cohort.
   *
   * Narrowed to the enrollments of the named course — and to a group where one is chosen, the
   * same way the gradebook is — so the tab lists the fellows an instructor teaches. A student who
   * has never sat one simply has no rows, and the tab renders that as a row of dashes rather than
   * omitting them: "has not sat it" is the thing an instructor most needs to see.
   */
  forCourse: courseProcedure
    .input(z.object({ group: groupSelectionInput.default("all") }))
    .query(async ({ ctx, input }) => {
      const selection = parseGroupSelection(input.group);

      const enrollments = await ctx.db.enrollment.findMany({
        where: enrollmentsIn(input.courseId, selection),
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        select: { status: true, student: { select: personSelect } },
      });

      const studentIds = enrollments.map((enrollment) => enrollment.student.id);

      /*
        Attempts for exactly those students. Without the narrowing this would be every GCF result
        in the deployment — the rows carry no course, so there is nothing else stopping it.
      */
      const attempts = studentIds.length
        ? await ctx.db.gcfAttempt.findMany({
            where: { studentId: { in: studentIds } },
            orderBy: [{ takenOn: "desc" }],
            select: attemptFields,
          })
        : [];

      return {
        /*
          Active and everything else, as complements rather than two filters naming values —
          the same reason the gradebook partitions this way. A third status added later lands in
          one of the two rather than vanishing from both.
        */
        activeStudents: enrollments
          .filter((enrollment) => enrollment.status === "ACTIVE")
          .map((enrollment) => enrollment.student),
        removedStudents: enrollments
          .filter((enrollment) => enrollment.status !== "ACTIVE")
          .map((enrollment) => enrollment.student),
        attempts,
      };
    }),

  /**
   * The caller's own attempts, across every cohort they have ever been in.
   *
   * **Takes no student id**, which is the whole of its access control: there is no argument that
   * could name somebody else, so there is no check that could be forgotten. The same reason
   * `/gcf` is a top-level page rather than a course-scoped one — a GCF record follows a person.
   */
  mine: profileProcedure.query(async ({ ctx }) => {
    return ctx.db.gcfAttempt.findMany({
      where: { studentId: ctx.profile.id },
      orderBy: [{ takenOn: "desc" }],
      select: attemptFields,
    });
  }),

  /**
   * What an uploaded export would do, before it does it.
   *
   * Resolves each row to a student and reports what it could not, so an instructor sees the whole
   * outcome — matched, unmatched, and already recorded — while it is still a preview. Nothing is
   * written.
   *
   * Matching is by address, lowercased: first against `GcfIdentity`, which is where a previously
   * resolved address is remembered, then against the profile's own email. Most rows match on the
   * second, because a fellow signs up to CodeSignal with the address they use for GitHub.
   */
  previewImport: courseProcedure
    .input(z.object({ rows: z.array(importRowInput).max(MAX_IMPORT_ROWS) }))
    .query(async ({ ctx, input }) => {
      const enrollments = await ctx.db.enrollment.findMany({
        where: { courseId: input.courseId, status: "ACTIVE" },
        select: { student: { select: personSelect } },
      });
      const students = enrollments.map((enrollment) => enrollment.student);
      const enrolled = new Set(students.map((student) => student.id));

      const emails = [...new Set(input.rows.map((row) => row.email.toLowerCase()))];

      const [identities, profiles] = await Promise.all([
        ctx.db.gcfIdentity.findMany({
          where: { email: { in: emails } },
          select: { email: true, studentId: true },
        }),
        ctx.db.profile.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true },
        }),
      ]);

      const byEmail = new Map<string, string>();
      // Profiles first, then identities, so a remembered mapping wins over the account address.
      for (const profile of profiles) {
        if (profile.email) byEmail.set(profile.email.toLowerCase(), profile.id);
      }
      for (const identity of identities) byEmail.set(identity.email, identity.studentId);

      /*
        Which attempts are already recorded, so the preview can say "this updates" rather than
        implying every row is new. Read on the same triple the write upserts on, so the count a
        reader is shown is the count that will actually be updated.
      */
      const existing = await ctx.db.gcfAttempt.findMany({
        where: {
          studentId: { in: [...enrolled] },
          takenOn: { in: input.rows.map((row) => asDay(row.takenOn)) },
        },
        select: { studentId: true, kind: true, takenOn: true },
      });
      const already = new Set(
        existing.map((row) => `${row.studentId}:${row.kind}:${schoolDayFromColumn(row.takenOn)}`),
      );

      const resolved = input.rows.map((row) => {
        const studentId = byEmail.get(row.email.toLowerCase()) ?? null;

        return {
          ...row,
          /*
            Matched only when the person is also *in this cohort*. An address belonging to a
            fellow from another course resolves to a real profile, and writing their score from
            here would be an instructor recording against somebody they do not teach.
          */
          studentId: studentId !== null && enrolled.has(studentId) ? studentId : null,
          knownElsewhere: studentId !== null && !enrolled.has(studentId),
          updates: studentId !== null && already.has(`${studentId}:${row.kind}:${row.takenOn}`),
        };
      });

      return {
        rows: resolved,
        /** The cohort, so the screen can offer a student for a row that matched nobody. */
        students,
        matched: resolved.filter((row) => row.studentId !== null).length,
        unmatched: resolved.filter((row) => row.studentId === null).length,
        updates: resolved.filter((row) => row.updates).length,
      };
    }),

  /**
   * Writes an import, and remembers the addresses a person resolved by hand.
   *
   * `assignments` maps an email to the student somebody chose for it on the preview screen. Each
   * one becomes a `GcfIdentity`, so the next upload matches without asking again — which is the
   * whole mechanism: no setup before the first import, and the mapping fills itself in as it is
   * used.
   *
   * Upserted on the day an attempt happened rather than on CodeSignal's session id, so re-running
   * the same file changes nothing and a score an instructor typed in beforehand is filled in
   * rather than doubled.
   */
  commitImport: courseProcedure
    .input(
      z.object({
        rows: z.array(importRowInput).max(MAX_IMPORT_ROWS),
        /** Email to student id, for the rows a person resolved on the preview. */
        assignments: z.array(
          z.object({ email: z.string().max(320), studentId: z.string().uuid() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const enrollments = await ctx.db.enrollment.findMany({
        where: { courseId: input.courseId, status: "ACTIVE" },
        select: { studentId: true },
      });
      const enrolled = new Set(enrollments.map((enrollment) => enrollment.studentId));

      /*
        Every hand-made assignment has to name somebody in this cohort. Checked here and not only
        on the preview, because the browser chose these ids: without it, an instructor could write
        a GCF score onto any profile in the deployment by editing one request.
      */
      for (const assignment of input.assignments) {
        if (!enrolled.has(assignment.studentId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "One of those students is not in this cohort.",
          });
        }
      }

      const chosen = new Map(
        input.assignments.map((a) => [a.email.trim().toLowerCase(), a.studentId]),
      );

      const emails = [...new Set(input.rows.map((row) => row.email.toLowerCase()))];
      const [identities, profiles] = await Promise.all([
        ctx.db.gcfIdentity.findMany({
          where: { email: { in: emails } },
          select: { email: true, studentId: true },
        }),
        ctx.db.profile.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true },
        }),
      ]);

      const byEmail = new Map<string, string>();
      for (const profile of profiles) {
        if (profile.email) byEmail.set(profile.email.toLowerCase(), profile.id);
      }
      for (const identity of identities) byEmail.set(identity.email, identity.studentId);
      for (const [email, studentId] of chosen) byEmail.set(email, studentId);

      let written = 0;
      let skipped = 0;

      await ctx.db.$transaction(async (tx) => {
        // Remembered first, so a failure part way through does not leave scores written under a
        // mapping nobody kept.
        for (const [email, studentId] of chosen) {
          await tx.gcfIdentity.upsert({
            where: { email },
            create: { email, studentId },
            update: { studentId },
          });
        }

        for (const row of input.rows) {
          const studentId = byEmail.get(row.email.toLowerCase());
          if (!studentId || !enrolled.has(studentId)) {
            skipped += 1;
            continue;
          }

          const shared = {
            score: row.score,
            scorePossible: row.scorePossible,
            integrityFlagged: row.integrityFlagged,
            externalId: row.externalId || null,
            resultUrl: row.resultUrl,
          };

          await tx.gcfAttempt.upsert({
            where: {
              studentId_kind_takenOn: {
                studentId,
                kind: row.kind,
                takenOn: asDay(row.takenOn),
              },
            },
            create: { studentId, kind: row.kind, takenOn: asDay(row.takenOn), ...shared },
            /*
              The note is deliberately absent. An instructor's explanation of a flag is the one
              thing on the row a person wrote, and a re-import must not wipe it.
            */
            update: shared,
          });
          written += 1;
        }
      });

      return { written, skipped, remembered: chosen.size };
    }),

  /**
   * One attempt, entered by hand.
   *
   * Exists for the score that arrives outside an export, and for the first one that is wrong.
   * Upserted on the same triple the import uses, so entering an attempt the export later carries
   * updates that row rather than creating a second record of one morning.
   */
  record: courseProcedure
    .input(
      z.object({
        studentId: z.string().uuid(),
        kind: kindInput,
        score: z.number().int().min(0).max(10_000),
        scorePossible: z.number().int().min(1).max(10_000).nullable(),
        takenOn: dayInput,
        integrityFlagged: z.boolean().default(false),
        note: z.string().trim().max(2000).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEnrolled(ctx, input.courseId, input.studentId);

      const { courseId: _courseId, studentId, kind, takenOn, ...rest } = input;
      void _courseId;

      return ctx.db.gcfAttempt.upsert({
        where: { studentId_kind_takenOn: { studentId, kind, takenOn: asDay(takenOn) } },
        create: {
          studentId,
          kind,
          takenOn: asDay(takenOn),
          ...rest,
          recordedById: ctx.profile.id,
        },
        update: { ...rest, recordedById: ctx.profile.id },
        select: attemptFields,
      });
    }),

  /**
   * Editing one: its score, and the note explaining a flag.
   *
   * The note is why this is separate from `record` rather than folded into it. A flag arrives from
   * CodeSignal with no account of itself, and the fellow sees it on their own page — so an
   * instructor writing what it was about is the thing that turns a mark on somebody's record into
   * something they can ask about.
   */
  update: instructorProcedure
    .input(
      z.object({
        attemptId: z.string().uuid(),
        score: z.number().int().min(0).max(10_000).optional(),
        note: z.string().trim().max(2000).nullable().optional(),
        integrityFlagged: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { attemptId, ...changes } = input;
      await assertTeachesTheStudent(ctx, attemptId);

      return ctx.db.gcfAttempt.update({
        where: { id: attemptId },
        data: { ...changes, recordedById: ctx.profile.id },
        select: attemptFields,
      });
    }),

  /** Removing one, for a row that should never have been recorded. */
  remove: instructorProcedure
    .input(z.object({ attemptId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTeachesTheStudent(ctx, input.attemptId);

      return ctx.db.gcfAttempt.delete({
        where: { id: input.attemptId },
        select: { id: true, kind: true, takenOn: true },
      });
    }),
});

type Ctx = Parameters<Parameters<typeof instructorProcedure.mutation>[0]>[0]["ctx"];

/**
 * Refuses unless this student is in this course.
 *
 * The check `courseProcedure` cannot make. It gates on the course, which stops somebody writing
 * into a cohort they do not teach — but the student id is a separate argument naming any profile
 * in the deployment, and nothing about teaching a course says anything about that person.
 */
async function assertEnrolled(ctx: Ctx, courseId: string, studentId: string): Promise<void> {
  const enrollment = await ctx.db.enrollment.findFirst({
    where: { courseId, studentId },
    select: { id: true },
  });

  if (!enrollment) {
    throw new TRPCError({ code: "FORBIDDEN", message: "That student is not in this course." });
  }
}

/**
 * Refuses unless the caller teaches some course this attempt's student is enrolled in.
 *
 * An attempt carries no course, so there is nothing on the row to gate on — the question has to
 * be asked of the person instead. This is the loosest defensible reading and it is stated rather
 * than assumed: an instructor may edit an attempt belonging to somebody they teach *anywhere*,
 * which is right because the attempt itself belongs to no cohort. An admin passes on the role.
 */
async function assertTeachesTheStudent(ctx: Ctx, attemptId: string): Promise<void> {
  const attempt = await ctx.db.gcfAttempt.findUnique({
    where: { id: attemptId },
    select: { studentId: true },
  });

  if (!attempt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That attempt no longer exists." });
  }

  if (ctx.profile.role === "ADMIN") return;

  const shared = await ctx.db.enrollment.findFirst({
    where: {
      studentId: attempt.studentId,
      course: { instructors: { some: { userId: ctx.profile.id } } },
    },
    select: { courseId: true },
  });

  if (!shared) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not teach a course this student is in.",
    });
  }

  await assertTeaches(ctx, shared.courseId);
}
