import {
  ASSIGNMENT_KIND_META,
  CONFIDENCE_META,
  completionMeta,
  DRAFT_STATUS_META,
  draftStatusAddsSomething,
  feedbackIsUnread,
  FLAG_META,
  flagMeta,
  formatDueDate,
  formatDuration,
  formatPercent,
  formatRelative,
  handedIn,
  handInMode,
  linkHost,
  scoreLabel,
  scorePercent,
  sectionLabel,
  shortSha,
  STUDENT_STATUS_META,
  SUBMISSION_STATUS_META,
  TONE_CLASSES,
  TONE_DOT,
} from "@/lib/status";
import type { SubmissionStatus } from "@/lib/generated/prisma/enums";

/**
 * The single source of presentation truth.
 *
 * The same submission status is drawn on the student's assignment list, the instructor's triage,
 * and the gradebook. What these cases hold is not the wording — that changes — but the rules the
 * wording has to obey, and one of them cost a real defect: green means the work met the
 * completion threshold, and nothing else.
 */

describe("green means one thing", () => {
  it("is not the tone of a finished grading run", () => {
    /*
      GRADED and APPROVED were both `success`, which put a green pill beside a 9/15 and said
      the opposite of the truth. Grading being finished, feedback being released, and work
      being complete are three different facts and one colour cannot say all of them.
    */
    expect(SUBMISSION_STATUS_META.GRADED.tone).not.toBe("success");
    expect(DRAFT_STATUS_META.APPROVED.tone).not.toBe("success");
    expect(STUDENT_STATUS_META.GRADED.tone).not.toBe("success");
  });

  it("survives only where the question is about evidence rather than about the student", () => {
    // Both instructor-only, and both sit among other flag badges, which is what keeps them
    // from reading as a grade.
    expect(FLAG_META.TEST_EVIDENCE.tone).toBe("success");
    expect(CONFIDENCE_META.HIGH.tone).toBe("success");
  });

  it("is not the tone of any submission status, in either vocabulary", () => {
    for (const meta of Object.values(SUBMISSION_STATUS_META)) expect(meta.tone).not.toBe("success");
    for (const meta of Object.values(STUDENT_STATUS_META)) expect(meta.tone).not.toBe("success");
  });
});

describe("the student vocabulary is narrower on purpose", () => {
  it.each(["SUBMITTED", "DRAFT_READY", "NEEDS_MANUAL_REVIEW", "GRADING_FAILED"] as const)(
    "reads %s as Submitted",
    (status) => {
      // A student has no use for the state of a grading run, and "grading failed" invites a
      // question no student can answer.
      expect(STUDENT_STATUS_META[status].label).toBe("Submitted");
    },
  );

  it("never shows a student the word failed", () => {
    for (const meta of Object.values(STUDENT_STATUS_META)) {
      expect(meta.label.toLowerCase()).not.toContain("fail");
    }
  });

  it("covers every status the instructor vocabulary does", () => {
    // Both are Record<SubmissionStatus, …>, so a new enum value is a compile error rather than
    // a screen rendering a raw database string. This holds it at runtime too.
    const statuses = Object.keys(SUBMISSION_STATUS_META) as SubmissionStatus[];
    for (const status of statuses) expect(STUDENT_STATUS_META[status]).toBeDefined();
  });

  /*
    Nothing handed in reads as nothing handed in.

    To a student, accepting and not having started are the same fact — the work is theirs to do
    and nothing is with anybody else. Accepting creates a repository, which is bookkeeping this
    application needed rather than progress on the assignment, and a coloured pill beside it read
    as though something had happened.

    Grey is therefore load-bearing on this list: colour is what separates the rows waiting on
    somebody from the rows waiting on the student.
  */
  it("draws Accepted as quietly as Not started", () => {
    expect(STUDENT_STATUS_META.ACCEPTED.tone).toBe("neutral");
    expect(STUDENT_STATUS_META.ACCEPTED.tone).toBe(STUDENT_STATUS_META.NOT_STARTED.tone);
  });

  it("still gives the states that are waiting on somebody a colour each", () => {
    const waiting = ["SUBMITTED", "RESUBMITTED", "GRADED"] as const;
    for (const status of waiting) expect(STUDENT_STATUS_META[status].tone).not.toBe("neutral");
    expect(new Set(waiting.map((s) => STUDENT_STATUS_META[s].tone)).size).toBe(waiting.length);
  });
});

describe("completionMeta", () => {
  it("says Complete for work that met the threshold", () => {
    expect(completionMeta(true)).toEqual({
      label: "Complete",
      className: expect.stringContaining("emerald"),
    });
  });

  it("says Incomplete for work that did not", () => {
    expect(completionMeta(false)?.label).toBe("Incomplete");
  });

  it("is null when nothing has been graded", () => {
    // So no caller can render "Incomplete" for work nobody has looked at.
    expect(completionMeta(null)).toBeNull();
    expect(completionMeta(undefined)).toBeNull();
  });
});

describe("draftStatusAddsSomething", () => {
  it("is false for APPROVED, which says nothing the submission does not", () => {
    // Approving is the only thing that sets a submission to GRADED, so showing both is the
    // same fact twice in two words.
    expect(draftStatusAddsSomething("APPROVED")).toBe(false);
  });

  it("is false for SUPERSEDED, which is history rather than a state to act on", () => {
    expect(draftStatusAddsSomething("SUPERSEDED")).toBe(false);
  });

  it.each(["GENERATING", "READY", "NEEDS_MANUAL_REVIEW", "FAILED"] as const)(
    "is true for %s, which the submission badge cannot carry",
    (status) => {
      expect(draftStatusAddsSomething(status)).toBe(true);
    },
  );
});

describe("flagMeta", () => {
  it("renders an unrecognised code as itself rather than dropping it", () => {
    // A flag the interface has not been taught about is still information.
    expect(flagMeta("SOMETHING_NEW").label).toBe("SOMETHING_NEW");
  });

  it("opens every writing and technical flag with why points came off", () => {
    // The thing the labels never said: each records why the student *lost* points, and a
    // section at full marks carries none.
    for (const [code, meta] of Object.entries(FLAG_META)) {
      if (meta.kind === "writing" || meta.kind === "technical") {
        expect(meta.description.startsWith("Points came off")).toBe(true);
      }
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });

  it("marks the test-evidence faults as faults and the ordinary ones as not", () => {
    // Four outcomes rather than two, because "this assignment has no suite" and "it has one
    // and none of it ran" are opposite situations.
    expect(FLAG_META.TEST_EVIDENCE.fault).toBe(false);
    expect(FLAG_META.NO_TESTS_EXPECTED.fault).toBe(false);
    expect(FLAG_META.TEST_RUN_MISSING.fault).toBe(true);
    expect(FLAG_META.TEST_MATCH_MISSING.fault).toBe(true);
  });

  it("still decodes LOW_CONFIDENCE, which older drafts have stored", () => {
    // Nothing writes it any more, but this map decodes *stored* flags. Without the entry a
    // raw LOW_CONFIDENCE string would render as a badge.
    expect(flagMeta("LOW_CONFIDENCE").label).toBe("Low confidence");
  });
});

describe("every tone has a class and a dot", () => {
  it.each(Object.keys(TONE_CLASSES))("%s", (tone) => {
    expect(TONE_DOT[tone as keyof typeof TONE_DOT]).toBeDefined();
  });

  it("is used by every status map", () => {
    const tones = new Set(Object.keys(TONE_CLASSES));
    const maps = [SUBMISSION_STATUS_META, STUDENT_STATUS_META, DRAFT_STATUS_META, CONFIDENCE_META];
    for (const map of maps) {
      for (const meta of Object.values(map)) expect(tones.has(meta.tone)).toBe(true);
    }
    for (const meta of Object.values(FLAG_META)) expect(tones.has(meta.tone)).toBe(true);
  });
});

describe("ASSIGNMENT_KIND_META", () => {
  it("describes all four kinds", () => {
    expect(Object.keys(ASSIGNMENT_KIND_META).sort()).toEqual([
      "EXTERNAL_URL",
      "FILE_UPLOAD",
      "GOOGLE_DRIVE",
      "REPO",
    ]);
  });

  it("says how the work is handed in rather than restating the label", () => {
    for (const [kind, meta] of Object.entries(ASSIGNMENT_KIND_META)) {
      expect(meta.description.toLowerCase()).toContain("handed in");
      expect(meta.description).not.toContain(meta.label);
      expect(kind).toMatch(/^[A-Z_]+$/);
    }
  });

  it("gives a kind no tone, because a kind is not a state", () => {
    // It does not change, nothing is waiting on it, and colouring it would make a permanent
    // property of an assignment look like something needing attention.
    for (const meta of Object.values(ASSIGNMENT_KIND_META)) {
      expect(meta).not.toHaveProperty("tone");
    }
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-08-08T12:00:00Z");

  it.each([
    ["30 seconds ago", 30_000, "1 min ago"],
    ["5 minutes ago", 5 * 60_000, "5 mins ago"],
    ["3 hours ago", 3 * 3_600_000, "3 hrs ago"],
    ["2 days ago", 2 * 86_400_000, "2 days ago"],
  ])("reads %s", (_label, ago, expected) => {
    expect(formatRelative(new Date(now.getTime() - ago), now)).toBe(expected);
  });

  it("singularises one", () => {
    expect(formatRelative(new Date(now.getTime() - 3_600_000), now)).toBe("1 hr ago");
    expect(formatRelative(new Date(now.getTime() - 86_400_000), now)).toBe("1 day ago");
  });

  it("reads a future instant as ahead rather than as negative", () => {
    expect(formatRelative(new Date(now.getTime() + 2 * 86_400_000), now)).toBe("in 2 days");
  });

  it("never says 0 mins ago", () => {
    // Rounding to zero would read as no time at all having passed.
    expect(formatRelative(new Date(now.getTime() - 1000), now)).toBe("1 min ago");
  });

  it("takes the reference instant rather than reading the clock", () => {
    /*
      Reading the clock during render is what makes server and client output differ, which
      React reports as a hydration mismatch — and a cached render has no meaningful "now".
      The same arguments must give the same answer every time.
    */
    const date = new Date(now.getTime() - 7_200_000);
    expect(formatRelative(date, now)).toBe(formatRelative(date, now));
  });

  it("is an em dash for no date", () => {
    expect(formatRelative(null, now)).toBe("—");
    expect(formatRelative(undefined, now)).toBe("—");
  });
});

describe("scores, where null is never zero", () => {
  it("shows a score out of its possible", () => {
    expect(scoreLabel(11, 15)).toBe("11/15");
  });

  it("shows an em dash rather than 0 when nothing is graded", () => {
    expect(scoreLabel(null, 15)).toBe("—");
    expect(scoreLabel(11, null)).toBe("—");
  });

  it("shows a real zero as a real zero", () => {
    expect(scoreLabel(0, 15)).toBe("0/15");
  });

  it("computes a percentage", () => {
    expect(scorePercent(11, 15)).toBeCloseTo(11 / 15);
    expect(formatPercent(scorePercent(11, 15))).toBe("73%");
  });

  it("refuses to divide by zero", () => {
    expect(scorePercent(0, 0)).toBeNull();
    expect(formatPercent(null)).toBe("—");
  });
});

describe("shortSha", () => {
  it("takes the first seven characters", () => {
    expect(shortSha("0123456789abcdef")).toBe("0123456");
  });

  it("is an em dash for no commit", () => {
    expect(shortSha(null)).toBe("—");
  });
});

describe("formatDuration", () => {
  it.each([
    [450, "450 ms"],
    [4_500, "4.5 s"],
    [42_000, "42 s"],
    [95_000, "1m 35s"],
  ])("formats %i as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it("is an em dash for no duration", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("sectionLabel", () => {
  it.each([
    ["short_response", "Short response"],
    ["coding_algorithm", "Algorithm fluency"],
    ["coding_sql", "SQL fluency"],
    ["coding_frontend", "Frontend"],
  ])("names %s", (type, expected) => {
    expect(sectionLabel(type)).toBe(expected);
  });

  it("renders an unknown type as words rather than as a database value", () => {
    // An instructor-authored section type will arrive here before this map learns about it.
    expect(sectionLabel("group_presentation")).toBe("Group presentation");
  });
});

/**
 * Which of the four things handing in means right now.
 *
 * The case worth having is `update`: work sitting in the queue matched neither of the two
 * booleans this replaced, so a student who submitted the wrong link could not correct it and was
 * shown nothing explaining why. Every status that is neither "not yet handed in" nor "already
 * graded" has to land there.
 */
describe("handInMode", () => {
  it("offers a first submission when nothing is handed in", () => {
    expect(handInMode(null, false)).toBe("submit");
    expect(handInMode("NOT_STARTED", false)).toBe("submit");
  });

  // Taking a copy of a Drive template is receiving the work, not returning it.
  it("treats an accepted assignment as not yet handed in", () => {
    expect(handInMode("ACCEPTED", false)).toBe("submit");
  });

  it("lets work still waiting be corrected", () => {
    expect(handInMode("SUBMITTED", false)).toBe("update");
    expect(handInMode("RESUBMITTED", false)).toBe("update");
  });

  // Nothing writes these three today. Treating an unrecognised queue state as correctable is the
  // safe direction: the worst case is a student fixing work nobody had started reading.
  it.each(["DRAFT_READY", "NEEDS_MANUAL_REVIEW", "GRADING_FAILED"] as const)(
    "treats %s as correctable rather than as finished",
    (status) => {
      expect(handInMode(status, false)).toBe("update");
    },
  );

  it("becomes a second attempt once a grade exists", () => {
    expect(handInMode("GRADED", false)).toBe("resubmit");
  });

  /*
    The rule that makes overwriting safe. `submittedUrl` and the upload columns are single-valued,
    so handing in again destroys what an instructor is part-way through reading.
  */
  it("locks every mode where an instructor has the work open", () => {
    expect(handInMode("SUBMITTED", true)).toBe("locked");
    expect(handInMode("RESUBMITTED", true)).toBe("locked");
    expect(handInMode("GRADED", true)).toBe("locked");
  });

  // A draft on work that was never handed in is not something to protect, and locking here would
  // leave a student unable to submit at all.
  it("does not lock a student out of submitting in the first place", () => {
    expect(handInMode(null, true)).toBe("submit");
    expect(handInMode("NOT_STARTED", true)).toBe("submit");
    expect(handInMode("ACCEPTED", true)).toBe("submit");
  });
});

/**
 * Whether the next move is the student's.
 *
 * The one screen that asks is the dashboard's deadline list, so a wrong answer here is either a
 * missed deadline or a row a student can see is wrong. Those are not equally bad, which is why the
 * function is written as the complement of the three states rather than as a list of the six.
 */
describe("handedIn", () => {
  it("says no while the next move is the student's", () => {
    expect(handedIn(null)).toBe(false);
    expect(handedIn(undefined)).toBe(false);
    expect(handedIn("NOT_STARTED")).toBe(false);
    expect(handedIn("ACCEPTED")).toBe(false);
  });

  it("says yes for everything sitting with an instructor", () => {
    expect(handedIn("SUBMITTED")).toBe(true);
    expect(handedIn("RESUBMITTED")).toBe(true);
    expect(handedIn("DRAFT_READY")).toBe(true);
    expect(handedIn("NEEDS_MANUAL_REVIEW")).toBe(true);
    expect(handedIn("GRADING_FAILED")).toBe(true);
  });

  /*
    Including work that came back below the threshold. Resubmitting is a second attempt at work
    already handed in, and putting a returned assignment back on a due-date list would tell a
    student they had missed a deadline they in fact met.
  */
  it("counts graded work, complete or not", () => {
    expect(handedIn("GRADED")).toBe(true);
  });

  // The complement is exact: every status is on exactly one side of this.
  it("agrees with handInMode about which states are the student's move", () => {
    const statuses: SubmissionStatus[] = [
      "NOT_STARTED",
      "ACCEPTED",
      "SUBMITTED",
      "DRAFT_READY",
      "GRADED",
      "RESUBMITTED",
      "GRADING_FAILED",
      "NEEDS_MANUAL_REVIEW",
    ];

    for (const status of statuses) {
      expect(handedIn(status)).toBe(handInMode(status, false) !== "submit");
    }
  });
});

/**
 * Whether there is a report the student has not said they read.
 *
 * The second round is the case this exists for, and the one a null check gets wrong.
 */
describe("feedbackIsUnread", () => {
  const graded = new Date("2026-10-09T14:00:00Z");

  it("is unread until the student says otherwise", () => {
    expect(feedbackIsUnread({ status: "GRADED", gradedAt: graded, feedbackReviewedAt: null })).toBe(
      true,
    );
  });

  it("is read once they have", () => {
    expect(
      feedbackIsUnread({
        status: "GRADED",
        gradedAt: graded,
        feedbackReviewedAt: new Date("2026-10-09T18:00:00Z"),
      }),
    ).toBe(false);
  });

  /*
    The defect a null check would have. A student reads their first report, revises, asks for
    another review, and is graded again — `feedbackReviewedAt` is already set at that point, so the
    new report would never be announced.
  */
  it("is unread again when a later grade arrives", () => {
    expect(
      feedbackIsUnread({
        status: "GRADED",
        gradedAt: new Date("2026-10-20T09:00:00Z"),
        feedbackReviewedAt: new Date("2026-10-09T18:00:00Z"),
      }),
    ).toBe(true);
  });

  // Nothing has been released to read yet, whatever the queue is doing.
  it.each(["NOT_STARTED", "ACCEPTED", "SUBMITTED", "RESUBMITTED", "DRAFT_READY"] as const)(
    "has nothing to report for %s",
    (status) => {
      expect(feedbackIsUnread({ status, gradedAt: null, feedbackReviewedAt: null })).toBe(false);
    },
  );

  // A recorded read stands rather than becoming permanently unread, which nothing could clear.
  it("keeps a read on a grade carrying no timestamp", () => {
    expect(feedbackIsUnread({ status: "GRADED", gradedAt: null, feedbackReviewedAt: graded })).toBe(
      false,
    );
  });
});

/**
 * A deadline, named by its day.
 *
 * Formatted in the school's timezone rather than the reader's, which is the point of the case
 * spanning the daylight-saving change: the same wall-clock deadline is a different UTC instant in
 * March than in November, and a student in Brooklyn must read both as 11:59 PM.
 */
describe("formatDueDate", () => {
  it("leads with the weekday", () => {
    // 2026-10-10T03:59Z is 11:59 PM on Friday 9 October in New York.
    expect(formatDueDate(new Date("2026-10-10T03:59:00Z"))).toBe("Friday, Oct 9 at 11:59 PM");
  });

  it("reads the same either side of the clocks changing", () => {
    // Eastern Daylight Time, UTC-4.
    expect(formatDueDate(new Date("2026-10-02T03:59:00Z"))).toBe("Thursday, Oct 1 at 11:59 PM");
    // Eastern Standard Time, UTC-5. One hour further from UTC, same local deadline.
    expect(formatDueDate(new Date("2026-12-04T04:59:00Z"))).toBe("Thursday, Dec 3 at 11:59 PM");
  });

  it("has an em dash for no deadline", () => {
    expect(formatDueDate(null)).toBe("—");
    expect(formatDueDate(undefined)).toBe("—");
  });
});

/**
 * The site a submitted link goes to, and whether it may be turned into an anchor at all.
 *
 * The refusals are the reason this is tested rather than inlined. `submittedUrl` is a string a
 * student typed and an instructor later clicks from a signed-in page, so the scheme check is a
 * security boundary and not formatting.
 */
describe("linkHost", () => {
  it("names the host", () => {
    expect(linkHost("https://docs.google.com/document/d/abc/edit")).toBe("docs.google.com");
    expect(linkHost("http://example.org/path")).toBe("example.org");
  });

  it("drops www, which distinguishes nothing anybody is checking for", () => {
    expect(linkHost("https://www.canva.com/design/DAF123/view")).toBe("canva.com");
  });

  it("keeps a port and a subdomain, which do distinguish something", () => {
    expect(linkHost("https://staging.example.com:8443/x")).toBe("staging.example.com:8443");
  });

  // The case this exists for: it parses as a URL, and it is a script that would run on whoever
  // clicked it — on a page already signed in as an instructor.
  it("refuses javascript:", () => {
    expect(linkHost("javascript:alert(1)")).toBeNull();
    expect(linkHost("JavaScript:alert(1)")).toBeNull();
  });

  it("refuses the other schemes a link has no business using", () => {
    expect(linkHost("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(linkHost("file:///etc/passwd")).toBeNull();
    expect(linkHost("vbscript:msgbox(1)")).toBeNull();
  });

  // The ordinary mistake rather than the alarming one: a path or a filename pasted into a box
  // that asked for a link.
  it("answers null for anything that is not a URL", () => {
    expect(linkHost("")).toBeNull();
    expect(linkHost("my-essay.docx")).toBeNull();
    expect(linkHost("docs.google.com/document/d/abc")).toBeNull();
    expect(linkHost("   ")).toBeNull();
  });
});
