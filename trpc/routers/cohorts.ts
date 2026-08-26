import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { teachableCohort } from "@/lib/courses/scope";

import { createTRPCRouter, instructorProcedure, programProcedure } from "../init";
import { personSelect } from "../selects";

/**
 * The cohorts of a program: create, rename, remove, and who is in one.
 *
 * A cohort is a named division of one program's roster and nothing else. It has no instructor, it
 * grants no permission, and it decides nothing about who may grade — an instructor picks one and
 * the four screens that answer "what is left" narrow to it. Splitting a roster between co-teachers
 * is what it is for, and that works because the piles stop overlapping rather than because anything
 * is refused: a co-teacher covering for somebody else must still be able to approve their drafts,
 * so nothing here is ever consulted for permission.
 *
 * **A cohort belongs to the program, which is the change that made this worth doing.** The division
 * of a roster between instructors was never a per-course fact, so rebuilding it inside every course
 * of a program produced the same answer several times over. One cohort now narrows every
 * course an instructor teaches.
 *
 * **A fellow is in at most one cohort, and that is a column rather than a join table.** So there is
 * no membership to add and remove: `setPlacements` writes `Enrollment.cohortId`, and the partition
 * is true by construction rather than by a constraint on rows that could briefly disagree.
 *
 * **Instructor-only, and fellow-facing nowhere.** There is no procedure here a fellow can call,
 * deliberately. Showing somebody their cohort-mates is the first read that would disclose a slice of
 * a roster, and it only starts to matter when fellows work together — which is what a team set is
 * for. A cohort that exists only to split the marking is not meant to be seen.
 *
 * Every write is `programProcedure` or `instructorProcedure` with a `teachableCohort` load. The role
 * alone would let one program's instructor reassign another's fellows. There is no owner check
 * anywhere: cohorts are not owned, so there is nothing here for ownership to gate.
 */

/** Trimmed, because " Cohort A" and "Cohort A" are the same cohort to everyone but the database. */
const cohortName = z.string().trim().min(1, "A cohort needs a name.").max(120);

/** A duplicate name is the one collision the database refuses; say so in words. */
function refuseDuplicate(err: unknown, name: string): never {
  const code = (err as { code?: string }).code;
  if (code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This program already has a cohort called "${name}".`,
    });
  }
  throw err;
}

export const cohortsRouter = createTRPCRouter({
  /**
   * Every cohort of a program, by name, with how many active fellows each holds.
   *
   * **The count is of active fellows only**, which is the same restriction every filtered read
   * applies. A removed fellow keeps their cohort — removal is a status rather than a deleted row, so
   * restoring somebody returns them to the cohort they were in — but counting them here would say a
   * cohort holds fifteen while the pile it filters to holds fourteen, and the two numbers are meant
   * to be the same claim.
   *
   * Read by the picker on four screens, so it carries `cohortId`: which cohort the caller is
   * currently working, so the picker opens on it rather than having to ask separately.
   */
  listForProgram: programProcedure.query(async ({ ctx, input }) => {
    const [cohorts, instructorRow, unassigned] = await Promise.all([
      ctx.db.cohort.findMany({
        where: { programId: input.programId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          _count: { select: { fellows: { where: { status: "ACTIVE" } } } },
        },
      }),
      /*
        Null for an admin, who has no `ProgramInstructor` row in any program and therefore nowhere
        to remember a selection. That is the right answer rather than a gap: an admin reading
        somebody else's program is looking rather than working it, and the picker simply opens
        on All Fellows each time.
      */
      ctx.db.programInstructor.findFirst({
        where: { programId: input.programId, userId: ctx.profile.id },
        select: { cohortId: true },
      }),
      /*
        Active fellows in no cohort at all. Its own count rather than the roster total minus the
        cohort counts — which would in fact be right now that a cohort is a partition, and is still
        not worth relying on: the subtraction would silently start lying the day anything else
        filtered the roster, and this is one indexed count.
      */
      ctx.db.enrollment.count({
        where: { programId: input.programId, status: "ACTIVE", cohortId: null },
      }),
    ]);

    return {
      cohorts: cohorts.map(({ _count, ...cohort }) => ({
        ...cohort,
        memberCount: _count.fellows,
      })),
      /** How many active fellows belong to no cohort, for the picker's No cohort entry. */
      unassignedCount: unassigned,
      /** The caller's remembered selection. Null is All Fellows. */
      cohortId: instructorRow?.cohortId ?? null,
    };
  }),

  /**
   * Every active fellow of a program with the cohort each is in, for the management screen.
   *
   * One row per fellow, so an instructor sees who is in nothing without having to compare two
   * lists. Removed fellows are absent — they are not who dividing a roster is about, and the roster
   * shows them in their own table anyway.
   */
  membershipsForProgram: programProcedure.query(async ({ ctx, input }) => {
    const enrollments = await ctx.db.enrollment.findMany({
      where: { programId: input.programId, status: "ACTIVE" },
      select: {
        id: true,
        cohortId: true,
        student: { select: personSelect },
      },
    });

    return enrollments.map((enrollment) => ({
      enrollmentId: enrollment.id,
      student: enrollment.student,
      cohortId: enrollment.cohortId,
    }));
  }),

  create: programProcedure
    .input(z.object({ name: cohortName }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.cohort.create({
          data: { programId: input.programId, name: input.name },
          select: { id: true, name: true },
        });
      } catch (err) {
        refuseDuplicate(err, input.name);
      }
    }),

  /**
   * Renames a cohort.
   *
   * Free, and the reason a cohort is a row with an id rather than a string on the enrollment: every
   * fellow in it and every instructor filtered to it goes on pointing at the same row.
   */
  rename: instructorProcedure
    .input(z.object({ cohortId: z.string().uuid(), name: cohortName }))
    .mutation(async ({ ctx, input }) => {
      await teachableCohort(ctx, input.cohortId, { id: true });

      try {
        return await ctx.db.cohort.update({
          where: { id: input.cohortId },
          data: { name: input.name },
          select: { id: true, name: true },
        });
      } catch (err) {
        refuseDuplicate(err, input.name);
      }
    }),

  /**
   * Removes a cohort, however many fellows are in it.
   *
   * **Not refused on a non-empty cohort**, which is the opposite of `courseUnits.remove` and is
   * right for the opposite reason. Removing a unit would leave its assignments belonging to nothing;
   * removing a cohort dissolves a set and touches no fellow, no submission, and no grade — every
   * fellow stays exactly where they were, unassigned. The count comes back so the confirmation can
   * say what it dissolved.
   *
   * **Its fellows are cleared first, in a transaction, because the database refuses otherwise.**
   * `Enrollment.cohortId` is half of a two-column foreign key, and `SET NULL` on one of those nulls
   * both columns — `programId` among them, which is NOT NULL. So the key is `RESTRICT` and this is
   * the clearing it demands. The transaction is what stops a failed delete from leaving a roster
   * unassigned with the cohort still standing.
   *
   * Any instructor filtered to it is returned to All Fellows by `onDelete: SetNull` on their own
   * single-column key, rather than being left holding an id that no longer resolves.
   */
  remove: instructorProcedure
    .input(z.object({ cohortId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const found = await teachableCohort(ctx, input.cohortId, { id: true, name: true });

      const memberCount = await ctx.db.$transaction(async (tx) => {
        const cleared = await tx.enrollment.updateMany({
          where: { cohortId: input.cohortId },
          data: { cohortId: null },
        });
        await tx.cohort.delete({ where: { id: input.cohortId } });
        return cleared.count;
      });

      return { id: found.id, name: found.name, memberCount };
    }),

  /**
   * Places every named fellow in a cohort, or in none.
   *
   * The whole placement rather than "move this one", for the same reason `courseUnits.reorder` takes
   * the whole order: it is idempotent, it cannot leave a half-applied state, and the screen sends
   * what it is showing rather than a diff it computed itself.
   *
   * **Every id must be an active enrollment on this program's roster**, and every cohort must belong
   * to this program — both checked rather than trusted. The composite foreign key already makes a
   * fellow in another program's cohort unrepresentable, so this is not what protects the invariant;
   * it is what turns the database's refusal into a sentence an instructor can act on.
   *
   * **Grouped by target and written as one statement per cohort**, which is a handful of statements
   * for any real roster. No transaction around them, for the reason `courseUnits.reorder` has none:
   * Prisma refuses a nested interactive transaction, so one here would fail outright for every check
   * script and for anything that later wants to place fellows as part of a larger write. Writing by
   * target is what makes doing it without one safe — each statement moves a set of fellows to one
   * cohort, so a failure part way through leaves some fellows moved and none in a cohort nobody
   * chose, and the screen shows what actually happened when it refetches.
   */
  setPlacements: programProcedure
    .input(
      z.object({
        placements: z.array(
          z.object({
            enrollmentId: z.string().uuid(),
            cohortId: z.string().uuid().nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Last mention of a fellow wins, so a screen that somehow sent one twice is not a refusal.
      const byEnrollment = new Map(
        input.placements.map((placement) => [placement.enrollmentId, placement.cohortId]),
      );

      const wanted = [...byEnrollment.keys()];
      const targets = [...new Set([...byEnrollment.values()].filter((id) => id !== null))];

      /*
        Active only. A removed fellow keeps the cohort they were already in, but placing one is a
        different act — it would put somebody who has left into a pile that exists to say what is
        waiting on an instructor, and nothing would ever clear it.
      */
      const valid = await ctx.db.enrollment.findMany({
        where: { id: { in: wanted }, programId: input.programId, status: "ACTIVE" },
        select: { id: true },
      });

      if (valid.length !== wanted.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That list names somebody who is not an active fellow of this program. Reload the " +
            "page and try again — the roster may have changed since it was opened.",
        });
      }

      if (targets.length > 0) {
        const cohorts = await ctx.db.cohort.findMany({
          where: { id: { in: targets }, programId: input.programId },
          select: { id: true },
        });

        if (cohorts.length !== targets.length) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That list names a cohort that does not belong to this program.",
          });
        }
      }

      // One statement per distinct target, including the unassigned group.
      const groups = new Map<string | null, string[]>();
      for (const [enrollmentId, cohortId] of byEnrollment) {
        const bucket = groups.get(cohortId);
        if (bucket) bucket.push(enrollmentId);
        else groups.set(cohortId, [enrollmentId]);
      }

      for (const [cohortId, enrollmentIds] of groups) {
        await ctx.db.enrollment.updateMany({
          where: { id: { in: enrollmentIds }, programId: input.programId },
          data: { cohortId },
        });
      }

      return { placed: wanted.length, cohorts: targets.length };
    }),

  /**
   * Remembers which cohort the caller is working in this program.
   *
   * A filter and nothing more: it grants nothing, withholds nothing, and any instructor changes
   * their own at any moment. **One value for the whole program** rather than one per course, which
   * is the duplication moving cohorts up removed — the fact it records is "I grade these fifteen
   * fellows" and never "in this course I grade these fifteen".
   *
   * **Null is All Fellows, and No cohort is not storable.** Unassigned is a check — who has nobody
   * yet — rather than a way of working, so choosing it filters the screen in front of you and leaves
   * this alone. Making it storable would mean a sentinel in a foreign key column to record a state
   * nobody wants to return to.
   *
   * Silently does nothing for an admin, who has no `ProgramInstructor` row to write to. That is the
   * honest outcome rather than an error: an admin can still filter any screen through the query
   * string, and inventing a row for them would put the program into their own list as one they
   * instruct.
   */
  setCohort: programProcedure
    .input(z.object({ cohortId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      /*
        Checked rather than left to the foreign key, which is a plain one here — see
        `ProgramInstructor.cohortId` for why it cannot be composite — and would accept a cohort
        belonging to any program. Stored, that is a remembered filter matching no enrollment on this
        roster: an empty screen on every visit, which reads as being caught up.
      */
      if (input.cohortId) {
        const cohort = await ctx.db.cohort.findFirst({
          where: { id: input.cohortId, programId: input.programId },
          select: { id: true },
        });

        if (!cohort) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That cohort does not belong to this program.",
          });
        }
      }

      const updated = await ctx.db.programInstructor.updateMany({
        where: { programId: input.programId, userId: ctx.profile.id },
        data: { cohortId: input.cohortId },
      });

      return { cohortId: input.cohortId, remembered: updated.count > 0 };
    }),
});
