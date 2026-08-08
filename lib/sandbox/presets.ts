/**
 * Runner configuration, so the sandbox is not tied to this project's stack.
 *
 * Nothing here may assume the technology the LMS itself is built with. The
 * sandbox has to run Node, Python, React, and eventually SQL assignments, and an
 * assignment needing a system dependency has to be satisfiable by naming a
 * different E2B template rather than by changing code.
 *
 * No "server-only" import: this module is pure data and pure functions, so it is
 * importable from tests and scripts as well as from server code.
 */

import { RESULTS_DIR } from "./paths";

export type ResultFormat = "jest-json" | "vitest-json" | "pytest-json";

export type RunnerPreset = {
  /** E2B template id. "base" carries both Node and Python. */
  e2bTemplate: string;
  /** Run with network access, because installing dependencies requires it. */
  setupCommands: string[];
  /** Run after network access is revoked. */
  testCommand: string;
  /** Which parser reads the output. */
  resultFormat: ResultFormat;
  /**
   * File the test runner writes inside the sandbox, read back out afterward.
   * Absent on presets that produce no machine-readable results.
   */
  resultPath?: string;
  /** Hard ceiling for the test command. The sandbox is killed at this point. */
  timeoutMs: number;
  /**
   * When true, students may add their own dependencies: package.json is merged
   * rather than restored, the lockfile is left alone, and setup uses
   * `npm install` rather than `npm ci`. See mergePackageJson in protected-paths.
   *
   * Turning this on means arbitrary npm packages are downloaded into the sandbox.
   * Their install scripts do not run, because every preset installs with
   * --ignore-scripts, so the package contents are inert until something imports
   * them — and by then the network is revoked. That, plus the sandbox holding no
   * GitHub token and nothing else from process.env, is what makes this safe.
   */
  allowStudentDependencies: boolean;
  /**
   * Added to the default protected set for this preset. The defaults already
   * cover the common runners; this is for a preset with its own configuration
   * files.
   */
  extraProtectedPaths?: string[];
};

/**
 * "none" is a real preset and the default for every assignment.
 *
 * Many assignments have no automated tests at all: short response assignments
 * have nothing to execute, and frontend assignments have tests this build cannot
 * run yet. Those are not a degenerate case to handle at the edges — they are a
 * large fraction of the assignments in the program.
 *
 * The default is "none" rather than "node-jest" so that an unconfigured
 * assignment produces no evidence instead of quietly producing the wrong
 * evidence. An assignment that should run tests and does not is visible on the
 * instructor page as "no automated tests"; the reverse mistake, a Python
 * assignment silently running `npx jest`, would surface as an ERRORED run that
 * looks like a defect in the sandbox.
 */
export const NO_RUNNER = "none" as const;

export const RUNNER_PRESETS: Record<string, RunnerPreset> = {
  "node-jest": {
    e2bTemplate: "base",
    // Three things are going on in this one line.
    //
    // `npm ci` requires package.json and the lockfile to agree exactly, which is
    // what we want. It fails on a repository with no lockfile, so `npm install` is
    // the fallback rather than the default.
    //
    // `--ignore-scripts` is required, not a precaution. The assignment templates
    // install a git hook during setup with `cp hooks/pre-commit .git/hooks/`, and
    // the sandbox receives a tarball rather than a clone, so there is no `.git`
    // directory and the whole install fails. It is also the stronger security
    // position: no dependency's install script runs, so a student cannot reach the
    // network during setup by adding a package with a postinstall script.
    //
    // A preset whose dependencies genuinely need their install scripts — anything
    // that downloads a platform binary, such as esbuild or sharp — has to override
    // setupCommands and accept that consequence.
    setupCommands: [
      "npm ci --ignore-scripts --no-audit --no-fund || npm install --ignore-scripts --no-audit --no-fund",
    ],
    testCommand: `npx jest --ci --json --outputFile=${RESULTS_DIR}/jest.json`,
    resultFormat: "jest-json",
    resultPath: `${RESULTS_DIR}/jest.json`,
    timeoutMs: 120_000,
    allowStudentDependencies: false,
  },

  "node-vitest": {
    e2bTemplate: "base",
    // See node-jest above for why --ignore-scripts is required. Note that Vitest
    // depends on esbuild, which normally downloads a platform binary in a
    // postinstall script — so this preset needs a template with those dependencies
    // already installed, or an override that drops --ignore-scripts.
    setupCommands: [
      "npm ci --ignore-scripts --no-audit --no-fund || npm install --ignore-scripts --no-audit --no-fund",
    ],
    testCommand: `npx vitest run --reporter=json --outputFile=${RESULTS_DIR}/vitest.json`,
    resultFormat: "vitest-json",
    resultPath: `${RESULTS_DIR}/vitest.json`,
    timeoutMs: 120_000,
    allowStudentDependencies: false,
  },

  "python-pytest": {
    e2bTemplate: "base",
    setupCommands: [
      "pip install --no-input -r requirements.txt",
      "pip install --no-input pytest-json-report",
    ],
    testCommand: `pytest --json-report --json-report-file=${RESULTS_DIR}/pytest.json`,
    resultFormat: "pytest-json",
    resultPath: `${RESULTS_DIR}/pytest.json`,
    timeoutMs: 120_000,
    allowStudentDependencies: false,
    extraProtectedPaths: ["pyproject.toml", "setup.cfg", "tox.ini"],
  },

  // React assignments with runnable tests use node-jest or node-vitest
  // unchanged, because a component test is still a Node process.
  //
  // SQL is deliberately absent. It needs a template with PostgreSQL installed
  // and is the first thing to build once this phase works.
};

/**
 * Paths whose contents are grading infrastructure rather than student work.
 *
 * Two things happen to every one of these: a change to it is reported, and the
 * template's version of it is restored before the suite runs. Reporting and
 * restoring are separate obligations — the instructor needs to know a student
 * edited the tests, and the score has to be computed as if they had not.
 *
 * Patterns are matched with matchesProtectedPath below, not by a glob library,
 * so the supported syntax is deliberately small: a trailing `/**` matches a
 * directory and everything under it, and a trailing `*` matches any suffix.
 */
export const DEFAULT_PROTECTED_PATHS: string[] = [
  "tests/**",
  "test/**",
  "__tests__/**",
  "jest.config.*",
  "vitest.config.*",
  "package.json",
  "package-lock.json",
  ".eslintrc*",
  "eslint.config.*",
  "pytest.ini",
  "conftest.py",
  "requirements.txt",
  ".github/workflows/**",
];

/**
 * Deliberately NOT protected: `scores/**` and `hooks/**`.
 *
 * The mod-1 assignment templates carry a `hooks/pre-commit` that runs the suite and
 * then does `git add scores/scores.json`, so a student's every commit stages a
 * rewritten scores file. Protecting that path would report a change on every mod-1
 * submission and route all of them to manual review — a finding on every student,
 * caused by the assignment's own tooling doing what it was built to do.
 *
 * Protecting them was never what made them untrustworthy. Nothing reads
 * `scores.json` as a grading signal, and nothing runs the hook: `npx jest` is invoked
 * directly rather than through `npm test`, the hook is installed by a `preinstall`
 * script that `--ignore-scripts` skips, and git hooks do not execute in the sandbox
 * at all. The results come from the template's tests and the runner's own output, so
 * a student may leave whatever they like in `scores/`.
 *
 * The `score-tests` module those files belong to is being retired. When it and the
 * hooks are gone from the templates, nothing here needs to change.
 */

/**
 * True when `filePath` is grading infrastructure.
 *
 * Paths are compared case-sensitively and must be repository-relative with
 * forward slashes, which is what both the GitHub pull request files endpoint and
 * tar entries produce.
 */
export function matchesProtectedPath(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const dir = pattern.slice(0, -3);
      return filePath === dir || filePath.startsWith(`${dir}/`);
    }
    if (pattern.endsWith("*")) {
      return filePath.startsWith(pattern.slice(0, -1));
    }
    return filePath === pattern;
  });
}

/**
 * A preset with an assignment's overrides merged over it, which is what the
 * runner actually uses.
 */
export type ResolvedRunner = RunnerPreset & {
  presetName: string;
  protectedPaths: string[];
};

/**
 * Thrown when an assignment names a preset that does not exist. Distinguished
 * from a sandbox failure because the cause and the fix are different: this is a
 * configuration mistake, visible before any sandbox is created.
 */
export class UnknownRunnerPresetError extends Error {
  constructor(presetName: string) {
    super(
      `Unknown runner preset "${presetName}". Known presets: ` +
        `${[NO_RUNNER, ...Object.keys(RUNNER_PRESETS)].join(", ")}. ` +
        `Fix assignments.runner_preset, or add the preset to lib/sandbox/presets.ts.`,
    );
    this.name = "UnknownRunnerPresetError";
  }
}

/**
 * Thrown when a run is requested for an assignment with no tests.
 *
 * Deliberately an exception rather than an ERRORED test run row. An assignment
 * with no tests has not failed at anything, and a table of ERRORED rows against
 * every short response submission would be noise hiding real infrastructure
 * failures.
 */
export class NoRunnerConfiguredError extends Error {
  constructor(assignmentTitle: string) {
    super(
      `Assignment "${assignmentTitle}" has no automated tests ` +
        `(runner_preset is "${NO_RUNNER}"). This is a normal state, not a failure.`,
    );
    this.name = "NoRunnerConfiguredError";
  }
}

/**
 * Merges an assignment's `runnerConfig` over its named preset.
 *
 * Shallow by design: an override replaces a whole field rather than merging into
 * it, so `setupCommands` in an override is the complete list of commands. A deep
 * merge would make it impossible to remove a default command.
 *
 * Returns null when the assignment has no runner, so callers have to handle that
 * case explicitly rather than receiving something that looks runnable.
 */
export function resolveRunner(assignment: {
  runnerPreset: string;
  runnerConfig: unknown;
}): ResolvedRunner | null {
  if (assignment.runnerPreset === NO_RUNNER) return null;

  const base = RUNNER_PRESETS[assignment.runnerPreset];
  if (!base) throw new UnknownRunnerPresetError(assignment.runnerPreset);

  const override =
    assignment.runnerConfig &&
    typeof assignment.runnerConfig === "object" &&
    !Array.isArray(assignment.runnerConfig)
      ? (assignment.runnerConfig as Partial<RunnerPreset> & { protectedPaths?: string[] })
      : {};

  const merged: RunnerPreset = { ...base, ...override };

  return {
    ...merged,
    presetName: assignment.runnerPreset,
    // An override may replace the protected set outright, which is what an
    // assignment with an unusual layout needs. Otherwise the defaults apply plus
    // whatever the preset adds.
    protectedPaths: override.protectedPaths ?? [
      ...DEFAULT_PROTECTED_PATHS,
      ...(merged.extraProtectedPaths ?? []),
    ],
  };
}
