/**
 * Checks the grading logic that does not need a language model.
 *
 * Run with `npm run verify:grade`.
 *
 * The cross-check cases are the ones worth reading. The rule they encode is
 * asymmetric and a plausible-looking implementation gets it backwards: test results
 * are a fact the model must not contradict, and NOT the score. Withholding points
 * from code that passes every test is the judgment the model exists to make, so a
 * check comparing score against pass rate would flag exactly the behaviour we want.
 */
import {
  belongsToSection,
  classifySections,
  hasTestEvidence,
  partitionForPrompt,
  promptExclusionReason,
  resolveSectionTests,
  summarizeExclusions,
} from "../lib/grade/classify";
import { crossCheck, type Facts } from "../lib/grade/cross-check";
import { extractRubricSection } from "../lib/grade/assets";
import { gradingReportJsonSchema, parseGradingReport, REPORT_FLAGS } from "../lib/grade/schema";
import type { GradingReport } from "../lib/grade/schema";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else console.log(`ok   ${label}`);
}

/** A report that is internally consistent, so each case varies one thing. */
function report(overrides: Partial<GradingReport> = {}): GradingReport {
  return {
    reportMarkdown: "# Report",
    scoreEarned: 10,
    scorePossible: 12,
    rubricItems: [
      { label: "Q1", criterion: "algorithm", scoreEarned: 3, scorePossible: 3, note: null },
      { label: "Q1 style", criterion: "code_style", scoreEarned: 1, scorePossible: 1, note: null },
      { label: "Q2", criterion: "algorithm", scoreEarned: 5, scorePossible: 7, note: "off by one" },
      { label: "Q2 style", criterion: "code_style", scoreEarned: 1, scorePossible: 1, note: null },
    ],
    flags: [],
    instructorNotes: [],
    confidence: "high",
    submissionProcessNote: null,
    testClaims: [],
    ...overrides,
  };
}

const noFacts: Facts = { tests: null, tamperedPaths: [] };
const codes = (r: ReturnType<typeof crossCheck>) => r.findings.map((f) => f.code).sort();

// --- classification -------------------------------------------------------
const declared = [
  { type: "coding_algorithm" as const },
  { type: "short_response" as const },
];

check("algorithm files under src/ with jest classify as algorithm",
  classifySections({ changedPaths: ["src/from-scratch.js"], declaredSections: declared, hasJest: true }),
  { present: ["coding_algorithm"], notSubmitted: ["short_response"], unexpected: [], unclassified: [] });

check("short-response.md classifies regardless of location",
  classifySections({ changedPaths: ["src/short-response.md"], declaredSections: declared, hasJest: true }),
  { present: ["short_response"], notSubmitted: ["coding_algorithm"], unexpected: [], unclassified: [] });

// A real assignment shipped SHORT_RESPONSE.MD and its section was silently never
// graded, because the rule wanted a literal hyphen. Which separator an author chose
// has nothing to do with grading, so every spelling of the same filename matches.
for (const path of [
  "SHORT_RESPONSE.MD",
  "short_response.md",
  "Short-Response.md",
  "src/SHORT_RESPONSE.md",
  "shortresponse.md",
  "short response.md",
  "short.response.md",
]) {
  check(`${path} is a short response`,
    classifySections({ changedPaths: [path], declaredSections: declared, hasJest: true }).present,
    ["short_response"]);
}

// Not every filename containing both words. A separator is one character or none, so
// a different word entirely is still a different word.
check("shortXresponse.md is not a short response",
  classifySections({
    changedPaths: ["shortXresponse.md"],
    declaredSections: declared, hasJest: true }).present, []);
check("short-response-notes.md is not the submission file",
  classifySections({
    changedPaths: ["short-response-notes.md"],
    declaredSections: declared, hasJest: true }).present, []);

check("a blended pull request reports both present",
  classifySections({
    changedPaths: ["src/from-scratch.js", "short-response.md"],
    declaredSections: declared, hasJest: true }),
  { present: ["coding_algorithm", "short_response"], notSubmitted: [], unexpected: [], unclassified: [] });

check("nested src files are frontend, not algorithm",
  classifySections({
    changedPaths: ["src/components/Card.js"],
    declaredSections: [{ type: "coding_frontend" }], hasJest: true }),
  { present: ["coding_frontend"], notSubmitted: [], unexpected: [], unclassified: [] });

// A real submission classified as nothing before this was handled: a flat src/*.js
// file in a frontend assignment with no Jest suite matched no rule at all.
check("a flat src file without jest is frontend, not nothing",
  classifySections({
    changedPaths: ["src/RecipeCollection.js"],
    declaredSections: [{ type: "coding_frontend" }, { type: "short_response" }], hasJest: false }),
  { present: ["coding_frontend"], notSubmitted: ["short_response"], unexpected: [], unclassified: [] });

// The same path with a Jest suite present is an algorithm exercise. hasJest is what
// makes the distinction, not how deeply the file is nested.
check("the same flat src file WITH jest is an algorithm exercise",
  classifySections({
    changedPaths: ["src/RecipeCollection.js"],
    declaredSections: [{ type: "coding_algorithm" }], hasJest: true }),
  { present: ["coding_algorithm"], notSubmitted: [], unexpected: [], unclassified: [] });

check("an undeclared section is reported as unexpected",
  classifySections({
    changedPaths: ["queries.sql"],
    declaredSections: [{ type: "short_response" }], hasJest: false }),
  { present: [], notSubmitted: ["short_response"], unexpected: ["coding_sql"], unclassified: [] });

// The template decides which rubric applies, never the student's own package.json.
// An assignment declaring only coding_algorithm whose template has no Jest suite is
// misconfigured, and the mismatch surfaces as `unexpected` — which routes the whole
// submission to manual review. Better than silently grading nothing.
check("without jest, a src file is frontend and the mismatch is surfaced",
  classifySections({
    changedPaths: ["src/main.js"],
    declaredSections: [{ type: "coding_algorithm" }], hasJest: false }),
  { present: [], notSubmitted: ["coding_algorithm"], unexpected: ["coding_frontend"], unclassified: [] });

check("test and config churn implies no section",
  classifySections({
    changedPaths: ["tests/a.spec.js", "package.json", "scores/scores.json", "README.md"],
    declaredSections: declared, hasJest: true }),
  { present: [], notSubmitted: ["coding_algorithm", "short_response"], unexpected: [], unclassified: [] });

// The general form of the SHORT_RESPONSE.MD mistake. A file the matcher does not
// recognize leaves the section in notSubmitted, which reads exactly like a student who
// skipped the work. Naming the leftovers is what distinguishes the two, so any future
// filename an assignment invents surfaces as a filename problem.
check("a changed file matching no rule is named, not silently dropped",
  classifySections({
    changedPaths: ["SHORT-ANSWERS.md", "notes.txt"],
    declaredSections: [{ type: "short_response" }], hasJest: false }),
  { present: [], notSubmitted: ["short_response"], unexpected: [],
    unclassified: ["SHORT-ANSWERS.md", "notes.txt"] });

// Files that are never student work stay out of it, or every submission would list
// its own package.json as a mystery.
check("ignorable churn is not reported as unclassified",
  classifySections({
    changedPaths: ["package.json", "README.md", "tests/a.spec.js"],
    declaredSections: [{ type: "short_response" }], hasJest: true }).unclassified, []);

// Detecting a section and deciding which files to send when grading it were two
// separate copies of the same patterns, and they drifted: SHORT_RESPONSE.MD classified
// as a short response while the file-selection copy still demanded a hyphen and
// filtered it out. The section was graded 0/15 for being empty with the work sitting
// right there. So: anything recognized as a section must also be sent for it.
for (const path of ["SHORT_RESPONSE.MD", "short_response.md", "src/short-response.md"]) {
  const present = classifySections({
    changedPaths: [path],
    declaredSections: [{ type: "short_response" }], hasJest: false,
  }).present;
  check(`${path} is both detected and sent`,
    [present, belongsToSection(path, "short_response")],
    [["short_response"], true]);
  // And never sent as frontend as well, or the same answers would be graded twice
  // against two different rubrics.
  check(`${path} is not also frontend content`,
    belongsToSection(path, "coding_frontend"), false);
}

// --- what may reach the model ---------------------------------------------
//
// The student's files come from the pull request's own diff, so a path is only here
// because the student committed it. Some of them must never be sent, and the disclosure
// case is the one with no way back: a committed `.env` sent to a third party is in that
// third party's logs permanently.
for (const [path, reason] of [
  [".env", "environment file"],
  [".env.local", "environment file"],
  ["config/.env.production", "environment file"],
  // A decision rather than a side effect of the pattern. The curriculum commits sixteen
  // of these, none is student work, and it is where a student who has not understood the
  // distinction pastes real credentials.
  ["server/.env.template", "environment file"],
  ["server/private.pem", "credential file"],
  ["node_modules/lodash/index.js", "dependency tree"],
  ["src/madlib-challenge/node_modules/prompt-sync/index.js", "dependency tree"],
  ["package-lock.json", "lockfile"],
  ["dist/bundle.js", "build output"],
  ["src/app.min.js", "build output"],
  ["coverage/lcov-report/index.html", "coverage output"],
  ["npm-debug.log", "log file"],
  [".DS_Store", "editor or system file"],
  ["__pycache__/solution.pyc", "compiled artifact"],
] as const) {
  check(`${path} is withheld as a ${reason}`, promptExclusionReason(path), reason);
}

// The list has to be narrow enough that ordinary work passes through it, and these are
// the paths every real submission is made of. A false positive here is a section graded
// against a prompt with the student's work missing from it.
for (const path of [
  "src/from-scratch.js",
  "src/debug.js",
  "short-response.md",
  "src/components/Card.jsx",
  "server/index.js",
  "queries.sql",
  "index.html",
  "styles/main.css",
  "src/utils/environment.js",
  "src/build-tree.js",
  "src/outline.ts",
  "src/distance.js",
  "solution.py",
]) {
  check(`${path} is ordinary student work`, promptExclusionReason(path), null);
}

// The two names that make the "never a deliverable" test earn its keep. A template in
// this curriculum gitignores `server/` because students build the backend from scratch,
// and `src/build-tree.js` sits one substring away from a build directory — so the filter
// matches directories as directories rather than anywhere a word appears.
check("a deliberately withheld deliverable is sent, not filtered",
  [promptExclusionReason("server/index.js"), promptExclusionReason("server/routes/events.js")],
  [null, null]);

check("the partition keeps work and names what it withheld",
  partitionForPrompt(["src/from-scratch.js", ".env", "node_modules/a/index.js", "short-response.md"]),
  {
    included: ["src/from-scratch.js", "short-response.md"],
    excluded: [
      { path: ".env", reason: "environment file" },
      { path: "node_modules/a/index.js", reason: "dependency tree" },
    ],
  });

check("nothing withheld records nothing", summarizeExclusions([]), null);

// Counts and one example rather than the raw list: a committed dependency tree is
// thousands of paths, and writing all of them into modelMetadata would make the column
// unreadable to store a fact two numbers convey.
check("exclusions are summarized by reason",
  summarizeExclusions([
    { path: ".env", reason: "environment file" },
    { path: "node_modules/a/index.js", reason: "dependency tree" },
    { path: "node_modules/b/index.js", reason: "dependency tree" },
  ]),
  {
    count: 3,
    byReason: { "environment file": 1, "dependency tree": 2 },
    examples: [".env", "node_modules/a/index.js", "node_modules/b/index.js"],
  });

check("evidence:tests is required for test evidence", hasTestEvidence({ type: "x", evidence: "tests" }), true);
check("a section without evidence has none", hasTestEvidence({ type: "x" }), false);

// Four outcomes, not two. A frontend assignment with no suite and an algorithm section
// whose tests never ran both used to be flagged NO_TEST_EVIDENCE, which made a fault
// look exactly like the ordinary case.
const someTests = [
  { suite: "From Scratch Tests", name: "loop5to10 works", status: "passed" as const },
  { suite: "Debug Tests", name: "brokenNested works", status: "failed" as const },
];
check("a section with no evidence declared expects no tests",
  resolveSectionTests({ type: "coding_frontend" }, someTests).kind, "not-expected");
check("tests expected with no run at all is a fault",
  resolveSectionTests({ type: "coding_algorithm", evidence: "tests" }, []).kind, "run-missing");
check("tests expected and present is evidence",
  resolveSectionTests({ type: "coding_algorithm", evidence: "tests" }, someTests).kind, "results");
check("a pattern that matches nothing is a fault, not an empty suite",
  resolveSectionTests(
    { type: "coding_algorithm", evidence: "tests", testNamePattern: "^Nothing Matches" },
    someTests,
  ).kind, "pattern-matched-nothing");
check("a pattern that matches some tests narrows to them",
  resolveSectionTests(
    { type: "coding_algorithm", evidence: "tests", testNamePattern: "Debug" },
    someTests,
  ),
  { kind: "results", results: { total: 1, passed: 0, failed: 1, skipped: 0,
    tests: [someTests[1]] } });

// --- cross-check: arithmetic ----------------------------------------------
check("a consistent report with no facts passes", crossCheck(report(), noFacts).needsManualReview, false);

check("items not summing to the score is caught",
  codes(crossCheck(report({ scoreEarned: 11 }), noFacts)), ["ARITHMETIC_MISMATCH"]);
check("a possible-total mismatch is caught",
  codes(crossCheck(report({ scorePossible: 15 }), noFacts)), ["ARITHMETIC_MISMATCH"]);
check("earning more than possible is caught",
  codes(crossCheck(report({
    scoreEarned: 13, scorePossible: 12,
    rubricItems: [{ label: "x", criterion: "a", scoreEarned: 13, scorePossible: 12, note: null }],
  }), noFacts)), ["SCORE_OUT_OF_RANGE"]);
check("half credit is accepted",
  crossCheck(report({
    scoreEarned: 5.5, scorePossible: 6,
    rubricItems: [{ label: "x", criterion: "checklist", scoreEarned: 5.5, scorePossible: 6, note: null }],
  }), noFacts).needsManualReview, false);

// Approving a draft posts its markdown to the pull request, so a staff label left in
// the text is delivered to the student with no way to take it back. The prompt forbids
// it; this is the guard that does not depend on the model complying.
check("a staff flag left in the report text is caught",
  codes(crossCheck(report({
    reportMarkdown: "# Report\n\n**FLAG: MECHANICAL ERRORS**\n\nNice work.",
  }), noFacts)), ["INTERNAL_LABEL_IN_REPORT"]);
check("the flag recorded in the flags array is not itself a problem",
  crossCheck(report({ flags: ["MECHANICAL"] }), noFacts).needsManualReview, false);
// Ordinary prose that happens to contain the word must not trip it.
check("the word flag in a normal sentence is fine",
  crossCheck(report({
    reportMarkdown: "# Report\n\nYour code does not flag: invalid input goes unchecked.",
  }), noFacts).needsManualReview, false);

// The markdown a student reads against the number the gradebook records. A real
// generation wrote "8/15" in its prose while its rubric items summed to 10, so these
// can disagree, and no other check compares them.
check("a report whose text contradicts its recorded score is caught",
  codes(crossCheck(report({
    reportMarkdown: "# Short Response Score Report\n\n## Short Response Score: 8/12 = 67%",
  }), noFacts)), ["REPORT_TEXT_SCORE_MISMATCH"]);
check("matching text and recorded score passes",
  crossCheck(report({
    reportMarkdown: "## Coding Fluency Score: 10/12 = 83%",
  }), noFacts).needsManualReview, false);
// Percentages, half credit, and reports with no score line at all must not trip it.
check("a half-credit score in the text is matched, not rounded",
  crossCheck(report({
    scoreEarned: 5.5, scorePossible: 6,
    rubricItems: [{ label: "x", criterion: "checklist", scoreEarned: 5.5, scorePossible: 6, note: null }],
    reportMarkdown: "## Score: 5.5/6 = 92%",
  }), noFacts).needsManualReview, false);
check("a report with no score heading is not flagged",
  crossCheck(report({ reportMarkdown: "# Report\n\nNo score line here." }), noFacts)
    .needsManualReview, false);

// --- cross-check: claims about test outcomes ------------------------------
const runTests = [
  { suite: "From Scratch Tests", name: "loop5to10 works", status: "passed" as const },
  { suite: "From Scratch Tests", name: "fizzbuzz works", status: "failed" as const },
];
const withTests: Facts = { tests: runTests, tamperedPaths: [] };

check("a claim matching the run passes",
  crossCheck(report({ testClaims: [{ testName: "fizzbuzz works", claimedStatus: "failed" }] }),
    withTests).needsManualReview, false);

check("claiming a failed test passed is a contradiction",
  codes(crossCheck(report({ testClaims: [{ testName: "fizzbuzz works", claimedStatus: "passed" }] }),
    withTests)), ["TEST_CLAIM_CONTRADICTION"]);

// The prompt shows tests as "Suite › name", so a model echoing that back must match.
// Before this was handled, every correct claim was reported as an unknown test.
check("a claim using the qualified Suite \u203a name form matches",
  crossCheck(report({ testClaims: [{ testName: "From Scratch Tests \u203a fizzbuzz works", claimedStatus: "failed" }] }),
    withTests).needsManualReview, false);
check("the qualified form still catches a contradiction",
  codes(crossCheck(report({ testClaims: [{ testName: "From Scratch Tests \u203a fizzbuzz works", claimedStatus: "passed" }] }),
    withTests)), ["TEST_CLAIM_CONTRADICTION"]);
check("case and whitespace differences do not break matching",
  crossCheck(report({ testClaims: [{ testName: "  FROM SCRATCH TESTS \u203a  Fizzbuzz   Works ", claimedStatus: "failed" }] }),
    withTests).needsManualReview, false);

check("a claim about a test that did not run is caught",
  codes(crossCheck(report({ testClaims: [{ testName: "invented test", claimedStatus: "passed" }] }),
    withTests)), ["UNKNOWN_TEST_CLAIMED"]);

check("full marks while a test failed is a contradiction",
  codes(crossCheck(report({
    scoreEarned: 12, scorePossible: 12,
    rubricItems: [{ label: "x", criterion: "algorithm", scoreEarned: 12, scorePossible: 12, note: null }],
  }), withTests)), ["FULL_CREDIT_DESPITE_FAILURES"]);

// THE case. Every test passed and the model withheld points anyway — hardcoded
// values, inefficiency, style. This must NOT be flagged; a check comparing score
// against pass rate would flag it, which is why no such check exists.
const allPassed: Facts = {
  tests: [
    { suite: "S", name: "a", status: "passed" },
    { suite: "S", name: "b", status: "passed" },
  ],
  tamperedPaths: [],
};
check("withholding points despite a 100% pass rate is LEGITIMATE",
  crossCheck(report({
    scoreEarned: 6, scorePossible: 12,
    rubricItems: [{ label: "hardcoded", criterion: "algorithm", scoreEarned: 6, scorePossible: 12, note: "returns literals" }],
    testClaims: [
      { testName: "a", claimedStatus: "passed" },
      { testName: "b", claimedStatus: "passed" },
    ],
  }), allPassed),
  { findings: [], needsManualReview: false });

// --- cross-check: facts that route regardless -----------------------------
check("a changed protected path always routes to review",
  codes(crossCheck(report(), { tests: null, tamperedPaths: [{ path: "tests/a.spec.js", kind: "modified" }] })),
  ["PROTECTED_PATHS_CHANGED"]);
/*
  Low confidence is recorded and does NOT hold the draft back.

  It is the honest answer for a section with no suite to check against — short response
  and frontend work, most of the curriculum — so gating on it marked nearly everything as
  exceptional and taught the instructor to ignore the marking. It is a badge on the
  section instead.

  Both halves are asserted together on purpose: the finding must still be produced, and it
  must not gate. Sound only because nothing is ever sent without approval; if automatic
  approval is ever built, this has to gate again.
*/
/*
  Confidence produces no finding. It is a column on the section and a pill on the review screen,
  and low confidence on work with no suite to check against is the ordinary condition of most of
  this curriculum — treating it as a fault would hold back almost every short response section.
*/
check("low confidence is not a finding",
  codes(crossCheck(report({ confidence: "low" }), noFacts)), []);
check("...so it does not hold a draft back",
  crossCheck(report({ confidence: "low" }), noFacts).needsManualReview, false);
check("...while a real fault beside it does",
  crossCheck(report({ confidence: "low", scoreEarned: 99 }), noFacts).needsManualReview, true);

// --- schema ---------------------------------------------------------------
const schema = gradingReportJsonSchema();
check("the derived schema has no $schema declaration", "$schema" in schema, false);
check("the derived schema forbids extra properties", schema.additionalProperties, false);
// Constraints Claude's structured output rejects must not appear anywhere.
const serialized = JSON.stringify(schema);
check("no numeric constraints in the schema",
  ["minimum", "maximum", "exclusiveMinimum", "multipleOf"].filter((k) => serialized.includes(`"${k}"`)), []);
check("no string length constraints in the schema",
  ["minLength", "maxLength"].filter((k) => serialized.includes(`"${k}"`)), []);

let validationThrew = "";
try {
  parseGradingReport({ reportMarkdown: "x" });
} catch (e) {
  validationThrew = e instanceof Error ? e.name : String(e);
}
check("an incomplete report fails validation", validationThrew, "ReportValidationError");
check("a complete report validates", parseGradingReport(report()).scoreEarned, 10);

// Given `flags` as an unconstrained string array and no description, a real model
// used it as a notes field and wrote whole sentences into it. Every entry is rendered
// as a short badge, so that broke the interface and buried the codes. Prose now has
// somewhere to go, and the flag vocabulary is closed so it cannot land here again.
let prosePlacementThrew = "";
try {
  parseGradingReport(report({ flags: ["The file I needed was not submitted."] as never }));
} catch (e) {
  prosePlacementThrew = e instanceof Error ? e.name : String(e);
}
check("prose in flags is rejected", prosePlacementThrew, "ReportValidationError");
check("every flag in the vocabulary is accepted",
  parseGradingReport(report({ flags: [...REPORT_FLAGS] })).flags.length, REPORT_FLAGS.length);
check("several flags on one section are accepted",
  parseGradingReport(report({ flags: ["INCOMPLETE", "CLARITY"] })).flags,
  ["INCOMPLETE", "CLARITY"]);
// The rename is the kind of change that leaves one stale reference behind.
let retiredFlagThrew = "";
try {
  parseGradingReport(report({ flags: ["MECHANICAL_ERRORS"] as never }));
} catch (e) {
  retiredFlagThrew = e instanceof Error ? e.name : String(e);
}
check("the retired MECHANICAL_ERRORS spelling is rejected",
  retiredFlagThrew, "ReportValidationError");
check("prose belongs in instructorNotes",
  parseGradingReport(report({ instructorNotes: ["The point value does not divide evenly."] }))
    .instructorNotes.length, 1);

// --- rubric slicing ------------------------------------------------------
const rubric = [
  "# Grading Rubric",
  "## SHORT RESPONSE",
  "short response body",
  "## CODING — ALGORITHM FLUENCY",
  "algorithm body",
  "## CODING — SQL FLUENCY",
  "sql body",
].join("\n");
check("a rubric section is sliced at the next heading",
  extractRubricSection(rubric, "CODING — ALGORITHM FLUENCY"),
  "## CODING — ALGORITHM FLUENCY\nalgorithm body");
let rubricThrew = "";
try {
  extractRubricSection(rubric, "NO SUCH SECTION");
} catch (e) {
  rubricThrew = e instanceof Error ? e.name : String(e);
}
check("a missing rubric section throws", rubricThrew, "GradingAssetsError");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
