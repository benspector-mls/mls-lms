import { addressBlock, buildSystemPrompt, buildUserPrompt } from "@/lib/grade/prompts";
import type { GradingAssets } from "@/lib/grade/assets";
import type { SubmissionContext } from "@/lib/grade/prompts";

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
