import "server-only";

import { TRPCError } from "@trpc/server";

import type { db as Db } from "../prisma";

/**
 * Who owns a cohort, and what owning one permits.
 *
 * A course has instructors, and one of them owns it — whoever created it, or whoever it has
 * since been handed to. Everybody who teaches a course can author in it, read every student's
 * work, and approve grades; the owner can additionally archive it, reopen it, and decide who
 * else teaches it. Ownership exists because a cohort with two instructors has actions with
 * reach beyond the person performing them, and until it existed anybody who taught a course
 * could remove the person who set it up.
 *
 * **The derivation lives here and nowhere else.** The settings screen draws a badge, and three
 * procedures refuse on the same question; computed separately, the day they disagree is the day
 * somebody is shown they own a cohort by a screen that a procedure then refuses them on. Same
 * reasoning as `triageBucket` being the one authority on what is outstanding.
 *
 * An admin is above all of it. `assertTeachesCourse` already lets an admin act on any course
 * and this does not narrow that, deliberately: an admin is the recovery path for an owner who
 * left the program without handing the cohort on, and without one every rule here is a way for
 * a course to end up with nobody who can administer it.
 */

/** Just enough of the tRPC context to ask, so a caller can pass a transaction as `db`. */
type Ctx = {
  db: typeof Db;
  profile: { id: string; role: string };
};

/** The part of a `CourseInstructor` row that decides ownership. */
type InstructorRow = {
  userId: string;
  isPrimary: boolean;
  createdAt: Date;
};

/**
 * The owner among a course's instructors, or null when it has none at all.
 *
 * **`isPrimary` if a row holds it, and the longest-serving instructor if none does.** The
 * fallback is not a nicety. `CourseInstructor` cascades on the profile, so deleting an owner's
 * account takes their row with it — and a course would be left with instructors, an owner of
 * nobody, and no one able to archive it or remove anybody. Nothing in the application deletes a
 * profile; that is a database action somebody takes by hand, which is exactly why this has to
 * hold with nobody there to invoke it.
 *
 * Promoting an admin instead would be worse. An admin's reach comes from the role rather than
 * from a `CourseInstructor` row, so writing one would put every orphaned cohort into that
 * admin's own course list as a course they teach.
 *
 * At most one row can hold `isPrimary` — a partial unique index on `course_instructors` says so
 * — so finding the first is finding the only. The tie-break on the fallback is for
 * determinism rather than for correctness: two rows can share a `createdAt` to the microsecond,
 * and an owner who depends on row order is an owner who changes between two reads.
 */
export function ownerOf<T extends InstructorRow>(instructors: readonly T[]): T | null {
  const primary = instructors.find((row) => row.isPrimary);
  if (primary) return primary;

  return instructors.reduce<T | null>((earliest, row) => {
    if (!earliest) return row;
    if (row.createdAt.getTime() !== earliest.createdAt.getTime()) {
      return row.createdAt < earliest.createdAt ? row : earliest;
    }
    return row.userId < earliest.userId ? row : earliest;
  }, null);
}

/** The owner's profile id, or null for a course with no instructors left. */
export async function courseOwnerId(db: Ctx["db"], courseId: string): Promise<string | null> {
  const instructors = await db.courseInstructor.findMany({
    where: { courseId },
    select: { userId: true, isPrimary: true, createdAt: true },
  });

  return ownerOf(instructors)?.userId ?? null;
}

/**
 * Refuses unless the caller owns this course. Admins own none of them and may do anything.
 *
 * `action` completes the sentence "Only ... can ___ it", so it reads as an instruction rather
 * than as a permission code: somebody refused here needs to know who to ask, which is why the
 * message names the owner when there is one to name.
 */
export async function assertOwnsCourse(ctx: Ctx, courseId: string, action: string): Promise<void> {
  if (ctx.profile.role === "ADMIN") return;

  const instructors = await ctx.db.courseInstructor.findMany({
    where: { courseId },
    select: {
      userId: true,
      isPrimary: true,
      createdAt: true,
      user: { select: { displayName: true, email: true, githubUsername: true } },
    },
  });

  const owner = ownerOf(instructors);
  if (owner && owner.userId === ctx.profile.id) return;

  /*
    A course with no instructors is refused rather than opened up, and it is not the same
    refusal as being the wrong instructor. It should not be reachable — `removeInstructor`
    refuses to empty the list — so a caller who reaches it has found something wrong, and
    telling them to ask the owner would be telling them to ask nobody.
  */
  if (!owner) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `This cohort has no instructors, so nobody can ${action} it. An admin has to add ` +
        `one first.`,
    });
  }

  const name =
    owner.user.displayName ?? owner.user.githubUsername ?? owner.user.email ?? "its owner";

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Only ${name} can ${action} this cohort, because they own it.`,
  });
}
