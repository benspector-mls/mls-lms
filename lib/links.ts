// Central place for the routes the instructor screens deep-link into, so the
// triage list and the gradebook cells agree on where a submission opens.
//
// Every one of them takes a course, because every instructor route names its course in
// the URL. That is what lets the sidebar say which cohort you are in without guessing:
// the address is the only place the current course is recorded, so a link that omitted
// it would land the reader somewhere the switcher could not describe.
//
// The eight course-scoped views are the eight sidebar items, and they are listed here in
// the order the sidebar offers them. `sameViewInCourse` at the foot is what makes switching
// cohort keep the view, and it has to know all eight — a view missing from it silently
// falls back to the course address, which is a redirect, so the reader would land
// somewhere they did not ask for and the switcher would look broken for that screen
// alone.

export function triageHref(courseId: string): string {
  return `/instructor/courses/${courseId}/triage`;
}

/** Attendance: today's check-in on one tab, the whole term on the other. */
export function attendanceHref(courseId: string): string {
  return `/instructor/courses/${courseId}/attendance`;
}

/**
 * One earlier session, for correcting it.
 *
 * A drill-down rather than a third tab: it is reached by naming a day, from the grid's column
 * headings or the list beneath them, and a tab for "some day you have not chosen yet" would have
 * nothing to show until you had.
 *
 * `day/` stands in the path rather than the date sitting directly under `attendance/`, so that a
 * later sibling segment can never be mistaken for a date and a date can never shadow one.
 */
export function attendanceDayHref(courseId: string, day: string): string {
  return `/instructor/courses/${courseId}/attendance/day/${day}`;
}

/**
 * The projected code, on its own address and outside the shell.
 *
 * Its own window is the point: it goes on a second monitor, or it is the one window shared into
 * Zoom — and neither works if the page carries a sidebar naming every other cohort.
 */
export function attendancePresentHref(courseId: string): string {
  return `/present/attendance/${courseId}`;
}

/** A fellow's own attendance in one cohort. */
export function myAttendanceHref(courseId: string): string {
  return `/courses/${courseId}/attendance`;
}

/** The assignments list, which is not the same address as one assignment's grading queue. */
export function courseAssignmentsHref(courseId: string): string {
  return `/instructor/courses/${courseId}/assignments`;
}

export function gradingQueueHref(
  courseId: string,
  assignmentId: string,
  submissionId?: string,
): string {
  const base = `/instructor/courses/${courseId}/assignments/${assignmentId}`;
  return submissionId ? `${base}?submission=${submissionId}` : base;
}

export function newAssignmentHref(courseId: string): string {
  return `/instructor/courses/${courseId}/assignments/new`;
}

export function editAssignmentHref(courseId: string, assignmentId: string): string {
  return `/instructor/courses/${courseId}/assignments/${assignmentId}/edit`;
}

/**
 * Everything in the cohort that is not work: readings, notes, and videos.
 *
 * Beside the assignments list rather than under it, because the two are authored the same way
 * and read in the same place — a module's accordion shows its assignments and then its
 * resources — and a reader looking for "the things I put in this course" should not have to
 * know which of them happen to be graded.
 */
export function courseResourcesHref(courseId: string): string {
  return `/instructor/courses/${courseId}/resources`;
}

export function gradebookHref(courseId: string): string {
  return `/instructor/courses/${courseId}/gradebook`;
}

export function rosterHref(courseId: string): string {
  return `/instructor/courses/${courseId}/roster`;
}

export function modulesHref(courseId: string): string {
  return `/instructor/courses/${courseId}/modules`;
}

/**
 * The cohort's own settings: what it is called, how it is retired, and who else teaches it.
 *
 * Also where the bare course address lands. Once every tab became a sidebar item there was
 * nothing left on the course page to render, and this is the screen a reader who asked for
 * "the course" and nothing more actually wants — the facts about the cohort itself rather
 * than any one list inside it.
 */
export function courseSettingsHref(courseId: string): string {
  return `/instructor/courses/${courseId}/settings`;
}

/**
 * One student's record within one cohort.
 *
 * The course is in it because a student's work only means anything inside one — the same student
 * repeating a module has two sets of submissions, and a page that named only the student would
 * have to pick one and be wrong half the time.
 */
export function studentHref(courseId: string, studentId: string, submissionId?: string): string {
  const base = `/instructor/courses/${courseId}/students/${studentId}`;
  return submissionId ? `${base}?submission=${submissionId}` : base;
}

/**
 * The course itself, which is a redirect to its settings rather than a screen.
 *
 * Kept as its own function because it is still a meaningful address — the thing a link
 * means when it names a cohort and nothing more — and because callers that had it should
 * not have to know where it currently resolves to.
 */
export function courseHref(courseId: string): string {
  return `/instructor/courses/${courseId}`;
}

/**
 * The same view in a different cohort, for the course switcher.
 *
 * Switching course should keep you where you were — an instructor comparing two cohorts'
 * triage wants the other cohort's triage, not to be dropped back at its front page. That
 * only holds for the views that exist in every course; an assignment belongs to exactly
 * one, so its queue and its edit form cannot carry across and land on the course instead.
 *
 * `assignments` is the one segment that means two things. On its own it is the list, which
 * every course has and which carries across; followed by an id or by `new` it is one
 * assignment, which does not.
 *
 * `attendance` is the other. Its two tabs are one address, which carries; one *day* is not,
 * because the other cohort may not have met that day — and landing on an empty screen offering to
 * record a morning that never happened is worse than landing on today.
 */
export function sameViewInCourse(pathname: string, courseId: string): string {
  const segments = pathname.split("/").filter(Boolean);

  // ["instructor", "courses", <id>, ...rest]
  const rest = segments[0] === "instructor" && segments[1] === "courses" ? segments.slice(3) : [];

  if (rest[0] === "triage") return triageHref(courseId);
  if (rest[0] === "attendance") return attendanceHref(courseId);
  if (rest[0] === "assignments" && rest.length === 1) return courseAssignmentsHref(courseId);
  if (rest[0] === "resources") return courseResourcesHref(courseId);
  if (rest[0] === "gradebook") return gradebookHref(courseId);
  if (rest[0] === "roster") return rosterHref(courseId);
  if (rest[0] === "modules") return modulesHref(courseId);
  if (rest[0] === "settings") return courseSettingsHref(courseId);

  /*
    Everything else — one assignment's queue, its edit form, a student's record — belongs to
    a cohort and cannot travel. Settings rather than the bare course address, which would only
    redirect here anyway.
  */
  return courseSettingsHref(courseId);
}
