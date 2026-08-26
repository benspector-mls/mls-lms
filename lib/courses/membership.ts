import "server-only";

import { TRPCError } from "@trpc/server";

import type { CohortSelection } from "../programs/cohorts";
import type { AuthedCtx } from "../auth/ctx";
import type { Db } from "../prisma";

/**
 * Who may read a course, and who may still act in one.
 *
 * **These are two questions, and they are here together on purpose.** A fellow removed from a
 * program keeps reading the feedback they were given — its courses stay in their list, labelled,
 * and their released grades stay visible — and cannot accept, submit, or upload anything new. An
 * archived course behaves the same way for everyone in it. So "is this person in this course" has
 * two different right answers depending on why it is being asked.
 *
 * They live in one file, adjacent, because the two `where` clauses differ by one enum value in code
 * that otherwise reads identically. Written out at each call site, the failure is not spotting a
 * difference — it is not noticing there was a decision to make. A new caller has to pick a function,
 * and the names say what picking one means.
 *
 * **Enrollment is per program, so every question here resolves the course's program first.** Being
 * on a program's roster is being a student of its courses; there is no per-course enrollment row to
 * look for. What remains per course is publication — see `Course.publishedAt` — which is why
 * `assertCourseMember` asks about a course rather than about the program above it.
 *
 * Neither is a substitute for `assertTeaches`, which is stronger than both and is also here:
 * holding the INSTRUCTOR role says nothing about *which* programs, so authoring anything checks the
 * `ProgramInstructor` row instead.
 *
 * All of them exist because **Prisma is not restricted by row level security.** It connects as the
 * table owner, so without a check in the procedure any signed-in user could read any course by
 * guessing an id.
 */

/** What the caller is to this course, or null when they are nothing to it. */
export type Membership =
  { as: "admin" } | { as: "instructor" } | { as: "student"; active: boolean };

/**
 * The course's publication state alongside what the caller is to it, in one query.
 *
 * Two facts rather than one because they refuse differently: not being a member is a FORBIDDEN and
 * the course being unpublished is, to a fellow, indistinguishable from the course not existing. A
 * union carrying "member of an unpublished course" would make every reader of `Membership` decide
 * what that meant, and most of them have no reason to care.
 */
type Standing = { membership: Membership | null; published: boolean };

async function standingIn(ctx: AuthedCtx, courseId: string): Promise<Standing> {
  if (ctx.profile.role === "ADMIN") return { membership: { as: "admin" }, published: true };

  /*
    One round trip for three facts: whether the course exists, whether it is published, and what
    this person is to the program above it. Reaching the enrollment and the instructor row *through*
    the course is what makes the answer about this course rather than about a program the caller
    happens to be in — and it is why there is no second query to forget.
  */
  const course = await ctx.db.course.findUnique({
    where: { id: courseId },
    select: {
      publishedAt: true,
      program: {
        select: {
          // Every status, deliberately. Which ones *permit* what is the question the assertions
          // below answer; this one only reports.
          enrollments: {
            where: { studentId: ctx.profile.id },
            select: { status: true },
          },
          instructors: {
            where: { userId: ctx.profile.id },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!course) return { membership: null, published: false };

  const published = course.publishedAt !== null;
  if (course.program.instructors.length > 0) {
    return { membership: { as: "instructor" }, published };
  }

  const enrollment = course.program.enrollments[0];
  if (enrollment) {
    return { membership: { as: "student", active: enrollment.status === "ACTIVE" }, published };
  }

  return { membership: null, published };
}

/**
 * How the caller is connected to this course, without deciding what that permits.
 *
 * Returned rather than thrown so a screen can render differently — a removed fellow's course page is
 * readable and says so — while the assertions below make the refusals.
 */
export async function membershipIn(ctx: AuthedCtx, courseId: string): Promise<Membership | null> {
  return (await standingIn(ctx, courseId)).membership;
}

/**
 * Refuses unless the caller may **read** this course.
 *
 * Admits a removed fellow, which is the whole point: they were shown grades and feedback, and taking
 * those back because they left the program is worse than a course they can still open.
 *
 * **Refuses a fellow an unpublished course, and refuses it as NOT_FOUND.** Being on the roster now
 * makes somebody a student of every course of the program, so publication is the only thing standing
 * between them and a course that begins in March. The refusal says the course does not exist rather
 * than that they may not see it, because to a fellow those are the same situation and the second
 * wording invites them to ask about work their instructor has not finished writing. Every instructor
 * of the program reads it normally — authoring it is the point.
 *
 * For reads. Anything that creates or changes a submission wants `assertActiveStudent` below.
 */
export async function assertCourseMember(ctx: AuthedCtx, courseId: string): Promise<Membership> {
  const { membership, published } = await standingIn(ctx, courseId);

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this course.",
    });
  }

  if (membership.as === "student" && !published) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That course does not exist.",
    });
  }

  return membership;
}

/**
 * Refuses unless the caller is an **active fellow of this course's program**.
 *
 * For `accept`, `submitWork`, the upload route — anything that hands work in. A removed fellow
 * reaching one of these is told why, rather than being told the assignment does not exist: they can
 * see it, so a refusal that pretends otherwise would read as a bug.
 *
 * An instructor is refused too, and not because of a technicality. Instructors are not students of
 * their own program; one submitting work would create a submission row that appears in their own
 * queue.
 *
 * **An unpublished course refuses here as well**, and before the enrollment is even considered: work
 * cannot be handed in to something no fellow can see. It is checked the same way it is for reading,
 * so the two cannot come to disagree.
 */
export async function assertActiveStudent(ctx: AuthedCtx, courseId: string): Promise<void> {
  const course = await ctx.db.course.findUnique({
    where: { id: courseId },
    select: {
      publishedAt: true,
      program: {
        select: {
          enrollments: {
            where: { studentId: ctx.profile.id },
            select: { status: true },
          },
        },
      },
    },
  });

  if (!course || course.publishedAt === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That course does not exist." });
  }

  const enrollment = course.program.enrollments[0];
  if (enrollment?.status === "ACTIVE") return;

  // Which of the two refusals this is decides what the message can say, and the difference matters
  // to the person reading it: one is "you left this program", which is a fact they can act on, and
  // the other is "you were never in it", which is not.
  throw new TRPCError({
    code: "FORBIDDEN",
    message: enrollment
      ? "You are no longer enrolled in this program, so you cannot hand in new work. " +
        "Everything you have already submitted and been given feedback on stays available. " +
        "Ask your instructor if this is wrong."
      : "You are not enrolled in the program this assignment belongs to.",
  });
}

/**
 * Refuses unless the caller **teaches** this course. Admins teach none and may do anything.
 *
 * **The row it looks for is on the program, not on the course.** An instructor of a program may act
 * in every course of it, so `CourseInstructor` grants nothing and is not consulted here — it records
 * who teaches what, which decides whose name is on a course and who is added as a collaborator on
 * its repositories. The reasoning is the one that leaves a cohort free of any instructor relation: a
 * co-teacher covering for somebody must be able to approve their drafts.
 *
 * The check the INSTRUCTOR role cannot make on its own. Holding the role says somebody is staff, not
 * which programs are theirs, so without this one program's instructor could author in
 * another's, rename its units, or reassign its fellows.
 *
 * Here rather than private to a router because several of them want it and an identical guard copied
 * several times is several places for it to drift. The `ctx` is structural so a caller can pass a
 * transaction as `db`, which is what lets the check scripts drive these procedures inside a
 * transaction they then roll back.
 */
export async function assertTeaches(ctx: AuthedCtx, courseId: string): Promise<void> {
  if (ctx.profile.role === "ADMIN") return;

  const teaches = await ctx.db.programInstructor.findFirst({
    where: { userId: ctx.profile.id, program: { courses: { some: { id: courseId } } } },
    select: { id: true },
  });

  if (!teaches) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not teach this course." });
  }
}

/**
 * The same question asked about a program directly, for the screens that are not about one course.
 *
 * Attendance, the roster, the cohorts, and the instructor list all belong to the program, so they
 * have no course to reach through. `programProcedure` in trpc/init.ts is built on this.
 */
export async function assertInstructsProgram(ctx: AuthedCtx, programId: string): Promise<void> {
  if (ctx.profile.role === "ADMIN") return;

  const instructs = await ctx.db.programInstructor.findFirst({
    where: { programId, userId: ctx.profile.id },
    select: { id: true },
  });

  if (!instructs) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not an instructor of this program.",
    });
  }
}

/**
 * Refuses unless the caller is a **member of this program**, whatever they are to it.
 *
 * The counterpart of `assertCourseMember` for the program's own screens: a fellow reading their own
 * attendance record, and an instructor reading anybody's. A removed fellow is admitted, for the
 * reason they are admitted to a course they have left — their record is theirs.
 */
export async function assertProgramMember(ctx: AuthedCtx, programId: string): Promise<Membership> {
  if (ctx.profile.role === "ADMIN") return { as: "admin" };

  const [enrollment, instructorRow] = await Promise.all([
    ctx.db.enrollment.findFirst({
      where: { programId, studentId: ctx.profile.id },
      select: { status: true },
    }),
    ctx.db.programInstructor.findFirst({
      where: { programId, userId: ctx.profile.id },
      select: { id: true },
    }),
  ]);

  if (instructorRow) return { as: "instructor" };
  if (enrollment) return { as: "student", active: enrollment.status === "ACTIVE" };

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You are not a member of this program.",
  });
}

/**
 * Refuses unless the caller is an **active fellow of this program**, with no course in the question.
 *
 * What checking into the morning wants. Attendance belongs to the program, so there is no course to
 * name and no publication to consider — a fellow arrives at the building rather than at a course.
 */
export async function assertActiveInProgram(ctx: AuthedCtx, programId: string): Promise<string> {
  const enrollment = await ctx.db.enrollment.findFirst({
    where: { programId, studentId: ctx.profile.id },
    select: { id: true, status: true },
  });

  if (enrollment?.status === "ACTIVE") return enrollment.id;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: enrollment
      ? "You are no longer enrolled in this program."
      : "You are not enrolled in this program.",
  });
}

/**
 * Refuses unless the caller is **the fellow this work belongs to, or an instructor of its course**.
 *
 * Its own named question rather than a special case of the others, because it is the only place
 * where owning something and teaching it grant the same thing. It governs one act: minting a signed
 * URL for a stored file — which is the *whole* of the access control on uploads, since the bucket is
 * private and carries no policies, so there is no other route to the bytes.
 *
 * The student check comes first and costs nothing, which matters: the common caller is the fellow
 * looking at their own work, and they are not an instructor of anything.
 */
export async function assertOwnsOrTeaches(
  ctx: AuthedCtx,
  work: { studentId: string; courseId: string },
): Promise<void> {
  if (work.studentId === ctx.profile.id) return;
  await assertTeaches(ctx, work.courseId);
}

// =======================================================================================
// The same two questions, asked about a course's work rather than about the caller
//
// A removed fellow's submissions are not deleted and are not the course's outstanding work. So
// every instructor-facing read of a course's submissions is one of two kinds, and it has to know
// which: a **list of work waiting to be done**, which a departed fellow contributes nothing to, or
// a **record of what happened**, which they are part of.
//
// Getting it wrong in the first direction leaves a removed fellow in grading triage forever — work
// nobody will ever do, that cannot be cleared, sitting in the count that says whether an instructor
// is caught up. Getting it wrong in the second direction deletes their history from the gradebook,
// which is the thing that must not happen.
//
// Two helpers rather than one, for the same reason as the guards above: a new reader picks one, and
// the names say what picking means.
//
// **Every one of them now takes a program *and* a course**, and that is the change to notice. The
// enrollment says "active on this roster", which is a program fact; the course says "this course's
// work", which the enrollment used to say and no longer can. Carrying the course scope inside the
// fragment rather than leaving it to each caller is deliberate: a caller who forgot it would widen
// a screen from one course to every course of the program, and nothing would throw.
// =======================================================================================

/**
 * "Is this enrollment an active member of the selected cohort", as a condition on `Enrollment`.
 *
 * The one definition of what a selection means, called by everything below. `all` contributes
 * nothing, which is what makes it the absence of a filter rather than a filter that happens to match
 * everybody.
 *
 * A cohort is a partition, so this is an equality rather than a test over membership rows — which is
 * also why "unassigned" is `null` rather than the absence of a join.
 */
function cohortCondition(selection: CohortSelection) {
  if (selection.kind === "cohort") return { cohortId: selection.cohortId };
  if (selection.kind === "unassigned") return { cohortId: null };
  return {};
}

/** The student half of the narrowing, without the course. Not exported: see the two below. */
function activeFellow(programId: string, selection: CohortSelection) {
  return {
    student: {
      enrollments: {
        some: { programId, status: "ACTIVE" as const, ...cohortCondition(selection) },
      },
    },
  };
}

/**
 * A `where` fragment on `Submission` restricting it to one course's work by fellows currently on the
 * program's roster, and optionally to one cohort of them.
 *
 * For the work lists — grading triage, and the counts that have to agree with it. Spread into an
 * existing `where`; it composes with anything that does not itself set `assignment` or `student`.
 *
 * **The cohort narrows the same `some:` clause rather than adding a second fragment**, and that is
 * the whole reason it lives here instead of beside this function. Both questions constrain
 * `student`, so two fragments spread into one `where` would leave the second silently replacing the
 * first — an object literal has one `student` key — and the failure is a filtered screen that
 * quietly stopped excluding removed fellows, or an unfiltered one that quietly stopped counting the
 * roster. Neither throws. One function producing one constraint is what makes that unexpressible.
 *
 * Folding the cohort into the enrollment is also what makes it correct rather than merely
 * convenient: the cohort is a column on the enrollment, so "on this roster, active, and in this
 * cohort" is one condition on one row rather than several joins that could each be satisfied by a
 * different enrollment.
 *
 * A cohort belonging to some other program matches nothing, because no enrollment on *this* roster
 * can hold it. That is the safe direction — an empty screen rather than another program's
 * fellows — so a stale id costs a query rather than a check on every call.
 */
export function activeStudentWork(
  programId: string,
  courseId: string,
  selection: CohortSelection = { kind: "all" },
) {
  return {
    assignment: { courseId },
    ...activeFellow(programId, selection),
  };
}

/**
 * The same narrowing, widened by one case: **a team's work stays in the pile while any member of it
 * is still on the roster.**
 *
 * For the reads that answer "what is waiting on an instructor". One row per team holds the work, and
 * that row belongs to whichever member arrived first — who can leave the program while the rest of
 * the team goes on working. `activeStudentWork` alone would then drop the team's only real row out
 * of triage and out of the counts, and the work would be waiting on somebody with nothing anywhere
 * to say so. The teammates' mirrors are not a substitute: a mirror is not work, and is excluded by
 * the bucket rather than by this.
 *
 * **Keyed on `AND` rather than spread, and that is deliberate.** The triage pile already has an `OR`
 * of its own — open work, a run to act on, an undelivered comment — and an object literal has one
 * `OR` key, so a fragment contributing a second would silently replace it and quietly widen the pile
 * to every submission in the course. Nesting inside `AND` is what makes the two independent.
 * Anything using this must not also set `AND`.
 *
 * **The course scope sits beside the `OR` rather than inside it**, so it applies whichever branch
 * matches. Inside, it would be repeated in both branches and one of them could be edited without
 * the other.
 *
 * The gradebook and the fellow's own screens must keep using neither this nor `activeStudentWork` —
 * they show a mirror, because the fellow really does have that grade.
 */
export function teamAwareWork(
  programId: string,
  courseId: string,
  selection: CohortSelection = { kind: "all" },
) {
  return {
    AND: [
      { assignment: { courseId } },
      {
        OR: [
          activeFellow(programId, selection),
          { mirrors: { some: activeFellow(programId, selection) } },
        ],
      },
    ],
  };
}

/**
 * The same narrowing expressed against `Enrollment` rather than against `Submission`.
 *
 * The gradebook, the roster, and the attendance grid read enrollments directly rather than through
 * the work, so they need the condition one level up. It calls the same `cohortCondition` as its
 * siblings above, so "in this cohort" cannot come to mean two things depending on which screen
 * asked.
 *
 * **No course, because an enrollment has none.** These callers are asking about the program's roster,
 * which is the same list whichever course they arrived from.
 *
 * Enrollment status is deliberately absent: these callers want every status and sort the two apart
 * themselves, which is what keeps a removed fellow in the gradebook and out of the pile.
 */
export function enrollmentsIn(programId: string, selection: CohortSelection = { kind: "all" }) {
  return { programId, ...cohortCondition(selection) };
}

/**
 * Which fellows the selected cohort holds, or **null** when nothing is selected.
 *
 * For the reads that cannot narrow with a `where` because they have already fetched the rows — the
 * gradebook and the curriculum list both build a grid of cells first and count it after, so the
 * cohort has to be applied as a membership test rather than as a query.
 *
 * Null rather than a set of everybody. `all` is the absence of a filter, so there is no query to run
 * and nothing to compare against: building the set anyway would make the unfiltered case pay for a
 * narrowing it is not doing, and would drop a fellow whose enrollment row is somehow missing out of
 * their own gradebook rather than leaving them where they were. Every caller writes
 * `if (set && !set.has(id))`, which is the shape that says "only when filtering".
 */
export async function selectedStudentIds(
  db: Db,
  programId: string,
  selection: CohortSelection,
): Promise<Set<string> | null> {
  if (selection.kind === "all") return null;

  const enrollments = await db.enrollment.findMany({
    where: enrollmentsIn(programId, selection),
    select: { studentId: true },
  });

  return new Set(enrollments.map((enrollment) => enrollment.studentId));
}

/**
 * Which fellows on this roster have been removed, for the reads that return both sets.
 *
 * For the reads that return both sets and have to tell them apart — the grading queue, which keeps a
 * removed fellow out of the pile while still opening one by link. Partitioning one result is what
 * makes the two sets exhaustive: a filter and its complement written as separate queries can each
 * miss a row and nothing would say so.
 *
 * `courses.gradebook` reads the same fact off the roster it already fetched rather than calling this,
 * because it needs every enrollment's status anyway for the Roster tab.
 */
export async function removedStudentIds(db: Db, programId: string): Promise<Set<string>> {
  const removed = await db.enrollment.findMany({
    // Not active, rather than `REMOVED`. This has to be the exact complement of `activeFellow`
    // above, or a status that is neither would fall out of both sets — out of the pile and out of
    // the record, which is an absence nothing reports.
    where: { programId, status: { not: "ACTIVE" } },
    select: { studentId: true },
  });
  return new Set(removed.map((row) => row.studentId));
}
