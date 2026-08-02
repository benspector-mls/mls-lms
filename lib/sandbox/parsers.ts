import type { ResultFormat } from "./presets";

/**
 * Result parsers, one per runner, all returning the same shape.
 *
 * Everything downstream — the database columns, the instructor's view, the
 * cross-check in Phase 3 — reads this shape and never knows which runner
 * produced it. That is what allows a Python assignment and a Jest assignment to
 * be graded by the same code.
 */

export type NormalizedTest = {
  suite: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  failureMessage?: string;
};

export type NormalizedResults = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: NormalizedTest[];
};

/**
 * Thrown when a runner's output cannot be read.
 *
 * Parse failure is not test failure. A suite that crashes before writing its JSON,
 * or writes something unparseable, produced no information about the student's
 * code — so the run is ERRORED rather than a zero score. Conflating the two is how
 * a student receives a zero for a problem that is not theirs.
 */
export class ResultParseError extends Error {
  constructor(format: ResultFormat, detail: string) {
    super(`Could not read ${format} results: ${detail}`);
    this.name = "ResultParseError";
  }
}

/** Truncated so one enormous failure message cannot dominate a stored row. */
const MAX_FAILURE_MESSAGE = 4_000;

function truncate(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const trimmed = message.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_FAILURE_MESSAGE
    ? `${trimmed.slice(0, MAX_FAILURE_MESSAGE)}\n… truncated`
    : trimmed;
}

function parseJson(format: ResultFormat, raw: string): unknown {
  if (!raw.trim()) {
    throw new ResultParseError(format, "the runner wrote nothing");
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ResultParseError(
      format,
      `output is not valid JSON (${err instanceof Error ? err.message : "unknown error"})`,
    );
  }
}

/** Recomputed from the per-test rows rather than trusted from the runner's own totals. */
function tally(tests: NormalizedTest[]): NormalizedResults {
  return {
    total: tests.length,
    passed: tests.filter((t) => t.status === "passed").length,
    failed: tests.filter((t) => t.status === "failed").length,
    skipped: tests.filter((t) => t.status === "skipped").length,
    tests,
  };
}

type JestJson = {
  testResults?: {
    name?: string;
    assertionResults?: {
      ancestorTitles?: string[];
      title?: string;
      fullName?: string;
      status?: string;
      duration?: number | null;
      failureMessages?: string[];
    }[];
  }[];
};

function parseJestJson(raw: string): NormalizedResults {
  const data = parseJson("jest-json", raw) as JestJson;
  if (!Array.isArray(data.testResults)) {
    throw new ResultParseError("jest-json", "no testResults array present");
  }

  const tests: NormalizedTest[] = [];
  for (const file of data.testResults) {
    for (const assertion of file.assertionResults ?? []) {
      tests.push({
        // Prefer the describe-block path, falling back to the file, so a test
        // name is identifiable in a report without the file path being noise.
        suite: assertion.ancestorTitles?.length
          ? assertion.ancestorTitles.join(" › ")
          : (file.name ?? ""),
        name: assertion.title ?? assertion.fullName ?? "(unnamed test)",
        status:
          assertion.status === "passed"
            ? "passed"
            : assertion.status === "pending" ||
                assertion.status === "skipped" ||
                assertion.status === "todo" ||
                assertion.status === "disabled"
              ? "skipped"
              : "failed",
        ...(typeof assertion.duration === "number" ? { durationMs: assertion.duration } : {}),
        ...(() => {
          const message = truncate(assertion.failureMessages?.join("\n\n"));
          return message ? { failureMessage: message } : {};
        })(),
      });
    }
  }

  return tally(tests);
}

type VitestJson = JestJson;

/**
 * Vitest's `--reporter=json` emits Jest's format deliberately, so the same reader
 * handles both. Kept as a separate format name because that compatibility is
 * Vitest's choice and not a guarantee.
 */
function parseVitestJson(raw: string): NormalizedResults {
  const data = parseJson("vitest-json", raw) as VitestJson;
  if (!Array.isArray(data.testResults)) {
    throw new ResultParseError("vitest-json", "no testResults array present");
  }
  return parseJestJson(raw);
}

type PytestJson = {
  tests?: {
    nodeid?: string;
    outcome?: string;
    duration?: number;
    call?: { longrepr?: string; crash?: { message?: string } };
    setup?: { longrepr?: string };
  }[];
};

function parsePytestJson(raw: string): NormalizedResults {
  const data = parseJson("pytest-json", raw) as PytestJson;
  if (!Array.isArray(data.tests)) {
    throw new ResultParseError(
      "pytest-json",
      "no tests array present — pytest-json-report may not be installed",
    );
  }

  const tests: NormalizedTest[] = data.tests.map((test) => {
    // A pytest nodeid is "path/to/test_file.py::TestClass::test_name".
    const nodeid = test.nodeid ?? "(unnamed test)";
    const separator = nodeid.lastIndexOf("::");
    const suite = separator > 0 ? nodeid.slice(0, separator) : "";
    const name = separator > 0 ? nodeid.slice(separator + 2) : nodeid;

    const failureMessage = truncate(
      test.call?.longrepr ?? test.call?.crash?.message ?? test.setup?.longrepr,
    );

    return {
      suite,
      name,
      status:
        test.outcome === "passed"
          ? "passed"
          : test.outcome === "skipped" || test.outcome === "xfailed" || test.outcome === "xpassed"
            ? "skipped"
            : "failed",
      // pytest reports seconds; everything else here is milliseconds.
      ...(typeof test.duration === "number" ? { durationMs: Math.round(test.duration * 1000) } : {}),
      ...(failureMessage ? { failureMessage } : {}),
    };
  });

  return tally(tests);
}

export function parseResults(format: ResultFormat, raw: string): NormalizedResults {
  switch (format) {
    case "jest-json":
      return parseJestJson(raw);
    case "vitest-json":
      return parseVitestJson(raw);
    case "pytest-json":
      return parsePytestJson(raw);
  }
}

/**
 * passed / total, or null when the suite reported no tests.
 *
 * Null rather than 0 for an empty suite, because zero of zero is not a failure to
 * pass anything — it is an absence of information, and a run that found no tests
 * at all is a configuration problem rather than a student's result.
 *
 * This is NOT the score, and it is deliberately not compared against
 * assignment.completionThreshold anywhere. Test outcomes are one rubric input
 * among several.
 */
export function computePassRate(results: NormalizedResults): number | null {
  if (results.total === 0) return null;
  return results.passed / results.total;
}
