import {
  handInState,
  handInStatus,
  lateness,
  taskReset,
  taskVerdict,
} from "@/lib/submissions/hand-in";

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
      const state = handInState({ current: null, now: ON_TIME });
      expect(state).toEqual({ status: "SUBMITTED", submittedAt: ON_TIME });
    });
  });

  describe("work handed in again after a grade", () => {
    const graded = { status: "GRADED", submittedAt: ON_TIME } as const;

    it("enters the queue as a revision", () => {
      const state = handInState({ current: graded, now: AFTER });
      expect(state.status).toBe("RESUBMITTED");
    });

    /*
      The revision's own timestamp is `lastActivityAt`, which every caller writes for itself. This
      column answers when the work was handed in, and it has one answer — which is also what stops
      revising after the deadline from making the work late, since `lateness` reads this.
    */
    it("keeps the time the work was first handed in", () => {
      const state = handInState({ current: graded, now: AFTER });
      expect(state.submittedAt).toEqual(ON_TIME);
    });
  });

  describe("a correction to work still in the queue", () => {
    it("leaves it a submission and does not move its submission time", () => {
      const waiting = { status: "SUBMITTED", submittedAt: ON_TIME } as const;
      const state = handInState({ current: waiting, now: AFTER });
      expect(state).toEqual({ status: "SUBMITTED", submittedAt: ON_TIME });
    });
  });

  /*
    **Nothing here records lateness**, and that is the point: no deadline is passed in at all, so
    there is no moment at which a verdict could be frozen against the deadline as it stood. See
    `lateness` below.
  */
  it("takes no deadline, because it records no verdict about one", () => {
    const state = handInState({ current: null, now: AFTER });
    expect(Object.keys(state).sort()).toEqual(["status", "submittedAt"]);
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
/**
 * What a submission's timeliness reads as once a renegotiated deadline is taken into account.
 *
 * The distinction these cases are about: a fellow who missed a deadline and said nothing, and a
 * fellow who came to their instructor, agreed a new date, and met it. One word for both cannot tell
 * them apart, and the second is the behaviour the school wants to encourage.
 */
describe("lateness", () => {
  /** An extension agreed two days after the original deadline. */
  const EXTENDED = new Date("2026-03-12T23:59:00Z");
  /** Handed in inside the extension, which is after `DUE` and before `EXTENDED`. */
  const WITHIN = new Date("2026-03-11T10:00:00Z");

  it("reads work that met its original deadline as on time", () => {
    expect(lateness({ dueAt: DUE, submittedAt: ON_TIME, extendedDueAt: null })).toBe("onTime");
  });

  it("reads work that missed its deadline with nothing agreed as late", () => {
    expect(lateness({ dueAt: DUE, submittedAt: AFTER, extendedDueAt: null })).toBe("late");
  });

  it("reads work handed in by a renegotiated deadline as extended", () => {
    expect(lateness({ dueAt: DUE, submittedAt: WITHIN, extendedDueAt: EXTENDED })).toBe("extended");
  });

  // The case an extension must not excuse, or agreeing one would be a way of never being late.
  it("reads work that missed the renegotiated deadline too as late", () => {
    expect(lateness({ dueAt: DUE, submittedAt: AFTER, extendedDueAt: EXTENDED })).toBe("late");
  });

  // Handed in at the extended deadline exactly, which is inside it — the same inclusive reading
  // the assignment's own deadline gets.
  it("reads work handed in at the renegotiated deadline itself as extended", () => {
    expect(lateness({ dueAt: DUE, submittedAt: EXTENDED, extendedDueAt: EXTENDED })).toBe(
      "extended",
    );
  });

  /*
    Granting an extension dated at or after a hand-in that already happened is how an instructor
    excuses one after the fact. It needs no separate mechanism: the comparison is satisfied.
  */
  it("reads a retroactive extension as extended", () => {
    expect(lateness({ dueAt: DUE, submittedAt: AFTER, extendedDueAt: AFTER })).toBe("extended");
  });

  /*
    An extension on work that was never late says nothing — there was no missed deadline for it to
    excuse. That is the right answer for one granted in advance and then not needed.
  */
  it("says on time for an extension nobody ended up needing", () => {
    expect(lateness({ dueAt: DUE, submittedAt: ON_TIME, extendedDueAt: EXTENDED })).toBe("onTime");
  });

  /*
    Nothing handed in has no arrival to measure, so it is not late. Whether that fellow is
    *missing* the work is `isMissing`'s question, and it consults the extension itself.
  */
  it("says on time where nothing has been handed in", () => {
    expect(lateness({ dueAt: DUE, submittedAt: null, extendedDueAt: null })).toBe("onTime");
    expect(lateness({ dueAt: DUE, submittedAt: null, extendedDueAt: EXTENDED })).toBe("onTime");
  });

  /*
    **The bug deriving exists to fix.** A stored verdict was written at hand-in against the deadline
    as it stood that minute. An assignment due the 10th: one fellow hands in on the 12th and is
    recorded late; an instructor then decides the original was not enough time and moves it to the
    20th; a second fellow hands in on the 14th and is recorded on time. The fellow who was *closer*
    to the original deadline read as the worse of the two, and the only difference between them was
    when the instructor happened to make the edit.

    Derived, both read as on time, which is what the instructor meant by moving it.
  */
  it("reads both fellows the same when a deadline moves past them", () => {
    const moved = new Date("2026-03-20T23:59:00Z");
    const earlier = new Date("2026-03-12T10:00:00Z");
    const later = new Date("2026-03-14T10:00:00Z");

    expect(lateness({ dueAt: moved, submittedAt: earlier, extendedDueAt: null })).toBe("onTime");
    expect(lateness({ dueAt: moved, submittedAt: later, extendedDueAt: null })).toBe("onTime");
  });

  // And both are late again against the deadline they actually missed, so moving one is what
  // changes the answer rather than the order the two happened to hand in.
  it("reads both fellows as late against the deadline they missed", () => {
    const earlier = new Date("2026-03-12T10:00:00Z");
    const later = new Date("2026-03-14T10:00:00Z");

    expect(lateness({ dueAt: DUE, submittedAt: earlier, extendedDueAt: null })).toBe("late");
    expect(lateness({ dueAt: DUE, submittedAt: later, extendedDueAt: null })).toBe("late");
  });

  // ISO strings, because the browser receives the payload serialized and reads it with this.
  it("reads timestamps that arrived as strings", () => {
    expect(
      lateness({
        dueAt: DUE.toISOString(),
        submittedAt: WITHIN.toISOString(),
        extendedDueAt: EXTENDED.toISOString(),
      }),
    ).toBe("extended");
  });
});

describe("taskVerdict", () => {
  const MARKER = "11111111-1111-4111-8111-111111111111";

  it("awards the point and records completion when it is marked done", () => {
    const verdict = taskVerdict({
      done: true,
      current: null,
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
      at: ON_TIME,
      markedById: MARKER,
    });

    expect(verdict.isComplete).toBe(false);
    expect(verdict.finalScore).toBe(0);
    expect(verdict.finalScorePossible).toBe(1);
  });

  it("records when it was first marked done", () => {
    const verdict = taskVerdict({
      done: true,
      current: null,
      at: AFTER,
      markedById: MARKER,
    });

    // Whether that is late is `lateness`'s question, asked against the assignment's deadline when
    // somebody looks — a task's row records when the work was done and nothing about a verdict.
    expect(verdict.submittedAt).toEqual(AFTER);
  });

  it("does not move when the work was done on a second mark", () => {
    // An instructor confirming a task that was marked done on time must not turn it late by
    // agreeing with it after the deadline — which is why the time is preserved rather than reset,
    // since that time is what `lateness` measures.
    const verdict = taskVerdict({
      done: true,
      current: { submittedAt: ON_TIME },
      at: AFTER,
      markedById: MARKER,
    });

    expect(verdict.submittedAt).toEqual(ON_TIME);
  });

  it("leaves when the work was done alone when it is sent back", () => {
    // Sending a task back says it was not good enough, not that it never happened. Moving
    // `submittedAt` here would rewrite when a fellow did the work as a side effect of judging it.
    const verdict = taskVerdict({
      done: false,
      current: { submittedAt: ON_TIME },
      at: AFTER,
      markedById: MARKER,
    });

    expect(verdict.submittedAt).toEqual(ON_TIME);
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
      at: ON_TIME,
      markedById: MARKER,
      handedInById: MARKER,
    });
    const byInstructor = taskVerdict({
      done: false,
      current: null,
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
  });
});
