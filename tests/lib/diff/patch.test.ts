import {
  changedRanges,
  diffLinePair,
  parseUnifiedPatch,
  previewChanges,
  truncateAtHunkBoundary,
} from "@/lib/diff/patch";

/**
 * The unified diff parser.
 *
 * Two things have to hold. The line numbers, because a diff whose gutter is off by one is worse
 * than no gutter — an instructor citing a line in feedback would cite the wrong one. And the rule
 * that GitHub's per-file patch has no file header, so a content line beginning `+++` is content:
 * that is the case a general-purpose diff parser gets wrong, and the case somebody "fixing" this
 * one would reintroduce.
 */

/** Two hunks, an add, a remove, context, and a section suffix on the second header. */
const TWO_HUNKS = [
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  "@@ -20,2 +21,2 @@ function useThing() {",
  "   const e = 6;",
  "-  return e;",
  "+  return e + 1;",
].join("\n");

describe("parseUnifiedPatch", () => {
  it("reads every line of a two-hunk patch with its numbers on both sides", () => {
    const { hunks, unparsed } = parseUnifiedPatch(TWO_HUNKS);

    expect(unparsed).toEqual([]);
    expect(hunks).toHaveLength(2);

    expect(hunks[0].lines).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, text: "const a = 1;", noNewlineAtEof: false },
      { kind: "remove", oldLine: 2, newLine: null, text: "const b = 2;", noNewlineAtEof: false },
      { kind: "add", oldLine: null, newLine: 2, text: "const b = 3;", noNewlineAtEof: false },
      { kind: "add", oldLine: null, newLine: 3, text: "const c = 4;", noNewlineAtEof: false },
      { kind: "context", oldLine: 3, newLine: 4, text: "const d = 5;", noNewlineAtEof: false },
    ]);

    // The second hunk restarts at its own numbers rather than continuing the first's.
    expect(hunks[1].lines.map((line) => [line.oldLine, line.newLine])).toEqual([
      [20, 21],
      [21, null],
      [null, 22],
    ]);
  });

  /*
    The one test that catches nearly every off-by-one on its own, and the one the verify script
    runs against real GitHub output: a hunk header states how many lines each side has, so the
    lines carrying a number on that side must come to exactly that many.
  */
  it("emits exactly as many numbered lines per side as the header promises", () => {
    for (const hunk of parseUnifiedPatch(TWO_HUNKS).hunks) {
      expect(hunk.lines.filter((line) => line.oldLine !== null)).toHaveLength(hunk.oldCount);
      expect(hunk.lines.filter((line) => line.newLine !== null)).toHaveLength(hunk.newCount);
    }
  });

  describe("the hunk header", () => {
    it("defaults an omitted count to one", () => {
      const [hunk] = parseUnifiedPatch("@@ -1 +1 @@\n-a\n+b").hunks;
      expect([hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount]).toEqual([1, 1, 1, 1]);
    });

    it("reads a zero count without producing a line number on that side", () => {
      // A new file: nothing on the base side at all.
      const [hunk] = parseUnifiedPatch("@@ -0,0 +1,3 @@\n+a\n+b\n+c").hunks;
      expect([hunk.oldStart, hunk.oldCount]).toEqual([0, 0]);
      expect(hunk.lines.every((line) => line.oldLine === null)).toBe(true);
      expect(hunk.lines.map((line) => line.newLine)).toEqual([1, 2, 3]);
    });

    it("keeps the section suffix, and the header verbatim", () => {
      const [, second] = parseUnifiedPatch(TWO_HUNKS).hunks;
      expect(second.section).toBe("function useThing() {");
      expect(second.header).toBe("@@ -20,2 +21,2 @@ function useThing() {");
    });

    it("reads no section as null rather than as an empty string", () => {
      expect(parseUnifiedPatch(TWO_HUNKS).hunks[0].section).toBeNull();
    });
  });

  describe("`\\ No newline at end of file`", () => {
    /*
      Git emits it twice when a file's last line changes — once after the removed version and once
      after the added one — which is why it attaches to the preceding line rather than to the
      hunk. It is an annotation, so it must not become a line of the file or move a counter.
    */
    it("flags the line before it, both times it appears, and emits nothing", () => {
      const patch = [
        "@@ -1,2 +1,2 @@",
        " keep",
        "-old last",
        "\\ No newline at end of file",
        "+new last",
        "\\ No newline at end of file",
      ].join("\n");

      const [hunk] = parseUnifiedPatch(patch).hunks;
      expect(hunk.lines).toHaveLength(3);
      expect(hunk.lines.map((line) => [line.kind, line.noNewlineAtEof])).toEqual([
        ["context", false],
        ["remove", true],
        ["add", true],
      ]);
      expect(hunk.lines.filter((line) => line.oldLine !== null)).toHaveLength(hunk.oldCount);
      expect(hunk.lines.filter((line) => line.newLine !== null)).toHaveLength(hunk.newCount);
    });
  });

  /*
    The rule this parser exists for. GitHub's per-file patch starts at the first `@@`, so these are
    content and not headers — and a parser that "handled" them would drop a line of a student's
    README without a trace.
  */
  describe("a content line that looks like a file header", () => {
    it("reads `+++ b/README.md` as an added line", () => {
      const [hunk] = parseUnifiedPatch("@@ -1,0 +1,1 @@\n+++ b/README.md").hunks;
      expect(hunk.lines[0]).toEqual({
        kind: "add",
        oldLine: null,
        newLine: 1,
        text: "++ b/README.md",
        noNewlineAtEof: false,
      });
    });

    it("reads `--- a/README.md` as a removed line", () => {
      const [hunk] = parseUnifiedPatch("@@ -1,1 +1,0 @@\n--- a/README.md").hunks;
      expect(hunk.lines[0]).toEqual({
        kind: "remove",
        oldLine: 1,
        newLine: null,
        text: "-- a/README.md",
        noNewlineAtEof: false,
      });
    });
  });

  describe("whitespace nobody can see", () => {
    it("keeps a content line's carriage return, so a line-ending commit is legible", () => {
      const [hunk] = parseUnifiedPatch("@@ -1,1 +1,1 @@\n-const a = 1;\r\n+const a = 1;").hunks;
      expect(hunk.lines[0].text).toBe("const a = 1;\r");
      expect(hunk.lines[1].text).toBe("const a = 1;");
    });

    it("still reads a hunk header that ends in one", () => {
      const { hunks } = parseUnifiedPatch("@@ -1,1 +1,1 @@\r\n-a\n+b");
      expect(hunks).toHaveLength(1);
      expect(hunks[0].header).toBe("@@ -1,1 +1,1 @@");
    });

    it("reads an empty line inside a hunk as an empty context line", () => {
      // Git writes it as a single space; anything that trims trailing whitespace drops that.
      const [hunk] = parseUnifiedPatch("@@ -1,3 +1,3 @@\n a\n\n b").hunks;
      expect(hunk.lines[1]).toEqual({
        kind: "context",
        oldLine: 2,
        newLine: 2,
        text: "",
        noNewlineAtEof: false,
      });
      expect(hunk.lines[2].oldLine).toBe(3);
    });

    it("drops the empty string a patch ending in a newline splits to", () => {
      expect(parseUnifiedPatch("@@ -1,1 +1,1 @@\n-a\n+b\n").hunks[0].lines).toHaveLength(2);
    });
  });

  describe("what it never throws on", () => {
    it("reads an empty patch as no hunks, which is a rename with no content change", () => {
      expect(parseUnifiedPatch("")).toEqual({ hunks: [], unparsed: [] });
    });

    it("keeps anything before the first hunk rather than failing on it", () => {
      const { hunks, unparsed } = parseUnifiedPatch(
        "diff --git a/x b/x\nindex 0000000..1111111\n@@ -1,1 +1,1 @@\n-a\n+b",
      );
      expect(unparsed).toEqual(["diff --git a/x b/x", "index 0000000..1111111"]);
      expect(hunks).toHaveLength(1);
    });
  });
});

describe("truncateAtHunkBoundary", () => {
  it("returns a patch that already fits, unchanged", () => {
    expect(truncateAtHunkBoundary(TWO_HUNKS, 10_000)).toBe(TWO_HUNKS);
  });

  /*
    The contract between the two functions, asserted rather than described: whatever comes back
    parses, and its last hunk is whole. Without this, "cut at a hunk boundary" is a comment.
  */
  it("cuts to whole hunks, and what it returns parses cleanly", () => {
    const cut = truncateAtHunkBoundary(TWO_HUNKS, 100);
    const { hunks, unparsed } = parseUnifiedPatch(cut);

    expect(hunks).toHaveLength(1);
    expect(unparsed).toEqual([]);
    for (const hunk of hunks) {
      expect(hunk.lines.filter((line) => line.oldLine !== null)).toHaveLength(hunk.oldCount);
      expect(hunk.lines.filter((line) => line.newLine !== null)).toHaveLength(hunk.newCount);
    }
  });

  it("returns nothing when even the first hunk is too large", () => {
    // Rendered as the same "open it on GitHub" state a binary file gets, so one state serves both.
    expect(truncateAtHunkBoundary(TWO_HUNKS, 5)).toBe("");
  });

  it("measures bytes rather than characters", () => {
    // Four characters, and more than four bytes of UTF-8, so a character count would keep it.
    const wide = "@@ -1,1 +1,1 @@\n+💥💥💥💥";
    expect(truncateAtHunkBoundary(wide, 20)).toBe("");
  });
});

describe("changedRanges", () => {
  /** The ranges for a patch, which is how the renderer asks for them. */
  const rangesOf = (patch: string) => changedRanges(parseUnifiedPatch(patch).hunks);

  it("marks the one word that changed on a replaced line, and nothing around it", () => {
    const ranges = rangesOf(
      "@@ -1,2 +1,2 @@\n-if attackerRef.isEmpty:\n+if attackerRef.nonALive:\n     pass",
    );
    expect(ranges).toEqual([[{ start: 15, end: 22 }], [{ start: 15, end: 23 }], []]);
    expect("if attackerRef.isEmpty:".slice(15, 22)).toBe("isEmpty");
    expect("if attackerRef.nonALive:".slice(15, 23)).toBe("nonALive");
  });

  it("marks nothing on the side a pure insertion added nothing to", () => {
    expect(rangesOf("@@ -1,1 +1,1 @@\n-x < 10\n+x <= 10")).toEqual([[], [{ start: 3, end: 4 }]]);
  });

  it("pairs the nth removed line with the nth added line in a run", () => {
    const ranges = rangesOf(
      "@@ -1,2 +1,2 @@\n-const a = 1;\n-const b = 2;\n+const a = 9;\n+const b = 8;",
    );
    expect(ranges).toEqual([
      [{ start: 10, end: 11 }],
      [{ start: 10, end: 11 }],
      [{ start: 10, end: 11 }],
      [{ start: 10, end: 11 }],
    ]);
  });

  it("pairs a line in a run of unequal length with the next added line that shares half its words", () => {
    // An edited paragraph followed by a new one: the edit is paired, the new paragraph is not.
    expect(
      rangesOf("@@ -1,1 +1,3 @@\n-the answer is ten\n+the answer is twelve\n+\n+A new paragraph."),
    ).toEqual([[{ start: 14, end: 17 }], [{ start: 14, end: 20 }], [], []]);
  });

  it("pairs a line in a run of unequal length with the closest added line, not the first close one", () => {
    expect(rangesOf("@@ -1,1 +1,2 @@\n-const b = 2;\n+const a = 9;\n+const b = 3;")).toEqual([
      [{ start: 10, end: 11 }],
      [],
      [{ start: 10, end: 11 }],
    ]);
  });

  it("leaves a line in a run of unequal length unpaired when no added line is close to it", () => {
    expect(rangesOf("@@ -1,1 +1,2 @@\n-return total;\n+throw new Error(x);\n+exit(1);")).toEqual([
      [],
      [],
      [],
    ]);
  });

  it("marks nothing on a line rewritten rather than edited", () => {
    expect(rangesOf("@@ -1,1 +1,1 @@\n-return total;\n+throw new Error(x);")).toEqual([[], []]);
  });

  it("does not count shared indentation toward the half a line must share", () => {
    expect(rangesOf("@@ -1,1 +1,1 @@\n-        return foo;\n+        x = bar();")).toEqual([
      [],
      [],
    ]);
  });

  it("marks exactly the carriage return on a line whose only change is its ending", () => {
    expect(rangesOf("@@ -1,1 +1,1 @@\n-const a = 1;\r\n+const a = 1;")).toEqual([
      [{ start: 12, end: 13 }],
      [],
    ]);
  });

  it("never pairs a removed line at the end of one hunk with an added line opening the next", () => {
    expect(rangesOf("@@ -1,1 +1,0 @@\n-const a = 1;\n@@ -9,0 +8,1 @@\n+const a = 2;")).toEqual([
      [],
      [],
    ]);
  });

  it("keeps one entry per line, in render order, around context and lone additions", () => {
    const ranges = rangesOf("@@ -1,3 +1,4 @@\n a\n-b = 1\n+b = 2\n+c\n d");
    expect(ranges).toHaveLength(5);
  });
});

/*
  Two lines a fellow edited in a short response, between the commit their first review graded and
  the commit they resubmitted. Each was edited in more than one place, which is the case a single
  marked stretch per line could not describe.
*/
const ANSWER_BEFORE =
  "Your response here...A function is like a machine that you give information with which it " +
  "does a specific task and delivers and outcome and the technical definition of a function is " +
  "a series of statements which returns some value to a caller";
const ANSWER_AFTER =
  "A function is like a machine that you give information with which it does a specific task " +
  "and delivers an outcome and the technical definition of a function is a series of statements " +
  "which returns some value to a caller";
const EXPLANATION_BEFORE =
  'Your explanation of the example here...The string variable name is set to "Zo" as the base ' +
  "name we wan't to use. Then the greet function is created with the parameter person. Inside " +
  'the function a f string is used to create a sentence using that parameter and the greeting "Hello".Then this sentence is returned.';
const EXPLANATION_AFTER =
  'The string variable name is set to "Zo" as the base name we want to use. Then the greet ' +
  "function is created with the parameter person. Inside the function a f string is used to " +
  'create a sentence using that parameter and the greeting "Hello". Then this sentence is returned.';

/** The text of each range, which is what a reader sees marked. */
const textsOf = (line: string, ranges: { start: number; end: number }[]) =>
  ranges.map((range) => line.slice(range.start, range.end));

describe("diffLinePair", () => {
  it("marks every edit on a line edited in two places, word by word", () => {
    const diff = diffLinePair(ANSWER_BEFORE, ANSWER_AFTER);
    expect(diff).not.toBeNull();
    expect(textsOf(ANSWER_BEFORE, diff!.removed)).toEqual(["Your response here...", "and"]);
    expect(textsOf(ANSWER_AFTER, diff!.added)).toEqual(["an"]);
  });

  it("places each removed passage where it stood in the new line, before its replacement", () => {
    const diff = diffLinePair(ANSWER_BEFORE, ANSWER_AFTER)!;
    const at = ANSWER_AFTER.indexOf("an outcome");
    expect(diff.deletions).toEqual([
      { at: 0, text: "Your response here..." },
      { at, text: "and" },
    ]);
    expect(diff.added[0].start).toBe(at);
  });

  it("compares whole words and lone punctuation, as GitHub's code view does", () => {
    const diff = diffLinePair(EXPLANATION_BEFORE, EXPLANATION_AFTER)!;
    expect(textsOf(EXPLANATION_BEFORE, diff.removed)).toEqual([
      "Your explanation of the example here...",
      "wan't",
    ]);
    // The space added after `"Hello".` is the whole of the third edit.
    expect(textsOf(EXPLANATION_AFTER, diff.added)).toEqual(["want", " "]);
  });

  it("joins two changes across the spaces between them rather than marking each word apart", () => {
    const diff = diffLinePair(
      "we went to the big red shop today",
      "we went to a small blue shop today",
    )!;
    expect(textsOf("we went to a small blue shop today", diff.added)).toEqual(["a small blue"]);
    expect(diff.deletions).toEqual([{ at: 11, text: "the big red" }]);
  });

  it("answers null for two identical lines", () => {
    expect(diffLinePair("same", "same")).toBeNull();
  });
});

describe("previewChanges", () => {
  const changesOf = (patch: string) => previewChanges(parseUnifiedPatch(patch).hunks);

  it("records an edited line with its added words and its removed passages", () => {
    const changes = changesOf(`@@ -33,1 +33,1 @@\n-${ANSWER_BEFORE}\n+${ANSWER_AFTER}`);
    expect([...changes.addedLines]).toEqual([]);
    expect(changes.editedLines.get(33)?.deletions.map((d) => d.text)).toEqual([
      "Your response here...",
      "and",
    ]);
  });

  it("counts a lone added line and a rewritten line as wholly new", () => {
    const changes = changesOf(
      "@@ -1,2 +1,3 @@\n-return total;\n+throw new Error(x);\n+A new paragraph.\n context",
    );
    expect([...changes.addedLines]).toEqual([1, 2]);
    expect(changes.editedLines.size).toBe(0);
  });

  it("leaves out a line whose only change is trailing spaces an editor trimmed", () => {
    const changes = changesOf("@@ -1,1 +1,1 @@\n-## Question 1  \n+## Question 1");
    expect(changes.editedLines.size).toBe(0);
    expect(changes.addedLines.size).toBe(0);
  });

  it("leaves out a removed passage of nothing but whitespace, which cannot be seen struck through", () => {
    const changes = changesOf('@@ -1,1 +1,1 @@\n-said "Hello".  Then\n+said "Hello". Then');
    expect(changes.editedLines.get(1)?.deletions).toEqual([]);
  });
});
