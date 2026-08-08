import "server-only";

import { getInstallationOctokit } from "./app-client";

export async function generateRepoFromTemplate(
  installationId: number,
  params: { templateOwner: string; templateRepo: string; owner: string; name: string },
) {
  const octokit = await getInstallationOctokit(installationId);
  const { data } = await octokit.request("POST /repos/{template_owner}/{template_repo}/generate", {
    template_owner: params.templateOwner,
    template_repo: params.templateRepo,
    owner: params.owner,
    name: params.name,
    private: true,
  });
  return data;
}

/** Returns null when the repository does not exist, rather than throwing. */
export async function getRepo(installationId: number, params: { owner: string; repo: string }) {
  const octokit = await getInstallationOctokit(installationId);
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}", {
      owner: params.owner,
      repo: params.repo,
    });
    return data;
  } catch (err) {
    if (err instanceof Object && "status" in err && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function addCollaborator(
  installationId: number,
  params: { owner: string; repo: string; username: string; permission?: "pull" | "push" | "admin" },
) {
  const octokit = await getInstallationOctokit(installationId);
  await octokit.request("PUT /repos/{owner}/{repo}/collaborators/{username}", {
    owner: params.owner,
    repo: params.repo,
    username: params.username,
    permission: params.permission ?? "push",
  });
}

/**
 * Whether a 404 from the contents endpoint means "the copy has not landed yet".
 *
 * GitHub answers a contents request on a repository with no commits with 404 and the body
 * `"This repository is empty."` — the same status as a file that genuinely is not there.
 * The body is the only thing that tells them apart, and telling them apart is the whole
 * point: one means wait, the other means there is nothing to do.
 */
function isEmptyRepositoryError(err: unknown): boolean {
  if (!(err instanceof Object) || !("status" in err) || err.status !== 404) return false;
  const message = (err as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  return typeof message === "string" && /repository is empty/i.test(message);
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Waits until a generated repository has content, or gives up.
 *
 * **`generate` returns before the files are copied.** Measured rather than assumed: the
 * call returned after 2.1 seconds and the new repository's tree only became readable at
 * 5.6 seconds. In between, the repository exists and is empty, and anything reading it
 * gets a 404 it cannot tell from "no such file".
 *
 * So every read of a freshly generated repository waits here first. Bounded, with
 * lengthening gaps, and it returns false rather than throwing on running out: the
 * repository does exist by then and the student can work in it, so failing their accept
 * over a workflow file nobody trusts would be the worse outcome. The caller says what a
 * false means for it.
 *
 * The window widens the more arbitrary the template is. A large public template — which
 * an instructor may now name freely — takes longer to copy than the small ones this
 * program uses, which is why this is a real wait rather than one optimistic retry.
 */
export async function waitForRepoContent(
  installationId: number,
  params: { owner: string; repo: string },
  /** Milliseconds to wait before each attempt. Overridden only by tests and scripts. */
  backoffMs: readonly number[] = [0, 500, 1000, 1500, 2000, 3000, 3000, 4000],
): Promise<boolean> {
  const octokit = await getInstallationOctokit(installationId);

  for (const delay of backoffMs) {
    if (delay > 0) await sleep(delay);
    try {
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: params.owner,
        repo: params.repo,
        path: "",
      });
      // The root of a repository with commits is a directory, so an array is the answer
      // that means the copy has landed.
      if (Array.isArray(data)) return true;
    } catch (err) {
      if (isEmptyRepositoryError(err)) continue;
      // Anything else — a repository that does not exist, a revoked token — is not
      // something waiting fixes.
      throw err;
    }
  }

  return false;
}

/** What `removeClassroomWorkflow` found. Returned rather than logged, so a caller can check. */
export type ClassroomWorkflowOutcome =
  /** The file was there and is gone. */
  | "removed"
  /** The repository has content and no such file, which is the ordinary case. */
  | "absent"
  /**
   * The repository still had no commits, so whether the file exists is unknown.
   *
   * Distinct from `absent` because it used to be reported as it — a 404 was taken for "no
   * such file" — which meant losing the race against the asynchronous copy looked exactly
   * like success. Nothing could tell that a `classroom.yml` had been left behind.
   */
  | "repository-empty";

/**
 * Removes the GitHub Classroom autograder workflow from a generated repository.
 *
 * Two reasons. GitHub Classroom is being retired, so the workflow will stop
 * working. More importantly, its results were never trusted as a grading signal,
 * because the workflow file lives in the student's own repository where they can
 * modify it. All grading facts are produced server side instead.
 *
 * Call `waitForRepoContent` before this on a repository that was just generated. Without
 * it the answer is `repository-empty` for the first few seconds of the repository's life,
 * which is neither of the two answers the caller wants.
 */
export async function removeClassroomWorkflow(
  installationId: number,
  params: { owner: string; repo: string },
): Promise<ClassroomWorkflowOutcome> {
  const octokit = await getInstallationOctokit(installationId);
  const path = ".github/workflows/classroom.yml";

  let existing;
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: params.owner,
      repo: params.repo,
      path,
    });
    existing = data;
  } catch (err) {
    if (isEmptyRepositoryError(err)) return "repository-empty";
    if (err instanceof Object && "status" in err && err.status === 404) return "absent";
    throw err;
  }

  // The contents endpoint returns an array for directories and an object for
  // files. A directory at this path, or a response without a sha, means there is
  // no single file to delete.
  if (Array.isArray(existing) || !("sha" in existing)) {
    return "absent";
  }

  await octokit.request("DELETE /repos/{owner}/{repo}/contents/{path}", {
    owner: params.owner,
    repo: params.repo,
    path,
    message: "Remove legacy GitHub Classroom autograder workflow",
    sha: existing.sha,
  });

  return "removed";
}
