// Central place for the routes the instructor screens deep-link into, so the
// triage list and the gradebook cells agree on where a submission opens.

export function gradingQueueHref(assignmentId: string, submissionId?: string): string {
  const base = `/instructor/assignments/${assignmentId}`
  return submissionId ? `${base}?submission=${submissionId}` : base
}

export function gradebookHref(courseId: string): string {
  return `/instructor/courses/${courseId}/gradebook`
}

export function courseHref(courseId: string): string {
  return `/instructor/courses/${courseId}`
}
