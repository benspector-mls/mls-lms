import nextJest from "next/jest.js";

/**
 * Unit tests for the pure logic, and nothing else.
 *
 * The division is deliberate and is the whole reason the `verify:` scripts survive alongside
 * this. What runs here is every function that decides something from its arguments — the
 * `package.json` merge, protected-path matching, the three result parsers, section
 * classification, the cross-check rules, the assignment and resource specs, the video URL
 * parser, the upload file-type map, triage buckets, delivery outcomes, and presentation. None of
 * it touches a database, a sandbox, a repository, or a model, so it runs on every save and a
 * failure names one case.
 *
 * What stays in `scripts/verify/` is everything that needs a real sandbox, a real repository, a
 * real model call, or live rows. Those cost money or minutes and are run on purpose. See
 * `scripts/verify/BASELINE.md`.
 *
 * `.mjs` rather than `.ts`: a TypeScript Jest config requires ts-node, which is a dependency
 * bought for one file. The other tool configs here are `.mjs` for the same reason.
 *
 * `next/jest` rather than ts-jest: it applies the same SWC transform the application is built
 * with and reads the `@/` path alias out of tsconfig, so a test imports a module exactly the way
 * the code does.
 */
const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  // Node, not jsdom. Nothing under test renders.
  testEnvironment: "jest-environment-node",
  testEnvironmentOptions: {
    /*
      What `--conditions=react-server` does for the scripts.

      Several of these modules open with `import "server-only"`, which is a package that
      resolves to an empty module under the `react-server` condition and to a module that
      throws under any other. Without this, importing `lib/grade/approve.ts` fails with a
      message about Client Components that has nothing to do with the test.
    */
    customExportConditions: ["react-server", "node"],
  },
  setupFiles: ["<rootDir>/jest.setup.mjs"],
  /*
    `tests/lib/` rather than all of `tests/`, so that `tests/integration/` — which wants the real
    development database and is run by `npm run test:integration` — is never picked up here. This
    suite's promise is that it needs nothing, and one file matched by accident would break it.
  */
  testMatch: ["<rootDir>/tests/lib/**/*.test.ts"],
  /*
    The same vendored trees eslint.config.mjs ignores, and for a sharper reason here: Jest's
    module map walks every package.json it finds, and `assignment-templates/` holds copies of
    the student repositories — two of which share a `name`, which it reports as a naming
    collision on every run.
  */
  modulePathIgnorePatterns: [
    "<rootDir>/assignment-templates/",
    "<rootDir>/swe-assignment-grading-guides/",
    "<rootDir>/marcy-curriculum-docs/",
    "<rootDir>/v0/",
    "<rootDir>/.next/",
  ],
  // The tree mirrors the source tree, so tests/lib/grade/triage.test.ts covers
  // lib/grade/triage.ts and there is one obvious place to look.
  collectCoverageFrom: ["lib/**/*.ts", "!lib/generated/**"],
};

export default createJestConfig(config);
