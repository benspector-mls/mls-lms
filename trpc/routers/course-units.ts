import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertCourseMember } from "@/lib/courses/membership";
import { teachableCourseUnit } from "@/lib/courses/scope";
import { CATEGORY_META } from "@/lib/course-units";
import { CourseUnitCategory } from "@/lib/generated/prisma/enums";

import { courseProcedure, createTRPCRouter, instructorProcedure, profileProcedure } from "../init";
import { courseUnitSummarySelect } from "../selects";

/**
 * The units of a course — modules, projects, and assessments — and everything inside them.
 *
 * **All three are the same thing**, differing only in what the container is for, so this is one
 * router rather than three. A project used to be a separate table living inside a module, which
 * gave an assignment two possible parents and needed procedures to move work between them; a
 * project is now a unit like any other and an assignment names it directly.
 *
 * **The id is the identity.** Renaming is one column and every assignment goes on pointing at the
 * same row. That is the whole reason this is a table rather than a list of strings, and it is why
 * rename is here at all rather than being ruled out as too expensive.
 *
 * Every write is `instructorProcedure` *and* checks the caller teaches this course. The role
 * alone would let one cohort's instructor rename another's units.
 */

/** Trimmed, because " Mod 4" and "Mod 4" are the same unit to everyone but the database. */
const unitName = z.string().trim().min(1, "This needs a name.").max(120);

/**
 * What the unit is, in markdown. Empty becomes null rather than `""`, so there is one way to say
 * "nothing written here" instead of two that every screen would have to test.
 */
const overview = z
  .string()
  .trim()
  .max(10_000)
  .nullable()
  .default(null)
  .transform((value) => (value === "" ? null : value));

const category = z.enum(CourseUnitCategory);

/** A duplicate name is the one collision the database refuses; say so in words. */
function refuseDuplicate(err: unknown, name: string): never {
  const code = (err as { code?: string }).code;
  if (code === "P2002") {
    /*
      Course-wide rather than per category, which is what the constraint enforces and what the
      message has to say. A module and a project sharing a name would be indistinguishable in
      every select an instructor picks from, so they get called "Mod 4" and "Mod 4 Project".
    */
    throw new TRPCError({
      code: "CONFLICT",
      message: `This course already has something called "${name}".`,
    });
  }
  throw err;
}

export const courseUnitsRouter = createTRPCRouter({
  /**
   * Every unit of a course, in order, with what is in it.
   *
   * `profileProcedure` rather than instructor-only: a student's course page is this list, so both
   * sides read it. It carries nothing a student should not see — a unit is a name, a category, a
   * position, and an overview.
   *
   * **One sequence across all three categories**, so a project sits between Mod 3 and Mod 4 where
   * it falls in the term rather than at the end of a list of its own.
   */
  listForCourse: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Membership rather than teaching, and checked because Prisma bypasses row level
      // security: without it any signed-in user could read any course's units by id. A
      // removed student is admitted — the course stays readable to them, and its sequence is
      // how their own assignment list is ordered.
      const membership = await assertCourseMember(ctx, input.courseId);

      /*
        Whether unpublished assignments come back, which is the reason this procedure reads the
        membership rather than discarding it.

        It admits students, so returning every assignment would hand a cohort the ones their
        instructor is still writing — the exact thing `distributedAt` exists to prevent, and a
        leak that no screen would reveal because a student's own page reads this same procedure.
      */
      const teaches = membership.as !== "student";

      return ctx.db.courseUnit.findMany({
        where: { courseId: input.courseId },
        // Name as the tie-break, so two units that somehow share a position still have a stable
        // order rather than one that changes between requests.
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          ...courseUnitSummarySelect,
          overview: true,
          /*
            **Every assignment, published or not, and deliberately not the length of the list
            below.** This count is what decides whether a unit can be removed, and the foreign key
            refuses on all of them — so a count narrowed to what the caller can see would offer an
            instructor a Remove button on a unit full of drafts and then refuse it.
          */
          _count: { select: { assignments: true } },
          /**
           * What is in each unit, for the screens that show the course's shape.
           *
           * Ordered the way a student meets it: by due date, earliest first, with undated work
           * **last**. `nulls: 'last'` is explicit rather than left to the database's default,
           * because the rule is a decision — no due date is not earlier or later than every date,
           * it is outside the ordering — and a default that changes is a silent reordering of
           * every course page.
           */
          assignments: {
            where: teaches ? {} : { distributedAt: { not: null } },
            orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { title: "asc" }],
            select: {
              id: true,
              title: true,
              kind: true,
              pointValue: true,
              dueAt: true,
              distributedAt: true,
            },
          },
          /**
           * What is in the unit that is not work.
           *
           * Alphabetical, and **no publish filter** — unlike the assignments above. There is no
           * draft state on a resource at all, so the same rows go to a student and an instructor.
           * That is a decision rather than an omission: handing out an assignment starts a clock
           * and creates work, and a link to a reading does neither.
           */
          resources: {
            orderBy: { title: "asc" },
            select: { id: true, title: true, kind: true },
          },
        },
      });
    }),

  /**
   * Adds a unit at the end of the course.
   *
   * The category is the only thing that differs between creating a module, a project, and an
   * assessment, which is why there is one procedure rather than three. Position is assigned here,
   * never sent by the browser.
   */
  create: courseProcedure
    .input(z.object({ name: unitName, category, overview }))
    .mutation(async ({ ctx, input }) => {
      const last = await ctx.db.courseUnit.findFirst({
        where: { courseId: input.courseId },
        orderBy: { position: "desc" },
        select: { position: true },
      });

      try {
        return await ctx.db.courseUnit.create({
          data: {
            courseId: input.courseId,
            name: input.name,
            category: input.category,
            overview: input.overview,
            position: (last?.position ?? -1) + 1,
          },
          select: courseUnitSummarySelect,
        });
      } catch (err) {
        refuseDuplicate(err, input.name);
      }
    }),

  /**
   * Renames a unit, or rewrites its overview.
   *
   * **The category is deliberately not editable.** A module and a project differ only in what
   * they are called, so changing it would be harmless — and it would also move the thing between
   * two gradebook tabs, which is a surprising amount of movement for a dropdown. Removing it and
   * making the other says what happened.
   */
  update: instructorProcedure
    .input(z.object({ courseUnitId: z.string().uuid(), name: unitName, overview }))
    .mutation(async ({ ctx, input }) => {
      await teachableCourseUnit(ctx, input.courseUnitId, { id: true });

      try {
        return await ctx.db.courseUnit.update({
          where: { id: input.courseUnitId },
          data: { name: input.name, overview: input.overview },
          select: courseUnitSummarySelect,
        });
      } catch (err) {
        refuseDuplicate(err, input.name);
      }
    }),

  /**
   * Rewrites the whole order from a list of unit ids.
   *
   * The full sequence rather than "move this one up", for two reasons. Swapping two positions
   * needs either a deferred unique constraint or no constraint, and any partial update leaves an
   * order that is briefly wrong; rewriting every position from a list nobody has to interpret is
   * idempotent, and the same procedure serves up-and-down buttons today and dragging later.
   *
   * The list must be exactly this course's units — **every category of them**, because they share
   * one sequence. A subset would leave the omitted ones holding stale positions, which is an
   * order nobody asked for.
   */
  reorder: courseProcedure
    .input(z.object({ courseUnitIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.courseUnit.findMany({
        where: { courseId: input.courseId },
        select: { id: true },
      });

      const sent = new Set(input.courseUnitIds);
      if (sent.size !== input.courseUnitIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That order lists a unit twice." });
      }
      if (sent.size !== existing.length || !existing.every((unit) => sent.has(unit.id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That order does not list exactly this course’s modules, projects, and assessments. " +
            "Reload the page and try again — someone may have added or removed one.",
        });
      }

      /*
        One statement, which is what makes this atomic without opening a transaction.

        The obvious implementation is one `update` per unit inside `$transaction`, and it has two
        problems. A half-applied order is worse than none — the page would show two units in the
        same place with no way to tell which move failed — and Prisma refuses a nested interactive
        transaction, so any caller already inside one (every verification script, and anything
        that later wants to reorder as part of a larger write) would fail outright. A single
        UPDATE is atomic by definition and composes with whatever is above it.

        `course_id` is in the predicate as well as checked above. Validation already refuses a list
        that is not exactly this course's units; this means that even if it did not, the statement
        still cannot touch another course's rows.
      */
      await ctx.db.$executeRaw`
        UPDATE course_units AS u
           SET position = ordered.position, updated_at = now()
          FROM (
            SELECT id, position
              FROM unnest(${input.courseUnitIds}::text[], ${input.courseUnitIds.map((_, i) => i)}::int[])
                AS t(id, position)
          ) AS ordered
         WHERE u.id::text = ordered.id
           AND u.course_id = ${input.courseId}::uuid
      `;

      return { count: input.courseUnitIds.length };
    }),

  /**
   * Removes an empty unit.
   *
   * **Refused while any assignment references it**, naming the count. The foreign key is
   * `RESTRICT`, so the database refuses this too — but a foreign-key violation reaching an
   * instructor as an error is not an answer, and the count is what tells them what to move.
   *
   * Resources are not counted and do not refuse: they cascade. A resource carries nothing but a
   * title and a link, where an assignment carries submissions, approved grades, and feedback a
   * student has already read — see the two `onDelete` rules in the schema.
   */
  remove: instructorProcedure
    .input(z.object({ courseUnitId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const found = await teachableCourseUnit(ctx, input.courseUnitId, {
        id: true,
        name: true,
        category: true,
      });

      const assignments = await ctx.db.assignment.count({
        where: { courseUnitId: input.courseUnitId },
      });

      if (assignments > 0) {
        const meta = CATEGORY_META[found.category];
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `"${found.name}" still holds ${assignments} ` +
            `${assignments === 1 ? meta.partNoun : meta.partPluralNoun}. Move ` +
            `${assignments === 1 ? "it" : "them"} to another unit first — removing this would ` +
            `leave ${assignments === 1 ? "it" : "them"} belonging to nothing.`,
        });
      }

      await ctx.db.courseUnit.delete({ where: { id: input.courseUnitId } });

      // Positions are left with a gap rather than renumbered. Order is what `position` decides
      // and a gap does not change it, so renumbering would be a write that changes nothing an
      // instructor can see.
      return { id: found.id, name: found.name, category: found.category };
    }),
});
