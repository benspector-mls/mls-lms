/**
 * Checks that grading assets can be read the way a deployed host reads them.
 *
 * Run with `npm run verify:assets`.
 *
 * Locally the assets come from a clone, so nothing here is exercised by ordinary
 * development — which is exactly why it needs its own check. This forces the GitHub
 * path by unsetting the local override, then confirms the two sources return the same
 * rubric. A deployment that cannot read its rubric cannot grade at all.
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
  const { loadGradingAssets, GradingAssetsError, listAssignmentDirs, listAnswerKeys, checkAnswerKeyPaths } =
    await import("../lib/grade/assets");

  const localPath = process.env.GRADING_ASSETS_PATH;

  /*
    The catalogue, against whichever source this environment has.

    Checked before the remote section because it is the half that runs during ordinary
    development, and because the strongest available check needs no network: the paths the
    catalogue reports for `swe-1-3-node-modules` must be exactly the ones `prisma/seed.ts`
    hardcodes for it. Those were written by hand against the repository, so agreement means
    the catalogue is reading the same structure the working pipeline was configured from —
    including the nested `madlib-challenge/` keys a non-recursive listing would miss.
  */
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

  const localCatalogue = { dirs, keys: await listAnswerKeys("mod-1-js-fundamentals", "swe-1-3-node-modules") };
  const nested = localCatalogue.keys;
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

  if (!process.env.GRADING_ASSETS_REPO) {
    console.log(
      `\n${failures === 0 ? "The catalogue checks passed." : `${failures} catalogue check(s) failed.`}\n` +
      "\nGRADING_ASSETS_REPO is not set, so the deployed path was not checked. Add it to\n" +
      ".env.local — see .env.example — and note that GRADING_ASSETS_INSTALLATION_ID has to\n" +
      "be an installation of the App this environment is configured with. The development\n" +
      "App and the production App have separate installations, so an id that works for one\n" +
      "returns 404 for the other.",
    );
    process.exit(failures === 0 ? 0 : 1);
  }

  // The deployed host has no clone, so neither does this check.
  delete process.env.GRADING_ASSETS_PATH;

  const coldStart = Date.now();
  const remote = await loadGradingAssets({
    sectionType: "short_response",
    answerKeyPaths: ["mod-4-dom/swe-checkpoint-summative-1-4/SHORT_RESPONSE.MD"],
  });
  const coldMs = Date.now() - coldStart;

  const warmStart = Date.now();
  await loadGradingAssets({ sectionType: "short_response", answerKeyPaths: [] });
  const warmMs = Date.now() - warmStart;

  check("a commit sha is resolved", typeof remote.commitSha === "string",
    remote.commitSha ?? "none");
  check("agent rules are readable", remote.agentRules.length > 500,
    `${remote.agentRules.length} chars`);
  check("the rubric section is sliced, not the whole file",
    remote.rubricSection.startsWith("## SHORT RESPONSE") && remote.rubricSection.length < 8000,
    `${remote.rubricSection.length} chars`);
  check("the sample report is readable", remote.sampleReport.length > 200,
    `${remote.sampleReport.length} chars`);
  check("a real answer key is found", remote.answerKeys.length === 1,
    `${remote.answerKeys.length} found, ${remote.missingAnswerKeys.length} missing`);
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

  /*
    The catalogue over the API, compared against what the clone reported.

    This is the check the catalogue most needs. An instructor authoring an assignment picks
    from this list, so a catalogue that offered one set of assignments in development and a
    different set on the deployment would put an assignment in a course that grading cannot
    find answer keys for — and it would do so silently, because both halves look right on
    their own. The two implementations are separate code (`readdirSync` against the contents
    API), which is exactly why they are compared rather than assumed to agree.
  */
  if (localPath) {
    const remoteDirs = await listAssignmentDirs("mod-1-js-fundamentals");
    const remoteKeys = await listAnswerKeys("mod-1-js-fundamentals", "swe-1-3-node-modules");

    check("both sources list the same assignments",
      JSON.stringify(remoteDirs) === JSON.stringify(localCatalogue.dirs),
      JSON.stringify(remoteDirs) === JSON.stringify(localCatalogue.dirs)
        ? `${remoteDirs.length} from each`
        : `clone: ${JSON.stringify(localCatalogue.dirs)}\n  repository: ${JSON.stringify(remoteDirs)}`);

    // Same order as well as same set, since this is what fills a form: an instructor
    // reading a differently ordered list in two environments would reasonably wonder which
    // one is wrong.
    check("both sources list the same answer keys, in the same order",
      JSON.stringify(remoteKeys) === JSON.stringify(localCatalogue.keys),
      JSON.stringify(remoteKeys) === JSON.stringify(localCatalogue.keys)
        ? `${remoteKeys.length} from each, nested included`
        : `clone: ${JSON.stringify(localCatalogue.keys)}\n  repository: ${JSON.stringify(remoteKeys)}`);

    process.env.GRADING_ASSETS_PATH = localPath;
    const local = await loadGradingAssets({ sectionType: "short_response", answerKeyPaths: [] });
    // The clone is usually ahead of or behind the remote while the rubric is being
    // edited, so a difference is information rather than a failure.
    check("the local clone and the repository agree on the rubric",
      local.rubricSection === remote.rubricSection,
      local.rubricSection === remote.rubricSection
        ? `both at ${remote.commitSha?.slice(0, 7)}`
        : `clone is at ${local.commitSha?.slice(0, 7)}, repository at ` +
          `${remote.commitSha?.slice(0, 7)} — commit and push the clone, or pull it`);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error("\n", err); process.exit(1); });
