import {
  commentDmText,
  courseGradingLines,
  courseHeading,
  OUTSTANDING_HEADING,
  summaryWorkLine,
  upcomingSummary,
  commentsDigestLine,
  digestDm,
  escapeMrkdwn,
  feedbackDigestLine,
  feedbackDmText,
} from "@/lib/notifications/messages";

describe("escapeMrkdwn", () => {
  it("escapes the three characters Slack treats as markup control", () => {
    expect(escapeMrkdwn('Arrays & <objects>, a "quote"')).toBe(
      'Arrays &amp; &lt;objects&gt;, a "quote"',
    );
  });
});

describe("feedbackDmText", () => {
  const args = {
    assignmentTitle: "Loops & Iteration",
    courseName: "Mod 1",
    finalScore: 25,
    finalScorePossible: 30,
    isComplete: true,
    href: "https://lms.example.org/courses/c1?assignment=a1",
  };

  it("says the score, the verdict, and where to read it", () => {
    const text = feedbackDmText(args);
    expect(text).toContain("Loops &amp; Iteration");
    expect(text).toContain("25/30 — Complete");
    expect(text).toContain("<https://lms.example.org/courses/c1?assignment=a1|Read it here>");
  });

  it("below the threshold reads as not yet complete", () => {
    expect(feedbackDmText({ ...args, isComplete: false })).toContain("Not yet complete");
  });

  it("carries no link when the deployment has no address", () => {
    const text = feedbackDmText({ ...args, href: null });
    expect(text).not.toContain("<http");
    expect(text).toContain("Read it here");
  });
});

describe("commentDmText", () => {
  it("names the author and quotes the excerpt", () => {
    const text = commentDmText({
      authorName: "Maya",
      assignmentTitle: "Loops",
      excerpt: "What does reduce return here?",
      href: null,
    });
    expect(text).toContain("Maya commented on *Loops*");
    expect(text).toContain("What does reduce return here?");
  });
});

describe("digest lines and the digest itself", () => {
  /*
    Grouped by course, because a reader acts on one course at a time. The first version totalled
    every course into one list under a heading naming them all, which read as though every line
    belonged to every course.
  */
  it("gathers its lines under a heading per course and counts them all", () => {
    const dm = digestDm([
      {
        courseName: "Mod 1: JavaScript",
        lines: [
          feedbackDigestLine({
            assignmentTitle: "Arrays and Loops",
            finalScore: 17,
            finalScorePossible: 20,
            isComplete: true,
            href: null,
          }),
          commentsDigestLine({
            count: 2,
            assignmentTitle: "Higher Order Functions",
            newestExcerpt: "Take another look at the second case",
            href: null,
          }),
        ],
      },
      {
        courseName: "Mod 2: React",
        lines: [
          feedbackDigestLine({
            assignmentTitle: "State and Props",
            finalScore: 12,
            finalScorePossible: 20,
            isComplete: false,
            href: null,
          }),
        ],
      },
    ]);

    expect(dm).toContain("3 updates");
    expect(dm).toContain("*Mod 1: JavaScript*");
    expect(dm).toContain("*Mod 2: React*");
    expect(dm).toContain("17/20 — Complete");
    expect(dm).toContain("12/20 — Not yet complete");
    expect(dm).toContain("2 new comments on Higher Order Functions");
    // The course is on its heading and not repeated on every line beneath it.
    expect(dm).not.toContain("(Mod 1: JavaScript)");
  });

  it("one update is singular", () => {
    expect(digestDm([{ courseName: "Mod 1", lines: ["• something"] }])).toContain("1 update:");
    expect(
      commentsDigestLine({ count: 1, assignmentTitle: "T", newestExcerpt: "x", href: null }),
    ).toContain("1 new comment on");
  });

  it("a course heading is bold", () => {
    expect(courseHeading("Mod 1: JavaScript")).toBe("*Mod 1: JavaScript*");
  });
});

describe("summary messages", () => {
  it("the heading stands alone above the per-course briefs", () => {
    expect(OUTSTANDING_HEADING).toBe("Waiting on you");
  });

  /*
    Each course carries its own count, its own scope and its own link. An instructor on two
    programmes has a cohort selection for each, and the first version joined those scopes into one
    phrase above one total — which read as though both applied to all of the work.
  */
  it("a course brief names its own count, scope and link", () => {
    const lines = courseGradingLines({
      courseName: "Software Engineering",
      count: 17,
      scope: "Telos - Maxwell/Ben",
      cohorts: [{ name: "Telos - Maxwell/Ben", count: 17 }],
      href: "https://lms.example.org/instructor/courses/c1/triage",
    });

    expect(lines[0]).toBe("*Software Engineering* — 17 to grade · Telos - Maxwell/Ben");
    // One cohort, so the breakdown would only repeat the scope already on the line above.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("<https://lms.example.org/instructor/courses/c1/triage|Open triage>");
  });

  it("the cohort breakdown appears only where one course spans several", () => {
    const lines = courseGradingLines({
      courseName: "Software Engineering",
      count: 17,
      scope: "All Fellows",
      cohorts: [
        { name: "Telos - Maxwell/Ben", count: 9 },
        { name: "Odyssey - Sam", count: 8 },
      ],
      href: null,
    });

    expect(lines[1]).toBe("• Telos - Maxwell/Ben — 9");
    expect(lines[2]).toBe("• Odyssey - Sam — 8");
    expect(lines.at(-1)).toBe("Open triage");
  });

  /*
    The headings state what the list holds and nothing about what the reader ought to feel. A
    fellow who is behind already knows, and a summary that scolds is one people switch off.
  */
  it("a fellow's headings state the contents without urging anything", () => {
    expect(upcomingSummary({ kind: "overdue", count: 2 })).toBe("*Overdue* — 2");
    expect(upcomingSummary({ kind: "upcoming", count: 3 })).toBe("*Due in the next 7 days* — 3");
  });

  it("a line of work names the assignment, the course, and when it is wanted", () => {
    const line = summaryWorkLine({
      title: "Arrays & Loops",
      courseName: "Mod 1",
      dueAt: new Date("2026-05-19T23:59:00Z"),
      href: null,
    });
    expect(line).toContain("Arrays &amp; Loops");
    expect(line).toContain("(Mod 1)");
    expect(line).toContain("due");
  });

  it("work with no deadline says nothing about when", () => {
    expect(
      summaryWorkLine({ title: "Reading", courseName: "Mod 1", dueAt: null, href: null }),
    ).not.toContain("due");
  });
});
