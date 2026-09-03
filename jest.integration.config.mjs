import nextJest from "next/jest.js";

/**
 * The tests that drive real procedures against the development database.
 *
 * `jest.config.mjs` is the other half and the one that runs on every save: pure functions, no
 * database, no network, no credentials. What runs here needs live rows, so it is a separate
 * command — `npm run test:integration` — run on purpose rather than continuously.
 *
 * These are the checks that used to be `verify:` scripts. What moved is everything a rolled-back
 * transaction against the development database can establish; what stays a script is everything
 * that needs a real sandbox, a real repository, a real model call, or an environment's own
 * configuration. See `scripts/verify/BASELINE.md`.
 */
const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jest-environment-node",
  testEnvironmentOptions: {
    // As in the unit config, and for the same reason: modules that open with `import
    // "server-only"` throw under any other condition. The `verify:` scripts pass
    // `--conditions=react-server` on the command line to buy the same thing.
    customExportConditions: ["react-server", "node"],
  },
  /*
    `setupFiles` clears the client cached on `globalThis` so each file builds its own pool;
    `setupFilesAfterEnv` closes that pool when the file's tests are done. Both headers say why the
    pair has to be a pair.
  */
  globalSetup: "<rootDir>/jest.integration.global-setup.mjs",
  setupFiles: ["<rootDir>/jest.integration.setup.mjs"],
  setupFilesAfterEnv: ["<rootDir>/tests/integration/disconnect.ts"],
  testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
  /*
    Prisma's query compiler, in the copy Jest can load.

    Prisma 7 compiles queries in WebAssembly and reaches its loader through
    `await import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs")`. Jest runs these
    tests as CommonJS and does not transform anything under `node_modules`, so that file arrives as
    text and fails on its first `export` — which reads as a broken test file rather than as a
    module system disagreement.

    Prisma publishes a CommonJS sibling of every one of those files, built from the same source, so
    the fix is to point at the one Jest can already load. This affects nothing outside the test
    run: the application imports the `.mjs` copy as before.

    Only the unit suite is exempt, because nothing there ever opens a connection.
  */
  moduleNameMapper: {
    "^(@prisma/client/runtime/query_compiler_.*)\\.mjs$": "$1.js",
  },
  /*
    One file at a time.

    Not a performance compromise but a correctness one. Most of these suites hold their work
    inside a transaction that is rolled back, but the transaction is not isolation from a second
    suite writing outside one — `verify:programs` demotes a program's owner for the length of its
    run and puts the role back at the end, and anything reading that role concurrently would see
    the wrong answer. The scripts ran one at a time because they were separate commands; this
    keeps that property rather than discovering which suites depended on it.
  */
  maxWorkers: 1,
  /*
    Two minutes, where Jest's default is five seconds.

    A suite's transaction is opened once for a whole group and stays open across every test in it,
    so the budget is the group's total rather than one query's. The scripts pass 60 seconds to
    `db.$transaction` for the same reason; this is the outer limit Jest imposes on the hook that
    opens it, and has to be the larger of the two or it fires first and reports a timeout on a
    transaction that was working.
  */
  testTimeout: 120_000,
  modulePathIgnorePatterns: [
    "<rootDir>/assignment-templates/",
    "<rootDir>/swe-assignment-grading-guides/",
    "<rootDir>/marcy-curriculum-docs/",
    "<rootDir>/v0/",
    "<rootDir>/.next/",
  ],
};

/**
 * The packages that ship only as ES modules, transformed rather than ignored.
 *
 * `superjson` is tRPC's transformer and reaches this suite through `trpc/init.ts`. It publishes no
 * CommonJS build, so unlike Prisma's compiler above it cannot be redirected to a sibling — it has
 * to be compiled, by the same SWC transform every other file here goes through.
 *
 * `next/jest` builds its own `transformIgnorePatterns` from `transpilePackages` in `next.config.ts`
 * and documents that a custom config may only append to it. Appending cannot help: a file is left
 * untransformed when *any* pattern matches, so more patterns can only ignore more. Hence the
 * replacement below rather than an addition — and hence not adding these packages to
 * `transpilePackages`, which would change how the application itself is built to settle a question
 * that only arises under the test runner.
 */
const withNextDefaults = createJestConfig(config);

const resolveConfig = async () => {
  const resolved = await withNextDefaults();

  return {
    ...resolved,
    transformIgnorePatterns: ["^.+\\.module\\.(css|sass|scss)$"],
  };
};

export default resolveConfig;
