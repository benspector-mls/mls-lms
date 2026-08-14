import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { auditActor, recordEvent } from "@/lib/audit/record";
import {
  claimRosterEntry,
  findRosterMatch,
  rosterApplies,
  rosterRefusal,
} from "@/lib/courses/roster";
import { MAX_ROSTER_PASTE, rosterEntrySchema } from "@/lib/courses/roster-input";
import { teachableEnrollment } from "@/lib/courses/scope";
import { inTransaction } from "@/lib/prisma";

import {
  type AuthedCtx,
  courseProcedure,
  createTRPCRouter,
  instructorProcedure,
  profileProcedure,
} from "../init";
import { displayNameOf, personNameSelect } from "../selects";

/**
 * Getting students into a course, and out of it.
 *
 * **One join link per course, and a list of who it works for.** An instructor writes down the
 * students they expect — by GitHub login, by address, or both — and then sends the link however
 * they already talk to them. This application holds no email credentials and sends nothing, which
 * is the reason the link is per course rather than per student: there is no point generating
 * twenty-five tokens when distributing them is a person's job either way.
 *
 * The two halves do different work and neither is enough alone. The link is unguessable, which
 * stops somebody finding a cohort; the roster is an allowlist, which stops somebody who was *sent*
 * the link — forwarded from a group chat, or passed to a friend — from being admitted by it. See
 * `lib/courses/roster.ts` for how a match is decided and why one entry admits one person.
 *
 * `courses.regenerateJoinToken` and `remove` are still here and still worth having, but they are
 * now the second line rather than the only one.
 *
 * **Removing is a status, never a deleted row.** A student who leaves had submissions, grades,
 * and released feedback, and destroying those to tidy a roster is the worse failure. What
 * removal does is stop them appearing — see `lib/courses/membership.ts` for the two questions
 * that come apart because of it.
 */
export const enrollmentsRouter = createTRPCRouter({
  /**
   * What a join link points at, before anybody joins.
   *
   * So the join screen can say which course this is and who teaches it rather than asking for
   * a decision with no information. `profileProcedure`, because the caller is by definition not
   * yet a member of anything — that is what they are here to change.
   *
   * Returns null rather than throwing on an unknown token, so a stale link reads as "this link
   * no longer works" instead of an error page. It reveals only what somebody holding the link
   * is about to see anyway.
   */
  preview: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { joinToken: input.token },
        select: {
          id: true,
          name: true,
          cohortTerm: true,
          archivedAt: true,
          instructors: {
            where: { isPrimary: true },
            take: 1,
            select: { user: { select: { displayName: true } } },
          },
        },
      });

      if (!course) return null;

      const existing = await ctx.db.enrollment.findFirst({
        where: { courseId: course.id, studentId: ctx.profile.id },
        select: { status: true },
      });

      /*
        Asked here as well as in `join`, through the same function and in the same order, so the
        screen and the mutation cannot disagree. A preview that offers a button the mutation then
        refuses is worse than no preview: the student has already decided they are in the right
        place by the time they are told otherwise.

        **An existing enrollment answers this before the roster does**, matching `join`. Somebody
        already in the cohort is not somebody the roster has anything to say about, and a student
        enrolled before this table existed has no entry — telling them the link is not for their
        account while they sit in the course would be the worst version of this screen.
      */
      const onRoster =
        existing !== null ||
        !rosterApplies(ctx.profile.role) ||
        (await findRosterMatch(ctx.db, course.id, ctx.profile)) !== null;

      return {
        courseId: course.id,
        name: course.name,
        cohortTerm: course.cohortTerm,
        archived: course.archivedAt !== null,
        primaryInstructor: course.instructors[0]?.user.displayName ?? null,
        /**
         * Whether this account is expected in this cohort. False turns the join button into an
         * explanation — see `rosterRefusal` for what that explanation may and may not say.
         */
        onRoster,
        /** What they are signed in as, so the explanation can name the account rather than the person. */
        signedInAs: ctx.profile.githubUsername ?? ctx.profile.email,
        /** So the screen can say "you are already in this course" rather than offering to join. */
        alreadyIn: existing?.status ?? null,
      };
    }),

  /**
   * Redeems a join link.
   *
   * **Idempotent**, which is what makes a reusable link safe: `@@unique([courseId, studentId])`
   * means a second redemption returns the enrollment that exists rather than adding another, so
   * a student who opens the link twice — or bookmarks it — is not a problem to handle.
   *
   * `profileProcedure` rather than `studentProcedure`: an instructor or admin holding a link may
   * legitimately want to sit in a cohort, and refusing on the strength of a role would refuse
   * them for no reason. What it does not do is make them a *student* of a course they teach —
   * `assertActiveStudent` refuses an instructor separately, so a submission row can never
   * appear in their own queue.
   */
  join: profileProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUnique({
        where: { joinToken: input.token },
        select: { id: true, name: true, archivedAt: true },
      });

      /*
        The same message whether the link was never real or has been rotated, because from here
        they are the same fact and telling them apart would say something about a course the
        caller has no connection to.
      */
      if (!course) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "That join link does not work. It may have been replaced — ask your instructor " +
            "for the current one.",
        });
      }

      if (course.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${course.name} has finished, so it is not taking new students.`,
        });
      }

      /*
        An instructor of this course is refused rather than enrolled.

        Not a technicality: an enrollment would put them in their own roster and their own
        gradebook, and `accept` would then create a submission that appears in the queue they
        are supposed to be working through. They can already see everything in the course.
      */
      const teaches = await ctx.db.courseInstructor.findFirst({
        where: { courseId: course.id, userId: ctx.profile.id },
        select: { id: true },
      });
      if (teaches) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `You teach ${course.name}, so you are already in it.`,
        });
      }

      const existing = await ctx.db.enrollment.findUnique({
        where: { courseId_studentId: { courseId: course.id, studentId: ctx.profile.id } },
        select: { id: true, status: true },
      });

      /*
        A removed student redeeming again is refused, and this is the one place idempotence
        would be the wrong instinct. If the link let them back in, removing somebody would not
        stick while they still held it, and the instructor's only recourse would be rotating
        the link for the whole cohort. `enrollments.restore` is how somebody comes back.
      */
      if (existing?.status === "REMOVED") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `You are no longer enrolled in ${course.name}. Everything you submitted and were ` +
            `given feedback on is still available to you. Ask your instructor if this is wrong.`,
        });
      }

      // Already in, from a link opened twice or a bookmark. Returned rather than refused: they
      // asked to be in the course and they are.
      if (existing) {
        return { courseId: course.id, name: course.name, joined: false };
      }

      /*
        The roster check, after every question about an enrollment that already exists and before
        anything is written.

        **The order is the whole of it.** Asked earlier, this refuses a student who is already in
        the cohort — every student enrolled before this table existed has no entry, so reopening a
        bookmarked link would tell them the link is not for their account while they sit in the
        course it names. The roster decides who may *become* a member; it has no opinion about
        somebody who already is one, and an allowlist introduced after a cohort started must not
        retroactively evict it.

        A removed student is refused above rather than here for the same reason: that refusal is
        specific and true, and reaching a roster message instead would tell them the wrong thing
        about why.

        Staff are exempt, for the reason `rosterApplies` gives.
      */
      const match = rosterApplies(ctx.profile.role)
        ? await findRosterMatch(ctx.db, course.id, ctx.profile)
        : null;

      if (rosterApplies(ctx.profile.role) && !match) {
        throw rosterRefusal(course.name, ctx.profile);
      }

      /*
        The claim and the enrollment commit together.

        **This is what makes one entry admit one person.** Claiming outside the transaction would
        leave two ways to be wrong: an entry marked used with no enrollment behind it, which reads
        on the roster as a student who joined and is missing from the cohort; or an enrollment with
        the entry still free, which is the case the claim exists to prevent. `claimRosterEntry`
        refuses at the database if somebody took it in between, and that refusal rolls this back.
      */
      return inTransaction(ctx.db, async (tx) => {
        if (match) {
          const claimed = await claimRosterEntry(tx, match.id, ctx.profile.id);

          if (!claimed) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                `Somebody else just joined ${course.name} using the place reserved for your ` +
                `account. Ask your instructor to check the list of expected students.`,
            });
          }
        }

        await tx.enrollment.create({
          data: { courseId: course.id, studentId: ctx.profile.id },
          select: { id: true },
        });

        await recordEvent(tx, {
          action: "ENROLLMENT_JOINED",
          actor: auditActor(ctx),
          subject: { id: ctx.profile.id, label: displayNameOf(ctx.profile, "a student") },
          course: { id: course.id, label: course.name },
          // Which of the two ways in this was. A staff member sitting in a cohort and a student
          // arriving on their reserved place are both legitimate and are not the same event.
          detail: match
            ? { rosterEntryId: match.id, expectedAs: match.githubUsername ?? match.email }
            : { viaStaffExemption: true, role: ctx.profile.role },
        });

        return { courseId: course.id, name: course.name, joined: true };
      });
    }),

  /**
   * Who is expected in this cohort, claimed or not.
   *
   * `courseProcedure`, so an instructor reads their own cohort's list and not another's. The
   * unclaimed entries are the useful half of this screen: they are the students who have been
   * sent the link and have not arrived, which is the list somebody chases.
   */
  roster: courseProcedure.query(async ({ ctx, input }) => {
    const entries = await ctx.db.rosterEntry.findMany({
      where: { courseId: input.courseId },
      select: {
        id: true,
        githubUsername: true,
        email: true,
        note: true,
        claimedAt: true,
        claimedBy: { select: { id: true, ...personNameSelect } },
        addedBy: { select: personNameSelect },
        createdAt: true,
      },
      // Unclaimed first, because they are the ones with something left to do.
      orderBy: [{ claimedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    });

    return entries.map((entry) => ({
      ...entry,
      claimedByName: entry.claimedBy ? displayNameOf(entry.claimedBy, "a student") : null,
      addedByName: entry.addedBy ? displayNameOf(entry.addedBy, "an instructor") : null,
    }));
  }),

  /**
   * Adds people to the list of students expected in this cohort.
   *
   * **Entries that are already there are skipped rather than refused.** Pasting a roster twice is
   * something people do — a spreadsheet gains three names and the whole thing gets pasted again —
   * and failing the entire write because of the twenty-two that were already present would make
   * the obvious action the wrong one. What comes back says how many of each, so the screen can be
   * honest about it.
   */
  addToRoster: courseProcedure
    .input(
      z.object({
        entries: z.array(rosterEntrySchema).min(1).max(MAX_ROSTER_PASTE),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findUniqueOrThrow({
        where: { id: input.courseId },
        select: { id: true, name: true },
      });

      return inTransaction(ctx.db, async (tx) => {
        /*
          `skipDuplicates` leans on the two unique constraints, which is what makes "already there"
          a decision the database makes rather than a read this has to do first. A read would be
          wrong as well as slower: two instructors pasting overlapping lists at the same moment
          would both find the row absent.
        */
        const written = await tx.rosterEntry.createMany({
          data: input.entries.map((entry) => ({
            courseId: input.courseId,
            githubUsername: entry.githubUsername,
            email: entry.email,
            note: entry.note,
            addedById: ctx.profile.id,
          })),
          skipDuplicates: true,
        });

        if (written.count > 0) {
          await recordEvent(tx, {
            action: "ROSTER_ENTRY_ADDED",
            actor: auditActor(ctx),
            course: { id: course.id, label: course.name },
            // The keys rather than a count, because "who was added to this cohort" is the question
            // this event is kept to answer, and a count cannot answer it.
            detail: {
              added: written.count,
              keys: input.entries.map((entry) => entry.githubUsername ?? entry.email),
            },
          });
        }

        return {
          added: written.count,
          alreadyPresent: input.entries.length - written.count,
        };
      });
    }),

  /**
   * Takes somebody off the list of expected students.
   *
   * **A claimed entry is refused.** Removing it would not remove the student — they are enrolled,
   * and the enrollment is what the application reads — so it would only destroy the record of how
   * they got in, leaving a cohort member nothing explains. `remove` below is how somebody leaves.
   */
  removeFromRoster: courseProcedure
    .input(z.object({ entryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.rosterEntry.findFirst({
        // Scoped by `courseId` from the input, which `courseProcedure` has already checked the
        // caller teaches. An entry id alone says nothing about which cohort it belongs to.
        where: { id: input.entryId, courseId: input.courseId },
        select: {
          id: true,
          githubUsername: true,
          email: true,
          claimedById: true,
          course: { select: { id: true, name: true } },
        },
      });

      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That entry is not on this cohort's list.",
        });
      }

      if (entry.claimedById !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "That student has already joined on this entry, so removing it would take away the " +
            "record of how they got in without taking away their place. Remove them from the " +
            "roster instead.",
        });
      }

      return inTransaction(ctx.db, async (tx) => {
        await tx.rosterEntry.delete({ where: { id: entry.id } });

        await recordEvent(tx, {
          action: "ROSTER_ENTRY_REMOVED",
          actor: auditActor(ctx),
          course: { id: entry.course.id, label: entry.course.name },
          detail: { key: entry.githubUsername ?? entry.email },
        });

        return { id: entry.id };
      });
    }),

  /**
   * Removes a student from a cohort.
   *
   * Their work, grades, and released feedback are untouched and stay readable to them; what
   * stops is appearing in the roster's active list, the gradebook, the queue, and the counts,
   * and being able to hand anything else in.
   */
  remove: instructorProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollment = await loadTeachableEnrollment(ctx, input.enrollmentId);

      return inTransaction(ctx.db, async (tx) => {
        const updated = await tx.enrollment.update({
          where: { id: input.enrollmentId },
          data: { status: "REMOVED" },
          select: { id: true, status: true },
        });

        await recordEvent(tx, {
          action: "ENROLLMENT_REMOVED",
          actor: auditActor(ctx),
          subject: { id: enrollment.studentId, label: enrollment.studentName },
          course: { id: enrollment.courseId, label: enrollment.courseName },
          detail: { enrollmentId: updated.id },
        });

        return { ...updated, studentName: enrollment.studentName };
      });
    }),

  /**
   * Puts a removed student back.
   *
   * **The counterpart to redeeming being refused for a removed student**, and the reason that
   * refusal is safe. If rejoining were automatic, removing somebody would not stick while they
   * still held the link, and an instructor's only recourse would be rotating the link for the
   * whole cohort. Coming back is the instructor's action.
   */
  restore: instructorProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const enrollment = await loadTeachableEnrollment(ctx, input.enrollmentId);

      return inTransaction(ctx.db, async (tx) => {
        const updated = await tx.enrollment.update({
          where: { id: input.enrollmentId },
          data: { status: "ACTIVE" },
          select: { id: true, status: true },
        });

        await recordEvent(tx, {
          action: "ENROLLMENT_RESTORED",
          actor: auditActor(ctx),
          subject: { id: enrollment.studentId, label: enrollment.studentName },
          course: { id: enrollment.courseId, label: enrollment.courseName },
          detail: { enrollmentId: updated.id },
        });

        return { ...updated, studentName: enrollment.studentName };
      });
    }),
});

/**
 * The enrollment, if the caller teaches the course it belongs to, and who it is about.
 *
 * A thin wrapper over `teachableEnrollment` rather than its own check: both call sites want the
 * student's name for the message they return, and that is the only thing this adds. Loading the
 * row first is what makes the course-level check possible at all — an enrollment id says nothing
 * about which course it is in until the row is read.
 */
async function loadTeachableEnrollment(
  ctx: AuthedCtx,
  enrollmentId: string,
): Promise<{ courseId: string; courseName: string; studentId: string; studentName: string }> {
  const found = await teachableEnrollment(ctx, enrollmentId, {
    courseId: true,
    studentId: true,
    course: { select: { name: true } },
    student: { select: personNameSelect },
  });

  return {
    courseId: found.courseId,
    courseName: found.course.name,
    studentId: found.studentId,
    studentName: displayNameOf(found.student, "that student"),
  };
}
