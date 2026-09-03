/**
 * Who may teach, and who may decide that.
 *
 * Run with `npm run test:integration`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, because authorization
 * is not half of what these procedures are — it is all of it. What they grant is access to every
 * course and every student's grade, which is the one privilege in this application that cannot be
 * scoped to a cohort and undone by removing somebody from it.
 *
 * **The two groups worth reading are the last two.** An instructor must not be able to promote
 * anybody, including themselves, and revoking the last admin must be refused — that one locks every
 * remaining person out of the screen that could undo it, recoverable only by editing the database.
 *
 * Carries the 51 assertions of `verify:staff` that need a database, and one more. Its other nine
 * were pure functions and are now `tests/lib/staff/invite.test.ts`, which needs nothing and runs on
 * every save.
 *
 * **The script ran 12 of its 60 and skipped the rest.** It needed an admin account and a student
 * account to already exist, which on a database nobody has run `grant:admin` against is not the
 * case, and five more of its groups stood down for want of a spare staff account, a second program,
 * or a fellow. Every one of those is made here.
 *
 * The extra check is the first one below, and it exists because the three grant checks expect an
 * empty answer — which is also what a Postgres cluster with no `anon` and `authenticated` roles
 * returns, for the opposite reason. Asking whether those roles are there turns the most valuable
 * check in the file from one that could pass silently into one that fails and says why.
 */
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAccount, makeWorld, type World } from "./fixtures";
import { required, withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** What a call refused with, as a string to compare against. */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/*
  ---- The guarantee no procedure can make -------------------------------------

  Migration `20260730024911_tighten_profiles_grants` exists because a signed-in student could once
  set their own `role` to `ADMIN` from browser JavaScript. **The role column must never be writable
  by the account it describes**, and that is a property of the database grants — every procedure in
  this file could be perfect and it would still be false if these grants slipped.

  So it is checked rather than trusted, and it is the most valuable check here: it is the only one
  that would still fail if the whole staff router were correct.

  These read the database and create nothing, so they need no transaction.
*/
describe("what the browser may reach", () => {
  it("the two roles the browser connects as exist, so these checks mean something", async () => {
    const roles = await db.$queryRawUnsafe<{ rolname: string }[]>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname`,
    );
    /*
      Asked first, and failing rather than passing quietly, because every check below expects an
      empty result — and a cluster with no such roles returns an empty result for the opposite
      reason. `npm run db:test:reset` creates them for exactly this.
    */
    required(
      "the `anon` and `authenticated` roles, which npm run db:test:reset creates",
      roles.length === 2 ? roles : null,
    );
    expect(roles.map((row) => row.rolname)).toEqual(["anon", "authenticated"]);
  });

  /*
    **The browser now writes no column of this table at all.** The earlier migration left
    `display_name` and `avatar_url` writable, and `20260814024306_revoke_public_grants_project_wide`
    took even those away — nothing used them, because a profile edit goes through the
    `updateDisplayName` procedure like every other write in this application. Asserting the empty set
    is a stronger statement than the pair was.
  */
  it("the browser can write no column of profiles, role least of all", async () => {
    const writable = await db.$queryRawUnsafe<{ column_name: string }[]>(`
      SELECT column_name
        FROM information_schema.column_privileges
       WHERE table_schema = 'public'
         AND table_name = 'profiles'
         AND grantee IN ('anon', 'authenticated')
         AND privilege_type IN ('UPDATE', 'INSERT')
       ORDER BY column_name
    `);
    expect(writable.map((row) => row.column_name)).toEqual([]);
  });

  /*
    And the invitations table is unreachable from the browser altogether. A row here is a credential
    granting staff access, and `token` is the whole of it — readable from the browser it would be a
    self-service promotion.
  */
  it("the browser has no access to instructor invitations at all", async () => {
    const grants = await db.$queryRawUnsafe<{ privilege_type: string }[]>(`
      SELECT privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema = 'public'
         AND table_name = 'instructor_invites'
         AND grantee IN ('anon', 'authenticated')
    `);
    expect(grants.map((row) => row.privilege_type)).toEqual([]);
  });

  it("...with row level security on, so a later grant still denies by default", async () => {
    const rls = await db.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(`
      SELECT relrowsecurity FROM pg_class
       WHERE relname = 'instructor_invites' AND relnamespace = 'public'::regnamespace
    `);
    expect(rls[0]?.relrowsecurity).toBe(true);
  });
});

/*
  Everything below shares one transaction, because it is one narrative: an account is invited,
  redeems, is promoted, is demoted, and is put on a program and taken off again. Splitting it would
  mean rebuilding the same five accounts five times to ask five halves of one question.
*/
describe("invitations, promotion, and who may grant either", () => {
  const tx = withRollback(180_000);

  let world: World;
  let adminId: string;
  /** The account that starts as a student and is raised through the file. */
  let joinerId: string;
  /** An account that is still a student at the end, for the refusals that need one. */
  let bystanderId: string;
  let createdHere: string[];
  let invitesBefore: number;

  const asAdmin = () => createCaller(tx(), adminId);
  const asJoiner = () => createCaller(tx(), joinerId);

  let created: { id: string; token: string };

  beforeAll(async () => {
    invitesBefore = await db.instructorInvite.count();
    createdHere = [];

    world = await makeWorld(tx());
    adminId = await makeAccount(tx(), { role: "ADMIN" });
    joinerId = await makeAccount(tx());
    bystanderId = await makeAccount(tx());
  });

  describe("generating and redeeming", () => {
    beforeAll(async () => {
      created = await asAdmin().staff.createInvite();
      createdHere.push(created.id);
    });

    it("an invitation is generated", () => {
      expect(created.token.length).toBeGreaterThanOrEqual(32);
    });

    it("...and it is open", async () => {
      const listed = await asAdmin().staff.invites();
      expect(listed.find((row) => row.id === created.id)?.state).toBe("open");
    });

    it("a student can read what the link offers", async () => {
      const preview = await asJoiner().staff.previewInvite({ token: created.token });
      expect(preview?.state).toBe("open");
    });

    it("...and is told what they are now", async () => {
      const preview = await asJoiner().staff.previewInvite({ token: created.token });
      expect(preview?.yourRole).toBe("STUDENT");
    });

    it("an unknown token previews as nothing", async () => {
      expect(await asJoiner().staff.previewInvite({ token: "not-a-real-token" })).toBeNull();
    });

    describe("redeeming it", () => {
      let redeemed: { role: string };

      beforeAll(async () => {
        redeemed = await asJoiner().staff.redeemInvite({ token: created.token });
      });

      it("redeeming makes them an instructor", () => {
        expect(redeemed.role).toBe("INSTRUCTOR");
      });

      it("...and the role is actually written", async () => {
        const row = await tx().profile.findUnique({
          where: { id: joinerId },
          select: { role: true },
        });
        expect(row?.role).toBe("INSTRUCTOR");
      });

      it("...and who used it is recorded", async () => {
        const row = await tx().instructorInvite.findUnique({
          where: { id: created.id },
          select: { redeemedById: true },
        });
        expect(row?.redeemedById).toBe(joinerId);
      });

      /*
        Single use. The second attempt is by somebody else, because the same caller opening a
        bookmarked link is deliberately not an error — that pair is the whole rule and each half
        would look correct without the other.
      */
      it("a second person cannot use the same link", async () => {
        const code = await refusal(() =>
          asAdmin().staff.redeemInvite({ token: created.token }),
        );
        expect(code).toBe("PRECONDITION_FAILED");
      });

      it("...while the person who used it can open it again", async () => {
        const again = await asJoiner().staff.redeemInvite({ token: created.token });
        expect(again.alreadyRedeemed).toBe(true);
      });
    });
  });

  /*
    Checked through the procedure as well as the pure function, because this is the sequence that
    actually happens: an admin generates a link and clicks it to see what it does.
  */
  describe("an admin's own link does not demote them", () => {
    let asAdminRole: string;

    beforeAll(async () => {
      const forAdmin = await asAdmin().staff.createInvite();
      createdHere.push(forAdmin.id);
      asAdminRole = (await asAdmin().staff.redeemInvite({ token: forAdmin.token })).role;
    });

    it("an admin redeeming an invitation stays an admin", () => {
      expect(asAdminRole).toBe("ADMIN");
    });

    it("...and their row still says so", async () => {
      const row = await tx().profile.findUnique({ where: { id: adminId }, select: { role: true } });
      expect(row?.role).toBe("ADMIN");
    });
  });

  describe("expiry", () => {
    let stale: { id: string; token: string };

    beforeAll(async () => {
      stale = await asAdmin().staff.createInvite();
      createdHere.push(stale.id);
      await tx().instructorInvite.update({
        where: { id: stale.id },
        data: { expiresAt: new Date("2026-08-01T12:00:00Z") },
      });
    });

    it("an expired invitation is refused", async () => {
      const code = await refusal(() => asJoiner().staff.redeemInvite({ token: stale.token }));
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("...and reads as expired rather than as missing", async () => {
      const preview = await asJoiner().staff.previewInvite({ token: stale.token });
      expect(preview?.state).toBe("expired");
    });
  });

  describe("deleting one", () => {
    it("a deleted invitation stops working", async () => {
      const spare = await asAdmin().staff.createInvite();
      createdHere.push(spare.id);
      await asAdmin().staff.revokeInvite({ inviteId: spare.id });
      const code = await refusal(() => asJoiner().staff.redeemInvite({ token: spare.token }));
      expect(code).toBe("NOT_FOUND");
    });

    /*
      And a redeemed one is refused rather than deleted. It has stopped being a credential and
      become the record of somebody getting access — deleting it would remove the only trace of how
      they got in.
    */
    it("a used invitation cannot be deleted", async () => {
      const code = await refusal(() => asAdmin().staff.revokeInvite({ inviteId: created.id }));
      expect(code).toBe("PRECONDITION_FAILED");
    });
  });

  /*
    The joiner is an instructor by now, which is what makes this the check it needs to be: an
    instructor must not be able to grant anybody anything, themselves included.
  */
  describe("nobody but an admin", () => {
    it("an instructor cannot list staff", async () => {
      expect(await refusal(() => asJoiner().staff.people())).toBe("FORBIDDEN");
    });

    it("an instructor cannot list invitations", async () => {
      expect(await refusal(() => asJoiner().staff.invites())).toBe("FORBIDDEN");
    });

    it("an instructor cannot generate an invitation", async () => {
      expect(await refusal(() => asJoiner().staff.createInvite())).toBe("FORBIDDEN");
    });

    it("an instructor cannot delete one", async () => {
      const code = await refusal(() => asJoiner().staff.revokeInvite({ inviteId: created.id }));
      expect(code).toBe("FORBIDDEN");
    });

    // The escalation this whole file exists to refuse.
    it("an instructor cannot make themselves an admin", async () => {
      const code = await refusal(() =>
        asJoiner().staff.setAdmin({ profileId: joinerId, admin: true }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("an instructor cannot make anybody else one either", async () => {
      const code = await refusal(() =>
        asJoiner().staff.setAdmin({ profileId: adminId, admin: true }),
      );
      expect(code).toBe("FORBIDDEN");
    });
  });

  /*
    Counted relative to what this database already has rather than against a fixed number. A
    deployment has however many admins the school has appointed, and a check that assumed one passed
    only on an empty database.
  */
  describe("granting and revoking admin", () => {
    let adminsBefore: number;
    let promoted: { role: string };

    beforeAll(async () => {
      adminsBefore = (await asAdmin().staff.people()).adminCount;
      promoted = await asAdmin().staff.setAdmin({ profileId: joinerId, admin: true });
    });

    it("an admin can promote an instructor", () => {
      expect(promoted.role).toBe("ADMIN");
    });

    it("...and there is one more admin than before", async () => {
      expect((await asAdmin().staff.people()).adminCount).toBe(adminsBefore + 1);
    });

    it("promoting again changes nothing", async () => {
      const again = await asAdmin().staff.setAdmin({ profileId: joinerId, admin: true });
      expect(again.role).toBe("ADMIN");
    });

    it("an admin can revoke it", async () => {
      const demoted = await asAdmin().staff.setAdmin({ profileId: joinerId, admin: false });
      expect(demoted.role).toBe("INSTRUCTOR");
    });

    it("...and it is written", async () => {
      const row = await tx().profile.findUnique({ where: { id: joinerId }, select: { role: true } });
      expect(row?.role).toBe("INSTRUCTOR");
    });
  });

  /*
    **Revoking the last admin is refused**, which is the check with the worst failure. There is no
    procedure that grants the first admin — deliberately — so an application with no admins has no
    way back except a database edit.

    Asserted as the *only* admin, measured rather than assumed, because a second admin lying around
    would make this pass while testing nothing. So the others are demoted here first, inside the
    transaction that is about to be rolled back. Written straight to the rows rather than through
    `setAdmin`, because that procedure is the thing under test and using it to arrange its own
    preconditions would be circular.
  */
  describe("the last admin", () => {
    beforeAll(async () => {
      await tx().profile.updateMany({
        where: { role: "ADMIN", id: { not: adminId } },
        data: { role: "INSTRUCTOR" },
      });
    });

    it("only one admin is left at this point", async () => {
      expect((await asAdmin().staff.people()).adminCount).toBe(1);
    });

    it("revoking the last admin is refused", async () => {
      const code = await refusal(() =>
        asAdmin().staff.setAdmin({ profileId: adminId, admin: false }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("...and they are still an admin", async () => {
      const row = await tx().profile.findUnique({ where: { id: adminId }, select: { role: true } });
      expect(row?.role).toBe("ADMIN");
    });
  });

  /*
    Staff access is granted through an invitation so that there is a record of it. A second path
    with no record would undo that, so this refuses rather than being convenient.

    Asked of an account that is a student **now** rather than of the one that was a student when the
    file started: redeeming an invitation above raised the joiner's role, so reusing them here would
    be checking the refusal against an instructor.
  */
  describe("a student cannot be promoted straight to staff", () => {
    it("a student cannot be promoted directly", async () => {
      const code = await refusal(() =>
        asAdmin().staff.setAdmin({ profileId: bystanderId, admin: true }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });
  });

  /*
    ---- Putting an instructor on a program ------------------------------------

    The third way somebody comes to instruct a program, and the one an admin reaches for: the
    instructor link is how somebody joins one they were sent a link for, and this is how the list
    gets repaired. Every check here is that it does *not* become a second path to staff access — the
    whole list is written, and the role is never touched.
  */
  describe("putting an instructor on a program", () => {
    let programName: string;
    let spareRole: string;

    beforeAll(async () => {
      const program = await tx().program.findUniqueOrThrow({
        where: { id: world.programId },
        select: { name: true },
      });
      programName = program.name;
      spareRole = (await tx().profile.findUniqueOrThrow({ where: { id: joinerId } })).role;
    });

    it("an admin puts an instructor on a program", async () => {
      const added = await asAdmin().staff.setPrograms({
        profileId: joinerId,
        programIds: [world.programId],
      });
      expect(added.added).toEqual([programName]);
    });

    /*
      Never primary. The owner is whoever created the term, which is a fact about how it came to
      exist rather than a rank an admin confers by ticking a box.
    */
    it("...and the row is not primary", async () => {
      const row = await tx().programInstructor.findFirstOrThrow({
        where: { programId: world.programId, userId: joinerId },
        select: { isPrimary: true },
      });
      expect(row.isPrimary).toBe(false);
    });

    /*
      **Unchanged, not `INSTRUCTOR`.** The claim is that this control touches no role at all, and
      asserting a particular one instead makes the check pass or fail on which account the query
      happened to return.
    */
    it("...and it granted no role", async () => {
      const row = await tx().profile.findUniqueOrThrow({ where: { id: joinerId } });
      expect(row.role).toBe(spareRole);
    });

    it("sending the same list again changes nothing", async () => {
      const again = await asAdmin().staff.setPrograms({
        profileId: joinerId,
        programIds: [world.programId],
      });
      expect(again.added).toEqual([]);
    });

    /*
      Their course rows go with them, by the cascade on `(programId, userId)`. That is the cleanup
      step the composite key removes rather than leaving to be remembered, and it is why this names
      a course first.
    */
    describe("taking them off again", () => {
      let removed: { removed: string[] };

      beforeAll(async () => {
        await tx().courseInstructor.create({
          data: { courseId: world.courseId, programId: world.programId, userId: joinerId },
        });
        removed = await asAdmin().staff.setPrograms({ profileId: joinerId, programIds: [] });
      });

      it("taking them off names the program", () => {
        expect(removed.removed).toEqual([programName]);
      });

      it("...and their name comes off its courses with them", async () => {
        const left = await tx().courseInstructor.count({
          where: { programId: world.programId, userId: joinerId },
        });
        expect(left).toBe(0);
      });
    });

    /*
      The last instructor is refused, the same shape and the same reasoning as revoking the last
      admin: a program with no instructors cannot be authored in or graded by anybody, and the only
      way back is a database edit. Asserted still there afterwards, because a refusal that returned
      the right code while the row went anyway would look correct.
    */
    describe("the only instructor on a program", () => {
      it("the only instructor on a program cannot be taken off it", async () => {
        const only = await tx().programInstructor.findMany({
          where: { programId: world.programId },
          select: { userId: true },
        });
        expect(only).toHaveLength(1);
        const code = await refusal(() =>
          asAdmin().staff.setPrograms({ profileId: only[0]!.userId, programIds: [] }),
        );
        expect(code).toBe("PRECONDITION_FAILED");
      });

      it("...and they are still on it", async () => {
        const left = await tx().programInstructor.count({
          where: { programId: world.programId, userId: world.instructorId },
        });
        expect(left).toBe(1);
      });
    });

    /*
      A fellow of the program cannot also instruct it, the mirror of `enrollments.join` refusing an
      instructor. Being both would put their own submissions in the queue they are meant to be
      working through.
    */
    it("a fellow of the program cannot be put on it as an instructor", async () => {
      await tx().profile.update({
        where: { id: world.student.studentId },
        data: { role: "INSTRUCTOR" },
      });
      const code = await refusal(() =>
        asAdmin().staff.setPrograms({
          profileId: world.student.studentId,
          programIds: [world.programId],
        }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("a student cannot be put on a program either", async () => {
      const code = await refusal(() =>
        asAdmin().staff.setPrograms({ profileId: bystanderId, programIds: [world.programId] }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });
  });

  describe("what the screen reads", () => {
    it("staff are listed and students are not", async () => {
      const people = await asAdmin().staff.people();
      expect(people.people.every((row) => row.role === "INSTRUCTOR" || row.role === "ADMIN")).toBe(
        true,
      );
    });

    it("the caller is marked as themselves", async () => {
      const people = await asAdmin().staff.people();
      expect(people.people.find((row) => row.id === adminId)?.isYou).toBe(true);
    });
  });

  /*
    Nothing survived. Every account and every invitation above was made inside the transaction, so
    after it rolls back none of them exists — which is the same claim the script made about roles it
    had found rather than created.
  */
  describe("nothing survived the rollback", () => {
    it("the admin account this run made is gone", async () => {
      expect(await db.profile.count({ where: { id: adminId } })).toBe(0);
    });

    it("...and so is the account that redeemed an invitation", async () => {
      expect(await db.profile.count({ where: { id: joinerId } })).toBe(0);
    });

    it("none of the invitations this run created survived", async () => {
      expect(await db.instructorInvite.count({ where: { id: { in: createdHere } } })).toBe(0);
    });

    it("...and the table holds exactly what it did before", async () => {
      expect(await db.instructorInvite.count()).toBe(invitesBefore);
    });

    // Reported so a run that created nothing cannot look like a run that cleaned up after itself.
    it("this run did create some to begin with", () => {
      expect(createdHere.length).toBeGreaterThan(0);
    });
  });
});
