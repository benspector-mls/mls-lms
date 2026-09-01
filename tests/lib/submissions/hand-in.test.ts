import { handInState, handInStatus, taskReset, taskVerdict } from "@/lib/submissions/hand-in";

/**
 * What handing work in does to a submission.
 *
 * One rule for all three ways work arrives — a pull request, a pasted link, an uploaded file —
 * and the reason it is one rule is the bug these cases are about: written separately, only the
 * pull request path told a revision from a first submission and only it left the original
 * submission time alone. A student who was graded, revised their document, and handed it in
 * again re-entered the queue as an ordinary new submission, and was marked late for having done
 * the revising after the due date.
 */

const DUE = new Date("2026-03-10T23:59:00Z");
const ON_TIME = new Date("2026-03-09T12:00:00Z");
const AFTER = new Date("2026-03-14T09:00:00Z");

describe("handInStatus", () => {
  it("reads a first hand-in as a submission", () => {
    expect(handInStatus("NOT_STARTED")).toBe("SUBMITTED");
    expect(handInStatus("ACCEPTED")).toBe("SUBMITTED");
  });

  it("reads a hand-in on top of a released grade as a revision", () => {
    expect(handInStatus("GRADED")).toBe("RESUBMITTED");
  });

  it("keeps a revision a revision when it is corrected again", () => {
    // A student fixing the link on a revision that is already waiting has not gone back to
    // being a first submission, and the queue must not start reading it as one.
    expect(handInStatus("RESUBMITTED")).toBe("RESUBMITTED");
  });

  it("leaves work still waiting on its first review as a submission", () => {
    expect(handInStatus("SUBMITTED")).toBe("SUBMITTED");
  });
});

describe("handInState", () => {
  describe("a first hand-in", () => {
    it("records the moment as the submission time", () => {
      const state = handInState({ current: null, dueAt: DUE, now: ON_TIME });
      expect(state).toEqual({ status: "SUBMITTED", submittedAt: ON_TIME, isLate: false });
    });

    it("is late when it arrives after the due date", () => {
      const state = handInState({ current: null, dueAt: DUE, now: AFTER });
      expect(state.isLate).toBe(true);
    });

    it("is never late with no due date", () => {
      const state = handInState({ current: null, dueAt: null, now: AFTER });
      expect(state.isLate).toBe(false);
    });
  });

  describe("work handed in again after a grade", () => {
    const graded = { status: "GRADED", submittedAt: ON_TIME, isLate: false } as const;

    it("enters the queue as a revision", () => {
      const state = handInState({ current: graded, dueAt: DUE, now: AFTER });
      expect(state.status).toBe("RESUBMITTED");
    });

    it("keeps the time the work was first handed in", () => {
      // The revision's own timestamp is `lastActivityAt`, which every caller writes for
      // itself. This column answers when the work was handed in, and it has one answer.
      const state = handInState({ current: graded, dueAt: DUE, now: AFTER });
      expect(state.submittedAt).toEqual(ON_TIME);
    });

    it("stays on time when the first submission was on time", () => {
      // The whole point. Judged against the preserved submission time, so revising after the
      // due date does not retroactively make the work late.
      const state = handInState({ current: graded, dueAt: DUE, now: AFTER });
      expect(state.isLate).toBe(false);
    });

    it("stays late when the first submission was late", () => {
      const late = { status: "GRADED", submittedAt: AFTER, isLate: true } as const;
      const state = handInState({ current: late, dueAt: DUE, now: AFTER });
      expect(state.isLate).toBe(true);
    });
  });

  describe("a correction to work still in the queue", () => {
    it("leaves it a submission and does not move its submission time", () => {
      const waiting = { status: "SUBMITTED", submittedAt: ON_TIME, isLate: false } as const;
      const state = handInState({ current: waiting, dueAt: DUE, now: AFTER });
      expect(state).toEqual({ status: "SUBMITTED", submittedAt: ON_TIME, isLate: false });
    });
  });

  describe("lateness with no due date", () => {
    it("keeps whatever was already on record", () => {
      // Nothing to be late against, so the flag is not recomputed away. An assignment whose
      // due date was removed keeps the lateness its submissions were already judged with.
      const state = handInState({
        current: { status: "GRADED", submittedAt: ON_TIME, isLate: true },
        dueAt: null,
        now: AFTER,
      });
      expect(state.isLate).toBe(true);
    });

    it("reads a row that was never judged as not late", () => {
      const state = handInState({
        current: { status: "ACCEPTED", submittedAt: null, isLate: null },
        dueAt: null,
        now: AFTER,
      });
      expect(state).toEqual({ status: "SUBMITTED", submittedAt: AFTER, isLate: false });
    });
  });

  it("follows a moved due date, judging the preserved submission time against it", () => {
    // `isLate` is recomputed rather than carried, so an instructor who extends a deadline sees
    // the flag follow rather than having to correct forty rows by hand.
    const state = handInState({
      current: { status: "GRADED", submittedAt: AFTER, isLate: true },
      dueAt: new Date("2026-03-20T23:59:00Z"),
      now: AFTER,
    });
    expect(state.isLate).toBe(false);
  });
});

/**
 * What marking a task does to a submission.
 *
 * The same rule written once for two callers — a fellow's own toggle and their instructor's — so
 * that a task marked done by a fellow and one marked done for them hold identical columns. The
 * cases below are about the three things that are easy to get wrong when a verdict is also a
 * hand-in: which columns a *not done* verdict may move, whether a second mark rewrites when the
 * work was done, and the one column written for a reason no other kind has.
 */
describe("taskVerdict", () => {
  const MARKER = "11111111-1111-4111-8111-111111111111";

  it("awards the point and records completion when it is marked done", () => {
    const verdict = taskVerdict({
      done: true,
      current: null,
      dueAt: DUE,
      at: ON_TIME,
      markedById: MARKER,
    });

    expect(verdict.status).toBe("GRADED");
    expect(verdict.isComplete).toBe(true);
    expect(verdict.finalScore).toBe(1);
    expect(verdict.finalScorePossible).toBe(1);
    expect(verdict.gradedById).toBe(MARKER);
  });

  it("awards nothing but keeps the point possible when it is marked not done", () => {
    // 0/1 rather than a null score, so the gradebook cell reads as a verdict rather than as work
    // nobody has looked at — the two are drawn differently and mean different things.
    const verdict = taskVerdict({
      done: false,
      current: null,
      dueAt: DUE,
      at: ON_TIME,
      markedById: MARKER,
    });

    expect(verdict.isComplete).toBe(false);
    expect(verdict.finalScore).toBe(0);
    expect(verdict.finalScorePossible).toBe(1);
  });

  it("is late when it is first marked done after the due date", () => {
    const verdict = taskVerdict({
      done: true,
      current: null,
      dueAt: DUE,
      at: AFTER,
      markedById: MARKER,
    });

    expect(verdict.submittedAt).toEqual(AFTER);
    expect(verdict.isLate).toBe(true);
  });

  it("does not move when the work was done, or make it late, on a second mark", () => {
    // An instructor confirming a task that was marked done on time must not turn it late by
    // agreeing with it after the deadline — the same rule `handInState` holds for a hand-in.
    const verdict = taskVerdict({
      done: true,
      current: { submittedAt: ON_TIME, isLate: false },
      dueAt: DUE,
      at: AFTER,
      markedById: MARKER,
    });

    expect(verdict.submittedAt).toEqual(ON_TIME);
    expect(verdict.isLate).toBe(false);
  });

  it("leaves when the work was done alone when it is sent back", () => {
    // Sending a task back says it was not good enough, not that it never happened. Moving
    // `submittedAt` here would rewrite when a fellow did the work as a side effect of judging it.
    const verdict = taskVerdict({
      done: false,
      current: { submittedAt: ON_TIME, isLate: false },
      dueAt: DUE,
      at: AFTER,
      markedById: MARKER,
    });

    expect(verdict.submittedAt).toEqual(ON_TIME);
    expect(verdict.isLate).toBe(false);
  });

  it("marks the feedback read, because there is no report to read", () => {
    /*
      The one column here that exists for a reason no other kind has. `feedbackIsUnread` compares
      this against `gradedAt`, so a GRADED row with it null is unread by definition — and every
      marked task would sit on a fellow's dashboard under "Feedback to read", pointing at a tab
      that holds nothing.
    */
    const verdict = taskVerdict({
      done: true,
      current: null,
      dueAt: null,
      at: ON_TIME,
      markedById: MARKER,
    });

    expect(verdict.feedbackReviewedAt).toEqual(ON_TIME);
    expect(verdict.gradedAt).toEqual(ON_TIME);
    expect(verdict.feedbackMarkdown).toBeNull();
  });

  it("records the fellow who marked it, and only when a fellow did", () => {
    // `handedInById` names the member who did the work. An instructor overruling them is not one,
    // so their write leaves the column alone rather than claiming it.
    const byFellow = taskVerdict({
      done: true,
      current: null,
      dueAt: null,
      at: ON_TIME,
      markedById: MARKER,
      handedInById: MARKER,
    });
    const byInstructor = taskVerdict({
      done: false,
      current: null,
      dueAt: null,
      at: ON_TIME,
      markedById: MARKER,
    });

    expect(byFellow.handedInById).toBe(MARKER);
    expect(byInstructor).not.toHaveProperty("handedInById");
  });
});

describe("taskReset", () => {
  it("returns the task to nobody having said anything", () => {
    /*
      Every column `taskVerdict` writes is cleared, `submittedAt` and `isLate` included: taking a
      mark back means nothing stands, and a row that kept a submission time would go on reading as
      handed in — which keeps it off the fellow's own overdue list, the one place they would look
      to notice they still have to do it.
    */
    const reset = taskReset({ at: AFTER });

    expect(reset.status).toBe("NOT_STARTED");
    expect(reset.isComplete).toBeNull();
    expect(reset.finalScore).toBeNull();
    expect(reset.finalScorePossible).toBeNull();
    expect(reset.gradedById).toBeNull();
    expect(reset.gradedAt).toBeNull();
    expect(reset.feedbackReviewedAt).toBeNull();
    expect(reset.handedInById).toBeNull();
    expect(reset.submittedAt).toBeNull();
    expect(reset.isLate).toBeNull();
  });
});
