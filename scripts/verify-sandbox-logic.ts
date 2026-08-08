/**
 * Checks the sandbox logic that does not need a sandbox.
 *
 * Run with `npm run verify:sandbox`.
 *
 * A script rather than a test suite because this project has no test framework
 * installed, and adding one is a separate decision. What it covers is the part of
 * Phase 2 where a silent mistake would be most costly and least visible: whether a
 * protected path is recognised, whether a student's edit is reported, whether the
 * template's version of a script wins a collision, and whether unreadable runner
 * output is treated as an infrastructure failure rather than as a zero.
 *
 * The rest of the sandbox's verification needs a real sandbox and a real repository.
 * What it covers is in README.md; what is still missing is in ROADMAP.md.
 */
import {
  matchesProtectedPath,
  resolveRunner,
  DEFAULT_PROTECTED_PATHS,
} from "../lib/sandbox/presets";
import {
  findTamperedPaths,
  mergePackageJson,
  buildRestoreScript,
} from "../lib/sandbox/protected-paths";
import { parseResults, computePassRate } from "../lib/sandbox/parsers";
import { createChecker } from "./verify/harness";

const { check, finish } = createChecker();

/** Reads one key out of a merged JSON object without widening it to `any`. */
function field(container: unknown, key: string): unknown {
  return container && typeof container === "object"
    ? (container as Record<string, unknown>)[key]
    : undefined;
}

/** The error class name, which is what distinguishes an expected failure here. */
function errName(err: unknown): string {
  return err instanceof Error ? err.name : String(err);
}

// --- path matching -------------------------------------------------------
check(
  "tests/ dir matches nested",
  matchesProtectedPath("tests/a/b.spec.js", DEFAULT_PROTECTED_PATHS),
  true,
);
check("bare tests matches", matchesProtectedPath("tests", DEFAULT_PROTECTED_PATHS), true);
check(
  "testsomething does NOT match tests/**",
  matchesProtectedPath("testsomething.js", ["tests/**"]),
  false,
);
check(
  "jest.config.js matches glob",
  matchesProtectedPath("jest.config.js", DEFAULT_PROTECTED_PATHS),
  true,
);
check(
  "src/index.js is not protected",
  matchesProtectedPath("src/index.js", DEFAULT_PROTECTED_PATHS),
  false,
);
// The mod-1 pre-commit hook stages a rewritten scores.json on every commit, so
// protecting these would report a change on every mod-1 submission.
check(
  "scores/scores.json is NOT protected",
  matchesProtectedPath("scores/scores.json", DEFAULT_PROTECTED_PATHS),
  false,
);
check(
  "hooks/pre-commit is NOT protected",
  matchesProtectedPath("hooks/pre-commit", DEFAULT_PROTECTED_PATHS),
  false,
);
check(
  "a routine mod-1 commit reports no tampering",
  findTamperedPaths(
    [
      { path: "src/from-scratch.js", kind: "modified" },
      { path: "scores/scores.json", kind: "modified" },
    ],
    DEFAULT_PROTECTED_PATHS,
  ),
  [],
);

// --- tamper detection ----------------------------------------------------
check(
  "added test file is reported",
  findTamperedPaths([{ path: "tests/new.spec.js", kind: "added" }], DEFAULT_PROTECTED_PATHS),
  [{ path: "tests/new.spec.js", kind: "added" }],
);
check(
  "student source change is ignored",
  findTamperedPaths([{ path: "src/from-scratch.js", kind: "modified" }], DEFAULT_PROTECTED_PATHS),
  [],
);
check(
  "test renamed out of tests/ reads as removed",
  findTamperedPaths(
    [{ path: "notes/a.spec.js.bak", kind: "renamed", previousPath: "tests/a.spec.js" }],
    DEFAULT_PROTECTED_PATHS,
  ),
  [{ path: "tests/a.spec.js", kind: "removed", previousPath: "tests/a.spec.js" }],
);

// --- package.json merge --------------------------------------------------
const template = {
  scripts: { test: "jest" },
  devDependencies: { jest: "^29.0.0" },
  type: "commonjs",
};

const strict = mergePackageJson(
  template,
  {
    scripts: { test: "echo ok", start: "node ." },
    devDependencies: { jest: "^29.0.0", lodash: "^4.0.0" },
  },
  { allowStudentDependencies: false },
);
check("strict: template test script wins", field(strict.merged.scripts, "test"), "jest");
check("strict: student start script kept", field(strict.merged.scripts, "start"), "node .");
check("strict: student dep removed", strict.merged.devDependencies, { jest: "^29.0.0" });
check("strict: both reported", strict.overriddenKeys.sort(), [
  "package.json#devDependencies.lodash",
  "package.json#scripts.test",
]);

const loose = mergePackageJson(
  template,
  {
    scripts: { test: "echo ok" },
    dependencies: { chalk: "^5.0.0" },
    devDependencies: { jest: "^29.0.0" },
  },
  { allowStudentDependencies: true },
);
check("loose: student dependency kept", loose.merged.dependencies, { chalk: "^5.0.0" });
check("loose: test script still overridden", field(loose.merged.scripts, "test"), "jest");
check("loose: only the script reported", loose.overriddenKeys, ["package.json#scripts.test"]);

const injected = mergePackageJson(
  template,
  { jest: { testMatch: [] }, type: "module" },
  { allowStudentDependencies: false },
);
check("student jest block removed when template has none", "jest" in injected.merged, false);
check("student type override reverted", injected.merged.type, "commonjs");

// --- restore script ------------------------------------------------------
const script = buildRestoreScript(["tests/**", "jest.config.*", "package.json"], {
  workDir: "/work",
  templateDir: "/template",
  resultsDir: "/results",
});
check("removes student tests dir first", script.includes("rm -rf /work/tests"), true);
check("copies template tests back", script.includes("cp -R /template/tests /work/tests"), true);
check(
  "package.json excluded from blanket overlay",
  script.includes("rm -f /work/package.json"),
  false,
);
check("creates results dir", script.includes("mkdir -p /results"), true);
let threw = false;
try {
  buildRestoreScript(["../../etc/passwd"], {
    workDir: "/work",
    templateDir: "/t",
    resultsDir: "/r",
  });
} catch {
  threw = true;
}
check("rejects an escaping pattern", threw, true);

// --- jest parser ---------------------------------------------------------
const jestOut = JSON.stringify({
  testResults: [
    {
      name: "/work/tests/a.spec.js",
      assertionResults: [
        { ancestorTitles: ["sumTo"], title: "adds", status: "passed", duration: 4 },
        {
          ancestorTitles: ["sumTo"],
          title: "handles 0",
          status: "failed",
          duration: 2,
          failureMessages: ["Expected 0, got 1"],
        },
        { ancestorTitles: [], title: "todo", status: "pending" },
      ],
    },
  ],
});
const parsed = parseResults("jest-json", jestOut);
check(
  "jest counts",
  { t: parsed.total, p: parsed.passed, f: parsed.failed, s: parsed.skipped },
  { t: 3, p: 1, f: 1, s: 1 },
);
check("jest suite from describe", parsed.tests[0].suite, "sumTo");
check("jest failure message kept", parsed.tests[1].failureMessage, "Expected 0, got 1");
check("jest pass rate", computePassRate(parsed), 1 / 3);

// --- pytest parser -------------------------------------------------------
const pyOut = JSON.stringify({
  tests: [
    { nodeid: "tests/test_loops.py::test_sum", outcome: "passed", duration: 0.012 },
    {
      nodeid: "tests/test_loops.py::test_edge",
      outcome: "failed",
      call: { longrepr: "assert 0 == 1" },
    },
  ],
});
const py = parseResults("pytest-json", pyOut);
check("pytest counts", { t: py.total, p: py.passed, f: py.failed }, { t: 2, p: 1, f: 0 + 1 });
check("pytest suite split", py.tests[0].suite, "tests/test_loops.py");
check("pytest name split", py.tests[0].name, "test_sum");
check("pytest seconds to ms", py.tests[0].durationMs, 12);

// --- empty suite is not a zero ------------------------------------------
check(
  "empty suite pass rate is null",
  computePassRate({ total: 0, passed: 0, failed: 0, skipped: 0, tests: [] }),
  null,
);

// --- parse failure is not test failure ----------------------------------
let parseThrew = "";
try {
  parseResults("jest-json", "not json");
} catch (e) {
  parseThrew = errName(e);
}
check("unparseable output throws ResultParseError", parseThrew, "ResultParseError");
try {
  parseResults("jest-json", "");
} catch (e) {
  parseThrew = errName(e);
}
check("empty output throws ResultParseError", parseThrew, "ResultParseError");

// --- runner resolution --------------------------------------------------
check("none resolves to null", resolveRunner({ runnerPreset: "none", runnerConfig: null }), null);
const resolved = resolveRunner({
  runnerPreset: "node-jest",
  runnerConfig: { e2bTemplate: "custom", timeoutMs: 5000 },
})!;
check("override replaces template", resolved.e2bTemplate, "custom");
check("override replaces timeout", resolved.timeoutMs, 5000);
check("unoverridden field kept", resolved.resultFormat, "jest-json");
let unknownThrew = "";
try {
  resolveRunner({ runnerPreset: "nope", runnerConfig: null });
} catch (e) {
  unknownThrew = errName(e);
}
check("unknown preset throws", unknownThrew, "UnknownRunnerPresetError");

finish();
