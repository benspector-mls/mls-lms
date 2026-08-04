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
 * This grows as the authoring procedures land. What it covers today is
 * `lib/assignments/spec.ts` and the kind axis.
 */
import {
  AssignmentConfigurationError,
  AssignmentKind,
  IMPLEMENTED_KINDS,
  isAiGraded,
  isManualOnly,
  parseAssignmentSpec,
  repositorySource,
  requiresRepository,
  sectionsPointTotal,
  UnsupportedAssignmentKindError,
} from "../lib/assignments/spec";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); }
  else console.log(`ok   ${label}`);
}

/**
 * What a parse rejected, by field, so a check names the field and not just "threw".
 *
 * An unrecognised key is reported by Zod against the *object* rather than the key, which
 * would make "a manual section may not carry a rubric" and "...may not carry answer keys"
 * indistinguishable — both would read `sections.0`. The offending keys are appended so each
 * check proves the specific field was the one refused.
 */
function rejects(input: unknown): string[] | "accepted" {
  try {
    parseAssignmentSpec(input);
    return "accepted";
  } catch (err) {
    const issues = (err as {
      issues?: { path: (string | number)[]; code?: string; keys?: string[] }[];
    }).issues;
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
  answerKeyPaths: ["mod-1-js-fundamentals/swe-1-4-loops/from-scratch.js"],
  reportTemplate: "coding-fluency",
  evidence: "tests",
} as const;

const manualSection = { grading: "manual", label: "Reflection", pointValue: 10 } as const;

const repoSpec = {
  kind: AssignmentKind.REPO,
  title: "swe-1-4-loops",
  moduleTag: "mod-1-js-fundamentals",
  templateRepo: "marcy-lms-test/swe-1-4-loops",
  assignmentRepoName: "swe-1-4-loops",
  githubOrg: "marcy-lms-test",
  runnerPreset: "node-jest",
  sections: [codingSection],
};

// --- the total is derived, never entered --------------------------------------
check("pointValue is the sum of the sections", parseAssignmentSpec(repoSpec).pointValue, 30);
check("two sections sum", sectionsPointTotal([{ pointValue: 15 }, { pointValue: 25 }]), 40);
check("a pointValue on the assignment is refused outright",
  rejects({ ...repoSpec, pointValue: 999 }), ["(root):pointValue"]);
check("a section with no point value is refused",
  rejects({ ...repoSpec, sections: [{ grading: "ai", type: "coding_algorithm", rubricId: RUBRIC }] }),
  ["sections.0.pointValue"]);
check("a zero-point section is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, pointValue: 0 }] }),
  ["sections.0.pointValue"]);
check("an assignment with no sections is refused", rejects({ ...repoSpec, sections: [] }), ["sections"]);

// --- sections describe something a rubric covers ------------------------------
check("an unknown section type is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, type: "coding_python" }] }),
  ["sections.0.type"]);
check("a section with no rubric is refused",
  rejects({ ...repoSpec, sections: [{ ...codingSection, rubricId: undefined }] }),
  ["sections.0.rubricId"]);
/*
  A pattern with no `evidence: "tests"` is silently ignored, so the section is graded
  with no test evidence at all — the opposite of what naming a pattern means. This is
  the class of mistake the whole module exists for: nothing throws, and the report
  reads as though the tests were consulted.
*/
check("a testNamePattern without evidence:tests is refused",
  rejects({
    ...repoSpec,
    sections: [{ ...codingSection, evidence: undefined, testNamePattern: "^from-scratch" }],
  }),
  ["sections.0.testNamePattern"]);
check("a testNamePattern with evidence:tests is accepted",
  rejects({ ...repoSpec, sections: [{ ...codingSection, testNamePattern: "^from-scratch" }] }),
  "accepted");

// --- how a section is graded --------------------------------------------------
/*
  The two section shapes are deliberately not one shape with optional fields. A manual
  section that could carry a rubricId would eventually carry one that nothing applies, and
  an AI section that could omit its rubric would reach the model with nothing to score
  against. Each check below is one of those two mistakes being refused.
*/
check("a section must say how it is graded",
  rejects({ ...repoSpec, sections: [{ ...codingSection, grading: undefined }] }),
  ["sections.0.grading"]);
check("a manual section is accepted with just a label and points",
  rejects({ ...repoSpec, sections: [manualSection] }), "accepted");
check("a manual section may not carry a rubric",
  rejects({ ...repoSpec, sections: [{ ...manualSection, rubricId: RUBRIC }] }),
  ["sections.0:rubricId"]);
check("a manual section may not carry answer keys",
  rejects({ ...repoSpec, sections: [{ ...manualSection, answerKeyPaths: ["a/b.js"] }] }),
  ["sections.0:answerKeyPaths"]);
check("a manual section may not claim test evidence",
  rejects({ ...repoSpec, sections: [{ ...manualSection, evidence: "tests" }] }),
  ["sections.0:evidence"]);
check("a manual section needs a label",
  rejects({ ...repoSpec, sections: [{ grading: "manual", pointValue: 10 }] }),
  ["sections.0.label"]);
check("a manual section still needs a point value",
  rejects({ ...repoSpec, sections: [{ grading: "manual", label: "Reflection" }] }),
  ["sections.0.pointValue"]);
check("an AI section may not use a label instead of a type",
  rejects({ ...repoSpec, sections: [{ ...codingSection, label: "Whatever" }] }),
  ["sections.0:label"]);

// Mixed is legitimate: a repository assignment can have work the pipeline grades and work
// an instructor scores by hand, and the total is still the sum of both.
check("ai and manual sections can coexist, and both count toward the total",
  parseAssignmentSpec({ ...repoSpec, sections: [codingSection, manualSection] }).pointValue,
  40);
check("isAiGraded splits them",
  parseAssignmentSpec({ ...repoSpec, sections: [codingSection, manualSection] })
    .sections.map(isAiGraded),
  [true, false]);
check("manual-only is detected", isManualOnly([manualSection]), true);
check("a mix is not manual-only", isManualOnly([codingSection, manualSection]), false);
check("no sections is not manual-only", isManualOnly([]), false);

// --- the kind axis ------------------------------------------------------------
check("REPO requires a template repository",
  rejects({ ...repoSpec, templateRepo: undefined }), ["templateRepo"]);
check("REPO requires an org", rejects({ ...repoSpec, githubOrg: undefined }), ["githubOrg"]);
check("a templateRepo that is not owner/repo is refused",
  rejects({ ...repoSpec, templateRepo: "swe-1-4-loops" }), ["templateRepo"]);
check("a repo name with a slash in it is refused",
  rejects({ ...repoSpec, assignmentRepoName: "a/b" }), ["assignmentRepoName"]);
check("an unknown runner preset is refused, and the message names it",
  rejects({ ...repoSpec, runnerPreset: "npx-jest-typo" }), ["runnerPreset"]);
check("the none preset is accepted", rejects({ ...repoSpec, runnerPreset: "none" }), "accepted");

const docSpec = {
  kind: AssignmentKind.GOOGLE_DOC,
  title: "Reflection: what I learned in mod 1",
  moduleTag: "mod-1-js-fundamentals",
  sections: [manualSection],
};

check("a Google Doc assignment needs no repository fields", rejects(docSpec), "accepted");
check("...and its repository fields come out null", (() => {
  const parsed = parseAssignmentSpec(docSpec);
  return [parsed.templateRepo, parsed.assignmentRepoName, parsed.githubOrg];
})(), [null, null, null]);
/*
  No repository means no template to take a suite from, so there is nothing to run.
  Accepting a runner here would produce an assignment that looks like it has test
  evidence and can never have any.
*/
check("a Google Doc assignment may not name a runner",
  rejects({ ...docSpec, runnerPreset: "node-jest" }), ["runnerPreset"]);
check("a Google Doc assignment may not name a repository",
  rejects({ ...docSpec, templateRepo: "marcy-lms-test/whatever" }), ["templateRepo"]);
check("an unknown kind is refused", rejects({ ...repoSpec, kind: "SLACK_MESSAGE" }), ["kind"]);

// --- narrowing at the point of use -------------------------------------------
check("REPO requires a repository", requiresRepository(AssignmentKind.REPO), true);
check("GOOGLE_DOC does not", requiresRepository(AssignmentKind.GOOGLE_DOC), false);
check("only REPO is implemented today", [...IMPLEMENTED_KINDS], [AssignmentKind.REPO]);

check("repositorySource narrows a REPO row",
  repositorySource({
    kind: AssignmentKind.REPO,
    templateRepo: "marcy-lms-test/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: "marcy-lms-test",
    templateRef: null,
  }),
  {
    templateRepo: "marcy-lms-test/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: "marcy-lms-test",
    templateRef: null,
  });

/*
  Two failures that must not be reported as one another. A Google Doc assignment is a
  feature that does not exist; a REPO assignment with no org is a row that should never
  have been written. An instructor can act on the second and not on the first.
*/
let unsupported = "";
try {
  repositorySource({
    kind: AssignmentKind.GOOGLE_DOC,
    templateRepo: null,
    assignmentRepoName: null,
    githubOrg: null,
  });
} catch (err) { unsupported = errName(err); }
check("an unimplemented kind throws UnsupportedAssignmentKindError",
  unsupported, new UnsupportedAssignmentKindError(AssignmentKind.GOOGLE_DOC).name);

let misconfigured = "", misconfiguredMessage = "";
try {
  repositorySource({
    kind: AssignmentKind.REPO,
    templateRepo: "marcy-lms-test/swe-1-4-loops",
    assignmentRepoName: "swe-1-4-loops",
    githubOrg: null,
  });
} catch (err) {
  misconfigured = errName(err);
  misconfiguredMessage = err instanceof Error ? err.message : "";
}
check("a REPO row missing a column throws AssignmentConfigurationError",
  misconfigured, new AssignmentConfigurationError("").name);
check("...and the message names the missing column",
  misconfiguredMessage.includes("githubOrg"), true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
