import "server-only";

import { TRPCError } from "@trpc/server";

import type { AuthedCtx } from "../auth/ctx";
import type { Db } from "../prisma";

/**
 * Who owns a program, and what owning one permits.
 *
 * A program has instructors, and one of them owns it — whoever created it, or whoever it has since
 * been handed to. **Everybody who instructs a program can author in every course of it, read every
 * fellow's work, and approve grades**; the owner can additionally archive the program, delete it,
 * decide who teaches which course, remove another instructor, hand ownership on, and replace either
 * link. Ownership exists because a program with two instructors has actions with reach beyond the
 * person performing them, and until it existed anybody who taught could remove the person who set
 * it up.
 *
 * **Ownership is a program fact rather than a course fact**, which is why this moved up with the
 * rest. Every action it gates is about the matriculation — who is on the roster, who teaches what,
 * whether the term is over — and none of them is about one course in isolation.
 *
 * **The derivation lives here and nowhere else.** The settings screen draws a badge and several
 * procedures refuse on the same question; computed separately, the day they disagree is the day
 * somebody is shown they own a program by a screen that a procedure then refuses them on. Same
 * reasoning as `triageBucket` being the one authority on what is outstanding.
 *
 * An admin is above all of it. `assertTeaches` already lets an admin act on any course and this does
 * not narrow that, deliberately: an admin is the recovery path for an owner who left the school
 * without handing the program on, and without one every rule here is a way for a matriculation to
 * end up with nobody who can administer it.
 */

/** The part of a `ProgramInstructor` row that decides ownership. */
type InstructorRow = {
  userId: string;
  isPrimary: boolean;
  createdAt: Date;
};

/**
 * The owner among a program's instructors, or null when it has none at all.
 *
 * **`isPrimary` if a row holds it, and the longest-serving instructor if none does.** The fallback
 * is not a nicety. `ProgramInstructor` cascades on the profile, so deleting an owner's account takes
 * their row with it — and a program would be left with instructors, an owner of nobody, and no one
 * able to archive it or remove anybody. Nothing in the application deletes a profile; that is a
 * database action somebody takes by hand, which is exactly why this has to hold with nobody there
 * to invoke it.
 *
 * Promoting an admin instead would be worse. An admin's reach comes from the role rather than from a
 * `ProgramInstructor` row, so writing one would put every orphaned program into that admin's own
 * list as a program they instruct.
 *
 * At most one row can hold `isPrimary` — a partial unique index on `program_instructors` says so —
 * so finding the first is finding the only. The tie-break on the fallback is for determinism rather
 * than for correctness: two rows can share a `createdAt` to the microsecond, and an owner who
 * depends on row order is an owner who changes between two reads.
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

/** The owner's profile id, or null for a program with no instructors left. */
export async function programOwnerId(db: Db, programId: string): Promise<string | null> {
  const instructors = await db.programInstructor.findMany({
    where: { programId },
    select: { userId: true, isPrimary: true, createdAt: true },
  });

  return ownerOf(instructors)?.userId ?? null;
}

/**
 * Refuses unless the caller owns this program. Admins own none of them and may do anything.
 *
 * `action` completes the sentence "Only ... can ___ it", so it reads as an instruction rather than
 * as a permission code: somebody refused here needs to know who to ask, which is why the message
 * names the owner when there is one to name.
 */
export async function assertOwnsProgram(
  ctx: AuthedCtx,
  programId: string,
  action: string,
): Promise<void> {
  if (ctx.profile.role === "ADMIN") return;

  const instructors = await ctx.db.programInstructor.findMany({
    where: { programId },
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
    A program with no instructors is refused rather than opened up, and it is not the same refusal
    as being the wrong instructor. It should not be reachable — `removeInstructor` refuses to empty
    the list — so a caller who reaches it has found something wrong, and telling them to ask the
    owner would be telling them to ask nobody.
  */
  if (!owner) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `This program has no instructors, so nobody can ${action} it. An admin has to add ` +
        `one first.`,
    });
  }

  const name =
    owner.user.displayName ?? owner.user.githubUsername ?? owner.user.email ?? "its owner";

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Only ${name} can ${action} this program, because they own it.`,
  });
}

/**
 * The same refusal, for an action named against a course rather than against its program.
 *
 * Archiving one course of a matriculation is an owner's act like archiving the whole of it, and the
 * person refused should be told about the course they were looking at rather than about the program
 * above it. One extra lookup, so that no caller has to resolve the program itself and then remember
 * which of the two words the message should use.
 */
export async function assertOwnsProgramOfCourse(
  ctx: AuthedCtx,
  courseId: string,
  action: string,
): Promise<void> {
  if (ctx.profile.role === "ADMIN") return;

  const course = await ctx.db.course.findUnique({
    where: { id: courseId },
    select: { programId: true },
  });

  if (!course) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That course does not exist." });
  }

  await assertOwnsProgram(ctx, course.programId, action);
}
