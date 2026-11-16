import type { SectionType } from "../section-types";

/**
 * How the grading toolkit's files become rubric rows and a rule set row.
 *
 * The four rubrics and the rule set used to be files in the grading-guides repository: one
 * `rubric.md` with a `## ` section per rubric, one `agent-rules.md` for tone and layout, and a
 * sample report per rubric. `scripts/port-rubrics.ts` reads those files at a named commit and
 * writes them into `Rubric`, `RubricVersion`, `RuleSet` and `RuleSetVersion`. Everything here is
 * the pure part of that — what goes where — so it can be checked against a fixture without the
 * network or the database, and so `scripts/verify-rubric-port.ts` can rebuild the old prompt from
 * the same files and diff it against the new one.
 *
 * **What moves, and why.** `agent-rules.md` held three kinds of text: the tone and layout every
 * report follows, two "Scoring …" sections that belong to one rubric each, and one rule about the
 * `draft` branch that the pipeline already applies in code. The rule set keeps the first. The
 * scoring sections go into the guidance of their rubric, after the scoring rules that used to be
 * hardcoded per section type in `lib/grade/prompts.ts`, which now live in `GUIDANCE` below for the
 * port to write. The branch rule is dropped: `buildUserPrompt` tells the model about the branch
 * itself, so a rule set that repeated it would say it twice, and a rubric for a Google Doc has no
 * branch at all.
 */

/** The toolkit file each rubric was read from, by the name of its row. */
export const TOOLKIT_RUBRICS: Record<
  SectionType,
  {
    rubricName: string;
    heading: string;
    /** Null for a rubric the toolkit holds no sample for, which the prompt then goes without. */
    sampleFile: string | null;
    scoringSection: string | null;
  }
> = {
  short_response: {
    rubricName: "SHORT_RESPONSE",
    heading: "SHORT RESPONSE",
    /*
      Pair 1 of the calibration pairs. Pair 2 onward are deliberately not sample reports: `npm run
      calibrate` grades them and compares the result against the instructor's report, which only
      measures anything as long as the model has not been shown the answer.
    */
    sampleFile: "sample-short-response-report-1.md",
    scoringSection: "Scoring short response reports",
  },
  coding_algorithm: {
    rubricName: "CODING_ALGORITHM_FLUENCY",
    heading: "CODING — ALGORITHM FLUENCY",
    sampleFile: "sample-coding-fluency-report.md",
    scoringSection: null,
  },
  coding_sql: {
    rubricName: "CODING_SQL_FLUENCY",
    heading: "CODING — SQL FLUENCY",
    // The toolkit holds no SQL sample. Left blank rather than borrowing another rubric's: a
    // sample teaches the shape of a report, and a frontend checklist is not the shape of one.
    sampleFile: null,
    scoringSection: null,
  },
  coding_frontend: {
    rubricName: "CODING_FRONTEND",
    heading: "CODING — FRONTEND",
    sampleFile: "sample-coding-frontend-report.md",
    scoringSection: "Scoring coding — frontend reports",
  },
};

/** The name the ported rule set is written under. */
export const PORTED_RULE_SET_NAME = "Marcy Lab grading rules";

/**
 * The scoring arithmetic that was hardcoded per section type, word for word, so the ported
 * guidance reads exactly as the prompt did before the port.
 */
export const GUIDANCE: Record<SectionType, string> = {
  short_response: `
## Scoring this section

The Writing Quality score is a **single score out of 3 for the whole submission**,
not per question. The total is therefore:

> (3 technical points x number of questions) + 3 writing points

A four-question assignment is out of 15, and a one-question assignment is out of 6.
Put the writing score in \`rubricItems\` as one entry with
\`criterion: "writing_quality"\` and the label \`Writing Quality Score (Entire
Assignment)\`, placed last. Give each question its own entry with
\`criterion: "technical"\` and a label of the form \`Question 3: Flexbox vs. CSS Grid\`.
Set \`group\` to null on every entry.

**Every short response report has exactly one writing entry, whatever the number of
questions.** A one-question submission has two entries: the question's technical score
and the writing score, even though both describe the same answer. Leaving the writing
entry out scores the section out of 3 when it is worth 6. Do not add a writing score
to each question as well — that inflates the denominator.

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
entry in \`rubricItems\` with \`criterion: "algorithm"\`, \`scorePossible: 3\`, a
label of the form \`Question 2: is_even\`, and \`group\` set to null — even where the
README lists questions under headings such as "Modify Questions". Ten questions means a
30-point assignment.

Code style is **part of that one score**, not a separate line item. The rubric's bands
fold it in: a 3 requires clean code as well as passing tests, and linting errors or poor
variable names pull the question down a band even when the tests pass. Do not add a
separate code style entry — that inflates the denominator.

**Commented-out code never costs points, and the report does not mention it.** Executed
code that nothing reads costs points only when it changes the program's behaviour or
contradicts what the question asks for; otherwise note it in a bullet labelled
\`Note (not scored)\` under the row of the function it sits closest to, and never in
\`summaryMarkdown\`.

A question the student did not attempt scores 0.
`.trim(),

  coding_sql: `
## Scoring this section

Each numbered query task is worth 1 point, awarded only when the query runs and
produces the expected rows, columns, and ordering. Give each task its own entry in
\`rubricItems\` with \`criterion: "query_task"\`, a label of the form
\`Task 3: customers with no orders\`, and \`group\` set to null.
`.trim(),

  coding_frontend: `
## Scoring this section

This section is checklist-based. Give each checklist item its own entry in
\`rubricItems\` with \`criterion: "checklist"\`. Its \`label\` is the item copied
**verbatim** from the assignment README — do not paraphrase the requirement, and do not
fold your grading note into it. Its \`group\` is the README section the item is listed
under, written as \`Section 3: Fetch Helpers\`, identical for every item in that
section. The application writes each item as a checkbox under its section's heading,
ticked when the item earns full marks.

Only write \`feedbackMarkdown\` where there is a deviation: a bug, missing behaviour, or
a style issue, as bullets such as \`- Half Credit: …\` or \`- Note: …\`. A correctly
implemented item has empty \`feedbackMarkdown\`. For an item that was clearly not
attempted, write \`- Note: not attempted\` rather than a longer explanation.

Award half credit when one checklist item bundles two distinguishable requirements and
the student satisfied only one. Do not force a binary 0 or 1 onto an item that is
really two requirements in one box.

The score is the number of satisfied items over the total number of items.
`.trim(),
};

/**
 * One `## `-level section of a markdown file, heading included, trimmed.
 *
 * `rubric.md` held the four rubrics as four sections, and this is how each became a row. Sliced
 * rather than sent whole, back when the file was the prompt, because the irrelevant sections were
 * actively misleading: a short response report given the algorithm rubric had a plausible scoring
 * scale to reach for that did not apply.
 */
export function extractRubricSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex(
    (line) => line.startsWith("## ") && line.slice(3).trim() === heading,
  );
  if (start === -1) throw new Error(`The file has no "## ${heading}" section.`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/** The one line of `agent-rules.md` the pipeline already says in code. Matched by its opening. */
const BRANCH_RULE_OPENING = "- Whenever a student's submission branch isn't named `draft`";

/**
 * `agent-rules.md` divided into the rule set and the per-rubric scoring sections.
 *
 * Sections are the file's `## ` headings. A scoring section is taken out whole, heading
 * included, and the rest of the file — every other section, in its original order — is the rule
 * set. The branch rule is one bullet in the overview and is removed on its own.
 */
export function splitAgentRules(markdown: string): {
  ruleSet: string;
  scoring: Partial<Record<SectionType, string>>;
} {
  const scoringHeadings = new Map<string, SectionType>();
  for (const type of Object.keys(TOOLKIT_RUBRICS) as SectionType[]) {
    const heading = TOOLKIT_RUBRICS[type].scoringSection;
    if (heading) scoringHeadings.set(heading, type);
  }

  const kept: string[] = [];
  const scoring: Partial<Record<SectionType, string>> = {};
  let taking: SectionType | null = null;
  let taken: string[] = [];

  const close = () => {
    if (taking) scoring[taking] = taken.join("\n").trim();
    taking = null;
    taken = [];
  };

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      close();
      const type = scoringHeadings.get(line.slice(3).trim());
      if (type) {
        taking = type;
        taken.push(line);
        continue;
      }
    }
    if (taking) {
      taken.push(line);
    } else if (!line.startsWith(BRANCH_RULE_OPENING)) {
      kept.push(line);
    }
  }
  close();

  return { ruleSet: kept.join("\n").trim(), scoring };
}

/** The three texts of one ported rubric's first version, from the toolkit's files. */
export function portedRubricText(
  type: SectionType,
  files: { rubric: string; sample: string | null; scoring: string | undefined },
): { rubricMarkdown: string; guidanceMarkdown: string; sampleReportMarkdown: string | null } {
  return {
    rubricMarkdown: extractRubricSection(files.rubric, TOOLKIT_RUBRICS[type].heading),
    guidanceMarkdown: files.scoring ? `${GUIDANCE[type]}\n\n${files.scoring}` : GUIDANCE[type],
    sampleReportMarkdown: files.sample,
  };
}
