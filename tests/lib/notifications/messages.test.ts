import {
  commentDmText,
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
