import "server-only";

import { installationIdForOwner } from "../github/app-client";
import { getDefaultBranch } from "../github/archives";
import { fetchRepoFile, listRepoDirectory } from "../github/files";
import { isShortResponseFile } from "../grade/classify";
import type { TemplateContents } from "./propose-sections";
import { testsInFile, type TemplateTest } from "./test-names";

/**
 * Reading the files `proposeSections` reads: the short response file, the README, and the test
 * files. A handful of small requests, as `detectRunnerPreset` makes, rather than an archive.
 *
 * Throws with a message an instructor can act on when the repository cannot be read, since the
 * proposal is pressed for rather than run on every keystroke, and "nothing was proposed" would
 * hide a typo in the template name.
 */

/** Enough for any assignment's suite; a template with more test files than this is not one. */
const MAX_TEST_FILES = 12;

const TEST_FILE = /\.(py|js|mjs|cjs|ts|jsx|tsx)$/i;

type Opened = {
  installationId: number;
  at: { owner: string; repo: string; ref: string };
  root: { type: string; name: string }[];
};

/** The template at its ref, listed at the root, or an error an instructor can act on. */
async function openTemplate(params: {
  templateRepo: string;
  templateRef: string | null;
}): Promise<Opened> {
  const [owner, repo] = params.templateRepo.split("/");
  if (!owner || !repo) throw new Error(`"${params.templateRepo}" is not owner/repo.`);

  const installationId = await installationIdForOwner(owner);
  if (installationId === null) {
    throw new Error(
      `The GitHub App is not installed on ${owner}, so ${params.templateRepo} cannot be read.`,
    );
  }

  const ref = params.templateRef ?? (await getDefaultBranch(installationId, { owner, repo }));
  const at = { owner, repo, ref };

  const root = await listRepoDirectory(installationId, { ...at, path: "" });
  if (root === null) throw new Error(`${params.templateRepo} cannot be read at ${ref}.`);
  return { installationId, at, root };
}

/** The test files under `tests/`, each with its text, or none when the template has no such folder. */
async function readTestFiles(opened: Opened): Promise<{ path: string; content: string }[]> {
  const { installationId, at, root } = opened;
  const hasTests = root.some((entry) => entry.type === "dir" && entry.name === "tests");
  if (!hasTests) return [];
  const entries = (await listRepoDirectory(installationId, { ...at, path: "tests" })) ?? [];
  const names = entries
    .filter((entry) => entry.type === "file" && TEST_FILE.test(entry.name))
    .map((entry) => entry.name)
    .slice(0, MAX_TEST_FILES);
  return Promise.all(
    names.map(async (name) => ({
      path: `tests/${name}`,
      content: (await fetchRepoFile(installationId, { ...at, path: `tests/${name}` })) ?? "",
    })),
  );
}

export async function readTemplateForProposal(params: {
  templateRepo: string;
  templateRef: string | null;
  hasRunner: boolean;
}): Promise<TemplateContents> {
  const opened = await openTemplate(params);
  const { installationId, at, root } = opened;

  const shortResponseName = root.find(
    (entry) => entry.type === "file" && isShortResponseFile(entry.name),
  )?.name;

  const [shortResponse, readme, tests] = await Promise.all([
    shortResponseName
      ? fetchRepoFile(installationId, { ...at, path: shortResponseName })
      : Promise.resolve(null),
    fetchRepoFile(installationId, { ...at, path: "README.md" }),
    readTestFiles(opened),
  ]);

  return { shortResponse, readme, tests, hasRunner: params.hasRunner };
}

/**
 * Every test the template's suite declares, in file order: what the section editor offers and
 * what `convert:sections` resolves an old pattern against.
 */
export async function readTemplateTests(params: {
  templateRepo: string;
  templateRef: string | null;
}): Promise<TemplateTest[]> {
  const files = await readTestFiles(await openTemplate(params));
  return files.flatMap((file) => testsInFile(file.path, file.content));
}
