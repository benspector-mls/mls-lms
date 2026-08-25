import "server-only";

import { getQueryClient, trpc } from "@/trpc/server";

import { ALL_STUDENTS } from "./cohorts";

/**
 * Which cohort a screen should be built for, and the list its picker draws.
 *
 * Called by every screen that carries the picker, so the precedence rule exists once. It is:
 * **the query string, then the instructor's remembered cohort, then all fellows.**
 *
 * The URL winning is what makes a filtered screen linkable — a colleague's link, a bookmark, and
 * the picker's own writes all land the same way. The remembered cohort filling in when the URL is
 * silent is what makes the feature worth having: an instructor who grades the same fifteen every
 * week would otherwise pick them again on four screens every sitting.
 *
 * **It takes a program rather than a course**, which is the change that removed the duplication: a
 * cohort divides the program's roster, so an instructor's choice is one value across every course
 * they teach in it rather than one per course.
 *
 * `ALL_STUDENTS` last rather than as an error case, because it is the behaviour that existed before
 * cohorts: a program with none, an admin with nowhere to remember a selection, and a cleared filter
 * all mean the same thing.
 *
 * Resolved before the screen's own read rather than beside it, since that read takes the answer as
 * an argument. One extra query per page load against a table of a handful of rows.
 */
export async function resolveCohort(programId: string, requested: string | undefined) {
  const queryClient = getQueryClient();
  const cohorts = await queryClient.fetchQuery(
    trpc.cohorts.listForProgram.queryOptions({ programId }),
  );

  return {
    ...cohorts,
    /**
     * The program the cohorts belong to, carried so the picker can record a choice against it.
     *
     * Returned rather than left to the caller because half of the callers are course screens that
     * had to resolve it to get here — see `resolveCohortForCourse` — and passing it back down is
     * what spares each of them fetching the course a second time to hand it to the picker.
     */
    programId,
    /** The value to pass to the screen's own procedure, and to render the picker with. */
    cohort: requested ?? cohorts.cohortId ?? ALL_STUDENTS,
  };
}

/**
 * The same answer, for a screen whose address names a course rather than a program.
 *
 * Triage, the gradebook, an assignment's grading queue and the curriculum list all carry the cohort
 * picker and all live under `/instructor/courses/[courseId]`, so none of them holds the identifier
 * `resolveCohort` needs. Resolving it here rather than in each of them is what keeps the precedence
 * rule in one place: a screen that fetched its own program would be a second place where "which
 * cohort" could be decided differently.
 *
 * **The extra read is free.** `getQueryClient` is request-scoped, so `courses.get` resolves against
 * the same cache the page's own fetch of it uses — the four callers all read the course anyway, for
 * a heading, and the second call returns what the first already fetched.
 */
export async function resolveCohortForCourse(courseId: string, requested: string | undefined) {
  const queryClient = getQueryClient();
  const course = await queryClient.fetchQuery(trpc.courses.get.queryOptions({ courseId }));
  return resolveCohort(course.program.id, requested);
}
