import type { SubmissionStatus } from "@/lib/generated/prisma/enums";
import {
  completeCount,
  progressSegments,
  progressStateOf,
  segmentTooltip,
  type ProgressAssignment,
} from "@/lib/student/progress";

/**
 * The bar over a student's course, as five counts.
 *
 * Two rules here are worth more than the rest. The bar must agree with the status badges in the
 * list beneath it, since it is a summary of exactly those rows and a reader has both on screen at
 * once. And completion must come from `isComplete` rather than from arithmetic, because the
 * threshold judgment is made once, in `approveDraft`, and a second implementation of it in the
 * browser is how a bar comes to disagree with the gradebook about who passed.
 */

/** One assignment in a given state, in as few characters as the type allows. */
function at(
  status: SubmissionStatus | null,
  isComplete: boolean | null = null,
): ProgressAssignment {
  return { submissions: status == null ? [] : [{ status, isComplete }] };
}

describe("progressStateOf", () => {
  // The relation is scoped to the caller, so an assignment nobody has touched has no row at all.
  it("treats a missing submission and NOT_STARTED as the same thing", () => {
    expect(progressStateOf(null)).toBe("notAccepted");
    expect(progressStateOf(undefined)).toBe("notAccepted");
    expect(progressStateOf({ status: "NOT_STARTED", isComplete: null })).toBe("notAccepted");
  });

  /*
    One distinction more than the status badges draw, where both of these are grey. On a bar they
    are two different sentences: work taken up and not handed in, versus work not looked at.
  */
  it("keeps accepted apart from not accepted", () => {
    expect(progressStateOf({ status: "ACCEPTED", isComplete: null })).toBe("accepted");
  });

  /*
    The five queue-shaped statuses collapse into one segment, for the reason `STUDENT_STATUS_META`
    gives them one label: three of them describe this application's problems rather than the
    student's work, and a student shown a red segment for a pipeline error concludes they broke
    something.
  */
  it.each([
    "SUBMITTED",
    "RESUBMITTED",
    "DRAFT_READY",
    "NEEDS_MANUAL_REVIEW",
    "GRADING_FAILED",
  ] as const)("puts %s with the instructor", (status) => {
    expect(progressStateOf({ status, isComplete: null })).toBe("withInstructor");
  });

  it("splits graded work on isComplete", () => {
    expect(progressStateOf({ status: "GRADED", isComplete: true })).toBe("complete");
    expect(progressStateOf({ status: "GRADED", isComplete: false })).toBe("incomplete");
  });

  /*
    Found by `verify:dashboard` against real rows, not by a case written from imagination.

    Reading the status before `isComplete` meant a student who passed an assignment and then asked
    for another look moved out of the green segment, and the "5 of 9 complete" above the bar became
    4 of 9. The bar took a completion away for resubmitting — which is the behaviour it should be
    encouraging — and disagreed with the score column beside it, which reads `isComplete` whatever
    the status says.
  */
  it("does not take a completion away when the student asks for another look", () => {
    expect(progressStateOf({ status: "RESUBMITTED", isComplete: true })).toBe("complete");
    expect(progressStateOf({ status: "SUBMITTED", isComplete: true })).toBe("complete");
  });

  // The ordinary reason to resubmit. Something is genuinely in flight, so it is not "not yet
  // complete" either — that segment is for work sitting with a verdict and nothing happening.
  it("puts a resubmission of work below the threshold with the instructor", () => {
    expect(progressStateOf({ status: "RESUBMITTED", isComplete: false })).toBe("withInstructor");
  });

  /*
    Not a state approval can produce — the status and `isComplete` are written in one transaction —
    so reaching it means something is wrong. Saying the work is out of the student's hands is
    honest; guessing at a verdict is not.
  */
  it("does not invent a verdict for a graded row with no isComplete", () => {
    expect(progressStateOf({ status: "GRADED", isComplete: null })).toBe("withInstructor");
  });
});

describe("progressSegments", () => {
  const course: ProgressAssignment[] = [
    at(null),
    at("NOT_STARTED"),
    at("ACCEPTED"),
    at("SUBMITTED"),
    at("RESUBMITTED"),
    at("GRADED", false),
    at("GRADED", true),
    at("GRADED", true),
    at("GRADED", true),
  ];

  it("counts each state", () => {
    const byState = new Map(progressSegments(course).map((s) => [s.state, s.count]));

    expect(byState.get("notAccepted")).toBe(2);
    expect(byState.get("accepted")).toBe(1);
    expect(byState.get("withInstructor")).toBe(2);
    expect(byState.get("incomplete")).toBe(1);
    expect(byState.get("complete")).toBe(3);
  });

  // What makes the widths readable as proportions of one course rather than of some subset.
  it("accounts for every assignment exactly once", () => {
    const total = progressSegments(course).reduce((sum, s) => sum + s.count, 0);
    expect(total).toBe(course.length);
  });

  it("orders segments the way a student moves through them", () => {
    expect(progressSegments(course).map((s) => s.state)).toEqual([
      "notAccepted",
      "accepted",
      "withInstructor",
      "incomplete",
      "complete",
    ]);
  });

  // No invisible members. An empty state is not a thing the student is in.
  it("drops states with nothing in them", () => {
    const segments = progressSegments([at("GRADED", true), at("GRADED", true)]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ state: "complete", count: 2 });
  });

  it("is empty for a course with no assignments", () => {
    expect(progressSegments([])).toEqual([]);
  });

  // Each segment must be drawable, in the bar and in the legend beside it.
  it("gives every segment a label and both classes", () => {
    for (const segment of progressSegments(course)) {
      expect(segment.label).not.toHaveLength(0);
      expect(segment.className).not.toHaveLength(0);
      expect(segment.dotClassName).not.toHaveLength(0);
    }
  });

  /*
    Green means the completion threshold was met and nothing else — the rule `lib/status.ts` has a
    test of its own for. Amber is where waiting on somebody lives, so neither may be emerald.
  */
  it("keeps emerald for complete work alone", () => {
    const byState = new Map(progressSegments(course).map((s) => [s.state, s.className]));

    expect(byState.get("complete")).toContain("emerald");
    expect(byState.get("withInstructor")).not.toContain("emerald");
    expect(byState.get("incomplete")).not.toContain("emerald");
  });
});

/**
 * The header count and the green segment are the same number by construction.
 *
 * They were computed separately, in two files, from two readings of what "complete" means. This is
 * the pairing whose only real failure is telling a student two different things at once.
 */
describe("completeCount", () => {
  it("counts what the green segment counts", () => {
    const course = [at("GRADED", true), at("GRADED", false), at("SUBMITTED"), at(null)];
    const green = progressSegments(course).find((s) => s.state === "complete");

    expect(completeCount(course)).toBe(1);
    expect(completeCount(course)).toBe(green?.count);
  });

  it("counts nothing in a course nobody has been graded in", () => {
    expect(completeCount([at("ACCEPTED"), at("SUBMITTED")])).toBe(0);
  });
});

/**
 * The noun agrees with the count.
 *
 * Asserted as a property rather than against the finished sentence, because the segment labels are
 * wording and wording gets changed — a case spelling one out in full fails the next time somebody
 * improves it, which says nothing about the plural rule it was written to protect.
 */
describe("segmentTooltip", () => {
  it("agrees with itself about the noun", () => {
    const [one] = progressSegments([at("GRADED", true)]);
    const [several] = progressSegments([at("GRADED", true), at("GRADED", true)]);

    expect(segmentTooltip(one)).toContain("1 assignment ");
    expect(segmentTooltip(one)).not.toContain("assignments");
    expect(segmentTooltip(several)).toContain("2 assignments");
  });

  // Whatever the label says, the tooltip has to name the count and then describe it.
  it("carries the count and the label", () => {
    const [segment] = progressSegments([at("ACCEPTED"), at("ACCEPTED")]);

    expect(segmentTooltip(segment)).toContain("2");
    expect(segmentTooltip(segment)).toContain(segment.label.toLowerCase());
  });
});
