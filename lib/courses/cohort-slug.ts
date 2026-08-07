/**
 * A course's short name, as it appears in every repository the cohort generates.
 *
 * A student's repository is `{cohortSlug}-{assignmentRepoName}-{github login}`, so the slug is
 * what makes two cohorts of the same program distinct on GitHub — `f26-swe-1-4-loops-benspector3`
 * beside `s26-swe-1-4-loops-benspector3`. Without it, a student repeating a module would want the
 * repository their previous cohort already holds.
 *
 * **Derived from the cohort term, then editable.** "Fall 2026" suggests `fall-2026`, and an
 * instructor who would rather have `f26` says so — the suggestion is there because typing a slug
 * for every cohort is a chore, and the edit is there because these names are read constantly and
 * brevity is worth something. What matters is only that it is short, unique, and legal in a
 * repository name.
 *
 * Pure, and its own module rather than part of `membership.ts`, which is `server-only`: the seed
 * script and the authoring form both need this and neither can import a server-only module.
 */

/**
 * How long a slug may be.
 *
 * GitHub allows 100 characters in a repository name, and the parts are the slug, the assignment's
 * name, and a login of up to 39. A generous slug plus a long assignment name would leave nothing
 * for the login, so this is deliberately tight — and `validateAssignmentDraft` warns when a
 * specific pairing gets close, since only it knows both halves.
 */
export const MAX_COHORT_SLUG = 24;

/** Lowercase letters, digits, and single hyphens between them. What a repository name allows. */
export const COHORT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A slug suggested by a cohort term.
 *
 * Lowercased, non-alphanumerics collapsed to single hyphens, ends trimmed. "Fall 2026" becomes
 * `fall-2026`, "Cohort 12 (evening)" becomes `cohort-12-evening`.
 *
 * Returns "" when there is nothing usable — an empty term, or one written entirely in a script
 * this cannot transliterate. The caller decides what to do about that: the form leaves the field
 * empty for a person to fill in rather than inventing something, because a slug nobody chose ends
 * up in the name of every repository a cohort creates.
 */
export function slugifyCohort(cohortTerm: string): string {
  return cohortTerm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_COHORT_SLUG)
    // A trailing hyphen can reappear after the slice, which would produce `f26--swe-1-4-loops`.
    .replace(/-+$/g, "");
}

/** Why this is not a usable slug, or null when it is. */
export function cohortSlugProblem(slug: string): string | null {
  if (slug === "") return "A cohort needs a short name for its repositories.";
  if (slug.length > MAX_COHORT_SLUG) {
    return `Keep it to ${MAX_COHORT_SLUG} characters or fewer — it prefixes every repository name.`;
  }
  if (!COHORT_SLUG_PATTERN.test(slug)) {
    return "Use lowercase letters, numbers, and single hyphens — it becomes part of a repository name.";
  }
  return null;
}

/**
 * The repository one student gets for one assignment.
 *
 * The single place this is built. It used to be written inline where repositories are generated,
 * which was fine while there was one caller and is not the property to rely on: a second caller
 * that assembled the name slightly differently would create repositories nothing could find
 * again, since a submission's own `repoFullName` is what every later lookup uses.
 */
export function studentRepoName(params: {
  cohortSlug: string;
  assignmentRepoName: string;
  githubLogin: string;
}): string {
  return `${params.cohortSlug}-${params.assignmentRepoName}-${params.githubLogin}`;
}
