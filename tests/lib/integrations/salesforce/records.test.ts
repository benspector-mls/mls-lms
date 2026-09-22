import {
  assignmentRecord,
  assignmentType,
  attendanceClassId,
  attendanceClassRecord,
  attendanceRecord,
  classRecord,
  collapseStatus,
  enrollmentRecord,
  gcfAttemptRecord,
  later,
  pointValueOf,
  programRecord,
  registrationKey,
  registrationRecord,
  sessionRecord,
  submissionKey,
  submissionRecord,
} from "@/lib/integrations/salesforce/records";

/**
 * What a Salesforce record says, given a row.
 *
 * The rules under test here are the ones that decide identity and meaning across the whole
 * feed. An identifier built differently in two places is two Salesforce records for one thing;
 * a status collapsed differently is a report that disagrees with the gradebook.
 */

describe("identifiers", () => {
  it("names the synthetic attendance class by its program", () => {
    expect(attendanceClassId("p1")).toBe("attendance:p1");
  });

  it("names a registration by course then enrollment, and a submission by assignment then enrollment", () => {
    expect(registrationKey("c1", "e1")).toBe("c1:e1");
    expect(submissionKey("a1", "e1")).toBe("a1:e1");
  });
});

describe("later", () => {
  it("returns the later of two instants", () => {
    const earlier = new Date("2026-01-01T00:00:00Z");
    const afterwards = new Date("2026-01-02T00:00:00Z");
    expect(later(earlier, afterwards)).toBe(afterwards);
    expect(later(afterwards, earlier)).toBe(afterwards);
  });
});

describe("collapseStatus", () => {
  it("maps all eight statuses onto four", () => {
    expect(collapseStatus("NOT_STARTED")).toBe("notStarted");
    expect(collapseStatus("ACCEPTED")).toBe("inProgress");
    expect(collapseStatus("SUBMITTED")).toBe("submitted");
    expect(collapseStatus("RESUBMITTED")).toBe("submitted");
    expect(collapseStatus("DRAFT_READY")).toBe("submitted");
    expect(collapseStatus("GRADING_FAILED")).toBe("submitted");
    expect(collapseStatus("NEEDS_MANUAL_REVIEW")).toBe("submitted");
    expect(collapseStatus("GRADED")).toBe("graded");
  });
});

describe("assignmentType", () => {
  it("reads the unit's category", () => {
    expect(assignmentType("MODULE")).toBe("assignment");
    expect(assignmentType("PROJECT")).toBe("project");
    expect(assignmentType("ASSESSMENT")).toBe("assessment");
  });
});

describe("pointValueOf", () => {
  it("is one for a task and the column otherwise", () => {
    expect(pointValueOf({ kind: "TASK", pointValue: 40 })).toBe(1);
    expect(pointValueOf({ kind: "REPO", pointValue: 40 })).toBe(40);
    expect(pointValueOf({ kind: "GOOGLE_DRIVE", pointValue: 12 })).toBe(12);
    expect(pointValueOf({ kind: "SELF_DIRECTED", pointValue: 7 })).toBe(7);
  });
});

const UPDATED = new Date("2026-09-22T14:00:00.000Z");
const EARLIER = new Date("2026-09-21T14:00:00.000Z");

describe("programRecord and enrollmentRecord", () => {
  it("carries what the setup scenario matches on and stamps with", () => {
    expect(
      programRecord({
        id: "p1",
        name: "Software Engineering",
        term: "Fall 2026",
        discipline: "SOFTWARE_ENGINEERING",
        updatedAt: UPDATED,
      }),
    ).toEqual({
      externalId: "p1",
      name: "Software Engineering",
      term: "Fall 2026",
      discipline: "SOFTWARE_ENGINEERING",
      updatedAt: UPDATED,
    });

    expect(
      enrollmentRecord({
        id: "e1",
        programId: "p1",
        status: "ACTIVE",
        updatedAt: UPDATED,
        student: { id: "s1", email: "ada@example.test", displayName: "Ada" },
      }),
    ).toEqual({
      externalId: "e1",
      programId: "p1",
      studentId: "s1",
      studentEmail: "ada@example.test",
      studentName: "Ada",
      status: "ACTIVE",
      updatedAt: UPDATED,
    });
  });
});

describe("classRecord and attendanceClassRecord", () => {
  it("names a course's program and whether it is archived", () => {
    expect(
      classRecord({
        id: "c1",
        programId: "p1",
        name: "Seminar",
        archivedAt: null,
        updatedAt: UPDATED,
      }),
    ).toEqual({
      externalId: "c1",
      programId: "p1",
      name: "Seminar",
      archived: false,
      updatedAt: UPDATED,
    });
    expect(
      classRecord({
        id: "c1",
        programId: "p1",
        name: "Seminar",
        archivedAt: EARLIER,
        updatedAt: UPDATED,
      }).archived,
    ).toBe(true);
  });

  it("makes one Attendance class per program, positioned with the program", () => {
    expect(attendanceClassRecord({ id: "p1", updatedAt: UPDATED })).toEqual({
      externalId: "attendance:p1",
      programId: "p1",
      name: "Attendance",
      archived: false,
      updatedAt: UPDATED,
    });
  });
});

describe("registrationRecord", () => {
  it("keys on the pair and is positioned at the later of the two", () => {
    const record = registrationRecord(
      { id: "c1", updatedAt: EARLIER },
      { id: "e1", status: "REMOVED", updatedAt: UPDATED },
    );
    expect(record).toEqual({
      externalId: "c1:e1",
      classId: "c1",
      enrollmentId: "e1",
      enrollmentStatus: "REMOVED",
      updatedAt: UPDATED,
    });
  });
});

describe("assignmentRecord", () => {
  it("reads type from the unit and point value by the task rule", () => {
    expect(
      assignmentRecord({
        id: "a1",
        courseId: "c1",
        title: "Build a thing",
        kind: "TASK",
        pointValue: 99,
        dueAt: null,
        updatedAt: UPDATED,
        courseUnit: { category: "ASSESSMENT" },
      }),
    ).toEqual({
      externalId: "a1",
      classId: "c1",
      title: "Build a thing",
      type: "assessment",
      pointValue: 1,
      dueAt: null,
      updatedAt: UPDATED,
    });
  });
});

describe("sessionRecord and attendanceRecord", () => {
  it("names the program's Attendance class and emits the day as a string", () => {
    expect(
      sessionRecord({
        id: "s1",
        programId: "p1",
        date: new Date("2026-09-14T00:00:00Z"),
        startedAt: null,
        endedAt: null,
        updatedAt: UPDATED,
      }),
    ).toEqual({
      externalId: "s1",
      classId: "attendance:p1",
      date: "2026-09-14",
      startedAt: null,
      endedAt: null,
      updatedAt: UPDATED,
    });
  });

  it("carries status, source, and the check-in instant", () => {
    const checkedInAt = new Date("2026-09-14T13:04:00Z");
    expect(
      attendanceRecord({
        id: "r1",
        sessionId: "s1",
        enrollmentId: "e1",
        status: "LATE",
        source: "SELF_CHECK_IN",
        checkedInAt,
        note: null,
        updatedAt: UPDATED,
      }),
    ).toEqual({
      externalId: "r1",
      sessionId: "s1",
      enrollmentId: "e1",
      status: "LATE",
      source: "SELF_CHECK_IN",
      checkedInAt,
      note: null,
      updatedAt: UPDATED,
    });
  });
});

describe("submissionRecord", () => {
  const pair = {
    assignment: {
      id: "a1",
      courseId: "c1",
      dueAt: new Date("2026-02-01T05:00:00Z"),
      updatedAt: EARLIER,
    },
    enrollment: { id: "e1", updatedAt: UPDATED },
  };

  it("is notStarted with every grade field null when there is no row, positioned at the later parent", () => {
    expect(submissionRecord(pair, null)).toEqual({
      externalId: "a1:e1",
      assignmentId: "a1",
      registrationId: "c1:e1",
      status: "notStarted",
      submittedAt: null,
      score: null,
      scorePossible: null,
      isComplete: null,
      lateness: null,
      gradedAt: null,
      feedbackMarkdown: null,
      updatedAt: UPDATED,
    });
  });

  it("carries a released grade, and lateness against the deadline", () => {
    const gradedAt = new Date("2026-02-03T12:00:00Z");
    const rowUpdated = new Date("2026-02-03T12:00:01Z");
    const record = submissionRecord(pair, {
      status: "GRADED",
      submittedAt: new Date("2026-02-02T12:00:00Z"),
      finalScore: 34,
      finalScorePossible: 40,
      isComplete: true,
      gradedAt,
      feedbackMarkdown: "Good.",
      extendedDueAt: null,
      updatedAt: rowUpdated,
    });
    expect(record.status).toBe("graded");
    expect(record.score).toBe(34);
    expect(record.scorePossible).toBe(40);
    expect(record.isComplete).toBe(true);
    expect(record.lateness).toBe("late");
    expect(record.gradedAt).toBe(gradedAt);
    expect(record.feedbackMarkdown).toBe("Good.");
    expect(record.updatedAt).toBe(rowUpdated);
  });

  it("reads extended when the hand-in beat an agreed extension", () => {
    const record = submissionRecord(pair, {
      status: "SUBMITTED",
      submittedAt: new Date("2026-02-02T12:00:00Z"),
      finalScore: null,
      finalScorePossible: null,
      isComplete: null,
      gradedAt: null,
      feedbackMarkdown: null,
      extendedDueAt: new Date("2026-02-05T05:00:00Z"),
      updatedAt: UPDATED,
    });
    expect(record.lateness).toBe("extended");
    expect(record.status).toBe("submitted");
  });

  it("withholds the grade fields on a row that is not GRADED, even if the columns hold old values", () => {
    const record = submissionRecord(pair, {
      status: "RESUBMITTED",
      submittedAt: new Date("2026-02-04T12:00:00Z"),
      finalScore: 20,
      finalScorePossible: 40,
      isComplete: false,
      gradedAt: new Date("2026-02-03T12:00:00Z"),
      feedbackMarkdown: "Old feedback.",
      extendedDueAt: null,
      updatedAt: UPDATED,
    });
    expect(record.status).toBe("submitted");
    expect(record.score).toBeNull();
    expect(record.scorePossible).toBeNull();
    expect(record.isComplete).toBeNull();
    expect(record.gradedAt).toBeNull();
    expect(record.feedbackMarkdown).toBeNull();
  });

  it("has null lateness on a row with no hand-in", () => {
    const record = submissionRecord(pair, {
      status: "ACCEPTED",
      submittedAt: null,
      finalScore: null,
      finalScorePossible: null,
      isComplete: null,
      gradedAt: null,
      feedbackMarkdown: null,
      extendedDueAt: null,
      updatedAt: UPDATED,
    });
    expect(record.status).toBe("inProgress");
    expect(record.lateness).toBeNull();
  });
});

describe("gcfAttemptRecord", () => {
  const row = {
    id: "g1",
    kind: "PROCTORED" as const,
    score: 512,
    scorePossible: null,
    takenOn: new Date("2026-09-10T00:00:00Z"),
    integrityFlagged: false,
    resultUrl: null,
    updatedAt: UPDATED,
  };

  it("names the Contact and the most recent enrollment, and emits the day as a string", () => {
    expect(
      gcfAttemptRecord({ ...row, student: { id: "s1", enrollments: [{ id: "e2" }] } }),
    ).toEqual({
      externalId: "g1",
      enrollmentId: "e2",
      contactId: "s1",
      kind: "PROCTORED",
      score: 512,
      scorePossible: null,
      takenOn: "2026-09-10",
      integrityFlagged: false,
      resultUrl: null,
      updatedAt: UPDATED,
    });
  });

  it("has a null enrollment for a fellow with none", () => {
    expect(
      gcfAttemptRecord({ ...row, student: { id: "s1", enrollments: [] } }).enrollmentId,
    ).toBeNull();
  });
});
