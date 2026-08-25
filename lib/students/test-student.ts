/**
 * A test student: the identity an admin looks through to meet a course the way a student does.
 *
 * The problem it solves is that a published course cannot be checked from the outside. The Modules
 * screen shows a course's shape, and deliberately has nothing to press, so an assignment whose
 * instructions make no sense or whose kind hands out the wrong thing is discovered by the first
 * real student to reach it. A test student is a student-shaped identity that can press the buttons:
 * its submissions are ordinary rows and its repositories are ordinary repositories, which is the
 * only arrangement in which a preview catches anything.
 *
 * **The number is unique across the deployment, not per course.** A `Profile` has no course —
 * identity here is a Supabase auth user, and what puts a profile in a course is an `Enrollment` —
 * so `Test Student 3` is one identity that may be enrolled in several courses. It could not be
 * otherwise: `Profile.githubUsername` is unique, and the handle is derived from the number, so two
 * courses each holding their own "Test Student 1" would be two profiles wanting one handle.
 *
 * Reusing one across courses is safe. A repository is `{course slug}-{assignmentRepoName}-{login}`,
 * so the same test student in two cohorts gets two repositories — the property
 * `scripts/verify-enrollment.ts` already proves for a real student repeating a module.
 *
 * Pure, and its own module rather than part of the router that creates one, for the reason
 * `course-slug.ts` is its own module: the check script and the seed both need these strings and
 * neither can import a `server-only` module.
 */

/** `Test Student 3` — the display name, and what the roster and gradebook show. */
export function testStudentName(n: number): string {
  return `Test Student ${n}`;
}

/**
 * `test-student-3` — the GitHub handle recorded on the profile, and therefore the suffix of every
 * repository it accepts.
 *
 * No GitHub account by this name exists, and the handle is still recorded rather than left null,
 * because a null one changes what the preview shows: `studentRepoName` has nothing to build a
 * repository name from, and the student's own course screens grow a "Your GitHub account is not
 * linked" banner that a real student would not see. A preview that differs from the thing it
 * previews is worth less than the tidiness of an empty column.
 *
 * What it costs is that a real GitHub account holding this handle could not later be recorded on
 * another profile — the unique constraint would refuse it, and the identity trigger drops the
 * handle rather than failing that person's signup. Accepting therefore never sends this to GitHub:
 * see the test-student branch in `lib/assignments/accept.ts`.
 */
export function testStudentHandle(n: number): string {
  return `test-student-${n}`;
}

/**
 * `test-student-3@test.invalid` — the address on the Supabase auth user.
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered or delivered to, so nobody can
 * receive a sign-in link for one of these. That matters because it is the second half of the lock:
 * the account is created with no password, so the only way into it is an admin switching view,
 * and the only other way in — a magic link — needs a mailbox that cannot exist.
 *
 * It is also the interlock on creating one. The column is unique, so two admins who both compute
 * the same next number do not both get it: the second is refused by Supabase and retries.
 */
export function testStudentEmail(n: number): string {
  return `test-student-${n}@test.invalid`;
}

/**
 * Whether a profile is a test student, given the column.
 *
 * A function over `testStudentNumber !== null` so that call sites read as the question they are
 * asking, and so the one place that knows how the fact is stored is this module.
 */
export function isTestStudent(profile: { testStudentNumber: number | null }): boolean {
  return profile.testStudentNumber !== null;
}
