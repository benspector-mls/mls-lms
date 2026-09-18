import {
  commentRecipients,
  digestCadencesDue,
  feedbackRecipients,
} from "@/lib/notifications/recipients";

describe("feedbackRecipients", () => {
  it("solo work reaches its one student", () => {
    expect(feedbackRecipients({ studentId: "s1", mirrors: [] })).toEqual(["s1"]);
  });

  it("team work reaches every member exactly once", () => {
    const recipients = feedbackRecipients({
      studentId: "captain",
      mirrors: [{ studentId: "m1" }, { studentId: "m2" }],
    });
    expect(recipients.sort()).toEqual(["captain", "m1", "m2"]);
  });

  it("a duplicate mirror row cannot produce a second DM", () => {
    const recipients = feedbackRecipients({
      studentId: "captain",
      mirrors: [{ studentId: "m1" }, { studentId: "m1" }],
    });
    expect(recipients.sort()).toEqual(["captain", "m1"]);
  });
});

describe("commentRecipients", () => {
  const thread = {
    studentId: "s1",
    gradedById: "grader",
    mirrorStudentIds: ["m1", "m2"],
    instructorAuthorIds: ["i1", "grader", null],
  };

  it("a fellow's comment reaches the thread's instructors and the grader, once each", () => {
    const recipients = commentRecipients({ authorId: "s1", authorRole: "STUDENT", thread });
    // "grader" appears both as a thread author and as gradedBy; the null is a deleted account.
    expect(recipients.sort()).toEqual(["grader", "i1"]);
  });

  it("a fellow's comment on ungraded, untouched work reaches nobody", () => {
    const recipients = commentRecipients({
      authorId: "s1",
      authorRole: "STUDENT",
      thread: { ...thread, gradedById: null, instructorAuthorIds: [] },
    });
    expect(recipients).toEqual([]);
  });

  it("an instructor's comment reaches the fellow and the whole team", () => {
    const recipients = commentRecipients({ authorId: "i1", authorRole: "INSTRUCTOR", thread });
    expect(recipients.sort()).toEqual(["m1", "m2", "s1"]);
  });

  it("the author never hears about their own comment", () => {
    const recipients = commentRecipients({
      authorId: "i1",
      authorRole: "STUDENT",
      thread,
    });
    expect(recipients.sort()).toEqual(["grader"]);
  });
});

describe("digestCadencesDue", () => {
  // 9am in America/New_York is 13:00 UTC in summer and 14:00 UTC in winter. Reading the school's
  // wall clock rather than a fixed UTC hour is the behaviour under test, so both halves of the
  // year appear here.
  it("a summer Monday at 13:00 UTC is the weekly send", () => {
    expect(digestCadencesDue(new Date("2026-06-15T13:00:00Z"))).toEqual(["DAILY", "WEEKLY"]);
  });

  it("a summer Tuesday at 13:00 UTC is the daily send only", () => {
    expect(digestCadencesDue(new Date("2026-06-16T13:00:00Z"))).toEqual(["DAILY"]);
  });

  it("13:00 UTC in winter is 8am school time, so nothing is due", () => {
    expect(digestCadencesDue(new Date("2026-12-14T13:00:00Z"))).toBeNull();
  });

  it("a winter Monday at 14:00 UTC is the weekly send", () => {
    expect(digestCadencesDue(new Date("2026-12-14T14:00:00Z"))).toEqual(["DAILY", "WEEKLY"]);
  });

  it("any other hour is quiet", () => {
    expect(digestCadencesDue(new Date("2026-06-15T14:00:00Z"))).toBeNull();
    expect(digestCadencesDue(new Date("2026-06-15T03:00:00Z"))).toBeNull();
  });
});
