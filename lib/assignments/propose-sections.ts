import type { SectionType } from "../section-types";
import {
  testDisplay,
  testKey,
  testsInFile,
  type DeclaredTest,
  type TemplateTest,
} from "./test-names";

/**
 * Proposing an assignment's sections from its template repository.
 *
 * A section is one scored unit, and the template already lists them: `short_response.md` has a
 * `## Question N` heading per question, a coding README has a `### Question N: name` heading per
 * exercise, and a frontend README has a checklist. Reading those out is deterministic, so no
 * model is involved; the instructor adopts the proposal in the section editor and edits it.
 *
 * Pure, so it runs on every save. The template's files are read by `readTemplateForProposal`
 * and handed in; nothing here touches the network.
 */

export type TemplateContents = {
  /** The short response file, whatever it is called, or null when the template has none. */
  shortResponse: string | null;
  readme: string | null;
  /** The test files under `tests/`, by path, each with its text. */
  tests: { path: string; content: string }[];
  /** Whether the assignment runs a suite; without one no section is given tests. */
  hasRunner: boolean;
};

export type ProposedSection = {
  key: string;
  label: string;
  heading?: string;
  pointValue: number;
  type: SectionType;
  /** The template's tests named after the function the heading names, where any are. */
  tests?: DeclaredTest[];
  /**
   * The prompt or instructions the section scores, for the skill suggestion to read. Not stored
   * on the assignment.
   */
  text?: string;
};

export type Proposal = {
  sections: ProposedSection[];
  /** What the instructor should look at: a question with no test, a test matching two questions. */
  notes: string[];
};

const QUESTION_POINTS = 3;
const WRITING_POINTS = 3;
const CHECKLIST_POINTS = 1;

type Heading = { level: number; text: string; line: number };

function headingsOf(markdown: string): Heading[] {
  const headings: Heading[] = [];
  let inFence = false;
  markdown.split("\n").forEach((raw, line) => {
    const trimmed = raw.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (match) headings.push({ level: match[1]!.length, text: match[2]!, line });
  });
  return headings;
}

/** The lines between a heading and the next heading at its level or above. */
function bodyOf(markdown: string, headings: Heading[], index: number): string {
  const lines = markdown.split("\n");
  const heading = headings[index]!;
  const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
  return lines.slice(heading.line + 1, next ? next.line : lines.length).join("\n");
}

/** `Question 11: \`return\` vs \`print\`` reads as `Question 11: return vs print`. */
function plainText(heading: string): string {
  return heading.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The function an exercise heading names, or null.
 *
 * Two spellings, which are the two the curriculum's READMEs use: the first backticked identifier
 * in the heading (`Question 2: \`is_even\``), or, with no backticks, a heading whose whole text
 * after the colon is one identifier (`Question 2: loop5to10`). A heading such as `Question 3:
 * return vs print` names no function by the second rule, because the text after its colon is
 * three words, and that is right: no test is named after a sentence.
 */
function identifierOf(heading: string): string | null {
  const ticked = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(heading);
  if (ticked) return ticked[1]!;
  const bare = /:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(heading);
  return bare ? bare[1]! : null;
}

function truncate(text: string, length = 800): string {
  const collapsed = text.replace(/\n{3,}/g, "\n\n").trim();
  return collapsed.length <= length ? collapsed : `${collapsed.slice(0, length)}…`;
}

/**
 * Whether a test is named after a function: the identifier appears in the test's suite or name
 * bounded by whitespace, underscores, hyphens or the ends, so `is_even` is found in
 * `test_is_even` and `isEven - logs the evens` and not in `is_evenly_spaced`. Without regard to
 * case, because a README that says `fizzBuzz` over a test that says `fizzbuzz` is naming the
 * same function.
 */
export function namedAfter(identifier: string, test: DeclaredTest): boolean {
  const text = `${test.suite ?? ""} ${test.name}`;
  return spellingsOf(identifier).some((spelling) => {
    const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s_-])${escaped}(?=$|[\\s_(:-])`, "i").test(text);
  });
}

/** The identifier as written, and in the other case convention: `is_even` and `isEven` name one function. */
function spellingsOf(identifier: string): string[] {
  const spellings = new Set([identifier]);
  if (identifier.includes("_")) {
    const parts = identifier.split("_").filter((part) => part !== "");
    spellings.add(
      parts.map((part, i) => (i === 0 ? part : part[0]!.toUpperCase() + part.slice(1))).join(""),
    );
  } else {
    spellings.add(identifier.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
  }
  return [...spellings];
}

/**
 * The sections a template implies, in the order a student meets them.
 *
 * `nextKey` is injected so a test can read the keys it expects; the form and the procedure
 * leave it to `newSectionKey`.
 */
export function proposeSections(template: TemplateContents, nextKey: () => string): Proposal {
  const sections: ProposedSection[] = [];
  const notes: string[] = [];

  if (template.shortResponse !== null) {
    const headings = headingsOf(template.shortResponse);
    const questions = headings
      .map((heading, index) => ({ heading, index }))
      .filter(({ heading }) => /^question\s+\d+/i.test(plainText(heading.text)));
    for (const { heading, index } of questions) {
      const body = bodyOf(template.shortResponse, headings, index);
      // The prompt alone, where the file separates it from the space left for the answer.
      const prompt = /###\s*prompt[^\n]*\n([\s\S]*?)(?=\n###|$)/i.exec(body);
      sections.push({
        key: nextKey(),
        label: plainText(heading.text),
        pointValue: QUESTION_POINTS,
        type: "short_response",
        text: truncate(prompt ? prompt[1]! : body),
      });
    }
    if (questions.length > 0) {
      sections.push({
        key: nextKey(),
        label: "Writing Quality",
        pointValue: WRITING_POINTS,
        type: "short_response_writing",
      });
    } else {
      notes.push(
        "The short response file has no `## Question N` headings, so no question was proposed from it.",
      );
    }
  }

  if (template.readme !== null) {
    const headings = headingsOf(template.readme);
    const suite: TemplateTest[] = template.tests.flatMap((file) =>
      testsInFile(file.path, file.content),
    );
    const claimed = new Map<string, string>();

    const exercises = headings
      .map((heading, index) => ({ heading, index }))
      .filter(({ heading }) => /^question\s+\d+/i.test(plainText(heading.text)));
    for (const { heading, index } of exercises) {
      const group = headings
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.level < heading.level);
      const label = plainText(heading.text);
      const section: ProposedSection = {
        key: nextKey(),
        label,
        pointValue: QUESTION_POINTS,
        type: "coding_algorithm",
        text: truncate(bodyOf(template.readme, headings, index)),
      };
      if (group && !/^question\s+\d+/i.test(plainText(group.text))) {
        section.heading = plainText(group.text);
      }

      if (template.hasRunner) {
        const identifier = identifierOf(heading.text);
        if (identifier === null) {
          notes.push(`${label}: the heading names no function, so no test was chosen.`);
        } else {
          const matched = suite.filter((test) => namedAfter(identifier, test));
          if (matched.length === 0) {
            notes.push(`${label}: no test is named after \`${identifier}\`, so none was chosen.`);
          } else {
            section.tests = matched.map(({ suite: testSuite, name }) => ({
              suite: testSuite,
              name,
            }));
            for (const test of matched) {
              const other = claimed.get(testKey(test));
              if (other !== undefined) {
                notes.push(
                  `The test "${testDisplay(test)}" is named after both ${other} and ${label}; ` +
                    `choose for one of them.`,
                );
              }
              claimed.set(testKey(test), label);
            }
          }
        }
      }
      sections.push(section);
    }

    if (exercises.length === 0) {
      let inFence = false;
      let current: Heading | null = null;
      template.readme.split("\n").forEach((raw) => {
        const trimmed = raw.trim();
        if (/^(```|~~~)/.test(trimmed)) {
          inFence = !inFence;
          return;
        }
        if (inFence) return;
        const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
        if (heading) {
          current = { level: heading[1]!.length, text: heading[2]!, line: 0 };
          return;
        }
        const item = /^[-*]\s+\[[ xX]\]\s+(.+)$/.exec(trimmed);
        if (item) {
          const section: ProposedSection = {
            key: nextKey(),
            label: plainText(item[1]!),
            pointValue: CHECKLIST_POINTS,
            type: "coding_frontend",
          };
          if (current) section.heading = plainText((current as Heading).text);
          sections.push(section);
        }
      });
    }
  }

  if (sections.length === 0) {
    notes.push(
      "Nothing in the template reads as a question, an exercise or a checklist, so no section was proposed.",
    );
  }

  return { sections, notes };
}
