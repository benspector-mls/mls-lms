import {
  commentRecipients,
  feedbackRecipients,
  schoolHourAndWeekday,
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

describe("schoolHourAndWeekday", () => {
  /*
    Nine in Brooklyn is 13:00 UTC in summer and 14:00 UTC in winter. Reading the school's wall
    clock rather than a UTC hour is the behaviour under test, so both halves of the year appear
    here — a job scheduled at a fixed UTC hour would be an hour wrong for one of them.
  */
  it("reads the hour from the school's clock, not from UTC", () => {
    expect(schoolHourAndWeekday(new Date("2026-06-15T13:00:00Z")).hour).toBe(9);
    expect(schoolHourAndWeekday(new Date("2026-12-14T13:00:00Z")).hour).toBe(8);
    expect(schoolHourAndWeekday(new Date("2026-12-14T14:00:00Z")).hour).toBe(9);
  });

  it("numbers the weekday as weekdayOf does, Sunday first", () => {
    expect(schoolHourAndWeekday(new Date("2026-06-15T13:00:00Z")).weekday).toBe(1);
    expect(schoolHourAndWeekday(new Date("2026-06-16T13:00:00Z")).weekday).toBe(2);
    expect(schoolHourAndWeekday(new Date("2026-06-14T13:00:00Z")).weekday).toBe(0);
  });

  /*
    Late evening in Brooklyn is the next day in UTC. The weekday has to come from the civil date in
    the school's zone or a Sunday-night instant would be filed under Monday and a weekly digest
    would go out a day early.
  */
  it("a late evening does not roll over into the next weekday", () => {
    const sundayNight = new Date("2026-06-15T02:00:00Z");
    expect(schoolHourAndWeekday(sundayNight)).toEqual({ hour: 22, weekday: 0 });
  });
});
