import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertCourseMember } from "@/lib/courses/membership";
import { teachableModule, teachableResource } from "@/lib/courses/scope";
import { resourceColumns, resourceSpecSchema, UnrecognisedVideoError } from "@/lib/resources/spec";

import { createTRPCRouter, instructorProcedure, profileProcedure } from "../init";

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
 */

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

/** Everything a screen draws a resource from. `body` included: a note *is* its body. */
const resourceFields = {
  id: true,
  kind: true,
  title: true,
  url: true,
  description: true,
  body: true,
  videoProvider: true,
  videoId: true,
  moduleId: true,
} as const;

export const resourcesRouter = createTRPCRouter({
  /**
   * Every resource in a course, by module and then alphabetically by title.
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
   * Resources screen cannot each pick their own alphabet.
   */
  listForCourse: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCourseMember(ctx, input.courseId);

      return ctx.db.resource.findMany({
        where: { module: { courseId: input.courseId } },
        /*
          Module order first, then title. There is no `position` on a resource, deliberately:
          alphabetical is the only ordering that needs nothing maintained, and a manual one
          beside it would be a second sequence to keep in step with the first.
        */
        orderBy: [{ module: { position: "asc" } }, { title: "asc" }],
        select: resourceFields,
      });
    }),

  create: instructorProcedure
    .input(z.object({ moduleId: z.string().uuid(), spec: resourceSpecSchema }))
    .mutation(async ({ ctx, input }) => {
      await teachableModule(ctx, input.moduleId, { id: true });

      return ctx.db.resource.create({
        data: { moduleId: input.moduleId, ...columnsOrRefuse(input.spec) },
        select: resourceFields,
      });
    }),

  /**
   * Edits a resource, including moving it to another module of the same course.
   *
   * **The kind can change**, which is why `resourceColumns` writes every column rather than the
   * ones the new kind uses: a note turned into a link would otherwise keep its `body`, and the
   * next reader to trust that column would render a row that is two things at once.
   */
  update: instructorProcedure
    .input(
      z.object({
        resourceId: z.string().uuid(),
        /** Omitted leaves it where it is. Given, it must be a module of the same course. */
        moduleId: z.string().uuid().optional(),
        spec: resourceSpecSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await teachableResource(ctx, input.resourceId, {
        id: true,
        module: { select: { id: true, courseId: true } },
      });

      /*
        Checked rather than left to the foreign key, which would happily accept a module from
        another course. A resource filed under another cohort's module is invisible on the
        course it belongs to and appears on one it does not — and nothing on either screen would
        explain it.
      */
      if (input.moduleId && input.moduleId !== existing.module.id) {
        const target = await ctx.db.module.findFirst({
          where: { id: input.moduleId, courseId: existing.module.courseId },
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
          ...(input.moduleId ? { moduleId: input.moduleId } : {}),
          ...columnsOrRefuse(input.spec),
        },
        select: resourceFields,
      });
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
      return { id: found.id, title: found.title, kind: found.kind };
    }),
});
