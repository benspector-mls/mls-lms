import {
  buildFeedbackMarkdown,
  deliveryOutcome,
  effectiveSection,
  hasSomewhereToPost,
  undeliveredApprovalWhere,
} from "@/lib/grade/delivery";
import { statedScoreInText } from "@/lib/grade/report-text";

/**
 * The pure half of approval.
 *
 * `approveDraft` itself writes rows and posts a comment, so it stays in `verify:approve`, which
 * drives it through the tRPC callers inside a rolled-back transaction. What is here is
 * everything approval *decides* before it writes anything.
 *
 * Imported from `./delivery` and `./report-text` rather than through `./approve`, which
 * re-exports all of it. That is not a style preference: `approve.ts` reaches Prisma and Octokit,
 * and importing it here pulls an ESM-only GitHub client into the test's module graph for the
 * sake of five pure functions.
 */

describe("hasSomewhereToPost", () => {
  it("needs both columns, because addressing a comment needs both", () => {
    expect(hasSomewhereToPost({ prNumber: 7, repoFullName: "org/repo" })).toBe(true);
    expect(hasSomewhereToPost({ prNumber: null, repoFullName: "org/repo" })).toBe(false);
    expect(hasSomewhereToPost({ prNumber: 7, repoFullName: null })).toBe(false);
    expect(hasSomewhereToPost({ prNumber: null, repoFullName: null })).toBe(false);
  });
});

describe("deliveryOutcome", () => {
  const withPr = { prNumber: 7, repoFullName: "org/repo-student" };
  const noPr = { prNumber: null, repoFullName: null };

  it("reports a posted comment", () => {
    expect(deliveryOutcome({ postedPrCommentId: BigInt(123) }, withPr)).toBe("posted");
  });

  it("reports a failure where there was somewhere to post", () => {
    expect(deliveryOutcome({ postedPrCommentId: null }, withPr)).toBe("failed");
  });

  it("reports not applicable where there was not", () => {
    /*
      The distinction the whole three-outcome design exists for. `postedPrCommentId` being null
      means two opposite things, and collapsing them reported an impossibility as a fault in
      three places at once: a toast saying the comment did not post, a retry that could never
      succeed, and a triage entry nothing could clear.
    */
    expect(deliveryOutcome({ postedPrCommentId: null }, noPr)).toBe("not_applicable");
  });

  it("treats half a pull request as nowhere to post", () => {
    expect(
      deliveryOutcome({ postedPrCommentId: null }, { prNumber: null, repoFullName: "org/repo" }),
    ).toBe("not_applicable");
  });

  it("reports a posted comment even where there is now no pull request", () => {
    // A posted id is a fact about what happened, not a prediction about what could.
    expect(deliveryOutcome({ postedPrCommentId: BigInt(1) }, noPr)).toBe("posted");
  });
});

describe("undeliveredApprovalWhere", () => {
  it("carries the deliverability test into the query", () => {
    /*
      Asserted as a shape because the failure is a silent omission. Without the submission
      condition every hand-graded submission matches, and `triageBucket` reads
      `comment_not_posted` ahead of every other bucket — so they would sit in triage, the queue,
      and the gradebook as work forever, with nothing an instructor could do about it.
    */
    expect(undeliveredApprovalWhere({ assignment: { courseId: "c" } })).toEqual({
      status: "APPROVED",
      postedPrCommentId: null,
      submission: {
        assignment: { courseId: "c" },
        prNumber: { not: null },
        repoFullName: { not: null },
      },
    });
  });

  it("still carries it when the caller scopes nothing", () => {
    expect(undeliveredApprovalWhere()).toEqual({
      status: "APPROVED",
      postedPrCommentId: null,
      submission: { prNumber: { not: null }, repoFullName: { not: null } },
    });
  });
});

describe("effectiveSection", () => {
  const model = {
    sectionType: "short_response",
    reportMarkdown: "model text",
    scoreEarned: 9,
    scorePossible: 15,
  };

  it("keeps the model's values when nothing was edited", () => {
    expect(
      effectiveSection({ ...model, editedReportMarkdown: null, editedScoreEarned: null }),
    ).toEqual(model);
  });

  it("prefers an instructor's edit", () => {
    expect(
      effectiveSection({
        ...model,
        editedReportMarkdown: "instructor text",
        editedScoreEarned: 11,
      }),
    ).toEqual({ ...model, reportMarkdown: "instructor text", scoreEarned: 11 });
  });

  it("honours an edited score of zero", () => {
    // `??` rather than `||` is what makes the difference. Getting it wrong would silently
    // restore the model's score every time an instructor zeroed a section.
    expect(
      effectiveSection({ ...model, editedReportMarkdown: null, editedScoreEarned: 0 }).scoreEarned,
    ).toBe(0);
  });

  it("honours edited text and score independently", () => {
    const onlyText = effectiveSection({
      ...model,
      editedReportMarkdown: "instructor text",
      editedScoreEarned: null,
    });
    expect(onlyText).toEqual({ ...model, reportMarkdown: "instructor text" });
  });
});

describe("buildFeedbackMarkdown", () => {
  it("separates sections with a rule rather than merging them", () => {
    // They are graded against different rubrics and each carries its own heading and score
    // line. Rewriting them into one narrative would mean editing approved text.
    expect(
      buildFeedbackMarkdown([
        { sectionType: "a", reportMarkdown: "first" },
        { sectionType: "b", reportMarkdown: "second" },
      ]),
    ).toBe("first\n\n---\n\nsecond");
  });

  it("skips a section with no report rather than leaving an empty block", () => {
    expect(
      buildFeedbackMarkdown([
        { sectionType: "a", reportMarkdown: "first" },
        { sectionType: "b", reportMarkdown: null },
      ]),
    ).toBe("first");
  });

  it("skips a section that is only whitespace", () => {
    expect(
      buildFeedbackMarkdown([
        { sectionType: "a", reportMarkdown: "   \n  " },
        { sectionType: "b", reportMarkdown: "second" },
      ]),
    ).toBe("second");
  });

  it("is empty when nothing was written", () => {
    expect(buildFeedbackMarkdown([])).toBe("");
  });
});

describe("statedScoreInText", () => {
  it("reads the score line out of a report", () => {
    expect(statedScoreInText("# Report\n\n## Short Response Score: 11/15 = 73%")).toEqual({
      earned: 11,
      possible: 15,
    });
  });

  it("states none when a report has no score line", () => {
    expect(statedScoreInText("# Report\n\nNo score anywhere.")).toBeNull();
  });

  it("reads half credit", () => {
    expect(statedScoreInText("## Score: 20.5/25 = 82%")).toEqual({ earned: 20.5, possible: 25 });
  });

  it("tolerates the spacing an instructor might type", () => {
    expect(statedScoreInText("### Score:  8 / 10")).toEqual({ earned: 8, possible: 10 });
  });

  it("only reads a heading, not a sentence mentioning a score", () => {
    // The rule the interface's warning and the server's refusal both rest on, which is why
    // this function has no database or network imports: they are literally the same function.
    expect(statedScoreInText("You scored 11/15 on this, well done.")).toBeNull();
  });
});
