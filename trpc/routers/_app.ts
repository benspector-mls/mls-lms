import { z } from "zod";

import { newJoinToken } from "@/lib/courses/join-token";
import { displayNameSchema } from "@/lib/people";
import { createTRPCRouter, protectedProcedure } from "../init";
import { assignmentsRouter } from "./assignments";
import { attendanceRouter } from "./attendance";
import { gcfRouter } from "./gcf";
import { coursesRouter } from "./courses";
import { programsRouter } from "./programs";
import { enrollmentsRouter } from "./enrollments";
import { gradingDraftsRouter } from "./grading-drafts";
import { cohortsRouter } from "./cohorts";
import { pullRequestsRouter } from "./pull-requests";
import { courseUnitsRouter } from "./course-units";
import { resourcesRouter } from "./resources";
import { staffRouter } from "./staff";
import { submissionsRouter } from "./submissions";
import { teamSetsRouter } from "./team-sets";
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
   *
   * The rule itself is `displayNameSchema` in `lib/people.ts`, which the Profile form reads too, so
   * what the field accepts and what this procedure accepts cannot drift apart.
   *
   * **Under an admin's test-student view this renames the test student**, because `ctx.user.id` is
   * the test student's for the whole request — see `createTRPCContext`. That is the honest answer
   * rather than an exception worth carving out: it is how a test student gets a name that says what
   * it is being used to check, and the amber banner is on screen the entire time.
   */
  updateDisplayName: protectedProcedure
    .input(z.object({ displayName: displayNameSchema }))
    .mutation(({ ctx, input }) =>
      ctx.db.profile.update({
        where: { id: ctx.user.id },
        data: { displayName: input.displayName },
        select: profileFields,
      }),
    ),

  /*
    ===================================================================================
    Subscribing a calendar to due dates

    A student copies one address into Google Calendar, and their calendar polls it from then on.
    The feed itself is `app/api/calendar/[token]/route.ts` — a route handler rather than a
    procedure, because no calendar application sends a cookie or speaks tRPC. These two are the
    only way the address is ever handed out.

    `protectedProcedure` rather than `profileProcedure`, matching `me` and `updateDisplayName`
    directly above: both of these name the caller's own row in a `where`, so the middleware's
    extra fetch of the whole profile would buy nothing and cost a query on the mutation.
    ===================================================================================
  */

  /**
   * Whether the caller has a calendar address yet, and what it is.
   *
   * **Its own query rather than a column on `me`**, which every screen in the shell fetches. The
   * token is a credential, and there is no reason for it to sit in the payload of every page when
   * one card on one screen reads it.
   *
   * Null is the ordinary answer, not an error: the token is written the first time somebody asks
   * for their link, so most profiles have none and never will.
   */
  calendarSubscription: protectedProcedure.query(async ({ ctx }) => {
    const profile = await ctx.db.profile.findUnique({
      // Scoped to the caller, which is the only thing stopping one student from reading another's
      // feed address — Prisma bypasses row level security.
      where: { id: ctx.user.id },
      select: { calendarToken: true },
    });

    return { token: profile?.calendarToken ?? null };
  }),

  /**
   * Write a fresh calendar address for the caller, replacing any they had.
   *
   * **One mutation for both presses.** Creating the link for the first time and replacing one that
   * was pasted somewhere public are the same write; only the card's wording differs, and only
   * because replacing an address that a calendar is already subscribed to is worth confirming
   * first. A second procedure that differed by a null check would be two ways to make one secret.
   *
   * `newJoinToken` is reused rather than a second generator, for the reason that module exists:
   * `crypto.randomUUID` with the hyphens removed, 122 bits of randomness, one word to paste.
   *
   * Nothing is recorded in the audit log, deliberately. That log holds the acts that decide who can
   * see whose work, and this address grants only the titles and dates of work its holder was
   * already assigned — which is exactly why the feed carries no score.
   *
   * **Under an admin's test-student view this writes the test student's token**, because
   * `ctx.user.id` is the test student's for the whole request. That is the honest answer rather
   * than an exception worth carving out, and it is how the feed gets checked at all.
   */
  newCalendarToken: protectedProcedure.mutation(async ({ ctx }) => {
    const profile = await ctx.db.profile.update({
      where: { id: ctx.user.id },
      data: { calendarToken: newJoinToken() },
      select: { calendarToken: true },
    });

    return { token: profile.calendarToken };
  }),

  programs: programsRouter,
  courses: coursesRouter,
  enrollments: enrollmentsRouter,
  attendance: attendanceRouter,
  gcf: gcfRouter,
  courseUnits: courseUnitsRouter,
  cohorts: cohortsRouter,
  teamSets: teamSetsRouter,
  resources: resourcesRouter,
  assignments: assignmentsRouter,
  submissions: submissionsRouter,
  pullRequests: pullRequestsRouter,
  testRuns: testRunsRouter,
  gradingDrafts: gradingDraftsRouter,
  staff: staffRouter,
  testStudents: testStudentsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
