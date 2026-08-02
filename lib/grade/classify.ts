/**
 * Which gradable sections a pull request contains.
 *
 * This is deterministic code rather than a model judgment, and deliberately so.
 * `agent-rules.md` states the rules as file-path patterns, they are unambiguous,
 * and a model asked to re-derive them would occasionally get them wrong in a way
 * nobody would notice — a short response graded against the algorithm rubric still
 * produces a plausible-looking report.
 *
 * Pure, so it can be checked without a model or a network.
 */

/** The four section types that exist in rubric.md today. */
export type SectionType =
  | "short_response"
  | "coding_algorithm"
  | "coding_sql"
  | "coding_frontend";

/** One entry from `assignment.sections`. */
export type AssignmentSection = {
  type: string;
  /**
   * What this section alone is worth. Per section rather than per assignment,
   * because a checkpoint scores its short response and its coding work against
   * different rubrics with different maximums, and each gets its own report.
   *
   * Optional only because `sections` is a JSON column and an older row may predate
   * the field. A section reaching the model without one is a configuration error and
   * is treated as such — nothing guesses a denominator.
   */
  pointValue?: number;
  rubricId?: string;
  answerKeyPaths?: string[];
  reportTemplate?: string;
  /** Absent means no deterministic evidence constrains this section. */
  evidence?: string;
  /** Absent with evidence "tests" means the whole suite counts toward it. */
  testNamePattern?: string;
};

export type ClassificationResult = {
  /** Sections the assignment declares and the pull request actually contains. */
  present: SectionType[];
  /**
   * Declared by the assignment but untouched by the pull request. Reported as
   * "not submitted" rather than graded, which is `agent-rules.md`'s existing rule
   * — grading an untouched placeholder file would score the template, not the
   * student.
   */
  notSubmitted: SectionType[];
  /**
   * Detected in the pull request but not declared by the assignment. Routes the
   * whole submission to manual review: either the student added something
   * unexpected, or the assignment's `sections` mapping is wrong, and both need a
   * person to look.
   */
  unexpected: SectionType[];
  /**
   * Changed files that are student work by elimination — not tests, not config, not a
   * README — and that matched no rule.
   *
   * This exists because of how the `SHORT_RESPONSE.MD` mistake presented. A file the
   * matcher does not recognize is indistinguishable from a file the student never
   * wrote: both leave the section in `notSubmitted`, and the report said the work was
   * not submitted when it was sitting in the pull request under a name with an
   * underscore in it. Naming the leftovers is what tells those two cases apart.
   */
  unclassified: string[];
};

/**
 * Ordered, because the rules overlap and the first match wins.
 *
 * A React assignment contains `.jsx` files *and* a `package.json` with Jest, so
 * "has Jest" alone cannot mean algorithm. `agent-rules.md` resolves this by
 * looking at where the files are: `src/*.js` at the top level of `src` is an
 * algorithm exercise, while nested component files are frontend work.
 */
type Rule = {
  type: SectionType;
  matches: (path: string, context: { hasJest: boolean }) => boolean;
};

/**
 * The short response file, however an assignment spelled it.
 *
 * Exported and used everywhere this file must be recognized, because it was written
 * out twice and the copies drifted. Loosening one of them made `SHORT_RESPONSE.MD`
 * classify as a short response while the other copy still filtered it out of what was
 * sent to the model, which produced the worst possible outcome: a section graded 0/15
 * for being empty when the work was there.
 */
export function isShortResponseFile(path: string): boolean {
  return /(^|\/)short[^a-z0-9]?response\.md$/i.test(path);
}

const RULES: Rule[] = [
  {
    // In any directory, because assignments place it at the repository root and under
    // src/ inconsistently.
    //
    // The separator is deliberately loose. This rule required a literal
    // `short-response.md` and a real assignment shipped `SHORT_RESPONSE.MD`, so the
    // section was classified as not submitted and never graded. Case was already
    // handled; the underscore was not.
    //
    // Nothing about grading depends on which separator an assignment author chose, so
    // the matcher accepts any single non-alphanumeric one, or none. `[^a-z0-9]?`
    // rather than `.` so that `shortXresponse.md` — which is a different word — does
    // not match.
    type: "short_response",
    matches: isShortResponseFile,
  },
  {
    type: "coding_sql",
    matches: (path, ctx) => path.endsWith(".sql") && !ctx.hasJest,
  },
  {
    // Flat files directly under src/, which is where algorithm exercises live:
    // from-scratch.js, modify.js, debug.js. Requires Jest, because a src/*.js file
    // in a frontend assignment is a browser script rather than an exercise.
    type: "coding_algorithm",
    matches: (path, ctx) => ctx.hasJest && /^src\/[^/]+\.(js|ts)$/.test(path),
  },
  {
    // Everything else that is web work. This deliberately covers JavaScript under
    // src/ at *any* depth, flat included.
    //
    // Requiring nesting here was a bug: a flat src/RecipeCollection.js in a frontend
    // assignment with no Jest suite matched no rule at all, so a real submission
    // classified as nothing and could not be graded. Whether a src/*.js file is an
    // algorithm exercise or frontend work is decided by the presence of a Jest suite
    // in the template, which the rule above already handles — and because the rules
    // are ordered and the first match wins, a flat file with Jest is claimed as an
    // algorithm exercise before reaching here.
    type: "coding_frontend",
    matches: (path) =>
      /\.(html|css|jsx|tsx)$/i.test(path) ||
      /^src\/.+\.(js|ts)$/.test(path) ||
      // Server-side files with no Jest suite are graded with the frontend rubric and
      // the README checklist, per agent-rules.md.
      /(^|\/)server\.js$/.test(path) ||
      /^server\//.test(path),
  },
];

/** Paths that are never student work, so they never imply a section. */
function isIgnorable(path: string): boolean {
  return (
    /(^|\/)(node_modules|scores|hooks|coverage)\//.test(path) ||
    /(^|\/)(tests?|__tests__)\//.test(path) ||
    /(^|\/)package(-lock)?\.json$/.test(path) ||
    /(^|\/)README\.md$/i.test(path) ||
    /(^|\/)\.(gitignore|eslintrc.*|env.*)$/.test(path) ||
    /(^|\/)(jest|vitest|eslint)\.config\./.test(path)
  );
}

/**
 * Classifies the changed paths, then reconciles against what the assignment says
 * it contains.
 *
 * `hasJest` comes from the *template's* package.json, never the student's. A
 * student can edit their own copy, and the section a submission is graded under is
 * not something they should be able to change.
 */
export function classifySections(params: {
  changedPaths: string[];
  declaredSections: AssignmentSection[];
  hasJest: boolean;
}): ClassificationResult {
  const detected = new Set<SectionType>();
  const unclassified: string[] = [];

  for (const path of params.changedPaths) {
    if (isIgnorable(path)) continue;

    const rule = RULES.find((candidate) =>
      candidate.matches(path, { hasJest: params.hasJest }),
    );
    if (rule) detected.add(rule.type);
    else unclassified.push(path);
  }

  const declared = new Set(
    params.declaredSections
      .map((section) => section.type)
      .filter((type): type is SectionType =>
        ["short_response", "coding_algorithm", "coding_sql", "coding_frontend"].includes(type),
      ),
  );

  return {
    present: [...declared].filter((type) => detected.has(type)),
    notSubmitted: [...declared].filter((type) => !detected.has(type)),
    unexpected: [...detected].filter((type) => !declared.has(type)),
    unclassified,
  };
}

/**
 * Whether a file's contents should be sent to the model when grading one section.
 *
 * A different question from which section a path implies, and deliberately broader: a
 * frontend section wants every script in the pull request as context, while only one
 * of them needs to exist for the section to count as present. Both questions are
 * answered here so that the patterns they share cannot drift apart.
 */
export function belongsToSection(path: string, sectionType: SectionType): boolean {
  switch (sectionType) {
    case "short_response":
      return isShortResponseFile(path);
    case "coding_sql":
      return path.endsWith(".sql");
    case "coding_frontend":
      return /\.(html|css|jsx|tsx|js|ts)$/i.test(path) && !isShortResponseFile(path);
    case "coding_algorithm":
      return /\.(js|ts|py)$/i.test(path);
  }
}

/** Finds the assignment's configuration for one detected section. */
export function findSection(
  sections: AssignmentSection[],
  type: SectionType,
): AssignmentSection | undefined {
  return sections.find((section) => section.type === type);
}

/**
 * True when a section's score is constrained by test results.
 *
 * A section without this has no deterministic evidence at all, so the only
 * automatic check that applies to it is the arithmetic one. That is the ordinary
 * state for short response and frontend work rather than a deficiency.
 */
export function hasTestEvidence(section: AssignmentSection | undefined): boolean {
  return section?.evidence === "tests";
}
