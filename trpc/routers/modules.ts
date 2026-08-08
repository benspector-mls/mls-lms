import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertCourseMember, assertTeaches } from "@/lib/courses/membership";

import { createTRPCRouter, instructorProcedure, profileProcedure } from "../init";

/**
 * The modules of a course: create, rename, reorder, remove.
 *
 * A module is a row an instructor names, tied to nothing outside the application. It used to
 * be a tag that also addressed a directory in the answer-keys repository, which is why a
 * course's module list could not be corrected at all — correcting it moved where grading
 * looked for answer keys.
 *
 * **The id is the identity.** Renaming is one column and every assignment goes on pointing at
 * the same row. That is the whole reason this is a table rather than a list of strings, and it
 * is why rename is here at all rather than being ruled out as too expensive.
 *
 * Every write is `instructorProcedure` *and* checks the caller teaches this course. The role
 * alone would let one cohort's instructor rename another's modules.
 */

/** Trimmed, because " Mod 4" and "Mod 4" are the same module to everyone but the database. */
const moduleName = z.string().trim().min(1, "A module needs a name.").max(120);

/**
 * The module, if the caller teaches the course it belongs to.
 *
 * Loading the row first is what makes the course-level check possible at all: every mutation
 * below takes a module id, and a module id says nothing about which course it is in until the
 * row is read.
 */
async function loadTeachableModule(
  ctx: { db: typeof import("@/lib/prisma").db; profile: { id: string; role: string } },
  moduleId: string,
) {
  const found = await ctx.db.module.findUnique({
    where: { id: moduleId },
    select: { id: true, courseId: true, name: true, position: true },
  });

  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Module not found." });
  await assertTeaches(ctx, found.courseId);
  return found;
}

/** A duplicate name is the one collision the database refuses; say so in words. */
function refuseDuplicate(err: unknown, name: string): never {
  const code = (err as { code?: string }).code;
  if (code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This course already has a module called "${name}".`,
    });
  }
  throw err;
}

export const modulesRouter = createTRPCRouter({
  /**
   * Every module of a course, in order, with how many assignments each holds.
   *
   * `profileProcedure` rather than instructor-only: a student's course page groups their
   * assignments by module, so both sides read this. It carries nothing a student should not
   * see — a module is a name and a position.
   */
  listForCourse: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Membership rather than teaching, and checked because Prisma bypasses row level
      // security: without it any signed-in user could read any course's modules by id. A
      // removed student is admitted — the course stays readable to them, and its module
      // sequence is how their own assignment list is ordered.
      const membership = await assertCourseMember(ctx, input.courseId);

      /*
        Whether unpublished assignments come back, which is the reason this procedure reads
        the membership rather than discarding it.

        It admits students, so returning every assignment would hand a cohort the ones their
        instructor is still writing — the exact thing `distributedAt` exists to prevent, and
        a leak that no screen would reveal because a student's own page reads a different
        procedure. Same rule and same shape as `assignments.listForCourse`.
      */
      const teaches = membership.as !== "student";

      return ctx.db.module.findMany({
        where: { courseId: input.courseId },
        // Name as the tie-break, so two modules that somehow share a position still have a
        // stable order rather than one that changes between requests.
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          position: true,
          /*
            **Every assignment, published or not, and deliberately not the length of the list
            below.** This count is what decides whether a module can be removed, and the
            foreign key refuses on all of them — so a count narrowed to what the caller can
            see would offer an instructor a Remove button on a module full of drafts and then
            have the procedure refuse it.
          */
          _count: { select: { assignments: true } },
          /**
           * What is in each module, for the screen that shows the course's shape.
           *
           * Ordered the way a student meets it: by due date, earliest first, with undated
           * work **last**. `nulls: 'last'` is explicit rather than left to the database's
           * default, because the rule is a decision — no due date is not earlier or later
           * than every date, it is outside the ordering — and a default that changes is a
           * silent reordering of every course page.
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
           * What is in the module that is not work.
           *
           * Alphabetical, and **no publish filter** — unlike the assignments above. There is no
           * draft state on a resource at all, so the same rows go to a student and an
           * instructor. That is a decision rather than an omission: handing out an assignment
           * starts a clock and creates work, and a link to a reading does neither.
           *
           * Titles and kinds only. This feeds the count and the non-interactive list on the
           * Modules screen; the body of a note and the id of a video are what
           * `resources.listForCourse` is for, and shipping a term's markdown to a screen that
           * renders none of it would be a page of prose nobody asked for.
           */
          resources: {
            orderBy: { title: "asc" },
            select: { id: true, title: true, kind: true },
          },
        },
      });
    }),

  /** Adds a module at the end. Position is assigned here, never sent by the browser. */
  create: instructorProcedure
    .input(z.object({ courseId: z.string().uuid(), name: moduleName }))
    .mutation(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);

      const last = await ctx.db.module.findFirst({
        where: { courseId: input.courseId },
        orderBy: { position: "desc" },
        select: { position: true },
      });

      try {
        return await ctx.db.module.create({
          data: {
            courseId: input.courseId,
            name: input.name,
            position: (last?.position ?? -1) + 1,
          },
          select: { id: true, name: true, position: true },
        });
      } catch (err) {
        refuseDuplicate(err, input.name);
      }
    }),

  /**
   * Renames a module.
   *
   * The operation the old design could not offer. With the name as the identity a rename meant
   * rewriting every assignment that used it and still could not fix anything outside the
   * database; here it is one column and nothing else moves.
   */
  rename: instructorProcedure
    .input(z.object({ moduleId: z.string().uuid(), name: moduleName }))
    .mutation(async ({ ctx, input }) => {
      await loadTeachableModule(ctx, input.moduleId);

      try {
        return await ctx.db.module.update({
          where: { id: input.moduleId },
          data: { name: input.name },
          select: { id: true, name: true, position: true },
        });
      } catch (err) {
        refuseDuplicate(err, input.name);
      }
    }),

  /**
   * Rewrites the whole order from a list of module ids.
   *
   * The full sequence rather than "move this one up", for two reasons. Swapping two positions
   * needs either a deferred unique constraint or no constraint, and any partial update leaves
   * an order that is briefly wrong; rewriting every position from a list nobody has to
   * interpret is idempotent, and the same procedure serves up-and-down buttons today and
   * dragging later.
   *
   * The list must be exactly this course's modules. A subset would leave the omitted ones
   * holding stale positions, which is an order nobody asked for.
   */
  reorder: instructorProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        moduleIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTeaches(ctx, input.courseId);

      const existing = await ctx.db.module.findMany({
        where: { courseId: input.courseId },
        select: { id: true },
      });

      const sent = new Set(input.moduleIds);
      if (sent.size !== input.moduleIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That order lists a module twice." });
      }
      if (sent.size !== existing.length || !existing.every((moduleRow) => sent.has(moduleRow.id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That order does not list exactly this course’s modules. Reload the page and try " +
            "again — someone may have added or removed one.",
        });
      }

      /*
        One statement, which is what makes this atomic without opening a transaction.

        The obvious implementation is one `update` per module inside `$transaction`, and it has
        two problems. A half-applied order is worse than none — the page would show two modules
        in the same place with no way to tell which move failed — and Prisma refuses a nested
        interactive transaction, so any caller already inside one (every verification script,
        and anything that later wants to reorder as part of a larger write) would fail outright.
        A single UPDATE is atomic by definition and composes with whatever is above it.

        `course_id` is in the predicate as well as checked above. Validation already refuses a
        list that is not exactly this course's modules; this means that even if it did not, the
        statement still cannot touch another course's rows.
      */
      await ctx.db.$executeRaw`
        UPDATE modules AS m
           SET position = ordered.position, updated_at = now()
          FROM (
            SELECT id, position
              FROM unnest(${input.moduleIds}::text[], ${input.moduleIds.map((_, i) => i)}::int[])
                AS t(id, position)
          ) AS ordered
         WHERE m.id::text = ordered.id
           AND m.course_id = ${input.courseId}::uuid
      `;

      return { count: input.moduleIds.length };
    }),

  /**
   * Removes an empty module.
   *
   * **Refused while any assignment references it**, naming the count. The foreign key is
   * `RESTRICT`, so the database refuses this too — but a foreign-key violation reaching an
   * instructor as an error is not an answer, and the count is what tells them what to move.
   *
   * The same shape as `assignments.update` refusing a repository-name change once anybody has
   * accepted: allowing it would leave assignments pointing at nothing, in a state nobody would
   * connect back to a module they deleted.
   */
  remove: instructorProcedure
    .input(z.object({ moduleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const found = await loadTeachableModule(ctx, input.moduleId);

      const assignments = await ctx.db.assignment.count({
        where: { moduleId: input.moduleId },
      });

      if (assignments > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `"${found.name}" still holds ${assignments} ` +
            `${assignments === 1 ? "assignment" : "assignments"}. Move them to another module ` +
            `first — removing this would leave them belonging to nothing.`,
        });
      }

      await ctx.db.module.delete({ where: { id: input.moduleId } });

      // Positions are left with a gap rather than renumbered. Order is what `position`
      // decides and a gap does not change it, so renumbering would be a write that changes
      // nothing an instructor can see.
      return { id: found.id, name: found.name };
    }),
});
