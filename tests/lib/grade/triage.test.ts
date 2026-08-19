import { isOutstanding, triageBucket } from "@/lib/grade/triage";

/**
 * Which pile a submission belongs in.
 *
 * One definition shared by grading triage, the queue's filter, the gradebook's cells, and the
 * per-assignment counts. Those four answer the same question and must not answer it differently,
 * so what these cases hold is the *set* being exhaustive and its precedence being fixed — not
 * merely that each input maps to some output.
 */
describe("triageBucket", () => {
  describe("work that has been handed in", () => {
    it("needs a report when the pipeline can grade it", () => {
      expect(triageBucket("SUBMITTED", null, false, false, false)).toBe("needs_report");
    });

    it("needs a person when the pipeline cannot", () => {
      // The same pile of work, distinguished because the action differs and only one of the
      // two exists: `needs_report` offers a button that must not appear on an assignment
      // nothing can generate a report for.
      expect(triageBucket("SUBMITTED", null, false, false, true)).toBe("needs_manual_grade");
    });

    it("treats a resubmission the same way as a first submission", () => {
      expect(triageBucket("RESUBMITTED", null, false, false, false)).toBe("needs_report");
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
      expect(triageBucket("SUBMITTED", { status }, false, false, false)).toBe(bucket);
    });

    it("reads the draft rather than the submission status", () => {
      // Generating a report writes the draft's status and leaves the submission's alone, so
      // DRAFT_READY and friends are SubmissionStatus values nothing ever writes. Reading them
      // off the submission would leave every bucket permanently empty.
      expect(triageBucket("GRADED", { status: "READY" }, false, false, false)).toBe("draft_ready");
    });
  });

  describe("a draft describing code the student has replaced", () => {
    it("falls through to needing a report rather than offering a stale one", () => {
      expect(triageBucket("RESUBMITTED", { status: "READY" }, true, false, false)).toBe(
        "needs_report",
      );
    });

    it("falls through to needing a person on a hand-graded assignment", () => {
      expect(triageBucket("RESUBMITTED", { status: "READY" }, true, false, true)).toBe(
        "needs_manual_grade",
      );
    });

    it("is not offered as ready even when the run itself succeeded", () => {
      // Approval refuses a stale draft, so a row that offered it would be a button that throws.
      expect(triageBucket("SUBMITTED", { status: "READY" }, true, false, false)).not.toBe(
        "draft_ready",
      );
    });
  });

  describe("an approval whose comment never reached the pull request", () => {
    it("outranks every other bucket", () => {
      // Checked ahead of everything else because what happens next is usually that the student
      // pushes again and a new draft is generated, which would bury it forever.
      expect(triageBucket("GRADED", { status: "APPROVED" }, false, true, false)).toBe(
        "comment_not_posted",
      );
    });

    it("outranks a draft that is otherwise ready to read", () => {
      expect(triageBucket("SUBMITTED", { status: "READY" }, false, true, false)).toBe(
        "comment_not_posted",
      );
    });
  });

  describe("work that is waiting on nobody", () => {
    it("is null once a grade has been delivered", () => {
      expect(triageBucket("GRADED", { status: "APPROVED" }, false, false, false)).toBeNull();
    });

    it("is null for a hand-graded submission once approved", () => {
      // The case the deliverability test exists for. Without it every finished hand-graded
      // submission sat in triage permanently with nothing an instructor could do to clear it.
      expect(triageBucket("GRADED", { status: "APPROVED" }, false, false, true)).toBeNull();
    });

    it("is null for an accepted assignment nobody has handed in", () => {
      expect(triageBucket("ACCEPTED", null, false, false, false)).toBeNull();
    });

    it("is null for an assignment nobody has started", () => {
      expect(triageBucket("NOT_STARTED", null, false, false, false)).toBeNull();
    });

    it("is null for a superseded draft on graded work", () => {
      expect(triageBucket("GRADED", { status: "SUPERSEDED" }, false, false, false)).toBeNull();
    });
  });

  describe("pushing after being graded", () => {
    it("is not a request for another look", () => {
      // Pushing is not asking. The student's own declaration is what sets RESUBMITTED, and
      // without it their submission is still GRADED and waiting on nobody.
      expect(triageBucket("GRADED", null, false, false, false)).toBeNull();
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
