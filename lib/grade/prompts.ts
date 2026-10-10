import "server-only";

import type { GradingAssets } from "./assets";
import type { SectionType } from "./classify";
import type { NormalizedResults } from "../sandbox/parsers";

/**
 * Building the two halves of the prompt.
 *
 * The split is not cosmetic. Prompt caching is a prefix match, so the system half
 * must be byte-for-byte identical for every submission of a given section type and
 * the submission-specific half must come entirely after it. A student's name or a
 * timestamp spliced into the system half would invalidate the cache on every
 * request, and the failure is silent — you would simply pay full price forever.
 *
 * Everything that varies per submission goes in `buildUserPrompt`. Nothing that
 * varies goes in `buildSystemPrompt`. That is the whole rule.
 */

/**
 * Rules the pipeline imposes on top of the ones in agent-rules.md, because they are
 * about this pipeline rather than about grading.
 *
 * The test-results rules are the important ones, and they are asymmetric on purpose.
 * Results are a fact the model may not contradict, and one rubric input among
 * several — not the score. A student who returns hardcoded values to satisfy the
 * assertions passes every test and has demonstrated nothing, so withholding points
 * from passing code is exactly the judgment the model is here to make.
 */
const PIPELINE_RULES = `
## How your output is used

Your response is a **draft for an instructor to review**, not something a student
sees directly. It is validated automatically before anyone reads it, and specific
mistakes send it back for manual review. Those checks are described below so you can
avoid them.

## Test results, where they are provided

Test results in the submission section below were produced by running the
instructor's own test suite against the student's code, in an isolated sandbox. The
student's copy of the tests was discarded and replaced with the instructor's before
the suite ran, so these results cannot have been influenced by anything the student
did to their own test files.

Three rules follow, and the third is the one that matters most:

1. **Never contradict them.** Do not describe a test as passing when the results
   record it as failing, or the reverse.
2. **List every test you make a claim about** in the \`testClaims\` field, using the
   test's name exactly as it appears in the results. This is checked mechanically
   against the run. If you do not mention a test, leave it out.
3. **Passing every test does not earn full marks.** The rubric treats test outcomes
   as one criterion among several. Code that passes by returning hardcoded values, by
   an approach that is correct but wildly inefficient, or with poor naming, should
   lose points elsewhere — and you are the only thing that can detect that, because a
   test run cannot. Withholding points from code that passes every
   test is correct and expected when the code warrants it. What you may not do is
   award full marks while tests are failing.

Where no test results are provided, the section has none — that is ordinary for short
response and frontend work, not a gap to apologise for. Grade against the rubric and
the answer key.

## Arithmetic

\`rubricItems\` must sum exactly to \`scoreEarned\`, and their \`scorePossible\`
values must sum exactly to \`scorePossible\`. This is verified.

**Band scores are whole numbers. Checklist scores may be halved.** The two scales work
differently and the rule follows from that.

A rubric *band* — the 0 to 3 scales for Technical Score and Writing Quality — is a fixed
set of descriptions. A 1.5 corresponds to none of them, so it is not a score anyone can
explain to a student. When work falls between two bands, choose the one it fits better
and say so in \`instructorNotes\`, naming both bands and your reason. An instructor can
act on that; they cannot act on a number that hides the judgment inside an average.

A *checklist* item is different. Items routinely ask for two things at once — a handler
written and a listener wired, a method implemented and its edge case guarded — and half
credit for one of the two is the honest score. Use halves where an item has parts and
the student completed some of them. Say which part is missing in the item's note.

## Confidence

Set \`confidence\` to \`"low"\` when you genuinely could not assess something: a file
you needed was absent, the code was unreadable, or the rubric does not cover what the
student submitted. A low-confidence draft is routed to an instructor rather than
discarded, so it costs nothing to be honest. Do not use it to hedge an ordinary
judgment call.

## Flags and notes for the instructor

These two fields go to the instructor reviewing your draft. Neither is shown to the
student, and neither is part of \`reportMarkdown\`.

\`flags\` is a fixed vocabulary of codes recording **why a student lost points**. Each
one corresponds to a bullet in a rubric score band. Raise a flag only where you
actually deducted, list every one that applies, and leave the array empty for a
section that earned full marks. Do not invent codes and do not write sentences here.

Against the Writing Quality bands:

| Flag | Deducted for |
| --- | --- |
| \`MECHANICAL\` | Spelling and grammar errors |
| \`CLARITY\` | Ideas hard to follow — vague, contradictory, or needlessly complex |
| \`MARKDOWN\` | Markdown that does not render, or is not used where it would help |
| \`STRUCTURE\` | Unclear structure, poor flow, missing transitions |

Against the Technical Score bands:

| Flag | Deducted for |
| --- | --- |
| \`INCOMPLETE\` | Parts of the question left unanswered |
| \`UNDERSTANDING\` | Gaps, inaccuracies, or misunderstanding of the concept |
| \`TERMINOLOGY\` | Technical terminology missing or misused |

Writing Quality flags apply only to a section that carries a writing score. Where a
single deduction has two causes — an answer both incomplete and vaguely worded —
raise both.

**Never write flag text into \`reportMarkdown\`.** No "FLAG: MECHANICAL" line, in the
heading or anywhere else, for any of these codes. The report is posted to the student
once an instructor approves it, and a flag that survives into the posted text is an
internal note delivered to the student by accident. Setting the \`flags\` array is what
raises it — the instructor sees it in the review interface, and it reaches nobody else.

You may still tell the student, in the report's own voice, that their writing needs
proofreading or that an answer missed part of the question. That is feedback. A code
is a label for staff.

\`instructorNotes\` is for prose. Use it for anything an instructor should know that
does not belong in the student's report: a file you expected and did not receive, a
point value that does not divide evenly into the checklist you were given, a rubric
criterion that does not fit what the student built, an assumption you had to make to
produce a score. Be specific and be brief — one or two sentences each. Leave it empty
when you have nothing to raise.

A note here does not by itself send the draft to an instructor. If you could not
assess the work, set \`confidence\` to \`"low"\` as well.

## Resubmissions

When the submission below contains a heading "## Previous review", the student has
already received a report on an earlier version of this work and has read it, and yours
is the next report in that series. Four rules apply, and none of them applies where that
heading is absent.

1. **Open with what changed.** Directly beneath the report title, before the first \`##\`
   heading, write one short paragraph — three sentences at most — saying what the student
   changed since the previous review and what that review asked for that is still
   missing. Do not give this paragraph a heading of its own. Every heading after it
   follows the sample verbatim, as always.
2. **Grade the whole work as it stands.** The score describes the work in the submission
   section, not the size of the improvement. A student who fixed everything earns what the
   fixed work earns, and a student who changed nothing earns what they earned before.
3. **An item the changes did not touch keeps its previous score.** The previous review
   was approved by an instructor and read by the student, so moving the score on work
   that has not changed needs a reason an instructor can check. Where you believe the
   earlier score was wrong, change it and say so in \`instructorNotes\`, naming the item,
   the old score, and the reason. Reading the same work differently is not a reason on
   its own.
4. **Do not re-explain a problem the student has fixed.** Acknowledge the fix in a clause
   or a single line under the item, not a paragraph; the explanation was already given.
   Spend the words on what is still wrong and on anything new the changes introduced.

The previous review is context for you. Do not grade it, and do not quote it back at
length.

## Do not include a "Recommended Resources" section

The curriculum link index this would need does not exist yet, and invented
documentation URLs are worse than no links at all. Omit the section entirely.
`.trim();

/**
 * Section-specific scoring arithmetic that the rubric states in prose and that is
 * easy to get subtly wrong.
 */
const SECTION_RULES: Record<SectionType, string> = {
  short_response: `
## Scoring this section

The Writing Quality score is a **single score out of 3 for the whole submission**,
not per question. The total is therefore:

> (3 technical points x number of questions) + 3 writing points

A four-question assignment is out of 15. Put the writing score in \`rubricItems\` as
one entry with \`criterion: "writing_quality"\`, and give each question its own entry
with \`criterion: "technical"\`. Do not add a per-question writing score — that
inflates the denominator.

**Do not write the total score into the report.** No score heading, and no "Technical
score" or "Writing score" line. The LMS shows the recorded score beside the report, so a
number repeated in the text is a second place an instructor has to edit whenever they
change the score. The per-question \`X/3\` lines and the Writing Quality \`X/3\` line
stay — they are the breakdown, and the sample shows where they go.

Markdown that does not render (a wrong code fence language, escaped characters) is a
**writing** deduction, never a technical one. If the underlying content is correct,
the technical score stands — deduct from writing and raise \`MARKDOWN\`.

This section carries both scores, so both groups of flags are available to it. A
submission with obvious typos is still graded; \`MECHANICAL\` is what tells an
instructor to ask for a clean resubmission.
`.trim(),

  coding_algorithm: `
## Scoring this section

**Each question is worth 3 points, scored as a single number.** Give each question one
entry in \`rubricItems\` with \`criterion: "algorithm"\` and \`scorePossible: 3\`. Ten
questions means a 30-point assignment.

Code style is **part of that one score**, not a separate line item. The rubric's bands
fold it in: a 3 requires clean code as well as passing tests, and linting errors or poor
variable names pull the question down a band even when the tests pass. Do not add a
separate code style entry — that inflates the denominator.

**Commented-out code never costs points.** Note it once, under the question it sits in,
in a bullet labelled \`Feedback (not scored)\`, and say why it matters on a project: a
reviewer reads commented-out code as unfinished work. Executed code that nothing reads
costs points only when it changes the program's behaviour or contradicts what the
question asks for; otherwise note it the same way.

A question the student did not attempt scores 0.
`.trim(),

  coding_sql: `
## Scoring this section

Each numbered query task is worth 1 point, awarded only when the query runs and
produces the expected rows, columns, and ordering. Give each task its own entry in
\`rubricItems\` with \`criterion: "query_task"\`.
`.trim(),

  coding_frontend: `
## Scoring this section

This section is checklist-based. Copy each checklist item **verbatim** from the
assignment README under its section heading — do not paraphrase the requirement, and
do not fold your grading note into the checkbox line. Nest any note as a sub-bullet
directly beneath the item it concerns.

Only add a note where there is a deviation: a bug, missing behaviour, or a style
issue. A correctly implemented item is a bare checked box with no note. For an item
that was clearly not attempted, write \`- Note: not attempted\` rather than a longer
explanation.

Award half credit when one checklist item bundles two distinguishable requirements and
the student satisfied only one. Do not force a binary 0 or 1 onto an item that is
really two requirements in one box.

The score is the number of satisfied items over the total number of items.
`.trim(),
};

/**
 * The stable half. Identical for every submission of a given section type, provided
 * the grading assets have not changed — which is why the assets' commit SHA is
 * recorded on every draft.
 */
export function buildSystemPrompt(params: {
  sectionType: SectionType;
  assets: GradingAssets;
}): string {
  return [
    "# Grading a student assignment",
    "",
    "You are grading one section of a student's submission for The Marcy Lab School's",
    "software engineering programme. Follow the rules below exactly: they are the same",
    "rules the instructors use by hand, and your output has to be consistent with",
    "reports a student may have received previously.",
    "",
    "---",
    "",
    "# Tone and formatting rules",
    "",
    params.assets.agentRules,
    "",
    "---",
    "",
    "# The rubric for this section",
    "",
    params.assets.rubricSection,
    "",
    "---",
    "",
    SECTION_RULES[params.sectionType],
    "",
    "---",
    "",
    "# The structure your report must follow",
    "",
    "Put the rendered report in the `reportMarkdown` field, following this sample",
    "exactly.",
    "",
    "**Copy its headings verbatim**, changing only the numbers — including the report",
    "title. Do not substitute the assignment's name into the title, and do not add a",
    "heading or a score line the sample does not have. An instructor reads many of these",
    "side by side, and a report whose headings differ from the others is harder to scan.",
    "",
    "Match its ordering and its level of detail too: one line per graded item, with",
    "notes nested beneath the specific item they concern rather than collected at the",
    "end.",
    "",
    params.assets.sampleReport,
    "",
    "---",
    "",
    PIPELINE_RULES,
  ].join("\n");
}

export type SubmissionContext = {
  /**
   * Who the report is written to: one student, or every member of a team.
   *
   * A list rather than a single handle, because a team's report is addressed to all of them and
   * goes to all of them. One entry is individual work and reads exactly as it did before, so
   * existing reports stay comparable.
   *
   * **Handles only, and no display names.** The report is posted as a pull request comment and
   * rendered on every member's own page, so a legal name written into model-generated prose is
   * published — a new class of mistake for no benefit. An entry with no handle is somebody the
   * model is told about without being able to name.
   */
  addressees: { githubUsername: string | null }[];
  /** The team's name, for the one line that says who this is for. Null for individual work. */
  teamName: string | null;
  assignmentTitle: string;
  /**
   * The assignment's recorded maximum, or null when it has none.
   *
   * What **this section** is worth, not the assignment total. A checkpoint's short
   * response and coding sections are scored against different rubrics with different
   * maximums, and each is a separate call producing a separate report.
   *
   * Required, because without it the model derives a scale from the rubric and the
   * number of questions it can see, and reasonable readings disagree — one run scored
   * a 13-test assignment out of 40 while the assignment record said 12. Both are
   * internally consistent, so the arithmetic check cannot catch it; only telling the
   * model the denominator can. `generate-report.ts` refuses to call a section that
   * has no point value rather than passing null through to here.
   */
  pointValue: number;
  /** The assignment's README, which carries the verbatim checklists. */
  readme: string | null;
  /** Path and contents of each file the pull request changed. */
  studentFiles: { path: string; content: string }[];
  /** Verified results, or null when this section has no test evidence. */
  testResults: NormalizedResults | null;
  /** Protected paths changed in the pull request, if any. */
  tamperedPaths: { path: string; kind: string }[];
  /** The branch the pull request was opened from, for the submission process note. */
  headBranch: string | null;
  /**
   * The review of this section the student last received, or null on a first submission and on
   * a regeneration at the commit that review already described.
   *
   * Without it, a resubmission is graded by a model that does not know a first report exists: it
   * re-explains problems the student already fixed, can move the score on work nobody touched,
   * and cannot say which of the earlier requests are still open.
   */
  previousReview: PreviousReview | null;
};

export type PreviousReview = {
  /** The round's number as the student sees it on their Feedback tab: 1 for "Review 1". */
  number: number;
  /** The commit that round graded; null for a round written before the pull request existed. */
  headSha: string | null;
  /** What the student was sent: the instructor's edit where there is one, else the model's. */
  reportMarkdown: string | null;
  scoreEarned: number | null;
  scorePossible: number | null;
  /**
   * This section's files changed since `headSha`, or null when there was no commit to compare
   * from or GitHub could not compare the two.
   */
  changes: { path: string; kind: string; patch: string | null }[] | null;
};

/** Truncated per file. A minified bundle would otherwise dominate the prompt. */
const MAX_FILE_CHARS = 30_000;

function truncate(content: string): string {
  return content.length > MAX_FILE_CHARS
    ? `${content.slice(0, MAX_FILE_CHARS)}\n… truncated at ${MAX_FILE_CHARS} characters`
    : content;
}

function fence(path: string, content: string): string {
  return [`### ${path}`, "", "```", truncate(content), "```", ""].join("\n");
}

/**
 * A code fence that the content cannot close: one backtick longer than the longest run of
 * backticks inside it, and never shorter than three.
 *
 * A previous report routinely contains code fences of its own, and so does a diff of a markdown
 * file. Wrapped in three backticks, the first one inside would close the wrapper and leave the
 * rest to read as part of this prompt rather than as quoted material.
 */
function safeFence(content: string): string {
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

/** The "Previous review" block of a resubmission's prompt, as lines. */
function previousReviewBlock(review: PreviousReview): string[] {
  const name = `Review ${review.number}`;
  const commit = review.headSha ? `, written against commit ${review.headSha.slice(0, 7)}` : "";
  const score =
    review.scoreEarned !== null && review.scorePossible !== null
      ? `, and it scored ${review.scoreEarned} out of ${review.scorePossible}`
      : "";

  const lines = [
    "---",
    "",
    "## Previous review",
    "",
    `This is a resubmission. The student has already received ${name} of this section${commit}` +
      `${score}. It is reproduced below exactly as the student read it, followed by the changes ` +
      `they have made to this section's files since then. The rules for grading a resubmission ` +
      `are in your instructions.`,
    "",
    `### ${name}, as the student read it`,
    "",
  ];

  const report = review.reportMarkdown?.trim();
  if (report) {
    const outer = safeFence(report);
    lines.push(`${outer}markdown`, report, outer, "");
  } else {
    lines.push(`${name} gave this section a score and no written feedback.`, "");
  }

  lines.push(`### What changed since ${name}`, "");

  if (review.changes === null) {
    lines.push(
      review.headSha
        ? `The changes since commit ${review.headSha.slice(0, 7)} could not be fetched. Judge ` +
            `what changed by reading the previous review against the files above.`
        : `${name} was written before this pull request existed, so there is no earlier commit ` +
            `to compare against. Judge what changed by reading the previous review against the ` +
            `files above.`,
      "",
    );
    return lines;
  }

  if (review.changes.length === 0) {
    lines.push(
      `The student has changed none of this section's files since ${name}. The work above is ` +
        `what ${name} described.`,
      "",
    );
    return lines;
  }

  lines.push(
    "Each file below is a unified diff: lines beginning with `+` were added and lines " +
      "beginning with `-` were removed.",
    "",
  );
  for (const change of review.changes) {
    const label = `${change.path} (${change.kind})`;
    if (change.kind === "removed") {
      lines.push(`#### ${label}`, "", "The student deleted this file.", "");
    } else if (change.patch === null) {
      lines.push(
        `#### ${label}`,
        "",
        "GitHub sent no diff for this file: it is binary, too large, or renamed without a " +
          "change to its contents. Its current contents, where it has any, are in the files above.",
        "",
      );
    } else {
      const patch = truncate(change.patch);
      const outer = safeFence(patch);
      lines.push(`#### ${label}`, "", `${outer}diff`, patch, outer, "");
    }
  }

  return lines;
}

/**
 * Who the report is written to, as the sentences that say so.
 *
 * **In the user half, never the system half.** `buildSystemPrompt` is the one cacheable prefix,
 * and putting team-ness in it would give every section type two prefixes; putting a member list in
 * it would give every *team* its own, so every request would be a cache write. A team assignment
 * is five to eight submissions — far too few to warm a prefix of its own inside the cache's
 * lifetime — where team and individual work sharing one prefix costs nothing.
 *
 * Exported so it can be tested without building a whole prompt, which is what makes the
 * cache-safety check above possible to state as an assertion.
 *
 * A team of one collapses to the individual wording. A cohort with an odd headcount produces
 * one-member teams routinely, and "do not single anybody out" is nonsense addressed to one person.
 */
export function addressBlock(context: SubmissionContext): string[] {
  const handles = context.addressees
    .map((addressee) => addressee.githubUsername)
    .filter((handle): handle is string => Boolean(handle));

  if (context.addressees.length <= 1) {
    const handle = handles[0];
    return [
      handle
        ? `Address the student as @${handle}.`
        : `The student has no GitHub username on record — address them as "you" without a handle.`,
    ];
  }

  const named =
    handles.length > 1
      ? `${handles
          .slice(0, -1)
          .map((handle) => `@${handle}`)
          .join(", ")} and @${handles[handles.length - 1]}`
      : handles.length === 1
        ? `@${handles[0]}`
        : "";

  const lines: string[] = [];

  lines.push(
    named
      ? `This is team work. ${named} share one repository and one submission, and every one of ` +
          `them receives this report.`
      : `This is team work. ${context.addressees.length} students share one repository and one ` +
          `submission, and every one of them receives this report.`,
  );
  lines.push(
    `Address them together: "you" is the team and "your code" is the team's code. Write in the ` +
      `second person plural.`,
  );
  /*
    The instruction that stops the report guessing. Commit authorship is a git config field, pair
    programming on one machine is ordinary here, and nothing in this prompt shows who wrote what —
    so a report crediting or blaming a member is an accusation built on nothing.
  */
  lines.push(
    `Do not attribute any part of the work to a particular member, and do not guess from commit ` +
      `history — you have not been shown who wrote what, and a report that credits or blames the ` +
      `wrong person is worse than one that names nobody.`,
  );
  /*
    Load-bearing. `rubricItems[].criterion` is free text, so a model told "four students" invents
    a row per member. Those rows still sum, so `crossCheck` passes them, and a per-member
    breakdown reaches the students under one shared score.
  */
  lines.push(
    `One score for the submission. It is recorded as the same grade for every member, so do not ` +
      `produce per-member scores and do not add rubric items naming a member.`,
  );

  if (handles.length < context.addressees.length) {
    lines.push(
      `Not every member has a GitHub handle on record. The handles above are the ones there are — ` +
        `address the team as a whole rather than naming who is missing.`,
    );
  }

  if (context.teamName) {
    lines.push(`They are working as "${context.teamName}".`);
  }

  return lines;
}

/**
 * The varying half. Everything here changes per submission, which is why it comes
 * after the cache breakpoint rather than before it.
 */
export function buildUserPrompt(params: {
  assets: GradingAssets;
  context: SubmissionContext;
}): string {
  const { assets, context } = params;
  const parts: string[] = [];

  parts.push(`# Submission: ${context.assignmentTitle}`);
  parts.push("");
  parts.push(...addressBlock(context));
  parts.push("");

  parts.push(
    `**This section is out of ${context.pointValue} points.** Set \`scorePossible\` ` +
      `to exactly ${context.pointValue} and make \`rubricItems\` sum to it. Do not ` +
      `derive your own scale from the number of questions — use this number. This is ` +
      `what this section alone is worth; other sections of this assignment are graded ` +
      `separately and are not your concern.`,
  );
  parts.push("");

  // The process note is a rule from agent-rules.md: work that did not come from a
  // `draft` branch gets a kind reminder at the end of the report.
  if (context.headBranch && context.headBranch !== "draft") {
    parts.push(
      `This submission's pull request comes from a branch named \`${context.headBranch}\` ` +
        `rather than \`draft\`. Put a short note about this in \`submissionProcessNote\`, ` +
        `reminding them to use a \`draft\` branch and a pull request next time. Do not ` +
        `deduct points for it.`,
    );
    parts.push("");
  }

  if (context.readme) {
    parts.push("---");
    parts.push("");
    parts.push("## The assignment instructions");
    parts.push("");
    parts.push("Copy any checklist items from here verbatim.");
    parts.push("");
    parts.push(context.readme);
    parts.push("");
  }

  if (assets.answerKeys.length > 0) {
    parts.push("---");
    parts.push("");
    parts.push("## Reference solution");
    parts.push("");
    parts.push(
      "For your reference only. **Never quote it, describe it, or reveal its contents " +
        "to the student** — a student's report must not hand them the answer. A correct " +
        "solution that differs from this one is still correct.",
    );
    parts.push("");
    for (const key of assets.answerKeys) {
      parts.push(fence(key.path, key.content));
    }
  }

  if (assets.answerKeys.length === 0) {
    parts.push(
      `Note: no reference solutions were available for this assignment. Grade against the ` +
        `rubric and the assignment instructions, and set \`confidence\` to \`"low"\` if their ` +
        `absence prevented you from assessing correctness.`,
    );
    parts.push("");
  }

  parts.push("---");
  parts.push("");
  parts.push("## The student's submission");
  parts.push("");
  if (context.studentFiles.length === 0) {
    parts.push("The pull request changed no files relevant to this section.");
    parts.push("");
  } else {
    for (const file of context.studentFiles) {
      parts.push(fence(file.path, file.content));
    }
  }

  // After the files, so the changes sit beside the work they describe, and before the test
  // results, which describe the work as it stands rather than what changed.
  if (context.previousReview) {
    parts.push(...previousReviewBlock(context.previousReview));
  }

  parts.push("---");
  parts.push("");
  parts.push("## Verified test results");
  parts.push("");

  if (context.testResults === null) {
    parts.push(
      "This section has no automated tests. Grade against the rubric, the assignment " +
        "instructions, and the reference solution. Leave `testClaims` empty.",
    );
  } else {
    const r = context.testResults;
    parts.push(
      `${r.passed} of ${r.total} passed, ${r.failed} failed, ${r.skipped} skipped. ` +
        `These are facts. Use the exact test names below in \`testClaims\`.`,
    );
    parts.push("");
    for (const test of r.tests) {
      const suite = test.suite ? `${test.suite} › ` : "";
      parts.push(`- **${test.status.toUpperCase()}** — ${suite}${test.name}`);
      if (test.failureMessage) {
        parts.push("");
        parts.push("  ```");
        parts.push(
          test.failureMessage
            .split("\n")
            .slice(0, 12)
            .map((line) => `  ${line}`)
            .join("\n"),
        );
        parts.push("  ```");
      }
    }
    parts.push("");
    parts.push(
      "Remember that passing every test does not by itself earn full marks. Read the " +
        "code for hardcoded return values, needless inefficiency, and style problems.",
    );
  }
  parts.push("");

  if (context.tamperedPaths.length > 0) {
    parts.push("---");
    parts.push("");
    parts.push("## Grading files were changed in this pull request");
    parts.push("");
    parts.push(
      `This pull request modified ${context.tamperedPaths.length} file(s) that ` +
        `hold grading infrastructure: ` +
        `${context.tamperedPaths.map((p) => `\`${p.path}\` (${p.kind})`).join(", ")}. ` +
        `The instructor's versions were restored before the suite ran, so the results ` +
        `above are unaffected.`,
    );
    parts.push("");
    parts.push(
      "Do not accuse anybody of anything and do not deduct points for it. An " +
        "instructor reviews this separately and will decide what it means — somebody " +
        "may have been experimenting, or may have edited a test by accident. Grade the " +
        "work as submitted and say nothing about it in the report.",
    );
    parts.push("");
  }

  parts.push("---");
  parts.push("");
  parts.push("Produce the report now.");

  return parts.join("\n");
}
