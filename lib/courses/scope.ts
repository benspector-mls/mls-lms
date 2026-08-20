import "server-only";

import { TRPCError } from "@trpc/server";

import type { AuthedCtx } from "../auth/ctx";
import type { Prisma } from "../generated/prisma/client";

/**
 * Load a row, and refuse unless the caller teaches the course it belongs to.
 *
 * The shape that accounted for most of the duplication in the router layer. It was written nine
 * times: four helpers that called `assertTeaches` correctly, three that reimplemented the admin
 * bypass by hand, and five inline ternaries — between them producing five different sentences for
 * one refusal, and two different implementations of "does this caller see unpublished
 * assignments".
 *
 * **Middleware cannot serve these**, which is why they are functions rather than a procedure
 * builder. `courseProcedure` gates the procedures whose input already names the course; these are
 * the ones whose input names a row instead, and as `modules.ts` put it first: a module id says
 * nothing about which course it is in until the row is read. Loading and authorizing are one act.
 *
 * ## One query, and how
 *
 * The authorization is a condition in the `where` rather than a second round trip:
 *
 * ```ts
 * where: { id, assignment: { course: { instructors: { some: { userId } } } } }
 * ```
 *
 * That is what makes the caller's `select` reach Prisma untouched, which is the property the
 * whole file rests on — the returned payload type is exactly what the caller asked for, with no
 * cast, no deep merge of a probe into their select, and no chance of a probe silently replacing a
 * relation key they set. Merging was the obvious implementation and it is the one with a real
 * failure mode: an object literal has one `assignment` key, so a probe spread over a caller's
 * select would take their columns with it.
 *
 * An admin gets no condition at all, so an admin's query is exactly the row query. Better than
 * the join-and-ignore-it version, which would have made an admin pay for a lookup whose answer is
 * discarded.
 *
 * ## What is lost, and how it is recovered
 *
 * One `where` cannot distinguish "no such row" from "not yours": both come back null. The
 * difference matters — one is a typo and the other is a permission — so it is recovered by a
 * second query that runs **only when the first found nothing**. The happy path is one query; the
 * failure path is two, and a failure is about to throw anyway.
 */

/** Just the counting half of a delegate, which is all the second query needs. */
type Countable = { count: (args: { where: Record<string, unknown> }) => Promise<number> };

/**
 * The refusal, told apart from a typo.
 *
 * Shared by every loader so the two cases cannot come to be reported as one another at one of
 * them — which is how "that module does not exist" ends up in front of somebody looking at it.
 */
async function refuse(delegate: Countable, id: string, what: string): Promise<never> {
  const exists = await delegate.count({ where: { id } });

  throw exists > 0
    ? new TRPCError({
        code: "FORBIDDEN",
        message: `You do not teach the course this ${what.toLowerCase()} belongs to.`,
      })
    : new TRPCError({ code: "NOT_FOUND", message: `${what} not found.` });
}

/** True when this caller may reach any course, which is what an admin is for. */
function teachesEverything(ctx: AuthedCtx): boolean {
  return ctx.profile.role === "ADMIN";
}

// =========================================================================================
// One loader per entity.
//
// Each is a few lines and they are deliberately not collapsed into a single generic over a
// delegate: Prisma's `findFirst` types are per-model, and a wrapper generic enough to accept
// any of them loses the payload inference that makes the caller's `select` mean anything —
// which is the failure this file exists to avoid, and a silent one, because `any` typechecks.
//
// The `where` fragment differs per entity because the path to the course does. That path is
// the only thing each of these knows that the others do not.
// =========================================================================================

/** A course, if the caller teaches it. */
export async function teachableCourse<S extends Prisma.CourseSelect>(
  ctx: AuthedCtx,
  courseId: string,
  select: S,
): Promise<Prisma.CourseGetPayload<{ select: S }>> {
  const row = await ctx.db.course.findFirst({
    where: {
      id: courseId,
      ...(teachesEverything(ctx) ? {} : { instructors: { some: { userId: ctx.profile.id } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.course, courseId, "Course");
}

/**
 * A course unit — a module, a project, or an assessment — if the caller teaches the course.
 *
 * The refusal says "Course unit" rather than naming the category, and that is forced rather
 * than chosen: the row is what carries the category, and this refuses precisely when there is no
 * row to read it from. A caller that wants to say "project not found" has to know it was looking
 * for one, which is a fact its own input carries.
 */
export async function teachableCourseUnit<S extends Prisma.CourseUnitSelect>(
  ctx: AuthedCtx,
  courseUnitId: string,
  select: S,
): Promise<Prisma.CourseUnitGetPayload<{ select: S }>> {
  const row = await ctx.db.courseUnit.findFirst({
    where: {
      id: courseUnitId,
      ...(teachesEverything(ctx)
        ? {}
        : { course: { instructors: { some: { userId: ctx.profile.id } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.courseUnit, courseUnitId, "Course unit");
}

/** A resource, if the caller teaches the course its unit is in. */
export async function teachableResource<S extends Prisma.ResourceSelect>(
  ctx: AuthedCtx,
  resourceId: string,
  select: S,
): Promise<Prisma.ResourceGetPayload<{ select: S }>> {
  const row = await ctx.db.resource.findFirst({
    where: {
      id: resourceId,
      ...(teachesEverything(ctx)
        ? {}
        : { courseUnit: { course: { instructors: { some: { userId: ctx.profile.id } } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.resource, resourceId, "Resource");
}

/** A group, if the caller teaches the course it belongs to. */
export async function teachableGroup<S extends Prisma.CourseGroupSelect>(
  ctx: AuthedCtx,
  groupId: string,
  select: S,
): Promise<Prisma.CourseGroupGetPayload<{ select: S }>> {
  const row = await ctx.db.courseGroup.findFirst({
    where: {
      id: groupId,
      ...(teachesEverything(ctx)
        ? {}
        : { course: { instructors: { some: { userId: ctx.profile.id } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.courseGroup, groupId, "Group");
}

export async function teachableTeamSet<S extends Prisma.TeamSetSelect>(
  ctx: AuthedCtx,
  teamSetId: string,
  select: S,
): Promise<Prisma.TeamSetGetPayload<{ select: S }>> {
  const row = await ctx.db.teamSet.findFirst({
    where: {
      id: teamSetId,
      ...(teachesEverything(ctx)
        ? {}
        : { course: { instructors: { some: { userId: ctx.profile.id } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.teamSet, teamSetId, "Team set");
}

/**
 * One team, reached through the set it belongs to.
 *
 * Its own loader rather than a caller reading the set and then the team, because renaming a team
 * and removing one both name the team alone — and the set is what says whose course it is.
 */
export async function teachableTeam<S extends Prisma.TeamSelect>(
  ctx: AuthedCtx,
  teamId: string,
  select: S,
): Promise<Prisma.TeamGetPayload<{ select: S }>> {
  const row = await ctx.db.team.findFirst({
    where: {
      id: teamId,
      ...(teachesEverything(ctx)
        ? {}
        : { teamSet: { course: { instructors: { some: { userId: ctx.profile.id } } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.team, teamId, "Team");
}

/** An enrollment, if the caller teaches the course it is in. */
export async function teachableEnrollment<S extends Prisma.EnrollmentSelect>(
  ctx: AuthedCtx,
  enrollmentId: string,
  select: S,
): Promise<Prisma.EnrollmentGetPayload<{ select: S }>> {
  const row = await ctx.db.enrollment.findFirst({
    where: {
      id: enrollmentId,
      ...(teachesEverything(ctx)
        ? {}
        : { course: { instructors: { some: { userId: ctx.profile.id } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.enrollment, enrollmentId, "Enrollment");
}

/** An attendance session, if the caller teaches the course it belongs to. */
export async function teachableAttendanceSession<S extends Prisma.AttendanceSessionSelect>(
  ctx: AuthedCtx,
  sessionId: string,
  select: S,
): Promise<Prisma.AttendanceSessionGetPayload<{ select: S }>> {
  const row = await ctx.db.attendanceSession.findFirst({
    where: {
      id: sessionId,
      ...(teachesEverything(ctx)
        ? {}
        : { course: { instructors: { some: { userId: ctx.profile.id } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.attendanceSession, sessionId, "Attendance session");
}

/** An assignment, if the caller teaches the course it is in. */
export async function teachableAssignment<S extends Prisma.AssignmentSelect>(
  ctx: AuthedCtx,
  assignmentId: string,
  select: S,
): Promise<Prisma.AssignmentGetPayload<{ select: S }>> {
  const row = await ctx.db.assignment.findFirst({
    where: {
      id: assignmentId,
      ...(teachesEverything(ctx)
        ? {}
        : { course: { instructors: { some: { userId: ctx.profile.id } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.assignment, assignmentId, "Assignment");
}

/** A submission, if the caller teaches the course its assignment is in. */
export async function teachableSubmission<S extends Prisma.SubmissionSelect>(
  ctx: AuthedCtx,
  submissionId: string,
  select: S,
): Promise<Prisma.SubmissionGetPayload<{ select: S }>> {
  const row = await ctx.db.submission.findFirst({
    where: {
      id: submissionId,
      ...(teachesEverything(ctx)
        ? {}
        : { assignment: { course: { instructors: { some: { userId: ctx.profile.id } } } } }),
    },
    select,
  });

  return row ?? refuse(ctx.db.submission, submissionId, "Submission");
}

/** A grading draft, if the caller teaches the course its submission's assignment is in. */
export async function teachableDraft<S extends Prisma.GradingDraftSelect>(
  ctx: AuthedCtx,
  draftId: string,
  select: S,
): Promise<Prisma.GradingDraftGetPayload<{ select: S }>> {
  const row = await ctx.db.gradingDraft.findFirst({
    where: {
      id: draftId,
      ...(teachesEverything(ctx)
        ? {}
        : {
            submission: {
              assignment: { course: { instructors: { some: { userId: ctx.profile.id } } } },
            },
          }),
    },
    select,
  });

  return row ?? refuse(ctx.db.gradingDraft, draftId, "Draft");
}

/** A test run, if the caller teaches the course its submission's assignment is in. */
export async function teachableTestRun<S extends Prisma.TestRunSelect>(
  ctx: AuthedCtx,
  testRunId: string,
  select: S,
): Promise<Prisma.TestRunGetPayload<{ select: S }>> {
  const row = await ctx.db.testRun.findFirst({
    where: {
      id: testRunId,
      ...(teachesEverything(ctx)
        ? {}
        : {
            submission: {
              assignment: { course: { instructors: { some: { userId: ctx.profile.id } } } },
            },
          }),
    },
    select,
  });

  return row ?? refuse(ctx.db.testRun, testRunId, "Test run");
}
