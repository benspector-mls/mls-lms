import {
  AssignmentConfigurationError,
  AssignmentKind,
  IMPLEMENTED_KINDS,
  assertKindImplemented,
  copyUrlFromTemplate,
  handInMethodsFor,
  hasAcceptStep,
  isAiGraded,
  NotRepositoryBackedError,
  parseAssignmentSpec,
  repositorySource,
  requiresRepository,
  sectionsPointTotal,
  UnsupportedAssignmentKindError,
  withDerivedFields,
} from "@/lib/assignments/spec";

/**
 * The rules that decide what a valid assignment is.
 *
 * Every case here is a rule that, if it silently stopped holding, would produce a confidently wrong
 * grade rather than an error — a section with no point value, a test pattern that matches nothing, a
 * repository-backed assignment with no repository. Those are the expensive failures, and they are
 * all cheap to check as functions.
 *
 * Nothing here reads a database, a network, or a model, so it runs on every save. The other half of
 * `verify:authoring` — the authoring procedures driven through tRPC callers — is
 * `tests/integration/authoring.test.ts`, where a database is required.
 *
 * `tests/lib/assignments/sections.test.ts` and `tests/lib/assignments/task-spec.test.ts` are the
 * two neighbours that already covered part of this ground: reading the stored `sections` column,
 * and everything a task is. Nineteen of the script's pure checks were already among them and are
 * not repeated here.
 *
 * **Two cases are stronger here than they were in the script.** "A manual section may not carry
 * answer keys" tested a rubric rather than answer keys, so it was the same case as the check above
 * it written twice; it names answer key paths now. And "an unknown runner preset is refused, and
 * the message names it" asserted only the field, so the second half of its own name went unchecked.
 */

/**
 * What a parse rejected, by field, so a case names the field and not just "threw".
 *
 * An unrecognised key is reported by Zod against the *object* rather than the key, which would make
 * "a manual section may not carry a rubric" and "...may not carry answer keys" indistinguishable —
 * both would read `sections.0`. The offending keys are appended so each case proves the specific
 * field was the one refused.
 */
function rejects(input: unknown): string[] | "accepted" {
  try {
    parseAssignmentSpec(input);
    return "accepted";
  } catch (err) {
    const issues = (
      err as { issues?: { path: (string | number)[]; code?: string; keys?: string[] }[] }
    ).issues;
    if (!issues) return [(err as Error).name];
    return issues.map((issue) => {
      const path = issue.path.join(".") || "(root)";
      return issue.keys?.length ? `${path}:${issue.keys.join(",")}` : path;
    });
  }
}

/**
 * Whether a parse refused, and named this field among its reasons.
 *
 * For the cases where the exact list is beside the point. An AI section handed to a kind that only
 * takes manual ones is refused several times over — the wrong `grading`, the missing `label`, and
 * five keys the shape does not recognise — and stating all of that would make the case about the
 * shape of the error rather than about the rule.
 */
function refusedOn(input: unknown, path: string): boolean {
  const result = rejects(input);
  return result !== "accepted" && result.some((entry) => entry.startsWith(path));
}

/** What a parse said about a field, so a case can hold the message as well as the field. */
function refusalMessages(input: unknown): string[] {
  try {
    parseAssignmentSpec(input);
    return [];
  } catch (err) {
    const issues = (err as { issues?: { message: string }[] }).issues;
    return issues ? issues.map((issue) => issue.message) : [(err as Error).message];
  }
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

const DOC_URL = "https://docs.google.com/document/d/1AbC_dEF-123/view";

const docSpec = {
  kind: AssignmentKind.GOOGLE_DRIVE,
  title: "Reflection: what I learned in mod 1",
  courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
  templateDriveUrl: DOC_URL,
  sections: [manualSection],
};

/*
  The two repositories an assignment names, normalized by the schema rather than by the form, so
  every caller stores one shape. Checked because this is the only place a URL becomes a column
  value: if the normalization stopped happening, the form would keep looking right and the column
  would hold a URL that no GitHub request could be built from.
*/
describe("the two repositories an assignment names", () => {
  it("a pasted template URL is stored as owner/repo", () => {
    expect(
      parseAssignmentSpec({
        ...repoSpec,
        templateRepo: "https://github.com/marcy-lms/swe-1-4-loops/tree/main",
      }).templateRepo,
    ).toBe("marcy-lms/swe-1-4-loops");
  });

  it("a pasted answer key URL is too", () => {
    expect(
      parseAssignmentSpec({
        ...repoSpec,
        answerKeyRepo: "https://github.com/The-Marcy-Lab-School/swe-assignment-grading-guides.git",
      }).answerKeyRepo,
    ).toBe("The-Marcy-Lab-School/swe-assignment-grading-guides");
  });

  it("a repository assignment must name an answer key repository", () => {
    expect(rejects({ ...repoSpec, answerKeyRepo: undefined })).toEqual(["answerKeyRepo"]);
  });

  it("something that is not a repository reference is refused", () => {
    expect(rejects({ ...repoSpec, answerKeyRepo: "just some words" })).toEqual(["answerKeyRepo"]);
  });

  it("a kind with no repository may not name an answer key repository", () => {
    expect(
      rejects({
        kind: AssignmentKind.GOOGLE_DRIVE,
        title: "Story Prep Worksheet",
        courseUnitId: repoSpec.courseUnitId,
        templateDriveUrl: "https://docs.google.com/document/d/abc123/view",
        answerKeyRepo: "The-Marcy-Lab-School/swe-assignment-grading-guides",
        sections: [manualSection],
      }),
    ).toEqual(["answerKeyRepo"]);
  });

  /*
    The folder, at any depth, and the root.

    Any depth because a private repository an instructor made this morning is arranged however they
    like — the `answer-keys/` prefix in the existing data is a directory in one repository, not a
    rule. The root because a repository holding a single assignment's solutions and nothing else
    needs no subdirectory, and `""` has to mean that rather than "unset".
  */
  it("an answer key folder may be at any depth", () => {
    expect(rejects({ ...repoSpec, answerKeyDir: "solutions/2026/spring/mod1" })).toBe("accepted");
  });

  it("the repository root is a legitimate answer key folder", () => {
    expect(rejects({ ...repoSpec, answerKeyDir: "" })).toBe("accepted");
  });

  it("and it is the default, so a repository of one assignment's keys needs nothing else", () => {
    expect(parseAssignmentSpec({ ...repoSpec, answerKeyDir: undefined }).answerKeyDir).toBe("");
  });

  // The column is interpolated into a GitHub contents URL, so a traversal is refused where it is
  // written rather than only where it is read.
  it("a folder escaping the repository is refused", () => {
    expect(rejects({ ...repoSpec, answerKeyDir: "../../../etc" })).toEqual(["answerKeyDir"]);
  });

  it("...including one that only climbs out halfway through", () => {
    expect(rejects({ ...repoSpec, answerKeyDir: "answer-keys/../../etc" })).toEqual([
      "answerKeyDir",
    ]);
  });

  it("an absolute path is refused", () => {
    expect(rejects({ ...repoSpec, answerKeyDir: "/etc/passwd" })).toEqual(["answerKeyDir"]);
  });

  it("a kind with no repository may not name an answer key folder", () => {
    expect(
      rejects({
        kind: AssignmentKind.GOOGLE_DRIVE,
        title: "Story Prep Worksheet",
        courseUnitId: repoSpec.courseUnitId,
        templateDriveUrl: "https://docs.google.com/document/d/abc123/view",
        answerKeyDir: "answer-keys/whatever",
        sections: [manualSection],
      }),
    ).toEqual(["answerKeyDir"]);
  });

  // Sections no longer name files at all, so one that tries is refused by `.strict()`. That is what
  // makes a stale ticked list impossible rather than merely discouraged.
  it("a section may not name answer key files", () => {
    expect(
      rejects({ ...repoSpec, sections: [{ ...codingSection, answerKeyPaths: ["a/b.js"] }] }),
    ).toEqual(["sections.0:answerKeyPaths"]);
  });
});

describe("the total is derived, never entered", () => {
  it("pointValue is the sum of the sections", () => {
    expect(parseAssignmentSpec(repoSpec).pointValue).toBe(30);
  });

  it("two sections sum", () => {
    expect(sectionsPointTotal([{ pointValue: 15 }, { pointValue: 25 }])).toBe(40);
  });

  it("a pointValue on the assignment is refused outright", () => {
    expect(rejects({ ...repoSpec, pointValue: 999 })).toEqual(["(root):pointValue"]);
  });

  it("a section with no point value is refused", () => {
    expect(
      rejects({
        ...repoSpec,
        sections: [{ grading: "ai", type: "coding_algorithm", rubricId: RUBRIC }],
      }),
    ).toEqual(["sections.0.pointValue"]);
  });

  it("a zero-point section is refused", () => {
    expect(rejects({ ...repoSpec, sections: [{ ...codingSection, pointValue: 0 }] })).toEqual([
      "sections.0.pointValue",
    ]);
  });

  it("an assignment with no sections is refused", () => {
    expect(rejects({ ...repoSpec, sections: [] })).toEqual(["sections"]);
  });
});

describe("sections describe something a rubric covers", () => {
  it("an unknown section type is refused", () => {
    expect(
      rejects({ ...repoSpec, sections: [{ ...codingSection, type: "coding_python" }] }),
    ).toEqual(["sections.0.type"]);
  });

  it("a section with no rubric is refused", () => {
    expect(rejects({ ...repoSpec, sections: [{ ...codingSection, rubricId: undefined }] })).toEqual(
      ["sections.0.rubricId"],
    );
  });

  /*
    A pattern with no `evidence: "tests"` is silently ignored, so the section is graded with no test
    evidence at all — the opposite of what naming a pattern means. This is the class of mistake the
    whole module exists for: nothing throws, and the report reads as though the tests were consulted.
  */
  it("a testNamePattern without evidence:tests is refused", () => {
    expect(
      rejects({
        ...repoSpec,
        sections: [{ ...codingSection, evidence: undefined, testNamePattern: "^from-scratch" }],
      }),
    ).toEqual(["sections.0.testNamePattern"]);
  });

  it("a testNamePattern with evidence:tests is accepted", () => {
    expect(
      rejects({ ...repoSpec, sections: [{ ...codingSection, testNamePattern: "^from-scratch" }] }),
    ).toBe("accepted");
  });
});

/*
  The two section shapes are deliberately not one shape with optional fields. A manual section that
  could carry a rubricId would eventually carry one that nothing applies, and an AI section that
  could omit its rubric would reach the model with nothing to score against. Each case below is one
  of those two mistakes being refused.
*/
describe("how a section is graded", () => {
  it("a section must say how it is graded", () => {
    expect(rejects({ ...repoSpec, sections: [{ ...codingSection, grading: undefined }] })).toEqual([
      "sections.0.grading",
    ]);
  });

  it("a manual section is accepted with just a label and points", () => {
    expect(rejects({ ...repoSpec, sections: [manualSection] })).toBe("accepted");
  });

  it("a manual section may not carry a rubric", () => {
    expect(rejects({ ...repoSpec, sections: [{ ...manualSection, rubricId: RUBRIC }] })).toEqual([
      "sections.0:rubricId",
    ]);
  });

  it("a manual section may not carry answer keys", () => {
    expect(
      rejects({ ...repoSpec, sections: [{ ...manualSection, answerKeyPaths: ["a/b.js"] }] }),
    ).toEqual(["sections.0:answerKeyPaths"]);
  });

  it("a manual section may not claim test evidence", () => {
    expect(rejects({ ...repoSpec, sections: [{ ...manualSection, evidence: "tests" }] })).toEqual([
      "sections.0:evidence",
    ]);
  });

  it("a manual section needs a label", () => {
    expect(rejects({ ...repoSpec, sections: [{ grading: "manual", pointValue: 10 }] })).toEqual([
      "sections.0.label",
    ]);
  });

  it("a manual section still needs a point value", () => {
    expect(
      rejects({ ...repoSpec, sections: [{ grading: "manual", label: "Reflection" }] }),
    ).toEqual(["sections.0.pointValue"]);
  });

  it("an AI section may not use a label instead of a type", () => {
    expect(rejects({ ...repoSpec, sections: [{ ...codingSection, label: "Whatever" }] })).toEqual([
      "sections.0:label",
    ]);
  });
});

/*
  One grading mode per assignment. A mix would mean a generated report covering some sections and
  not others: the draft carries only what the model wrote, so the assignment's point total would
  exceed what approving could record, and a 30-point assignment would release as 20 out of 20. Two
  assignments is the answer, and one section per assignment is the direction the curriculum is going
  anyway.

  Several sections graded the same way stay legitimate — the checkpoint has two, both graded by the
  pipeline — so the cases below are about modes, not about counting.
*/
describe("one grading mode per assignment", () => {
  it("an assignment may not mix graded-by-model and graded-by-hand sections", () => {
    expect(rejects({ ...repoSpec, sections: [codingSection, manualSection] })).toEqual([
      "sections",
    ]);
  });

  it("several sections graded the same way are accepted, and both count toward the total", () => {
    expect(
      parseAssignmentSpec({
        ...repoSpec,
        sections: [codingSection, { ...codingSection, type: "short_response", pointValue: 15 }],
      }).pointValue,
    ).toBe(45);
  });

  it("isAiGraded reads the mode off each section", () => {
    expect(
      parseAssignmentSpec({ ...repoSpec, sections: [codingSection] }).sections.map(isAiGraded),
    ).toEqual([true]);
  });
});

/*
  Test evidence is derived, never asked. The rule has no cases an instructor could usefully disagree
  with, which is why the checkbox that used to ask went away. What `derivesTestEvidence` answers for
  each section type is `tests/lib/assignments/sections.test.ts`; what follows is the derivation
  applied to a whole draft.
*/
describe("filling in what an author does not type", () => {
  it("a draft that omits evidence has it filled in", () => {
    const derived = withDerivedFields({
      runnerPreset: "node-jest",
      sections: [{ ...codingSection, evidence: undefined }],
    }) as { sections: { evidence?: string }[] };

    expect(derived.sections[0].evidence).toBe("tests");
  });

  it("a draft that wrongly claims it has it removed", () => {
    const derived = withDerivedFields({
      runnerPreset: "none",
      sections: [{ ...codingSection }],
    }) as { sections: { evidence?: string }[] };

    expect(derived.sections[0].evidence).toBeUndefined();
  });

  /*
    A pattern with no evidence declaration is refused by the schema. Clearing it alongside the flag
    means an author who turns the runner off does not then face a validation error about a field the
    form no longer shows.
  */
  it("a stranded testNamePattern is cleared rather than left to fail validation", () => {
    const derived = withDerivedFields({
      runnerPreset: "none",
      sections: [{ ...codingSection, testNamePattern: "^from-scratch" }],
    }) as { sections: { testNamePattern?: string }[] };

    expect(derived.sections[0].testNamePattern).toBeUndefined();
  });

  // The raw draft would be refused for exactly that stranded pattern; the derived one passes.
  it("...so the raw draft is refused", () => {
    expect(
      rejects({
        ...repoSpec,
        runnerPreset: "none",
        sections: [{ ...codingSection, evidence: undefined, testNamePattern: "^from-scratch" }],
      }),
    ).toEqual(["sections.0.testNamePattern"]);
  });

  it("...and the derived draft is accepted", () => {
    expect(
      rejects(
        withDerivedFields({
          ...repoSpec,
          runnerPreset: "none",
          sections: [{ ...codingSection, testNamePattern: "^from-scratch" }],
        }),
      ),
    ).toBe("accepted");
  });
});

describe("the kind axis", () => {
  it("REPO requires a template repository", () => {
    expect(rejects({ ...repoSpec, templateRepo: undefined })).toEqual(["templateRepo"]);
  });

  it("REPO requires an org", () => {
    expect(rejects({ ...repoSpec, githubOrg: undefined })).toEqual(["githubOrg"]);
  });

  it("a templateRepo that is not owner/repo is refused", () => {
    expect(rejects({ ...repoSpec, templateRepo: "swe-1-4-loops" })).toEqual(["templateRepo"]);
  });

  it("a repo name with a slash in it is refused", () => {
    expect(rejects({ ...repoSpec, assignmentRepoName: "a/b" })).toEqual(["assignmentRepoName"]);
  });

  it("an unknown runner preset is refused, and the message names it", () => {
    expect(rejects({ ...repoSpec, runnerPreset: "npx-jest-typo" })).toEqual(["runnerPreset"]);
    expect(refusalMessages({ ...repoSpec, runnerPreset: "npx-jest-typo" }).join(" ")).toContain(
      "npx-jest-typo",
    );
  });

  it("the none preset is accepted", () => {
    expect(rejects({ ...repoSpec, runnerPreset: "none" })).toBe("accepted");
  });

  it("an unknown kind is refused", () => {
    expect(rejects({ ...repoSpec, kind: "SLACK_MESSAGE" })).toEqual(["kind"]);
  });
});

describe("a Google Drive assignment", () => {
  it("needs no repository fields", () => {
    expect(rejects(docSpec)).toBe("accepted");
  });

  it("...and its repository fields come out null", () => {
    const parsed = parseAssignmentSpec(docSpec);
    expect([parsed.templateRepo, parsed.assignmentRepoName, parsed.githubOrg]).toEqual([
      null,
      null,
      null,
    ]);
  });

  /*
    No repository means no template to take a suite from, so there is nothing to run. Accepting a
    runner here would produce an assignment that looks like it has test evidence and can never have
    any.
  */
  it("may not name a runner", () => {
    expect(rejects({ ...docSpec, runnerPreset: "node-jest" })).toEqual(["runnerPreset"]);
  });

  it("may not name a repository", () => {
    expect(rejects({ ...docSpec, templateRepo: "marcy-lms/whatever" })).toEqual(["templateRepo"]);
  });
});

/*
  A document assignment is distributed by its template link and nothing else, so the link is
  required and its shape is checked rather than trusted. The shape matters because
  `copyUrlFromTemplate` works by replacing the last path segment: a URL that does not match is one
  the substitution would leave untouched, sending every student to the instructor's own document to
  edit in place. That is the failure this pattern exists to prevent.
*/
describe("the template link a Drive assignment is handed out by", () => {
  it("a Google Drive assignment needs a template file", () => {
    expect(rejects({ ...docSpec, templateDriveUrl: undefined })).toEqual(["templateDriveUrl"]);
  });

  it("a link that is not a Drive editor link is refused", () => {
    expect(rejects({ ...docSpec, templateDriveUrl: "https://example.com/some/doc/view" })).toEqual([
      "templateDriveUrl",
    ]);
  });

  it("a Drive link with no final segment is refused", () => {
    expect(
      rejects({
        ...docSpec,
        templateDriveUrl: "https://docs.google.com/document/d/1AbC_dEF-123",
      }),
    ).toEqual(["templateDriveUrl"]);
  });

  it("a REPO assignment may not name a template file", () => {
    expect(rejects({ ...repoSpec, templateDriveUrl: DOC_URL })).toEqual(["templateDriveUrl"]);
  });
});

/*
  Three editors, one kind.

  A Doc, a Sheet, and a Slides deck are handed out as a `/copy` link built the same way, handed in
  as a link, and graded by hand — so they were never three kinds, they were one kind named after the
  only editor it happened to accept. What each pair below actually proves is that the substitution
  still lands, because a pattern widened without the substitution being widened with it would accept
  the link and then send every student to the instructor's own file.
*/
describe("the three editors one Drive kind covers", () => {
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/1AbC_dEF-123/edit";
  const SLIDES_URL = "https://docs.google.com/presentation/d/1AbC_dEF-123/edit";

  it("a Sheets link is accepted", () => {
    expect(rejects({ ...docSpec, templateDriveUrl: SHEET_URL })).toBe("accepted");
  });

  it("...and takes a copy prompt", () => {
    expect(copyUrlFromTemplate(SHEET_URL)).toBe(
      "https://docs.google.com/spreadsheets/d/1AbC_dEF-123/copy",
    );
  });

  it("a Slides link is accepted", () => {
    expect(rejects({ ...docSpec, templateDriveUrl: SLIDES_URL })).toBe("accepted");
  });

  it("...and takes a copy prompt", () => {
    expect(copyUrlFromTemplate(SLIDES_URL)).toBe(
      "https://docs.google.com/presentation/d/1AbC_dEF-123/copy",
    );
  });

  it("a Slides link carrying a slide anchor is accepted, and drops it with the segment", () => {
    expect(
      copyUrlFromTemplate("https://docs.google.com/presentation/d/1AbC_dEF-123/edit#slide=id.p"),
    ).toBe("https://docs.google.com/presentation/d/1AbC_dEF-123/copy");
  });

  it("a Sheets link carrying a tab anchor does too", () => {
    expect(
      copyUrlFromTemplate("https://docs.google.com/spreadsheets/d/1AbC_dEF-123/edit#gid=0"),
    ).toBe("https://docs.google.com/spreadsheets/d/1AbC_dEF-123/copy");
  });

  /*
    Named editors rather than any Google address, which is the half a widened pattern gets wrong.
    None of these produces a copy prompt from the substitution, and each would fail on the student's
    side rather than on the field where it was typed.
  */
  it("a Google Form is refused, because /copy is not how one is shared", () => {
    expect(
      rejects({
        ...docSpec,
        templateDriveUrl: "https://docs.google.com/forms/d/1AbC_dEF-123/edit",
      }),
    ).toEqual(["templateDriveUrl"]);
  });

  it("a published link is refused", () => {
    expect(
      rejects({
        ...docSpec,
        templateDriveUrl: "https://docs.google.com/document/d/1AbC_dEF-123/pub",
      }),
    ).toEqual(["templateDriveUrl"]);
  });

  it("a Drive folder is refused", () => {
    expect(
      rejects({
        ...docSpec,
        templateDriveUrl: "https://drive.google.com/drive/folders/1AbC_dEF-123",
      }),
    ).toEqual(["templateDriveUrl"]);
  });

  it("/view becomes /copy", () => {
    expect(copyUrlFromTemplate(DOC_URL)).toBe(
      "https://docs.google.com/document/d/1AbC_dEF-123/copy",
    );
  });

  // What Google's Share dialog actually hands over, query string and all.
  it("/edit?usp=sharing becomes /copy", () => {
    expect(
      copyUrlFromTemplate("https://docs.google.com/document/d/1AbC_dEF-123/edit?usp=sharing"),
    ).toBe("https://docs.google.com/document/d/1AbC_dEF-123/copy");
  });
});

/*
  A document has no pull request, no changed files, and no test suite, so there is nothing for the
  pipeline to read. An AI section here would validate, save, sit in the queue as a report waiting to
  be generated, and fail on the missing pull request at the moment an instructor asked for it —
  refusing it at authoring time is the difference between an assignment that cannot be built wrong
  and one that breaks the first time it is used.
*/
describe("kinds the pipeline cannot grade", () => {
  it("a Google Drive assignment may not have a section the model grades", () => {
    expect(refusedOn({ ...docSpec, sections: [codingSection] }, "sections.0.grading")).toBe(true);
  });

  it("a self-directed assignment may not either", () => {
    expect(
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
    ).toBe(true);
  });

  it("a self-directed assignment needs no template of any kind", () => {
    expect(
      rejects({
        kind: AssignmentKind.SELF_DIRECTED,
        title: "Resume, first draft",
        courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
        handInMethods: ["FILE"],
        sections: [manualSection],
        acceptedFileTypes: ["pdf"],
      }),
    ).toBe("accepted");
  });
});

/*
  How a self-directed assignment is handed in — the field this kind exists for. At least one way in,
  and both is the case it was built for: a reflection taken as a document, a deck, or a short
  recording is one assignment.
*/
describe("how a self-directed assignment is handed in", () => {
  const uploadSpec = {
    kind: AssignmentKind.SELF_DIRECTED,
    title: "Resume, first draft",
    courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
    handInMethods: ["FILE"],
    sections: [manualSection],
    acceptedFileTypes: ["pdf"],
  };

  it("a self-directed assignment must say at least one way in", () => {
    expect(refusedOn({ ...uploadSpec, handInMethods: [] }, "handInMethods")).toBe(true);
  });

  it("and is refused when the key is missing entirely", () => {
    expect(refusedOn({ ...uploadSpec, handInMethods: undefined }, "handInMethods")).toBe(true);
  });

  it("an unknown method is refused", () => {
    expect(refusedOn({ ...uploadSpec, handInMethods: ["EMAIL"] }, "handInMethods.0")).toBe(true);
  });

  it("a duplicated method is refused", () => {
    expect(refusedOn({ ...uploadSpec, handInMethods: ["FILE", "FILE"] }, "handInMethods")).toBe(
      true,
    );
  });

  it("both ways in are accepted together", () => {
    expect(
      parseAssignmentSpec({ ...uploadSpec, handInMethods: ["LINK", "FILE"] }).handInMethods,
    ).toEqual(["LINK", "FILE"]);
  });

  /*
    What a file upload accepts, never defaulted to "anything". An assignment that accepts anything
    cannot tell a student their file is the wrong kind until an instructor opens it and finds a
    screenshot where a PDF was wanted, by which point the due date has passed.
  */
  it("an assignment handed in as a file must say what it accepts", () => {
    expect(refusedOn({ ...uploadSpec, acceptedFileTypes: [] }, "acceptedFileTypes")).toBe(true);
  });

  it("and it is refused when the key is missing entirely", () => {
    expect(refusedOn({ ...uploadSpec, acceptedFileTypes: undefined }, "acceptedFileTypes")).toBe(
      true,
    );
  });

  it("an unknown file type is refused", () => {
    expect(
      refusedOn({ ...uploadSpec, acceptedFileTypes: ["powerpoint"] }, "acceptedFileTypes.0"),
    ).toBe(true);
  });

  it("a duplicated file type is refused", () => {
    expect(
      refusedOn({ ...uploadSpec, acceptedFileTypes: ["pdf", "pdf"] }, "acceptedFileTypes"),
    ).toBe(true);
  });

  it("several types are accepted", () => {
    expect(
      parseAssignmentSpec({ ...uploadSpec, acceptedFileTypes: ["pdf", "image"] }).acceptedFileTypes,
    ).toEqual(["pdf", "image"]);
  });

  // The mirror of the repository columns: a kind that is not handed in as a file accepts none, and
  // says so as an empty list rather than leaving the column to mean two things.
  it("a Google Drive assignment accepts no file types", () => {
    expect(parseAssignmentSpec(docSpec).acceptedFileTypes).toEqual([]);
  });

  it("and may not declare any", () => {
    expect(refusedOn({ ...docSpec, acceptedFileTypes: ["pdf"] }, "acceptedFileTypes.0")).toBe(true);
  });
});

/*
  Work made somewhere else: handed in as a link, like a Drive file, and distributed like nothing at
  all. The distinction that matters is which of those two halves each rule follows.
*/
describe("work made somewhere else and handed in as a link", () => {
  const linkSpec = {
    kind: AssignmentKind.SELF_DIRECTED,
    title: "Personal site (Canva)",
    courseUnitId: "e7c1a1d0-0000-4000-8000-000000000001",
    handInMethods: ["LINK"],
    sections: [manualSection],
  };

  it("a link-only assignment needs nothing but a title, a module, a way in, and a section", () => {
    expect(rejects(linkSpec)).toBe("accepted");
  });

  it("it has no repository", () => {
    expect(parseAssignmentSpec(linkSpec).templateRepo).toBeNull();
  });

  it("no runner", () => {
    expect(parseAssignmentSpec(linkSpec).runnerPreset).toBe("none");
  });

  it("no file types", () => {
    expect(parseAssignmentSpec(linkSpec).acceptedFileTypes).toEqual([]);
  });

  // No template of any kind, and deliberately no field for one: a starting link belongs in the
  // markdown instructions, where it can say what to do with it.
  it("and no template document", () => {
    expect(parseAssignmentSpec(linkSpec).templateDriveUrl).toBeNull();
  });

  it("a template file may not be set on it", () => {
    expect(
      refusedOn(
        { ...linkSpec, templateDriveUrl: "https://docs.google.com/document/d/x/view" },
        "templateDriveUrl",
      ),
    ).toBe(true);
  });

  // The mirror of "a file assignment must say what it accepts": the same kind, handed in the other
  // way, refuses the types rather than requiring them. Both halves live in the one superRefine, so
  // neither can be satisfied while the other is forgotten.
  it("nor may file types, when a file is not one of the ways in", () => {
    expect(refusedOn({ ...linkSpec, acceptedFileTypes: ["pdf"] }, "acceptedFileTypes")).toBe(true);
  });

  it("nor a runner preset", () => {
    expect(refusedOn({ ...linkSpec, runnerPreset: "node-jest" }, "runnerPreset")).toBe(true);
  });

  // The pipeline's inputs are a pull request's files and a template's tests. This kind has neither,
  // so an AI section would sit in the queue as a report waiting to be generated and fail at the
  // moment an instructor asked for it.
  it("and no section the model grades", () => {
    expect(refusedOn({ ...linkSpec, sections: [codingSection] }, "sections.0.grading")).toBe(true);
  });
});

/*
  How each kind is handed in, asked of the one function every caller asks. A repository answers with
  nothing rather than with a method, because opening a pull request is not a form anything draws —
  and a self-directed assignment answers with whatever its instructor chose, which is the whole
  reason this cannot be a question about a kind alone.

  What a task answers is `tests/lib/assignments/task-spec.test.ts`.
*/
describe("handInMethodsFor", () => {
  it("a repository is handed in by neither method", () => {
    expect(handInMethodsFor({ kind: AssignmentKind.REPO, handInMethods: [] })).toEqual([]);
  });

  it("a Drive assignment is handed in as a link, whatever the column says", () => {
    expect(handInMethodsFor({ kind: AssignmentKind.GOOGLE_DRIVE, handInMethods: [] })).toEqual([
      "LINK",
    ]);
  });

  it("and a stray value on one is ignored rather than believed", () => {
    expect(
      handInMethodsFor({ kind: AssignmentKind.GOOGLE_DRIVE, handInMethods: ["FILE"] }),
    ).toEqual(["LINK"]);
  });

  it("a self-directed assignment is handed in whichever ways it names", () => {
    expect(
      handInMethodsFor({ kind: AssignmentKind.SELF_DIRECTED, handInMethods: ["LINK", "FILE"] }),
    ).toEqual(["LINK", "FILE"]);
  });

  it("the two fixed kinds store no choice of their own", () => {
    expect([
      parseAssignmentSpec(docSpec).handInMethods,
      parseAssignmentSpec(repoSpec).handInMethods,
    ]).toEqual([[], []]);
  });
});

// Optional on every kind, because each kind's own screen states the mechanical steps already.
describe("submission instructions", () => {
  it("are optional and default to null", () => {
    expect(parseAssignmentSpec(docSpec).submissionInstructions).toBeNull();
  });

  it("are kept when given", () => {
    expect(
      parseAssignmentSpec({ ...docSpec, submissionInstructions: "Paste your link." })
        .submissionInstructions,
    ).toBe("Paste your link.");
  });
});

describe("narrowing at the point of use", () => {
  it("REPO requires a repository", () => {
    expect(requiresRepository(AssignmentKind.REPO)).toBe(true);
  });

  it("GOOGLE_DRIVE does not", () => {
    expect(requiresRepository(AssignmentKind.GOOGLE_DRIVE)).toBe(false);
  });

  it("all four kinds are implemented", () => {
    expect([...IMPLEMENTED_KINDS].sort()).toEqual(
      [
        AssignmentKind.GOOGLE_DRIVE,
        AssignmentKind.REPO,
        AssignmentKind.SELF_DIRECTED,
        AssignmentKind.TASK,
      ].sort(),
    );
  });

  it("a self-directed kind is not repository-backed", () => {
    expect(requiresRepository(AssignmentKind.SELF_DIRECTED)).toBe(false);
  });

  it("and it has no Accept", () => {
    expect(hasAcceptStep(AssignmentKind.SELF_DIRECTED)).toBe(false);
  });

  it("repositorySource narrows a REPO row", () => {
    expect(
      repositorySource({
        kind: AssignmentKind.REPO,
        templateRepo: "marcy-lms/swe-1-4-loops",
        assignmentRepoName: "swe-1-4-loops",
        githubOrg: "marcy-lms",
        templateRef: null,
      }),
    ).toEqual({
      templateRepo: "marcy-lms/swe-1-4-loops",
      assignmentRepoName: "swe-1-4-loops",
      githubOrg: "marcy-lms",
      templateRef: null,
    });
  });
});

/*
  Three failures that must not be reported as one another, and the first two are opposites: a Google
  Drive assignment *works* and simply has no repository, while a kind nobody has built is a feature
  that does not exist. A REPO row with no org is the third and the only one an instructor can act on
  — a row that should never have been written.
*/
describe("the three ways asking for a repository fails", () => {
  /** The error's name, which is what tells the three cases apart. */
  function errName(run: () => unknown): string {
    try {
      run();
      return "no error";
    } catch (err) {
      return err instanceof Error ? err.name : String(err);
    }
  }

  it("asking a Google Drive assignment for a repository throws NotRepositoryBackedError", () => {
    expect(
      errName(() =>
        repositorySource({
          kind: AssignmentKind.GOOGLE_DRIVE,
          templateRepo: null,
          assignmentRepoName: null,
          githubOrg: null,
        }),
      ),
    ).toBe(new NotRepositoryBackedError(AssignmentKind.GOOGLE_DRIVE).name);
  });

  /*
    Every kind in the enum is implemented, so this is checked against a value that is not one at all.
    The guard still has to hold: it is what a future kind meets before anything downstream tries to
    grade it, and the only way to prove it still refuses is to hand it something unknown.
  */
  it("a kind that is not implemented throws UnsupportedAssignmentKindError", () => {
    expect(errName(() => assertKindImplemented("PRESENTATION" as AssignmentKind))).toBe(
      new UnsupportedAssignmentKindError(AssignmentKind.GOOGLE_DRIVE).name,
    );
  });

  it("a REPO row missing a column throws AssignmentConfigurationError", () => {
    expect(
      errName(() =>
        repositorySource({
          kind: AssignmentKind.REPO,
          templateRepo: "marcy-lms/swe-1-4-loops",
          assignmentRepoName: "swe-1-4-loops",
          githubOrg: null,
        }),
      ),
    ).toBe(new AssignmentConfigurationError("").name);
  });

  it("...and the message names the missing column", () => {
    let message = "";
    try {
      repositorySource({
        kind: AssignmentKind.REPO,
        templateRepo: "marcy-lms/swe-1-4-loops",
        assignmentRepoName: "swe-1-4-loops",
        githubOrg: null,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : "";
    }

    expect(message).toContain("githubOrg");
  });
});
