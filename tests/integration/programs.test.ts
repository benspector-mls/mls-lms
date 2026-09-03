/**
 * Who instructs a program, who owns it, and how one is retired and deleted.
 *
 * Run with `npm run test:integration`.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back. Getting fellows onto a
 * roster is the enrollment suite's subject; this is the other half of a program — the people who run
 * it.
 *
 * **Three groups are worth reading.**
 *
 * The instructor-link group takes one account, has it refused while it is a fellow, promotes it, and
 * has it admitted: the link grants a program and never a role, and one account doing both halves is
 * what makes that a comparison rather than two unrelated facts about two people. If that guard were
 * wrong, any instructor could hand out staff access by forwarding a link.
 *
 * The ownership group is written in pairs for the same reason — the owner is allowed and the
 * co-teacher is refused at the same call, because a one-sided check passes against a guard that
 * refuses everybody. The group after it clears `isPrimary` off a program directly, which is the only
 * way to reach the state a deleted owner's account would leave behind.
 *
 * The teaching group is the one that says what being assigned to a course does **not** do. Every
 * instructor of a program can already work in every course of it, so the checks are that a
 * `CourseInstructor` row changes the name on a course and changes nothing about access.
 *
 * Carries all 91 assertions of `verify:programs`, four of which measure something here that they
 * could not measure before.
 *
 * **The owner is a plain instructor rather than a demoted admin.** `assertOwnsProgram` lets an admin
 * through, so an owner who is also an admin makes every "the owner may" check pass on the admin
 * bypass while claiming to measure ownership — and keeps passing if ownership is removed entirely.
 * The script found the deployment's admin as the seeded program's creator, and had to demote it for
 * the length of the run and put the role back at the end. Here the roles are chosen rather than
 * found: the owner holds INSTRUCTOR from the first line, and is raised to ADMIN only for the one
 * group that expects the bypass on purpose, then put back before the group after it.
 *
 * **Three checks that could pass without exercising anything now have something to exercise.** The
 * script looked for a course belonging to another program, for a profile instructing no program, and
 * for a spare fellow to put on the doomed roster, and compared the expected answer against itself
 * when the database offered none — which on a database built only from migrations is every time.
 * This suite makes an instructor who owns a separate program with a course of its own, and a fellow
 * enrolled on the program that gets deleted, so the two refusals and the roster count are real.
 *
 * **And the account that was promoted is checked as gone rather than as restored.** The script
 * borrowed a seeded fellow and could only assert that its role came back; every account here is made
 * inside the transaction, so the stronger claim is available — after the rollback there is no such
 * profile at all.
 */
import { db } from "@/lib/prisma";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAccount } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

type Programs = ReturnType<typeof createCaller>["programs"];
type Preview = Awaited<ReturnType<Programs["previewInstructorLink"]>>;
type Settings = Awaited<ReturnType<Programs["settings"]>>;
type Impact = Awaited<ReturnType<Programs["removalImpact"]>>;

/** Unique to this run, so the last group can ask whether any program it made survived. */
const suffix = crypto.randomUUID().slice(0, 8);
const termFor = (letter: string) => `Program Verify ${letter} ${suffix}`;

/**
 * What a call refused with, as a string to compare against.
 *
 * The literal `"accepted"` is what comes back when the call did *not* refuse, which is what makes a
 * missing guard a visible failure rather than a passing test.
 */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/** What a call refused with, message included, for the checks that are about the wording. */
async function refusalMessage(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/*
  ---- The constraint itself, read from the catalog rather than provoked --------

  Every ownership check further down passes against a program that happens to have one primary row.
  What makes two of them impossible is a partial unique index, which Prisma cannot express and which
  therefore exists only in a migration — so asking the database is how this notices a deployment
  where that migration has not been run.

  Read rather than tried. Writing a second primary row would prove the same thing and abort the
  transaction every other check here runs inside. It reads the catalog and writes nothing, so this
  group needs no transaction of its own either.
*/
describe("one primary instructor per program", () => {
  let definition: string | undefined;

  beforeAll(async () => {
    const rows = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'program_instructors_one_primary_per_program'
    `;
    definition = rows[0]?.indexdef;
  });

  it("one primary per program is a database constraint", () => {
    expect(definition).toBeDefined();
  });

  it("...unique, and only over the primary rows", () => {
    expect(/CREATE UNIQUE INDEX/.test(definition ?? "")).toBe(true);
    expect(/WHERE is_primary/.test(definition ?? "")).toBe(true);
  });
});

/*
  Everything below shares one transaction, because it is one narrative: a program is created, a
  fellow is refused its instructor link, promoted, admitted, given a course, handed the program and
  handed it back, and finally removed from it. Splitting it would mean rebuilding the same four
  accounts and five programs for each half of a question. Nothing here provokes a database
  constraint — every refusal is one a procedure makes before writing — so one transaction survives
  the whole file.
*/
describe("instructing a program, owning it, and retiring it", () => {
  const tx = withRollback(180_000);

  /**
   * The owner, a plain instructor.
   *
   * Never an admin, because `assertOwnsProgram` returns early for one: an admin owner would make
   * every "the owner may" check below pass on the bypass rather than on ownership. The role is
   * raised to ADMIN for exactly one group, which is the group about the bypass.
   */
  let ownerId: string;
  /** The account that starts as a fellow, is refused the link, is promoted, and is admitted. */
  let joinerId: string;
  /** An instructor of a different program, for the refusals that need somebody outside this one. */
  let strangerId: string;
  /** That other program's course, which this program's owner must not be able to assign. */
  let strangerCourseId: string;
  /** A fellow with no other part in the narrative, so the deletion impact has a roster to count. */
  let bystanderId: string;

  /** The program the whole narrative is about, created by the account that then owns it. */
  let programId: string;
  let joinToken: string;
  let instructorToken: string;

  const asOwner = () => createCaller(tx(), ownerId);
  const asJoiner = () => createCaller(tx(), joinerId);

  beforeAll(async () => {
    ownerId = await makeAccount(tx(), { role: "INSTRUCTOR", displayName: "Verify Owner" });
    joinerId = await makeAccount(tx(), { displayName: "Verify Joiner" });
    bystanderId = await makeAccount(tx(), { displayName: "Verify Bystander" });

    /*
      An instructor who owns a program of their own, rather than merely somebody who is not the
      joiner. Two refusals below are about instructing *this* program, and an outsider who holds no
      instructor role at all would let either of them pass on the role check instead.
    */
    strangerId = await makeAccount(tx(), { role: "INSTRUCTOR", displayName: "Verify Stranger" });
    const asStranger = createCaller(tx(), strangerId);
    const elsewhere = await asStranger.programs.create({
      name: "Verify Elsewhere",
      term: termFor("Z"),
    });
    strangerCourseId = (
      await asStranger.courses.create({
        programId: elsewhere.id,
        name: "Verify Elsewhere Course",
      })
    ).course.id;

    const program = await asOwner().programs.create({
      name: "Verify Instructors",
      term: termFor("A"),
    });
    programId = program.id;
    const tokens = await tx().program.findUniqueOrThrow({
      where: { id: program.id },
      select: { joinToken: true, instructorToken: true },
    });
    joinToken = tokens.joinToken;
    instructorToken = tokens.instructorToken;
  });

  /*
    ---- The instructor link ---------------------------------------------------

    One link per program, where there used to be one per course. It admits somebody to authoring and
    to every fellow's grade in every course of the year, so its refusals matter more than its
    successes.
  */
  describe("the instructor link", () => {
    it("a new program gets an instructor token", () => {
      expect(instructorToken.length).toBeGreaterThanOrEqual(32);
    });

    it("...which is not its join token", () => {
      expect(instructorToken).not.toBe(joinToken);
    });

    it("an unknown instructor token previews as nothing", async () => {
      const preview = await asJoiner().programs.previewInstructorLink({ token: "not-a-real-token" });
      expect(preview).toBeNull();
    });
  });

  describe("refused while the account is a fellow", () => {
    let preview: Preview;
    let message: string;

    beforeAll(async () => {
      preview = await asJoiner().programs.previewInstructorLink({ token: instructorToken });
      message = await refusalMessage(() =>
        asJoiner().programs.acceptInstructorLink({ token: instructorToken }),
      );
    });

    it("a fellow is told they are not eligible", () => {
      expect(preview?.eligible).toBe(false);
    });

    it("...and the preview still names the program", () => {
      expect(preview?.name).toBe("Verify Instructors");
    });

    it("...and its term", () => {
      expect(preview?.term).toBe(termFor("A"));
    });

    it("a fellow cannot take up an instructor link", () => {
      expect(message).toContain("instructor invitation");
    });

    it("...and no instructor row was written", async () => {
      const rows = await tx().programInstructor.count({ where: { programId, userId: joinerId } });
      expect(rows).toBe(0);
    });

    /*
      And their role is untouched, which is the half that would matter most if it were wrong. A link
      that raised a role would be a second path to staff access with no admin involved.
    */
    it("...and their role was not raised", async () => {
      const profile = await tx().profile.findUniqueOrThrow({ where: { id: joinerId } });
      expect(profile.role).toBe("STUDENT");
    });
  });

  /*
    ---- Made staff, and now admitted ------------------------------------------

    The promotion an admin performs, written to the row directly here because `staff.setAdmin` and
    the invitation flow are `tests/integration/staff.test.ts`'s subject rather than this file's.
  */
  describe("made staff, and now admitted", () => {
    let preview: Preview;

    beforeAll(async () => {
      await tx().profile.update({ where: { id: joinerId }, data: { role: "INSTRUCTOR" } });
      preview = await asJoiner().programs.previewInstructorLink({ token: instructorToken });
    });

    /*
      Asked before redeeming, so it is genuinely somebody outside the program. Holding the role says
      nothing about which programs, which is the distinction every gate here rests on.
    */
    it("an instructor who does not instruct it cannot replace its link", async () => {
      const code = await refusal(() => asJoiner().programs.regenerateInstructorToken({ programId }));
      expect(code).toBe("FORBIDDEN");
    });

    it("...and cannot read its settings either", async () => {
      expect(await refusal(() => asJoiner().programs.settings({ programId }))).toBe("FORBIDDEN");
    });

    it("an instructor is eligible", () => {
      expect(preview?.eligible).toBe(true);
    });

    it("...and does not instruct it yet", () => {
      expect(preview?.alreadyInstructs).toBe(false);
    });

    describe("redeeming it", () => {
      let redeemed: { added: boolean };
      let settings: Settings;

      beforeAll(async () => {
        redeemed = await asJoiner().programs.acceptInstructorLink({ token: instructorToken });
        settings = await asJoiner().programs.settings({ programId });
      });

      it("redeeming adds them", () => {
        expect(redeemed.added).toBe(true);
      });

      /*
        The check the whole feature is for. A `ProgramInstructor` row that exists but does not
        actually let somebody work in the term would look completely correct in the database — every
        authoring procedure gates on this table, so the proof is calling one.
      */
      it("...and they can now read the program they instruct", () => {
        expect(settings.program.id).toBe(programId);
      });

      it("...and it lists both instructors", () => {
        expect(settings.program.instructors).toHaveLength(2);
      });

      it("...with the creator marked as such", () => {
        expect(settings.program.instructors.filter((row) => row.isPrimary)).toHaveLength(1);
      });

      /*
        It adds them to the program and to no course, deliberately. Which courses somebody teaches is
        the owner's decision on the program's settings screen, and it grants nothing anyway — so
        guessing here would only put a name on a course nobody put it on.
      */
      it("...and it named them on no course", async () => {
        const named = await tx().courseInstructor.count({ where: { programId, userId: joinerId } });
        expect(named).toBe(0);
      });

      it("...and did not raise their role", async () => {
        const profile = await tx().profile.findUniqueOrThrow({ where: { id: joinerId } });
        expect(profile.role).toBe("INSTRUCTOR");
      });
    });

    /*
      Idempotent, the same way `enrollments.join` is: `@@unique([programId, userId])` means a
      bookmarked link is not a case to handle. The row count is the half that matters — `added:
      false` alone would pass while a second row was written by something else.
    */
    describe("redeeming it again", () => {
      let again: { added: boolean };

      beforeAll(async () => {
        again = await asJoiner().programs.acceptInstructorLink({ token: instructorToken });
      });

      it("redeeming twice adds nothing", () => {
        expect(again.added).toBe(false);
      });

      it("...and there is still one row for them", async () => {
        const rows = await tx().programInstructor.count({ where: { programId, userId: joinerId } });
        expect(rows).toBe(1);
      });
    });
  });

  // ---- The refusals that are about the program rather than the account -------
  describe("what the program itself refuses", () => {
    it("an archived program takes no new instructors", async () => {
      const archived = await asOwner().programs.create({
        name: "Verify Instructors Archived",
        term: termFor("B"),
      });
      await asOwner().programs.setArchived({ programId: archived.id, archived: true });
      const token = (
        await tx().program.findUniqueOrThrow({
          where: { id: archived.id },
          select: { instructorToken: true },
        })
      ).instructorToken;

      const code = await refusal(() => asJoiner().programs.acceptInstructorLink({ token }));
      expect(code).toBe("PRECONDITION_FAILED");
    });

    /*
      Enrolled as a fellow and instructing are mutually exclusive, the mirror of `enrollments.join`
      refusing an instructor of the program. Being both would put their own submissions in the queue
      they are meant to be working through.
    */
    it("somebody enrolled as a fellow cannot also instruct the program", async () => {
      const both = await asOwner().programs.create({
        name: "Verify Instructors Enrolled",
        term: termFor("C"),
      });
      const token = (
        await tx().program.findUniqueOrThrow({
          where: { id: both.id },
          select: { instructorToken: true },
        })
      ).instructorToken;
      /*
        The enrollment is written directly rather than joined through the link, because the roster
        allowlist is the enrollment suite's subject and this check is about the pair of roles.
      */
      await tx().enrollment.create({
        data: { programId: both.id, studentId: joinerId, status: "ACTIVE" },
      });

      const code = await refusal(() => asJoiner().programs.acceptInstructorLink({ token }));
      expect(code).toBe("PRECONDITION_FAILED");

      await tx().enrollment.deleteMany({ where: { programId: both.id, studentId: joinerId } });
    });
  });

  describe("replacing the link", () => {
    let replaced: { instructorToken: string };

    beforeAll(async () => {
      replaced = await asOwner().programs.regenerateInstructorToken({ programId });
    });

    it("replacing the instructor link changes it", () => {
      expect(replaced.instructorToken).not.toBe(instructorToken);
    });

    it("...and the old one stops working", async () => {
      const code = await refusal(() =>
        asJoiner().programs.acceptInstructorLink({ token: instructorToken }),
      );
      expect(code).toBe("NOT_FOUND");
    });

    it("...while instructors already on the program keep it", async () => {
      const settings = await asJoiner().programs.settings({ programId });
      expect(settings.program.instructors).toHaveLength(2);
    });
  });

  /*
    ---- Who teaches which course ----------------------------------------------

    The one thing that is still per course, and the checks are about what it does *not* do: every
    instructor of the program can already work in every course of it, so a `CourseInstructor` row
    decides whose name is on a course and nothing about access.
  */
  describe("who teaches which course", () => {
    let taughtId: string;

    beforeAll(async () => {
      taughtId = (await asOwner().courses.create({ programId, name: "Verify Taught" })).course.id;
    });

    it("creating a course names its creator on it", async () => {
      const named = await tx().courseInstructor.count({
        where: { courseId: taughtId, userId: ownerId },
      });
      expect(named).toBe(1);
    });

    it("an instructor named on no course can still author in it", async () => {
      const context = await asJoiner().assignments.authoringContext({ courseId: taughtId });
      expect(context.course.name).toBe("Verify Taught");
    });

    it("the owner can name somebody on a course", async () => {
      const set = await asOwner().programs.setCourseInstructors({
        programId,
        courseId: taughtId,
        userIds: [ownerId, joinerId],
      });
      expect(set.teaching).toBe(2);
    });

    it("...and unname them, which takes nothing away", async () => {
      const set = await asOwner().programs.setCourseInstructors({
        programId,
        courseId: taughtId,
        userIds: [ownerId],
      });
      expect(set.teaching).toBe(1);
    });

    it("...leaving them still able to author in it", async () => {
      const context = await asJoiner().assignments.authoringContext({ courseId: taughtId });
      expect(context.course.name).toBe("Verify Taught");
    });

    it("a co-teacher cannot decide who teaches what", async () => {
      const code = await refusal(() =>
        asJoiner().programs.setCourseInstructors({ programId, courseId: taughtId, userIds: [] }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    /*
      The composite foreign key's guarantee, turned into a sentence. `(programId, userId)` references
      `program_instructors`, so naming somebody who does not instruct the term is unrepresentable —
      this is the procedure saying so in words rather than letting the database refuse.
    */
    it("somebody who does not instruct the program cannot be named on its course", async () => {
      const code = await refusal(() =>
        asOwner().programs.setCourseInstructors({
          programId,
          courseId: taughtId,
          userIds: [strangerId],
        }),
      );
      expect(code).toBe("BAD_REQUEST");
    });

    /*
      A course of another term, refused rather than silently reassigned. The composite key would
      refuse it too — `(courseId, programId)` references `courses(id, programId)` — and this is the
      procedure turning that into something an instructor can read.
    */
    it("a course of another program cannot be assigned through this one", async () => {
      const code = await refusal(() =>
        asOwner().programs.setCourseInstructors({
          programId,
          courseId: strangerCourseId,
          userIds: [],
        }),
      );
      expect(code).toBe("NOT_FOUND");
    });
  });

  /*
    ---- Who owns the program --------------------------------------------------

    Two instructors on one program, which is what makes any of this checkable: the creator owns it
    and the one who redeemed the link does not, and every check here is a pair — the owner is allowed
    and the co-teacher is refused at the same call. A single-sided check would pass against a guard
    that refused everybody.

    The rule this exists for is the second one. Before it, anybody who taught could remove the person
    who set the term up, which was the one permission in the application that nothing guarded.
  */
  describe("who owns the program", () => {
    let ownerView: Settings;
    let coTeacherView: Settings;

    beforeAll(async () => {
      ownerView = await asOwner().programs.settings({ programId });
      coTeacherView = await asJoiner().programs.settings({ programId });
    });

    it("the creator owns the program", () => {
      expect(ownerView.ownerId).toBe(ownerId);
    });

    it("...and is told they may act as owner", () => {
      expect(ownerView.callerActsAsOwner).toBe(true);
    });

    it("...while the co-teacher sees the same owner", () => {
      expect(coTeacherView.ownerId).toBe(ownerId);
    });

    it("...and is told they may not", () => {
      expect(coTeacherView.callerActsAsOwner).toBe(false);
    });
  });

  /*
    Archiving is the one action a single instructor takes that changes what every fellow on the
    roster sees, in every course at once, which is why it is owner-gated.
  */
  describe("archiving is the owner's", () => {
    it("a co-teacher cannot archive the program", async () => {
      const code = await refusal(() =>
        asJoiner().programs.setArchived({ programId, archived: true }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("...and the refusal names who can", async () => {
      const message = await refusalMessage(() =>
        asJoiner().programs.setArchived({ programId, archived: true }),
      );
      expect(message).toContain("because they own it");
    });

    it("...while the owner may", async () => {
      const archived = await asOwner().programs.setArchived({ programId, archived: true });
      expect(archived.archivedAt).not.toBeNull();
    });

    /*
      Reopening is the same gate, because it is the same mutation with a boolean. A co-teacher can
      read an archived program in full and cannot bring it back.
    */
    it("...and a co-teacher cannot reopen it either", async () => {
      const code = await refusal(() =>
        asJoiner().programs.setArchived({ programId, archived: false }),
      );
      expect(code).toBe("FORBIDDEN");
      await asOwner().programs.setArchived({ programId, archived: false });
    });
  });

  describe("removing the owner, and handing the program on", () => {
    it("a co-teacher cannot remove the owner", async () => {
      const code = await refusal(() =>
        asJoiner().programs.removeInstructor({ programId, userId: ownerId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    it("...and nothing was removed", async () => {
      expect(await tx().programInstructor.count({ where: { programId } })).toBe(2);
    });

    it("a co-teacher cannot hand the program to themselves", async () => {
      const code = await refusal(() =>
        asJoiner().programs.transferOwnership({ programId, userId: joinerId }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    /*
      Somebody chosen by the property this check needs — holding no instructor row on this program —
      rather than by a proxy for it like "a profile that is not the one I promoted". A fixture picked
      by a proxy eventually picks the wrong one, and it fails silently in the direction that matters.
    */
    it("the owner cannot hand it to somebody who does not instruct it", async () => {
      const code = await refusal(() =>
        asOwner().programs.transferOwnership({ programId, userId: strangerId }),
      );
      expect(code).toBe("NOT_FOUND");
    });

    it("...nor to whoever already owns it", async () => {
      const code = await refusal(() =>
        asOwner().programs.transferOwnership({ programId, userId: ownerId }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });
  });

  /*
    The transfer itself, and the facts it has to leave behind. `isPrimary` is checked directly
    against the table rather than only through `settings`, because the failure this is guarding
    against is two rows holding it — which reads as entirely normal through every procedure, since
    each takes the first row it finds.
  */
  describe("the transfer itself", () => {
    let handedOn: { ownerId: string };

    beforeAll(async () => {
      handedOn = await asOwner().programs.transferOwnership({ programId, userId: joinerId });
    });

    it("the owner can hand the program on", () => {
      expect(handedOn.ownerId).toBe(joinerId);
    });

    it("...and exactly one row is primary afterwards", async () => {
      const primary = await tx().programInstructor.count({
        where: { programId, isPrimary: true },
      });
      expect(primary).toBe(1);
    });

    it("...which is the new owner's", async () => {
      expect((await asJoiner().programs.settings({ programId })).ownerId).toBe(joinerId);
    });

    it("...the new owner can now archive it", async () => {
      const archived = await asJoiner().programs.setArchived({ programId, archived: true });
      expect(archived.archivedAt).not.toBeNull();
      await asJoiner().programs.setArchived({ programId, archived: false });
    });

    it("...and the old owner cannot", async () => {
      const code = await refusal(() =>
        asOwner().programs.setArchived({ programId, archived: true }),
      );
      expect(code).toBe("FORBIDDEN");
    });

    /*
      Handed back, so the groups after this one see the program they were written against. The
      assertion is that it moves in both directions rather than only away from whoever created the
      program.
    */
    it("...and it can be handed back", async () => {
      const back = await asJoiner().programs.transferOwnership({ programId, userId: ownerId });
      expect(back.ownerId).toBe(ownerId);
    });

    it("...leaving one primary row again", async () => {
      const primary = await tx().programInstructor.count({
        where: { programId, isPrimary: true },
      });
      expect(primary).toBe(1);
    });
  });

  /*
    ---- Ownership when no row holds it ----------------------------------------

    `ProgramInstructor` cascades on the profile, so deleting an owner's account takes the `isPrimary`
    row with it and leaves a term with instructors and nobody who can archive it. Nothing in the
    application deletes a profile — that is a database edit somebody makes by hand — which is exactly
    why the fallback has to hold with nobody there to invoke it, and why it is checked by clearing
    the column directly rather than through a procedure. The longest-serving instructor left
    inherits.
  */
  describe("ownership when no row holds it", () => {
    let derivedId: string;
    let derivedToken: string;

    beforeAll(async () => {
      const derived = await asOwner().programs.create({
        name: "Verify Derived Ownership",
        term: termFor("D"),
      });
      derivedId = derived.id;
      derivedToken = (
        await tx().program.findUniqueOrThrow({
          where: { id: derived.id },
          select: { instructorToken: true },
        })
      ).instructorToken;

      await asJoiner().programs.acceptInstructorLink({ token: derivedToken });
      await tx().programInstructor.updateMany({
        where: { programId: derivedId },
        data: { isPrimary: false },
      });
      /*
        Backdated so that "longest-serving" is a real ordering here.

        Both rows were written inside this transaction, and Postgres resolves `now()` to the
        transaction's start time — so they share a `createdAt` to the microsecond and the fallback
        would be decided by its tie-break rather than by the rule it claims to be about. A day apart
        is what the difference looks like in a term somebody is running.
      */
      await tx().programInstructor.updateMany({
        where: { programId: derivedId, userId: ownerId },
        data: { createdAt: new Date(Date.now() - 86_400_000) },
      });
    });

    it("a program with no primary row still has an owner", async () => {
      expect((await asOwner().programs.settings({ programId: derivedId })).ownerId).toBe(ownerId);
    });

    it("...and it is the longest-serving instructor, who can still archive it", async () => {
      const archived = await asOwner().programs.setArchived({
        programId: derivedId,
        archived: true,
      });
      expect(archived.archivedAt).not.toBeNull();
    });

    it("...while the one who joined later still cannot", async () => {
      const code = await refusal(() =>
        asJoiner().programs.setArchived({ programId: derivedId, archived: false }),
      );
      expect(code).toBe("FORBIDDEN");
      await asOwner().programs.setArchived({ programId: derivedId, archived: false });
    });

    /*
      An owner who leaves without handing the term on gives it to the longest-serving instructor
      left, by the same rule. Said back by the procedure rather than left to be noticed, because it
      is the right default and not one anybody would guess.
    */
    describe("an owner who leaves", () => {
      let leaving: { newOwnerName: string | null };

      beforeAll(async () => {
        leaving = await asOwner().programs.removeInstructor({
          programId: derivedId,
          userId: ownerId,
        });
      });

      it("an owner who leaves says who inherits", () => {
        expect(leaving.newOwnerName).not.toBeNull();
      });

      it("...and that is who owns it now", async () => {
        const settings = await asJoiner().programs.settings({ programId: derivedId });
        expect(settings.ownerId).toBe(joinerId);
      });
    });

    /*
      ---- An admin acts as owner on every program -----------------------------

      A decision rather than a consequence of a guard written for something else. An admin is the
      recovery path for an owner who has left the school without handing the term on, and without one
      every rule above is a way for a program to end up with nobody who can administer it.

      Checked against the derived program, which this account now neither owns nor instructs — being
      an admin is the whole of what admits them. Which is also why the role is raised here rather
      than at the top of the file: every check above had to run without it, and `afterAll` puts it
      back so that nothing in the groups below passes on the bypass either.
    */
    describe("an admin acts as owner on every program", () => {
      beforeAll(async () => {
        await tx().profile.update({ where: { id: ownerId }, data: { role: "ADMIN" } });
      });

      afterAll(async () => {
        await tx().profile.update({ where: { id: ownerId }, data: { role: "INSTRUCTOR" } });
      });

      it("an admin does not instruct this program", async () => {
        const rows = await tx().programInstructor.count({
          where: { programId: derivedId, userId: ownerId },
        });
        expect(rows).toBe(0);
      });

      it("...and archives it anyway", async () => {
        const archived = await asOwner().programs.setArchived({
          programId: derivedId,
          archived: true,
        });
        expect(archived.archivedAt).not.toBeNull();
        await asOwner().programs.setArchived({ programId: derivedId, archived: false });
      });

      /*
        Added back as an ordinary instructor first, so that removing the owner here is a program with
        two instructors rather than the last-one refusal wearing an ownership costume.
      */
      it("...and can remove an owner who is not them", async () => {
        await asOwner().programs.acceptInstructorLink({ token: derivedToken });
        const removed = await asOwner().programs.removeInstructor({
          programId: derivedId,
          userId: joinerId,
        });
        expect(removed.instructorName.length).toBeGreaterThan(0);
      });
    });
  });

  /*
    ---- Deleting a program ----------------------------------------------------

    The one irreversible operation on a whole year, so the checks that earn their place are the
    refusals — and each of them asserts the program is **still there** afterwards, which is the half
    that matters. A refusal that returned the right code while the rows went anyway would look
    correct in every log this suite produces.

    Archived first, because archiving is reversible and this is not: making it the only path puts a
    survivable step in front of a permanent one.
  */
  describe("deleting a program", () => {
    let doomedId: string;
    let doomedCourseId: string;
    let doomedCohortId: string;

    beforeAll(async () => {
      const doomed = await asOwner().programs.create({
        name: "Verify Deletion",
        term: termFor("E"),
      });
      doomedId = doomed.id;
      doomedCourseId = (
        await asOwner().courses.create({ programId: doomedId, name: "Verify Doomed Course" })
      ).course.id;
      doomedCohortId = (
        await asOwner().cohorts.create({ programId: doomedId, name: "Verify Doomed Cohort" })
      ).id;

      /*
        Somebody to be counted on the roster, enrolled directly rather than joined through the link,
        because the roster allowlist is the enrollment suite's subject. It is a fellow with no other
        part in this narrative, because the one this file promotes is an instructor by now.
      */
      await tx().enrollment.create({
        data: {
          programId: doomedId,
          studentId: bystanderId,
          status: "ACTIVE",
          cohortId: doomedCohortId,
        },
      });

      // Before archiving, because an archived program takes no new instructors.
      const token = (
        await tx().program.findUniqueOrThrow({
          where: { id: doomedId },
          select: { instructorToken: true },
        })
      ).instructorToken;
      await asJoiner().programs.acceptInstructorLink({ token });
    });

    it("a program that is still running cannot be deleted", async () => {
      const code = await refusal(() =>
        asOwner().programs.remove({ programId: doomedId, confirmTerm: termFor("E") }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("...and its impact cannot even be read", async () => {
      const code = await refusal(() => asOwner().programs.removalImpact({ programId: doomedId }));
      expect(code).toBe("PRECONDITION_FAILED");
    });

    describe("once it is archived", () => {
      beforeAll(async () => {
        await asOwner().programs.setArchived({ programId: doomedId, archived: true });
      });

      it("a co-teacher cannot delete an archived program", async () => {
        const code = await refusal(() =>
          asJoiner().programs.remove({ programId: doomedId, confirmTerm: termFor("E") }),
        );
        expect(code).toBe("FORBIDDEN");
      });

      it("...nor read what deleting it would destroy", async () => {
        const code = await refusal(() =>
          asJoiner().programs.removalImpact({ programId: doomedId }),
        );
        expect(code).toBe("FORBIDDEN");
      });

      /*
        The counts, checked against rows this group put there. The impact read is what the
        confirmation screen states as fact, so it being right is the difference between a sentence
        somebody can weigh and a number they cannot check.
      */
      describe("what deleting it would destroy", () => {
        let impact: Impact;

        beforeAll(async () => {
          impact = await asOwner().programs.removalImpact({ programId: doomedId });
        });

        it("the impact counts its courses", () => {
          expect(impact.courses).toBe(1);
        });

        it("...its cohorts", () => {
          expect(impact.cohorts).toBe(1);
        });

        it("...its instructors", () => {
          expect(impact.instructors).toBe(2);
        });

        it("...and the fellows on its roster", () => {
          expect(impact.enrollments).toBe(1);
        });

        it("...and asks for the term rather than the name", () => {
          expect(impact.confirm).toBe(termFor("E"));
        });
      });

      describe("confirming it", () => {
        it("the wrong confirmation is refused", async () => {
          const code = await refusal(() =>
            asOwner().programs.remove({ programId: doomedId, confirmTerm: "Verify Deletion" }),
          );
          expect(code).toBe("BAD_REQUEST");
        });

        it("...and the program is still there", async () => {
          expect(await tx().program.count({ where: { id: doomedId } })).toBe(1);
        });
      });

      describe("deleting it", () => {
        let deleted: { name: string };

        beforeAll(async () => {
          deleted = await asOwner().programs.remove({
            programId: doomedId,
            confirmTerm: termFor("E"),
          });
        });

        it("the owner can delete an archived program", () => {
          expect(deleted.name).toBe("Verify Deletion");
        });

        it("...and it is gone", async () => {
          expect(await tx().program.count({ where: { id: doomedId } })).toBe(0);
        });

        /*
          The cascade, asserted rather than assumed. Every one of these is a separate foreign key
          with its own `onDelete`, and the one that is wrong is the one that leaves rows pointing at
          a program that no longer exists.
        */
        it("...taking its courses with it", async () => {
          expect(await tx().course.count({ where: { id: doomedCourseId } })).toBe(0);
        });

        it("...its cohorts", async () => {
          expect(await tx().cohort.count({ where: { id: doomedCohortId } })).toBe(0);
        });

        it("...its enrollments", async () => {
          expect(await tx().enrollment.count({ where: { programId: doomedId } })).toBe(0);
        });

        it("...and its instructor rows", async () => {
          expect(await tx().programInstructor.count({ where: { programId: doomedId } })).toBe(0);
        });

        it("...and it leaves the program list", async () => {
          const listed = await asOwner().programs.listMine();
          expect(listed.some((row) => row.id === doomedId)).toBe(false);
        });

        it("...while a program deleted twice is simply not found", async () => {
          const code = await refusal(() =>
            asOwner().programs.remove({ programId: doomedId, confirmTerm: termFor("E") }),
          );
          expect(code).toBe("NOT_FOUND");
        });
      });
    });
  });

  /*
    ---- Removing an instructor ------------------------------------------------

    The last one is refused, the same shape and the same reasoning as revoking the last admin: a
    program with no instructors cannot be authored in or graded by anybody, and the only way back is
    a database edit. The remaining count is asserted before that refusal, because a spare instructor
    lying around would make it pass while testing nothing.
  */
  describe("removing an instructor", () => {
    let removed: { programId: string };

    beforeAll(async () => {
      removed = await asOwner().programs.removeInstructor({ programId, userId: joinerId });
    });

    it("removing one of two instructors is allowed", () => {
      expect(removed.programId).toBe(programId);
    });

    it("...and they lose access with it", async () => {
      expect(await refusal(() => asJoiner().programs.settings({ programId }))).toBe("FORBIDDEN");
    });

    /*
      And their course rows went with them, by the cascade on `(programId, userId)`. That is the
      cleanup step the composite key removes rather than leaving to be remembered — before it,
      somebody removed from a program kept their name on its courses.
    */
    it("...and their name is off every course of it", async () => {
      const named = await tx().courseInstructor.count({ where: { programId, userId: joinerId } });
      expect(named).toBe(0);
    });

    it("...leaving exactly one instructor", async () => {
      expect(await tx().programInstructor.count({ where: { programId } })).toBe(1);
    });

    it("...and the last one cannot be removed", async () => {
      const code = await refusal(() =>
        asOwner().programs.removeInstructor({ programId, userId: ownerId }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("removing somebody who does not instruct the program is refused", async () => {
      const code = await refusal(() =>
        asOwner().programs.removeInstructor({ programId, userId: joinerId }),
      );
      expect(code).toBe("NOT_FOUND");
    });
  });

  /*
    Nothing survived. Every account and every program above was made inside the transaction, so `db`
    — which reads the committed database — never saw any of it, and will not after the rollback
    either.
  */
  describe("nothing survived the rollback", () => {
    it("the account this run promoted does not exist outside the transaction", async () => {
      expect(await db.profile.count({ where: { id: joinerId } })).toBe(0);
    });

    it("no programs this run created survived the rollback", async () => {
      expect(await db.program.count({ where: { term: { contains: suffix } } })).toBe(0);
    });
  });
});
