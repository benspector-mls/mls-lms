import { rehypeMarkChanged, rehypeMarkEdits } from "@/lib/markdown/mark-changed";

/**
 * Which blocks of a rendered Markdown file are shaded as the fellow's writing.
 *
 * The trees are built by hand with the line positions the parser would give them, so each case
 * names exactly which lines a block came from. A short response looks like the first case: the
 * template's question as a heading, the fellow's answer as a paragraph beneath it.
 */

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  children?: Node[];
  properties?: Record<string, unknown>;
  position?: { start: { line: number; offset?: number }; end: { line: number; offset?: number } };
};

function element(tagName: string, lines: [number, number], children: Node[] = []): Node {
  return {
    type: "element",
    tagName,
    children,
    properties: {},
    position: { start: { line: lines[0] }, end: { line: lines[1] } },
  };
}

function text(value: string): Node {
  return { type: "text", value };
}

function isMarked(node: Node | undefined): boolean {
  return node?.type === "element" && node.tagName === "div";
}

function mark(tree: Node, changed: number[]) {
  rehypeMarkChanged(new Set(changed))(tree);
  return tree;
}

describe("rehypeMarkChanged", () => {
  it("shades the answer and leaves the question beside it alone", () => {
    const question = element("h3", [1, 1], [text("Response 1")]);
    const answer = element("p", [3, 4], [text("A string is an iterable.")]);
    const tree: Node = { type: "root", children: [question, text("\n"), answer] };

    mark(tree, [4]);

    expect(tree.children?.[0]).toBe(question);
    expect(tree.children?.[1]).toEqual(text("\n"));
    expect(isMarked(tree.children?.[2])).toBe(true);
    expect(tree.children?.[2].children).toEqual([answer]);
  });

  it("shades a block on its first and its last line", () => {
    const answer = element("p", [3, 5]);
    expect(isMarked(mark({ type: "root", children: [answer] }, [3]).children?.[0])).toBe(true);

    const again = element("p", [3, 5]);
    expect(isMarked(mark({ type: "root", children: [again] }, [5]).children?.[0])).toBe(true);
  });

  it("does not shade a block that only borders a changed line", () => {
    const answer = element("p", [3, 5]);
    const tree = mark({ type: "root", children: [answer] }, [2, 6]);
    expect(tree.children?.[0]).toBe(answer);
  });

  it("shades only the list item that changed, not the whole list", () => {
    const ticked = element("li", [2, 2], [text("Addresses all parts of the prompt")]);
    const unticked = element("li", [3, 3], [text("Is easy to comprehend")]);
    const list = element("ul", [2, 3], [ticked, unticked]);
    const tree = mark({ type: "root", children: [list] }, [2]);

    // The list stays a list, so its items are still its children.
    expect(tree.children?.[0].tagName).toBe("ul");
    const [first, second] = tree.children?.[0].children ?? [];
    expect(first.tagName).toBe("li");
    expect(isMarked(first.children?.[0])).toBe(true);
    expect(first.children?.[0].children).toEqual([text("Addresses all parts of the prompt")]);
    expect(second).toBe(unticked);
  });

  it("spaces a top-level wrapper in place of its block, and leaves a list item's alone", () => {
    const tree = mark(
      {
        type: "root",
        children: [element("p", [1, 1]), element("ul", [3, 3], [element("li", [3, 3])])],
      },
      [1, 3],
    );

    const paragraphWrapper = tree.children?.[0];
    const itemWrapper = tree.children?.[1].children?.[0].children?.[0];
    expect(paragraphWrapper?.properties?.className).toEqual(
      expect.arrayContaining(["my-2", "*:my-0"]),
    );
    expect(itemWrapper?.properties?.className).not.toContain("my-2");
  });

  it("changes nothing when no line changed", () => {
    const answer = element("p", [1, 1]);
    const tree = mark({ type: "root", children: [answer] }, []);
    expect(tree.children).toEqual([answer]);
  });

  it("leaves a block with no position alone", () => {
    const unplaced: Node = { type: "element", tagName: "p", children: [] };
    const tree = mark({ type: "root", children: [unplaced] }, [1]);
    expect(tree.children?.[0]).toBe(unplaced);
  });
});

describe("rehypeMarkChanged on edited lines", () => {
  it("gives an edited block the margin bar and no shading", () => {
    const answer = element("p", [3, 3]);
    const tree: Node = { type: "root", children: [answer] };
    rehypeMarkChanged(new Set(), new Set([3]))(tree);

    const classes = tree.children?.[0].properties?.className as string[];
    expect(isMarked(tree.children?.[0])).toBe(true);
    expect(classes.join(" ")).toContain("border-amber-500/70");
    expect(classes.join(" ")).not.toContain("bg-emerald");
  });

  it("shades a block holding a wholly new line even when another of its lines was edited", () => {
    const answer = element("p", [3, 4]);
    const tree: Node = { type: "root", children: [answer] };
    rehypeMarkChanged(new Set([4]), new Set([3]))(tree);
    expect((tree.children?.[0].properties?.className as string[]).join(" ")).toContain(
      "bg-emerald",
    );
  });
});

/**
 * A paragraph as the parser gives it: the element on its line, and one run of text carrying the
 * offsets of that text in `source`.
 */
function paragraph(source: string, value: string, line: number): Node {
  const start = source.indexOf(value);
  return {
    type: "element",
    tagName: "p",
    properties: {},
    position: { start: { line, offset: start }, end: { line, offset: start + value.length } },
    children: [
      {
        type: "text",
        value,
        position: { start: { line, offset: start }, end: { line, offset: start + value.length } },
      },
    ],
  };
}

/** The paragraph's children as `[tag, text]` pairs, with `text` for an unmarked run. */
function runsOf(node: Node | undefined): [string, string][] {
  return (node?.children ?? []).map((child) =>
    child.type === "text"
      ? ["text", child.value ?? ""]
      : [child.tagName ?? "", child.children?.[0]?.value ?? ""],
  );
}

describe("rehypeMarkEdits", () => {
  const source = "### Response 1\n\nA function delivers an outcome to a caller\n";
  const answer = "A function delivers an outcome to a caller";

  it("marks the added word and puts the removed words back, struck through, where they stood", () => {
    const tree: Node = { type: "root", children: [paragraph(source, answer, 3)] };
    rehypeMarkEdits(
      source,
      new Map([
        [
          3,
          {
            added: [{ start: 20, end: 22 }],
            deletions: [
              { at: 0, text: "Your response here..." },
              { at: 20, text: "and" },
            ],
          },
        ],
      ]),
    )(tree);

    expect(runsOf(tree.children?.[0])).toEqual([
      ["del", "Your response here..."],
      ["text", "A function delivers "],
      ["del", "and"],
      ["ins", "an"],
      ["text", " outcome to a caller"],
    ]);
  });

  it("puts a passage removed from the end of a line after the last word", () => {
    const tree: Node = { type: "root", children: [paragraph(source, answer, 3)] };
    rehypeMarkEdits(
      source,
      new Map([[3, { added: [], deletions: [{ at: answer.length, text: " and back" }] }]]),
    )(tree);

    expect(runsOf(tree.children?.[0]).at(-1)).toEqual(["del", " and back"]);
  });

  it("leaves a run alone when its text is not in the source as written", () => {
    const escaped = "### Q\n\nUse \\* for a list\n";
    const run = paragraph(escaped, "Use \\* for a list", 3);
    // The parser gives the text without its backslash, so it no longer matches the source.
    run.children![0].value = "Use * for a list";
    const tree: Node = { type: "root", children: [run] };
    rehypeMarkEdits(
      escaped,
      new Map([[3, { added: [{ start: 0, end: 3 }], deletions: [] }]]),
    )(tree);

    expect(runsOf(tree.children?.[0])).toEqual([["text", "Use * for a list"]]);
  });

  it("never marks inside a fenced code block, which is redrawn from its text", () => {
    const code = "```py\nprint(name)\n```\n";
    const pre: Node = {
      type: "element",
      tagName: "pre",
      properties: {},
      children: [paragraph(code, "print(name)", 2)],
    };
    const tree: Node = { type: "root", children: [pre] };
    rehypeMarkEdits(code, new Map([[2, { added: [{ start: 0, end: 5 }], deletions: [] }]]))(tree);

    expect(runsOf(pre.children?.[0])).toEqual([["text", "print(name)"]]);
  });
});
