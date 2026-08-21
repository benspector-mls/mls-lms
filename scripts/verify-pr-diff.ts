/**
 * The shape of a real pull request's diff, and the parser run against it.
 *
 * Run with `npm run verify:pr-diff`.
 *
 * **Its first job is to replace estimates with measurements.** The per-file and total byte
 * ceilings were chosen by analogy with `MAX_FETCHED_FILE_BYTES`, and the list of languages was
 * chosen by thinking about a PERN stack. Both are guesses until they meet real submissions, so
 * this prints the patch size of every changed file and the language every path resolved to,
 * including the ones that resolved to none. Read the table; do not only read the count at the
 * bottom.
 *
 * **Its second job is the one a unit test cannot do.** `parseUnifiedPatch` is checked in
 * `tests/lib/diff/patch.test.ts` against patches its own author wrote, which cannot discover that
 * GitHub sends a shape nobody thought of. Here the same parser is run over every patch in a real
 * pull request and asked to hold its own invariant: a hunk header states how many lines each side
 * has, so the lines carrying a number on that side must come to exactly that many, and nothing
 * may land in `unparsed`.
 *
 * By default it takes the most recently active submission that has a pull request. Pass a
 * repository name, or part of one, to look at a particular student's instead:
 *
 *     npm run verify:pr-diff -- swe-1-5-arrays
 *
 * Needs the database and GitHub. It reads and never writes.
 */
import { createChecker, loadEnvironment, refusal } from "./verify/harness";

loadEnvironment();

const { check, checkThat, skip, finish } = createChecker();

/** Bytes, in the unit the ceilings are written in. */
function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}kB`;
}

async function main() {
  const { db } = await import("../lib/prisma");
  const { getConfiguredInstallationId } = await import("../lib/github/app-client");
  const { getPullRequestDiff } = await import("../lib/github/prs");
  const { splitRepoFullName } = await import("../lib/github/archives");
  const { parseUnifiedPatch } = await import("../lib/diff/patch");
  const { languageForPath } = await import("../lib/diff/languages");
  const { promptExclusionReason } = await import("../lib/grade/classify");

  // A positional argument, matching `verify:resubmission`, so a particular student's diff can be
  // looked at rather than whichever happens to be newest.
  const target = process.argv[2];

  const submission = await db.submission.findFirst({
    where: {
      repoFullName: target ? { contains: target } : { not: null },
      prNumber: { not: null },
    },
    select: { id: true, repoFullName: true, prNumber: true, headSha: true },
    orderBy: { lastActivityAt: "desc" },
  });

  if (!submission?.repoFullName || submission.prNumber === null) {
    skip(
      target
        ? `no submission with a pull request matches "${target}".`
        : "no submission has a pull request yet. Accept an assignment as a test student and push " +
            "a branch, or run verify:authoring first.",
    );
    return finish();
  }

  console.log(`--- ${submission.repoFullName} #${submission.prNumber} ---------------------`);

  const { owner, repo } = splitRepoFullName(submission.repoFullName);
  const diff = await getPullRequestDiff(getConfiguredInstallationId(), {
    owner,
    repo,
    pullNumber: submission.prNumber,
  });

  // =====================================================================================
  // What GitHub actually sent
  // =====================================================================================

  console.log("\n--- every changed file, as it arrived ---------------------------------");
  console.log("     bytes    +     -   language     path");
  for (const file of diff.files) {
    const bytes = file.patch === null ? "     —" : kb(new TextEncoder().encode(file.patch).length);
    const language = languageForPath(file.path) ?? "—";
    const bulk = promptExclusionReason(file.path);
    console.log(
      `     ${bytes.padStart(8)} ${String(file.additions).padStart(4)} ` +
        `${String(file.deletions).padStart(5)}   ${language.padEnd(12)}${file.path}` +
        `${bulk ? `  (${bulk})` : ""}` +
        `${file.patchAbsence ? `  [${file.patchAbsence}]` : ""}` +
        `${file.truncated ? "  [truncated here]" : ""}`,
    );
  }

  const totalBytes = diff.files.reduce(
    (sum, file) => sum + new TextEncoder().encode(file.patch ?? "").length,
    0,
  );
  console.log(
    `\n     ${diff.files.length} files, +${diff.totalAdditions} −${diff.totalDeletions}, ` +
      `${kb(totalBytes)} of patch in total`,
  );

  const noLanguage = diff.files.filter((file) => languageForPath(file.path) === null);
  console.log(
    `     ${noLanguage.length} of ${diff.files.length} paths have no grammar` +
      `${noLanguage.length > 0 ? `: ${noLanguage.map((file) => file.path).join(", ")}` : ""}`,
  );

  // =====================================================================================
  // The shape this application relies on
  // =====================================================================================

  console.log("\n--- the shape ---------------------------------------------------------");

  checkThat("the pull request reports at least one changed file", diff.files.length > 0);
  checkThat(
    "every file has a path, a kind, and a blob URL",
    diff.files.every((file) => file.path !== "" && file.kind !== undefined && file.blobUrl !== ""),
  );
  checkThat(
    "at least one file carries a patch",
    diff.files.some((file) => file.patch !== null),
    "a diff with no patch anywhere would render as a list of names",
  );
  checkThat(
    "every file with no patch says why",
    diff.files.every((file) => (file.patch === null) === (file.patchAbsence !== null)),
  );
  checkThat(
    "a renamed file names what it was called before",
    diff.files.every((file) => file.kind !== "renamed" || typeof file.previousPath === "string"),
    "no renames in this pull request, which is the usual case",
  );
  checkThat(
    "no patch exceeds the per-file ceiling",
    diff.files.every((file) => new TextEncoder().encode(file.patch ?? "").length <= 96_000),
    `largest is ${kb(Math.max(0, ...diff.files.map((f) => new TextEncoder().encode(f.patch ?? "").length)))}`,
  );
  check("GitHub's 3,000-file ceiling was not reached", diff.githubCapReached, false);

  // =====================================================================================
  // The parser against real output
  // =====================================================================================

  console.log("\n--- the parser, on what GitHub sent ------------------------------------");

  let parsed = 0;
  for (const file of diff.files) {
    if (file.patch === null) continue;
    const { hunks, unparsed } = parseUnifiedPatch(file.patch);
    parsed += 1;

    checkThat(
      `${file.path}: nothing unparsed`,
      unparsed.length === 0,
      unparsed.slice(0, 3).join(" | "),
    );
    checkThat(
      `${file.path}: every hunk holds the lines its header promises`,
      hunks.every(
        (hunk) =>
          hunk.lines.filter((line) => line.oldLine !== null).length === hunk.oldCount &&
          hunk.lines.filter((line) => line.newLine !== null).length === hunk.newCount,
      ),
      hunks.map((hunk) => hunk.header).join(" "),
    );
  }
  checkThat("at least one patch was parsed", parsed > 0);

  // =====================================================================================
  // Reading a diff is reading across students
  // =====================================================================================

  console.log("\n--- who may ask -------------------------------------------------------");

  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");
  const createCaller = createCallerFactory(appRouter);

  /*
    The property, not a proxy for it. The harness's own warning applies: "an instructor who is not
    the one this script acts as" is not the same as "an instructor who does not teach this course",
    and only the second is what the guard is about — so the stranger is chosen by having no
    CourseInstructor row for this submission's course.
  */
  const course = await db.submission.findUnique({
    where: { id: submission.id },
    select: { assignment: { select: { courseId: true } } },
  });
  const stranger = await db.profile.findFirst({
    where: {
      role: "INSTRUCTOR",
      instructorOf: { none: { courseId: course!.assignment.courseId } },
    },
    select: { id: true },
  });

  if (!stranger) {
    skip("no instructor exists who does not teach this course, so the guard cannot be tested");
  } else {
    const asStranger = createCaller({ db, user: { id: stranger.id } } as never);
    check(
      "an instructor who does not teach this course is refused",
      await refusal(() =>
        asStranger.pullRequests.diffForSubmission({ submissionId: submission.id }),
      ),
      "FORBIDDEN",
    );
  }

  return finish();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
