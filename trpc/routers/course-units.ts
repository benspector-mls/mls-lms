import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertCourseMember } from "@/lib/courses/membership";
import { teachableCourseUnit } from "@/lib/courses/scope";
import { CATEGORY_META } from "@/lib/course-units";
import { CourseUnitCategory } from "@/lib/generated/prisma/enums";
import { inTransaction, type Tx } from "@/lib/prisma";

import { courseProcedure, createTRPCRouter, instructorProcedure, profileProcedure } from "../init";
import { courseUnitSummarySelect, resourceSelect } from "../selects";

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
 * alone would let one program's instructor rename another's units.
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

/**
 * Where a new unit goes in the course's one sequence.
 *
 * **A unit to sit after, rather than a number.** Position is still assigned by the server and
 * never sent by the browser, which is what keeps one sequence consistent while three categories
 * are being added to it. It also makes a stale choice a refusal instead of a surprise: an anchor
 * that another instructor has since removed cannot land this unit somewhere nobody picked.
 *
 * Defaulting to the end is what it means for a course to grow through a term, and it is what
 * every existing caller wants — the `verify:*` scripts create a dozen units without caring where
 * any of them lands.
 */
const placement = z
  .discriminatedUnion("at", [
    z.object({ at: z.literal("end") }),
    z.object({ at: z.literal("start") }),
    z.object({ at: z.literal("after"), courseUnitId: z.string().uuid() }),
  ])
  .default({ at: "end" });

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

/**
 * Rewrites every position in a course from a list of ids, in one statement.
 *
 * **One statement, which is what makes it atomic on its own.** The obvious implementation is one
 * `update` per unit, and a half-applied order is worse than none — the page would show two units
 * in the same place with no way to tell which move failed. A single UPDATE cannot half-apply, so
 * it composes with whatever transaction is above it and needs none of its own.
 *
 * **Shared by `reorder` and `create`, so one place writes a position.** Creating a unit anywhere
 * but the end is a change to the sequence, and the sequence has one definition — a second way to
 * write it is how two screens come to disagree about what order the course is in.
 *
 * `course_id` is in the predicate as well as being checked by the callers. `reorder` already
 * refuses a list that is not exactly this course's units; this means that even if it did not, the
 * statement still cannot touch another course's rows.
 *
 * Takes a `Tx` rather than the module's client, because both callers may be running inside a
 * transaction that is not theirs — see `inTransaction` in lib/prisma.ts.
 */
async function writeOrder(tx: Tx, courseId: string, courseUnitIds: string[]): Promise<void> {
  await tx.$executeRaw`
    UPDATE course_units AS u
       SET position = ordered.position, updated_at = now()
      FROM (
        SELECT id, position
          FROM unnest(${courseUnitIds}::text[], ${courseUnitIds.map((_, i) => i)}::int[])
            AS t(id, position)
      ) AS ordered
     WHERE u.id::text = ordered.id
       AND u.course_id = ${courseId}::uuid
  `;
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
              // Read by the row's icon, which says what a fellow hands in — a question the kind
              // alone cannot answer once one kind accepts a link, a file, or either.
              handInMethods: true,
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
           *
           * **The whole resource rather than its title and kind**, because the Curriculum screen
           * opens each one the way a student meets it — a note renders where it sits and a video
           * plays there. A row that carried only a name could say a note exists and never show
           * what is in it, which is the one thing an instructor checking their own course wants
           * to read.
           */
          resources: {
            orderBy: { title: "asc" },
            select: resourceSelect,
          },
        },
      });
    }),

  /**
   * Adds a unit to the course, at the end or at a chosen place in the sequence.
   *
   * The category is the only thing that differs between creating a module, a project, and an
   * assessment, which is why there is one procedure rather than three. Position is assigned here,
   * never sent by the browser — `placement` names a unit to sit after, and the integers are this
   * procedure's business.
   *
   * **Placement is here rather than being a move the instructor makes afterwards**, because a new
   * unit belongs where it falls in the term and the up-and-down buttons cost one round trip per
   * position. A project added to a course of ten units and belonging after Mod 4 was six clicks
   * and six writes; it is now one.
   */
  create: courseProcedure
    .input(z.object({ name: unitName, category, overview, placement }))
    .mutation(async ({ ctx, input }) => {
      /*
        One transaction, because placing a unit anywhere but the end is an insert *and* a rewrite
        of the sequence, and half of that pair is a course in an order nobody chose.

        `inTransaction` rather than `ctx.db.$transaction`: a `verify:*` script drives these
        procedures with `ctx.db` already bound to its own transaction, and a transaction client
        still carries `$transaction` at runtime — calling it would open a second transaction on a
        different connection that cannot see the script's own uncommitted rows. See lib/prisma.ts.
      */
      return inTransaction(ctx.db, async (tx) => {
        /*
          The sequence as it stands, in the order `listForCourse` presents it, read inside the
          transaction so the order written below is the one the insert actually happened against.
        */
        const existing = await tx.courseUnit.findMany({
          where: { courseId: input.courseId },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          select: { id: true, position: true },
        });

        /*
          Where in that list the new unit goes. `existing.length` is the end.

          Destructured to a `const` because the narrowing has to survive into the callback below:
          TypeScript discards what it knows about `input.placement.at` inside a closure, since
          `input` is a parameter it cannot prove nobody reassigns.
        */
        const { placement: where } = input;
        let index: number;
        if (where.at === "end") {
          index = existing.length;
        } else if (where.at === "start") {
          index = 0;
        } else {
          const anchor = existing.findIndex((unit) => unit.id === where.courseUnitId);
          /*
            Refused rather than falling back to the end. The list this came from is a list of this
            course's units, so a miss means the anchor was removed or belongs to another course —
            and quietly appending would put the unit somewhere the instructor did not ask for and
            would not think to check.
          */
          if (anchor === -1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "The unit you chose to place this after is no longer in this course. " +
                "Reload the page and try again.",
            });
          }
          index = anchor + 1;
        }

        /*
          Inserted at the end first, whatever the placement. `existing` is ordered ascending, so
          its last position is the highest one — and a course with gaps in its positions, which
          `remove` leaves behind deliberately, still gets a row that sorts last rather than one
          that ties with a unit already there.
        */
        const last = existing.at(-1)?.position ?? -1;
        const created = await tx.courseUnit
          .create({
            data: {
              courseId: input.courseId,
              name: input.name,
              category: input.category,
              overview: input.overview,
              position: last + 1,
            },
            select: courseUnitSummarySelect,
          })
          .catch((err) => refuseDuplicate(err, input.name));

        /*
          Then the sequence is rewritten with the new id spliced in — but only when that changes
          something. Placing at the end, and placing after the unit that is already last, are the
          same request as the insert above has already satisfied.
        */
        if (index < existing.length) {
          const ordered = existing.map((unit) => unit.id);
          ordered.splice(index, 0, created.id);
          await writeOrder(tx, input.courseId, ordered);
        }

        return created;
      });
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

      await writeOrder(ctx.db, input.courseId, input.courseUnitIds);

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
