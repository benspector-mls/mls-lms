/**
 * Checks the rules that decide what a valid assignment is.
 *
 *   npm run verify:authoring
 *
 * Pure: no database, no network, no model. Every check here is a rule that, if it
 * silently stopped holding, would produce a confidently wrong grade rather than an
 * error — a section with no point value, a test pattern that matches nothing, a
 * repository-backed assignment with no repository. Those are the expensive failures,
 * and they are all cheap to check as functions.
 *
 * The second half is not pure: it drives the tRPC callers against the real database,
 * because authorization is half of what the authoring procedures are and a check that only
 * holds when called through the interface is not a check. Every write it makes happens
 * inside a transaction that is rolled back, so it is safe against live data.
 */
import { createChecker, loadEnvironment } from "./verify/harness";

loadEnvironment();

const { check, skip, finish } = createChecker();
import {
  AssignmentConfigurationError,
  AssignmentKind,
  IMPLEMENTED_KINDS,
  assertKindImplemented,
  copyUrlFromTemplate,
  derivesTestEvidence,
  handInMethodsFor,
  hasAcceptStep,
  isAiGraded,
  isManualOnly,
  manualSections,
  NotRepositoryBackedError,
  parseAssignmentSpec,
  repositorySource,
  requiresRepository,
  sectionsPointTotal,
  UnsupportedAssignmentKindError,
  withDerivedFields,
} from "../lib/assignments/spec";

/**
 * What a parse rejected, by field, so a check names the field and not just "threw".
 *
 * An unrecognised key is reported by Zod against the *object* rather than the key, which
 * would make "a manual section may not carry a rubric" and "...may not carry answer keys"
 * indistinguishable — both would read `sections.0`. The offending keys are appended so each
 * check proves the specific field was the one refused.
 */
/**
 * Whether a parse refused, and named this field among its reasons.
 *
 * For the checks where the exact list is beside the point. An AI section handed to a kind that
 * only takes manual ones is refused several times over — the wrong `grading`, the missing
 * `label`, and five keys the shape does not recognise — and pinning all of that down would
 * make the check about the shape of the error rather than about the rule.
 */
function refusedOn(input: unknown, path: string): boolean {
  const result = rejects(input);
  return result !== "accepted" && result.some((entry) => entry.startsWith(path));
}

function rejects(input: unknown): string[] | "accepted" {
  try {
    parseAssignmentSpec(input);
    return "accepted";
  } catch (err) {
    const issues = (
      err as {
        issues?: { path: (string | number)[]; code?: string; keys?: string[] }[];
      }
    ).issues;
    if (!issues) return [(err as Error).name];
    return issues.map((issue) => {
      const path = issue.path.join(".") || "(root)";
      return issue.keys?.length ? `${path}:${issue.keys.join(",")}` : path;
    });
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : String(err);
}

const RUBRIC = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const codingSection = {
  grading: "ai",
  type: "coding_algorithm",
  pointValue: 30,
  rubricId: RUBRIC,

  reportTemplate: "coding-fluency",
  evidence: "tests",
} as const;

const manualSection = { grading: "manual", label: "Reflection", pointValue: 10 } as const;

const repoSpec = {
  kind: AssignmentKind.REPO,
  title: "swe-1-4-loops",
  courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
  answerKeyRepo: "The-Marcy-Lab-School/swe-assignment-grading-guides",
  answerKeyDir: "answer-keys/mod-1-js-fundamentals/swe-1-4-loops",
  templateRepo: "marcy-lms/swe-1-4-loops",
  assignmentRepoName: "swe-1-4-loops",
  githubOrg: "marcy-lms",
  runnerPreset: "node-jest",
  sections: [codingSection],
};

// --- the two repositories an assignment names ---------------------------------
//
// Normalized by the schema rather than by the form, so every caller stores one shape. Checked
// here because it is the only place a URL becomes a column value: if this stopped happening,
// the form would keep looking right and the column would hold a URL that no GitHub request
// could be built from.
check(
  "a pasted template URL is stored as owner/repo",
  parseAssignmentSpec({
    ...repoSpec,
    templateRepo: "https://github.com/marcy-lms/swe-1-4-loops/tree/main",
  }).templateRepo,
  "marcy-lms/swe-1-4-loops",
);
check(
  "a pasted answer key URL is too",
  parseAssignmentSpec({
    ...repoSpec,
    answerKeyRepo: "https://github.com/The-Marcy-Lab-School/swe-assignment-grading-guides.git",
  }).answerKeyRepo,
  "The-Marcy-Lab-School/swe-assignment-grading-guides",
);
check(
  "a repository assignment must name an answer key repository",
  rejects({ ...repoSpec, answerKeyRepo: undefined }),
  ["answerKeyRepo"],
);
check(
  "something that is not a repository reference is refused",
  rejects({ ...repoSpec, answerKeyRepo: "just some words" }),
  ["answerKeyRepo"],
);
check(
  "a kind with no repository may not name an answer key repository",
  rejects({
    kind: AssignmentKind.GOOGLE_DRIVE,
    title: "Story Prep Worksheet",
    courseUnitId: repoSpec.courseUnitId,
    templateDriveUrl: "https://docs.google.com/document/d/abc123/view",
    answerKeyRepo: "The-Marcy-Lab-School/swe-assignment-grading-guides",
    sections: [manualSection],
  }),
  ["answerKeyRepo"],
);
/*
  The folder, at any depth, and the root.

  Any depth because a private repository an instructor made this morning is arranged however
  they like — the `answer-keys/` prefix in the existing data is a directory in one repository,
  not a rule. The root because a repository holding a single assignment's solutions and nothing
  else needs no subdirectory, and `""` has to mean that rather than "unset".
*/
check(
  "an answer key folder may be at any depth",
  rejects({ ...repoSpec, answerKeyDir: "solutions/2026/spring/mod1" }),
  "accepted",
);
check(
  "the repository root is a legitimate answer key folder",
  rejects({ ...repoSpec, answerKeyDir: "" }),
  "accepted",
);
check(
  "and it is the default, so a repository of one assignment's keys needs nothing else",
  parseAssignmentSpec({ ...repoSpec, answerKeyDir: undefined }).answerKeyDir,
  "",
);
// The column is interpolated into a GitHub contents URL, so a traversal is refused where it is
// written rather than only where it is read.
check(
  "a folder escaping the repository is refused",
  rejects({ ...repoSpec, answerKeyDir: "../../../etc" }),
  ["answerKeyDir"],
);
check(
  "...including one that only climbs out halfway through",
  rejects({ ...repoSpec, answerKeyDir: "answer-keys/../../etc" }),
  ["answerKeyDir"],
);
check("an absolute path is refused", rejects({ ...repoSpec, answerKeyDir: "/etc/passwd" }), [
  "answerKeyDir",
]);
check(
  "a kind with no repository may not name an answer key folder",
  rejects({
    kind: AssignmentKind.GOOGLE_DRIVE,
    title: "Story Prep Worksheet",
    courseUnitId: repoSpec.courseUnitId,
    templateDriveUrl: "https://docs.google.com/document/d/abc123/view",
    answerKeyDir: "answer-keys/whatever",
    sections: [manualSection],
  }),
  ["answerKeyDir"],
);
// Sections no longer name files at all, so one that tries is refused by `.strict()`. That is
// what makes a stale ticked list impossible rather than merely discouraged.
check(
  "a section may not name answer key files",
  rejects({
    ...repoSpec,
    sections: [{ ...codingSection, answerKeyPaths: ["a/b.js"] }],
  }),
  ["sections.0:answerKeyPaths"],
);

// --- the total is derived, never entered --------------------------------------
check("pointValue is the sum of the sections", parseAssignmentSpec(repoSpec).pointValue, 30);
check("two sections sum", sectionsPointTotal([{ pointValue: 15 }, { pointValue: 25 }]), 40);
check(
  "a pointValue on the assignment is refused outright",
  rejects({ ...repoSpec, pointValue: 999 }),
  ["(root):pointValue"],
);
check(
  "a section with no point value is refused",
  rejects({
    ...repoSpec,
    sections: [{ grading: "ai", type: "coding_algorithm", rubricId: RUBRIC }],
  }),
  ["sections.0.pointValue"],
);
check(
  "a zero-point section is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, pointValue: 0 }] }),
  ["sections.0.pointValue"],
);
check("an assignment with no sections is refused", rejects({ ...repoSpec, sections: [] }), [
  "sections",
]);

// --- sections describe something a rubric covers ------------------------------
check(
  "an unknown section type is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, type: "coding_python" }] }),
  ["sections.0.type"],
);
check(
  "a section with no rubric is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, rubricId: undefined }] }),
  ["sections.0.rubricId"],
);
/*
  A pattern with no `evidence: "tests"` is silently ignored, so the section is graded
  with no test evidence at all — the opposite of what naming a pattern means. This is
  the class of mistake the whole module exists for: nothing throws, and the report
  reads as though the tests were consulted.
*/
check(
  "a testNamePattern without evidence:tests is refused",
  rejects({
    ...repoSpec,
    sections: [{ ...codingSection, evidence: undefined, testNamePattern: "^from-scratch" }],
  }),
  ["sections.0.testNamePattern"],
);
check(
  "a testNamePattern with evidence:tests is accepted",
  rejects({ ...repoSpec, sections: [{ ...codingSection, testNamePattern: "^from-scratch" }] }),
  "accepted",
);

// --- how a section is graded --------------------------------------------------
/*
  The two section shapes are deliberately not one shape with optional fields. A manual
  section that could carry a rubricId would eventually carry one that nothing applies, and
  an AI section that could omit its rubric would reach the model with nothing to score
  against. Each check below is one of those two mistakes being refused.
*/
check(
  "a section must say how it is graded",
  rejects({ ...repoSpec, sections: [{ ...codingSection, grading: undefined }] }),
  ["sections.0.grading"],
);
check(
  "a manual section is accepted with just a label and points",
  rejects({ ...repoSpec, sections: [manualSection] }),
  "accepted",
);
check(
  "a manual section may not carry a rubric",
  rejects({ ...repoSpec, sections: [{ ...manualSection, rubricId: RUBRIC }] }),
  ["sections.0:rubricId"],
);
check(
  "a manual section may not carry answer keys",
  rejects({ ...repoSpec, sections: [{ ...manualSection, rubricId: RUBRIC }] }),
  ["sections.0:rubricId"],
);
check(
  "a manual section may not claim test evidence",
  rejects({ ...repoSpec, sections: [{ ...manualSection, evidence: "tests" }] }),
  ["sections.0:evidence"],
);
check(
  "a manual section needs a label",
  rejects({ ...repoSpec, sections: [{ grading: "manual", pointValue: 10 }] }),
  ["sections.0.label"],
);
check(
  "a manual section still needs a point value",
  rejects({ ...repoSpec, sections: [{ grading: "manual", label: "Reflection" }] }),
  ["sections.0.pointValue"],
);
check(
  "an AI section may not use a label instead of a type",
  rejects({ ...repoSpec, sections: [{ ...codingSection, label: "Whatever" }] }),
  ["sections.0:label"],
);

/*
  One grading mode per assignment. A mix would mean a generated report covering some sections
  and not others: the draft carries only what the model wrote, so the assignment's point total
  would exceed what approving could record, and a 30-point assignment would release as 20 out
  of 20. Two assignments is the answer, and one section per assignment is the direction the
  curriculum is going anyway.

  Several sections graded the same way stay legitimate — the checkpoint has two, both graded
  by the pipeline — so the check below is about modes, not about counting.
*/
check(
  "an assignment may not mix graded-by-model and graded-by-hand sections",
  rejects({ ...repoSpec, sections: [codingSection, manualSection] }),
  ["sections"],
);
check(
  "several sections graded the same way are accepted, and both count toward the total",
  parseAssignmentSpec({
    ...repoSpec,
    sections: [codingSection, { ...codingSection, type: "short_response", pointValue: 15 }],
  }).pointValue,
  45,
);
check(
  "isAiGraded reads the mode off each section",
  parseAssignmentSpec({ ...repoSpec, sections: [codingSection] }).sections.map(isAiGraded),
  [true],
);
check("manual-only is detected", isManualOnly([manualSection]), true);
check("all-AI is not manual-only", isManualOnly([codingSection]), false);
check("no sections is not manual-only", isManualOnly([]), false);
check("a stored column that is not an array is not manual-only", isManualOnly(null), false);

/*
  A section graded by hand, read back off a stored column in the shape the blank draft needs.
  Skipped rather than defaulted when a point value is missing: scoring out of an invented total
  is exactly what `pointValue` being required exists to prevent.
*/
check(
  "manual sections are read for the blank draft",
  manualSections([codingSection, manualSection]),
  [{ label: "Reflection", pointValue: 10 }],
);
check(
  "a manual section with no point value is skipped rather than defaulted",
  manualSections([{ grading: "manual", label: "Reflection" }]),
  [],
);

// --- test evidence is derived, never asked -------------------------------------
/*
  The rule has no cases an instructor could usefully disagree with, which is why the checkbox
  that used to ask went away. A short response has nothing to execute; every other type is
  checked against the suite when the assignment has one.
*/
check(
  "a short response never claims test evidence",
  derivesTestEvidence("short_response", "node-jest"),
  false,
);
check(
  "an algorithm section does when there is a runner",
  derivesTestEvidence("coding_algorithm", "node-jest"),
  true,
);
check("...and does not when there is none", derivesTestEvidence("coding_algorithm", "none"), false);
check(
  "a frontend section follows the same rule",
  derivesTestEvidence("coding_frontend", "node-vitest"),
  true,
);

check(
  "a draft that omits evidence has it filled in",
  (
    withDerivedFields({
      runnerPreset: "node-jest",
      sections: [{ ...codingSection, evidence: undefined }],
    }) as { sections: { evidence?: string }[] }
  ).sections[0].evidence,
  "tests",
);
check(
  "a draft that wrongly claims it has it removed",
  (
    withDerivedFields({ runnerPreset: "none", sections: [{ ...codingSection }] }) as {
      sections: { evidence?: string }[];
    }
  ).sections[0].evidence,
  undefined,
);
/*
  A pattern with no evidence declaration is refused by the schema. Clearing it alongside the
  flag means an author who turns the runner off does not then face a validation error about a
  field the form no longer shows.
*/
check(
  "a stranded testNamePattern is cleared rather than left to fail validation",
  (
    withDerivedFields({
      runnerPreset: "none",
      sections: [{ ...codingSection, testNamePattern: "^from-scratch" }],
    }) as { sections: { testNamePattern?: string }[] }
  ).sections[0].testNamePattern,
  undefined,
);
// The raw draft would be refused for exactly that stranded pattern; the derived one passes.
check(
  "...so the raw draft is refused",
  rejects({
    ...repoSpec,
    runnerPreset: "none",
    sections: [{ ...codingSection, evidence: undefined, testNamePattern: "^from-scratch" }],
  }),
  ["sections.0.testNamePattern"],
);
check(
  "...and the derived draft is accepted",
  rejects(
    withDerivedFields({
      ...repoSpec,
      runnerPreset: "none",
      sections: [{ ...codingSection, testNamePattern: "^from-scratch" }],
    }),
  ),
  "accepted",
);

// --- the kind axis ------------------------------------------------------------
check("REPO requires a template repository", rejects({ ...repoSpec, templateRepo: undefined }), [
  "templateRepo",
]);
check("REPO requires an org", rejects({ ...repoSpec, githubOrg: undefined }), ["githubOrg"]);
check(
  "a templateRepo that is not owner/repo is refused",
  rejects({ ...repoSpec, templateRepo: "swe-1-4-loops" }),
  ["templateRepo"],
);
check(
  "a repo name with a slash in it is refused",
  rejects({ ...repoSpec, assignmentRepoName: "a/b" }),
  ["assignmentRepoName"],
);
check(
  "an unknown runner preset is refused, and the message names it",
  rejects({ ...repoSpec, runnerPreset: "npx-jest-typo" }),
  ["runnerPreset"],
);
check("the none preset is accepted", rejects({ ...repoSpec, runnerPreset: "none" }), "accepted");

const DOC_URL = "https://docs.google.com/document/d/1AbC_dEF-123/view";

const docSpec = {
  kind: AssignmentKind.GOOGLE_DRIVE,
  title: "Reflection: what I learned in mod 1",
  courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
  templateDriveUrl: DOC_URL,
  sections: [manualSection],
};

check("a Google Drive assignment needs no repository fields", rejects(docSpec), "accepted");
check(
  "...and its repository fields come out null",
  (() => {
    const parsed = parseAssignmentSpec(docSpec);
    return [parsed.templateRepo, parsed.assignmentRepoName, parsed.githubOrg];
  })(),
  [null, null, null],
);
/*
  No repository means no template to take a suite from, so there is nothing to run.
  Accepting a runner here would produce an assignment that looks like it has test
  evidence and can never have any.
*/
check(
  "a Google Drive assignment may not name a runner",
  rejects({ ...docSpec, runnerPreset: "node-jest" }),
  ["runnerPreset"],
);
check(
  "a Google Drive assignment may not name a repository",
  rejects({ ...docSpec, templateRepo: "marcy-lms/whatever" }),
  ["templateRepo"],
);
check("an unknown kind is refused", rejects({ ...repoSpec, kind: "SLACK_MESSAGE" }), ["kind"]);

/*
  A document assignment is distributed by its template link and nothing else, so the link is
  required and its shape is checked rather than trusted. The shape matters because
  `copyUrlFromTemplate` works by replacing the last path segment: a URL that does not match is
  one the substitution would leave untouched, sending every student to the instructor's own
  document to edit in place. That is the failure this pattern exists to prevent.
*/
check(
  "a Google Drive assignment needs a template file",
  rejects({ ...docSpec, templateDriveUrl: undefined }),
  ["templateDriveUrl"],
);
check(
  "a link that is not a Drive editor link is refused",
  rejects({ ...docSpec, templateDriveUrl: "https://example.com/some/doc/view" }),
  ["templateDriveUrl"],
);
check(
  "a Drive link with no final segment is refused",
  rejects({ ...docSpec, templateDriveUrl: "https://docs.google.com/document/d/1AbC_dEF-123" }),
  ["templateDriveUrl"],
);
check(
  "a REPO assignment may not name a template file",
  rejects({ ...repoSpec, templateDriveUrl: DOC_URL }),
  ["templateDriveUrl"],
);

/*
  Three editors, one kind.

  A Doc, a Sheet, and a Slides deck are handed out as a `/copy` link built the same way, handed
  in as a link, and graded by hand — so they were never three kinds, they were one kind named
  after the only editor it happened to accept. What each pair below actually proves is that the
  substitution still lands, because a pattern widened without the substitution being widened
  with it would accept the link and then send every student to the instructor's own file.
*/
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1AbC_dEF-123/edit";
const SLIDES_URL = "https://docs.google.com/presentation/d/1AbC_dEF-123/edit";

check(
  "a Sheets link is accepted",
  rejects({ ...docSpec, templateDriveUrl: SHEET_URL }),
  "accepted",
);
check(
  "...and takes a copy prompt",
  copyUrlFromTemplate(SHEET_URL),
  "https://docs.google.com/spreadsheets/d/1AbC_dEF-123/copy",
);
check(
  "a Slides link is accepted",
  rejects({ ...docSpec, templateDriveUrl: SLIDES_URL }),
  "accepted",
);
check(
  "...and takes a copy prompt",
  copyUrlFromTemplate(SLIDES_URL),
  "https://docs.google.com/presentation/d/1AbC_dEF-123/copy",
);
check(
  "a Slides link carrying a slide anchor is accepted, and drops it with the segment",
  copyUrlFromTemplate("https://docs.google.com/presentation/d/1AbC_dEF-123/edit#slide=id.p"),
  "https://docs.google.com/presentation/d/1AbC_dEF-123/copy",
);
check(
  "a Sheets link carrying a tab anchor does too",
  copyUrlFromTemplate("https://docs.google.com/spreadsheets/d/1AbC_dEF-123/edit#gid=0"),
  "https://docs.google.com/spreadsheets/d/1AbC_dEF-123/copy",
);

/*
  Named editors rather than any Google address, which is the half a widened pattern gets wrong.
  None of these produces a copy prompt from the substitution, and each would fail on the
  student's side rather than on the field where it was typed.
*/
check(
  "a Google Form is refused, because /copy is not how one is shared",
  rejects({ ...docSpec, templateDriveUrl: "https://docs.google.com/forms/d/1AbC_dEF-123/edit" }),
  ["templateDriveUrl"],
);
check(
  "a published link is refused",
  rejects({ ...docSpec, templateDriveUrl: "https://docs.google.com/document/d/1AbC_dEF-123/pub" }),
  ["templateDriveUrl"],
);
check(
  "a Drive folder is refused",
  rejects({ ...docSpec, templateDriveUrl: "https://drive.google.com/drive/folders/1AbC_dEF-123" }),
  ["templateDriveUrl"],
);

check(
  "/view becomes /copy",
  copyUrlFromTemplate(DOC_URL),
  "https://docs.google.com/document/d/1AbC_dEF-123/copy",
);
// What Google's Share dialog actually hands over, query string and all.
check(
  "/edit?usp=sharing becomes /copy",
  copyUrlFromTemplate("https://docs.google.com/document/d/1AbC_dEF-123/edit?usp=sharing"),
  "https://docs.google.com/document/d/1AbC_dEF-123/copy",
);

/*
  A document has no pull request, no changed files, and no test suite, so there is nothing for
  the pipeline to read. An AI section here would validate, save, sit in the queue as a report
  waiting to be generated, and fail on the missing pull request at the moment an instructor
  asked for it — refusing it at authoring time is the difference between an assignment that
  cannot be built wrong and one that breaks the first time it is used.
*/
check(
  "a Google Drive assignment may not have a section the model grades",
  refusedOn({ ...docSpec, sections: [codingSection] }, "sections.0.grading"),
  true,
);
check(
  "a self-directed assignment may not either",
  refusedOn(
    {
      kind: AssignmentKind.SELF_DIRECTED,
      title: "Resume, first draft",
      courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
      handInMethods: ["FILE"],
      acceptedFileTypes: ["pdf"],
      sections: [codingSection],
    },
    "sections.0.grading",
  ),
  true,
);
check(
  "a self-directed assignment needs no template of any kind",
  rejects({
    kind: AssignmentKind.SELF_DIRECTED,
    title: "Resume, first draft",
    courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
    handInMethods: ["FILE"],
    sections: [manualSection],
    acceptedFileTypes: ["pdf"],
  }),
  "accepted",
);

// --- how a self-directed assignment is handed in -----------------------------
//
// The field this kind exists for. At least one way in, and both is the case it was built for:
// a reflection taken as a document, a deck, or a short recording is one assignment.
const uploadSpec = {
  kind: AssignmentKind.SELF_DIRECTED,
  title: "Resume, first draft",
  courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
  handInMethods: ["FILE"],
  sections: [manualSection],
  acceptedFileTypes: ["pdf"],
};

check(
  "a self-directed assignment must say at least one way in",
  refusedOn({ ...uploadSpec, handInMethods: [] }, "handInMethods"),
  true,
);
check(
  "and is refused when the key is missing entirely",
  refusedOn({ ...uploadSpec, handInMethods: undefined }, "handInMethods"),
  true,
);
check(
  "an unknown method is refused",
  refusedOn({ ...uploadSpec, handInMethods: ["EMAIL"] }, "handInMethods.0"),
  true,
);
check(
  "a duplicated method is refused",
  refusedOn({ ...uploadSpec, handInMethods: ["FILE", "FILE"] }, "handInMethods"),
  true,
);
check(
  "both ways in are accepted together",
  parseAssignmentSpec({ ...uploadSpec, handInMethods: ["LINK", "FILE"] }).handInMethods,
  ["LINK", "FILE"],
);

// --- what a file upload accepts ----------------------------------------------
//
// Not defaulted to "anything". An assignment that accepts anything cannot tell a student
// their file is the wrong kind until an instructor opens it and finds a screenshot where a
// PDF was wanted, by which point the due date has passed.
check(
  "an assignment handed in as a file must say what it accepts",
  refusedOn({ ...uploadSpec, acceptedFileTypes: [] }, "acceptedFileTypes"),
  true,
);
check(
  "and it is refused when the key is missing entirely",
  refusedOn({ ...uploadSpec, acceptedFileTypes: undefined }, "acceptedFileTypes"),
  true,
);
check(
  "an unknown file type is refused",
  refusedOn({ ...uploadSpec, acceptedFileTypes: ["powerpoint"] }, "acceptedFileTypes.0"),
  true,
);
check(
  "a duplicated file type is refused",
  refusedOn({ ...uploadSpec, acceptedFileTypes: ["pdf", "pdf"] }, "acceptedFileTypes"),
  true,
);
check(
  "several types are accepted",
  parseAssignmentSpec({ ...uploadSpec, acceptedFileTypes: ["pdf", "image"] }).acceptedFileTypes,
  ["pdf", "image"],
);

// The mirror of the repository columns: a kind that is not handed in as a file accepts none,
// and says so as an empty list rather than leaving the column to mean two things.
check(
  "a Google Drive assignment accepts no file types",
  parseAssignmentSpec(docSpec).acceptedFileTypes,
  [],
);
check(
  "and may not declare any",
  refusedOn({ ...docSpec, acceptedFileTypes: ["pdf"] }, "acceptedFileTypes.0"),
  true,
);

// --- work made somewhere else ------------------------------------------------
//
// Handed in as a link, like a Drive file, and distributed like nothing at all. The distinction
// that matters is which of those two halves each rule follows.
const linkSpec = {
  kind: AssignmentKind.SELF_DIRECTED,
  title: "Personal site (Canva)",
  courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
  handInMethods: ["LINK"],
  sections: [manualSection],
};

check(
  "a link-only assignment needs nothing but a title, a module, a way in, and a section",
  rejects(linkSpec),
  "accepted",
);
check("it has no repository", parseAssignmentSpec(linkSpec).templateRepo, null);
check("no runner", parseAssignmentSpec(linkSpec).runnerPreset, "none");
check("no file types", parseAssignmentSpec(linkSpec).acceptedFileTypes, []);
// No template of any kind, and deliberately no field for one: a starting link belongs in the
// markdown instructions, where it can say what to do with it.
check("and no template document", parseAssignmentSpec(linkSpec).templateDriveUrl, null);
check(
  "a template file may not be set on it",
  refusedOn(
    { ...linkSpec, templateDriveUrl: "https://docs.google.com/document/d/x/view" },
    "templateDriveUrl",
  ),
  true,
);
// The mirror of "a file assignment must say what it accepts": the same kind, handed in the
// other way, refuses the types rather than requiring them. Both halves live in the one
// superRefine, so neither can be satisfied while the other is forgotten.
check(
  "nor may file types, when a file is not one of the ways in",
  refusedOn({ ...linkSpec, acceptedFileTypes: ["pdf"] }, "acceptedFileTypes"),
  true,
);
check(
  "nor a runner preset",
  refusedOn({ ...linkSpec, runnerPreset: "node-jest" }, "runnerPreset"),
  true,
);
// The pipeline's inputs are a pull request's files and a template's tests. This kind has
// neither, so an AI section would sit in the queue as a report waiting to be generated and fail
// at the moment an instructor asked for it.
check(
  "and no section the model grades",
  refusedOn({ ...linkSpec, sections: [codingSection] }, "sections.0.grading"),
  true,
);

/*
  How each kind is handed in, asked of the one function every caller asks. A repository answers
  with nothing rather than with a method, because opening a pull request is not a form anything
  draws — and a self-directed assignment answers with whatever its instructor chose, which is the
  whole reason this cannot be a question about a kind alone.
*/
check(
  "a repository is handed in by neither method",
  handInMethodsFor({ kind: AssignmentKind.REPO, handInMethods: [] }),
  [],
);
check(
  "a Drive assignment is handed in as a link, whatever the column says",
  handInMethodsFor({ kind: AssignmentKind.GOOGLE_DRIVE, handInMethods: [] }),
  ["LINK"],
);
check(
  "and a stray value on one is ignored rather than believed",
  handInMethodsFor({ kind: AssignmentKind.GOOGLE_DRIVE, handInMethods: ["FILE"] }),
  ["LINK"],
);
check(
  "a self-directed assignment is handed in whichever ways it names",
  handInMethodsFor({ kind: AssignmentKind.SELF_DIRECTED, handInMethods: ["LINK", "FILE"] }),
  ["LINK", "FILE"],
);
check(
  "the two fixed kinds store no choice of their own",
  [parseAssignmentSpec(docSpec).handInMethods, parseAssignmentSpec(repoSpec).handInMethods],
  [[], []],
);

// Optional on every kind, because each kind's own screen states the mechanical steps already.
check(
  "submission instructions are optional and default to null",
  parseAssignmentSpec(docSpec).submissionInstructions,
  null,
);
check(
  "submission instructions are kept when given",
  parseAssignmentSpec({ ...docSpec, submissionInstructions: "Paste your link." })
    .submissionInstructions,
  "Paste your link.",
);

// --- narrowing at the point of use -------------------------------------------
check("REPO requires a repository", requiresRepository(AssignmentKind.REPO), true);
check("GOOGLE_DRIVE does not", requiresRepository(AssignmentKind.GOOGLE_DRIVE), false);
check(
  "all three kinds are implemented",
  [...IMPLEMENTED_KINDS].sort(),
  [AssignmentKind.GOOGLE_DRIVE, AssignmentKind.REPO, AssignmentKind.SELF_DIRECTED].sort(),
);
check(
  "a self-directed kind is not repository-backed",
  requiresRepository(AssignmentKind.SELF_DIRECTED),
  false,
);
check("and it has no Accept", hasAcceptStep(AssignmentKind.SELF_DIRECTED), false);

check(
  "repositorySource narrows a REPO row",
  repositorySource({
    kind: AssignmentKind.REPO,
    templateRepo: "marcy-lms/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: "marcy-lms",
    templateRef: null,
  }),
  {
    templateRepo: "marcy-lms/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: "marcy-lms",
    templateRef: null,
  },
);

/*
  Three failures that must not be reported as one another, and the first two are opposites: a
  Google Drive assignment *works* and simply has no repository, while a kind nobody has built is
  a feature that does not exist. A REPO row with no org is the third and the only one an
  instructor can act on — a row that should never have been written.
*/
let notRepoBacked = "";
try {
  repositorySource({
    kind: AssignmentKind.GOOGLE_DRIVE,
    templateRepo: null,
    assignmentRepoName: null,
    githubOrg: null,
  });
} catch (err) {
  notRepoBacked = errName(err);
}
check(
  "asking a Google Drive assignment for a repository throws NotRepositoryBackedError",
  notRepoBacked,
  new NotRepositoryBackedError(AssignmentKind.GOOGLE_DRIVE).name,
);

/*
  Every kind in the enum is implemented, so this is checked against a value that is not one at
  all. The guard still has to hold: it is what a future kind meets before anything downstream
  tries to grade it, and the only way to prove it still refuses is to hand it something unknown.
*/
let unsupported = "";
try {
  assertKindImplemented("PRESENTATION" as AssignmentKind);
} catch (err) {
  unsupported = errName(err);
}
check(
  "a kind that is not implemented throws UnsupportedAssignmentKindError",
  unsupported,
  new UnsupportedAssignmentKindError(AssignmentKind.GOOGLE_DRIVE).name,
);

let misconfigured = "",
  misconfiguredMessage = "";
try {
  repositorySource({
    kind: AssignmentKind.REPO,
    templateRepo: "marcy-lms/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: null,
  });
} catch (err) {
  misconfigured = errName(err);
  misconfiguredMessage = err instanceof Error ? err.message : "";
}
check(
  "a REPO row missing a column throws AssignmentConfigurationError",
  misconfigured,
  new AssignmentConfigurationError("").name,
);
check(
  "...and the message names the missing column",
  misconfiguredMessage.includes("githubOrg"),
  true,
);

// =====================================================================================
// The procedures, against the real database.
//
// Everything above is pure. What follows drives the tRPC callers, because authorization is
// half of what these procedures are: a check that only holds when called through the
// interface is not a check. Every write happens inside a transaction that is rolled back,
// so this can run against live data without harming any of it.
//
// The strongest check here is the first: authoring `swe-1-3-node-modules` through `create`
// and diffing the row against what `prisma/seed.ts` produces. That assignment already
// grades correctly end to end, so an identical row proves the authoring path produces
// grading-correct output rather than merely well-formed output.
// =====================================================================================

/**
 * Fixed ids for the second program and course this script needs, so a re-run reuses two rows
 * rather than adding more. Nothing else uses them, and the script deletes them before it exits.
 *
 * Two rather than one, because a course belongs to a program: the tokens the second course
 * used to carry are the program's now.
 */
const ELSEWHERE_PROGRAM_ID = "e7c1a1d0-0000-4000-8000-00000000fffe";
const ELSEWHERE_COURSE_ID = "e7c1a1d0-0000-4000-8000-00000000ffff";

async function procedures() {
  // The environment is already loaded at module scope, which runs before this does.
  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  const seeded = await db.assignment.findFirst({
    where: { assignmentRepoName: "swe-1-3-node-modules" },
    select: {
      id: true,
      courseId: true,
      course: { select: { programId: true } },
      kind: true,
      title: true,
      courseUnitId: true,
      answerKeyRepo: true,
      answerKeyDir: true,
      pointValue: true,
      completionThreshold: true,
      templateRepo: true,
      assignmentRepoName: true,
      githubOrg: true,
      templateRef: true,
      runnerPreset: true,
      runnerConfig: true,
      sections: true,
      distributedAt: true,
      templateDriveUrl: true,
      submissionInstructions: true,
    },
  });

  if (!seeded) {
    skip("the procedure checks — swe-1-3-node-modules is not seeded");
    return;
  }

  const instructor = await db.courseInstructor.findFirst({
    where: { courseId: seeded.courseId },
    select: { userId: true },
  });
  /*
    Any status. Every check below that acts as a student is a refusal — a student cannot author —
    or a read of the published list, and both admit a removed student by design.

    It used to require ACTIVE, which meant removing a student in the running application silently
    stopped this entire group of checks while the script went on reporting a pass.
  */
  const student = await db.enrollment.findFirst({
    // On the roster of the program the seeded course belongs to, which is what makes somebody
    // a student of it.
    where: { programId: seeded.course.programId },
    orderBy: { createdAt: "asc" },
    select: { studentId: true },
  });
  if (!instructor || !student) {
    skip("the procedure checks — the seeded course has no instructor or fellow");
    return;
  }

  const createCaller = createCallerFactory(appRouter);
  const asInstructor = createCaller({ db, user: { id: instructor.userId } } as never);
  const asStudent = createCaller({ db, user: { id: student.studentId } } as never);

  /** The draft an instructor would submit for the seeded assignment. */
  const draftFromSeed = {
    kind: seeded.kind,
    title: seeded.title,
    courseUnitId: seeded.courseUnitId,
    answerKeyRepo: seeded.answerKeyRepo,
    answerKeyDir: seeded.answerKeyDir,
    completionThreshold: seeded.completionThreshold,
    dueAt: null,
    templateRepo: seeded.templateRepo,
    assignmentRepoName: seeded.assignmentRepoName,
    githubOrg: seeded.githubOrg,
    templateRef: seeded.templateRef,
    runnerPreset: seeded.runnerPreset,
    runnerConfig: seeded.runnerConfig,
    sections: seeded.sections,
  };

  // --- validateDraft ---------------------------------------------------------
  const valid = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: draftFromSeed,
  });
  check(
    "the seeded assignment validates as a draft",
    {
      canSave: valid.canSave,
      points: valid.pointValue,
      errors: valid.findings.filter((f) => f.severity === "error"),
    },
    { canSave: true, points: seeded.pointValue, errors: [] },
  );

  // Without excluding itself, its own repository name is a collision.
  const collides = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    draft: draftFromSeed,
  });
  check(
    "a colliding repository name is refused",
    collides.findings.some((f) => f.path === "assignmentRepoName" && f.severity === "error"),
    true,
  );

  /*
    A module that does not exist at all, which the foreign key would also refuse — but as a
    constraint violation reaching an instructor as an error rather than as a finding on the
    field.
  */
  const noModule = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, courseUnitId: "e7c1a1d0-0000-4000-8000-0000000000ff" },
  });
  check(
    "a module that does not exist is refused",
    noModule.findings.some((f) => f.path === "courseUnitId" && f.severity === "error"),
    true,
  );

  /*
    And a module of a *different* course, which is the failure nothing at the database level
    catches: the foreign key says the module exists, not that it belongs here. Without this an
    assignment could be filed under another course's module and appear in neither one.
  */
  /*
    Reused if it is already there, and cleaned up at the end.

    These two rows cannot live in the rolled-back transaction below, because `validateDraft`
    is called through a caller bound to `db` rather than to the transaction and would not see
    them. So they are real writes — which means this script has to remove them, and did not:
    it left a course and a module behind on every run, which is how the seeded course came to
    have neighbours nobody created on purpose.
  */
  const elsewhereProgram = await db.program.upsert({
    where: { id: ELSEWHERE_PROGRAM_ID },
    create: {
      id: ELSEWHERE_PROGRAM_ID,
      name: "Another program (verify:authoring)",
      term: "Cohort Other",
      joinToken: `verify-authoring-${ELSEWHERE_PROGRAM_ID}`,
      instructorToken: `verify-authoring-it-${ELSEWHERE_PROGRAM_ID}`,
    },
    update: {},
    select: { id: true },
  });
  const elsewhereCourse = await db.course.upsert({
    where: { id: ELSEWHERE_COURSE_ID },
    create: {
      id: ELSEWHERE_COURSE_ID,
      programId: elsewhereProgram.id,
      name: "Another course (verify:authoring)",
      slug: "verify-authoring",
    },
    update: {},
    select: { id: true },
  });
  const foreignModule = await db.courseUnit.upsert({
    where: { courseId_name: { courseId: elsewhereCourse.id, name: "Mod 1 - Somewhere Else" } },
    create: { courseId: elsewhereCourse.id, name: "Mod 1 - Somewhere Else", position: 0 },
    update: {},
    select: { id: true },
  });
  const crossCourse = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, courseUnitId: foreignModule.id },
  });
  check(
    "a module belonging to another course is refused",
    crossCourse.findings.some((f) => f.path === "courseUnitId" && f.severity === "error"),
    true,
  );

  /*
    A real, readable, public repository that is not a template.

    `octocat/Hello-World` is GitHub's own example repository: it has existed since 2011, it is
    public, and it is not a template. It also proves the reach a public template buys —
    nothing has installed this App on `octocat`, and an installation token reads it anyway.
  */
  const NOT_A_TEMPLATE_REPO = "octocat/Hello-World";

  const badRepo = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, templateRepo: "marcy-lms/does-not-exist-anywhere" },
  });
  check(
    "an unreachable template repository is refused",
    badRepo.findings.some((f) => f.path === "templateRepo" && f.severity === "error"),
    true,
  );

  /*
    A repository that exists and is readable but is not a template.

    Refused here because `generate` refuses it too, at the moment a student presses Accept —
    and with a message about the API rather than about the assignment. `marcy-lms`
    itself is an organization rather than a repository, so this uses one that is genuinely
    an ordinary repository: an easy mistake, since it looks and reads exactly right.
  */
  const notATemplate = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, templateRepo: NOT_A_TEMPLATE_REPO },
  });
  check(
    "a repository that is not a template repository is refused",
    notATemplate.findings.some(
      (f) =>
        f.path === "templateRepo" &&
        f.severity === "error" &&
        f.message.includes("not a template repository"),
    ),
    true,
  );

  /*
    A pasted URL and a typed owner/repo are the same field.

    Checked through the procedure rather than only against the parser, because the
    normalization has to happen before validation reads the value — a draft carrying a URL
    must pass exactly as one carrying owner/repo does, or the form would have to normalize it
    first and the server's rule would be the second implementation.
  */
  const pastedUrls = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: {
      ...draftFromSeed,
      templateRepo: `https://github.com/${seeded.templateRepo}`,
      answerKeyRepo: `https://github.com/${seeded.answerKeyRepo}.git`,
    },
  });
  check("both repositories may be given as pasted URLs", pastedUrls.canSave, true);

  /*
    The two answer-key failures that must not be reported as one.

    An organization the App was never installed on and a repository that does not exist both
    answer 404, and they are not the same thing to the person reading the message: one is a
    typo fixed in seconds, the other is an installation nobody can perform from a form. If
    these two messages ever converge, the second reads as the first forever.
  */
  const missingKeyRepo = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: {
      ...draftFromSeed,
      answerKeyRepo: `${seeded.answerKeyRepo!.split("/")[0]}/no-such-answer-keys`,
    },
  });
  const notInstalled = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, answerKeyRepo: "an-org-this-app-is-not-on-xyz/keys" },
  });
  const missingMessage =
    missingKeyRepo.findings.find((f) => f.path === "answerKeyRepo")?.message ?? "";
  const notInstalledMessage =
    notInstalled.findings.find((f) => f.path === "answerKeyRepo")?.message ?? "";

  check(
    "an answer key repository that does not exist is refused",
    missingMessage.includes("Check the name"),
    true,
  );
  check(
    "an organization the App is not installed on says so instead",
    notInstalledMessage.includes("not installed on"),
    true,
  );
  check(
    "the two are told apart rather than reported identically",
    missingMessage !== "" && missingMessage !== notInstalledMessage,
    true,
  );

  /*
    A folder that is not in the repository.

    A warning rather than a refusal, and deliberately: an assignment whose folder has been
    renamed or emptied upstream still grades, with the model reading the code against the
    rubric alone. It is worse and it is not nothing, so it belongs on this screen rather than
    in a report weeks later.
  */
  const badDir = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: { ...draftFromSeed, answerKeyDir: `${seeded.answerKeyDir}-does-not-exist` },
  });
  check(
    "an answer key folder that is not there is a warning, not a refusal",
    {
      warns: badDir.findings.some((f) => f.severity === "warning" && f.path === "answerKeyDir"),
      canSave: badDir.canSave,
    },
    { warns: true, canSave: true },
  );

  // The rubric pairing, which nothing else would catch: a plausible report against
  // criteria that do not apply to the work.
  const wrongRubric = await db.rubric.findFirst({
    where: { name: "SHORT_RESPONSE" },
    select: { id: true },
  });
  if (wrongRubric) {
    const mismatched = await asInstructor.assignments.validateDraft({
      courseId: seeded.courseId,
      assignmentId: seeded.id,
      draft: {
        ...draftFromSeed,
        sections: (seeded.sections as object[]).map((s) => ({ ...s, rubricId: wrongRubric.id })),
      },
    });
    check(
      "a coding section graded against the short response rubric is refused",
      mismatched.findings.some((f) => f.path.endsWith("rubricId") && f.severity === "error"),
      true,
    );
  }

  /*
    The round trip the edit screen depends on.

    `getDraft` is what fills the form and `update` is what it submits, so those two shapes
    have to agree exactly. If they do not, editing an assignment to change one field would
    fail — or worse, silently rewrite the section mapping — and nothing in the pure checks
    above would notice, because the shapes only meet at this seam. Loading a draft and
    saving it back with no changes must be valid and must not alter the row.
  */
  const loaded = await asInstructor.assignments.getDraft({ assignmentId: seeded.id });
  const roundTrip = {
    kind: loaded.kind,
    title: loaded.title,
    courseUnitId: loaded.courseUnitId,
    answerKeyRepo: loaded.answerKeyRepo,
    answerKeyDir: loaded.answerKeyDir,
    completionThreshold: loaded.completionThreshold,
    dueAt: loaded.dueAt,
    templateRepo: loaded.templateRepo,
    assignmentRepoName: loaded.assignmentRepoName,
    githubOrg: loaded.githubOrg,
    templateRef: loaded.templateRef,
    runnerPreset: loaded.runnerPreset,
    runnerConfig: loaded.runnerConfig,
    templateDriveUrl: loaded.templateDriveUrl,
    submissionInstructions: loaded.submissionInstructions,
    sections: loaded.sections,
  };

  const roundTripValid = await asInstructor.assignments.validateDraft({
    courseId: seeded.courseId,
    assignmentId: seeded.id,
    draft: roundTrip,
  });
  check(
    "what getDraft returns is a draft that validateDraft accepts",
    { canSave: roundTripValid.canSave, points: roundTripValid.pointValue },
    { canSave: true, points: seeded.pointValue },
  );

  check("getDraft reports how many students have accepted", loaded.submissionCount > 0, true);

  try {
    await db.$transaction(
      async (tx) => {
        const inTx = createCaller({ db: tx, user: { id: instructor.userId } } as never);
        await inTx.assignments.update({ assignmentId: seeded.id, draft: roundTrip });

        const after = await tx.assignment.findUnique({
          where: { id: seeded.id },
          select: {
            title: true,
            answerKeyRepo: true,
            answerKeyDir: true,
            pointValue: true,
            completionThreshold: true,
            templateRepo: true,
            assignmentRepoName: true,
            githubOrg: true,
            templateRef: true,
            runnerPreset: true,
            runnerConfig: true,
            sections: true,
            templateDriveUrl: true,
            submissionInstructions: true,
          },
        });
        check(
          "saving a loaded draft unchanged leaves every column as it was",
          JSON.stringify(after),
          JSON.stringify({
            title: seeded.title,
            answerKeyRepo: seeded.answerKeyRepo,
            answerKeyDir: seeded.answerKeyDir,
            pointValue: seeded.pointValue,
            completionThreshold: seeded.completionThreshold,
            templateRepo: seeded.templateRepo,
            assignmentRepoName: seeded.assignmentRepoName,
            githubOrg: seeded.githubOrg,
            templateRef: seeded.templateRef,
            runnerPreset: seeded.runnerPreset,
            runnerConfig: seeded.runnerConfig,
            sections: seeded.sections,
            templateDriveUrl: seeded.templateDriveUrl,
            submissionInstructions: seeded.submissionInstructions,
          }),
        );
        throw new Error("ROLLBACK");
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // --- authorization ---------------------------------------------------------
  async function refused(label: string, run: () => Promise<unknown>) {
    try {
      await run();
      check(label, "allowed", "FORBIDDEN");
    } catch (err) {
      check(label, (err as { code?: string }).code ?? String(err), "FORBIDDEN");
    }
  }

  await refused("a student cannot validate a draft", () =>
    asStudent.assignments.validateDraft({ courseId: seeded.courseId, draft: draftFromSeed }),
  );
  await refused("a student cannot create an assignment", () =>
    asStudent.assignments.create({ courseId: seeded.courseId, draft: draftFromSeed }),
  );
  await refused("a student cannot remove an assignment", () =>
    asStudent.assignments.remove({ assignmentId: seeded.id, confirmTitle: seeded.title }),
  );

  /*
    Somebody holding the INSTRUCTOR role who does not teach *this* course, asked as that
    question directly.

    This used to look for an instructor of some *other* course who is not the one this script
    acts as, which was the same thing only while a course had one instructor and nobody taught
    two. Once co-teaching existed the seeded course gained a second instructor, and the query
    started returning somebody who teaches it — so the call got past the teach gate and failed
    validation instead, reporting a hole that is not there. The reverse is the worse case: on a
    different set of rows it would have picked a real outsider and passed by luck.

    `programsInstructing: { none: ... }` cannot go stale as a term gains or loses
    instructors. ADMIN is excluded by asking for the role exactly, which is correct — an admin may
    author anywhere.
  */
  const outsider = await db.profile.findFirst({
    where: {
      role: "INSTRUCTOR",
      programsInstructing: { none: { programId: seeded.course.programId } },
    },
    select: { id: true },
  });
  if (outsider) {
    const asOutsider = createCaller({ db, user: { id: outsider.id } } as never);
    await refused("an instructor who does not teach the course cannot author in it", () =>
      asOutsider.assignments.create({ courseId: seeded.courseId, draft: draftFromSeed }),
    );
  } else {
    console.log(
      "skip  an instructor who does not teach the course cannot author in it — none exists",
    );
  }

  // --- create, diffed against the seed --------------------------------------
  try {
    await db.$transaction(
      async (tx) => {
        const inTx = createCaller({ db: tx, user: { id: instructor.userId } } as never);

        const { assignment } = await inTx.assignments.create({
          courseId: seeded.courseId,
          draft: { ...draftFromSeed, assignmentRepoName: "swe-1-3-node-modules-authored" },
        });

        const authored = await tx.assignment.findUnique({
          where: { id: assignment.id },
          select: {
            kind: true,
            title: true,
            answerKeyRepo: true,
            answerKeyDir: true,
            pointValue: true,
            completionThreshold: true,
            templateRepo: true,
            githubOrg: true,
            templateRef: true,
            runnerPreset: true,
            runnerConfig: true,
            sections: true,
            distributedAt: true,
          },
        });

        // Everything the seed writes, except the two that are deliberately different: the
        // repository name was changed to avoid the collision, and an authored assignment
        // starts unpublished where the seed publishes immediately.
        check(
          "an authored row matches the seeded one field for field",
          {
            kind: authored?.kind,
            title: authored?.title,
            answerKeyRepo: authored?.answerKeyRepo,
            answerKeyDir: authored?.answerKeyDir,
            pointValue: authored?.pointValue,
            completionThreshold: authored?.completionThreshold,
            templateRepo: authored?.templateRepo,
            githubOrg: authored?.githubOrg,
            templateRef: authored?.templateRef,
            runnerPreset: authored?.runnerPreset,
            runnerConfig: authored?.runnerConfig,
            sections: authored?.sections,
          },
          {
            kind: seeded.kind,
            title: seeded.title,
            answerKeyRepo: seeded.answerKeyRepo,
            answerKeyDir: seeded.answerKeyDir,
            pointValue: seeded.pointValue,
            completionThreshold: seeded.completionThreshold,
            templateRepo: seeded.templateRepo,
            githubOrg: seeded.githubOrg,
            templateRef: seeded.templateRef,
            runnerPreset: seeded.runnerPreset,
            runnerConfig: seeded.runnerConfig,
            sections: seeded.sections,
          },
        );
        check("an authored assignment starts unpublished", authored?.distributedAt, null);

        // --- publish, and what a student can see -------------------------------
        const asStudentInTx = createCaller({ db: tx, user: { id: student.studentId } } as never);

        const hiddenFromStudent = await asStudentInTx.assignments.listForCourse({
          courseId: seeded.courseId,
        });
        check(
          "an unpublished assignment is invisible to a student",
          hiddenFromStudent.some((a) => a.id === assignment.id),
          false,
        );

        const visibleToInstructor = await inTx.assignments.listForCourse({
          courseId: seeded.courseId,
        });
        check(
          "...and visible to an instructor",
          visibleToInstructor.some((a) => a.id === assignment.id),
          true,
        );

        await inTx.assignments.publish({ assignmentId: assignment.id });
        const afterPublish = await asStudentInTx.assignments.listForCourse({
          courseId: seeded.courseId,
        });
        check(
          "publishing makes it visible to a student",
          afterPublish.some((a) => a.id === assignment.id),
          true,
        );

        await inTx.assignments.unpublish({ assignmentId: assignment.id });
        const afterUnpublish = await asStudentInTx.assignments.listForCourse({
          courseId: seeded.courseId,
        });
        check(
          "unpublishing hides it again",
          afterUnpublish.some((a) => a.id === assignment.id),
          false,
        );

        // --- update ------------------------------------------------------------
        const updated = await inTx.assignments.update({
          assignmentId: assignment.id,
          draft: {
            ...draftFromSeed,
            assignmentRepoName: "swe-1-3-node-modules-authored",
            title: "Renamed",
          },
        });
        check("update writes the new title", updated.assignment.title, "Renamed");

        // The rename guard applies to the seeded assignment, which has real submissions.
        let renameRefused = "";
        try {
          await inTx.assignments.update({
            assignmentId: seeded.id,
            draft: { ...draftFromSeed, assignmentRepoName: "renamed-out-from-under-students" },
          });
        } catch (err) {
          renameRefused = (err as { code?: string }).code ?? String(err);
        }
        check(
          "renaming an assignment students have accepted is refused",
          renameRefused,
          "PRECONDITION_FAILED",
        );

        // --- duplicate ---------------------------------------------------------
        /*
        A copy beside the original, with no name given.

        The interface used to supply one built out of the assignment's human title, which is not
        a legal repository name the moment a title contains a space — so the one menu item that
        needed a name was the one that could not produce one. Derived in the procedure now, and
        checked twice because the second copy is where a fixed `-copy` suffix would collide with
        the first.
      */
        const beside = await inTx.assignments.duplicate({
          assignmentId: seeded.id,
          targetCourseId: seeded.courseId,
        });
        check(
          "a copy beside the original is given a repository name of its own",
          beside.assignment.assignmentRepoName,
          `${seeded.assignmentRepoName}-copy`,
        );
        const besideAgain = await inTx.assignments.duplicate({
          assignmentId: seeded.id,
          targetCourseId: seeded.courseId,
        });
        check(
          "...and a second one does not collide with the first",
          besideAgain.assignment.assignmentRepoName,
          `${seeded.assignmentRepoName}-copy-2`,
        );

        // A name given rather than derived, which is still allowed: the derivation above is the
        // default, not the only way in. Deliberately not `-copy`, which the two copies above have
        // taken — a check that collides with the fixture beside it is measuring the fixture.
        const copy = await inTx.assignments.duplicate({
          assignmentId: seeded.id,
          targetCourseId: seeded.courseId,
          assignmentRepoName: "swe-1-3-node-modules-named-by-hand",
        });
        check(
          "a duplicate carries the same sections",
          JSON.stringify(
            (
              await tx.assignment.findUnique({
                where: { id: copy.assignment.id },
                select: { sections: true },
              })
            )?.sections,
          ),
          JSON.stringify(seeded.sections),
        );
        check("a duplicate starts unpublished", copy.assignment.distributedAt, null);

        let dupCollision = "";
        try {
          await inTx.assignments.duplicate({
            assignmentId: seeded.id,
            targetCourseId: seeded.courseId,
            assignmentRepoName: seeded.assignmentRepoName!,
          });
        } catch (err) {
          dupCollision = (err as { code?: string }).code ?? String(err);
        }
        check(
          "a duplicate colliding with an existing repository name is refused",
          dupCollision,
          "BAD_REQUEST",
        );

        /*
        --- copying, which is what `duplicate` was actually written for -------

        The procedure has taken a `targetCourseId` since it was written and the interface
        hardcoded the current course, so the cross-course case was reachable only by writing the
        call. What the checks below are really about is the **module**, because that is the part
        two courses cannot agree on by construction: a module belongs to one course, so a copy
        has to be told or has to guess, and guessing wrong looks exactly like guessing right.
      */
        const code = async (run: () => Promise<unknown>) => {
          try {
            await run();
            return "accepted";
          } catch (err) {
            return (err as { code?: string }).code ?? String(err);
          }
        };

        // --- into another course ---
        const targetCourse = await inTx.courses.create({
          programId: seeded.course.programId,
          name: "Verify Copy Target",
        });
        const seededModuleName = (await tx.courseUnit.findUnique({
          where: { id: seeded.courseUnitId },
          select: { name: true },
        }))!.name;

        check(
          "copying into a course with no module of that name is refused",
          await code(() =>
            inTx.assignments.duplicate({
              assignmentId: seeded.id,
              targetCourseId: targetCourse.course.id,
            }),
          ),
          "BAD_REQUEST",
        );
        check(
          "...and nothing was written there",
          await tx.assignment.count({ where: { courseId: targetCourse.course.id } }),
          0,
        );

        /*
        Named explicitly, which is the case the name match cannot serve: two courses whose
        module sequences have diverged. Without it, copying into such a course fails on every
        assignment and the only way through is renaming a module to match.
      */
        const differentlyNamed = await inTx.courseUnits.create({
          category: "MODULE",
          courseId: targetCourse.course.id,
          name: "Week One",
        });
        const named = await inTx.assignments.duplicate({
          assignmentId: seeded.id,
          targetCourseId: targetCourse.course.id,
          targetCourseUnitId: differentlyNamed.id,
        });
        check(
          "naming the module copies it into a course whose modules are named differently",
          named.assignment.courseUnitId,
          differentlyNamed.id,
        );
        /*
        The repository name comes across unchanged, which is the half worth checking rather than
        assuming. `@@unique([courseId, assignmentRepoName])` is per course, and the generated
        repositories still differ because the course's short name prefixes every one of them —
        so renaming here would break the correspondence between two years of one course for
        no reason.
      */
        check(
          "...keeping the repository name, because the course's short name tells them apart",
          named.assignment.assignmentRepoName,
          seeded.assignmentRepoName,
        );
        check("...and arriving unpublished", named.assignment.distributedAt, null);

        /*
        A module id is a parameter anybody can pass, so it is checked against the target course
        rather than merely looked up. Without that, a copy could be filed under a third course's
        module — which no screen would show and no constraint would catch, since `courseUnitId` is a
        foreign key to modules rather than to modules *of this course*.
      */
        check(
          "a module from another course is refused",
          await code(() =>
            inTx.assignments.duplicate({
              assignmentId: seeded.id,
              targetCourseId: targetCourse.course.id,
              targetCourseUnitId: seeded.courseUnitId,
            }),
          ),
          "BAD_REQUEST",
        );

        /*
        The same assignment cannot land in one course twice, because the copy keeps its
        repository name and two assignments in a course cannot share one. Worth checking rather
        than discovering: it is the reason the check below needs a second course.
      */
        check(
          "copying the same assignment into that course again is refused",
          await code(() =>
            inTx.assignments.duplicate({
              assignmentId: seeded.id,
              targetCourseId: targetCourse.course.id,
              targetCourseUnitId: differentlyNamed.id,
            }),
          ),
          "BAD_REQUEST",
        );

        /*
        Matched by name when nobody says otherwise, which is the ordinary case: a course copied
        from last year's has last year's module names.
      */
        const secondTarget = await inTx.courses.create({
          programId: seeded.course.programId,
          name: "Verify Copy Target Two",
        });
        const sameName = await inTx.courseUnits.create({
          category: "MODULE",
          courseId: secondTarget.course.id,
          name: seededModuleName,
        });
        const matched = await inTx.assignments.duplicate({
          assignmentId: seeded.id,
          targetCourseId: secondTarget.course.id,
        });
        check(
          "a module of the same name is matched without being asked for",
          matched.assignment.courseUnitId,
          sameName.id,
        );

        // An archived course takes nothing new, the same rule as a fellow joining a program. It
        // matters because archived courses are in the course list now, so one is a thing somebody
        // can be looking at when they reach for a copy.
        await inTx.courses.setArchived({ courseId: targetCourse.course.id, archived: true });
        check(
          "copying into an archived course is refused",
          await code(() =>
            inTx.assignments.duplicate({
              assignmentId: seeded.id,
              targetCourseId: targetCourse.course.id,
              targetCourseUnitId: differentlyNamed.id,
            }),
          ),
          "PRECONDITION_FAILED",
        );

        // --- removalImpact and remove -----------------------------------------
        const impact = await inTx.assignments.removalImpact({ assignmentId: seeded.id });
        check(
          "removalImpact counts the submissions that exist",
          impact.submissions > 0 && impact.title === seeded.title,
          true,
        );

        let wrongTitle = "";
        try {
          await inTx.assignments.remove({ assignmentId: seeded.id, confirmTitle: "not the title" });
        } catch (err) {
          wrongTitle = (err as { code?: string }).code ?? String(err);
        }
        // Called directly rather than through a dialog, which is the whole point of the
        // check living in the procedure.
        check("remove refuses when the typed title does not match", wrongTitle, "BAD_REQUEST");

        const removed = await inTx.assignments.remove({
          assignmentId: seeded.id,
          confirmTitle: seeded.title,
        });
        check(
          "what remove reports matches what removalImpact predicted",
          { submissions: removed.submissions, drafts: removed.drafts, testRuns: removed.testRuns },
          { submissions: impact.submissions, drafts: impact.drafts, testRuns: impact.testRuns },
        );
        check(
          "student repositories are reported rather than deleted",
          removed.orphanedRepositories.length,
          impact.orphanedRepositories.length,
        );
        check(
          "the assignment is gone",
          await tx.assignment.findUnique({ where: { id: seeded.id }, select: { id: true } }),
          null,
        );

        throw new Error("ROLLBACK");
      },
      { timeout: 30_000 },
    );
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "ROLLBACK") throw err;
  }

  // Nothing above survived.
  const stillThere = await db.assignment.findUnique({
    where: { id: seeded.id },
    select: { title: true, distributedAt: true },
  });
  check(
    "the rollback left the seeded assignment untouched",
    { title: stillThere?.title, published: stillThere?.distributedAt !== null },
    { title: seeded.title, published: seeded.distributedAt !== null },
  );
  check(
    "no authored rows survived the rollback",
    await db.assignment.count({ where: { assignmentRepoName: { contains: "-authored" } } }),
    0,
  );
  /*
    Nor the courses the copy checks created, which is a separate claim from the assignments.

    Those checks copy *into* new courses, so a rollback that left the courses behind would leave
    the seeded assignment duplicated into courses nobody made — and a course is the one thing
    here whose leftovers are visible to every instructor rather than only to a query.
  */
  check(
    "...nor the courses the copy checks created",
    await db.course.count({ where: { name: { startsWith: "Verify Copy Target" } } }),
    0,
  );

  /*
    The one thing this script writes outside a transaction, removed.

    Checked rather than merely attempted, because the failure is silent and cumulative: a
    leftover course with a module in it is invisible in the interface a person looks at and
    shows up much later as a module list nobody recognises. `onDelete: Cascade` from course to
    modules takes the module with it.
  */
  await db.program.deleteMany({ where: { id: ELSEWHERE_PROGRAM_ID } });
  check(
    "the other program and course this script created are gone",
    (await db.course.count({ where: { name: { contains: "(verify:authoring)" } } })) +
      (await db.program.count({ where: { name: { contains: "(verify:authoring)" } } })),
    0,
  );
}

// Not top-level await: tsx compiles this to CommonJS, which rejects it.
procedures()
  .then(() => finish())
  .catch((err) => {
    console.error("\n", err);
    process.exit(1);
  });
