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
  const { loadGradingAssets, GradingAssetsError } = await import("../lib/grade/assets");

  const localPath = process.env.GRADING_ASSETS_PATH;
  if (!process.env.GRADING_ASSETS_REPO) {
    console.error(
      "GRADING_ASSETS_REPO is not set, so the deployed path cannot be checked.\n" +
      "Add it to .env.local — see .env.example.",
    );
    process.exit(1);
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

  if (localPath) {
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
