/**
 * Marking the blocks of a rendered Markdown file that a pull request added to.
 *
 * A fellow answers a short response by writing beneath the questions in the template's own file,
 * so the rendered file holds the template's questions and the fellow's answers in one style. The
 * patch already says which lines of the new file were added; the parser already says which lines
 * each block came from. Comparing the two is enough to shade the fellow's writing, without a
 * second request for the base version or a comparison of two documents.
 *
 * **A wrapper around the block rather than a class on it.** The components in
 * `components/markdown.tsx` rebuild `p`, `li` and the headings from their `children` alone, so a
 * class set on one of them here would never reach the page. `div` has no entry there, so a
 * wrapper keeps its classes.
 */

/** The parts of a rendered markdown node that `rehypeMarkChanged` reads and writes. */
type RenderedNode = {
  type: string;
  tagName?: string;
  children?: RenderedNode[];
  properties?: Record<string, unknown>;
  position?: { start: { line: number }; end: { line: number } };
};

/**
 * The shading, always, and the bar in the margin from the `sm` breakpoint up.
 *
 * The tint is the one the diff gives an added line (`LINE_TINT` in `diff-file-card.tsx`), so green
 * means the same thing in both views. A phone has no room to spare for a bar and its padding, so
 * there the tint alone marks the block.
 */
const CHANGED_CLASSES = [
  "rounded-sm px-2 py-1",
  "bg-emerald-500/[0.07] dark:bg-emerald-400/[0.09]",
  "sm:rounded-none sm:border-l-2 sm:border-emerald-500/70 sm:pl-3",
];

function containsChangedLine(node: RenderedNode, changedLines: ReadonlySet<number>): boolean {
  if (!node.position) return false;
  const { start, end } = node.position;
  for (const line of changedLines) {
    if (line >= start.line && line <= end.line) return true;
  }
  return false;
}

/**
 * The margin a top-level wrapper takes in place of its block's own.
 *
 * The block's margin would otherwise fall inside the shading, and only a paragraph removes its
 * own margin as a first and last child; a code block or a list would sit inset in its tint. So the
 * wrapper clears its child's margin and spaces itself as a paragraph would be.
 */
const TOP_LEVEL_SPACING = ["my-2", "*:my-0"];

/** A shaded wrapper around `children`, with `spacing` added to its classes. */
function marked(children: RenderedNode[], spacing: string[]): RenderedNode {
  return {
    type: "element",
    tagName: "div",
    properties: { className: [...spacing, ...CHANGED_CLASSES] },
    children,
  };
}

/**
 * Wraps each top-level block that contains a changed line in a shaded `div`.
 *
 * A list is handled one level down: each `li` holding a changed line has its contents wrapped,
 * so ticking one checklist item does not shade the whole list. A `div` inside an `li` is valid
 * markup, where a `div` between a `ul` and its items would not be.
 *
 * `changedLines` are line numbers in the new file, counted from one, which is how both the patch
 * and the parser count them.
 */
export function rehypeMarkChanged(changedLines: ReadonlySet<number>) {
  return (tree: RenderedNode) => {
    if (!tree.children || changedLines.size === 0) return;

    tree.children = tree.children.map((block) => {
      if (block.type !== "element" || !containsChangedLine(block, changedLines)) return block;

      if (block.tagName === "ul" || block.tagName === "ol") {
        block.children = (block.children ?? []).map((item) =>
          item.type === "element" &&
          item.tagName === "li" &&
          containsChangedLine(item, changedLines)
            ? { ...item, children: [marked(item.children ?? [], [])] }
            : item,
        );
        return block;
      }

      return marked([block], TOP_LEVEL_SPACING);
    });
  };
}
