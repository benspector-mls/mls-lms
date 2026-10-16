import { rehypeMarkChanged } from "@/lib/markdown/mark-changed";

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
  position?: { start: { line: number }; end: { line: number } };
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
