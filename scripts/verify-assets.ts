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
    checkAnswerKeyDir,
    notAReferenceSolution,
    MAX_ANSWER_KEYS,
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
  check("the keys under a pasted folder are found without any navigating",
    pastedKeys.paths.length > 0 &&
      pastedKeys.paths.every((p) => p.startsWith(`${pastedDir.path}/`)),
    `${pastedKeys.paths.length} found`);

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
    "a folder resolves to exactly what the seed used to name, nested files included",
    JSON.stringify([...nested.paths].sort()) === JSON.stringify([...expectedNested].sort()),
    `got ${JSON.stringify(nested.paths)}`,
  );
  check("nothing in it was skipped", nested.excluded.length === 0,
    JSON.stringify(nested.excluded));

  // ---- What "everything in the folder" refuses ------------------------------
  //
  // The whole design rests on the folder being the reference set, which is only trustworthy
  // if the exceptions are both real and visible. This is the assignment that has one: an
  // archive sitting beside the source files, which would otherwise be base64-decoded into a
  // prompt as though it were code.
  const checkpoint = await listAnswerKeys(
    answerKeyRepo,
    "answer-keys/mod-4-dom/swe-checkpoint-summative-1-4",
  );
  check("an archive in the folder is skipped rather than sent",
    checkpoint.excluded.some((entry) => entry.path.endsWith("solutions.zip")),
    JSON.stringify(checkpoint.excluded));
  check("...and named as an archive, so it is clear it was deliberate",
    checkpoint.excluded.find((entry) => entry.path.endsWith("solutions.zip"))?.reason ===
      "an archive");
  check("the source files beside it are kept",
    checkpoint.paths.some((p) => p.endsWith("SHORT_RESPONSE.MD")) &&
      checkpoint.paths.some((p) => p.endsWith("src/main.js")) &&
      checkpoint.paths.some((p) => p.endsWith("styles.css")),
    `${checkpoint.paths.length} kept`);
  check("nothing skipped is also kept",
    checkpoint.paths.every((p) => !checkpoint.excluded.some((e) => e.path === p)));

  // Pure, so these are the rule itself rather than a repository that happens to hold one of
  // each. A denylist is used deliberately: an unfamiliar *text* file must be included, since
  // a reference solution silently left out does not fail, it just makes the grade worse.
  const refusals: [string, string | null][] = [
    ["keys/solutions.zip", "an archive"],
    ["keys/screenshot.png", "an image"],
    ["keys/rubric.pdf", "a document"],
    ["keys/walkthrough.mp4", "audio or video"],
    ["keys/node_modules/left-pad/index.js", "a dependency tree"],
    ["keys/.DS_Store", "a system file"],
    ["keys/from-scratch.js", null],
    ["keys/SHORT_RESPONSE.MD", null],
    ["keys/styles.css", null],
    // Not extensions anything here has seen. Included on purpose, which is the point of the
    // rule being a denylist.
    ["keys/schema.sql", null],
    ["keys/solution.py", null],
    ["keys/template.ejs", null],
    ["keys/Makefile", null],
  ];
  for (const [file, expected] of refusals) {
    const got = notAReferenceSolution(file);
    check(`${file} is ${expected ?? "a reference solution"}`, got === expected,
      `got ${JSON.stringify(got)}`);
  }

  // ---- What validation tells an instructor ---------------------------------
  const goodDir = await checkAnswerKeyDir(
    answerKeyRepo,
    "answer-keys/mod-1-js-fundamentals/swe-1-4-loops",
  );
  check("a real folder is usable", goodDir.ok && goodDir.set.paths.length === 3,
    goodDir.reason ?? `${goodDir.set.paths.length} files`);

  const goneDir = await checkAnswerKeyDir(answerKeyRepo, "answer-keys/mod-99-nope");
  check("a folder that is not there is refused and says so",
    !goneDir.ok && (goneDir.reason ?? "").includes("There is no"), goneDir.reason);

  // A traversal in the column is the one case that must not be reported as a finding an
  // instructor could shrug at: it is an attempt to read somewhere the assignment does not name.
  const escapingDir = await checkAnswerKeyDir(answerKeyRepo, "../../../etc");
  check("a folder escaping the repository is refused",
    !escapingDir.ok && (escapingDir.reason ?? "").includes("escapes"), escapingDir.reason);

  check("the file limit is a real bound rather than a comment", MAX_ANSWER_KEYS > 0);

  // ---- Loading what one section is graded against --------------------------
  const CHECKPOINT = "answer-keys/mod-4-dom/swe-checkpoint-summative-1-4";

  const coldStart = Date.now();
  const assets = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyRepo,
    answerKeyDir: CHECKPOINT,
  });
  const coldMs = Date.now() - coldStart;

  const warmStart = Date.now();
  await loadGradingAssets({
    sectionType: "short_response",
    answerKeyRepo,
    answerKeyDir: CHECKPOINT,
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

  /*
    Every reference file in the folder, which is the whole mechanism.

    Checked against the listing rather than a hardcoded number, because the point is that the
    two agree: what the authoring screen showed and what the prompt receives come from the same
    function, so an instructor who read the list read what the model was given.
  */
  check("the prompt gets every reference file in the folder",
    assets.answerKeys.length === checkpoint.paths.length &&
      assets.answerKeys.every((key) => checkpoint.paths.includes(key.path)),
    `${assets.answerKeys.length} loaded against ${checkpoint.paths.length} listed`);
  check("every one of them has content", assets.answerKeys.every((key) => key.content.length > 0));
  check("and the archive is reported as excluded rather than absent",
    assets.excludedAnswerKeys.some((entry) => entry.path.endsWith("solutions.zip")),
    JSON.stringify(assets.excludedAnswerKeys));
  check("content is cached by commit, so a second read is free", warmMs < coldMs / 2,
    `${coldMs}ms cold, ${warmMs}ms warm`);

  // An assignment with no answer key directory reads no second repository at all: nothing is
  // resolved and no request is made. Checked because resolving it anyway would spend a round
  // trip on every section of every assignment that has no reference solutions.
  const noKeys = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyRepo,
    answerKeyDir: null,
  });
  check("no answer key directory means no answer key commit",
    noKeys.answerKeyCommitSha === null && noKeys.answerKeys.length === 0);

  // A directory that is not there must be recorded, not thrown: grading without reference
  // solutions is worse but not useless, and the draft should say so rather than fail.
  const absent = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyRepo,
    answerKeyDir: "answer-keys/mod-4-dom/no-such-assignment",
  });
  check("a folder that is not there is recorded rather than fatal",
    absent.answerKeys.length === 0 &&
      absent.excludedAnswerKeys.some((entry) => entry.reason.includes("no such directory")),
    JSON.stringify(absent.excludedAnswerKeys));

  // The directory comes from a database column, and the repository it addresses is private, so
  // a traversal is a way to read files out of it that no assignment names.
  let escaped = "";
  try {
    await loadGradingAssets({
      sectionType: "short_response",
      answerKeyRepo,
      answerKeyDir: "../../.github/workflows",
    });
  } catch (err) {
    escaped = err instanceof GradingAssetsError ? "refused" : String(err);
  }
  check("a folder escaping the repository is refused", escaped === "refused", escaped);

  /*
    A directory with no repository to read it from.

    A configuration error that would otherwise grade silently without reference solutions —
    the exact failure the whole answer key mechanism exists to prevent.
  */
  let orphaned = "";
  try {
    await loadGradingAssets({
      sectionType: "short_response",
      answerKeyRepo: null,
      answerKeyDir: CHECKPOINT,
    });
    orphaned = "no error";
  } catch (err) {
    orphaned = err instanceof GradingAssetsError ? "refused" : String(err);
  }
  check("an answer key directory with no repository to read it from is refused",
    orphaned === "refused", orphaned);

  // A missing rubric section must fail loudly. Grading against nothing would otherwise
  // produce a confident report with no criteria behind it.
  let missingSection = "";
  try {
    await loadGradingAssets({
      sectionType: "coding_sql",
      answerKeyRepo,
      answerKeyDir: null,
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
