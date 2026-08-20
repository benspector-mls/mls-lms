import {
  blankSectionRefusal,
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

/**
 * What may not be released yet.
 *
 * Two rules, and the cases exist because each has a near neighbour it must not swallow. A score
 * of **zero** is not the same as **no score at all**: a student who hands in an empty document
 * has earned a zero, and an instructor has to be able to record one. And **blank feedback** is a
 * legitimate choice — the comments frequently live in the Google Doc the instructor is reading —
 * except on a submission whose feedback reaches the student as a pull request comment, where
 * posting nothing would fail to send and strand the grade in `comment_not_posted` forever.
 */
describe("blankSectionRefusal", () => {
  const noPr = { hasPullRequest: false };
  const withPr = { hasPullRequest: true };
  const filled = { sectionType: "Delivery", reportMarkdown: "Clear throughout.", scoreEarned: 8 };

  describe("the score, which is required", () => {
    it("allows a section that has one", () => {
      expect(blankSectionRefusal([filled], noPr)).toBeNull();
    });

    it("allows a deliberate zero", () => {
      expect(
        blankSectionRefusal(
          [{ sectionType: "Technical Content", reportMarkdown: "No content.", scoreEarned: 0 }],
          noPr,
        ),
      ).toBeNull();
    });

    it("allows a deliberate zero with no feedback beside it", () => {
      // Both halves of the new rule at once, and the combination an instructor grading an empty
      // Google Doc actually types: a zero, and their reasons left in the document.
      expect(
        blankSectionRefusal(
          [{ sectionType: "Technical Content", reportMarkdown: null, scoreEarned: 0 }],
          noPr,
        ),
      ).toBeNull();
    });

    it("refuses a section with none, whatever the feedback says", () => {
      const refusal = blankSectionRefusal(
        [{ sectionType: "Delivery", reportMarkdown: "Rushed in places.", scoreEarned: null }],
        noPr,
      );
      expect(refusal).toContain('"Delivery" has no score');
    });

    it("groups several sections and agrees with the verb", () => {
      const refusal = blankSectionRefusal(
        [
          filled,
          { sectionType: "Delivery", reportMarkdown: "Rushed.", scoreEarned: null },
          { sectionType: "Technical Content", reportMarkdown: "Thin.", scoreEarned: null },
        ],
        noPr,
      );
      expect(refusal).toContain('"Delivery", "Technical Content" have no score');
    });

    it("says a zero is a real grade, so the refusal is not read as banning one", () => {
      const refusal = blankSectionRefusal(
        [{ sectionType: "Delivery", reportMarkdown: null, scoreEarned: null }],
        noPr,
      );
      expect(refusal).toContain("a score of zero is a real grade");
    });

    it("is the refusal given first, because it applies everywhere", () => {
      // A draft that is missing scores AND would post an empty comment is told about the scores.
      // Fixing them is the instructor's next action either way, and two refusals in one message
      // is a wall of text about a form with two empty boxes.
      const refusal = blankSectionRefusal(
        [{ sectionType: "Delivery", reportMarkdown: null, scoreEarned: null }],
        withPr,
      );
      expect(refusal).toContain("no score");
      expect(refusal).not.toContain("posts a comment");
    });
  });

  describe("the feedback, which is optional", () => {
    it("allows every section blank where there is no pull request", () => {
      expect(
        blankSectionRefusal(
          [
            { sectionType: "Delivery", reportMarkdown: null, scoreEarned: 7 },
            { sectionType: "Technical Content", reportMarkdown: "  ", scoreEarned: 9 },
          ],
          noPr,
        ),
      ).toBeNull();
    });

    it("refuses every section blank where there is one", () => {
      // Not unhelpfulness but a delivery that cannot happen: an empty comment body fails to
      // send, and the submission then sits in `comment_not_posted` with a retry that cannot win.
      const refusal = blankSectionRefusal(
        [{ sectionType: "Delivery", reportMarkdown: "   ", scoreEarned: 7 }],
        withPr,
      );
      expect(refusal).toContain("posts a comment to the pull request");
    });

    it("allows a pull request grade where one section has something in it", () => {
      // `buildFeedbackMarkdown` drops the empty ones, so the comment has content and posts.
      expect(
        blankSectionRefusal(
          [filled, { sectionType: "Technical Content", reportMarkdown: null, scoreEarned: 0 }],
          withPr,
        ),
      ).toBeNull();
    });
  });
});
