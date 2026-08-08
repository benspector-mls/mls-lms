import { redirect } from "next/navigation";

/**
 * Keeps the course in the address honest on the routes that also name an assignment.
 *
 * `/instructor/courses/<a>/assignments/<x>` carries the course twice over: once as a
 * segment, and once through the assignment, which knows its own. Nothing stops the two
 * disagreeing — a hand-typed or stale URL is enough — and the mismatch is quiet in a bad
 * way. Access is unaffected, because every procedure checks the assignment's own course
 * rather than the segment; what breaks is everything that reads the segment. The sidebar
 * would name the wrong cohort, and the edit form would offer the wrong course's modules.
 *
 * Redirecting rather than refusing, because there is an obviously correct address and the
 * reader was asking for a real assignment. The canonical URL is the one where both agree.
 */
export function requireCourseMatch(params: {
  urlCourseId: string;
  assignmentCourseId: string;
  canonical: string;
}): void {
  if (params.urlCourseId !== params.assignmentCourseId) redirect(params.canonical);
}
