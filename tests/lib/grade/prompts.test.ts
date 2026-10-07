import { addressBlock, buildSystemPrompt, buildUserPrompt } from "@/lib/grade/prompts";
import type { GradingAssets } from "@/lib/grade/assets";
import type { PreviousReview, SubmissionContext } from "@/lib/grade/prompts";

/**
 * Who a report is written to.
 *
 * Two things are held here. The wording, because a report addressed to one member of a team
 * credits work to somebody the report is not about — and the model has not been shown who wrote
 * what, so any attribution is a guess. And **the cache boundary**, which is the more expensive of
 * the two to get wrong: anything per-submission that drifts into the system half gives every team
 * its own prompt prefix, so every request becomes a cache write and nothing in the application
 * reports it.
 */

const assets: GradingAssets = {
  agentRules: "AGENT RULES",
  rubricSection: "RUBRIC",
  sampleReport: "SAMPLE",
  answerKeys: [],
  excludedAnswerKeys: [],
  commitSha: "0000000",
  answerKeyCommitSha: null,
};

const context = (over: Partial<SubmissionContext> = {}): SubmissionContext => ({
  addressees: [{ githubUsername: "ada" }],
  teamName: null,
  assignmentTitle: "Recursion",
  pointValue: 10,
  readme: null,
  studentFiles: [],
  testResults: null,
  tamperedPaths: [],
  headBranch: "draft",
  previousReview: null,
  ...over,
});

const block = (over: Partial<SubmissionContext> = {}) => addressBlock(context(over)).join("\n");

describe("addressBlock, for one student", () => {
  it("names their handle", () => {
    expect(block()).toBe("Address the student as @ada.");
  });

  it("says so plainly when there is no handle to name", () => {
    const text = block({ addressees: [{ githubUsername: null }] });
    expect(text).toContain("no GitHub username on record");
    expect(text).not.toContain("@");
  });

  it("is unchanged from what it was, so existing reports stay comparable", () => {
    // The individual wording is deliberately byte-for-byte what it always was. A team's report is
    // new; one student's is not, and a changed instruction would make this term's reports
    // incomparable with last term's for no reason.
    expect(block()).toBe("Address the student as @ada.");
  });
});

describe("addressBlock, for a team", () => {
  const three = {
    addressees: [
      { githubUsername: "ada" },
      { githubUsername: "grace" },
      { githubUsername: "katherine" },
    ],
  };

  it("names every member", () => {
    expect(block(three)).toContain("@ada, @grace and @katherine");
  });

  it("says the report goes to all of them", () => {
    expect(block(three)).toContain("every one of them receives this report");
  });

  it("asks for the second person plural rather than a singular addressee", () => {
    const text = block(three);
    expect(text).toContain("second person plural");
    expect(text).not.toContain("Address the student as @");
  });

  it("forbids attributing any part of the work to a member", () => {
    // The model has not been shown who wrote what. Commit authorship is a git config field and
    // pair programming on one machine is ordinary, so any attribution is a guess presented as
    // fact — about somebody who will read it.
    const text = block(three);
    expect(text).toContain("Do not attribute");
    expect(text).toContain("do not guess from commit history");
  });

  it("forbids rubric items naming a member", () => {
    /*
      Load-bearing rather than tidy. `rubricItems[].criterion` is free text, so a model told
      "three students" invents a row per member — and those rows still sum, so the arithmetic
      cross-check passes them and a per-member breakdown reaches the students under one shared
      score.
    */
    expect(block(three)).toContain("do not add rubric items naming a member");
  });

  it("handles a member with no handle without inventing one", () => {
    const text = block({
      addressees: [{ githubUsername: "ada" }, { githubUsername: null }],
    });
    expect(text).toContain("@ada");
    expect(text).not.toMatch(/@(null|undefined)/);
    expect(text).toContain("Not every member has a GitHub handle on record");
  });

  it("says how many there are when none of them has a handle", () => {
    const text = block({
      addressees: [{ githubUsername: null }, { githubUsername: null }],
    });
    expect(text).toContain("2 students share one repository");
    expect(text).not.toContain("@");
  });

  it("names the team when there is one", () => {
    expect(block({ ...three, teamName: "Team 3" })).toContain('working as "Team 3"');
  });

  it("reads as individual work for a team of one", () => {
    // A cohort with an odd headcount produces one-member teams routinely, and "do not single
    // anybody out" is nonsense addressed to one person.
    expect(block({ addressees: [{ githubUsername: "ada" }], teamName: "Team 4" })).toBe(
      "Address the student as @ada.",
    );
  });
});

describe("the cache boundary", () => {
  /*
    The most valuable case here, because its failure is silent and permanent. `buildSystemPrompt`
    is the one cacheable prefix; anything per-submission inside it gives every team its own prefix,
    so every request is a cache write at 1.25× and nothing on any screen says so. The four token
    counters in `generate-report.ts` would show it, if somebody looked.
  */
  const system = buildSystemPrompt({ sectionType: "coding_algorithm", assets });

  it("holds no handle, no team name, and no count of members", () => {
    // `@ada` rather than `ada`: a handle in these prompts is always written with the `@`, which is
    // what makes it a handle rather than a word — "unreadable" contains the other spelling.
    expect(system).not.toContain("@ada");
    expect(system).not.toContain("Team 3");
    expect(system).not.toContain("team work");
  });

  it("is byte-identical for a team and for one student", () => {
    // The property, stated directly: whatever the submission is, the prefix is the same string,
    // so both share one cache entry.
    expect(buildSystemPrompt({ sectionType: "coding_algorithm", assets })).toBe(system);
  });

  it("holds the resubmission rules for every submission, so they never vary the prefix", () => {
    expect(system).toContain("## Resubmissions");
    expect(system).not.toContain("Review 1");
  });

  it("puts the previous review in the user half, under its own heading", () => {
    const user = buildUserPrompt({ assets, context: context({ previousReview: review() }) });
    // After the section's point value, so it is plainly past the cacheable prefix.
    expect(user.indexOf("## Previous review")).toBeGreaterThan(
      user.indexOf("This section is out of"),
    );
  });

  it("puts the whole address block in the user half instead", () => {
    const user = buildUserPrompt({
      assets,
      context: context({
        addressees: [{ githubUsername: "ada" }, { githubUsername: "grace" }],
        teamName: "Team 3",
      }),
    });

    expect(user).toContain("@ada");
    expect(user).toContain('working as "Team 3"');
    // Before the section's point value, so the prefix boundary is visibly unchanged.
    expect(user.indexOf("@ada")).toBeLessThan(user.indexOf("This section is out of"));
  });
});

const review = (over: Partial<PreviousReview> = {}): PreviousReview => ({
  number: 1,
  headSha: "a1b2c3d4e5f6",
  reportMarkdown: "# Short Response Score Report\n\n## Question 1: 2/3\n\n- Name the base case.",
  scoreEarned: 7,
  scorePossible: 10,
  changes: [{ path: "short-response.md", kind: "modified", patch: "@@ -1,1 +1,1 @@\n-old\n+new" }],
  ...over,
});

/**
 * What a resubmission's prompt tells the model about the review the student already has.
 *
 * Without this block the model writing a second report does not know a first exists: it
 * re-explains what the student fixed and can move the score on work nobody touched.
 */
describe("the previous review block", () => {
  const user = (over: Partial<PreviousReview> = {}) =>
    buildUserPrompt({ assets, context: context({ previousReview: review(over) }) });

  it("is absent for a first submission", () => {
    expect(buildUserPrompt({ assets, context: context() })).not.toContain("## Previous review");
  });

  it("names the round as the student saw it and the commit it described", () => {
    const text = user();
    expect(text).toContain("already received Review 1 of this section");
    expect(text).toContain("written against commit a1b2c3d");
  });

  it("reproduces the previous report and its score", () => {
    const text = user();
    expect(text).toContain("it scored 7 out of 10");
    expect(text).toContain("- Name the base case.");
  });

  it("sits after the student's files and before the test results", () => {
    const text = user();
    expect(text.indexOf("## The student's submission")).toBeLessThan(
      text.indexOf("## Previous review"),
    );
    expect(text.indexOf("## Previous review")).toBeLessThan(
      text.indexOf("## Verified test results"),
    );
  });

  it("includes each changed file's diff", () => {
    const text = user();
    expect(text).toContain("#### short-response.md (modified)");
    expect(text).toContain("+new");
  });

  it("fences the previous report so a code fence inside it cannot close the quote", () => {
    const text = user({ reportMarkdown: "Use this:\n\n```js\nreturn n;\n```\n\nThen test it." });
    expect(text).toContain("````markdown\nUse this:");
    expect(text).toContain("Then test it.\n````");
  });

  it("says the student changed nothing rather than omitting the diff", () => {
    expect(user({ changes: [] })).toContain("has changed none of this section's files");
  });

  it("says so when there was no earlier commit to compare against", () => {
    const text = user({ headSha: null, changes: null });
    expect(text).toContain("written before this pull request existed");
    expect(text).not.toContain("written against commit");
  });

  it("says so when the changes could not be fetched", () => {
    expect(user({ changes: null })).toContain(
      "The changes since commit a1b2c3d could not be fetched",
    );
  });

  it("truncates a long patch rather than sending all of it", () => {
    const patch = `@@ -1,1 +1,1 @@\n+${"x".repeat(40_000)}`;
    const text = user({ changes: [{ path: "short-response.md", kind: "modified", patch }] });
    expect(text).toContain("truncated at 30000 characters");
    expect(text).not.toContain("x".repeat(31_000));
  });
});
