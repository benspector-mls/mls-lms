/**
 * Who may teach, and who may decide that.
 *
 * Run with `npm run verify:staff`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because authorization
 * is not half of what these procedures are — it is all of it. What they grant is access to every
 * course and every student's grade, which is the one privilege in this application that cannot be
 * scoped to a cohort and undone by removing somebody from it.
 *
 * **The two groups worth reading are the last two.** An instructor must not be able to promote
 * anybody, including themselves, and revoking the last admin must be refused — that one locks
 * every remaining person out of the screen that could undo it, recoverable only by editing the
 * database.
 */
import { createChecker, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();

async function main() {
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const invite = await import("../lib/staff/invite");

  // ---- The policy, as pure functions -------------------------------------
  //
  // Checked first and without a database, because these are the rules the procedures apply rather
  // than restate. Getting `raiseRole` wrong demotes an admin who clicks their own link.
  const now = new Date("2026-08-07T12:00:00Z");
  const later = new Date("2026-08-07T12:00:01Z");
  const past = new Date("2026-08-01T12:00:00Z");
  const future = new Date("2026-08-20T12:00:00Z");

  check(
    "an unused link inside its window is open",
    invite.inviteState({ redeemedAt: null, expiresAt: future }, now),
    "open",
  );
  check(
    "an unused link past its window has expired",
    invite.inviteState({ redeemedAt: null, expiresAt: past }, now),
    "expired",
  );
  /*
    Redeemed beats expired, and the order is the point. An invitation that was used and has since
    passed its expiry is the record of somebody being given access; calling it "expired" would hide
    the one fact worth keeping.
  */
  check(
    "a used link reads as used even after it would have expired",
    invite.inviteState({ redeemedAt: past, expiresAt: past }, now),
    "redeemed",
  );
  check(
    "expiry is exclusive at the boundary, so a link is dead on the second it names",
    invite.inviteState({ redeemedAt: null, expiresAt: now }, later),
    "expired",
  );
  check(
    "only an open link is usable",
    [
      invite.inviteIsUsable({ redeemedAt: null, expiresAt: future }, now),
      invite.inviteIsUsable({ redeemedAt: null, expiresAt: past }, now),
      invite.inviteIsUsable({ redeemedAt: past, expiresAt: future }, now),
    ],
    [true, false, false],
  );

  check(
    "redeeming raises a student to instructor",
    invite.raiseRole("STUDENT", "INSTRUCTOR"),
    "INSTRUCTOR",
  );
  check(
    "...leaves an instructor an instructor",
    invite.raiseRole("INSTRUCTOR", "INSTRUCTOR"),
    "INSTRUCTOR",
  );
  // The one that matters. `role: 'INSTRUCTOR'` is the obvious implementation and it demotes the
  // admin who generated the link and clicked it to see what it does.
  check("...and never demotes an admin", invite.raiseRole("ADMIN", "INSTRUCTOR"), "ADMIN");

  check(
    "an invitation expires within the stated window",
    invite.inviteExpiry(now).getTime() - now.getTime(),
    invite.INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  );

  /*
    ---- The guarantee no procedure can make ---------------------------------

    Migration `20260730024911_tighten_profiles_grants` exists because a signed-in student could
    once set their own `role` to `ADMIN` from browser JavaScript. **The role column must never be
    writable by the account it describes**, and that is a property of the database grants — every
    procedure in this file could be perfect and it would still be false if these grants slipped.

    So it is checked here rather than trusted, and it is the most valuable check in the file: it is
    the only one that would still fail if the whole staff router were correct.

    **The browser now writes no column of this table at all.** The earlier migration left
    `display_name` and `avatar_url` writable, and `20260814024306_revoke_public_grants_project_wide`
    took even those away — nothing used them, because a profile edit goes through the
    `updateDisplayName` procedure like every other write in this application. Asserting the empty
    set is a stronger statement than the pair was, and it is the one the grants now make.
  */
  const writable = await db.$queryRawUnsafe<{ column_name: string }[]>(`
    SELECT column_name
      FROM information_schema.column_privileges
     WHERE table_schema = 'public'
       AND table_name = 'profiles'
       AND grantee IN ('anon', 'authenticated')
       AND privilege_type IN ('UPDATE', 'INSERT')
     ORDER BY column_name
  `);
  check(
    "the browser can write no column of profiles, role least of all",
    writable.map((row) => row.column_name),
    [],
  );

  // And the invitations table is unreachable from the browser altogether. A row here is a
  // credential granting staff access, and `token` is the whole of it — readable from the browser it
  // would be a self-service promotion.
  const inviteGrants = await db.$queryRawUnsafe<{ privilege_type: string }[]>(`
    SELECT privilege_type
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = 'instructor_invites'
       AND grantee IN ('anon', 'authenticated')
  `);
  check(
    "the browser has no access to instructor invitations at all",
    inviteGrants.map((row) => row.privilege_type),
    [],
  );

  const rls = await db.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(`
    SELECT relrowsecurity FROM pg_class
     WHERE relname = 'instructor_invites' AND relnamespace = 'public'::regnamespace
  `);
  check(
    "...with row level security on, so a later grant still denies by default",
    rls[0]?.relrowsecurity,
    true,
  );

  // ---- Against the database ----------------------------------------------
  const admin = await db.profile.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true },
  });
  const instructor = await db.profile.findFirst({
    where: { role: "INSTRUCTOR" },
    select: { id: true },
  });
  const student = await db.profile.findFirst({
    where: { role: "STUDENT" },
    select: { id: true },
  });

  if (!admin || !student) {
    skip("needs an admin and a student account — run `npm run grant:admin -- you@example.com`");
    return finish();
  }

  const createCaller = createCallerFactory(appRouter);

  /*
    Measured, not assumed to be zero.

    This asserted the invitations table was empty after the rollback, which is only true before
    anybody has used the feature — the first real invitation an admin generated and redeemed made
    this script report a failure. The claim worth making is that *this run* left nothing behind, so
    the ids it creates are collected and checked, and the total is compared against what was there
    to begin with.
  */
  const invitesBefore = await db.instructorInvite.count();
  const createdHere: string[] = [];

  try {
    await db.$transaction(
      async (tx) => {
        const asAdmin = createCaller({ db: tx, user: { id: admin.id } } as never);
        const asStudent = createCaller({ db: tx, user: { id: student.id } } as never);

        // ---- Generating and redeeming ---------------------------------------
        const created = await asAdmin.staff.createInvite();
        createdHere.push(created.id);
        check("an invitation is generated", created.token.length >= 32, true);
        check(
          "...and it is open",
          (await asAdmin.staff.invites()).find((row) => row.id === created.id)?.state,
          "open",
        );

        const preview = await asStudent.staff.previewInvite({ token: created.token });
        check("a student can read what the link offers", preview?.state, "open");
        check("...and is told what they are now", preview?.yourRole, "STUDENT");
        check(
          "an unknown token previews as nothing",
          await asStudent.staff.previewInvite({ token: "not-a-real-token" }),
          null,
        );

        const redeemed = await asStudent.staff.redeemInvite({ token: created.token });
        check("redeeming makes them an instructor", redeemed.role, "INSTRUCTOR");
        check(
          "...and the role is actually written",
          (
            await tx.profile.findUnique({
              where: { id: student.id },
              select: { role: true },
            })
          )?.role,
          "INSTRUCTOR",
        );
        check(
          "...and who used it is recorded",
          (
            await tx.instructorInvite.findUnique({
              where: { id: created.id },
              select: { redeemedById: true },
            })
          )?.redeemedById,
          student.id,
        );

        /*
        Single use. The second attempt is by somebody else, because the same caller opening a
        bookmarked link is deliberately not an error — that pair is the whole rule and each half
        would look correct without the other.
      */
        check(
          "a second person cannot use the same link",
          await refusal(() => asAdmin.staff.redeemInvite({ token: created.token })),
          "PRECONDITION_FAILED",
        );
        check(
          "...while the person who used it can open it again",
          (await asStudent.staff.redeemInvite({ token: created.token })).alreadyRedeemed,
          true,
        );

        // ---- An admin's own link does not demote them -----------------------
        //
        // Checked through the procedure as well as the pure function, because this is the sequence
        // that actually happens: an admin generates a link and clicks it to see what it does.
        const forAdmin = await asAdmin.staff.createInvite();
        createdHere.push(forAdmin.id);
        check(
          "an admin redeeming an invitation stays an admin",
          (await asAdmin.staff.redeemInvite({ token: forAdmin.token })).role,
          "ADMIN",
        );
        check(
          "...and their row still says so",
          (
            await tx.profile.findUnique({
              where: { id: admin.id },
              select: { role: true },
            })
          )?.role,
          "ADMIN",
        );

        // ---- Expiry ---------------------------------------------------------
        const stale = await asAdmin.staff.createInvite();
        createdHere.push(stale.id);
        await tx.instructorInvite.update({
          where: { id: stale.id },
          data: { expiresAt: past },
        });
        check(
          "an expired invitation is refused",
          await refusal(() => asStudent.staff.redeemInvite({ token: stale.token })),
          "PRECONDITION_FAILED",
        );
        check(
          "...and reads as expired rather than as missing",
          (await asStudent.staff.previewInvite({ token: stale.token }))?.state,
          "expired",
        );

        // ---- Deleting one ---------------------------------------------------
        const spare = await asAdmin.staff.createInvite();
        createdHere.push(spare.id);
        await asAdmin.staff.revokeInvite({ inviteId: spare.id });
        check(
          "a deleted invitation stops working",
          await refusal(() => asStudent.staff.redeemInvite({ token: spare.token })),
          "NOT_FOUND",
        );
        /*
        And a redeemed one is refused rather than deleted. It has stopped being a credential and
        become the record of somebody getting access — deleting it would remove the only trace of
        how they got in.
      */
        check(
          "a used invitation cannot be deleted",
          await refusal(() => asAdmin.staff.revokeInvite({ inviteId: created.id })),
          "PRECONDITION_FAILED",
        );

        // ---- Nobody but an admin ---------------------------------------------
        //
        // The student is an instructor by now, which is what makes this the check it needs to be: an
        // instructor must not be able to grant anybody anything, themselves included.
        const asInstructor = createCaller({ db: tx, user: { id: student.id } } as never);

        check(
          "an instructor cannot list staff",
          await refusal(() => asInstructor.staff.people()),
          "FORBIDDEN",
        );
        check(
          "an instructor cannot list invitations",
          await refusal(() => asInstructor.staff.invites()),
          "FORBIDDEN",
        );
        check(
          "an instructor cannot generate an invitation",
          await refusal(() => asInstructor.staff.createInvite()),
          "FORBIDDEN",
        );
        check(
          "an instructor cannot delete one",
          await refusal(() => asInstructor.staff.revokeInvite({ inviteId: created.id })),
          "FORBIDDEN",
        );
        // The escalation this whole file exists to refuse.
        check(
          "an instructor cannot make themselves an admin",
          await refusal(() => asInstructor.staff.setAdmin({ profileId: student.id, admin: true })),
          "FORBIDDEN",
        );
        check(
          "an instructor cannot make anybody else one either",
          await refusal(() => asInstructor.staff.setAdmin({ profileId: admin.id, admin: true })),
          "FORBIDDEN",
        );

        // ---- Granting and revoking admin -------------------------------------
        //
        // Counted relative to what this deployment already has rather than against a fixed
        // number. A real database has however many admins the school has appointed, and a check
        // that assumed one passed only on an empty seed.
        const adminsBefore = (await asAdmin.staff.people()).adminCount;

        const promoted = await asAdmin.staff.setAdmin({ profileId: student.id, admin: true });
        check("an admin can promote an instructor", promoted.role, "ADMIN");
        check(
          "...and there is one more admin than before",
          (await asAdmin.staff.people()).adminCount,
          adminsBefore + 1,
        );
        check(
          "promoting again changes nothing",
          (await asAdmin.staff.setAdmin({ profileId: student.id, admin: true })).role,
          "ADMIN",
        );

        const demoted = await asAdmin.staff.setAdmin({ profileId: student.id, admin: false });
        check("an admin can revoke it", demoted.role, "INSTRUCTOR");
        check(
          "...and it is written",
          (
            await tx.profile.findUnique({
              where: { id: student.id },
              select: { role: true },
            })
          )?.role,
          "INSTRUCTOR",
        );

        /*
        **Revoking the last admin is refused**, which is the check with the worst failure. There is
        no procedure that grants the first admin — deliberately — so an application with no admins
        has no way back except a database edit.

        Asserted as the *only* admin, measured rather than assumed, because a second admin lying
        around would make this pass while testing nothing — which is exactly what happens on a real
        deployment, where the school has appointed more than one.

        So the others are demoted here first, inside the transaction that is about to be rolled
        back. Written straight to the rows rather than through `setAdmin`, because the procedure is
        the thing under test and using it to arrange its own preconditions would be circular.
      */
        await tx.profile.updateMany({
          where: { role: "ADMIN", id: { not: admin.id } },
          data: { role: "INSTRUCTOR" },
        });
        check("only one admin is left at this point", (await asAdmin.staff.people()).adminCount, 1);
        check(
          "revoking the last admin is refused",
          await refusal(() => asAdmin.staff.setAdmin({ profileId: admin.id, admin: false })),
          "PRECONDITION_FAILED",
        );
        check(
          "...and they are still an admin",
          (
            await tx.profile.findUnique({
              where: { id: admin.id },
              select: { role: true },
            })
          )?.role,
          "ADMIN",
        );

        // ---- A student cannot be promoted straight to staff ------------------
        //
        // Staff access is granted through an invitation so that there is a record of it. A second
        // path with no record would undo that, so this refuses rather than being convenient.
        const stillAStudent = await tx.profile.findFirst({
          where: { role: "STUDENT" },
          select: { id: true },
        });
        if (stillAStudent) {
          check(
            "a student cannot be promoted directly",
            await refusal(() =>
              asAdmin.staff.setAdmin({ profileId: stillAStudent.id, admin: true }),
            ),
            "PRECONDITION_FAILED",
          );
        } else {
          skip("no student account left to check direct promotion against");
        }

        // ---- Putting an instructor on a program ------------------------
        //
        // The third way somebody comes to instruct a program, and the one an admin reaches for: the
        // instructor link is how somebody joins one they were sent a link for, and this is how the
        // list gets repaired. Every check here is that it does *not* become a second path to staff
        // access — the whole list is written, and the role is never touched.
        const program = await tx.program.findFirst({
          where: { instructors: { some: {} } },
          select: {
            id: true,
            name: true,
            courses: { take: 1, select: { id: true } },
            instructors: { select: { userId: true } },
          },
        });

        if (!program) {
          skip("no seeded program to put an instructor on");
        } else {
          /*
            The account promoted above, which is genuinely somebody who holds the role and no
            program — the exact loose end this control exists to close. Selected by the property
            rather than by being the one this script happened to promote, so it stays right if the
            order of the groups above ever changes.
          */
          const held = new Set(program.instructors.map((row) => row.userId));
          const spare = (
            await tx.profile.findMany({
              where: { role: { in: ["INSTRUCTOR", "ADMIN"] } },
              select: { id: true, role: true },
            })
          ).find((row) => !held.has(row.id));

          if (!spare) {
            skip("every staff account already instructs the fixture program");
          } else {
            const added = await asAdmin.staff.setPrograms({
              profileId: spare.id,
              programIds: [program.id],
            });
            check("an admin puts an instructor on a program", added.added, [program.name]);
            /*
              Never primary. The owner is whoever created the term, which is a fact about
              how it came to exist rather than a rank an admin confers by ticking a box.
            */
            check(
              "...and the row is not primary",
              (
                await tx.programInstructor.findFirstOrThrow({
                  where: { programId: program.id, userId: spare.id },
                  select: { isPrimary: true },
                })
              ).isPrimary,
              false,
            );
            /*
              **Unchanged, not `INSTRUCTOR`.** The claim is that this control touches no role at all,
              and asserting a particular one instead makes the check pass or fail on which account
              the query happened to return — on a deployment whose only spare staff account is the
              admin, it fails while nothing is wrong. Which is the harness's own warning about
              fixtures chosen by a proxy, met here.
            */
            check(
              "...and it granted no role",
              (await tx.profile.findUniqueOrThrow({ where: { id: spare.id } })).role,
              spare.role,
            );
            check(
              "sending the same list again changes nothing",
              (
                await asAdmin.staff.setPrograms({
                  profileId: spare.id,
                  programIds: [program.id],
                })
              ).added,
              [],
            );

            /*
              Their course rows go with them, by the cascade on `(programId, userId)`. That is the
              cleanup step the composite key removes rather than leaving to be remembered, and it is
              why this check names a course first.
            */
            if (program.courses[0]) {
              await tx.courseInstructor.create({
                data: {
                  courseId: program.courses[0].id,
                  programId: program.id,
                  userId: spare.id,
                },
              });
            }

            const removed = await asAdmin.staff.setPrograms({
              profileId: spare.id,
              programIds: [],
            });
            check("taking them off names the program", removed.removed, [program.name]);
            check(
              "...and their name comes off its courses with them",
              await tx.courseInstructor.count({
                where: { programId: program.id, userId: spare.id },
              }),
              0,
            );
          }

          /*
            The last instructor is refused, the same shape and the same reasoning as revoking the
            last admin: a program with no instructors cannot be authored in or graded by anybody,
            and the only way back is a database edit. Asserted still there afterwards, because a
            refusal that returned the right code while the row went anyway would look correct.
          */
          if (program.instructors.length === 1) {
            const only = program.instructors[0]!.userId;
            check(
              "the only instructor on a program cannot be taken off it",
              await refusal(() => asAdmin.staff.setPrograms({ profileId: only, programIds: [] })),
              "PRECONDITION_FAILED",
            );
            check(
              "...and they are still on it",
              await tx.programInstructor.count({
                where: { programId: program.id, userId: only },
              }),
              1,
            );
          } else {
            skip(
              "the fixture program has more than one instructor, so the last-one refusal did not run",
            );
          }

          /*
            A fellow of the program cannot also instruct it, the mirror of `enrollments.join`
            refusing an instructor. Being both would put their own submissions in the queue they are
            meant to be working through.
          */
          const fellow = await tx.enrollment.findFirst({
            where: { programId: program.id },
            select: { studentId: true },
          });

          if (fellow) {
            await tx.profile.update({
              where: { id: fellow.studentId },
              data: { role: "INSTRUCTOR" },
            });
            check(
              "a fellow of the program cannot be put on it as an instructor",
              await refusal(() =>
                asAdmin.staff.setPrograms({
                  profileId: fellow.studentId,
                  programIds: [program.id],
                }),
              ),
              "PRECONDITION_FAILED",
            );
          } else {
            skip("the fixture program has no fellow, so the enrolled refusal did not run");
          }
        }

        /*
          Asked of an account that is a student **now**, rather than of the one that was a student
          when the script started. Redeeming an invitation above raised that account's role, so
          reusing it here would be checking the refusal against an instructor — which is exactly the
          mistake the `setAdmin` check two groups up already avoids the same way.
        */
        const stillAStudentHere = await tx.profile.findFirst({
          where: { role: "STUDENT" },
          select: { id: true },
        });

        if (program && stillAStudentHere) {
          check(
            "a student cannot be put on a program either",
            await refusal(() =>
              asAdmin.staff.setPrograms({
                profileId: stillAStudentHere.id,
                programIds: [program.id],
              }),
            ),
            "PRECONDITION_FAILED",
          );
        } else {
          skip("no account is still a student, so the student refusal on setPrograms did not run");
        }

        // ---- What the screen reads -------------------------------------------
        const people = await asAdmin.staff.people();
        check(
          "staff are listed and students are not",
          people.people.every((row) => row.role === "INSTRUCTOR" || row.role === "ADMIN"),
          true,
        );
        check(
          "the caller is marked as themselves",
          people.people.find((row) => row.id === admin.id)?.isYou,
          true,
        );

        throw new Error("ROLLBACK");
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // ---- Nothing survived ---------------------------------------------------
  check(
    "the admin is still an admin",
    (await db.profile.findUnique({ where: { id: admin.id }, select: { role: true } }))?.role,
    "ADMIN",
  );
  check(
    "the student's role is unchanged",
    (await db.profile.findUnique({ where: { id: student.id }, select: { role: true } }))?.role,
    "STUDENT",
  );
  check(
    "none of the invitations this run created survived the rollback",
    await db.instructorInvite.count({ where: { id: { in: createdHere } } }),
    0,
  );
  check(
    "...and the table holds exactly what it did before",
    await db.instructorInvite.count(),
    invitesBefore,
  );
  // Reported so a run that created nothing cannot look like a run that cleaned up after itself.
  check("this run did create some to begin with", createdHere.length > 0, true);

  // Reported rather than asserted: an existing instructor is legitimate, and this only says
  // whether the run had one to work with.
  if (!instructor) {
    console.log("\n(note: no INSTRUCTOR account existed before this run)");
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
