import { isOutstanding, triageBucket, type TriageFacts } from "@/lib/grade/triage";

/**
 * Which pile a submission belongs in.
 *
 * One definition shared by grading triage, the queue's filter, the gradebook's cells, and the
 * per-assignment counts. Those four answer the same question and must not answer it differently,
 * so what these cases hold is the *set* being exhaustive and its precedence being fixed — not
 * merely that each input maps to some output.
 */

/**
 * The facts, defaulted to "nothing unusual", with only what a case is about spelled out.
 *
 * Defaulting here is not the thing the required parameter on `triageBucket` guards against. A
 * production caller still cannot forget a fact, because it has no default; what this buys is that
 * each case below reads as the one claim it is making rather than as four booleans in a row.
 */
const facts = (over: Partial<TriageFacts> = {}): TriageFacts => ({
  draftIsStale: false,
  hasUndeliveredApproval: false,
  isManualOnly: false,
  mirrorsAnotherSubmission: false,
  ...over,
});

describe("triageBucket", () => {
  describe("work that has been handed in", () => {
    it("needs a report when the pipeline can grade it", () => {
      expect(triageBucket("SUBMITTED", null, facts())).toBe("needs_report");
    });

    it("needs a person when the pipeline cannot", () => {
      // The same pile of work, distinguished because the action differs and only one of the
      // two exists: `needs_report` offers a button that must not appear on an assignment
      // nothing can generate a report for.
      expect(triageBucket("SUBMITTED", null, facts({ isManualOnly: true }))).toBe(
        "needs_manual_grade",
      );
    });

    it("treats a resubmission the same way as a first submission", () => {
      expect(triageBucket("RESUBMITTED", null, facts())).toBe("needs_report");
    });
  });

  describe("a run that reached a state somebody has to act on", () => {
    it.each([
      ["READY", "draft_ready"],
      // Nothing writes NEEDS_MANUAL_REVIEW any more. A row that predates that decision is a
      // draft awaiting an instructor like any other, which is what it always was.
      ["NEEDS_MANUAL_REVIEW", "draft_ready"],
      ["FAILED", "grading_failed"],
      ["GENERATING", "generating"],
    ] as const)("reads %s as %s", (status, bucket) => {
      expect(triageBucket("SUBMITTED", { status }, facts())).toBe(bucket);
    });

    it("reads the draft rather than the submission status", () => {
      // Generating a report writes the draft's status and leaves the submission's alone, so
      // DRAFT_READY and friends are SubmissionStatus values nothing ever writes. Reading them
      // off the submission would leave every bucket permanently empty.
      expect(triageBucket("GRADED", { status: "READY" }, facts())).toBe("draft_ready");
    });
  });

  describe("a draft describing code the student has replaced", () => {
    it("falls through to needing a report rather than offering a stale one", () => {
      expect(triageBucket("RESUBMITTED", { status: "READY" }, facts({ draftIsStale: true }))).toBe(
        "needs_report",
      );
    });

    it("falls through to needing a person on a hand-graded assignment", () => {
      expect(
        triageBucket(
          "RESUBMITTED",
          { status: "READY" },
          facts({ draftIsStale: true, isManualOnly: true }),
        ),
      ).toBe("needs_manual_grade");
    });

    it("is not offered as ready even when the run itself succeeded", () => {
      // Approval refuses a stale draft, so a row that offered it would be a button that throws.
      expect(
        triageBucket("SUBMITTED", { status: "READY" }, facts({ draftIsStale: true })),
      ).not.toBe("draft_ready");
    });
  });

  describe("an approval whose comment never reached the pull request", () => {
    it("outranks every other bucket", () => {
      // Checked ahead of everything else because what happens next is usually that the student
      // pushes again and a new draft is generated, which would bury it forever.
      expect(
        triageBucket("GRADED", { status: "APPROVED" }, facts({ hasUndeliveredApproval: true })),
      ).toBe("comment_not_posted");
    });

    it("outranks a draft that is otherwise ready to read", () => {
      expect(
        triageBucket("SUBMITTED", { status: "READY" }, facts({ hasUndeliveredApproval: true })),
      ).toBe("comment_not_posted");
    });
  });

  describe("one member's copy of their team's work", () => {
    /*
      A mirror is waiting on nobody at every point in its life. The work, the draft, the
      repository and the pull request are all on the team's own row, so a bucket here would put
      every member of a team but one into triage, into the queue, and into the subjects a batch
      run generates reports for — against a row with no repository to read.
    */
    it.each(["SUBMITTED", "RESUBMITTED", "GRADED"] as const)(
      "is null when the submission is %s",
      (status) => {
        expect(triageBucket(status, null, facts({ mirrorsAnotherSubmission: true }))).toBeNull();
      },
    );

    it("is null even where a draft of its own would have been read", () => {
      // Mirrors hold no drafts. This is the defensive case: one written by hand must not make a
      // mirror into a second, separately approvable copy of the team's grade.
      expect(
        triageBucket("SUBMITTED", { status: "READY" }, facts({ mirrorsAnotherSubmission: true })),
      ).toBeNull();
    });

    it("is null ahead of an undelivered approval, which outranks everything else", () => {
      // The ordering, stated as a test. A mirror is never owed a comment — a comment goes to a
      // pull request and a mirror has none — so even a query claiming one was owed must not put
      // this row back into the pile.
      expect(
        triageBucket(
          "GRADED",
          { status: "APPROVED" },
          facts({ mirrorsAnotherSubmission: true, hasUndeliveredApproval: true }),
        ),
      ).toBeNull();
    });

    it("is null on a hand-graded assignment, where the pile has no other way to clear", () => {
      expect(
        triageBucket(
          "SUBMITTED",
          null,
          facts({ mirrorsAnotherSubmission: true, isManualOnly: true }),
        ),
      ).toBeNull();
    });
  });

  describe("work that is waiting on nobody", () => {
    it("is null once a grade has been delivered", () => {
      expect(triageBucket("GRADED", { status: "APPROVED" }, facts())).toBeNull();
    });

    it("is null for a hand-graded submission once approved", () => {
      // The case the deliverability test exists for. Without it every finished hand-graded
      // submission sat in triage permanently with nothing an instructor could do to clear it.
      expect(
        triageBucket("GRADED", { status: "APPROVED" }, facts({ isManualOnly: true })),
      ).toBeNull();
    });

    it("is null for an accepted assignment nobody has handed in", () => {
      expect(triageBucket("ACCEPTED", null, facts())).toBeNull();
    });

    it("is null for an assignment nobody has started", () => {
      expect(triageBucket("NOT_STARTED", null, facts())).toBeNull();
    });

    it("is null for a superseded draft on graded work", () => {
      expect(triageBucket("GRADED", { status: "SUPERSEDED" }, facts())).toBeNull();
    });
  });

  describe("pushing after being graded", () => {
    it("is not a request for another look", () => {
      // Pushing is not asking. The student's own declaration is what sets RESUBMITTED, and
      // without it their submission is still GRADED and waiting on nobody.
      expect(triageBucket("GRADED", null, facts())).toBeNull();
    });
  });
});

describe("isOutstanding", () => {
  it("counts every bucket that is work remaining", () => {
    for (const bucket of [
      "needs_report",
      "needs_manual_grade",
      "draft_ready",
      "grading_failed",
      "comment_not_posted",
    ] as const) {
      expect(isOutstanding(bucket)).toBe(true);
    }
  });

  it("does not count a run that is in flight", () => {
    expect(isOutstanding("generating")).toBe(false);
  });

  it("does not count work waiting on nobody", () => {
    expect(isOutstanding(null)).toBe(false);
  });
});
