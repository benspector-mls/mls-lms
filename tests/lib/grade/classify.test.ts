import {
  belongsToSection,
  classifySections,
  hasTestEvidence,
  partitionForPrompt,
  promptExclusionReason,
  resolveSectionTests,
  summarizeExclusions,
} from "@/lib/grade/classify";

/**
 * Which sections a pull request contains, and which of its files may be sent.
 *
 * Deterministic code rather than a model judgment, and these cases are why: every failure below
 * is one somebody actually hit, and none of them announced itself. A file the matcher did not
 * recognize looked exactly like work a student never did.
 */

const declared = [{ type: "coding_algorithm" as const }, { type: "short_response" as const }];

describe("classifySections", () => {
  it("classifies a flat src file with a Jest suite as an algorithm exercise", () => {
    expect(
      classifySections({
        changedPaths: ["src/from-scratch.js"],
        declaredSections: declared,
        hasJest: true,
      }),
    ).toEqual({
      present: ["coding_algorithm"],
      notSubmitted: ["short_response"],
      unexpected: [],
      unclassified: [],
    });
  });

  it("finds the short response file wherever it sits", () => {
    expect(
      classifySections({
        changedPaths: ["src/short-response.md"],
        declaredSections: declared,
        hasJest: true,
      }),
    ).toEqual({
      present: ["short_response"],
      notSubmitted: ["coding_algorithm"],
      unexpected: [],
      unclassified: [],
    });
  });

  // A real assignment shipped SHORT_RESPONSE.MD and its section was silently never graded,
  // because the rule wanted a literal hyphen. Which separator an author chose has nothing to do
  // with grading, so every spelling of the same filename matches.
  it.each([
    "SHORT_RESPONSE.MD",
    "short_response.md",
    "Short-Response.md",
    "src/SHORT_RESPONSE.md",
    "shortresponse.md",
    "short response.md",
    "short.response.md",
  ])("recognises %s as a short response", (path) => {
    expect(
      classifySections({ changedPaths: [path], declaredSections: declared, hasJest: true }).present,
    ).toEqual(["short_response"]);
  });

  // Not every filename containing both words. A separator is one character or none, so a
  // different word entirely is still a different word.
  it.each(["shortXresponse.md", "short-response-notes.md"])(
    "does not treat %s as the submission file",
    (path) => {
      expect(
        classifySections({ changedPaths: [path], declaredSections: declared, hasJest: true })
          .present,
      ).toEqual([]);
    },
  );

  it("reports both sections of a blended pull request", () => {
    expect(
      classifySections({
        changedPaths: ["src/from-scratch.js", "short-response.md"],
        declaredSections: declared,
        hasJest: true,
      }),
    ).toEqual({
      present: ["coding_algorithm", "short_response"],
      notSubmitted: [],
      unexpected: [],
      unclassified: [],
    });
  });

  it("classifies nested src files as frontend rather than algorithm", () => {
    expect(
      classifySections({
        changedPaths: ["src/components/Card.js"],
        declaredSections: [{ type: "coding_frontend" }],
        hasJest: true,
      }),
    ).toEqual({ present: ["coding_frontend"], notSubmitted: [], unexpected: [], unclassified: [] });
  });

  // A real submission classified as nothing before this was handled: a flat src/*.js file in a
  // frontend assignment with no Jest suite matched no rule at all.
  it("classifies a flat src file without Jest as frontend rather than nothing", () => {
    expect(
      classifySections({
        changedPaths: ["src/RecipeCollection.js"],
        declaredSections: [{ type: "coding_frontend" }, { type: "short_response" }],
        hasJest: false,
      }),
    ).toEqual({
      present: ["coding_frontend"],
      notSubmitted: ["short_response"],
      unexpected: [],
      unclassified: [],
    });
  });

  // `hasJest` is what makes the distinction, not how deeply the file is nested.
  it("classifies the same flat src file WITH Jest as an algorithm exercise", () => {
    expect(
      classifySections({
        changedPaths: ["src/RecipeCollection.js"],
        declaredSections: [{ type: "coding_algorithm" }],
        hasJest: true,
      }),
    ).toEqual({
      present: ["coding_algorithm"],
      notSubmitted: [],
      unexpected: [],
      unclassified: [],
    });
  });

  it("reports a section the assignment did not declare as unexpected", () => {
    expect(
      classifySections({
        changedPaths: ["queries.sql"],
        declaredSections: [{ type: "short_response" }],
        hasJest: false,
      }),
    ).toEqual({
      present: [],
      notSubmitted: ["short_response"],
      unexpected: ["coding_sql"],
      unclassified: [],
    });
  });

  // The template decides which rubric applies, never the student's own package.json. An
  // assignment declaring only coding_algorithm whose template has no Jest suite is misconfigured,
  // and the mismatch surfaces as `unexpected` — which routes the whole submission to manual
  // review. Better than silently grading nothing.
  it("surfaces the mismatch when a src file classifies as frontend without Jest", () => {
    expect(
      classifySections({
        changedPaths: ["src/main.js"],
        declaredSections: [{ type: "coding_algorithm" }],
        hasJest: false,
      }),
    ).toEqual({
      present: [],
      notSubmitted: ["coding_algorithm"],
      unexpected: ["coding_frontend"],
      unclassified: [],
    });
  });

  it("takes test and config churn to imply no section", () => {
    expect(
      classifySections({
        changedPaths: ["tests/a.spec.js", "package.json", "scores/scores.json", "README.md"],
        declaredSections: declared,
        hasJest: true,
      }),
    ).toEqual({
      present: [],
      notSubmitted: ["coding_algorithm", "short_response"],
      unexpected: [],
      unclassified: [],
    });
  });

  // The general form of the SHORT_RESPONSE.MD mistake. A file the matcher does not recognize
  // leaves the section in notSubmitted, which reads exactly like a student who skipped the work.
  // Naming the leftovers is what distinguishes the two, so any future filename an assignment
  // invents surfaces as a filename problem.
  it("names a changed file that matched no rule rather than dropping it", () => {
    expect(
      classifySections({
        changedPaths: ["SHORT-ANSWERS.md", "notes.txt"],
        declaredSections: [{ type: "short_response" }],
        hasJest: false,
      }),
    ).toEqual({
      present: [],
      notSubmitted: ["short_response"],
      unexpected: [],
      unclassified: ["SHORT-ANSWERS.md", "notes.txt"],
    });
  });

  // Files that are never student work stay out of it, or every submission would list its own
  // package.json as a mystery.
  it("does not report ignorable churn as unclassified", () => {
    expect(
      classifySections({
        changedPaths: ["package.json", "README.md", "tests/a.spec.js"],
        declaredSections: [{ type: "short_response" }],
        hasJest: true,
      }).unclassified,
    ).toEqual([]);
  });
});

/**
 * Detecting a section and deciding which files to send when grading it were two separate copies
 * of the same patterns, and they drifted: SHORT_RESPONSE.MD classified as a short response while
 * the file-selection copy still demanded a hyphen and filtered it out. The section was graded
 * 0/15 for being empty with the work sitting right there.
 */
describe("what is detected is also what is sent", () => {
  it.each(["SHORT_RESPONSE.MD", "short_response.md", "src/short-response.md"])(
    "%s is both detected and sent",
    (path) => {
      expect(
        classifySections({
          changedPaths: [path],
          declaredSections: [{ type: "short_response" }],
          hasJest: false,
        }).present,
      ).toEqual(["short_response"]);
      expect(belongsToSection(path, "short_response")).toBe(true);
    },
  );

  // And never sent as frontend as well, or the same answers would be graded twice against two
  // different rubrics.
  it.each(["SHORT_RESPONSE.MD", "short_response.md", "src/short-response.md"])(
    "%s is not also frontend content",
    (path) => {
      expect(belongsToSection(path, "coding_frontend")).toBe(false);
    },
  );
});

/**
 * What may reach the model.
 *
 * The student's files come from the pull request's own diff, so a path is only here because the
 * student committed it. Some of them must never be sent, and the disclosure case is the one with
 * no way back: a committed `.env` sent to a third party is in that third party's logs
 * permanently.
 */
describe("promptExclusionReason", () => {
  it.each([
    [".env", "environment file"],
    [".env.local", "environment file"],
    ["config/.env.production", "environment file"],
    // A decision rather than a side effect of the pattern. The curriculum commits sixteen of
    // these, none is student work, and it is where a student who has not understood the
    // distinction pastes real credentials.
    ["server/.env.template", "environment file"],
    ["server/private.pem", "credential file"],
    ["node_modules/lodash/index.js", "dependency tree"],
    ["src/madlib-challenge/node_modules/prompt-sync/index.js", "dependency tree"],
    ["package-lock.json", "lockfile"],
    ["dist/bundle.js", "build output"],
    ["src/app.min.js", "build output"],
    ["coverage/lcov-report/index.html", "coverage output"],
    ["npm-debug.log", "log file"],
    [".DS_Store", "editor or system file"],
    ["__pycache__/solution.pyc", "compiled artifact"],
  ])("withholds %s as a %s", (path, reason) => {
    expect(promptExclusionReason(path)).toBe(reason);
  });

  // The list has to be narrow enough that ordinary work passes through it, and these are the
  // paths every real submission is made of. A false positive here is a section graded against a
  // prompt with the student's work missing from it.
  it.each([
    "src/from-scratch.js",
    "src/debug.js",
    "short-response.md",
    "src/components/Card.jsx",
    "server/index.js",
    "queries.sql",
    "index.html",
    "styles/main.css",
    "src/utils/environment.js",
    "src/build-tree.js",
    "src/outline.ts",
    "src/distance.js",
    "solution.py",
  ])("treats %s as ordinary student work", (path) => {
    expect(promptExclusionReason(path)).toBeNull();
  });

  // The two names that make the "never a deliverable" test earn its keep. A template in this
  // curriculum gitignores `server/` because students build the backend from scratch, and
  // `src/build-tree.js` sits one substring away from a build directory — so the filter matches
  // directories as directories rather than anywhere a word appears.
  it("sends a deliberately gitignored deliverable rather than filtering it", () => {
    expect(promptExclusionReason("server/index.js")).toBeNull();
    expect(promptExclusionReason("server/routes/events.js")).toBeNull();
  });
});

describe("partitionForPrompt", () => {
  it("keeps the work and names what it withheld", () => {
    expect(
      partitionForPrompt([
        "src/from-scratch.js",
        ".env",
        "node_modules/a/index.js",
        "short-response.md",
      ]),
    ).toEqual({
      included: ["src/from-scratch.js", "short-response.md"],
      excluded: [
        { path: ".env", reason: "environment file" },
        { path: "node_modules/a/index.js", reason: "dependency tree" },
      ],
    });
  });
});

describe("summarizeExclusions", () => {
  it("records nothing when nothing was withheld", () => {
    expect(summarizeExclusions([])).toBeNull();
  });

  // Counts and a few examples rather than the raw list: a committed dependency tree is thousands
  // of paths, and writing all of them into modelMetadata would make the column unreadable to
  // store a fact two numbers convey.
  it("summarizes by reason", () => {
    expect(
      summarizeExclusions([
        { path: ".env", reason: "environment file" },
        { path: "node_modules/a/index.js", reason: "dependency tree" },
        { path: "node_modules/b/index.js", reason: "dependency tree" },
      ]),
    ).toEqual({
      count: 3,
      byReason: { "environment file": 1, "dependency tree": 2 },
      examples: [".env", "node_modules/a/index.js", "node_modules/b/index.js"],
    });
  });
});

describe("hasTestEvidence", () => {
  it("requires evidence: tests", () => {
    expect(hasTestEvidence({ type: "x", evidence: "tests" })).toBe(true);
    expect(hasTestEvidence({ type: "x" })).toBe(false);
  });
});

/**
 * Four outcomes, not two.
 *
 * A frontend assignment with no suite and an algorithm section whose tests never ran both used to
 * be flagged NO_TEST_EVIDENCE, which made a fault look exactly like the ordinary case.
 */
describe("resolveSectionTests", () => {
  const someTests = [
    { suite: "From Scratch Tests", name: "loop5to10 works", status: "passed" as const },
    { suite: "Debug Tests", name: "brokenNested works", status: "failed" as const },
  ];

  it("expects no tests for a section that declares no evidence", () => {
    expect(resolveSectionTests({ type: "coding_frontend" }, someTests).kind).toBe("not-expected");
  });

  it("calls tests expected with no run at all a fault", () => {
    expect(resolveSectionTests({ type: "coding_algorithm", evidence: "tests" }, []).kind).toBe(
      "run-missing",
    );
  });

  it("returns results when tests were expected and are present", () => {
    expect(
      resolveSectionTests({ type: "coding_algorithm", evidence: "tests" }, someTests).kind,
    ).toBe("results");
  });

  it("calls a pattern that matches nothing a fault, not an empty suite", () => {
    expect(
      resolveSectionTests(
        { type: "coding_algorithm", evidence: "tests", testNamePattern: "^Nothing Matches" },
        someTests,
      ).kind,
    ).toBe("pattern-matched-nothing");
  });

  it("narrows to the tests a pattern matches", () => {
    expect(
      resolveSectionTests(
        { type: "coding_algorithm", evidence: "tests", testNamePattern: "Debug" },
        someTests,
      ),
    ).toEqual({
      kind: "results",
      results: { total: 1, passed: 0, failed: 1, skipped: 0, tests: [someTests[1]] },
    });
  });
});
