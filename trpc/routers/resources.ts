import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertCourseMember } from "@/lib/courses/membership";
import { writeOrder } from "@/lib/courses/order";
import { teachableCourseUnit, teachableResource } from "@/lib/courses/scope";
import { resourceColumns, resourceSpecSchema, UnrecognisedVideoError } from "@/lib/resources/spec";
import type { Tx } from "@/lib/prisma";

import { createTRPCRouter, instructorProcedure, profileProcedure } from "../init";
import { resourceSelect } from "../selects";

/**
 * The things in a module that are not work: readings, notes, and videos.
 *
 * **Nothing here is graded, submitted, counted, or in the gradebook.** No procedure in this
 * file touches a submission, and none of the grading screens read it. That is the whole design:
 * a student's course page becomes the entire course rather than only the parts that are marked.
 *
 * A resource belongs to a module and to nothing else — there is no course-level resource,
 * because a student reads a course as a list of modules and something outside all of them has
 * nowhere to appear. So every mutation here reaches its course *through* the module, which is
 * also what makes the authorization check possible: a module id says nothing about which course
 * it is in until the row is read.
 *
 * **Visible as soon as it is added.** There is no `distributedAt`, no draft state, and no
 * publish step. An assignment has one because handing it out starts a clock and creates work; a
 * link to a reading does neither.
 *
 * **Ordered by hand, within one module.** A module's readings are a sequence an instructor chose,
 * and `position` records it — the same column, the same rules, and now the same statement as
 * `course_units`. Every position is assigned here and never sent by the browser: `create` puts a
 * resource at the end of its module, moving one to another module puts it at the end of that one,
 * and `reorder` is the only way an instructor changes a sequence.
 *
 * `reorder` is scoped to a module rather than a course, because a resource's sequence *is* its
 * module's sequence. Nothing about the order of Mod 3's readings has anything to say about Mod 4's,
 * and a course-wide list would make every drag send every resource in the course.
 */

/**
 * The position at the end of a module's list.
 *
 * The highest position rather than a count of rows, which is what keeps it right in a module whose
 * positions have a gap in them — `remove` leaves one deliberately, for the reason
 * `courseUnits.remove` does: order is what `position` decides, and a gap does not change it.
 *
 * **No transaction around the read and the write that follows it.** `courseUnits.create` needs one
 * because placing a unit is an insert *and* a rewrite of the sequence; both callers here are a read
 * and then one write. The only thing two simultaneous callers can produce is two resources sharing
 * a number in the same module, which every ordering in this file settles with the title and the
 * next drag rewrites. A transaction would be ceremony against a collision that costs nothing.
 */
async function endOfUnit(db: Tx, courseUnitId: string): Promise<number> {
  const last = await db.resource.findFirst({
    where: { courseUnitId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return (last?.position ?? -1) + 1;
}

/**
 * Turns a spec into columns, reporting an unrecognised video as something an instructor can act
 * on rather than as a five-hundred.
 *
 * Both writes go through it, so a URL the form somehow let past is still refused by the
 * procedure — the same division as everywhere else here: the interface warns, the procedure is
 * what actually refuses.
 */
function columnsOrRefuse(spec: z.infer<typeof resourceSpecSchema>) {
  try {
    return resourceColumns(spec);
  } catch (err) {
    if (err instanceof UnrecognisedVideoError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    }
    throw err;
  }
}

export const resourcesRouter = createTRPCRouter({
  /**
   * Every resource in a course, by module and then by the order the instructor put them in.
   *
   * `profileProcedure` and `assertCourseMember`, which is the same pair `modules.listForCourse`
   * uses and for the same reason: a student's own course page reads this. It admits a removed
   * student deliberately — the course stays readable to them, and taking the readings away
   * because they left the cohort would be taking back something they were shown.
   *
   * **No publish filter, unlike assignments.** There is no draft state to filter on, so this
   * returns the same rows to a student and an instructor. That is worth stating rather than
   * inferring, because the neighbouring procedure does the opposite and the difference is a
   * decision rather than an oversight.
   *
   * Ordered here rather than in the interface so the student page, the Modules screen, and the
   * Resources screen cannot each pick their own order.
   */
  listForCourse: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCourseMember(ctx, input.courseId);

      return ctx.db.resource.findMany({
        where: { courseUnit: { courseId: input.courseId } },
        /*
          Module order first, then the module's own sequence. Two sequences rather than one, and
          they nest: a resource's position is dense within its module and means nothing across
          two, so it is only ever compared against its neighbours.

          The title on the end is a tiebreak rather than an ordering. Two resources sharing a
          position is possible for as long as it takes the next drag to rewrite the sequence,
          and without this the two would come back in whatever order the planner chose — which
          is to say a different one on different days.
        */
        orderBy: [{ courseUnit: { position: "asc" } }, { position: "asc" }, { title: "asc" }],
        select: resourceSelect,
      });
    }),

  /**
   * Adds a resource to a module, at the end of it.
   *
   * **At the end, always**, and there is no placement input beside `courseUnitId` — which is the
   * one thing this does differently from `courseUnits.create`. A unit belongs where it falls in a
   * term, and walking a new one up a list of a dozen cost a write per position, which is what
   * `placement` exists to spare. A resource is dragged into place in one gesture, so the field
   * would be a second way to say what the drag already says.
   */
  create: instructorProcedure
    .input(z.object({ courseUnitId: z.string().uuid(), spec: resourceSpecSchema }))
    .mutation(async ({ ctx, input }) => {
      await teachableCourseUnit(ctx, input.courseUnitId, { id: true });

      return ctx.db.resource.create({
        data: {
          courseUnitId: input.courseUnitId,
          position: await endOfUnit(ctx.db, input.courseUnitId),
          ...columnsOrRefuse(input.spec),
        },
        select: resourceSelect,
      });
    }),

  /**
   * Edits a resource, including moving it to another module of the same course.
   *
   * **The kind can change**, which is why `resourceColumns` writes every column rather than the
   * ones the new kind uses: a note turned into a link would otherwise keep its `body`, and the
   * next reader to trust that column would render a row that is two things at once.
   *
   * **A resource that moves module lands at the end of the one it moves to.** Keeping its old
   * number would drop it into the middle of a sequence it has never been part of, at a position
   * that means nothing there — beside two resources an instructor deliberately put next to each
   * other, which is exactly where nobody would look for it.
   */
  update: instructorProcedure
    .input(
      z.object({
        resourceId: z.string().uuid(),
        /** Omitted leaves it where it is. Given, it must be a module of the same course. */
        courseUnitId: z.string().uuid().optional(),
        spec: resourceSpecSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await teachableResource(ctx, input.resourceId, {
        id: true,
        courseUnit: { select: { id: true, courseId: true } },
      });

      /*
        The module this is actually moving to, or null for an edit that leaves it where it is.
        The distinction matters twice below, and it is not the same question as whether the field
        was sent: the form carries the module it is showing whether or not the instructor touched
        it, so a plain rename arrives here naming the module the resource is already in.
      */
      const movingTo =
        input.courseUnitId && input.courseUnitId !== existing.courseUnit.id
          ? input.courseUnitId
          : null;

      /*
        Checked rather than left to the foreign key, which would happily accept a module from
        another course. A resource filed under another cohort's module is invisible on the
        course it belongs to and appears on one it does not — and nothing on either screen would
        explain it.
      */
      if (movingTo) {
        const target = await ctx.db.courseUnit.findFirst({
          where: { id: movingTo, courseId: existing.courseUnit.courseId },
          select: { id: true },
        });

        if (!target) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That module belongs to a different course.",
          });
        }
      }

      return ctx.db.resource.update({
        where: { id: input.resourceId },
        data: {
          /*
            The position comes with the module and only with it. A rename that also rewrote the
            position would send a resource to the bottom of the list it is already in, every time
            anybody fixed a typo in its title.
          */
          ...(movingTo
            ? { courseUnitId: movingTo, position: await endOfUnit(ctx.db, movingTo) }
            : {}),
          ...columnsOrRefuse(input.spec),
        },
        select: resourceSelect,
      });
    }),

  /**
   * Puts one module's resources in a given order.
   *
   * **The whole list, every time, and the server rewrites every position from it.** Sending only
   * the resource that moved and letting the server work out the rest means the browser and the
   * server each hold half of what an order is. This way a move is a list, which is also what makes
   * it idempotent: the same list sent twice is the same order.
   *
   * The list must be exactly this module's resources. A subset would leave the omitted ones
   * holding stale positions, which is an order nobody asked for and which looks, on the screen
   * afterwards, like the move half worked.
   *
   * `instructorProcedure` with `teachableCourseUnit` rather than `courseProcedure`, for the reason
   * every write in this file uses that pair: the input names a module, and a module id says
   * nothing about which course it is in until the row is read.
   */
  reorder: instructorProcedure
    .input(
      z.object({
        courseUnitId: z.string().uuid(),
        resourceIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await teachableCourseUnit(ctx, input.courseUnitId, { id: true });

      const existing = await ctx.db.resource.findMany({
        where: { courseUnitId: input.courseUnitId },
        select: { id: true },
      });

      const sent = new Set(input.resourceIds);
      if (sent.size !== input.resourceIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That order lists a resource twice." });
      }
      if (sent.size !== existing.length || !existing.every((row) => sent.has(row.id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That order does not list exactly this module’s resources. Reload the page and try " +
            "again — someone may have added or removed one.",
        });
      }

      await writeOrder(ctx.db, "resources", input.courseUnitId, input.resourceIds);

      return { count: input.resourceIds.length };
    }),

  /**
   * Removes a resource.
   *
   * No confirmation guard in the procedure and no impact count, which is the opposite of
   * `assignments.remove` and right for the opposite reason: that one destroys submissions,
   * released grades, and test runs, and cannot be undone. This destroys a title and a URL.
   * A dialog is enough, and a typed confirmation on something that costs a minute to re-add
   * would be ceremony that teaches instructors to click through confirmations.
   */
  remove: instructorProcedure
    .input(z.object({ resourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const found = await teachableResource(ctx, input.resourceId, {
        id: true,
        title: true,
        kind: true,
      });
      await ctx.db.resource.delete({ where: { id: input.resourceId } });

      // The gap this leaves in the module's positions is left there, as `courseUnits.remove`
      // leaves one. Order is what `position` decides, and a gap does not change it.
      return { id: found.id, title: found.title, kind: found.kind };
    }),
});
