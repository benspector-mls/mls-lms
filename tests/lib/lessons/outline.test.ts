import {
  extractSections,
  hasOnlyTitle,
  headingSlugger,
  inlineGitbookTags,
  lessonHeadings,
  lessonImagePaths,
  resolveRepoPath,
  unknownGitbookTags,
  withoutFrontMatter,
} from "@/lib/lessons/outline";

describe("headingSlugger", () => {
  it("gives the fragments the lessons' own tables of contents link to", () => {
    const slug = headingSlugger();
    // Each of these is linked from "1.6 Loops" or another lesson by exactly this fragment.
    expect(slug("The for loop")).toBe("the-for-loop");
    expect(slug("Looping a Number of Times with range()")).toBe(
      "looping-a-number-of-times-with-range",
    );
    expect(slug("Guidelines & Policies")).toBe("guidelines--policies");
    expect(slug("C — Code!")).toBe("c--code");
    expect(slug("__init__ Gives Every Instance the Same Shape")).toBe(
      "__init__-gives-every-instance-the-same-shape",
    );
  });

  it("numbers a repeated heading from the second time it appears", () => {
    const slug = headingSlugger();
    expect([slug("Summary"), slug("Summary"), slug("Summary")]).toEqual([
      "summary",
      "summary-1",
      "summary-2",
    ]);
  });

  it("skips a number another heading already has, so no two headings share an id", () => {
    const slug = headingSlugger();
    expect([slug("Question 1"), slug("Question"), slug("Question")]).toEqual([
      "question-1",
      "question",
      "question-2",
    ]);
  });
});

describe("lessonHeadings", () => {
  it("reads headings as the page shows them, and skips lines inside code", () => {
    const markdown = [
      "# 1.6 Loops",
      "## The `for` loop",
      "```python",
      "# not a heading",
      "```",
      "### [Break](#break)",
    ].join("\n");

    expect(lessonHeadings(markdown)).toEqual([
      { level: 1, text: "1.6 Loops", anchor: "16-loops" },
      { level: 2, text: "The for loop", anchor: "the-for-loop" },
      { level: 3, text: "Break", anchor: "break" },
    ]);
  });

  it("reads a heading inside a blockquote, which the page renders as a heading too", () => {
    expect(lessonHeadings("> # Title of the Document\n## Bold").map((h) => h.anchor)).toEqual([
      "title-of-the-document",
      "bold",
    ]);
  });

  it("skips the lines of a code block inside a blockquote", () => {
    const markdown = ["> ```python", "> # compute the area", "> ```", "## After"].join("\n");
    expect(lessonHeadings(markdown).map((heading) => heading.text)).toEqual(["After"]);
  });

  it("keeps a backtick fence open past a tilde line inside it", () => {
    const markdown = ["```", "~~~", "# still code", "```", "## After"].join("\n");
    expect(lessonHeadings(markdown).map((heading) => heading.text)).toEqual(["After"]);
  });
});

describe("extractSections", () => {
  it("cuts at ## and ### headings and keeps the introduction under the title", () => {
    const markdown = [
      "# 1.6 Loops",
      "",
      '{% hint style="info" %}',
      "Iteration repeats a process.",
      "{% endhint %}",
      "",
      "## While Loops",
      "",
      "A <kbd>Ctrl</kbd> loop.",
      "",
      "```python",
      "while True:",
      "```",
      "",
      "#### A small heading stays in its section",
      "### Break",
      "Stops early.",
    ].join("\n");

    expect(extractSections(markdown)).toEqual([
      {
        heading: "1.6 Loops",
        anchor: "16-loops",
        text: "Iteration repeats a process.",
        code: "",
        position: 0,
      },
      {
        heading: "While Loops",
        anchor: "while-loops",
        text: "A Ctrl loop. A small heading stays in its section",
        code: "while True:",
        position: 1,
      },
      { heading: "Break", anchor: "break", text: "Stops early.", code: "", position: 2 },
    ]);
  });

  it("keeps a section's code apart: its fenced code, then each inline span once", () => {
    const markdown = [
      "## The `for` loop",
      "Use `for` with `range(3)` for example.",
      "```python",
      "for i in range(3):",
      "    print(i)",
      "```",
    ].join("\n");

    expect(extractSections(markdown)).toEqual([
      {
        heading: "The for loop",
        anchor: "the-for-loop",
        text: "Use `for` with `range(3)` for example.",
        code: "for i in range(3):\n    print(i)\nfor\nrange(3)",
        position: 0,
      },
    ]);
  });
});

describe("resolveRepoPath", () => {
  it("reads a path from the lesson's folder", () => {
    expect(resolveRepoPath("mod-0/2-git.md", "../.gitbook/assets/local-git.png")).toBe(
      ".gitbook/assets/local-git.png",
    );
    expect(resolveRepoPath("mod-1/6-loops.md", "./img/a%20b.png")).toBe("mod-1/img/a b.png");
    expect(resolveRepoPath("README.md", "mod-1/README.md")).toBe("mod-1/README.md");
  });

  it("refuses a path that climbs above the repository", () => {
    expect(resolveRepoPath("mod-1/6-loops.md", "../../secret.png")).toBeNull();
  });
});

describe("lessonImagePaths", () => {
  it("finds markdown and HTML images in the repository and leaves other sites out", () => {
    const markdown = [
      "![](../.gitbook/assets/local-git.png)",
      '![A commit](../.gitbook/assets/commit-history.png "A title")',
      '<img src="img/sr.png" width="375">',
      "![](<../.gitbook/assets/merge-conflict (1).png>)",
      "![](../.gitbook/assets/image%20(2).png)",
      "![](https://example.com/elsewhere.png)",
      "```",
      "![](../in-code.png)",
      "```",
    ].join("\n");

    expect(lessonImagePaths("mod-0/2-git.md", markdown)).toEqual([
      ".gitbook/assets/local-git.png",
      ".gitbook/assets/commit-history.png",
      "mod-0/img/sr.png",
      ".gitbook/assets/merge-conflict (1).png",
      ".gitbook/assets/image (2).png",
    ]);
  });
});

describe("unknownGitbookTags", () => {
  it("names the blocks the page cannot draw, once each", () => {
    const markdown = [
      '{% hint style="info" %}',
      "{% endhint %}",
      "{% tabs %}",
      '{% tab title="Mac" %}',
      "{% tabs %}",
    ].join("\n");
    expect(unknownGitbookTags(markdown)).toEqual(["tabs", "tab"]);
  });

  it("reads a hyphenated name whole, and ignores a tag written inside code", () => {
    const markdown = ['{% content-ref url="x.md" %}', "Write `{% tabs %}` to start tabs."].join(
      "\n",
    );
    expect(unknownGitbookTags(markdown)).toEqual(["content-ref"]);
  });
});

describe("withoutFrontMatter", () => {
  it("removes the settings block GitBook keeps at the top of a page, and nothing else", () => {
    const page = "---\ncover: a.png\nlayout:\n  width: default\n---\n\n# Welcome\n\n---\n";
    expect(withoutFrontMatter(page)).toBe("\n# Welcome\n\n---\n");
    expect(withoutFrontMatter("# Welcome\n\n---\nText")).toBe("# Welcome\n\n---\nText");
  });
});

describe("inlineGitbookTags", () => {
  it("names a known tag that shares its line with text, and not one alone on its line", () => {
    const markdown = [
      '{% hint style="info" %}A short note{% endhint %}',
      '{% hint style="warning" %}',
      "On its own.",
      "{% endhint %}",
    ].join("\n");
    expect(inlineGitbookTags(markdown)).toEqual(["hint", "endhint"]);
  });

  it("does not report a tag shown as code in a sentence", () => {
    expect(inlineGitbookTags('Write `{% hint style="info" %}` to open a callout.')).toEqual([]);
  });
});

describe("hasOnlyTitle", () => {
  it("is true for a module page holding only its title, and false once it has words", () => {
    expect(hasOnlyTitle("# Mod 2 - Object-Oriented Programming\n\n")).toBe(true);
    expect(hasOnlyTitle("# Mod 2\n\nThis module covers classes.\n")).toBe(false);
    expect(hasOnlyTitle("# Mod 2\n\n## Overview\n")).toBe(false);
  });
});
