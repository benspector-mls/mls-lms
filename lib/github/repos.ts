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
 * Removes the GitHub Classroom autograder workflow from a generated repository.
 *
 * Two reasons. GitHub Classroom is being retired, so the workflow will stop
 * working. More importantly, its results were never trusted as a grading signal,
 * because the workflow file lives in the student's own repository where they can
 * modify it. All grading facts are produced server side instead.
 *
 * Does nothing if the file is absent.
 */
export async function removeClassroomWorkflow(
  installationId: number,
  params: { owner: string; repo: string },
) {
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
    if (err instanceof Object && "status" in err && err.status === 404) {
      return;
    }
    throw err;
  }

  // The contents endpoint returns an array for directories and an object for
  // files. A directory at this path, or a response without a sha, means there is
  // no single file to delete.
  if (Array.isArray(existing) || !("sha" in existing)) {
    return;
  }

  await octokit.request("DELETE /repos/{owner}/{repo}/contents/{path}", {
    owner: params.owner,
    repo: params.repo,
    path,
    message: "Remove legacy GitHub Classroom autograder workflow",
    sha: existing.sha,
  });
}
