import {
  attendanceHref,
  courseHref,
  courseSettingsHref,
  curriculumHref,
  editAssignmentHref,
  gradebookHref,
  gradingQueueHref,
  newAssignmentHref,
  programSettingsHref,
  programsHref,
  programStudentHref,
  rosterHref,
  sameViewInCourse,
  sameViewInProgram,
  studentHref,
  teamsHref,
  triageHref,
} from "@/lib/links";

const COURSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROGRAM = "77777777-7777-4777-8777-777777777777";
const OTHER_PROGRAM = "88888888-8888-4888-8888-888888888888";
const ASSIGNMENT = "33333333-3333-4333-8333-333333333333";
const STUDENT = "44444444-4444-4444-8444-444444444444";
const SUBMISSION = "55555555-5555-4555-8555-555555555555";
const UNIT = "66666666-6666-4666-8666-666666666666";

describe("every course route names its course", () => {
  it.each([
    triageHref(COURSE),
    curriculumHref(COURSE),
    gradebookHref(COURSE),
    teamsHref(COURSE),
    courseSettingsHref(COURSE),
    courseHref(COURSE),
    newAssignmentHref(COURSE),
    newAssignmentHref(COURSE, UNIT),
    gradingQueueHref(COURSE, ASSIGNMENT),
    editAssignmentHref(COURSE, ASSIGNMENT),
    studentHref(COURSE, STUDENT),
  ])("%s", (href) => {
    // The address is the only record of which course you are in. A link that omitted it would
    // land the reader somewhere the sidebar could not describe.
    expect(href).toContain(COURSE);
  });
});

/**
 * The program's own views, and the rule that keeps the two scopes apart.
 *
 * **A course address never carries a program id**, which is what stops any link holding two ids
 * that could disagree: the program is resolved from the course. So the check runs in both
 * directions — every program address names its program, and no course address does.
 */
describe("every program route names its program, and no course route does", () => {
  it.each([
    attendanceHref(PROGRAM),
    rosterHref(PROGRAM),
    programSettingsHref(PROGRAM),
    programStudentHref(PROGRAM, STUDENT),
  ])("%s names the program", (href) => {
    expect(href).toContain(PROGRAM);
  });

  it.each([
    triageHref(COURSE),
    curriculumHref(COURSE),
    gradebookHref(COURSE),
    teamsHref(COURSE),
    courseSettingsHref(COURSE),
    studentHref(COURSE, STUDENT),
  ])("%s names no program", (href) => {
    expect(href).not.toContain(PROGRAM);
  });
});

describe("opening one submission", () => {
  it("is a query string on the queue, so the page is the same address", () => {
    expect(gradingQueueHref(COURSE, ASSIGNMENT, SUBMISSION)).toBe(
      `/instructor/courses/${COURSE}/curriculum/${ASSIGNMENT}?submission=${SUBMISSION}`,
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
 * `sameViewInCourse` does not throw. It falls through to triage, so switching cohort from the
 * roster would silently land somewhere else and read as the switcher losing your place.
 */
describe("sameViewInCourse", () => {
  describe("the views every course has, which travel", () => {
    it.each([
      ["triage", triageHref(OTHER)],
      ["curriculum", curriculumHref(OTHER)],
      ["gradebook", gradebookHref(OTHER)],
      ["teams", teamsHref(OTHER)],
      ["settings", courseSettingsHref(OTHER)],
    ])("%s becomes the other course's %s", (segment, expected) => {
      expect(sameViewInCourse(`/instructor/courses/${COURSE}/${segment}`, OTHER)).toBe(expected);
    });
  });

  /*
    Attendance and the roster are the program's views now, so they are not segments this function
    ever sees. Checked rather than assumed: if either came back as a course view, a switcher would
    be building a course address for a screen that does not exist at one.
  */
  it.each(["attendance", "roster"])(
    "does not recognise %s, which belongs to the program",
    (segment) => {
      expect(sameViewInCourse(`/instructor/courses/${COURSE}/${segment}`, OTHER)).toBe(
        triageHref(OTHER),
      );
    },
  );

  describe("the addresses that belong to one course and cannot travel", () => {
    it.each([
      ["one assignment's queue", `/instructor/courses/${COURSE}/curriculum/${ASSIGNMENT}`],
      ["its edit form", `/instructor/courses/${COURSE}/curriculum/${ASSIGNMENT}/edit`],
      ["the new-assignment form", `/instructor/courses/${COURSE}/curriculum/new`],
      ["a student's record", `/instructor/courses/${COURSE}/students/${STUDENT}`],
      ["the bare course address", `/instructor/courses/${COURSE}`],
    ])("%s lands on triage", (_label, pathname) => {
      expect(sameViewInCourse(pathname, OTHER)).toBe(triageHref(OTHER));
    });
  });

  it("tells the curriculum apart from one piece of work inside it", () => {
    // `curriculum` is the one segment that means two things: on its own it is the whole course,
    // which every cohort has; followed by an id or by `new` it is one assignment, which does not.
    expect(sameViewInCourse(`/instructor/courses/${COURSE}/curriculum`, OTHER)).toBe(
      curriculumHref(OTHER),
    );
    expect(sameViewInCourse(`/instructor/courses/${COURSE}/curriculum/${ASSIGNMENT}`, OTHER)).toBe(
      triageHref(OTHER),
    );
  });

  /*
    The three segments Curriculum replaced are no longer views that travel, which is what this
    checks.

    A stale *bookmark* is a separate matter and is handled elsewhere: `next.config.ts` redirects
    `/modules`, `/resources`, and `/coursework` to the curriculum screen, so an address kept in
    somebody's history still lands on the page it names. This function only ever sees paths from
    inside the application, and every one of those already says `curriculum`.
  */
  /*
    A program's own address given to the course switcher, which is where a course name in the
    sidebar is clicked from most often: the roster, the attendance screen, and the program's
    settings all name a program and no course. There is no course view to keep, so the answer is
    the same as from `/dashboard` — the new course's triage.
  */
  it("lands on triage from a program's roster, which names no course", () => {
    expect(sameViewInCourse(rosterHref(PROGRAM), OTHER)).toBe(triageHref(OTHER));
  });

  it.each(["assignments", "coursework", "modules", "resources"])(
    "no longer recognises the old %s segment",
    (segment) => {
      expect(sameViewInCourse(`/instructor/courses/${COURSE}/${segment}`, OTHER)).toBe(
        triageHref(OTHER),
      );
    },
  );
});

describe("authoring an assignment inside a unit", () => {
  /*
    A starting value for one field rather than a different form: the same page authors an
    assignment wherever it belongs, so the unit is a query parameter and not a path segment.
  */
  it("pre-fills the form's unit through the query string", () => {
    expect(newAssignmentHref(COURSE, UNIT)).toBe(
      `/instructor/courses/${COURSE}/curriculum/new?unit=${UNIT}`,
    );
    expect(newAssignmentHref(COURSE)).not.toContain("?");
  });

  it("lands on triage from an address that names no course at all", () => {
    // `/dashboard` and `/admin` are outside the cohort entirely. There is no view to keep, so this
    // is the case a course name clicked in the sidebar takes from every non-course screen.
    expect(sameViewInCourse("/dashboard", OTHER)).toBe(triageHref(OTHER));
    expect(sameViewInCourse("/admin", OTHER)).toBe(triageHref(OTHER));
  });

  it("tolerates a trailing slash", () => {
    expect(sameViewInCourse(`/instructor/courses/${COURSE}/gradebook/`, OTHER)).toBe(
      gradebookHref(OTHER),
    );
  });
});

/**
 * The program switcher's arithmetic, checked exhaustively for the reason its sibling is: a view
 * missing from `sameViewInProgram` does not throw, it falls through to settings — so switching
 * program from the roster would silently land somewhere else and read as the switcher losing
 * your place.
 */
describe("sameViewInProgram", () => {
  describe("the views every program has, which travel", () => {
    it.each([
      ["attendance", attendanceHref(OTHER_PROGRAM)],
      ["roster", rosterHref(OTHER_PROGRAM)],
      ["settings", programSettingsHref(OTHER_PROGRAM)],
    ])("%s becomes the other program's %s", (segment, expected) => {
      expect(sameViewInProgram(`/instructor/programs/${PROGRAM}/${segment}`, OTHER_PROGRAM)).toBe(
        expected,
      );
    });
  });

  /*
    One day of attendance does not travel. The other term may not have met on it, and
    landing on an empty screen offering to record a morning that never happened is worse than
    landing on settings — which is also where a fellow's record lands, because a person is on one
    roster or the other and a page naming somebody absent from this one would refuse rather than
    render.
  */
  it.each([
    ["one day of attendance", `/instructor/programs/${PROGRAM}/attendance/day/2026-08-14`],
    ["a fellow's record", `/instructor/programs/${PROGRAM}/students/${STUDENT}`],
    ["the bare program address", `/instructor/programs/${PROGRAM}`],
  ])("%s lands on settings", (_label, pathname) => {
    expect(sameViewInProgram(pathname, OTHER_PROGRAM)).toBe(programSettingsHref(OTHER_PROGRAM));
  });

  /*
    The list of every program the caller belongs to, which is the screen a program is most often
    switched from. It names no program of its own, so there is nothing to keep and settings is
    where the switch lands.
  */
  it("lands on settings from the program list, which names no program", () => {
    expect(sameViewInProgram(programsHref(), OTHER_PROGRAM)).toBe(
      programSettingsHref(OTHER_PROGRAM),
    );
  });

  it("lands on settings from a course address, which names no program", () => {
    // A course address carries no program id, so there is nothing here to keep.
    expect(sameViewInProgram(`/instructor/courses/${COURSE}/gradebook`, OTHER_PROGRAM)).toBe(
      programSettingsHref(OTHER_PROGRAM),
    );
  });
});
