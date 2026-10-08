import {
  commentDmText,
  outstandingSummary,
  summaryCohortLine,
  summaryCourseLink,
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
  it("counts its updates and stacks one line per entry", () => {
    const lines = [
      feedbackDigestLine({
        assignmentTitle: "Loops",
        courseName: "Mod 1",
        finalScore: 12,
        finalScorePossible: 20,
        isComplete: false,
        href: null,
      }),
      commentsDigestLine({
        count: 3,
        assignmentTitle: "Objects",
        fellowName: "Jordan",
        newestExcerpt: "Still stuck on this one",
        href: null,
      }),
    ];

    const dm = digestDm(lines);
    expect(dm).toContain("2 updates");
    expect(dm).toContain("12/20 — Not yet complete");
    expect(dm).toContain("3 new comments from Jordan on Objects");
    expect(dm.split("\n")).toHaveLength(3);
  });

  it("one update is singular", () => {
    expect(digestDm(["• something"])).toContain("1 update:");
    expect(
      commentsDigestLine({ count: 1, assignmentTitle: "T", newestExcerpt: "x", href: null }),
    ).toContain("1 new comment on");
  });
});

describe("summary messages", () => {
  it("an instructor's heading names the scope and the size of the pile", () => {
    expect(outstandingSummary({ scope: "All Fellows", total: 23 })).toBe(
      "Waiting on you — All Fellows, 23 submissions to grade",
    );
    // Singular, because "1 submissions" is the kind of thing people notice and nothing else is.
    expect(outstandingSummary({ scope: "Cohort A", total: 1 })).toContain("1 submission to grade");
  });

  it("a cohort line carries its share, and the course links carry their counts", () => {
    expect(summaryCohortLine({ name: "Cohort A", count: 9 })).toBe("• Cohort A — 9");
    expect(
      summaryCourseLink([
        { name: "Mod 3", href: "https://lms.example.org/instructor/courses/c1/triage", count: 12 },
        { name: "Mod 4", href: null, count: 2 },
      ]),
    ).toBe(
      "Open triage: <https://lms.example.org/instructor/courses/c1/triage|Mod 3> (12) · Mod 4 (2)",
    );
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
