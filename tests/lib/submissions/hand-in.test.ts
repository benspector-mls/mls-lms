import { handInState, handInStatus } from "@/lib/submissions/hand-in";

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
