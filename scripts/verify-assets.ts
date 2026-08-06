/**
 * Checks that both asset sources can be read, and that what the authoring form offers from
 * the answer-key repository is what the grading pipeline would read from it.
 *
 * Run with `npm run verify:assets`.
 *
 * Two sources now: the program assets — rubric, agent rules, sample reports — come from
 * `GRADING_ASSETS_REPO`, and the answer keys come from whatever repository an assignment
 * names. This script uses `GRADING_ASSETS_REPO` for both, since that is where the existing
 * answer keys are, but it passes it in as an argument the way an assignment's column does
 * rather than letting the code read it out of the environment. A failure here means grading
 * cannot happen anywhere.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}${detail && `\n  ${detail}`}`);
  } else console.log(`ok   ${label}${detail && `  (${detail})`}`);
}

async function main() {
  const {
    loadGradingAssets,
    GradingAssetsError,
    listAnswerKeyEntries,
    listAnswerKeys,
    checkAnswerKeyPaths,
  } = await import("../lib/grade/assets");
  const { parseRepoRef } = await import("../lib/assignments/repo-ref");

  const answerKeyRepo = process.env.GRADING_ASSETS_REPO;
  if (!answerKeyRepo) {
    console.error(
      "GRADING_ASSETS_REPO is not set, so there is nothing to read. Set it to owner/repo in\n" +
      ".env.local — see .env.example. The installation is resolved from the repository's\n" +
      "owner, so the App has to be installed on that organization.",
    );
    process.exit(1);
  }

  // ---- The pure parser, which decides what a pasted field means -------------
  //
  // Checked first and without the network, because every field below is stored through it: a
  // form that accepted a URL the parser rejects would refuse a correct answer, and one that
  // accepted something this turns into the wrong repository would grade against it.
  const parses: [string, string | null][] = [
    ["The-Marcy-Lab-School/swe-1-4-loops", "The-Marcy-Lab-School/swe-1-4-loops"],
    ["https://github.com/The-Marcy-Lab-School/swe-1-4-loops", "The-Marcy-Lab-School/swe-1-4-loops"],
    ["https://github.com/The-Marcy-Lab-School/swe-1-4-loops/", "The-Marcy-Lab-School/swe-1-4-loops"],
    ["https://github.com/The-Marcy-Lab-School/swe-1-4-loops.git", "The-Marcy-Lab-School/swe-1-4-loops"],
    ["https://github.com/owner/repo/tree/main/src", "owner/repo"],
    ["git@github.com:owner/repo.git", "owner/repo"],
    ["  owner/repo  ", "owner/repo"],
    // Refused, each for its own reason: not a repository, wrong host, no repository name,
    // and a traversal that would otherwise reach a column every request interpolates.
    ["not a repo", null],
    ["https://gitlab.com/owner/repo", null],
    ["owner", null],
    ["owner/../secrets", null],
  ];
  for (const [input, expected] of parses) {
    const got = parseRepoRef(input)?.fullName ?? null;
    check(`parses ${JSON.stringify(input)}`, got === expected, `got ${JSON.stringify(got)}`);
  }

  /*
    The directory a pasted address pointed at.

    This is what lets an instructor paste the folder they already have open instead of naming
    the repository and then navigating back to the same place. It decides where a listing
    starts and nothing else — the repository is what gets stored, since answer key paths are
    full repository paths either way.
  */
  const KEYS = "https://github.com/The-Marcy-Lab-School/swe-assignment-grading-guides";
  const paths: [string, string][] = [
    // A folder, which is the case this exists for.
    [`${KEYS}/tree/main/answer-keys/mod-1-js-fundamentals/swe-1-2-strings-conditionals`,
      "answer-keys/mod-1-js-fundamentals/swe-1-2-strings-conditionals"],
    // A file: the useful reading is the directory it is in, not the file itself, which is not
    // a directory and would make the listing report that nothing is there.
    [`${KEYS}/blob/main/answer-keys/mod-1-js-fundamentals/swe-1-4-loops/from-scratch.js`,
      "answer-keys/mod-1-js-fundamentals/swe-1-4-loops"],
    // A commit SHA reads the same as a branch name.
    [`${KEYS}/tree/480841f56b90e12f5301a9b8cb561bb24d0903ae/answer-keys`, "answer-keys"],
    // No path is the root, which is the right answer for a repository holding one
    // assignment's solutions and nothing else.
    [KEYS, ""],
    ["The-Marcy-Lab-School/swe-assignment-grading-guides", ""],
    // A traversal is dropped rather than cleaned, so a hand-edited URL cannot seed a listing
    // that reads somewhere else in the repository.
    [`${KEYS}/tree/main/answer-keys/../../etc`, ""],
  ];
  for (const [input, expected] of paths) {
    const got = parseRepoRef(input)?.path ?? null;
    check(`reads the directory out of ${JSON.stringify(input.replace(KEYS, "…"))}`,
      got === expected, `got ${JSON.stringify(got)}`);
  }

  // The deep address still stores the repository and nothing more, which is what keeps the
  // column a repository identity rather than a location.
  check("a deep address still stores just the repository",
    parseRepoRef(`${KEYS}/tree/main/answer-keys/mod-1-js-fundamentals`)?.fullName ===
      "The-Marcy-Lab-School/swe-assignment-grading-guides");

  // And the directory it names is real, listed through the same code the form uses.
  const pastedDir = parseRepoRef(
    `${KEYS}/tree/main/answer-keys/mod-1-js-fundamentals/swe-1-2-strings-conditionals`,
  )!;
  const pastedKeys = await listAnswerKeys(pastedDir.fullName, pastedDir.path);
  check("the keys under a pasted directory are found without any navigating",
    pastedKeys.length > 0 && pastedKeys.every((p) => p.startsWith(`${pastedDir.path}/`)),
    `${pastedKeys.length} found`);

  // ---- Browsing the repository an assignment names --------------------------
  //
  // The root listing is checked because it failed silently once: the path builder normalises
  // "" to ".", so it asked GitHub for a path called "." and got nothing back — which read as
  // an empty repository and refused to let an assignment be created at all.
  const root = await listAnswerKeyEntries(answerKeyRepo, "");
  check("the repository root lists its contents", (root?.length ?? 0) > 0,
    `${root?.length ?? 0} entries`);
  check("...including the answer-keys directory",
    (root ?? []).some((entry) => entry.name === "answer-keys" && entry.type === "dir"));
  check("directories are listed before files",
    (root ?? []).every((entry, index, all) =>
      index === 0 || all[index - 1].type === "dir" || entry.type === "file"));

  const modules = await listAnswerKeyEntries(answerKeyRepo, "answer-keys");
  check("a directory inside it lists its own contents", (modules?.length ?? 0) > 0,
    `${modules?.length ?? 0} entries`);
  check("...including mod-1-js-fundamentals",
    (modules ?? []).some((entry) => entry.name === "mod-1-js-fundamentals"));

  check("a directory that does not exist is null rather than an error",
    (await listAnswerKeyEntries(answerKeyRepo, "answer-keys/mod-99-nope")) === null);

  /*
    The strongest check here does not depend on the network being fast or the rubric being any
    particular shape: the paths listed for `swe-1-3-node-modules` must be exactly the ones
    `prisma/seed.ts` builds for it. Those were written by hand against the repository, so
    agreement means the browser reads the same structure the working pipeline was configured
    from — including the nested `madlib-challenge/` keys a non-recursive listing would miss.
  */
  const nested = await listAnswerKeys(
    answerKeyRepo,
    "answer-keys/mod-1-js-fundamentals/swe-1-3-node-modules",
  );
  const expectedNested = [
    "answer-keys/mod-1-js-fundamentals/swe-1-3-node-modules/modify.js",
    "answer-keys/mod-1-js-fundamentals/swe-1-3-node-modules/madlib-challenge/index.js",
    "answer-keys/mod-1-js-fundamentals/swe-1-3-node-modules/madlib-challenge/madlib.js",
  ];
  check(
    "answer keys match what the seed builds, nested ones included",
    JSON.stringify([...nested].sort()) === JSON.stringify([...expectedNested].sort()),
    `got ${JSON.stringify(nested)}`,
  );
  check(
    "the paths are repository paths, which is the form sections[].answerKeyPaths stores",
    nested.every((p) => p.startsWith("answer-keys/mod-1-js-fundamentals/")),
  );

  const checked = await checkAnswerKeyPaths(answerKeyRepo, [
    "answer-keys/mod-1-js-fundamentals/swe-1-4-loops/from-scratch.js",
    "answer-keys/mod-1-js-fundamentals/swe-1-4-loops/does-not-exist.js",
    "../../../etc/passwd",
  ]);
  check("a real answer key is found", checked[0]?.found === true);
  check("a mistyped answer key is reported, not thrown",
    checked[1]?.found === false, checked[1]?.reason);
  // The same guard grading uses, reported per path so one bad entry does not hide the rest.
  check("a traversal path is refused and the message says so",
    checked[2]?.found === false && (checked[2]?.reason ?? "").includes("escapes"),
    checked[2]?.reason);

  // ---- Loading what one section is graded against --------------------------
  const coldStart = Date.now();
  const assets = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyRepo,
    answerKeyPaths: [
      "answer-keys/mod-4-dom/swe-checkpoint-summative-1-4/SHORT_RESPONSE.MD",
    ],
  });
  const coldMs = Date.now() - coldStart;

  const warmStart = Date.now();
  await loadGradingAssets({
    sectionType: "short_response",
    answerKeyRepo,
    answerKeyPaths: [],
  });
  const warmMs = Date.now() - warmStart;

  check("a commit sha is resolved for the program assets", typeof assets.commitSha === "string",
    assets.commitSha ?? "none");
  check("a commit sha is recorded for the answer keys too",
    typeof assets.answerKeyCommitSha === "string", assets.answerKeyCommitSha ?? "none");
  check("agent rules are readable", assets.agentRules.length > 500,
    `${assets.agentRules.length} chars`);
  check("the rubric section is sliced, not the whole file",
    assets.rubricSection.startsWith("## SHORT RESPONSE") && assets.rubricSection.length < 8000,
    `${assets.rubricSection.length} chars`);
  check("the sample report is readable", assets.sampleReport.length > 200,
    `${assets.sampleReport.length} chars`);
  check("a real answer key is found", assets.answerKeys.length === 1,
    `${assets.answerKeys.length} found, ${assets.missingAnswerKeys.length} missing`);
  check("content is cached by commit, so a second read is free", warmMs < coldMs / 2,
    `${coldMs}ms cold, ${warmMs}ms warm`);

  // A section naming no keys reads no second repository, so there is no sha to record and
  // no request to make. Checked because the alternative — resolving the repository anyway —
  // would spend a round trip on every short response section in the program.
  const noKeys = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyRepo,
    answerKeyPaths: [],
  });
  check("a section with no answer keys records no answer key commit",
    noKeys.answerKeyCommitSha === null);

  // An answer key path that does not exist must be recorded, not thrown: grading
  // without a reference solution is worse but not useless.
  const absent = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyRepo,
    answerKeyPaths: ["answer-keys/mod-4-dom/no-such-assignment/KEY.md"],
  });
  check("a missing answer key is recorded rather than fatal",
    absent.missingAnswerKeys.length === 1 && absent.answerKeys.length === 0);

  // These paths come from a database column, and the repository they address is private, so
  // a traversal is a way to read files out of it that no assignment names.
  let escaped = "";
  try {
    await loadGradingAssets({
      sectionType: "short_response",
      answerKeyRepo,
      answerKeyPaths: ["../../.github/workflows/deploy.yml"],
    });
  } catch (err) {
    escaped = err instanceof GradingAssetsError ? "refused" : String(err);
  }
  check("a path escaping the repository is refused", escaped === "refused", escaped);

  /*
    Paths with no repository to read them from.

    A section that names keys while the assignment names no repository is a configuration
    error that would otherwise grade silently without its reference solutions — the exact
    failure the whole answer-key mechanism exists to prevent.
  */
  let orphaned = "";
  try {
    await loadGradingAssets({
      sectionType: "short_response",
      answerKeyRepo: null,
      answerKeyPaths: ["answer-keys/mod-1-js-fundamentals/swe-1-4-loops/from-scratch.js"],
    });
    orphaned = "no error";
  } catch (err) {
    orphaned = err instanceof GradingAssetsError ? "refused" : String(err);
  }
  check("answer key paths with no repository to read them from are refused",
    orphaned === "refused", orphaned);

  // A missing rubric section must fail loudly. Grading against nothing would otherwise
  // produce a confident report with no criteria behind it.
  let missingSection = "";
  try {
    await loadGradingAssets({
      sectionType: "coding_sql",
      answerKeyRepo,
      answerKeyPaths: [],
    });
    missingSection = "no error";
  } catch (err) {
    missingSection = err instanceof GradingAssetsError ? "threw" : String(err);
  }
  // coding_sql does have a rubric heading, so this should succeed. Recorded either way
  // so a rubric reorganisation that drops a heading is visible here.
  check("every section type resolves a rubric heading", missingSection === "no error",
    missingSection);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error("\n", err); process.exit(1); });
