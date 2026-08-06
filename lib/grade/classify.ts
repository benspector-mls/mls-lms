import type { NormalizedResults, NormalizedTest } from "../sandbox/parsers";

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
  /**
   * How this section is graded. `"manual"` means an instructor types the score and the
   * feedback: there is no rubric, no answer key, and nothing here for a model to do, so
   * the pipeline filters these out before classifying anything.
   *
   * Optional, and absence means `"ai"`. Sections written before the field existed have no
   * `grading` key, and every one of them is AI-graded — see the backfill in migration
   * `20260804_section_grading`. Reading it defensively costs nothing and means a row that
   * escaped the backfill grades as it always did rather than silently becoming manual.
   */
  grading?: "ai" | "manual";
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

/**
 * Paths whose contents must never reach the model, whatever section they belong to.
 *
 * Three separate concerns land on this one filter, and the third is what makes it more
 * than an optimization:
 *
 * - **Disclosure.** A student who commits a `.env` would otherwise have their own
 *   secrets sent to a third party and written into its logs. Nothing about that is
 *   recoverable afterwards, which is why this list is enforced rather than advisory.
 * - **Context.** A committed `node_modules` can exceed the context window on its own,
 *   which fails the run outright rather than merely making it expensive.
 * - **Cost.** Every file sent is billed as input.
 *
 * Student files come from the pull request's own diff, so a path only reaches here if
 * the student committed it — which happens, and none of these are things git was
 * supposed to be tracking.
 *
 * **This is a fixed list and deliberately not the repository's own `.gitignore`.**
 * Reading that file looks more principled and is unsafe: assignment templates add
 * project-specific lines, and one of them is `server/` in a backend project, with the
 * comment "students will build the entire backend from scratch". Those files are the
 * deliverable — `RULES` above classifies `server/` as frontend work — so honoring the
 * template's ignore file would send an empty prompt and grade the section as not
 * submitted. Nor does the student's own copy help: it inherits the same line. A
 * gitignored path that reached the diff is either junk or the whole submission, and no
 * ignore file distinguishes them.
 *
 * Every entry below is therefore something no assignment can ask a student to author.
 * That is the test for adding one, and it is stricter than "the templates ignore it".
 */
const PROMPT_EXCLUSIONS: { reason: string; matches: RegExp }[] = [
  // The unrecoverable one. `.env`, `.env.local`, `.env.production.local`.
  //
  // `.env.template` is withheld too, and that is deliberate rather than incidental.
  // Sixteen of them are committed across the curriculum's backend assignments, none is
  // student work — the template author wrote them — and they are exactly where a student
  // who has not understood the distinction pastes real credentials. What the model loses
  // is a list of variable names it has no rubric item for.
  { reason: "environment file", matches: /(^|\/)\.env($|\.)/i },
  {
    reason: "credential file",
    matches: /(\.(pem|key|p12|pfx|keystore|jks)$)|((^|\/)id_(rsa|dsa|ecdsa|ed25519)($|\.))/i,
  },
  {
    reason: "dependency tree",
    matches:
      /(^|\/)(node_modules|jspm_packages|web_modules|bower_components|site-packages|\.venv|venv)\//,
  },
  {
    reason: "lockfile",
    matches:
      /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock)$/,
  },
  {
    reason: "build output",
    matches:
      /((^|\/)(dist|build|out|\.next|\.nuxt|\.svelte-kit|\.output)\/)|(\.min\.(js|css)$)|(\.bundle\.js$)|(\.(js|css)\.map$)/,
  },
  { reason: "coverage output", matches: /(^|\/)(coverage|\.nyc_output|lib-cov|htmlcov)\// },
  {
    reason: "cache directory",
    matches:
      /(^|\/)\.(cache|parcel-cache|turbo|yarn|npm|eslintcache|stylelintcache|pytest_cache|mypy_cache|ruff_cache|tox)($|\/)/,
  },
  { reason: "log file", matches: /(\.log$)|((^|\/)logs\/)/i },
  { reason: "editor or system file", matches: /(^|\/)(\.DS_Store|Thumbs\.db|\.vscode|\.idea)($|\/)/i },
  {
    reason: "compiled artifact",
    matches: /\.(pyc|pyo|class|o|so|dylib|dll|exe|tsbuildinfo)$/i,
  },
];

/** Why this path must not be sent, or null when it is ordinary student work. */
export function promptExclusionReason(path: string): string | null {
  return PROMPT_EXCLUSIONS.find((rule) => rule.matches.test(path))?.reason ?? null;
}

export type ExcludedPath = { path: string; reason: string };

/**
 * Splits the pull request's changed paths into what may be sent and what may not.
 *
 * Applied to the whole changed-path list before anything reads it, rather than at the
 * point each section's files are fetched, so classification and the prompt cannot
 * disagree about which paths are student work. A committed `dist/bundle.js` should not
 * make a frontend section read as present any more than it should be sent to the model.
 */
export function partitionForPrompt(paths: string[]): {
  included: string[];
  excluded: ExcludedPath[];
} {
  const included: string[] = [];
  const excluded: ExcludedPath[] = [];

  for (const path of paths) {
    const reason = promptExclusionReason(path);
    if (reason === null) included.push(path);
    else excluded.push({ path, reason });
  }

  return { included, excluded };
}

/**
 * What gets recorded about an exclusion, rather than the raw list.
 *
 * A committed dependency tree is thousands of paths, and writing all of them into
 * `modelMetadata` would make the column unreadable to store a fact that counts and one
 * example already convey.
 */
export function summarizeExclusions(excluded: ExcludedPath[]): {
  count: number;
  byReason: Record<string, number>;
  examples: string[];
} | null {
  if (excluded.length === 0) return null;

  const byReason: Record<string, number> = {};
  for (const entry of excluded) {
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
  }

  return { count: excluded.length, byReason, examples: excluded.slice(0, 20).map((e) => e.path) };
}

/**
 * Why a section has no test results, or the results if it has them.
 *
 * Four outcomes rather than "results or null", because the reasons are not equivalent
 * and collapsing them hides two faults behind one ordinary case. A frontend assignment
 * with no suite is working as intended. A section that declares `evidence: "tests"` and
 * has nothing to show is either a run that never happened or a `testNamePattern` that
 * matches none of the tests that did — and in both of those the model graded without a
 * constraint it was supposed to have, which an instructor needs to know.
 */
type SectionTests =
  | { kind: "results"; results: NormalizedResults }
  /** No `evidence: "tests"`. Ordinary for short response and frontend work. */
  | { kind: "not-expected" }
  /** Tests expected, but the submission has no completed run at this commit. */
  | { kind: "run-missing" }
  /** Tests expected and a run exists, but this section's pattern matched none of them. */
  | { kind: "pattern-matched-nothing" };

export function resolveSectionTests(
  section: AssignmentSection | undefined,
  allTests: NormalizedTest[],
): SectionTests {
  if (!hasTestEvidence(section)) return { kind: "not-expected" };
  if (allTests.length === 0) return { kind: "run-missing" };

  const tests = section?.testNamePattern
    ? allTests.filter((test) =>
        new RegExp(section.testNamePattern!).test(`${test.suite} ${test.name}`),
      )
    : allTests;

  if (tests.length === 0) return { kind: "pattern-matched-nothing" };

  return {
    kind: "results",
    results: {
      total: tests.length,
      passed: tests.filter((t) => t.status === "passed").length,
      failed: tests.filter((t) => t.status === "failed").length,
      skipped: tests.filter((t) => t.status === "skipped").length,
      tests,
    },
  };
}

/** The flag recorded on the section row for each outcome. */
export const TEST_EVIDENCE_FLAG: Record<SectionTests["kind"], string> = {
  results: "TEST_EVIDENCE",
  "not-expected": "NO_TESTS_EXPECTED",
  "run-missing": "TEST_RUN_MISSING",
  "pattern-matched-nothing": "TEST_MATCH_MISSING",
};

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
