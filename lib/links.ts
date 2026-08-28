// Central place for the routes the instructor screens deep-link into, so the triage list and the
// gradebook cells agree on where a submission opens.
//
// **There are two scopes now, and each address names exactly one of them.** A program address names
// a program — its attendance, its roster, its settings. A course address names one course of
// one program — its triage, gradebook, curriculum, team sets, settings.
// The program is never in a course address: it is resolved from the course, because carrying both
// would give every link two ids that could disagree and nothing to reconcile them with.
//
// Every one of them takes an id, because every instructor route names its scope in the URL. That is
// what lets the sidebar say where you are without guessing: the address is the only place the
// current program and course are recorded, so a link that omitted one would land the reader
// somewhere the switcher could not describe.
//
// The two groups of views are the two sidebar groups, and they are listed here in the order the
// sidebar offers them. `sameViewInCourse` and `sameViewInProgram` at the foot are what make
// switching keep the view, and each has to know all of its own group — a view missing from one
// silently falls back to settings, so the reader would land somewhere they did not ask for and the
// switcher would look broken for that screen alone.

// ---------------------------------------------------------------------------------------------
// The program's three views
//
// Three rather than five, because two of them turned out to be sections of the others. Placing
// fellows in cohorts is a thing done *to* the roster, and it now shares that screen's tabs; who
// instructs the program is a fact about the program, and it sits on its settings. Both
// had their own address while the question was whether they were separate screens, and running them
// answered it — a sidebar item apiece was five doors onto three rooms.
// ---------------------------------------------------------------------------------------------

/** Every program the caller belongs to. The way out of all of them. */
export function programsHref(): string {
  return "/programs";
}

/**
 * Attendance: today's check-in on one tab, the whole term on the other.
 *
 * **The program's, not a course's.** A fellow arrives at the building once, so there is one morning
 * to open and one code to type however many courses they are taking.
 */
export function attendanceHref(programId: string): string {
  return `/instructor/programs/${programId}/attendance`;
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
export function attendanceDayHref(programId: string, day: string): string {
  return `/instructor/programs/${programId}/attendance/day/${day}`;
}

/**
 * The projected code, on its own address and outside the shell.
 *
 * Its own window is the point: it goes on a second monitor, or it is the one window shared into
 * Zoom — and neither works if the page carries a sidebar naming every other program.
 */
export function attendancePresentHref(programId: string): string {
  return `/present/attendance/${programId}`;
}

/** A fellow's own attendance record for one program. */
export function myAttendanceHref(programId: string): string {
  return `/programs/${programId}/attendance`;
}

/**
 * The roster: everybody who has ever joined this program, and the link that lets them.
 *
 * **The program's, and this is the duplication it removed.** One roster where there used to be one
 * per course, entered once instead of once per course of a term.
 */
export function rosterHref(programId: string): string {
  return `/instructor/programs/${programId}/roster`;
}

/** The program's own settings: what it is, its courses, who instructs it, and how it ends. */
export function programSettingsHref(programId: string): string {
  return `/instructor/programs/${programId}/settings`;
}

/**
 * One fellow, across the whole program.
 *
 * **About the person rather than about their work**, which is what makes it a different screen from
 * `studentHref` below: who they are, their attendance and arrival averages, which cohort they are
 * in, their GCF history, and a row per course linking into the record of what they did in it. It is
 * what the roster's rows point at.
 */
export function programStudentHref(programId: string, studentId: string): string {
  return `/instructor/programs/${programId}/students/${studentId}`;
}

/**
 * A fellow's own General Coding Framework results.
 *
 * **The one address here that names no scope at all**, and deliberately: the GCF is sat at
 * CodeSignal on a fellow's own schedule, a result carries no program, and somebody who repeats
 * a program should find one history rather than two halves of it. Scoping it would mean choosing
 * which of their enrollments a sitting belonged to, and there is no honest answer.
 *
 * A function taking nothing rather than a bare string, so it is reached the same way as every other
 * address here and moving it is one edit.
 */
export function gcfHref(): string {
  return "/gcf";
}

// ---------------------------------------------------------------------------------------------
// The course's five views
// ---------------------------------------------------------------------------------------------

export function triageHref(courseId: string): string {
  return `/instructor/courses/${courseId}/triage`;
}

/**
 * The whole of the course's curriculum: its modules, projects, and assessments, and the assignments
 * and resources inside each.
 *
 * One address where there were three. Modules, Coursework, and Resources were separate screens
 * because a project used to be a different kind of row from a module; all three are course units
 * now, so there is one place to see what is in a course.
 */
export function curriculumHref(courseId: string): string {
  return `/instructor/courses/${courseId}/curriculum`;
}

export function gradingQueueHref(
  courseId: string,
  assignmentId: string,
  submissionId?: string,
): string {
  const base = `/instructor/courses/${courseId}/curriculum/${assignmentId}`;
  return submissionId ? `${base}?submission=${submissionId}` : base;
}

export function newAssignmentHref(courseId: string, courseUnitId?: string): string {
  const base = `/instructor/courses/${courseId}/curriculum/new`;
  /*
    Carried in the query rather than the path, because it is a starting value for a field on the
    form rather than a different form. Opened from inside a unit on the Curriculum screen the form
    arrives with that unit chosen and its heading naming it — which is the whole reason that screen
    puts the button inside the unit — and the field stays changeable, so this answers the question
    rather than settling it.

    Not to be trusted on arrival: `startingUnitId` ignores an id that is not one of the course's
    units, because the select has no label for one and would render a raw uuid.
  */
  return courseUnitId ? `${base}?unit=${courseUnitId}` : base;
}

export function editAssignmentHref(courseId: string, assignmentId: string): string {
  return `/instructor/courses/${courseId}/curriculum/${assignmentId}/edit`;
}

export function gradebookHref(courseId: string): string {
  return `/instructor/courses/${courseId}/gradebook`;
}

/**
 * The team sets of one course: the divisions of the program's fellows that hand work in together.
 *
 * Its own screen rather than a card on the roster it used to share, because the roster moved up to
 * the program and a team set did not — a set divides a program's fellows for one course's
 * projects, so it belongs beside that course's curriculum.
 */
export function teamsHref(courseId: string): string {
  return `/instructor/courses/${courseId}/teams`;
}

/**
 * The course's own settings: what it is called, how its repositories are named, whether fellows can
 * see it, and how it is retired.
 *
 * The last of the five and the least often opened: these are read in the week a course is set up
 * and rarely again, which is why naming a course and nothing more lands on its triage instead.
 */
export function courseSettingsHref(courseId: string): string {
  return `/instructor/courses/${courseId}/settings`;
}

/**
 * One fellow's work in one course.
 *
 * The course is in it because work only means anything inside one — a fellow who repeats a program
 * has two sets of submissions, and a page that named only the person would have to pick one and be
 * wrong half the time. `programStudentHref` above is the screen about the person rather than the
 * work, and it links here once per course.
 */
export function studentHref(courseId: string, studentId: string, submissionId?: string): string {
  const base = `/instructor/courses/${courseId}/students/${studentId}`;
  return submissionId ? `${base}?submission=${submissionId}` : base;
}

/**
 * The course itself, which is a redirect to its triage rather than a screen.
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
 * Switching course should keep you where you were — an instructor comparing two courses'
 * triage wants the other cohort's triage, not to be dropped back at its front page. That
 * only holds for the views that exist in every course; an assignment belongs to exactly
 * one, so its queue and its edit form cannot carry across and land on the course instead.
 *
 * `curriculum` is the one segment that means two things. On its own it is the whole course,
 * which every cohort has and which carries across; followed by an id or by `new` it is one
 * assignment, which does not.
 *
 * `attendance` is the other. Its two tabs are one address, which carries; one *day* is not,
 * because the other cohort may not have met that day — and landing on an empty screen offering to
 * record a morning that never happened is worse than landing on today.
 *
 * **Everything that cannot carry lands on triage**, which is also where a course name clicked from
 * outside any course goes. Triage leads the sidebar and answers the question an instructor opens
 * this application to ask; settings, which this used to fall through to, answers a question asked
 * in the week a course is set up and almost never after.
 */
export function sameViewInCourse(pathname: string, courseId: string): string {
  const segments = pathname.split("/").filter(Boolean);

  // ["instructor", "courses", <id>, ...rest]
  const rest = segments[0] === "instructor" && segments[1] === "courses" ? segments.slice(3) : [];

  if (rest[0] === "triage") return triageHref(courseId);
  if (rest[0] === "curriculum" && rest.length === 1) return curriculumHref(courseId);
  if (rest[0] === "gradebook") return gradebookHref(courseId);
  if (rest[0] === "teams") return teamsHref(courseId);
  if (rest[0] === "settings") return courseSettingsHref(courseId);

  /*
    Everything else — one assignment's queue, its edit form, a fellow's record in this course —
    belongs to one course and cannot travel. So does every address outside a course altogether: a
    program's roster, `/programs`, the dashboard. Triage rather than the bare course address, which
    would only redirect here anyway.
  */
  return triageHref(courseId);
}

/**
 * The same view in a different program, for the program switcher.
 *
 * The counterpart of `sameViewInCourse`, and it exists for the same reason: somebody comparing two
 * years' attendance wants the other year's attendance rather than to be dropped at its front page.
 *
 * **One day of attendance does not travel**, which is the one case worth naming. The other
 * program may not have met that day, and landing on an empty screen offering to record a
 * morning that never happened is worse than landing on today.
 *
 * A fellow's record does not travel either: a person is on one roster or another, and a page naming
 * somebody who is not on this one would refuse rather than render.
 */
export function sameViewInProgram(pathname: string, programId: string): string {
  const segments = pathname.split("/").filter(Boolean);

  // ["instructor", "programs", <id>, ...rest]
  const rest = segments[0] === "instructor" && segments[1] === "programs" ? segments.slice(3) : [];

  if (rest[0] === "attendance" && rest.length === 1) return attendanceHref(programId);
  if (rest[0] === "roster") return rosterHref(programId);
  if (rest[0] === "settings") return programSettingsHref(programId);

  return programSettingsHref(programId);
}
