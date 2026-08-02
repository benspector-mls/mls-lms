import "server-only";

import { getInstallationOctokit } from "./app-client";

export type PullRequestFileChange = {
  path: string;
  kind: "added" | "modified" | "removed" | "renamed";
  /** Set only when kind is "renamed". */
  previousPath?: string;
};

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
  const octokit = await getInstallationOctokit(installationId);
  const files = await octokit.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    per_page: 100,
  });

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
