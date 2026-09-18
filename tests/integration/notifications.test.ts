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

import { makeAccount, makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
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

  const run = (cadences: ("DAILY" | "WEEKLY")[] = ["DAILY"]) =>
    runDigests(new Date(), cadences, { send, client: tx() });

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
        slackCadence: "DAILY",
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

  it("only due cadences and real people are fetched", async () => {
    // A weekly fellow on a daily run, and a test student set to daily: neither is sent anything.
    const weekly = world.students[1]!.studentId;
    await tx().profile.update({
      where: { id: weekly },
      data: { slackCadence: "WEEKLY", slackUserId: "U-WEEKLY" },
    });
    const testStudentId = await makeAccount(tx());
    await tx().profile.update({
      where: { id: testStudentId },
      data: {
        slackCadence: "DAILY",
        slackUserId: "U-TEST-STUDENT",
        testStudentNumber: 90000 + Math.floor(Math.random() * 9999),
      },
    });

    await run(["DAILY"]);
    const targets = sent.map((dm) => dm.to);
    expect(targets).not.toContain("U-WEEKLY");
    expect(targets).not.toContain("U-TEST-STUDENT");

    // On Monday's run the weekly fellow is included (their window is empty, so it only advances
    // the watermark — the point is that they were fetched and processed).
    sent = [];
    const monday = await run(["DAILY", "WEEKLY"]);
    expect(monday.skipped).toBeGreaterThanOrEqual(1);
  });

  /*
    The opt-in rule, checked at the only place it can be checked: a profile nobody has touched.

    Asserting the column's default directly is the point. Every send path filters on
    `slackCadence`, so if the default were ever changed back to a sending value, this is the
    check that fails rather than a cohort receiving messages nobody asked for.
  */
  it("an account that has never opened the card is never messaged", async () => {
    const newcomer = await makeAccount(tx());

    const stored = await tx().profile.findUnique({
      where: { id: newcomer },
      select: { slackCadence: true, slackDigestedTo: true },
    });
    expect(stored!.slackCadence).toBe("OFF");
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
    await run(["DAILY", "WEEKLY"]);
    expect(sent.map((dm) => dm.to)).not.toContain("U-NEWCOMER");
    expect(sent.some((dm) => dm.text.includes("Unasked For"))).toBe(false);
  });
});
