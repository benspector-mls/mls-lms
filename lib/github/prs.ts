import "server-only";

import { truncateAtHunkBoundary } from "../diff/patch";
import { getInstallationOctokit } from "./app-client";

export type PullRequestFileChange = {
  path: string;
  kind: "added" | "modified" | "removed" | "renamed";
  /** Set only when kind is "renamed". */
  previousPath?: string;
};

/**
 * The endpoint both readers below are built on, called once and mapped twice.
 *
 * Private because the shape it returns is GitHub's rather than this application's, and the two
 * questions asked of it — which paths changed, and what the change was — want different answers
 * rather than one answer with optional halves.
 */
async function listPullRequestFiles(
  installationId: number,
  params: { owner: string; repo: string; pullNumber: number },
) {
  const octokit = await getInstallationOctokit(installationId);
  return octokit.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    per_page: 100,
  });
}

/**
 * Returns every file a pull request changes, with what happened to it.
 *
 * This is the tamper report for protected paths, and it is the right comparison
 * rather than merely the cheap one. A student repository is created by
 * `POST /repos/{template_owner}/{template_repo}/generate`, which produces a
 * repository whose default branch holds one commit containing the template's
 * files as they were at that moment. The student branches from there and opens a
 * pull request back into it, so this diff is measured against the template
 * snapshot *that student received*.
 *
 * Two consequences follow. It reports exactly the files that student changed. And
 * because it never examines the current template, a bug an instructor fixes in
 * the template mid-cohort cannot appear in any student's pull request — so the
 * template can be corrected freely without making anyone look dishonest.
 *
 * Known limit: a change committed straight to the student's own default branch,
 * before they branched, sits in the pull request's base and does not appear here.
 * That is a reporting gap and never a scoring gap, because the template's version
 * of every protected path is restored before the suite runs either way.
 *
 * GitHub caps this endpoint at 3,000 files, which no assignment repository
 * approaches.
 */
export async function getPullRequestFileChanges(
  installationId: number,
  params: { owner: string; repo: string; pullNumber: number },
): Promise<PullRequestFileChange[]> {
  const files = await listPullRequestFiles(installationId, params);

  return files.map((file) => ({
    path: file.filename,
    // GitHub also uses "copied", "changed", and "unchanged". All three mean the
    // file's contents differ from the base or the file is newly present, which is
    // what the tamper report is about, so they collapse into "modified" rather
    // than widening the union with cases nothing downstream distinguishes.
    kind:
      file.status === "added" || file.status === "removed" || file.status === "renamed"
        ? file.status
        : "modified",
    ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
  }));
}

/**
 * Returns just the paths of every file changed in a pull request.
 *
 * Used by section classification, which only needs to know which paths are
 * present. Use getPullRequestFileChanges when what happened to a file matters.
 */
export async function getPullRequestFiles(
  installationId: number,
  params: { owner: string; repo: string; pullNumber: number },
): Promise<string[]> {
  const changes = await getPullRequestFileChanges(installationId, params);
  return changes.map((change) => change.path);
}

/**
 * Posts a comment on a pull request, or edits an existing one when
 * `existingCommentId` is supplied. Editing matters on resubmission, so a student
 * sees one updated review rather than a growing list of them.
 *
 * Not used in Phase 1. The approval action uses it in Phase 3.
 */
export async function postOrUpdatePrComment(
  installationId: number,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
    existingCommentId?: number;
  },
) {
  const octokit = await getInstallationOctokit(installationId);

  if (params.existingCommentId) {
    const { data } = await octokit.request(
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
      {
        owner: params.owner,
        repo: params.repo,
        comment_id: params.existingCommentId,
        body: params.body,
      },
    );
    return data;
  }

  const { data } = await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      body: params.body,
    },
  );
  return data;
}

/**
 * The largest patch this application will hand to a browser for one file.
 *
 * The same order as `MAX_FETCHED_FILE_BYTES` in `files.ts` and tighter, because dozens of these
 * travel in one response where that one is a single file. Cut at a hunk boundary rather than at a
 * byte, so the parser never sees a header promising more lines than follow.
 *
 * **Roughly thirty times the largest patch any real submission has produced.** Across every pull
 * request in the development database the biggest single file's diff was 2.9kB, so this is not a
 * limit ordinary work approaches — it is there for the one accident that produces a large one, a
 * committed `node_modules` or lockfile, where the alternative is handing a browser megabytes of
 * text nobody will read. `verify:pr-diff` prints the real figure on every run, which is how a
 * later reader can tell whether that is still true.
 */
const MAX_PATCH_BYTES = 96_000;

/** Why a file has no patch. Never an error; both cases are ordinary. */
export type PatchAbsence = "no-content-change" | "binary-or-too-large";

export type PullRequestFileDiff = {
  path: string;
  kind: PullRequestFileChange["kind"];
  /** Set only when kind is "renamed", matching PullRequestFileChange. */
  previousPath?: string;
  additions: number;
  deletions: number;
  /**
   * The unified diff for this file, or null when there is none to show.
   *
   * Begins at the first `@@`: GitHub's per-file patch carries no `--- a/x` or `+++ b/x` header,
   * which is why `parseUnifiedPatch` must not special-case those prefixes.
   */
  patch: string | null;
  /** Why `patch` is null, or null when it is not. */
  patchAbsence: PatchAbsence | null;
  /** True when this application cut the patch, rather than GitHub omitting it. */
  truncated: boolean;
  /** The file on GitHub at the head commit, for the link out. */
  blobUrl: string;
};

export type PullRequestDiff = {
  files: PullRequestFileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  /**
   * True when GitHub's 3,000-file ceiling may have cut the list.
   *
   * Inferred from the count, because the endpoint does not say so. No assignment repository
   * approaches it — the same note `getPullRequestFileChanges` makes — and it is reported rather
   * than assumed away, because a committed dependency tree is the one way a student reaches it by
   * accident.
   */
  githubCapReached: boolean;
};

/**
 * Every file a pull request changes, with the change itself.
 *
 * **The same request `getPullRequestFileChanges` makes, keeping the part it throws away.** The
 * `files` endpoint returns a unified diff per file — already computed, already paid for — and
 * grading only ever needed to know which paths were present. Showing the work to an instructor
 * needs the part that was being discarded, at no additional cost in requests.
 *
 * Everything the pull request base means for this diff is written at
 * `getPullRequestFileChanges` above, and applies here unchanged: it is measured against the
 * template snapshot that student received, so a change committed straight to their own default
 * branch before they branched sits in the base and does not appear. That is a real limit of what
 * this can show, and the panel that draws it says so.
 */
export async function getPullRequestDiff(
  installationId: number,
  params: { owner: string; repo: string; pullNumber: number },
): Promise<PullRequestDiff> {
  const files = await listPullRequestFiles(installationId, params);

  const mapped = files.map((file): PullRequestFileDiff => {
    const kind =
      file.status === "added" || file.status === "removed" || file.status === "renamed"
        ? file.status
        : ("modified" as const);

    /*
      GitHub omits `patch` for a binary file, for a diff it considers very large, and for a rename
      or mode change with no content difference — and it does not say which. So the reason is
      inferred, and this is a heuristic rather than something reported: nothing changed means there
      is genuinely nothing to show, and anything else means GitHub declined to send it. The two are
      different sentences on screen, and reversing them would tell an instructor that a renamed
      file is unreadable.
    */
    const raw = file.patch ?? null;
    if (raw === null) {
      return {
        path: file.filename,
        kind,
        ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
        additions: file.additions,
        deletions: file.deletions,
        patch: null,
        patchAbsence: file.changes === 0 ? "no-content-change" : "binary-or-too-large",
        truncated: false,
        blobUrl: file.blob_url ?? "",
      };
    }

    const cut = truncateAtHunkBoundary(raw, MAX_PATCH_BYTES);
    return {
      path: file.filename,
      kind,
      ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
      additions: file.additions,
      deletions: file.deletions,
      patch: cut,
      patchAbsence: null,
      truncated: cut !== raw,
      blobUrl: file.blob_url ?? "",
    };
  });

  return {
    files: mapped,
    totalAdditions: mapped.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: mapped.reduce((sum, file) => sum + file.deletions, 0),
    githubCapReached: files.length >= 3000,
  };
}
