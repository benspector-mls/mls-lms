import { parseResults, computePassRate } from "@/lib/sandbox/parsers";
import {
  matchesProtectedPath,
  resolveRunner,
  DEFAULT_PROTECTED_PATHS,
} from "@/lib/sandbox/presets";
import {
  findTamperedPaths,
  mergePackageJson,
  buildRestoreScript,
} from "@/lib/sandbox/protected-paths";

/**
 * The sandbox logic that does not need a sandbox.
 *
 * This is the part of running a student's tests where a silent mistake would be most costly and
 * least visible: whether a protected path is recognised, whether a student's edit is reported,
 * whether the template's version of a script wins a collision, and whether unreadable runner
 * output is treated as an infrastructure failure rather than as a zero.
 *
 * The rest of the sandbox's verification needs a real sandbox and a real repository, and stays
 * in `npm run verify:e2b`.
 */

/** Reads one key out of a merged JSON object without widening it to `any`. */
function field(container: unknown, key: string): unknown {
  return container && typeof container === "object"
    ? (container as Record<string, unknown>)[key]
    : undefined;
}

describe("matchesProtectedPath", () => {
  it("matches a nested file under a protected directory", () => {
    expect(matchesProtectedPath("tests/a/b.spec.js", DEFAULT_PROTECTED_PATHS)).toBe(true);
  });

  it("matches the bare directory name", () => {
    expect(matchesProtectedPath("tests", DEFAULT_PROTECTED_PATHS)).toBe(true);
  });

  // `tests/**` is a directory, not a prefix. A file whose name merely starts with the same
  // letters is ordinary student work.
  it("does not match a file that only starts with the same letters", () => {
    expect(matchesProtectedPath("testsomething.js", ["tests/**"])).toBe(false);
  });

  it("matches a glob", () => {
    expect(matchesProtectedPath("jest.config.js", DEFAULT_PROTECTED_PATHS)).toBe(true);
  });

  it("leaves student source alone", () => {
    expect(matchesProtectedPath("src/index.js", DEFAULT_PROTECTED_PATHS)).toBe(false);
  });

  // The mod-1 pre-commit hook stages a rewritten scores.json on every commit, so protecting
  // these would report a change on every mod-1 submission.
  it("does not protect the files the pre-commit hook rewrites", () => {
    expect(matchesProtectedPath("scores/scores.json", DEFAULT_PROTECTED_PATHS)).toBe(false);
    expect(matchesProtectedPath("hooks/pre-commit", DEFAULT_PROTECTED_PATHS)).toBe(false);
  });
});

describe("findTamperedPaths", () => {
  it("reports nothing for a routine mod-1 commit", () => {
    expect(
      findTamperedPaths(
        [
          { path: "src/from-scratch.js", kind: "modified" },
          { path: "scores/scores.json", kind: "modified" },
        ],
        DEFAULT_PROTECTED_PATHS,
      ),
    ).toEqual([]);
  });

  it("reports an added test file", () => {
    expect(
      findTamperedPaths([{ path: "tests/new.spec.js", kind: "added" }], DEFAULT_PROTECTED_PATHS),
    ).toEqual([{ path: "tests/new.spec.js", kind: "added" }]);
  });

  it("ignores a change to the student's own source", () => {
    expect(
      findTamperedPaths(
        [{ path: "src/from-scratch.js", kind: "modified" }],
        DEFAULT_PROTECTED_PATHS,
      ),
    ).toEqual([]);
  });

  // Moving a test out of tests/ is a deletion of a protected file, however git spells it. The
  // reported path is where the file *was*, because that is the protected one.
  it("reads a test renamed out of tests/ as removed", () => {
    expect(
      findTamperedPaths(
        [{ path: "notes/a.spec.js.bak", kind: "renamed", previousPath: "tests/a.spec.js" }],
        DEFAULT_PROTECTED_PATHS,
      ),
    ).toEqual([{ path: "tests/a.spec.js", kind: "removed", previousPath: "tests/a.spec.js" }]);
  });
});

describe("mergePackageJson", () => {
  const template = {
    scripts: { test: "jest" },
    devDependencies: { jest: "^29.0.0" },
    type: "commonjs",
  };

  describe("with student dependencies disallowed", () => {
    const strict = mergePackageJson(
      template,
      {
        scripts: { test: "echo ok", start: "node ." },
        devDependencies: { jest: "^29.0.0", lodash: "^4.0.0" },
      },
      { allowStudentDependencies: false },
    );

    it("gives the template's test script the collision", () => {
      expect(field(strict.merged.scripts, "test")).toBe("jest");
    });

    it("keeps a script the template does not define", () => {
      expect(field(strict.merged.scripts, "start")).toBe("node .");
    });

    it("removes the student's added dependency", () => {
      expect(strict.merged.devDependencies).toEqual({ jest: "^29.0.0" });
    });

    // Reported rather than silently reverted: an instructor reading the run needs to know the
    // submission was not run as the student wrote it.
    it("reports both overrides", () => {
      expect(strict.overriddenKeys.sort()).toEqual([
        "package.json#devDependencies.lodash",
        "package.json#scripts.test",
      ]);
    });
  });

  describe("with student dependencies allowed", () => {
    const loose = mergePackageJson(
      template,
      {
        scripts: { test: "echo ok" },
        dependencies: { chalk: "^5.0.0" },
        devDependencies: { jest: "^29.0.0" },
      },
      { allowStudentDependencies: true },
    );

    it("keeps the dependency the student added", () => {
      expect(loose.merged.dependencies).toEqual({ chalk: "^5.0.0" });
    });

    // The flag governs dependencies, never the scripts. A student who can rewrite `test` can
    // make any submission pass.
    it("still overrides the test script", () => {
      expect(field(loose.merged.scripts, "test")).toBe("jest");
    });

    it("reports only the script", () => {
      expect(loose.overriddenKeys).toEqual(["package.json#scripts.test"]);
    });
  });

  // A key the template does not have at all is still not the student's to introduce, when what
  // it configures is how the tests run.
  it("drops a jest block the template does not have", () => {
    const injected = mergePackageJson(
      template,
      { jest: { testMatch: [] }, type: "module" },
      { allowStudentDependencies: false },
    );
    expect("jest" in injected.merged).toBe(false);
    expect(injected.merged.type).toBe("commonjs");
  });
});

describe("buildRestoreScript", () => {
  const script = buildRestoreScript(["tests/**", "jest.config.*", "package.json"], {
    workDir: "/work",
    templateDir: "/template",
    resultsDir: "/results",
  });

  // Removed before copying, or a test the student deleted from the template would survive as a
  // file the overlay never wrote over.
  it("removes the student's tests directory before copying the template's back", () => {
    expect(script).toContain("rm -rf /work/tests");
    expect(script).toContain("cp -R /template/tests /work/tests");
  });

  // package.json is merged rather than replaced — the student may legitimately have added to
  // it — so the blanket overlay must not touch it.
  it("leaves package.json out of the blanket overlay", () => {
    expect(script).not.toContain("rm -f /work/package.json");
  });

  it("creates the results directory", () => {
    expect(script).toContain("mkdir -p /results");
  });

  // The patterns come from an assignment row, so they are instructor input reaching a shell.
  it("refuses a pattern that escapes the work directory", () => {
    expect(() =>
      buildRestoreScript(["../../etc/passwd"], {
        workDir: "/work",
        templateDir: "/t",
        resultsDir: "/r",
      }),
    ).toThrow();
  });
});

describe("parseResults, for jest", () => {
  const parsed = parseResults(
    "jest-json",
    JSON.stringify({
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
    }),
  );

  it("counts each outcome", () => {
    expect({
      total: parsed.total,
      passed: parsed.passed,
      failed: parsed.failed,
      skipped: parsed.skipped,
    }).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1 });
  });

  it("takes the suite from the describe block", () => {
    expect(parsed.tests[0].suite).toBe("sumTo");
  });

  // Kept because it is the evidence the model is given about *why* a test failed.
  it("keeps the failure message", () => {
    expect(parsed.tests[1].failureMessage).toBe("Expected 0, got 1");
  });

  it("computes the pass rate", () => {
    expect(computePassRate(parsed)).toBe(1 / 3);
  });
});

describe("parseResults, for pytest", () => {
  const py = parseResults(
    "pytest-json",
    JSON.stringify({
      tests: [
        { nodeid: "tests/test_loops.py::test_sum", outcome: "passed", duration: 0.012 },
        {
          nodeid: "tests/test_loops.py::test_edge",
          outcome: "failed",
          call: { longrepr: "assert 0 == 1" },
        },
      ],
    }),
  );

  it("counts each outcome", () => {
    expect({ total: py.total, passed: py.passed, failed: py.failed }).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
    });
  });

  // Shaped identically to the jest results, which is the whole point: a report reads one shape
  // whatever ran it.
  it("splits the node id into a suite and a name", () => {
    expect(py.tests[0].suite).toBe("tests/test_loops.py");
    expect(py.tests[0].name).toBe("test_sum");
  });

  it("converts seconds to milliseconds", () => {
    expect(py.tests[0].durationMs).toBe(12);
  });
});

describe("computePassRate", () => {
  // Null rather than 0, and this is the case the distinction exists for: a frontend assignment
  // with no suite has not failed everything, it has run nothing. A zero here would flow into a
  // cross-check that then contradicts the model.
  it("is null for an empty suite, not zero", () => {
    expect(computePassRate({ total: 0, passed: 0, failed: 0, skipped: 0, tests: [] })).toBeNull();
  });
});

describe("a parse failure is not a test failure", () => {
  // Both throw rather than returning an empty result. Unreadable runner output means the
  // infrastructure broke; grading it as "nothing passed" would score a student on it.
  it("throws on output that is not JSON", () => {
    expect(() => parseResults("jest-json", "not json")).toThrow(
      expect.objectContaining({ name: "ResultParseError" }),
    );
  });

  it("throws on empty output", () => {
    expect(() => parseResults("jest-json", "")).toThrow(
      expect.objectContaining({ name: "ResultParseError" }),
    );
  });
});

describe("resolveRunner", () => {
  it("resolves the absence of a runner to null", () => {
    expect(resolveRunner({ runnerPreset: "none", runnerConfig: null })).toBeNull();
  });

  // Shallow: the override replaces the fields it names and leaves the rest of the preset.
  it("merges an override over the named preset", () => {
    const resolved = resolveRunner({
      runnerPreset: "node-jest",
      runnerConfig: { e2bTemplate: "custom", timeoutMs: 5000 },
    })!;
    expect(resolved.e2bTemplate).toBe("custom");
    expect(resolved.timeoutMs).toBe(5000);
    expect(resolved.resultFormat).toBe("jest-json");
  });

  it("throws on a preset it does not know", () => {
    expect(() => resolveRunner({ runnerPreset: "nope", runnerConfig: null })).toThrow(
      expect.objectContaining({ name: "UnknownRunnerPresetError" }),
    );
  });
});
