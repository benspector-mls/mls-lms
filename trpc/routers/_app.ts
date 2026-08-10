import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../init";
import { assignmentsRouter } from "./assignments";
import { coursesRouter } from "./courses";
import { enrollmentsRouter } from "./enrollments";
import { gradingDraftsRouter } from "./grading-drafts";
import { groupsRouter } from "./groups";
import { modulesRouter } from "./modules";
import { resourcesRouter } from "./resources";
import { staffRouter } from "./staff";
import { submissionsRouter } from "./submissions";
import { testRunsRouter } from "./test-runs";
import { testStudentsRouter } from "./test-students";

/** Columns safe to send to the browser. Keeps future additions opt-in. */
const profileFields = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  githubUsername: true,
  role: true,
  createdAt: true,
  testStudentNumber: true,
} as const;

export const appRouter = createTRPCRouter({
  /** The signed-in user's own profile. */
  me: protectedProcedure.query(({ ctx }) =>
    ctx.db.profile.findUnique({
      // Scoped to the caller. Prisma bypasses row level security, so this where
      // clause is the only thing preventing one user from reading another's row.
      where: { id: ctx.user.id },
      select: profileFields,
    }),
  ),

  /**
   * Whether this request is being answered as a test student, and on whose behalf.
   *
   * Reads `ctx.viewingAs` and deliberately not `ctx.user`, which under the switch *is* the test
   * student — asking the caller who they are would get the answer the switch installed. The real
   * admin is on the context precisely so this can be answered.
   *
   * Returns null the rest of the time, which is what the banner renders nothing for. It is a query
   * rather than a field on `me` because `me` answers "who am I", and the honest answer to that while
   * the cookie is set is the test student. Two questions, two procedures.
   */
  viewingAs: protectedProcedure.query(({ ctx }) => {
    if (!ctx.viewingAs) return null;

    return {
      testStudent: {
        displayName: ctx.viewingAs.testStudent.displayName,
        number: ctx.viewingAs.testStudent.number,
      },
      admin: { displayName: ctx.viewingAs.admin.displayName },
    };
  }),

  /**
   * Let a user set their own display name.
   *
   * Deliberately narrow: the id comes from the verified session and never from
   * input, and only display_name is written. That is what makes it safe for
   * `role` to live on the same table.
   */
  updateDisplayName: protectedProcedure
    .input(
      z.object({
        displayName: z
          .string()
          .trim()
          .min(2, "Please use at least 2 characters.")
          .max(50, "Please use 50 characters or fewer."),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.profile.update({
        where: { id: ctx.user.id },
        data: { displayName: input.displayName },
        select: profileFields,
      }),
    ),

  courses: coursesRouter,
  enrollments: enrollmentsRouter,
  modules: modulesRouter,
  groups: groupsRouter,
  resources: resourcesRouter,
  assignments: assignmentsRouter,
  submissions: submissionsRouter,
  testRuns: testRunsRouter,
  gradingDrafts: gradingDraftsRouter,
  staff: staffRouter,
  testStudents: testStudentsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
