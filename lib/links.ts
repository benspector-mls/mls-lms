// Central place for the routes the instructor screens deep-link into, so the
// triage list and the gradebook cells agree on where a submission opens.
//
// Every one of them takes a course, because every instructor route names its course in
// the URL. That is what lets the sidebar say which cohort you are in without guessing:
// the address is the only place the current course is recorded, so a link that omitted
// it would land the reader somewhere the switcher could not describe.

export function triageHref(courseId: string): string {
  return `/instructor/courses/${courseId}/triage`
}

export function gradingQueueHref(
  courseId: string,
  assignmentId: string,
  submissionId?: string,
): string {
  const base = `/instructor/courses/${courseId}/assignments/${assignmentId}`
  return submissionId ? `${base}?submission=${submissionId}` : base
}

export function gradebookHref(courseId: string): string {
  return `/instructor/courses/${courseId}/gradebook`
}

export function courseHref(courseId: string): string {
  return `/instructor/courses/${courseId}`
}

/**
 * The same view in a different cohort, for the course switcher.
 *
 * Switching course should keep you where you were — an instructor comparing two cohorts'
 * triage wants the other cohort's triage, not to be dropped back at its front page. That
 * only holds for the views that exist in every course; an assignment belongs to exactly
 * one, so its queue and its edit form cannot carry across and land on the course instead.
 */
export function sameViewInCourse(pathname: string, courseId: string): string {
  const segments = pathname.split("/").filter(Boolean)

  // ["instructor", "courses", <id>, ...rest]
  const rest =
    segments[0] === "instructor" && segments[1] === "courses" ? segments.slice(3) : []

  if (rest[0] === "triage") return triageHref(courseId)
  if (rest[0] === "gradebook") return gradebookHref(courseId)
  return courseHref(courseId)
}
