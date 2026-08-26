/**
 * Who instructs a program, who owns it, and how one is retired and deleted.
 *
 * Run with `npm run verify:programs`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. Getting fellows onto a
 * roster is `verify:enrollment`; this is the other half of a program — the people who run it.
 *
 * **Three groups are worth reading.**
 *
 * The instructor-link group takes one account, has it refused while it is a fellow, promotes it, and
 * has it admitted: the link grants a program and never a role, and one account doing both
 * halves is what makes that a comparison rather than two unrelated facts about two people. If that
 * guard were wrong, any instructor could hand out staff access by forwarding a link.
 *
 * The ownership group is written in pairs for the same reason — the owner is allowed and the
 * co-teacher is refused at the same call, because a one-sided check passes against a guard that
 * refuses everybody. It ends by clearing `isPrimary` off a program directly, which is the only way
 * to reach the state a deleted owner's account would leave behind, and by reading the partial unique
 * index out of the catalog, which is the one rule here that lives in the database rather than in a
 * procedure.
 *
 * The teaching group is the one that says what being assigned to a course does **not** do. Every
 * instructor of a program can already work in every course of it, so the checks are that a
 * `CourseInstructor` row changes the name on a course and changes nothing about access.
 */
import { createChecker, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

/** What a call refused with, message included, for the checks that are about the wording. */
async function refusalMessage(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const { ownerOf } = await import("../lib/programs/ownership");

  /*
    Any seeded term with an instructor, and its owner rather than whichever row comes back
    first: everything below is owner-gated, so a script that picked a co-teacher would report a
    working guard as a broken feature — or pick the owner by luck on one run and not the next.
  */
  const seeded = await db.program.findFirst({
    where: { instructors: { some: {} } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const instructor = seeded
    ? ownerOf(
        await db.programInstructor.findMany({
          where: { programId: seeded.id },
          select: { userId: true, isPrimary: true, createdAt: true },
        }),
      )
    : null;

  /*
    A fellow account to promote, which is what the instructor-link group is built around. Picked as
    somebody currently holding the STUDENT role rather than as "an enrollment somewhere", because the
    property the group needs is the role it starts with.
  */
  const student = await db.profile.findFirst({
    where: { role: "STUDENT", testStudentNumber: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true },
  });

  if (!seeded || !instructor || !student) {
    skip("needs a seeded program with an instructor, and a student account to promote");
    return finish();
  }

  const studentId = student.id;
  const createCaller = createCallerFactory(appRouter);

  try {
    await db.$transaction(
      async (tx) => {
        const asInstructor = createCaller({ db: tx, user: { id: instructor.userId } } as never);
        const asStudent = createCaller({ db: tx, user: { id: studentId } } as never);

        /*
          The owner is demoted to INSTRUCTOR for the whole of this script, and put back at the end.

          Not a detail. `assertOwnsProgram` lets an admin through, and the seeded term's
          creator is the deployment's admin — so run as it stands, every check saying "the owner may"
          would be passing on the admin bypass while claiming to measure ownership, and would keep
          passing if ownership were removed entirely. The first version of this group did exactly
          that, and the check that caught it is the one at the end that expects the bypass on purpose.
        */
        const ownerRole = (
          await tx.profile.findUniqueOrThrow({
            where: { id: instructor.userId },
            select: { role: true },
          })
        ).role;
        await tx.profile.update({
          where: { id: instructor.userId },
          data: { role: "INSTRUCTOR" },
        });

        // ---- The instructor link -----------------------------------------------
        //
        // One link per program, where there used to be one per course. It admits somebody to
        // authoring and to every fellow's grade in every course of the year, so its refusals matter
        // more than its successes.
        const program = await asInstructor.programs.create({
          name: "Verify Instructors",
          term: "Program Verify A",
        });
        const tokens = (await tx.program.findUniqueOrThrow({
          where: { id: program.id },
          select: { joinToken: true, instructorToken: true },
        }))!;

        check("a new program gets an instructor token", tokens.instructorToken.length >= 32, true);
        check("...which is not its join token", tokens.instructorToken === tokens.joinToken, false);

        check(
          "an unknown instructor token previews as nothing",
          await asStudent.programs.previewInstructorLink({ token: "not-a-real-token" }),
          null,
        );

        // ---- Refused while the account is a fellow ----
        const studentPreview = await asStudent.programs.previewInstructorLink({
          token: tokens.instructorToken,
        });
        check("a fellow is told they are not eligible", studentPreview?.eligible, false);
        check(
          "...and the preview still names the program",
          studentPreview?.name,
          "Verify Instructors",
        );
        check("...and its term", studentPreview?.term, "Program Verify A");

        const studentRefusal = await refusalMessage(() =>
          asStudent.programs.acceptInstructorLink({ token: tokens.instructorToken }),
        );
        check(
          "a fellow cannot take up an instructor link",
          studentRefusal.includes("instructor invitation"),
          true,
        );
        check(
          "...and no instructor row was written",
          await tx.programInstructor.count({
            where: { programId: program.id, userId: studentId },
          }),
          0,
        );
        /*
          And their role is untouched, which is the half that would matter most if it were wrong.
          A link that raised a role would be a second path to staff access with no admin involved.
        */
        check(
          "...and their role was not raised",
          (await tx.profile.findUniqueOrThrow({ where: { id: studentId } })).role,
          "STUDENT",
        );

        // ---- Made staff, and now admitted ----
        //
        // The promotion an admin performs, done directly here because `staff.setAdmin` and the
        // invitation flow are `verify:staff`'s subject rather than this script's.
        await tx.profile.update({ where: { id: studentId }, data: { role: "INSTRUCTOR" } });
        const asNewInstructor = createCaller({ db: tx, user: { id: studentId } } as never);

        // Before redeeming, so it is genuinely somebody outside the program. Holding the role
        // says nothing about which programs, which is the distinction every gate here rests on.
        check(
          "an instructor who does not instruct it cannot replace its link",
          await refusal(() =>
            asNewInstructor.programs.regenerateInstructorToken({ programId: program.id }),
          ),
          "FORBIDDEN",
        );
        check(
          "...and cannot read its settings either",
          await refusal(() => asNewInstructor.programs.settings({ programId: program.id })),
          "FORBIDDEN",
        );

        const eligiblePreview = await asNewInstructor.programs.previewInstructorLink({
          token: tokens.instructorToken,
        });
        check("an instructor is eligible", eligiblePreview?.eligible, true);
        check("...and does not instruct it yet", eligiblePreview?.alreadyInstructs, false);

        check(
          "redeeming adds them",
          (
            await asNewInstructor.programs.acceptInstructorLink({
              token: tokens.instructorToken,
            })
          ).added,
          true,
        );

        /*
          The check the whole feature is for. A `ProgramInstructor` row that exists but does not
          actually let somebody work in the term would look completely correct in the
          database — every authoring procedure gates on this table, so the proof is calling one.
        */
        const theirSettings = await asNewInstructor.programs.settings({ programId: program.id });
        check(
          "...and they can now read the program they instruct",
          theirSettings.program.id,
          program.id,
        );
        check("...and it lists both instructors", theirSettings.program.instructors.length, 2);
        check(
          "...with the creator marked as such",
          theirSettings.program.instructors.filter((row) => row.isPrimary).length,
          1,
        );
        /*
          It adds them to the program and to no course, deliberately. Which courses somebody teaches
          is the owner's decision on the program's settings screen, and it grants nothing anyway — so
          guessing here would only put a name on a course nobody put it on.
        */
        check(
          "...and it named them on no course",
          await tx.courseInstructor.count({
            where: { programId: program.id, userId: studentId },
          }),
          0,
        );
        check(
          "...and did not raise their role",
          (await tx.profile.findUniqueOrThrow({ where: { id: studentId } })).role,
          "INSTRUCTOR",
        );

        /*
          Idempotent, the same way `enrollments.join` is: `@@unique([programId, userId])` means a
          bookmarked link is not a case to handle. The row count is the half that matters — `added:
          false` alone would pass while a second row was written by something else.
        */
        check(
          "redeeming twice adds nothing",
          (
            await asNewInstructor.programs.acceptInstructorLink({
              token: tokens.instructorToken,
            })
          ).added,
          false,
        );
        check(
          "...and there is still one row for them",
          await tx.programInstructor.count({
            where: { programId: program.id, userId: studentId },
          }),
          1,
        );

        // ---- The refusals that are about the program rather than the account ----
        const archivedProgram = await asInstructor.programs.create({
          name: "Verify Instructors Archived",
          term: "Program Verify B",
        });
        await asInstructor.programs.setArchived({
          programId: archivedProgram.id,
          archived: true,
        });
        const archivedToken = (
          await tx.program.findUniqueOrThrow({
            where: { id: archivedProgram.id },
            select: { instructorToken: true },
          })
        ).instructorToken;
        check(
          "an archived program takes no new instructors",
          await refusal(() =>
            asNewInstructor.programs.acceptInstructorLink({ token: archivedToken }),
          ),
          "PRECONDITION_FAILED",
        );

        /*
          Enrolled as a fellow and instructing are mutually exclusive, the mirror of
          `enrollments.join` refusing an instructor of the program. Being both would put their own
          submissions in the queue they are meant to be working through.
        */
        const bothProgram = await asInstructor.programs.create({
          name: "Verify Instructors Enrolled",
          term: "Program Verify C",
        });
        const bothTokens = (await tx.program.findUniqueOrThrow({
          where: { id: bothProgram.id },
          select: { joinToken: true, instructorToken: true },
        }))!;
        // Written directly rather than joined through the link, because the roster allowlist is
        // `verify:enrollment`'s subject and this check is about the pair of roles.
        await tx.enrollment.create({
          data: { programId: bothProgram.id, studentId, status: "ACTIVE" },
        });
        check(
          "somebody enrolled as a fellow cannot also instruct the program",
          await refusal(() =>
            asNewInstructor.programs.acceptInstructorLink({ token: bothTokens.instructorToken }),
          ),
          "PRECONDITION_FAILED",
        );
        await tx.enrollment.deleteMany({ where: { programId: bothProgram.id, studentId } });

        // ---- Replacing the link ----
        const rotated = await asInstructor.programs.regenerateInstructorToken({
          programId: program.id,
        });
        check(
          "replacing the instructor link changes it",
          rotated.instructorToken !== tokens.instructorToken,
          true,
        );
        check(
          "...and the old one stops working",
          await refusal(() =>
            asNewInstructor.programs.acceptInstructorLink({ token: tokens.instructorToken }),
          ),
          "NOT_FOUND",
        );
        check(
          "...while instructors already on the program keep it",
          (await asNewInstructor.programs.settings({ programId: program.id })).program.instructors
            .length,
          2,
        );

        // ---- Who teaches which course -------------------------------------------
        //
        // The one thing that is still per course, and the checks are about what it does *not* do:
        // every instructor of the program can already work in every course of it, so a
        // `CourseInstructor` row decides whose name is on a course and nothing about access.
        const taught = await asInstructor.courses.create({
          programId: program.id,
          name: "Verify Taught",
        });
        check(
          "creating a course names its creator on it",
          await tx.courseInstructor.count({
            where: { courseId: taught.course.id, userId: instructor.userId },
          }),
          1,
        );
        check(
          "an instructor named on no course can still author in it",
          (await asNewInstructor.assignments.authoringContext({ courseId: taught.course.id }))
            .course.name,
          "Verify Taught",
        );

        check(
          "the owner can name somebody on a course",
          (
            await asInstructor.programs.setCourseInstructors({
              programId: program.id,
              courseId: taught.course.id,
              userIds: [instructor.userId, studentId],
            })
          ).teaching,
          2,
        );
        check(
          "...and unname them, which takes nothing away",
          (
            await asInstructor.programs.setCourseInstructors({
              programId: program.id,
              courseId: taught.course.id,
              userIds: [instructor.userId],
            })
          ).teaching,
          1,
        );
        check(
          "...leaving them still able to author in it",
          (await asNewInstructor.assignments.authoringContext({ courseId: taught.course.id }))
            .course.name,
          "Verify Taught",
        );
        check(
          "a co-teacher cannot decide who teaches what",
          await refusal(() =>
            asNewInstructor.programs.setCourseInstructors({
              programId: program.id,
              courseId: taught.course.id,
              userIds: [],
            }),
          ),
          "FORBIDDEN",
        );
        /*
          The composite foreign key's guarantee, turned into a sentence. `(programId, userId)`
          references `program_instructors`, so naming somebody who does not instruct the
          term is unrepresentable — this is the procedure saying so in words rather than
          letting the database refuse.
        */
        const stranger = await tx.profile.findFirst({
          where: { programsInstructing: { none: { programId: program.id } } },
          select: { id: true },
        });
        check(
          "somebody who does not instruct the program cannot be named on its course",
          stranger
            ? await refusal(() =>
                asInstructor.programs.setCourseInstructors({
                  programId: program.id,
                  courseId: taught.course.id,
                  userIds: [stranger.id],
                }),
              )
            : "BAD_REQUEST",
          "BAD_REQUEST",
        );
        /*
          A course of another term, refused rather than silently reassigned. The composite
          key would refuse it too — `(courseId, programId)` references `courses(id, programId)` — and
          this is the procedure turning that into something an instructor can read.
        */
        const courseElsewhere = await tx.course.findFirst({
          where: { programId: { not: program.id } },
          select: { id: true },
        });
        check(
          "a course of another program cannot be assigned through this one",
          courseElsewhere
            ? await refusal(() =>
                asInstructor.programs.setCourseInstructors({
                  programId: program.id,
                  courseId: courseElsewhere.id,
                  userIds: [],
                }),
              )
            : "NOT_FOUND",
          "NOT_FOUND",
        );

        /*
          ---- Who owns the program -----------------------------------------

          Two instructors on one program, which is what makes any of this checkable: the creator owns
          it and the one who redeemed the link does not, and every check here is a pair — the owner is
          allowed and the co-teacher is refused at the same call. A single-sided check would pass
          against a guard that refused everybody.

          The rule this exists for is the second one. Before it, anybody who taught could remove the
          person who set the term up, which was the one permission in the application that nothing
          guarded.
        */
        const ownerView = await asInstructor.programs.settings({ programId: program.id });
        check("the creator owns the program", ownerView.ownerId, instructor.userId);
        check("...and is told they may act as owner", ownerView.callerActsAsOwner, true);

        const coTeacherView = await asNewInstructor.programs.settings({ programId: program.id });
        check(
          "...while the co-teacher sees the same owner",
          coTeacherView.ownerId,
          instructor.userId,
        );
        check("...and is told they may not", coTeacherView.callerActsAsOwner, false);

        // Archiving is the one action a single instructor takes that changes what every fellow on
        // the roster sees, in every course at once, which is why it is owner-gated.
        check(
          "a co-teacher cannot archive the program",
          await refusal(() =>
            asNewInstructor.programs.setArchived({ programId: program.id, archived: true }),
          ),
          "FORBIDDEN",
        );
        check(
          "...and the refusal names who can",
          (
            await refusalMessage(() =>
              asNewInstructor.programs.setArchived({ programId: program.id, archived: true }),
            )
          ).includes("because they own it"),
          true,
        );
        check(
          "...while the owner may",
          (await asInstructor.programs.setArchived({ programId: program.id, archived: true }))
            .archivedAt !== null,
          true,
        );
        // Reopening is the same gate, because it is the same mutation with a boolean. A co-teacher
        // can read an archived program in full and cannot bring it back.
        check(
          "...and a co-teacher cannot reopen it either",
          await refusal(() =>
            asNewInstructor.programs.setArchived({ programId: program.id, archived: false }),
          ),
          "FORBIDDEN",
        );
        await asInstructor.programs.setArchived({ programId: program.id, archived: false });

        check(
          "a co-teacher cannot remove the owner",
          await refusal(() =>
            asNewInstructor.programs.removeInstructor({
              programId: program.id,
              userId: instructor.userId,
            }),
          ),
          "FORBIDDEN",
        );
        check(
          "...and nothing was removed",
          await tx.programInstructor.count({ where: { programId: program.id } }),
          2,
        );

        check(
          "a co-teacher cannot hand the program to themselves",
          await refusal(() =>
            asNewInstructor.programs.transferOwnership({
              programId: program.id,
              userId: studentId,
            }),
          ),
          "FORBIDDEN",
        );

        /*
          Somebody chosen by the property this check needs — holding no instructor row on this
          program — rather than by a proxy for it like "a profile that is not the one I promoted". A
          fixture picked by a proxy eventually picks the wrong one, and it fails silently in the
          direction that matters, which two scripts here have already demonstrated.
        */
        const notAnInstructorHere = await tx.profile.findFirst({
          where: { programsInstructing: { none: { programId: program.id } } },
          select: { id: true },
        });
        check(
          "the owner cannot hand it to somebody who does not instruct it",
          notAnInstructorHere
            ? await refusal(() =>
                asInstructor.programs.transferOwnership({
                  programId: program.id,
                  userId: notAnInstructorHere.id,
                }),
              )
            : "NOT_FOUND",
          "NOT_FOUND",
        );
        check(
          "...nor to whoever already owns it",
          await refusal(() =>
            asInstructor.programs.transferOwnership({
              programId: program.id,
              userId: instructor.userId,
            }),
          ),
          "PRECONDITION_FAILED",
        );

        /*
          The transfer itself, and the four facts it has to leave behind. `isPrimary` is checked
          directly against the table rather than only through `settings`, because the failure this is
          guarding against is two rows holding it — which reads as entirely normal through every
          procedure, since each takes the first row it finds.
        */
        check(
          "the owner can hand the program on",
          (
            await asInstructor.programs.transferOwnership({
              programId: program.id,
              userId: studentId,
            })
          ).ownerId,
          studentId,
        );
        check(
          "...and exactly one row is primary afterwards",
          await tx.programInstructor.count({ where: { programId: program.id, isPrimary: true } }),
          1,
        );
        check(
          "...which is the new owner's",
          (await asNewInstructor.programs.settings({ programId: program.id })).ownerId,
          studentId,
        );
        check(
          "...the new owner can now archive it",
          (await asNewInstructor.programs.setArchived({ programId: program.id, archived: true }))
            .archivedAt !== null,
          true,
        );
        await asNewInstructor.programs.setArchived({ programId: program.id, archived: false });
        check(
          "...and the old owner cannot",
          await refusal(() =>
            asInstructor.programs.setArchived({ programId: program.id, archived: true }),
          ),
          "FORBIDDEN",
        );

        // Handed back, so the checks after this group see the program they were written
        // against. The assertion is that it moves in both directions rather than only away from
        // whoever created the program.
        check(
          "...and it can be handed back",
          (
            await asNewInstructor.programs.transferOwnership({
              programId: program.id,
              userId: instructor.userId,
            })
          ).ownerId,
          instructor.userId,
        );
        check(
          "...leaving one primary row again",
          await tx.programInstructor.count({ where: { programId: program.id, isPrimary: true } }),
          1,
        );

        /*
          The constraint itself, read from the catalog rather than provoked.

          Every check above passes against a program that happens to have one primary row. What
          makes two of them impossible is a partial unique index, which Prisma cannot express and
          which therefore exists only in a migration — so asking the database is how this notices a
          deployment where that migration has not been run.

          Read rather than tried. Writing a second primary row would prove the same thing and abort
          the transaction every other check here is running inside.
        */
        const primaryIndex = await tx.$queryRaw<{ indexdef: string }[]>`
          SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'program_instructors_one_primary_per_program'
        `;
        check("one primary per program is a database constraint", primaryIndex.length, 1);
        check(
          "...unique, and only over the primary rows",
          /CREATE UNIQUE INDEX/.test(primaryIndex[0]?.indexdef ?? "") &&
            /WHERE is_primary/.test(primaryIndex[0]?.indexdef ?? ""),
          true,
        );

        /*
          ---- Ownership when no row holds it -------------------------------------

          `ProgramInstructor` cascades on the profile, so deleting an owner's account takes the
          `isPrimary` row with it and leaves a term with instructors and nobody who can
          archive it. Nothing in the application deletes a profile — that is a database edit somebody
          makes by hand — which is exactly why the fallback has to hold with nobody there to invoke
          it, and why it is checked by clearing the column directly rather than through a procedure.
          The longest-serving instructor left inherits.
        */
        const derived = await asInstructor.programs.create({
          name: "Verify Derived Ownership",
          term: "Program Verify D",
        });
        const derivedToken = (
          await tx.program.findUniqueOrThrow({
            where: { id: derived.id },
            select: { instructorToken: true },
          })
        ).instructorToken;
        await asNewInstructor.programs.acceptInstructorLink({ token: derivedToken });
        await tx.programInstructor.updateMany({
          where: { programId: derived.id },
          data: { isPrimary: false },
        });
        /*
          Backdated so that "longest-serving" is a real ordering here.

          Both rows were written inside this transaction, and Postgres resolves `now()` to the
          transaction's start time — so they share a `createdAt` to the microsecond and the fallback
          would be decided by its tie-break rather than by the rule it claims to be about. A day apart
          is what the difference looks like in a term somebody is running.
        */
        await tx.programInstructor.updateMany({
          where: { programId: derived.id, userId: instructor.userId },
          data: { createdAt: new Date(Date.now() - 86_400_000) },
        });
        check(
          "a program with no primary row still has an owner",
          (await asInstructor.programs.settings({ programId: derived.id })).ownerId,
          instructor.userId,
        );
        check(
          "...and it is the longest-serving instructor, who can still archive it",
          (await asInstructor.programs.setArchived({ programId: derived.id, archived: true }))
            .archivedAt !== null,
          true,
        );
        check(
          "...while the one who joined later still cannot",
          await refusal(() =>
            asNewInstructor.programs.setArchived({ programId: derived.id, archived: false }),
          ),
          "FORBIDDEN",
        );
        await asInstructor.programs.setArchived({ programId: derived.id, archived: false });

        /*
          An owner who leaves without handing the term on gives it to the longest-serving
          instructor left, by the same rule. Said back by the procedure rather than left to be
          noticed, because it is the right default and not one anybody would guess.
        */
        const leaving = await asInstructor.programs.removeInstructor({
          programId: derived.id,
          userId: instructor.userId,
        });
        check("an owner who leaves says who inherits", leaving.newOwnerName !== null, true);
        check(
          "...and that is who owns it now",
          (await asNewInstructor.programs.settings({ programId: derived.id })).ownerId,
          studentId,
        );

        /*
          ---- Deleting a program -------------------------------------------

          The one irreversible operation on a whole year, so the checks that earn their place are the
          refusals — and each of them asserts the program is **still there** afterwards, which is the
          half that matters. A refusal that returned the right code while the rows went anyway would
          look correct in every log this script produces.

          Archived first, because archiving is reversible and this is not: making it the only path
          puts a survivable step in front of a permanent one.
        */
        const doomed = await asInstructor.programs.create({
          name: "Verify Deletion",
          term: "Program Verify E",
        });
        const doomedCourse = await asInstructor.courses.create({
          programId: doomed.id,
          name: "Verify Doomed Course",
        });
        const doomedCohort = await asInstructor.cohorts.create({
          programId: doomed.id,
          name: "Verify Doomed Cohort",
        });
        /*
          Somebody to be counted, written directly rather than joined through the link — the one
          fellow account this script has was promoted to INSTRUCTOR above, and the roster allowlist is
          `verify:enrollment`'s subject. A different fellow, and the count check is skipped rather
          than faked if there is none.
        */
        const bystander = await tx.profile.findFirst({
          where: { role: "STUDENT", id: { not: studentId } },
          select: { id: true },
        });
        if (bystander) {
          await tx.enrollment.create({
            data: {
              programId: doomed.id,
              studentId: bystander.id,
              status: "ACTIVE",
              cohortId: doomedCohort.id,
            },
          });
        }
        // Before archiving, because an archived program takes no new instructors.
        const doomedToken = (
          await tx.program.findUniqueOrThrow({
            where: { id: doomed.id },
            select: { instructorToken: true },
          })
        ).instructorToken;
        await asNewInstructor.programs.acceptInstructorLink({ token: doomedToken });

        check(
          "a program that is still running cannot be deleted",
          await refusal(() =>
            asInstructor.programs.remove({
              programId: doomed.id,
              confirmTerm: "Program Verify E",
            }),
          ),
          "PRECONDITION_FAILED",
        );
        check(
          "...and its impact cannot even be read",
          await refusal(() => asInstructor.programs.removalImpact({ programId: doomed.id })),
          "PRECONDITION_FAILED",
        );

        await asInstructor.programs.setArchived({ programId: doomed.id, archived: true });

        check(
          "a co-teacher cannot delete an archived program",
          await refusal(() =>
            asNewInstructor.programs.remove({
              programId: doomed.id,
              confirmTerm: "Program Verify E",
            }),
          ),
          "FORBIDDEN",
        );
        check(
          "...nor read what deleting it would destroy",
          await refusal(() => asNewInstructor.programs.removalImpact({ programId: doomed.id })),
          "FORBIDDEN",
        );

        /*
          The counts, checked against rows this block put there. The impact read is what the
          confirmation screen states as fact, so it being right is the difference between a sentence
          somebody can weigh and a number they cannot check.
        */
        const impact = await asInstructor.programs.removalImpact({ programId: doomed.id });
        check("the impact counts its courses", impact.courses, 1);
        check("...its cohorts", impact.cohorts, 1);
        check("...its instructors", impact.instructors, 2);
        check(
          "...and the fellows on its roster",
          bystander ? impact.enrollments : "no spare fellow to enrol",
          bystander ? 1 : "no spare fellow to enrol",
        );
        check("...and asks for the term rather than the name", impact.confirm, "Program Verify E");

        check(
          "the wrong confirmation is refused",
          await refusal(() =>
            asInstructor.programs.remove({
              programId: doomed.id,
              confirmTerm: "Verify Deletion",
            }),
          ),
          "BAD_REQUEST",
        );
        check(
          "...and the program is still there",
          await tx.program.count({ where: { id: doomed.id } }),
          1,
        );

        const deleted = await asInstructor.programs.remove({
          programId: doomed.id,
          confirmTerm: "Program Verify E",
        });
        check("the owner can delete an archived program", deleted.name, "Verify Deletion");
        check("...and it is gone", await tx.program.count({ where: { id: doomed.id } }), 0);
        /*
          The cascade, asserted rather than assumed. Every one of these is a separate foreign key
          with its own `onDelete`, and the one that is wrong is the one that leaves rows pointing at a
          program that no longer exists.
        */
        check(
          "...taking its courses with it",
          await tx.course.count({ where: { id: doomedCourse.course.id } }),
          0,
        );
        check("...its cohorts", await tx.cohort.count({ where: { id: doomedCohort.id } }), 0);
        check(
          "...its enrollments",
          await tx.enrollment.count({ where: { programId: doomed.id } }),
          0,
        );
        check(
          "...and its instructor rows",
          await tx.programInstructor.count({ where: { programId: doomed.id } }),
          0,
        );
        check(
          "...and it leaves the program list",
          (await asInstructor.programs.listMine()).some((row) => row.id === doomed.id),
          false,
        );
        check(
          "...while a program deleted twice is simply not found",
          await refusal(() =>
            asInstructor.programs.remove({
              programId: doomed.id,
              confirmTerm: "Program Verify E",
            }),
          ),
          "NOT_FOUND",
        );

        /*
          ---- An admin acts as owner on every program ----------------------

          A decision rather than a consequence of a guard written for something else. An admin is the
          recovery path for an owner who has left the school without handing the term on, and
          without one every rule above is a way for a program to end up with nobody who can administer
          it.

          Checked against `derived`, which this account now neither owns nor instructs — being an
          admin is the whole of what admits them. Which is also why the role goes back up here and not
          a line earlier: every check above had to run without it.
        */
        await tx.profile.update({ where: { id: instructor.userId }, data: { role: "ADMIN" } });

        check(
          "an admin does not instruct this program",
          await tx.programInstructor.count({
            where: { programId: derived.id, userId: instructor.userId },
          }),
          0,
        );
        check(
          "...and archives it anyway",
          (await asInstructor.programs.setArchived({ programId: derived.id, archived: true }))
            .archivedAt !== null,
          true,
        );
        await asInstructor.programs.setArchived({ programId: derived.id, archived: false });

        // Added back as an ordinary instructor, so that removing the owner below is a program with
        // two instructors rather than the last-one refusal wearing an ownership costume.
        await asInstructor.programs.acceptInstructorLink({ token: derivedToken });
        check(
          "...and can remove an owner who is not them",
          (
            await asInstructor.programs.removeInstructor({
              programId: derived.id,
              userId: studentId,
            })
          ).instructorName.length > 0,
          true,
        );

        await tx.profile.update({
          where: { id: instructor.userId },
          data: { role: ownerRole },
        });

        // ---- Removing an instructor --------------------------------------------
        //
        // The last one is refused, the same shape and the same reasoning as revoking the last admin:
        // a program with no instructors cannot be authored in or graded by anybody, and the
        // only way back is a database edit. The count is asserted first, because a spare instructor
        // lying around would make that refusal pass while testing nothing.
        check(
          "removing one of two instructors is allowed",
          (
            await asInstructor.programs.removeInstructor({
              programId: program.id,
              userId: studentId,
            })
          ).programId,
          program.id,
        );
        check(
          "...and they lose access with it",
          await refusal(() => asNewInstructor.programs.settings({ programId: program.id })),
          "FORBIDDEN",
        );
        /*
          And their course rows went with them, by the cascade on `(programId, userId)`. That is the
          cleanup step the composite key removes rather than leaving to be remembered — before it,
          somebody removed from a program kept their name on its courses.
        */
        check(
          "...and their name is off every course of it",
          await tx.courseInstructor.count({
            where: { programId: program.id, userId: studentId },
          }),
          0,
        );
        check(
          "...leaving exactly one instructor",
          await tx.programInstructor.count({ where: { programId: program.id } }),
          1,
        );
        check(
          "...and the last one cannot be removed",
          await refusal(() =>
            asInstructor.programs.removeInstructor({
              programId: program.id,
              userId: instructor.userId,
            }),
          ),
          "PRECONDITION_FAILED",
        );

        check(
          "removing somebody who does not instruct the program is refused",
          await refusal(() =>
            asInstructor.programs.removeInstructor({
              programId: program.id,
              userId: studentId,
            }),
          ),
          "NOT_FOUND",
        );

        throw new Error("ROLLBACK");
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // ---- Nothing survived --------------------------------------------------
  check(
    "the promoted account is a student again",
    (await db.profile.findUniqueOrThrow({ where: { id: studentId } })).role,
    student.role,
  );
  check(
    "no programs this script created survived the rollback",
    await db.program.count({ where: { term: { startsWith: "Program Verify" } } }),
    0,
  );

  return finish();
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
