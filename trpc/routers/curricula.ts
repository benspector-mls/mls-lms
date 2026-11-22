import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { LessonSyncError } from "@/lib/lessons/repo";
import { syncCurriculum } from "@/lib/lessons/sync";
import { adminProcedure, createTRPCRouter, instructorProcedure } from "../init";

const curriculumId = z.object({ curriculumId: z.string().uuid() });

/**
 * The curricula: public GitHub repositories laid out for GitBook, each copied into `lessons` and
 * shown by the courses whose instructors choose it.
 *
 * **Admins add, copy and remove them**, because a curriculum is shared by every program that
 * teaches it. **Instructors read the list**, which is what the Lessons choice on a course's
 * Settings screen offers; nothing in it is secret, since the repositories are public.
 */
export const curriculaRouter = createTRPCRouter({
  /** Every curriculum, oldest first, with when it was last copied and how many courses show it. */
  list: instructorProcedure.query(async ({ ctx }) => {
    const curricula = await ctx.db.curriculum.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        repo: true,
        ref: true,
        _count: { select: { courses: true } },
      },
    });

    return Promise.all(
      curricula.map(async ({ _count, ...curriculum }) => {
        const latest = await ctx.db.lesson.findFirst({
          where: { curriculumId: curriculum.id, removedAt: null },
          orderBy: { syncedAt: "desc" },
          select: { commitSha: true, syncedAt: true },
        });
        return { ...curriculum, courses: _count.courses, lastCopy: latest };
      }),
    );
  }),

  /** Register a curriculum. Nothing is copied until somebody presses Sync now. */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        repo: z
          .string()
          .trim()
          .regex(/^[\w.-]+\/[\w.-]+$/, "Write the repository as owner/repo."),
        ref: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.curriculum.create({
        data: { name: input.name, repo: input.repo, ref: input.ref || null },
        select: { id: true, name: true },
      }),
    ),

  /**
   * Remove a curriculum and its lessons.
   *
   * Refused while any course shows it, naming the courses, because removing it would empty those
   * courses' Lessons views under their fellows. The foreign key refuses the same thing; this says
   * which courses to change first.
   */
  remove: adminProcedure.input(curriculumId).mutation(async ({ ctx, input }) => {
    const courses = await ctx.db.course.findMany({
      where: { curriculumId: input.curriculumId },
      select: { name: true, program: { select: { term: true } } },
    });
    if (courses.length > 0) {
      const names = courses.map((course) => `${course.name} (${course.program.term})`).join(", ");
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `These courses show this curriculum: ${names}. Choose another on their Settings screens first.`,
      });
    }

    await ctx.db.curriculum.delete({ where: { id: input.curriculumId } });
    return { id: input.curriculumId };
  }),

  /**
   * Copy one curriculum now rather than at the next scheduled run.
   *
   * Returns the problems the run found, which Admin → Lessons lists for the admin who pressed the
   * button. The scheduled run's problems go to the function log; the next press shows them again.
   */
  sync: adminProcedure.input(curriculumId).mutation(async ({ ctx, input }) => {
    const curriculum = await ctx.db.curriculum.findUnique({
      where: { id: input.curriculumId },
      select: { id: true, name: true, repo: true, ref: true },
    });
    if (!curriculum) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That curriculum no longer exists." });
    }

    try {
      return await syncCurriculum(ctx.db, curriculum);
    } catch (err) {
      if (err instanceof LessonSyncError) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
      }
      throw err;
    }
  }),
});
