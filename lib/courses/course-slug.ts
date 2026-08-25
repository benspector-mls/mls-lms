/**
 * A course's short name, as it appears in every repository the course generates.
 *
 * A student's repository is `{courseSlug}-{assignmentRepoName}-{github login}`, so the slug is
 * what makes two matriculations distinct on GitHub — `swe-f26-swe-1-4-loops-benspector3` beside
 * `swe-s27-swe-1-4-loops-benspector3`. Without it, a student repeating a module would want the
 * repository their previous matriculation already holds.
 *
 * **It names the course and the term, not the term alone.** A term on its own is not unique: a
 * school running three programs starts all of them in the fall, so `fall-2026` is the short name
 * of whichever one was created first and a refusal for the other two. Both halves are in the
 * suggestion — "Data Science" starting "Fall 2026" suggests `data-science-f26`, "Software
 * Engineering Fellowship" suggests `sef-f26`, and an instructor who would rather have `swe-f26`
 * says so.
 *
 * **Uniqueness is the database's, not the suggestion's.** `slug` is unique across every
 * course, archived ones included, because their repositories still exist. What naming both halves
 * buys is that collisions become rare rather than routine — two courses of the same program in
 * the same term still collide, and are told so in words rather than by a constraint error.
 *
 * Suggested and then editable, because typing a slug for every course is a chore, and because
 * these names are read constantly and brevity is worth something. What matters is only that it is
 * short, unique, and legal in a repository name.
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
export const MAX_COURSE_SLUG = 24;

/** Lowercase letters, digits, and single hyphens between them. What a repository name allows. */
export const COURSE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * How long a team's slug may be.
 *
 * Shorter than a course's, and cheaper than the 39 characters `MAX_COURSE_SLUG` reserves for a
 * login: a team's name is chosen by an instructor and is `Team 3` rather than a GitHub handle. So
 * any course and assignment pairing that fits an individual repository name fits a team's, and
 * `validateAssignmentDraft` needs no second length rule.
 */
export const MAX_TEAM_SLUG = 16;

/**
 * Any piece of text as a slug: lowercased, non-alphanumerics collapsed to single hyphens, ends
 * trimmed, cut to `max` characters. "Fall 2026" becomes `fall-2026`, "Cohort 12 (evening)"
 * becomes `cohort-12-evening`.
 *
 * Returns "" when there is nothing usable — empty text, or text written entirely in a script this
 * cannot transliterate. The caller decides what to do about that: the form leaves the field empty
 * for a person to fill in rather than inventing something, because a slug nobody chose ends up in
 * the name of every repository a course creates.
 *
 * One transformation with the length passed in, rather than one function per length. The two
 * callers below cut to different maximums and must agree on everything else — a second regex
 * would be a second answer to "what is legal in a repository name", and the day they drift is the
 * day two slugs of the same text stop matching.
 */
export function slugify(text: string, max: number): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      // A trailing hyphen can reappear after the slice, which would produce `f26--swe-1-4-loops`.
      .replace(/-+$/g, "")
  );
}

/**
 * A matriculation, or a course name, as a slug.
 *
 * This is the raw transformation. `suggestCourseSlug` below is what a new course actually gets,
 * and it is the one to call unless you specifically want a slug of one string.
 */
export function slugifyCourse(matriculation: string): string {
  return slugify(matriculation, MAX_COURSE_SLUG);
}

/**
 * A team's name as the slug that goes in its repository name.
 *
 * "Team 3" becomes `team-3`, so the repository reads `swe-f26-swe-3-2-project-team-3`. Named
 * after the team rather than after anybody's login, because the repository belongs to the team:
 * every member pushes to it, and a name carrying one member's handle would say otherwise.
 */
export function teamSlug(name: string): string {
  return slugify(name, MAX_TEAM_SLUG);
}

/** Season words, shortest form that keeps them apart — `s` alone would not separate two of them. */
const SEASONS: [RegExp, string][] = [
  [/\bspring\b/, "sp"],
  [/\bsummer\b/, "su"],
  [/\bfall\b|\bautumn\b/, "f"],
  [/\bwinter\b/, "w"],
];

/**
 * The longest a compacted term can be: two letters of season and two digits of year.
 *
 * The course half is measured against this rather than against the term in hand, so that one
 * program's short name is the same shape in every season. Measured against the actual term, a
 * fellowship would be `software-engineering-f26` in the autumn and `software-sp27` in the spring
 * — one character of season costing a word of the course name — and two cohorts of the same
 * program would stop looking related, which is the whole thing a slug is for.
 */
const MAX_COMPACT_TERM = 4;

/**
 * A term as a few characters: "Fall 2026" becomes `f26`, "Spring 2027" becomes `sp27`.
 *
 * Null unless a season **and** a year are both there, because that is the shape where the short
 * form is still legible — `f26` is obvious and `c12e` is not. The caller keeps the full slug for
 * anything else, and makes room for it by shortening the course name instead.
 */
function compactTerm(matriculation: string): string | null {
  const lower = matriculation.toLowerCase();

  const season = SEASONS.find(([pattern]) => pattern.test(lower))?.[1];
  if (!season) return null;

  // A four-digit year first, so "2026" gives 26 rather than 20. Two digits are accepted on their
  // own for the people who write "Fall '26".
  const year = lower.match(/\b(\d{4})\b/)?.[1].slice(-2) ?? lower.match(/\b(\d{2})\b/)?.[1];
  if (!year) return null;

  return `${season}${year}`;
}

/**
 * The short name a new course is offered: the course, then the term.
 *
 * "Data Science" starting "Fall 2026" suggests `data-science-f26`; "Software Engineering
 * Fellowship" suggests `sef-f26`, which an instructor will probably edit to `swe-f26`. Both
 * halves are there because neither is unique on its own — every program a school runs starts in
 * the fall, so a term-only slug is the short name of whichever course was created first and a
 * refusal for the rest.
 *
 * **The course name is either whole or its initials, never half of itself.** `software-engineeri`
 * is a name nobody would have chosen, and this is a suggestion people will accept without reading
 * closely; `sef` is visibly an abbreviation, so somebody who wants `swe` can see there was a
 * decision to make. The term is what survives intact, because it is the half that tells two
 * matriculations of the same program apart.
 */
export function suggestCourseSlug(params: { courseName: string; matriculation: string }): string {
  const compact = compactTerm(params.matriculation);
  const term = compact ?? slugifyCourse(params.matriculation);
  const course = slugifyCourse(params.courseName);

  // Either half missing is a form half filled in, and half a suggestion is better than none.
  if (course === "") return term;
  if (term === "") return course;

  const budget = MAX_COURSE_SLUG - 1 - (compact === null ? term.length : MAX_COMPACT_TERM);
  if (course.length <= budget) return `${course}-${term}`;

  const initials = course
    .split("-")
    .map((word) => word[0])
    .join("");

  return slugifyCourse(`${initials}-${term}`);
}

/** Why this is not a usable slug, or null when it is. */
export function courseSlugProblem(slug: string): string | null {
  if (slug === "") return "A course needs a short name for its repositories.";
  if (slug.length > MAX_COURSE_SLUG) {
    return `Keep it to ${MAX_COURSE_SLUG} characters or fewer — it prefixes every repository name.`;
  }
  if (!COURSE_SLUG_PATTERN.test(slug)) {
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
  courseSlug: string;
  assignmentRepoName: string;
  githubLogin: string;
}): string {
  return `${params.courseSlug}-${params.assignmentRepoName}-${params.githubLogin}`;
}

/**
 * The repository one team gets for one assignment.
 *
 * `{courseSlug}-{assignmentRepoName}-{team slug}`, which is the same shape as a student's with
 * the team's name where the login goes. **Named after the team rather than after whoever created
 * it**, because the repository belongs to the team: every member is a collaborator and pushes to
 * it, and a name carrying one member's handle would say otherwise for the rest of the term.
 *
 * The slug is shorter than a login can be, so any course and assignment pairing that fits
 * `studentRepoName` fits this — see `MAX_TEAM_SLUG`.
 *
 * Team names are unique within a set but not within a course, so two sets can each hold a "Team
 * 1" and the set is not in the name. The accept path reads `repoFullName` before it creates
 * anything and refuses a collision in words, which is the same guard it already applies to one
 * student holding one repository across two matriculations.
 */
export function teamRepoName(params: {
  courseSlug: string;
  assignmentRepoName: string;
  teamName: string;
}): string {
  return `${params.courseSlug}-${params.assignmentRepoName}-${teamSlug(params.teamName)}`;
}
