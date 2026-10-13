import {
  extractRubricSection,
  GUIDANCE,
  portedRubricText,
  splitAgentRules,
  TOOLKIT_RUBRICS,
} from "@/lib/rubrics/port";

/**
 * How the toolkit's files are divided into rows.
 *
 * The port is run once against each database and nobody reads its output twice, so what it does
 * with the files has to be right by construction: a scoring section left in the rule set would
 * reach every rubric in the program, including a resume rubric with no questions to score, and a
 * scoring section dropped would take the arithmetic out of the prompt it belonged to.
 */

const AGENT_RULES = [
  "# Overview",
  "",
  "I'm grading student assessments.",
  "",
  "- Reports are written **to** the student.",
  "- Whenever a student's submission branch isn't named `draft` — add a note. Do not deduct.",
  "",
  "## Writing the report (all report types)",
  "",
  "### Tone",
  "",
  "- Honest and warm.",
  "",
  "## Scoring short response reports",
  "",
  "The Writing Quality score is a single score.",
  "",
  "- A question section holds Praise.",
  "",
  "## Scoring coding — frontend reports",
  "",
  "Copy each checklist item verbatim.",
  "",
  "## Recommended Resources (all report types)",
  "",
  "At the end of each report, add resources.",
].join("\n");

describe("splitAgentRules", () => {
  const split = splitAgentRules(AGENT_RULES);

  it("keeps the tone and layout sections as the rule set, in order", () => {
    expect(split.ruleSet).toContain("# Overview");
    expect(split.ruleSet).toContain("## Writing the report (all report types)");
    expect(split.ruleSet).toContain("- Honest and warm.");
    expect(split.ruleSet.indexOf("# Overview")).toBeLessThan(
      split.ruleSet.indexOf("## Writing the report"),
    );
  });

  it("takes each scoring section out of the rule set, heading included", () => {
    expect(split.ruleSet).not.toContain("Scoring short response reports");
    expect(split.ruleSet).not.toContain("single score");
    expect(split.ruleSet).not.toContain("Scoring coding — frontend reports");
    expect(split.ruleSet).not.toContain("verbatim");
  });

  it("gives each scoring section to its rubric, whole", () => {
    expect(split.scoring.short_response).toBe(
      [
        "## Scoring short response reports",
        "",
        "The Writing Quality score is a single score.",
        "",
        "- A question section holds Praise.",
      ].join("\n"),
    );
    expect(split.scoring.coding_frontend).toBe(
      ["## Scoring coding — frontend reports", "", "Copy each checklist item verbatim."].join("\n"),
    );
    expect(split.scoring.coding_algorithm).toBeUndefined();
    expect(split.scoring.coding_sql).toBeUndefined();
  });

  // The pipeline tells the model about the branch itself, in the user half of the prompt. A rule
  // set that repeated it would say it twice to a repository assignment and once, about a branch
  // that does not exist, to a Google Doc.
  it("drops the branch rule and nothing else from the overview", () => {
    expect(split.ruleSet).not.toContain("isn't named `draft`");
    expect(split.ruleSet).toContain("- Reports are written **to** the student.");
  });

  // Not a scoring section, so it stays where it was: the port moves nothing it was not told to.
  it("leaves a section after the scoring sections in the rule set", () => {
    expect(split.ruleSet).toContain("## Recommended Resources (all report types)");
    expect(split.ruleSet).toContain("At the end of each report, add resources.");
  });
});

describe("portedRubricText", () => {
  const rubric = [
    "# Grading Rubric",
    "",
    "## SHORT RESPONSE",
    "",
    "Short response bands.",
    "",
    "## CODING — ALGORITHM FLUENCY",
    "",
    "Algorithm bands.",
    "",
    "## CODING — SQL FLUENCY",
    "",
    "SQL bands.",
  ].join("\n");

  it("slices the rubric's own section out of rubric.md", () => {
    const text = portedRubricText("short_response", { rubric, sample: "S", scoring: undefined });
    expect(text.rubricMarkdown).toBe("## SHORT RESPONSE\n\nShort response bands.");
  });

  // The guidance is the scoring rules that used to be hardcoded per type, followed by the
  // scoring section that used to sit in agent-rules.md — so the prompt holds the same words it
  // held before the port, in the same order relative to each other.
  it("appends the scoring section to the hardcoded guidance", () => {
    const text = portedRubricText("short_response", {
      rubric,
      sample: "S",
      scoring: "## Scoring short response reports\n\nThe formula.",
    });
    expect(text.guidanceMarkdown).toBe(
      `${GUIDANCE.short_response}\n\n## Scoring short response reports\n\nThe formula.`,
    );
  });

  it("carries no sample for a rubric that has none", () => {
    const text = portedRubricText("coding_sql", { rubric, sample: null, scoring: undefined });
    expect(text.sampleReportMarkdown).toBeNull();
  });

  it("is the hardcoded guidance alone for a rubric with no scoring section", () => {
    const text = portedRubricText("coding_algorithm", { rubric, sample: "S", scoring: undefined });
    expect(text.guidanceMarkdown).toBe(GUIDANCE.coding_algorithm);
  });

  it("slices a section at the next heading, with nothing of its neighbours", () => {
    expect(extractRubricSection(rubric, "CODING — ALGORITHM FLUENCY")).toBe(
      "## CODING — ALGORITHM FLUENCY\n\nAlgorithm bands.",
    );
  });

  // Throws rather than returning an empty rubric, which would have made a confident report
  // against no criteria at all. This is what fires if a heading in the table drifts from the file.
  it("refuses a heading rubric.md does not have", () => {
    expect(() => extractRubricSection(rubric, "CODING — FRONTEND")).toThrow(
      'no "## CODING — FRONTEND" section',
    );
  });
});

describe("TOOLKIT_RUBRICS", () => {
  // Rubric names are looked up by exact string against the rows the seed made.
  it("names the four seeded rows", () => {
    expect(
      Object.values(TOOLKIT_RUBRICS)
        .map((entry) => entry.rubricName)
        .sort(),
    ).toEqual([
      "CODING_ALGORITHM_FLUENCY",
      "CODING_FRONTEND",
      "CODING_SQL_FLUENCY",
      "SHORT_RESPONSE",
    ]);
  });

  // The toolkit holds no SQL sample, and the SQL rubric goes without rather than borrowing a
  // checklist report that is not the shape of a SQL one.
  it("gives coding_sql no sample, and every other rubric its own", () => {
    expect(TOOLKIT_RUBRICS.coding_sql.sampleFile).toBeNull();
    const files = Object.values(TOOLKIT_RUBRICS)
      .map((entry) => entry.sampleFile)
      .filter((file) => file !== null);
    expect(new Set(files).size).toBe(files.length);
  });

  it("names the one guidance for every type", () => {
    for (const type of Object.keys(TOOLKIT_RUBRICS) as (keyof typeof TOOLKIT_RUBRICS)[]) {
      expect(GUIDANCE[type]).toContain("## Scoring this section");
    }
  });
});
