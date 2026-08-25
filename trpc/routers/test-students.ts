import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { auditActor, recordEvent } from "@/lib/audit/record";
import { getConfiguredInstallationId, isGithubAppConfigured } from "@/lib/github/app-client";
import { deleteRepo } from "@/lib/github/repos";
import { testStudentEmail, testStudentHandle, testStudentName } from "@/lib/students/test-student";
import {
  AuthAdminError,
  createAuthUser,
  deleteAuthUser,
  EMAIL_TAKEN_STATUS,
} from "@/lib/supabase/admin";

import { adminProcedure, createTRPCRouter } from "../init";

/**
 * Creating, enrolling, and removing the identities an admin previews a course through.
 *
 * **Every procedure here is `adminProcedure`, and that is the whole authorization story.** No
 * `assertTeaches` accompanies it, because an admin passes that check unconditionally — adding one
 * would read as a second gate and be none. What these procedures can do is make an identity and put
 * it in a course, which is why they admit nobody but an admin: an instructor able to mint a student
 * and enrol it is an instructor able to mint a student.
 *
 * **The one guard worth naming separately** is that `enroll` and `remove` refuse a profile that is
 * not a test student. Without it, `enroll` is a mutation that puts any person in any program, and
 * `remove` is one that deletes any person's account and every grade they ever received. The
 * `testStudentNumber !== null` check is the entire difference between this router and an
 * escalation, so it is asserted in each and checked by `scripts/verify-test-student.ts`.
 */

/** What the dialog and the roster read about one test student. */
const testStudentSelect = {
  id: true,
  testStudentNumber: true,
  displayName: true,
  githubUsername: true,
} as const;

export const testStudentsRouter = createTRPCRouter({
  /**
   * Every test student in the deployment, each saying whether it is already on this roster.
   *
   * Scoped by program rather than global because the only reader is the dialog on one program's
   * roster, and what it has to decide is which of these are still worth offering. One already here
   * is not an error — it is simply not on the list.
   */
  list: adminProcedure
    .input(z.object({ programId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const testStudents = await ctx.db.profile.findMany({
        where: { testStudentNumber: { not: null } },
        orderBy: { testStudentNumber: "asc" },
        select: {
          ...testStudentSelect,
          enrollments: {
            where: { programId: input.programId },
            select: { status: true },
          },
        },
      });

      return testStudents.map(({ enrollments, ...student }) => ({
        ...student,
        /** ACTIVE, REMOVED, or null for not on this roster at all. */
        enrollmentStatus: enrollments[0]?.status ?? null,
      }));
    }),

  /**
   * Makes the next test student and puts it on this program's roster.
   *
   * The sequence, and why it is this order:
   *
   * 1. **Pick the number** as one past the highest that exists. Not a count: numbers are never
   *    reused, so a deployment that has created and deleted three gets a fourth rather than a
   *    second — a repository named after a number somebody else's repository already used would be
   *    a collision on GitHub that the database could not see.
   * 2. **Create the auth user**, because a profile cannot exist without one — or claim one already
   *    holding this number's address whose profile was never marked, which is what an earlier
   *    attempt that failed halfway leaves behind. Its unique email is the interlock: two admins who
   *    both computed the same number do not both get it, and the loser retries at the next.
   * 3. **Mark the profile** the trigger made. If that fails, delete the auth user, so a failure
   *    leaves nothing behind rather than an unmarked account nobody can account for. The claim in
   *    step 2 is the second line of that defence, for the times this one does not get to run.
   * 4. **Enrol it**, which is what the admin actually asked for.
   */
  create: adminProcedure
    .input(z.object({ programId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const program = await ctx.db.program.findUnique({
        where: { id: input.programId },
        select: { id: true, name: true, archivedAt: true },
      });

      if (!program) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That program does not exist." });
      }

      // The same refusal `enrollments.join` makes, for the same reason: a finished cohort takes
      // nothing new, and previewing one is not a reason to make an exception.
      if (program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${program.name} has finished, so it is not taking new fellows.`,
        });
      }

      const highest = await ctx.db.profile.aggregate({
        _max: { testStudentNumber: true },
      });

      let number = (highest._max.testStudentNumber ?? 0) + 1;
      let authUserId: string | null = null;

      /*
        Three attempts, and two quite different things can go wrong at each.

        **The number is taken by a finished test student.** Somebody else created one between the
        aggregate above and this insert, or — much more commonly — a previous attempt at this number
        left an account behind. Either way the address is registered, Supabase answers 422, and the
        answer is the next number.

        **An account exists at this number whose profile was never marked.** That is the wreckage of
        an attempt that created the account and then failed before the update below, and it is worth
        handling rather than stepping over. Left alone it is permanent: the address is taken so the
        number can never be used, and the profile reads as an ordinary student — an unnamed row in a
        roster that nothing explains. It is claimed instead. Safe to claim because the address is on
        a reserved domain in a namespace this module owns, so a profile holding it and carrying no
        number cannot be anybody; it can only be a test student that half happened.

        Which also makes creating one **idempotent under failure**: a create that dies anywhere after
        the account exists is repaired by pressing the button again, rather than needing the database
        opened by hand.
      */
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const abandoned = await ctx.db.profile.findUnique({
          where: { email: testStudentEmail(number) },
          select: { id: true, testStudentNumber: true },
        });

        if (abandoned) {
          if (abandoned.testStudentNumber === null) {
            authUserId = abandoned.id;
            break;
          }
          // A finished one. Its number is spoken for, so try the next.
          number += 1;
          continue;
        }

        try {
          const created = await createAuthUser(ctx, {
            email: testStudentEmail(number),
            displayName: testStudentName(number),
          });
          authUserId = created.id;
          break;
        } catch (err) {
          // Lost the race to another admin in the moment since the read above.
          if (err instanceof AuthAdminError && err.status === EMAIL_TAKEN_STATUS) {
            number += 1;
            continue;
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              err instanceof Error
                ? `Could not create the test student's account: ${err.message}`
                : "Could not create the test student's account.",
            cause: err,
          });
        }
      }

      if (!authUserId) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Could not find a free test student number after three attempts. Somebody else may " +
            "be creating one at the same moment — try again.",
        });
      }

      try {
        /*
          The `on_auth_user_created` trigger has already written the profile row, with the display
          name from the metadata above. What is left is the two columns only this knows: the number
          that makes it a test student, and the handle its repositories are named after.

          `role` is set explicitly rather than left to the column default. It is already STUDENT and
          this changes nothing today; it is here because a test student that is not a student is not
          a test student, and a future change to that default should not quietly turn these into
          something else.
        */
        const profile = await ctx.db.profile.update({
          where: { id: authUserId },
          data: {
            testStudentNumber: number,
            githubUsername: testStudentHandle(number),
            displayName: testStudentName(number),
            role: "STUDENT",
          },
          select: testStudentSelect,
        });

        const enrollment = await ctx.db.enrollment.create({
          data: { programId: program.id, studentId: profile.id, status: "ACTIVE" },
          select: { id: true, status: true },
        });

        /*
          Recorded because this is one of only two places the service role key is used, and the
          only one that creates an identity. A test student is an account that can be signed in
          as through `view-as` and that appears in a real cohort's roster — which is exactly the
          kind of thing somebody should be able to account for later.

          Outside the transaction the two writes above are not in, deliberately: the auth user
          already exists at this point and cannot be rolled back by Postgres, so an event that
          vanished with a failed transaction would be denying something that did happen.
        */
        await recordEvent(ctx.db, {
          action: "TEST_STUDENT_CREATED",
          actor: auditActor(ctx),
          subject: { id: profile.id, label: testStudentName(number) },
          program: { id: program.id, label: program.name },
          detail: { number, handle: testStudentHandle(number) },
        });

        return { ...profile, enrollmentStatus: enrollment.status };
      } catch (err) {
        /*
          Undo the account, so a failure here leaves nothing rather than an auth user with an
          unmarked profile — which would be indistinguishable from a real person and would hold the
          email address that names the number.
        */
        await deleteAuthUser(ctx, authUserId).catch(() => {
          console.error(
            `test-students.create: could not delete the auth user ${authUserId} after failing to ` +
              `mark it as test student ${number}. It must be removed by hand.`,
          );
        });
        throw err;
      }
    }),

  /**
   * Puts an existing test student on this program's roster.
   *
   * Idempotent through `@@unique([programId, studentId])`, and it restores a REMOVED one rather than
   * refusing — which is the opposite of what `enrollments.join` does with a removed student, and
   * deliberately so. There, refusing is what makes removal stick against somebody still holding the
   * link. Here the only caller is the admin who removed it, and the row records no history worth
   * protecting.
   */
  enroll: adminProcedure
    .input(z.object({ programId: z.string().uuid(), profileId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const student = await ctx.db.profile.findUnique({
        where: { id: input.profileId },
        select: testStudentSelect,
      });

      /*
        The guard this router exists to make. Without it this procedure enrols anybody in anything,
        which is a different feature and not one anybody asked for.
      */
      if (!student || student.testStudentNumber === null) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That is not a test student. Only a test student can be enrolled this way.",
        });
      }

      const program = await ctx.db.program.findUnique({
        where: { id: input.programId },
        select: { id: true, name: true, archivedAt: true },
      });

      if (!program) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That program does not exist." });
      }

      if (program.archivedAt !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${program.name} has finished, so it is not taking new fellows.`,
        });
      }

      const enrollment = await ctx.db.enrollment.upsert({
        where: { programId_studentId: { programId: program.id, studentId: student.id } },
        create: { programId: program.id, studentId: student.id, status: "ACTIVE" },
        update: { status: "ACTIVE" },
        select: { status: true },
      });

      return { ...student, enrollmentStatus: enrollment.status };
    }),

  /**
   * What removing this test student would destroy, so the confirmation can say it.
   *
   * A separate query rather than a message the mutation composes afterwards, because the point of a
   * confirmation is to be read before the act. It names the repositories rather than counting them:
   * "3 repositories" is a number to agree with, and a list is something to recognise.
   */
  removalPreview: adminProcedure
    .input(z.object({ profileId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const student = await ctx.db.profile.findUnique({
        where: { id: input.profileId },
        select: {
          ...testStudentSelect,
          submissions: {
            select: {
              repoFullName: true,
              assignment: { select: { title: true, course: { select: { name: true } } } },
            },
          },
          enrollments: { select: { program: { select: { name: true } } } },
        },
      });

      if (!student || student.testStudentNumber === null) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That is not a test student.",
        });
      }

      return {
        id: student.id,
        displayName: student.displayName,
        repositories: student.submissions
          .map((s) => s.repoFullName)
          .filter((name): name is string => name !== null),
        submissionCount: student.submissions.length,
        programs: student.enrollments.map((e) => e.program.name),
      };
    }),

  /**
   * Deletes a test student: its repositories on GitHub, then its account and everything under it.
   *
   * **Repositories first, rows second.** The rows are what name the repositories, so deleting them
   * first would leave repositories nothing could find again — the same ordering hazard
   * `acceptRepoAssignment` documents from the other direction. A repository that fails to delete is
   * reported and does not stop the removal: an admin can delete one by hand, and half-removed rows
   * are worse than a leftover repository.
   *
   * Deleting the auth user is what deletes the profile — `Profile.id` cascades from
   * `auth.users.id` — and the profile cascades to its enrollments, submissions, test runs, and
   * grading drafts. Nothing here deletes rows directly, so nothing here can be half-done.
   */
  remove: adminProcedure
    .input(z.object({ profileId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const student = await ctx.db.profile.findUnique({
        where: { id: input.profileId },
        select: {
          id: true,
          testStudentNumber: true,
          displayName: true,
          submissions: { select: { repoFullName: true } },
        },
      });

      if (!student || student.testStudentNumber === null) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "That is not a test student. Only a test student can be deleted — a real student's " +
            "account and their graded work are not this application's to destroy.",
        });
      }

      const repositories = student.submissions
        .map((s) => s.repoFullName)
        .filter((name): name is string => name !== null);

      const failed: string[] = [];

      if (repositories.length > 0) {
        if (!isGithubAppConfigured()) {
          // Reported rather than fatal: the rows should still go, and an unconfigured deployment
          // has no way to reach GitHub at all.
          failed.push(...repositories);
        } else {
          const installationId = getConfiguredInstallationId();
          for (const fullName of repositories) {
            const [owner, repo] = fullName.split("/");
            if (!owner || !repo) {
              failed.push(fullName);
              continue;
            }
            try {
              await deleteRepo(installationId, { owner, repo });
            } catch (err) {
              console.error(`test-students.remove: could not delete ${fullName}`, err);
              failed.push(fullName);
            }
          }
        }
      }

      /*
        Recorded *before* the account goes, because deleting it cascades through the profile to
        every submission, test run, and grading draft attached to it. Afterwards there is nothing
        left to name in the event — which is the case the snapshot columns on `audit_events` exist
        for, and the order that keeps them accurate.
      */
      await recordEvent(ctx.db, {
        action: "TEST_STUDENT_DELETED",
        actor: auditActor(ctx),
        subject: { id: student.id, label: student.displayName ?? "a test student" },
        detail: {
          number: student.testStudentNumber,
          repositoriesDeleted: repositories.length - failed.length,
          repositoriesLeftBehind: failed,
        },
      });

      await deleteAuthUser(ctx, student.id);

      return {
        displayName: student.displayName,
        deletedRepositories: repositories.filter((name) => !failed.includes(name)),
        /** Repositories that must now be deleted by hand, which the interface has to say. */
        failedRepositories: failed,
      };
    }),
});
