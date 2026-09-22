import {
  assignmentType,
  attendanceClassId,
  collapseStatus,
  later,
  pointValueOf,
  registrationKey,
  submissionKey,
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
