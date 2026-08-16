import {
  attendanceHref,
  courseAssignmentsHref,
  courseHref,
  courseResourcesHref,
  courseSettingsHref,
  editAssignmentHref,
  gradebookHref,
  gradingQueueHref,
  modulesHref,
  newAssignmentHref,
  rosterHref,
  sameViewInCourse,
  studentHref,
  triageHref,
} from "@/lib/links";

const COURSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT = "33333333-3333-4333-8333-333333333333";
const STUDENT = "44444444-4444-4444-8444-444444444444";
const SUBMISSION = "55555555-5555-4555-8555-555555555555";

describe("every instructor route names its course", () => {
  it.each([
    triageHref(COURSE),
    courseAssignmentsHref(COURSE),
    courseResourcesHref(COURSE),
    gradebookHref(COURSE),
    rosterHref(COURSE),
    modulesHref(COURSE),
    courseSettingsHref(COURSE),
    courseHref(COURSE),
    newAssignmentHref(COURSE),
    gradingQueueHref(COURSE, ASSIGNMENT),
    editAssignmentHref(COURSE, ASSIGNMENT),
    studentHref(COURSE, STUDENT),
  ])("%s", (href) => {
    // The address is the only record of which cohort you are in. A link that omitted the
    // course would land the reader somewhere the sidebar could not describe.
    expect(href).toContain(COURSE);
  });
});

describe("opening one submission", () => {
  it("is a query string on the queue, so the page is the same address", () => {
    expect(gradingQueueHref(COURSE, ASSIGNMENT, SUBMISSION)).toBe(
      `/instructor/courses/${COURSE}/assignments/${ASSIGNMENT}?submission=${SUBMISSION}`,
    );
  });

  it("is omitted when no submission is named", () => {
    expect(gradingQueueHref(COURSE, ASSIGNMENT)).not.toContain("?");
  });

  it("works the same way from a student's record", () => {
    // The queue's other axis. Both open the same review surface, so both address it the
    // same way.
    expect(studentHref(COURSE, STUDENT, SUBMISSION)).toBe(
      `/instructor/courses/${COURSE}/students/${STUDENT}?submission=${SUBMISSION}`,
    );
  });
});

/**
 * The switcher's arithmetic.
 *
 * Checked exhaustively rather than by sampling, and this is the reason: a view missing from
 * `sameViewInCourse` does not throw. It falls through to settings, so switching cohort from the
 * roster would silently land somewhere else and read as the switcher losing your place.
 */
describe("sameViewInCourse", () => {
  describe("the eight views every course has, which travel", () => {
    it.each([
      ["triage", triageHref(OTHER)],
      ["attendance", attendanceHref(OTHER)],
      ["assignments", courseAssignmentsHref(OTHER)],
      ["resources", courseResourcesHref(OTHER)],
      ["gradebook", gradebookHref(OTHER)],
      ["roster", rosterHref(OTHER)],
      ["modules", modulesHref(OTHER)],
      ["settings", courseSettingsHref(OTHER)],
    ])("%s becomes the other cohort's %s", (segment, expected) => {
      expect(sameViewInCourse(`/instructor/courses/${COURSE}/${segment}`, OTHER)).toBe(expected);
    });
  });

  /*
    Attendance's two tabs are one address, so the whole view travels. One *day* under it does not
    travel to the other cohort's day — that cohort may not have met on it — but it does not fall
    through to settings either: landing on the other cohort's attendance is what somebody switching
    from an attendance screen asked for.
  */
  it("one day under attendance travels to the other cohort's attendance, not to settings", () => {
    expect(sameViewInCourse(`/instructor/courses/${COURSE}/attendance/day/2026-08-14`, OTHER)).toBe(
      attendanceHref(OTHER),
    );
  });

  describe("the addresses that belong to one cohort and cannot travel", () => {
    it.each([
      ["one assignment's queue", `/instructor/courses/${COURSE}/assignments/${ASSIGNMENT}`],
      ["its edit form", `/instructor/courses/${COURSE}/assignments/${ASSIGNMENT}/edit`],
      ["the new-assignment form", `/instructor/courses/${COURSE}/assignments/new`],
      ["a student's record", `/instructor/courses/${COURSE}/students/${STUDENT}`],
      ["the bare course address", `/instructor/courses/${COURSE}`],
    ])("%s lands on settings", (_label, pathname) => {
      expect(sameViewInCourse(pathname, OTHER)).toBe(courseSettingsHref(OTHER));
    });
  });

  it("tells the assignments list apart from one assignment", () => {
    // `assignments` is the one segment that means two things: on its own it is the list,
    // which every course has; followed by an id it is one assignment, which does not.
    expect(sameViewInCourse(`/instructor/courses/${COURSE}/assignments`, OTHER)).toBe(
      courseAssignmentsHref(OTHER),
    );
    expect(sameViewInCourse(`/instructor/courses/${COURSE}/assignments/${ASSIGNMENT}`, OTHER)).toBe(
      courseSettingsHref(OTHER),
    );
  });

  it("lands on settings from an address that names no course at all", () => {
    // `/courses` and `/admin` are outside the cohort entirely. There is no view to keep.
    expect(sameViewInCourse("/courses", OTHER)).toBe(courseSettingsHref(OTHER));
    expect(sameViewInCourse("/admin", OTHER)).toBe(courseSettingsHref(OTHER));
  });

  it("tolerates a trailing slash", () => {
    expect(sameViewInCourse(`/instructor/courses/${COURSE}/roster/`, OTHER)).toBe(
      rosterHref(OTHER),
    );
  });
});
