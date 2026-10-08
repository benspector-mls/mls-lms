/**
 * What a Slack digest says, derived from rows that already exist.
 *
 * Run with `npm run test:integration`.
 *
 * There is no notifications table, so the checks here are about the derivation: a digest window is
 * `(watermark, now]` and nothing outside it; each released round is its own line with its own
 * per-round score, because `Submission.finalScore` only remembers the latest; a thread the fellow
 * already read in-app says nothing; an instructor hears only about questions still awaiting a
 * reply at digest time; and the watermark advances exactly when a digest goes out or the window
 * held nothing — never on a failed send, which is the whole retry story.
 *
 * The sends are captured through `runDigests`' injectable `send`, so nothing here needs a token
 * and nothing can reach the real workspace. The immediate path is deliberately absent: with
 * SLACK_BOT_TOKEN unset it is a no-op by construction, and its recipient rules are pure and
 * covered by `tests/lib/notifications/recipients.test.ts`.
 */
import {
  instructorDigestLines,
  runDigests,
  studentDigestLines,
} from "@/lib/notifications/digest";
import {
  instructorSummaryLines,
  runSummaries,
  studentSummaryLines,
} from "@/lib/notifications/summary";

import {
  enroll,
  makeAccount,
  makeAssignment,
  makeSubmission,
  makeWorld,
  type World,
} from "./fixtures";
import { withRollback, type Tx } from "./transaction";

/** The window every group reads: the first week of March. */
const WINDOW = { gt: new Date("2026-03-01T00:00:00Z"), lte: new Date("2026-03-08T00:00:00Z") };

/** A released round on a submission, approved at a chosen instant. */
async function approveRound(
  tx: Tx,
  options: {
    submissionId: string;
    approvedById: string;
    approvedAt: Date;
    scoreEarned: number;
    scorePossible: number;
    editedScoreEarned?: number;
  },
) {
  return tx.gradingDraft.create({
    data: {
      submissionId: options.submissionId,
      status: "APPROVED",
      approvedAt: options.approvedAt,
      approvedById: options.approvedById,
      sections: {
        create: [
          {
            sectionType: "Overall",
            reportMarkdown: "Fixture feedback.",
            scoreEarned: options.scoreEarned,
            scorePossible: options.scorePossible,
            editedScoreEarned: options.editedScoreEarned ?? null,
          },
        ],
      },
    },
    select: { id: true },
  });
}

describe("a fellow's digest", () => {
  const tx = withRollback();
  let world: World;
  let lines: string[];

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    const fellow = world.student.studentId;

    // Two rounds released inside the window on one assignment. The second round's section was
    // edited by hand, so the line must say the edited figure — `effectiveSection`, not the
    // model's — and the first round's line must say the first round's score even though
    // `finalScore` on the row now holds the second's.
    const graded = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Two Rounds",
      pointValue: 20,
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: graded.id,
      studentId: fellow,
      graded: { score: 17, possible: 20, isComplete: true },
    });
    await approveRound(tx(), {
      submissionId: submission.id,
      approvedById: world.instructorId,
      approvedAt: new Date("2026-03-02T12:00:00Z"),
      scoreEarned: 12,
      scorePossible: 20,
    });
    await approveRound(tx(), {
      submissionId: submission.id,
      approvedById: world.instructorId,
      approvedAt: new Date("2026-03-04T12:00:00Z"),
      scoreEarned: 15,
      scorePossible: 20,
      editedScoreEarned: 17,
    });

    // Rounds exactly on the window's edges: `gt` excludes the lower bound — it was covered by the
    // previous digest, whose `lte` included it — and `lte` includes the upper.
    const edges = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "On The Edges",
      pointValue: 10,
    });
    const edgeSubmission = await makeSubmission(tx(), {
      assignmentId: edges.id,
      studentId: fellow,
      graded: { score: 9, possible: 10, isComplete: true },
    });
    await approveRound(tx(), {
      submissionId: edgeSubmission.id,
      approvedById: world.instructorId,
      approvedAt: WINDOW.gt,
      scoreEarned: 1,
      scorePossible: 10,
    });
    await approveRound(tx(), {
      submissionId: edgeSubmission.id,
      approvedById: world.instructorId,
      approvedAt: WINDOW.lte,
      scoreEarned: 9,
      scorePossible: 10,
    });

    // Two instructor comments on two more threads. One thread the fellow read in-app after the
    // comment arrived; the other they never opened. Only the second may appear.
    const readAssignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Already Read",
    });
    const readSubmission = await makeSubmission(tx(), {
      assignmentId: readAssignment.id,
      studentId: fellow,
    });
    await tx().submissionComment.create({
      data: {
        submissionId: readSubmission.id,
        authorId: world.instructorId,
        authorRole: "INSTRUCTOR",
        body: "Seen in the application already.",
        createdAt: new Date("2026-03-03T09:00:00Z"),
      },
    });
    await tx().submissionCommentRead.create({
      data: {
        submissionId: readSubmission.id,
        profileId: fellow,
        lastReadAt: new Date("2026-03-03T10:00:00Z"),
      },
    });

    const unreadAssignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Never Opened",
    });
    const unreadSubmission = await makeSubmission(tx(), {
      assignmentId: unreadAssignment.id,
      studentId: fellow,
    });
    await tx().submissionComment.create({
      data: {
        submissionId: unreadSubmission.id,
        authorId: world.instructorId,
        authorRole: "INSTRUCTOR",
        body: "Take another look at the second case.",
        createdAt: new Date("2026-03-05T09:00:00Z"),
      },
    });

    lines = await studentDigestLines(tx(), fellow, WINDOW);
  });

  it("each released round is its own line, scored as that round was sent", () => {
    const rounds = lines.filter((line) => line.includes("Two Rounds"));
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toContain("12/20 — Not yet complete");
    // The instructor's edit, not the model's 15.
    expect(rounds[1]).toContain("17/20 — Complete");
  });

  it("the window excludes its lower bound and includes its upper", () => {
    const edges = lines.filter((line) => line.includes("On The Edges"));
    expect(edges).toHaveLength(1);
    expect(edges[0]).toContain("9/10");
  });

  it("a thread already read in-app says nothing; an unopened one is a line", () => {
    expect(lines.some((line) => line.includes("Already Read"))).toBe(false);
    const unread = lines.filter((line) => line.includes("Never Opened"));
    expect(unread).toHaveLength(1);
    expect(unread[0]).toContain("1 new comment");
    expect(unread[0]).toContain("Take another look");
  });

  it("another fellow's digest is empty — none of this is their work", async () => {
    expect(await studentDigestLines(tx(), world.students[1]!.studentId, WINDOW)).toEqual([]);
  });
});

describe("an instructor's digest", () => {
  const tx = withRollback();
  let world: World;

  /** A thread on one fellow's work, with a student comment at the given instant. */
  async function threadWithQuestion(options: {
    title: string;
    gradedByInstructor?: boolean;
    askedAt?: Date;
  }) {
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: options.title,
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: world.student.studentId,
    });
    if (options.gradedByInstructor) {
      await tx().submission.update({
        where: { id: submission.id },
        data: { gradedById: world.instructorId },
      });
    }
    await tx().submissionComment.create({
      data: {
        submissionId: submission.id,
        authorId: world.student.studentId,
        authorRole: "STUDENT",
        body: `Question about ${options.title}`,
        createdAt: options.askedAt ?? new Date("2026-03-03T09:00:00Z"),
      },
    });
    return submission.id;
  }

  beforeAll(async () => {
    world = await makeWorld(tx());
  });

  it("a question on work they graded is a line", async () => {
    await threadWithQuestion({ title: "Graded By Me", gradedByInstructor: true });
    const lines = await instructorDigestLines(tx(), world.instructorId, WINDOW);
    expect(lines.some((line) => line.includes("Graded By Me"))).toBe(true);
  });

  it("a question already answered by 9am is not", async () => {
    const submissionId = await threadWithQuestion({
      title: "Answered Overnight",
      gradedByInstructor: true,
    });
    await tx().submissionComment.create({
      data: {
        submissionId,
        authorId: world.instructorId,
        authorRole: "INSTRUCTOR",
        body: "Answered before the digest went out.",
        createdAt: new Date("2026-03-03T18:00:00Z"),
      },
    });
    const lines = await instructorDigestLines(tx(), world.instructorId, WINDOW);
    expect(lines.some((line) => line.includes("Answered Overnight"))).toBe(false);
  });

  it("a question resolved without a reply is not", async () => {
    const submissionId = await threadWithQuestion({
      title: "Handled In Person",
      gradedByInstructor: true,
    });
    await tx().submission.update({
      where: { id: submissionId },
      data: { commentsResolvedAt: new Date("2026-03-03T18:00:00Z") },
    });
    const lines = await instructorDigestLines(tx(), world.instructorId, WINDOW);
    expect(lines.some((line) => line.includes("Handled In Person"))).toBe(false);
  });

  it("participation in the thread counts like having graded it", async () => {
    const submissionId = await threadWithQuestion({ title: "Wrote In It Before" });
    // The instructor answered once before the window; the fellow asks again inside it.
    await tx().submissionComment.create({
      data: {
        submissionId,
        authorId: world.instructorId,
        authorRole: "INSTRUCTOR",
        body: "An earlier answer.",
        createdAt: new Date("2026-02-20T09:00:00Z"),
      },
    });
    await tx().submissionComment.create({
      data: {
        submissionId,
        authorId: world.student.studentId,
        authorRole: "STUDENT",
        body: "A follow-up question.",
        createdAt: new Date("2026-03-06T09:00:00Z"),
      },
    });
    const lines = await instructorDigestLines(tx(), world.instructorId, WINDOW);
    expect(lines.some((line) => line.includes("Wrote In It Before"))).toBe(true);
  });

  it("a question on work they never touched is not theirs to hear about", async () => {
    await threadWithQuestion({ title: "Somebody Else's Queue" });
    const lines = await instructorDigestLines(tx(), world.instructorId, WINDOW);
    expect(lines.some((line) => line.includes("Somebody Else's Queue"))).toBe(false);
  });
});

describe("runDigests and the watermark", () => {
  const tx = withRollback();
  let world: World;
  let fellow: string;

  /** Every DM `runDigests` tried to send, and what each attempt should answer. */
  let sent: { to: string; text: string }[];
  let refuse: Set<string>;
  const send = async (to: string, text: string) => {
    sent.push({ to, text });
    return refuse.has(to) ? { ok: false, error: "fixture refusal" } : { ok: true };
  };

  /*
    A Monday at 9am in Brooklyn, which is 13:00 UTC in June. Fixed rather than `new Date()` because
    who is due is now decided by comparing each person's chosen hour against the school clock, so a
    run at an arbitrary moment would reach nobody.
  */
  const MONDAY_9AM = new Date("2026-06-15T13:00:00Z");
  const run = (at: Date = MONDAY_9AM) => runDigests(at, { send, client: tx() });

  beforeEach(() => {
    sent = [];
    refuse = new Set();
  });

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });
    fellow = world.student.studentId;

    // Already linked, so no lookup is attempted — `resolveSlackUserId` short-circuits on the
    // cached id, which is what keeps this group tokenless.
    await tx().profile.update({
      where: { id: fellow },
      data: {
        slackEventCadence: "DAILY",
        slackUserId: "U-FELLOW",
        slackDigestedTo: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Watermarked",
      pointValue: 10,
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: fellow,
      graded: { score: 8, possible: 10, isComplete: true },
    });
    await approveRound(tx(), {
      submissionId: submission.id,
      approvedById: world.instructorId,
      approvedAt: new Date("2026-03-02T12:00:00Z"),
      scoreEarned: 8,
      scorePossible: 10,
    });
  });

  it("a due digest goes out once, and the watermark closes the window behind it", async () => {
    const first = await run();
    expect(first.digested).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("U-FELLOW");
    expect(sent[0]!.text).toContain("Watermarked");
    expect(sent[0]!.text).toContain("8/10");

    // Immediately again: the window is now empty, so nothing is sent — but the watermark still
    // advances, or a quiet fortnight becomes one enormous window later.
    const before = await tx().profile.findUnique({
      where: { id: fellow },
      select: { slackDigestedTo: true },
    });
    const second = await run();
    expect(second).toEqual({ digested: 0, skipped: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    const after = await tx().profile.findUnique({
      where: { id: fellow },
      select: { slackDigestedTo: true },
    });
    expect(after!.slackDigestedTo!.getTime()).toBeGreaterThanOrEqual(
      before!.slackDigestedTo!.getTime(),
    );
  });

  it("a failed send leaves the watermark alone, so the next digest re-covers it", async () => {
    // Rewind the fellow to before their event, then refuse the delivery.
    await tx().profile.update({
      where: { id: fellow },
      data: { slackDigestedTo: new Date("2026-01-01T00:00:00Z") },
    });

    refuse = new Set(["U-FELLOW"]);
    const failed = await run();
    expect(failed.failed).toBe(1);

    // Tomorrow the workspace is back, and the same round is still in the window.
    refuse = new Set();
    sent = [];
    const recovered = await run();
    expect(recovered.digested).toBe(1);
    expect(sent[0]!.text).toContain("Watermarked");
  });

  it("only people due at this hour, on this day, who are not test students", async () => {
    // Weekly, on Tuesdays: today is Monday, so not this morning.
    const weekly = world.students[1]!.studentId;
    await tx().profile.update({
      where: { id: weekly },
      data: {
        slackEventCadence: "WEEKLY",
        slackEventWeekday: 2,
        slackEventHour: 9,
        slackUserId: "U-WEEKLY",
      },
    });

    // Daily at nine, but a rehearsal rather than a person.
    const testStudentId = await makeAccount(tx());
    await tx().profile.update({
      where: { id: testStudentId },
      data: {
        slackEventCadence: "DAILY",
        slackEventHour: 9,
        slackUserId: "U-TEST-STUDENT",
        testStudentNumber: 90000 + Math.floor(Math.random() * 9999),
      },
    });

    // Daily, but at four in the afternoon.
    const afternoon = await makeAccount(tx());
    await tx().profile.update({
      where: { id: afternoon },
      data: { slackEventCadence: "DAILY", slackEventHour: 16, slackUserId: "U-AFTERNOON" },
    });

    await run();
    const targets = sent.map((dm) => dm.to);
    expect(targets).not.toContain("U-WEEKLY");
    expect(targets).not.toContain("U-TEST-STUDENT");
    expect(targets).not.toContain("U-AFTERNOON");

    // Move the clock to that person's hour and they are reached — 16:00 in Brooklyn is 20:00 UTC
    // in June. Their window holds nothing, so the run only advances their watermark; the point is
    // that the hour is what decided it.
    sent = [];
    const atFour = await run(new Date("2026-06-15T20:00:00Z"));
    expect(atFour.skipped).toBeGreaterThanOrEqual(1);

    // And on Tuesday the weekly fellow's day comes round.
    sent = [];
    const tuesday = await run(new Date("2026-06-16T13:00:00Z"));
    expect(tuesday.skipped + tuesday.digested).toBeGreaterThanOrEqual(1);
  });

  /*
    The opt-in rule, checked at the only place it can be checked: a profile nobody has touched.

    Asserting the column's default directly is the point. Every send path filters on
    `slackEventCadence`, so if the default were ever changed back to a sending value, this is the
    check that fails rather than a cohort receiving messages nobody asked for.
  */
  it("an account that has never opened the card is never messaged", async () => {
    const newcomer = await makeAccount(tx());

    const stored = await tx().profile.findUnique({
      where: { id: newcomer },
      select: { slackEventCadence: true, slackDigestedTo: true },
    });
    expect(stored!.slackEventCadence).toBe("OFF");
    // No watermark either: it is written when somebody chooses a digest, and nobody has.
    expect(stored!.slackDigestedTo).toBeNull();

    // Give them something a digest would carry, so the silence is about the cadence rather than
    // about an empty window.
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Unasked For",
      pointValue: 10,
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: newcomer,
      graded: { score: 9, possible: 10, isComplete: true },
    });
    await approveRound(tx(), {
      submissionId: submission.id,
      approvedById: world.instructorId,
      approvedAt: new Date(),
      scoreEarned: 9,
      scorePossible: 10,
    });

    sent = [];
    await run();
    expect(sent.map((dm) => dm.to)).not.toContain("U-NEWCOMER");
    expect(sent.some((dm) => dm.text.includes("Unasked For"))).toBe(false);
  });
});

/**
 * The summaries: what is outstanding now, rather than what happened since last time.
 *
 * These carry no watermark, so the checks are about scope rather than about windows — whose work
 * an instructor is told about, and which of a fellow's deadlines count as overdue when one of them
 * was renegotiated.
 */
describe("an instructor's summary of the grading pile", () => {
  const tx = withRollback();
  let world: World;
  let cohortA: string;
  let cohortB: string;

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 2 });

    const made = await tx().cohort.createManyAndReturn({
      data: [
        { programId: world.programId, name: "Integration Cohort A" },
        { programId: world.programId, name: "Integration Cohort B" },
      ],
      select: { id: true, name: true },
    });
    cohortA = made.find((c) => c.name.endsWith("A"))!.id;
    cohortB = made.find((c) => c.name.endsWith("B"))!.id;

    await tx().enrollment.update({
      where: { id: world.students[0]!.id },
      data: { cohortId: cohortA },
    });
    await tx().enrollment.update({
      where: { id: world.students[1]!.id },
      data: { cohortId: cohortB },
    });

    // One piece of unmarked work each, which is the simplest thing triage calls outstanding.
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Needs Marking",
    });
    for (const student of world.students) {
      await makeSubmission(tx(), {
        assignmentId: assignment.id,
        studentId: student.studentId,
        status: "SUBMITTED",
      });
    }
  });

  it("with the picker on All Fellows it counts both cohorts and breaks them down", async () => {
    await tx().programInstructor.updateMany({
      where: { programId: world.programId, userId: world.instructorId },
      data: { cohortId: null },
    });

    const lines = await instructorSummaryLines(tx(), world.instructorId);
    expect(lines[0]).toContain("All Fellows");
    expect(lines[0]).toContain("2 submissions");
    expect(lines.some((line) => line.includes("Integration Cohort A") && line.includes("1"))).toBe(true);
    expect(lines.some((line) => line.includes("Integration Cohort B") && line.includes("1"))).toBe(true);
    expect(lines.at(-1)).toContain("Open triage");
  });

  /*
    The decision this feature rests on: the summary is scoped by the cohort picker the instructor
    already uses, rather than by a second setting that could drift from it. Narrowing the picker
    has to narrow the summary, or the two would disagree about whose work is whose.
  */
  it("narrowing the picker to one cohort narrows the summary to that cohort", async () => {
    await tx().programInstructor.updateMany({
      where: { programId: world.programId, userId: world.instructorId },
      data: { cohortId: cohortA },
    });

    const lines = await instructorSummaryLines(tx(), world.instructorId);
    expect(lines[0]).toContain("Integration Cohort A");
    expect(lines[0]).toContain("1 submission");
    // One group, so the heading already said it and no bullet repeats it.
    expect(lines.some((line) => line.includes("Integration Cohort B"))).toBe(false);
  });

  it("an instructor whose pile is empty is told nothing", async () => {
    await tx().programInstructor.updateMany({
      where: { programId: world.programId, userId: world.instructorId },
      data: { cohortId: cohortB },
    });
    await tx().submission.updateMany({
      where: { studentId: world.students[1]!.studentId },
      data: { status: "GRADED" },
    });

    expect(await instructorSummaryLines(tx(), world.instructorId)).toEqual([]);
  });
});

describe("a fellow's summary of what is due", () => {
  const tx = withRollback();
  let world: World;
  let fellow: string;
  const now = new Date("2026-05-15T12:00:00Z");

  const due = (title: string, dueAt: Date) =>
    makeAssignment(tx(), { courseId: world.courseId, courseUnitId: world.unitId, title, dueAt });

  beforeAll(async () => {
    world = await makeWorld(tx());
    fellow = world.student.studentId;

    // Nothing handed in against any of these, so the deadline is the whole of the question.
    await due("Slipped By", new Date("2026-05-10T23:59:00Z"));
    await due("Due Thursday", new Date("2026-05-19T23:59:00Z"));
    await due("Far Off", new Date("2026-07-01T23:59:00Z"));
  });

  it("lists what is overdue and what falls inside the week, and nothing beyond it", async () => {
    const lines = await studentSummaryLines(tx(), fellow, now);
    const text = lines.join("\n");

    expect(text).toContain("Overdue");
    expect(text).toContain("Slipped By");
    expect(text).toContain("Due in the next 7 days");
    expect(text).toContain("Due Thursday");
    // Six weeks out is not this week's business, and the dashboard does not show it either.
    expect(text).not.toContain("Far Off");
  });

  /*
    An extension is an agreement with one fellow, and a summary that ignored it would tell somebody
    they are late for a deadline the instructor personally moved. `dashboardSections` reads the
    effective date, which is the whole reason this reuses it rather than comparing `dueAt` itself.
  */
  it("a deadline somebody agreed to move is not overdue", async () => {
    const extended = await due("Agreed Later", new Date("2026-05-10T23:59:00Z"));
    await makeSubmission(tx(), {
      assignmentId: extended.id,
      studentId: fellow,
      status: "ACCEPTED",
      submittedAt: null,
    });
    // All three columns together: `submissions_extension_is_whole` refuses an extension nobody
    // granted or one granted at no time, which is the same rule the procedure writes through.
    await tx().submission.updateMany({
      where: { assignmentId: extended.id, studentId: fellow },
      data: {
        extendedDueAt: new Date("2026-05-18T23:59:00Z"),
        extensionGrantedById: world.instructorId,
        extensionGrantedAt: new Date("2026-05-09T12:00:00Z"),
      },
    });

    const lines = await studentSummaryLines(tx(), fellow, now);
    const overdueBlock = lines.slice(0, lines.findIndex((l) => l.includes("Due in the next")));
    expect(overdueBlock.some((line) => line.includes("Agreed Later"))).toBe(false);
    expect(lines.some((line) => line.includes("Agreed Later"))).toBe(true);
  });

  /*
    Nothing due soon and nothing missed produces no message at all, rather than a cheerful one
    saying so. A summary that arrives every morning whatever the state of things stops being read,
    and silence already means something here: there is nothing waiting.
  */
  it("a fellow with nothing due soon and nothing overdue is told nothing", async () => {
    const other = await makeAccount(tx());
    await enroll(tx(), { programId: world.programId, studentId: other });

    // Four months before the earliest deadline: no deadline has passed, and none is inside the
    // week, so both lists are empty while the work itself plainly exists.
    const lines = await studentSummaryLines(tx(), other, new Date("2026-01-01T12:00:00Z"));
    expect(lines).toEqual([]);
  });
});

describe("the summary cadence", () => {
  const tx = withRollback();

  it("is OFF for an account nobody has touched, and so is the event cadence", async () => {
    const newcomer = await makeAccount(tx());
    const profile = await tx().profile.findUnique({
      where: { id: newcomer },
      select: { slackSummaryCadence: true, slackEventCadence: true },
    });

    expect(profile!.slackSummaryCadence).toBe("OFF");
    expect(profile!.slackEventCadence).toBe("OFF");
  });

  /*
    The reason the hour is stored per setting rather than per person: somebody can want their
    questions first thing and their grading pile at the end of the day, and one column could not
    hold both. Each run reaches only the setting whose hour has come round.
  */
  it("each setting is sent at its own hour, independently of the other", async () => {
    const world = await makeWorld(tx());
    const sent: string[] = [];
    const send = async (to: string) => {
      sent.push(to);
      return { ok: true };
    };

    // Something for the summary to carry, overdue by the time either run happens.
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Long Overdue",
      dueAt: new Date("2026-06-01T23:59:00Z"),
    });
    expect(assignment.id).toBeTruthy();

    await tx().profile.update({
      where: { id: world.student.studentId },
      data: {
        slackUserId: "U-FELLOW",
        slackEventCadence: "DAILY",
        slackEventHour: 9,
        slackSummaryCadence: "DAILY",
        slackSummaryHour: 16,
      },
    });

    // Nine in the morning: the summary's hour has not come, so nothing is summarised.
    const morning = await runSummaries(new Date("2026-06-15T13:00:00Z"), { send, client: tx() });
    expect(morning).toEqual({ summarised: 0, skipped: 0, failed: 0 });
    expect(sent).toEqual([]);

    // Four in the afternoon is theirs, and the overdue work is waiting.
    const afternoon = await runSummaries(new Date("2026-06-15T20:00:00Z"), { send, client: tx() });
    expect(afternoon.summarised).toBe(1);
    expect(sent).toEqual(["U-FELLOW"]);
  });
});
