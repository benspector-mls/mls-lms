import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { teachableSubmission } from "@/lib/courses/scope";
import { languageForPath, type DiffLanguage } from "@/lib/diff/languages";
import { promptExclusionReason } from "@/lib/grade/classify";
import { getConfiguredInstallationId } from "@/lib/github/app-client";
import { splitRepoFullName } from "@/lib/github/archives";
import { getPullRequestDiff, type PatchAbsence } from "@/lib/github/prs";
import { createTRPCRouter, instructorProcedure } from "../init";

/**
 * What a pull request holds, for the column beside the grade.
 *
 * Its own router rather than another procedure on `submissions`, which is a thousand lines about
 * rows in this database. This one is about a third-party API with its own ceilings and its own
 * failure modes — the argument `test-runs.ts` makes in its own header. Named for pull requests
 * rather than for diffs so that the next question of one, a whole file's contents at a commit, has
 * an obvious home.
 *
 * Every procedure here reads across students, so each one checks that the caller teaches the
 * course rather than relying on `instructorProcedure` alone.
 */

/**
 * The most patch text one response will carry.
 *
 * A ceiling on the payload, applied after the ordering below, so what it cuts is bulk.
 *
 * **Around a hundred times what a real submission sends.** Measured across every pull request in
 * the development database, the largest diff came to 8.5kB of patch across five files. So this is
 * a backstop against the accident — a committed dependency tree — rather than a budget ordinary
 * work is spent against, and being far above the real figure is the right side to be wrong on: a
 * ceiling that cut a genuine submission would hide a student's work with a sentence about size.
 * `verify:pr-diff` prints the real total on every run.
 */
const MAX_TOTAL_PATCH_BYTES = 800_000;

/** Columns safe to send to the browser. Keeps future additions opt-in. */
type DiffFile = {
  path: string;
  previousPath: string | null;
  kind: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch: string | null;
  patchAbsence: PatchAbsence | null;
  truncated: boolean;
  blobUrl: string;
  /** Why this file is bulk rather than student work, or null. A label, never a filter. */
  bulkReason: string | null;
  /** Which grammar the browser should load, or null for plain monospace. */
  language: DiffLanguage | null;
};

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export const pullRequestsRouter = createTRPCRouter({
  /**
   * The diff of one submission's pull request, as text for the browser to parse.
   *
   * A query rather than a mutation: it reads, it is idempotent, and only a query gets the
   * `enabled` gate and the thirty-second `staleTime` that stop an instructor clicking between two
   * students in the queue from fetching the same diff twice.
   *
   * **Nothing is stored.** A `TestRun` row exists because a sandbox costs money and its result is
   * evidence attached to a grade that has to outlive the grading. A diff is a projection of
   * GitHub's own data at a commit, and GitHub is the system of record — it is already the link in
   * this screen's header. A cache row would need a `(submissionId, headSha)` key, a migration, an
   * eviction story for a force-push, and a column holding most of a megabyte of text per commit,
   * to buy a fraction of a second on a second open.
   *
   * **No rate limit and no audit event, and both are deliberate.** `assertWithinRate` exists to
   * stop a loop that spends real money at Anthropic and E2B; this is one authenticated GET against
   * an endpoint the grading pipeline already calls on every draft generation, on the read path of
   * a screen an instructor opens dozens of times an hour — a ceiling here would fire during
   * ordinary work. An audit row per diff view would also inflate any rate window later counted out
   * of that table, which is what `assertWithinRate` is built on. What would change both answers is
   * prefetching diffs across a whole queue, which nothing does.
   */
  diffForSubmission: instructorProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const submission = await teachableSubmission(ctx, input.submissionId, {
        id: true,
        repoFullName: true,
        repoUrl: true,
        prNumber: true,
        prUrl: true,
        headSha: true,
      });

      /*
        A precondition rather than a state to render. The review screen decides whether to show
        this panel at all from `prNumber`, before asking, so a submission with no repository or no
        pull request never reaches here — and returning those as data would put two branches in
        the panel that nothing can reach. The same reasoning `testRuns.start` gives for an
        assignment with no tests: reaching this means a caller went around the gate.
      */
      if (!submission.repoFullName || submission.prNumber === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This submission has no pull request yet, so there is no diff to read. The student " +
            "has to accept the assignment and push a branch first.",
        });
      }

      const { owner, repo } = splitRepoFullName(submission.repoFullName);
      const diff = await getPullRequestDiff(getConfiguredInstallationId(), {
        owner,
        repo,
        pullNumber: submission.prNumber,
      });

      const labelled = diff.files.map((file) => ({
        file,
        bulkReason: promptExclusionReason(file.path),
      }));

      /*
        **The ordering is the substance, not the ceiling.** A committed `package-lock.json` is one
        file with forty thousand changed lines; in GitHub's own order it would take the whole
        allowance and push the three files the student actually wrote off the end of the list. So
        student work sorts first, then bulk, then whatever has no patch to show — and the ceiling
        below then cuts from the end, which is bulk.

        `promptExclusionReason` is asked here as a *label and a sort key only*. It decides what must
        never be sent to a third party, and an instructor is the opposite case: a committed `.env`
        is exactly what they need to see, because they are the person who tells the student to
        rotate the key. So nothing is withheld — it is ordered, named, and collapsed.

        `sort` is stable, so GitHub's own order (which is path order) survives inside each group.
      */
      const ordered = labelled.sort((a, b) => rank(a) - rank(b));

      const kept: DiffFile[] = [];
      let bytes = 0;
      let omittedFiles = 0;

      for (const [index, entry] of ordered.entries()) {
        const size = byteLength(entry.file.patch ?? "");
        // `kept.length > 0` so that a first file larger than the whole allowance is still sent —
        // its own per-file ceiling has already cut it, and an empty panel explains nothing.
        if (kept.length > 0 && bytes + size > MAX_TOTAL_PATCH_BYTES) {
          omittedFiles = ordered.length - index;
          break;
        }
        bytes += size;
        kept.push({
          path: entry.file.path,
          previousPath: entry.file.previousPath ?? null,
          kind: entry.file.kind,
          additions: entry.file.additions,
          deletions: entry.file.deletions,
          patch: entry.file.patch,
          patchAbsence: entry.file.patchAbsence,
          truncated: entry.file.truncated,
          blobUrl: entry.file.blobUrl,
          bulkReason: entry.bulkReason,
          /*
            Resolved here even though `languageForPath` is pure and the browser could ask it. The
            grammar loaders are keyed by the same union, so naming the language on this side means
            the browser never receives one it has no loader for.
          */
          language: languageForPath(entry.file.path),
        });
      }

      return {
        prNumber: submission.prNumber,
        prUrl: submission.prUrl,
        repoUrl: submission.repoUrl,
        headSha: submission.headSha,
        files: kept,
        totals: {
          files: diff.files.length,
          additions: diff.totalAdditions,
          deletions: diff.totalDeletions,
        },
        /** Changed files not in `files`, because the ceiling cut them. */
        omittedFiles,
        githubCapReached: diff.githubCapReached,
      };
    }),
});

/** Student work first, then bulk, then anything with no patch to read. */
function rank(entry: { file: { patch: string | null }; bulkReason: string | null }): number {
  if (entry.file.patch === null) return 2;
  return entry.bulkReason ? 1 : 0;
}
