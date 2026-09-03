/**
 * Work handed in by a team: who may hand it in, which row holds it, and who is told.
 *
 * Run with `npm run test:integration`, or `npm run test:integration:supabase` against the
 * development Supabase project.
 *
 * `team-sets.test.ts` covers making the teams. This covers what happens when one of them hands
 * something in, which is the half where a mistake is expensive: the whole design is that **one row
 * holds the work and every member keeps a row of their own**, so the failures worth checking are a
 * mirror carrying something it should not, a member left one round behind, and a team appearing in
 * the grading pile once per member instead of once.
 *
 * Driven through the tRPC callers inside a transaction that is rolled back, against a course, a
 * team set and a `SELF_DIRECTED` assignment the suite creates inside that same transaction. That
 * kind is chosen because it needs no GitHub, no sandbox and no model, and because it exercises the
 * same `claimTeamWork` / `recordHandIn` / `syncTeamRows` path a repository assignment does — the
 * difference between the kinds is where the work is, which is exactly the part that never reaches a
 * mirror.
 *
 * Each group holds a transaction of its own, because a refusal that comes from a constraint aborts
 * the transaction it happens in.
 *
 * Carries the 51 assertions `verify:team-work` held, **none of which had run**. The script needed a
 * seeded course with an instructor, a unit and three distinct fellows; a seeded database has one
 * fellow, so it reported a skip and measured nothing on every run. Three fellows are what these
 * checks require — two members cannot tell "the fan-out reached everybody" from "the fan-out
 * reached the first mirror", and the third is somebody to place on the team afterwards — so the
 * fixture makes three.
 *
 * **One check is stronger here than it was in the script.** "A graded team is out of the pile
 * entirely" counted this assignment's rows in the pile and expected none, which holds just as well
 * when the pile is empty for some quite different reason — and against a course this suite builds
 * from nothing, an empty pile is exactly what a broken `triage` would return. The fixture now hands
 * in a second, individual piece of work in the same course, which stays in the pile throughout, and
 * the check asserts both that none of the team's rows are left and that the pile still holds
 * something.
 */
import { undeliveredApprovalWhere } from "@/lib/grade/delivery";
import { groupByAssignment, nameSubtext, triageStudentName } from "@/lib/grade/triage-groups";
import { db } from "@/lib/prisma";
import { feedbackIsUnread } from "@/lib/status";
import { recordActivity, syncTeamRows } from "@/lib/submissions/team";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAssignment, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);

/** The procedures as one user would reach them, bound to this group's transaction. */
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** Unique to this run, so the last group can ask whether anything it made survived. */
const suffix = crypto.randomUUID().slice(0, 8);
const setName = `Team Work ${suffix}`;
const workTitle = `Team Deliverable ${suffix}`;

/** Somebody on the roster, as {@link makeWorld} hands them back. */
type Fellow = World["students"][number];

/**
 * A week from now, computed rather than written as a literal.
 *
 * Several checks below assert that a hand-in made during the run was not late, and a due date
 * written as a fixed calendar day stops being in the future on the day it passes — which would fail
 * this suite months from now for a reason that has nothing to do with teams.
 */
const dueAt = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

/** A team set of one team holding the named members, and an assignment handed in through it. */
async function teamWork(tx: Tx, world: World, members: { id: string }[]) {
  /*
    The set carries its term as well as its course, which is what makes a membership's three keys
    share a column: the enrollment is program-scoped and the set is course-scoped, so without
    `programId` on the set the two ends of a membership would share nothing.
  */
  const set = await tx.teamSet.create({
    data: {
      courseId: world.courseId,
      programId: world.programId,
      name: setName,
      teams: { create: [{ name: "Team 1", position: 0 }] },
    },
    select: { id: true, teams: { select: { id: true } } },
  });
  const team = set.teams[0]!;

  await tx.teamMembership.createMany({
    data: members.map((member) => ({
      teamId: team.id,
      teamSetId: set.id,
      programId: world.programId,
      enrollmentId: member.id,
    })),
  });

  /*
    Self-directed, handed in by link, and graded by hand, which is what `makeAssignment` builds by
    default: one section graded by hand carrying the whole ten points, so `startManual` has a round
    to open, a full score is 10/10, and the completion threshold is comfortably met.
  */
  const assignment = await makeAssignment(tx, {
    courseId: world.courseId,
    courseUnitId: world.unitId,
    title: workTitle,
    dueAt: dueAt(),
    teamSetId: set.id,
  });

  return { setId: set.id, teamId: team.id, assignmentId: assignment.id };
}

/** Every row for one assignment, in a shape the checks can compare. */
async function rowsFor(tx: Tx, assignmentId: string) {
  return tx.submission.findMany({
    where: { assignmentId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      studentId: true,
      status: true,
      submittedAt: true,
      isLate: true,
      teamSubmissionId: true,
      submittedUrl: true,
      handedInById: true,
      finalScore: true,
    },
  });
}

type Row = Awaited<ReturnType<typeof rowsFor>>[number];

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

describe("one hand-in, and what every member's row then says", () => {
  const tx = withRollback();

  let world: World;
  let alice: Fellow;
  let bob: Fellow;
  let cara: Fellow;
  let assignmentId: string;
  let teamId: string;
  let setId: string;

  /** The row holding the team's work, and one member's copy of it, as the first hand-in left them. */
  let work: Row;
  let mirror: Row;
  let afterSecond: Row[];
  let afterLate: Row[];

  const asInstructor = () => createCaller(tx(), world.instructorId);
  const pile = async () =>
    (await asInstructor().submissions.triage({ courseId: world.courseId, cohort: "all" }))
      .submissions;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3 });
    [alice, bob, cara] = world.students as [Fellow, Fellow, Fellow];

    const built = await teamWork(tx(), world, [alice, bob]);
    assignmentId = built.assignmentId;
    teamId = built.teamId;
    setId = built.setId;

    /*
      A second piece of work in the same course, done alone by the fellow who is not on the team,
      handed in and never graded. It is in the pile for the whole of this group, which is what keeps
      the pile checks below from holding for the wrong reason: with nothing else in the course,
      "the team is out of the pile" reads the same whether the team left it or `triage` returned
      nothing at all.
    */
    const separate = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: `Individual Deliverable ${suffix}`,
      dueAt: dueAt(),
    });
    await createCaller(tx(), cara.studentId).submissions.submitWork({
      assignmentId: separate.id,
      submittedUrl: "https://example.com/cara",
    });
  });

  describe("the first hand-in", () => {
    let rows: Row[];

    beforeAll(async () => {
      await createCaller(tx(), alice.studentId).submissions.submitWork({
        assignmentId,
        submittedUrl: "https://example.com/alice",
      });
      rows = await rowsFor(tx(), assignmentId);
      work = rows.find((row) => row.teamSubmissionId === null)!;
      mirror = rows.find((row) => row.teamSubmissionId !== null)!;
    });

    it("one hand-in gives every member of the team a row", () => {
      expect(rows).toHaveLength(2);
    });

    it("exactly one of them holds the work", () => {
      expect(rows.filter((row) => row.teamSubmissionId === null)).toHaveLength(1);
    });

    it("the mirror points at the row holding the work", () => {
      expect(mirror.teamSubmissionId).toBe(work.id);
    });

    it("the link is on the row holding the work and nowhere else", () => {
      expect([work.submittedUrl, mirror.submittedUrl]).toEqual([
        "https://example.com/alice",
        null,
      ]);
    });

    it("every member reads as having handed in, at the same moment", () => {
      expect(rows.map((row) => [row.status, row.submittedAt?.toISOString(), row.isLate])).toEqual(
        rows.map(() => ["SUBMITTED", work.submittedAt?.toISOString(), false]),
      );
    });

    it("and every member's row names who handed it in", () => {
      expect(new Set(rows.map((row) => row.handedInById))).toEqual(new Set([alice.studentId]));
    });
  });

  /*
    The second member hands in. This is the group the whole "the row does not move" decision rests
    on: the work stays where it was, who handed it in moves, and when the team first handed in does
    not.
  */
  describe("a second member handing in", () => {
    beforeAll(async () => {
      await createCaller(tx(), bob.studentId).submissions.submitWork({
        assignmentId,
        submittedUrl: "https://example.com/bob",
      });
      afterSecond = await rowsFor(tx(), assignmentId);
    });

    it("a second member handing in writes onto the same row", () => {
      expect(afterSecond.filter((row) => row.teamSubmissionId === null).map((row) => row.id)).toEqual(
        [work.id],
      );
    });

    it("their link replaces what was there", () => {
      expect(afterSecond.find((row) => row.id === work.id)!.submittedUrl).toBe(
        "https://example.com/bob",
      );
    });

    it("who handed it in moves to them, on every member's row", () => {
      expect(new Set(afterSecond.map((row) => row.handedInById))).toEqual(
        new Set([bob.studentId]),
      );
    });

    it("and when the team first handed in does not move", () => {
      expect(afterSecond.map((row) => row.submittedAt?.toISOString())).toEqual(
        afterSecond.map(() => work.submittedAt?.toISOString()),
      );
    });
  });

  describe("the grading pile counts a team once", () => {
    let forThis: Awaited<ReturnType<typeof pile>>;
    let queue: Awaited<
      ReturnType<ReturnType<typeof asInstructor>["submissions"]["listForAssignment"]>
    >;
    let expectedNames: string;

    beforeAll(async () => {
      forThis = (await pile()).filter((row) => row.assignment.id === assignmentId);
      queue = await asInstructor().submissions.listForAssignment({ assignmentId, cohort: "all" });

      /*
        The names the subtext should carry, read off the profiles rather than written as a literal:
        a fixture account has no display name, so every name here falls back to the generated
        address the account was made with. The order is the one the pile builds — the member
        holding the row, then the mirrors.
      */
      const profiles = await tx().profile.findMany({
        where: { id: { in: [alice.studentId, bob.studentId] } },
        select: { id: true, displayName: true, email: true },
      });
      expectedNames = [work.studentId, mirror.studentId]
        .map((id) => triageStudentName(profiles.find((profile) => profile.id === id)!))
        .join(", ");
    });

    it("a team is one item in the grading pile, not one per member", () => {
      expect(forThis).toHaveLength(1);
    });

    it("and the item is the row holding the work", () => {
      expect(forThis[0]?.id).toBe(work.id);
    });

    /*
      One item, and every member named under it. The row belongs to whichever member claimed it,
      which is an accident of who pressed Accept first — so naming only them answers "is Liz in the
      pile?" wrongly for everybody else on the team.
    */
    it("and it names every member of the team, not just the one holding it", () => {
      expect(nameSubtext(groupByAssignment(forThis)[0]?.studentNames ?? [])).toBe(expectedNames);
    });

    it("the queue lists the team once", () => {
      expect(queue.submissions).toHaveLength(1);
    });

    it("and sets every mirror aside, saying why", () => {
      expect(queue.asideSubmissions.map((row) => row.asideReason)).toEqual(["team_mirror"]);
    });

    it("the two lists together are every row, which is what makes them exhaustive", () => {
      expect(queue.submissions.length + queue.asideSubmissions.length).toBe(afterSecond.length);
    });

    it("a mirror is waiting on nobody", () => {
      expect(queue.asideSubmissions.map((row) => row.bucket)).toEqual([null]);
    });
  });

  /*
    A mirror put behind by hand, because the point is not how it got there. A fan-out that missed a
    row, a row written by an older version of this application, a member restored to the roster —
    all of them leave the same state, and what matters is that the next thing to touch the team
    repairs it rather than leaving somebody reading "Accepted" about work that was handed in.

    A push to an open pull request is the case that matters most: it is deliberately not a hand-in,
    so it writes no status at all, and before `syncTeamRows` ran here a mirror could stay behind for
    as long as the team kept working in one pull request.
  */
  describe("a mirror that has fallen behind", () => {
    let behind: Row[];

    beforeAll(async () => {
      await tx().submission.updateMany({
        where: { teamSubmissionId: work.id },
        data: { status: "ACCEPTED", submittedAt: null, isLate: null },
      });
      behind = await rowsFor(tx(), assignmentId);
    });

    it("a mirror can fall behind the row it copies", () => {
      expect(
        behind.filter((row) => row.teamSubmissionId !== null).map((row) => row.status),
      ).toEqual(["ACCEPTED"]);
    });
  });

  describe("the next thing to touch the team repairing it", () => {
    let caught: Row[];

    beforeAll(async () => {
      await recordActivity(tx(), { submissionId: work.id, at: new Date("2026-09-02T10:00:00Z") });
      await syncTeamRows(tx(), { submissionId: work.id });
      caught = await rowsFor(tx(), assignmentId);
    });

    it("and a push that hands nothing in catches it up", () => {
      expect(new Set(caught.map((row) => row.status))).toEqual(new Set(["SUBMITTED"]));
    });

    it("without inventing a hand-in time it did not have", () => {
      expect(caught.map((row) => row.submittedAt?.toISOString())).toEqual(
        caught.map(() => work.submittedAt?.toISOString()),
      );
    });
  });

  describe("a member placed on the team after it handed in", () => {
    let late: Row | undefined;

    beforeAll(async () => {
      await tx().teamMembership.create({
        data: { teamId, teamSetId: setId, programId: world.programId, enrollmentId: cara.id },
      });
      await createCaller(tx(), bob.studentId).submissions.submitWork({
        assignmentId,
        submittedUrl: "https://example.com/again",
      });
      afterLate = await rowsFor(tx(), assignmentId);
      late = afterLate.find((row) => row.studentId === cara.studentId);
    });

    it("a member placed on the team afterwards gets a row", () => {
      expect(late).toBeDefined();
    });

    it("and it carries what the team had already done rather than saying nothing happened", () => {
      expect([
        late?.status,
        late?.submittedAt?.toISOString(),
        late?.teamSubmissionId === work.id,
      ]).toEqual(["SUBMITTED", work.submittedAt?.toISOString(), true]);
    });
  });

  /*
    A grade written directly rather than through approval, which is the next group's. What is
    checked here is that a mirror is where a grade can *arrive*, so releasing one has somewhere to
    go — and that a team holding a grade has left the pile while the individual work beside it has
    not.
  */
  describe("a grade reaches everybody, and only through the work's own row", () => {
    let waiting: Awaited<ReturnType<typeof pile>>;

    beforeAll(async () => {
      await tx().submission.updateMany({
        where: { OR: [{ id: work.id }, { teamSubmissionId: work.id }] },
        data: { status: "GRADED", finalScore: 8, finalScorePossible: 10, isComplete: true },
      });
      waiting = await pile();
    });

    it("a graded team is out of the pile entirely", () => {
      expect([
        waiting.filter((row) => row.assignment.id === assignmentId).length,
        waiting.length > 0,
      ]).toEqual([0, true]);
    });
  });

  describe("any member may declare a resubmission", () => {
    let declared: Row[];
    let backInPile: number;

    beforeAll(async () => {
      const mirrorRow = afterLate.find((row) => row.studentId === cara.studentId)!;
      await createCaller(tx(), cara.studentId).submissions.declareResubmission({
        submissionId: mirrorRow.id,
      });
      declared = await rowsFor(tx(), assignmentId);
      backInPile = (await pile()).filter((row) => row.assignment.id === assignmentId).length;
    });

    it("declaring it from a mirror moves the whole team", () => {
      expect(new Set(declared.map((row) => row.status))).toEqual(new Set(["RESUBMITTED"]));
    });

    it("and the team is back in the pile exactly once", () => {
      expect(backInPile).toBe(1);
    });
  });
});

/*
  --- releasing a grade -----------------------------------------------------

  A transaction of its own, as every group here has, and this one earns it twice over: the four
  refusals at the end are the shape that aborts the transaction they happen in the moment one of
  them comes from a constraint rather than from a guard. The draft is opened by `startManual` and
  filled by `updateSection`, so nothing here needs a model, a sandbox or GitHub — the same technique
  `verify:approve` uses.
*/
describe("releasing a grade", () => {
  const tx = withRollback();

  let world: World;
  let alice: Fellow;
  let bob: Fellow;
  let cara: Fellow;
  let assignmentId: string;
  let work: { id: string };
  let mirrors: { id: string }[];

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3 });
    [alice, bob, cara] = world.students as [Fellow, Fellow, Fellow];
    assignmentId = (await teamWork(tx(), world, world.students)).assignmentId;

    await createCaller(tx(), alice.studentId).submissions.submitWork({
      assignmentId,
      submittedUrl: "https://example.com/a",
    });

    work = await tx().submission.findFirstOrThrow({
      where: { assignmentId, teamSubmissionId: null },
      select: { id: true },
    });
    mirrors = await tx().submission.findMany({
      where: { teamSubmissionId: work.id },
      select: { id: true },
    });
  });

  it("the team's work is one row with two mirrors", () => {
    expect(mirrors).toHaveLength(2);
  });

  describe("a hand-graded round, scored and written, then released", () => {
    let released: Awaited<
      ReturnType<ReturnType<typeof asInstructor>["gradingDrafts"]["approve"]>
    >;
    let graded: {
      status: string;
      finalScore: number | null;
      finalScorePossible: number | null;
      isComplete: boolean | null;
      feedbackMarkdown: string | null;
      gradedById: string | null;
      gradedAt: Date | null;
      gradedHeadSha: string | null;
      salesforceSyncStatus: string | null;
    }[];
    let afterRelease: Row[];
    let forThisTeam: { subjectId: string | null }[];
    let stranded: number;

    beforeAll(async () => {
      const draft = await asInstructor().gradingDrafts.startManual({ submissionId: work.id });
      const opened = await tx().gradingDraftSection.findMany({
        where: { gradingDraftId: draft.id },
        select: { id: true, scorePossible: true },
      });

      for (const section of opened) {
        await asInstructor().gradingDrafts.updateSection({
          sectionId: section.id,
          scoreEarned: section.scorePossible,
          reportMarkdown: "Well done, all of you.",
        });
      }

      released = await asInstructor().gradingDrafts.approve({ draftId: draft.id });

      /*
        Every column a released grade writes, collected from all three rows: if the set below has
        more than one member, somebody got a different grade from their teammates, and no screen
        anywhere would say so.
      */
      graded = await tx().submission.findMany({
        where: { assignmentId },
        select: {
          status: true,
          finalScore: true,
          finalScorePossible: true,
          isComplete: true,
          feedbackMarkdown: true,
          gradedById: true,
          gradedAt: true,
          gradedHeadSha: true,
          salesforceSyncStatus: true,
        },
      });

      afterRelease = await rowsFor(tx(), assignmentId);

      const events = await tx().auditEvent.findMany({
        where: { action: "GRADE_APPROVED", courseId: world.courseId },
        select: { subjectId: true, detail: true },
      });
      forThisTeam = events.filter(
        (event) =>
          (event.detail as { teamSubmissionId?: string } | null)?.teamSubmissionId === work.id,
      );

      stranded = await tx().gradingDraft.count({
        where: undeliveredApprovalWhere({ teamSubmissionId: { not: null } }),
      });
    });

    it("the release names the team", () => {
      expect(released.team?.name).toBe("Team 1");
    });

    it("and how many fellows received it", () => {
      expect(released.team?.memberCount).toBe(3);
    });

    it("a team with no pull request is owed no comment, which is a finished outcome", () => {
      expect([released.delivery, released.commentError]).toEqual(["not_applicable", null]);
    });

    it("every member of the team holds a row", () => {
      expect(graded).toHaveLength(3);
    });

    /** **The check the whole fan-out exists for.** */
    it("and the released grade is identical on all of them", () => {
      expect(new Set(graded.map((row) => JSON.stringify(row))).size).toBe(1);
    });

    it("which is a grade, not a null", () => {
      expect(graded[0]?.status).toBe("GRADED");
    });

    // Where the work is stays on the one row, which is what makes the copies safe.
    it("no mirror gained a link to the work", () => {
      expect(
        afterRelease.filter((row) => row.teamSubmissionId !== null).map((row) => row.submittedUrl),
      ).toEqual([null, null]);
    });

    /*
      One audit event per member. The action is "a grade was released to a student", and three
      students receiving one is three releases — which is also the only shape that survives the team
      being re-membered afterwards, since the table stores a snapshot rather than a join.
    */
    it("one audit event per member", () => {
      expect(forThisTeam).toHaveLength(3);
    });

    it("each naming a different one of them", () => {
      expect(new Set(forThisTeam.map((event) => event.subjectId))).toEqual(
        new Set([alice.studentId, bob.studentId, cara.studentId]),
      );
    });

    // No mirror can strand waiting for a comment nobody owes it.
    it("no mirror is waiting on an undelivered comment", () => {
      expect(stranded).toBe(0);
    });
  });

  /*
    --- what each member's own page shows -----------------------------------

    The group this half of the feature exists for. Every member holds their own row, and the failure
    that would go unnoticed is a member seeing *less* of their own grade than the member who happens
    to hold the work: no round-by-round feedback, no link to what was handed in, and nothing on the
    screen saying why.
  */
  describe("what each member's own page shows", () => {
    const pageFor = async (studentId: string) => {
      const assignments = await createCaller(tx(), studentId).assignments.listForCourse({
        courseId: world.courseId,
      });
      return assignments.find((row) => row.id === assignmentId)?.submissions[0] ?? null;
    };

    let alicePage: Awaited<ReturnType<typeof pageFor>>;
    let bobPage: Awaited<ReturnType<typeof pageFor>>;

    beforeAll(async () => {
      [alicePage, bobPage] = await Promise.all([pageFor(alice.studentId), pageFor(bob.studentId)]);
    });

    it("every member's page reads the same grade", () => {
      expect([alicePage?.finalScore, bobPage?.finalScore]).toEqual([10, 10]);
    });

    it("and the same round-by-round feedback rather than one undifferentiated block", () => {
      expect([alicePage?.gradingDrafts.length, bobPage?.gradingDrafts.length]).toEqual([1, 1]);
    });

    it("and the same link to the work, whichever of them holds the row", () => {
      expect([alicePage?.submittedUrl, bobPage?.submittedUrl]).toEqual([
        "https://example.com/a",
        "https://example.com/a",
      ]);
    });

    it("and the same team, with everybody on it", () => {
      expect([
        alicePage?.team?.name,
        alicePage?.team?.members.length,
        bobPage?.team?.name,
        bobPage?.team?.members.length,
      ]).toEqual(["Team 1", 3, "Team 1", 3]);
    });

    it("and who handed it in", () => {
      expect([alicePage?.handedInBy?.id, bobPage?.handedInBy?.id]).toEqual([
        alice.studentId,
        alice.studentId,
      ]);
    });

    /*
      A read receipt is each member's own. `feedbackReviewedAt` is the one column a release
      deliberately does not copy, and this pair is what would fail if it ever were: one member
      marking the feedback read would mark it read for everybody.
    */
    describe("a read receipt is each member's own", () => {
      let unreadAtFirst: boolean[];
      let unreadAfterReading: boolean[];

      beforeAll(async () => {
        unreadAtFirst = [feedbackIsUnread(alicePage!), feedbackIsUnread(bobPage!)];

        await createCaller(tx(), alice.studentId).submissions.markFeedbackReviewed({
          submissionId: alicePage!.id,
        });

        const [aliceRead, bobStill] = await Promise.all([
          pageFor(alice.studentId),
          pageFor(bob.studentId),
        ]);
        unreadAfterReading = [feedbackIsUnread(aliceRead!), feedbackIsUnread(bobStill!)];
      });

      it("the feedback starts unread for every member", () => {
        expect(unreadAtFirst).toEqual([true, true]);
      });

      it("and one member reading it leaves it unread for the others", () => {
        expect(unreadAfterReading).toEqual([false, true]);
      });
    });
  });

  describe("and the four refusals", () => {
    it("a report cannot be generated for a mirror", async () => {
      const code = await refusal(() =>
        asInstructor().gradingDrafts.generate({ submissionId: mirrors[0]!.id }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("a hand-graded round cannot be opened on a mirror", async () => {
      const code = await refusal(() =>
        asInstructor().gradingDrafts.startManual({ submissionId: mirrors[0]!.id }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("a released grade cannot be corrected on a mirror", async () => {
      const code = await refusal(() =>
        asInstructor().gradingDrafts.reviseReleased({ submissionId: mirrors[0]!.id }),
      );
      expect(code).toBe("PRECONDITION_FAILED");
    });

    it("a comment cannot be retried on a mirror", async () => {
      const code = await refusal(() =>
        asInstructor().gradingDrafts.retryComment({ submissionId: mirrors[0]!.id }),
      );
      expect(code).toBe("BAD_REQUEST");
    });
  });
});

describe("who may hand in", () => {
  const tx = withRollback();

  it("a fellow on no team of the set cannot hand in", async () => {
    const world = await makeWorld(tx(), { students: 3 });
    const [alice, bob, cara] = world.students as [Fellow, Fellow, Fellow];
    const { assignmentId } = await teamWork(tx(), world, [alice, bob]);

    const code = await refusal(() =>
      createCaller(tx(), cara.studentId).submissions.submitWork({
        assignmentId,
        submittedUrl: "https://example.com/c",
      }),
    );
    expect(code).toBe("PRECONDITION_FAILED");
  });
});

describe("work an instructor is reading is not work a member may replace", () => {
  const tx = withRollback();

  it("no member may replace the work while a draft on it is open", async () => {
    const world = await makeWorld(tx(), { students: 3 });
    const [alice, bob] = world.students as [Fellow, Fellow, Fellow];
    const { assignmentId } = await teamWork(tx(), world, [alice, bob]);

    await createCaller(tx(), alice.studentId).submissions.submitWork({
      assignmentId,
      submittedUrl: "https://example.com/a",
    });

    const work = await tx().submission.findFirstOrThrow({
      where: { assignmentId, teamSubmissionId: null },
      select: { id: true },
    });

    /*
      A draft open on the team's work. The lock has to find it from a *different* member's hand-in,
      which is the case that never fired before drafts were looked up on the team's row.
    */
    await tx().gradingDraft.create({
      data: { submissionId: work.id, status: "READY", headSha: null },
    });

    const code = await refusal(() =>
      createCaller(tx(), bob.studentId).submissions.submitWork({
        assignmentId,
        submittedUrl: "https://example.com/b",
      }),
    );
    expect(code).toBe("CONFLICT");
  });
});

/*
  Every group above rolled its transaction back, and this is the check that says so. It reads the
  committed database, outside any transaction, after all of them have ended.
*/
describe("the rollback really rolled back", () => {
  it("no team sets survived", async () => {
    expect(await db.teamSet.count({ where: { name: setName } })).toBe(0);
  });

  it("and no assignments did either", async () => {
    expect(await db.assignment.count({ where: { title: workTitle } })).toBe(0);
  });
});
