import { assignmentMaterial, formatSections, redactTurns } from "@/lib/tutor/context";

// The module also reads GitHub, through packages the unit runner does not load; nothing here does.
jest.mock("../../../lib/github/app-client", () => ({ getConfiguredInstallationId: jest.fn() }));
jest.mock("../../../lib/github/files", () => ({ fetchRepoFile: jest.fn() }));

describe("formatSections", () => {
  it("writes each section under its lesson and heading, with its code fenced", () => {
    expect(
      formatSections([
        {
          slug: "mod-1/6-loops",
          title: "1.6 Loops",
          moduleTitle: "1. Python Fundamentals",
          heading: "While Loops",
          anchor: "while-loops",
          text: "A while loop repeats.",
          code: "while x < 3:\n    x += 1",
        },
        {
          slug: "mod-1/7-lists",
          title: "1.7 Lists",
          moduleTitle: "1. Python Fundamentals",
          heading: "Indexing",
          anchor: "indexing",
          text: "",
          code: "items[0]",
        },
      ]),
    ).toBe(
      [
        "### 1. Python Fundamentals › 1.6 Loops › While Loops",
        "A while loop repeats.",
        "```",
        "while x < 3:\n    x += 1",
        "```",
        "",
        "### 1. Python Fundamentals › 1.7 Lists › Indexing",
        "```",
        "items[0]",
        "```",
      ].join("\n"),
    );
  });
});

describe("assignmentMaterial", () => {
  it("holds the title, the instructions and the README, and says when there are none", () => {
    expect(
      assignmentMaterial({ title: "Task Manager", submissionInstructions: "Push it." }, "# README"),
    ).toBe("# Task Manager\n\n## Instructions\n\nPush it.\n\n## README\n\n# README");
    expect(assignmentMaterial({ title: "Task", submissionInstructions: null }, null)).toBe(
      "# Task\n\nThe assignment has no written instructions.",
    );
  });
});

describe("redactTurns", () => {
  const names = {
    fellow: { displayName: "Maria Lopez", email: "maria@example.test", githubUsername: "mlopez" },
    others: [],
  };

  it("replaces the fellow's whole name and login in every turn, and leaves a part alone", () => {
    const { turns, restore } = redactTurns(
      ["I'm Maria Lopez, is this right?", "Maria Lopez, yes.", "Thanks! mlopez here again."],
      names,
    );
    expect(turns).toEqual([
      "I'm the fellow, is this right?",
      "the fellow, yes.",
      "Thanks! the fellow here again.",
    ]);
    expect(restore("Thanks, the fellow.")).toBe("Thanks, the fellow.");

    // A part of a name is as often an ordinary word, and hiding it would change the question.
    const will = {
      fellow: { displayName: "Will Grace", email: null, githubUsername: null },
      others: [],
    };
    expect(redactTurns(["Will this loop run? Is there a grace period?"], will).turns).toEqual([
      "Will this loop run? Is there a grace period?",
    ]);
  });

  it("leaves the words a coaching record would hide, which here are about code as often as not", () => {
    const { turns } = redactTurns(["Is it legal to reassign a const? A court case."], names);
    expect(turns).toEqual(["Is it legal to reassign a const? A court case."]);
  });
});
