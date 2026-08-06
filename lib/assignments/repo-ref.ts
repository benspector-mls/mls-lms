/**
 * Turning what an instructor pasted into `owner/repo`.
 *
 * An assignment names two repositories — the template a student's repository is generated
 * from, and the one holding its reference solutions — and both are given as whatever the
 * browser's address bar or GitHub's clone dialog produced. Every one of these is the same
 * repository, and refusing any of them would be refusing a correct answer:
 *
 *     The-Marcy-Lab-School/swe-1-4-loops
 *     https://github.com/The-Marcy-Lab-School/swe-1-4-loops
 *     https://github.com/The-Marcy-Lab-School/swe-1-4-loops/tree/main/src
 *     git@github.com:The-Marcy-Lab-School/swe-1-4-loops.git
 *
 * Pure, and deliberately in `lib/assignments/` rather than `lib/github/`: the form
 * normalizes as it is typed, the schema normalizes before it validates, and the modules
 * under `lib/github/` are all `server-only`. One implementation, so the field can show
 * exactly what will be stored.
 *
 * **What it does not do is check that the repository exists.** That needs the network and
 * belongs to `validateAssignmentDraft`, which can also say whether it is a template and
 * whether the App can see it. This answers only "is that a repository reference at all".
 */

export type RepoRef = {
  owner: string;
  repo: string;
  /** The stored form, and the only thing any column holds. */
  fullName: string;
};

/**
 * What GitHub itself accepts in an owner or repository name.
 *
 * Anchored, so a segment containing a slash, a space, or a query string is refused rather
 * than half-matched. `.git` is stripped before this sees the name — a repository really can
 * be called `something.git`, but nobody's clone URL means that.
 */
const NAME = /^[A-Za-z0-9._-]+$/;

/** Hosts a pasted URL may come from. Nothing else, because nothing else is GitHub. */
const HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * `owner/repo`, or null when this is not a reference to a GitHub repository.
 *
 * Null rather than throwing, because every caller has a message of its own to give: the
 * schema reports it against the field, and the form leaves what was typed alone so it can
 * be corrected rather than silently emptied.
 */
export function parseRepoRef(input: string): RepoRef | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // `git@github.com:owner/repo.git` is not a URL any parser accepts, so the host is
  // stripped first and what is left goes down the plain `owner/repo` path below.
  const ssh = trimmed.match(/^git@github\.com:(.+)$/);
  let candidate = ssh ? ssh[1] : trimmed;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return null;
    }
    if (!HOSTS.has(url.hostname.toLowerCase())) return null;
    // Everything after `owner/repo` is dropped: `/tree/main/src` is where the person
    // happened to be standing when they copied the address, not part of the name.
    candidate = url.pathname;
  }

  const segments = candidate.split("/").filter((segment) => segment !== "");
  if (segments.length < 2) return null;

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");

  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  // A repository cannot be named "." or "..", and admitting either would put a path
  // traversal into a column every later request interpolates into a URL.
  if (repo === "." || repo === ".." || owner === "." || owner === "..") return null;

  return { owner, repo, fullName: `${owner}/${repo}` };
}

/** The stored form of what was pasted, or null. */
export function normalizeRepoRef(input: string): string | null {
  return parseRepoRef(input)?.fullName ?? null;
}

/**
 * Passed through the parser when it is a string, and left alone otherwise.
 *
 * For `z.preprocess`, where a value that is not a string has to reach the schema unchanged
 * so the schema is what reports the type error. Returning the input on a parse failure is
 * deliberate for the same reason: `"not a repo"` must fail with a message about repository
 * references rather than as a null the schema calls a missing field.
 */
export function preprocessRepoRef(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return normalizeRepoRef(value) ?? value;
}

/**
 * The repository name a template implies, for `assignmentRepoName` to default to.
 *
 * Separate from `parseRepoRef` because the default is a suggestion an instructor edits,
 * while the parse is a requirement — and because the two would otherwise be the same
 * expression written in two places.
 */
export function repoNameFromRef(input: string): string | null {
  return parseRepoRef(input)?.repo ?? null;
}
