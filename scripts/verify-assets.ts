/**
 * Checks that the grading assets can be read at all, and that the catalogue built from
 * them is the one an authoring form should offer.
 *
 * Run with `npm run verify:assets`.
 *
 * There is one source — the repository over the GitHub API — so this exercises the same
 * path every environment uses, and a failure here means grading cannot happen anywhere.
 * It needs `GRADING_ASSETS_REPO` and an installation that can see it.
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
  const { loadGradingAssets, GradingAssetsError, listAnswerKeyDirs, listAssignmentDirs, listAnswerKeys, checkAnswerKeyPaths } =
    await import("../lib/grade/assets");

  if (!process.env.GRADING_ASSETS_REPO) {
    console.error(
      "GRADING_ASSETS_REPO is not set, so there is nothing to read. Set it to owner/repo in\n" +
      ".env.local — see .env.example — along with GRADING_ASSETS_INSTALLATION_ID, which has\n" +
      "to be an installation of the App this environment is configured with. The development\n" +
      "App and the production App have separate installations, so an id that works for one\n" +
      "returns 404 for the other.",
    );
    process.exit(1);
  }

  /*
    The catalogue an authoring form will offer.

    The strongest check here does not depend on the network being fast or the rubric being
    any particular shape: the paths the catalogue reports for `swe-1-3-node-modules` must be
    exactly the ones `prisma/seed.ts` hardcodes for it. Those were written by hand against
    the repository, so agreement means the catalogue reads the same structure the working
    pipeline was configured from — including the nested `madlib-challenge/` keys a
    non-recursive listing would miss.
  */
  /*
    The root listing, which the authoring form's "reference solutions live under" select is
    built from. Checked because it failed silently: the path builder normalises "" to ".", so it
    asked GitHub for `answer-keys/.` and got nothing — an empty select that read as an empty
    repository, and refused to let an assignment be created at all.
  */
  const rootDirs = await listAnswerKeyDirs();
  check("the answer-keys root lists its module directories", rootDirs.length > 0,
    `${rootDirs.length} found`);
  check("...including mod-1-js-fundamentals", rootDirs.includes("mod-1-js-fundamentals"));

  const dirs = await listAssignmentDirs("mod-1-js-fundamentals");
  check("the catalogue lists mod-1 assignments", dirs.length > 0, `${dirs.length} found`);
  for (const seeded of ["swe-1-4-loops", "swe-1-3-node-modules"]) {
    check(`the catalogue contains ${seeded}`, dirs.includes(seeded));
  }
  check(
    "the catalogue lists more than the seed knows about",
    dirs.length > 3,
    `${dirs.length} in the repository against 3 in SEED_ASSIGNMENTS`,
  );
  check("a module with no answer keys lists nothing rather than failing",
    (await listAssignmentDirs("mod-99-does-not-exist")).length === 0);

  const nested = await listAnswerKeys("mod-1-js-fundamentals", "swe-1-3-node-modules");
  const expectedNested = [
    "mod-1-js-fundamentals/swe-1-3-node-modules/modify.js",
    "mod-1-js-fundamentals/swe-1-3-node-modules/madlib-challenge/index.js",
    "mod-1-js-fundamentals/swe-1-3-node-modules/madlib-challenge/madlib.js",
  ];
  check(
    "answer keys match what the seed hardcodes, nested ones included",
    JSON.stringify([...nested].sort()) === JSON.stringify([...expectedNested].sort()),
    `got ${JSON.stringify(nested)}`,
  );
  check(
    "the paths are in the form sections[].answerKeyPaths stores",
    nested.every((p) => p.startsWith("mod-1-js-fundamentals/") && !p.startsWith("answer-keys/")),
  );

  const checked = await checkAnswerKeyPaths([
    "mod-1-js-fundamentals/swe-1-4-loops/from-scratch.js",
    "mod-1-js-fundamentals/swe-1-4-loops/does-not-exist.js",
    "../../../etc/passwd",
  ]);
  check("a real answer key is found", checked[0]?.found === true);
  check("a mistyped answer key is reported, not thrown",
    checked[1]?.found === false, checked[1]?.reason);
  // The same guard grading uses, reported per path so one bad entry does not hide the rest.
  check("a traversal path is refused and the message says so",
    checked[2]?.found === false && (checked[2]?.reason ?? "").includes("escapes"),
    checked[2]?.reason);

  const coldStart = Date.now();
  const assets = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyPaths: ["mod-4-dom/swe-checkpoint-summative-1-4/SHORT_RESPONSE.MD"],
  });
  const coldMs = Date.now() - coldStart;

  const warmStart = Date.now();
  await loadGradingAssets({ sectionType: "short_response", answerKeyPaths: [] });
  const warmMs = Date.now() - warmStart;

  check("a commit sha is resolved", typeof assets.commitSha === "string",
    assets.commitSha ?? "none");
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

  // An answer key path that does not exist must be recorded, not thrown: grading
  // without a reference solution is worse but not useless.
  const absent = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyPaths: ["mod-4-dom/no-such-assignment/KEY.md"],
  });
  check("a missing answer key is recorded rather than fatal",
    absent.missingAnswerKeys.length === 1 && absent.answerKeys.length === 0);

  // These paths come from a database column. Against the API a traversal would read
  // arbitrary files out of a private repository, so the rule has to hold on both
  // sources and not rely on a filesystem resolver only one of them uses.
  let escaped = "";
  try {
    await loadGradingAssets({
      sectionType: "short_response",
      answerKeyPaths: ["../../.github/workflows/deploy.yml"],
    });
  } catch (err) {
    escaped = err instanceof GradingAssetsError ? "refused" : String(err);
  }
  check("a path escaping answer-keys is refused", escaped === "refused", escaped);

  // A missing rubric section must fail loudly. Grading against nothing would otherwise
  // produce a confident report with no criteria behind it.
  let missingSection = "";
  try {
    await loadGradingAssets({ sectionType: "coding_sql", answerKeyPaths: [] });
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
