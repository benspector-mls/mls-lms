/**
 * Marking what a diff changed in a rendered Markdown file: the blocks it added to, and inside an
 * edited block, the words it added and the words it took out.
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

import type { ChangedRange, Deletion, PreviewChanges } from "@/lib/diff/patch";

/** The parts of a rendered markdown node that the two plugins here read and write. */
type RenderedNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: RenderedNode[];
  properties?: Record<string, unknown>;
  position?: { start: { line: number; offset?: number }; end: { line: number; offset?: number } };
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

/**
 * A block that was edited rather than written new: the bar in the margin, amber as GitHub draws a
 * modified passage, and no green shading. Shading the whole block green would call every word of
 * it new, and the words that are new carry their own marks inside it. A phone has no room for the
 * bar, so there a faint amber tint marks the block instead, which keeps an edit whose words could
 * not be marked from reading as untouched template text.
 */
const EDITED_CLASSES = [
  "rounded-sm px-2 py-1",
  "bg-amber-500/[0.06] dark:bg-amber-400/[0.08]",
  "sm:rounded-none sm:border-l-2 sm:border-amber-500/70 sm:bg-transparent sm:pl-3",
  "dark:sm:bg-transparent",
];

function containsLine(node: RenderedNode, lines: ReadonlySet<number>): boolean {
  if (!node.position) return false;
  const { start, end } = node.position;
  for (const line of lines) {
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

/** A wrapper around `children` with `classes`, and `spacing` added to them. */
function marked(children: RenderedNode[], spacing: string[], classes: string[]): RenderedNode {
  return {
    type: "element",
    tagName: "div",
    properties: { className: [...spacing, ...classes] },
    children,
  };
}

/**
 * Wraps each top-level block that contains a changed line in a `div`: shaded when a line of it is
 * wholly new, and given only the margin bar when its lines were edited.
 *
 * A list is handled one level down: each `li` holding a changed line has its contents wrapped,
 * so ticking one checklist item does not mark the whole list. A `div` inside an `li` is valid
 * markup, where a `div` between a `ul` and its items would not be.
 *
 * `changedLines` and `editedLines` are line numbers in the new file, counted from one, which is
 * how both the patch and the parser count them.
 */
export function rehypeMarkChanged(
  changedLines: ReadonlySet<number>,
  editedLines: ReadonlySet<number> = new Set(),
) {
  const classesFor = (node: RenderedNode) =>
    containsLine(node, changedLines)
      ? CHANGED_CLASSES
      : containsLine(node, editedLines)
        ? EDITED_CLASSES
        : null;

  return (tree: RenderedNode) => {
    if (!tree.children || (changedLines.size === 0 && editedLines.size === 0)) return;

    tree.children = tree.children.map((block) => {
      const classes = block.type === "element" ? classesFor(block) : null;
      if (!classes) return block;

      if (block.tagName === "ul" || block.tagName === "ol") {
        block.children = (block.children ?? []).map((item) => {
          const itemClasses =
            item.type === "element" && item.tagName === "li" ? classesFor(item) : null;
          return itemClasses
            ? { ...item, children: [marked(item.children ?? [], [], itemClasses)] }
            : item;
        });
        return block;
      }

      return marked([block], TOP_LEVEL_SPACING, classes);
    });
  };
}

/** Words added to an edited line: shaded and underlined in green, as GitHub's rich diff marks them. */
const INSERTED_CLASSES = [
  "rounded-sm bg-emerald-500/20 dark:bg-emerald-400/25",
  "underline decoration-emerald-600/50 underline-offset-2",
];

/** Words taken out of an edited line, put back where they stood and struck through in red. */
const DELETED_CLASSES = [
  "rounded-sm bg-destructive/15 text-foreground/70 dark:bg-destructive/30",
  "line-through decoration-destructive/70",
];

/**
 * Marks, inside the rendered text, the words an edit added and the words it took out.
 *
 * **The problem it solves.** A fellow who fixes one word of a paragraph has, by line, rewritten the
 * whole paragraph, and shading all of it tells an instructor to reread all of it. Marking the
 * added words in green, with the removed words struck through where they stood, shows the edit
 * itself, as GitHub's rich diff does.
 *
 * **How a word is found on the page.** The parser keeps, for each run of text, its offsets in the
 * Markdown source. The patch gives each edit as offsets into one line of the new file, and adding
 * the offset at which that line begins turns those into offsets in the source. A run whose text
 * appears in the source exactly as written is cut at those offsets, and the pieces inside an edit
 * are wrapped in `ins`, with each removed passage added as a `del` at the point where it stood.
 *
 * **What is left unmarked.** A run whose text differs from its source, such as one containing an
 * escaped `\*` or a list item's continuation line with its indentation removed, cannot be cut by
 * offset, and is left as it is. A removed passage whose position falls inside Markdown syntax
 * rather than text, such as between two `**` markers, has no run to sit in and is not shown.
 * Fenced code blocks are skipped whole, because `HighlightedCode` redraws one from its text, and
 * an added `del` would become part of the code. The block around each of these still carries its
 * margin bar, so the edit is never hidden, only less precise.
 */
export function rehypeMarkEdits(source: string, editedLines: PreviewChanges["editedLines"]) {
  const lineStarts = [0];
  for (let k = 0; k < source.length; k += 1) {
    if (source[k] === "\n") lineStarts.push(k + 1);
  }

  const inserted: ChangedRange[] = [];
  const deletions: Deletion[] = [];
  for (const [line, edit] of [...editedLines].sort(([x], [y]) => x - y)) {
    const base = lineStarts[line - 1];
    if (base === undefined) continue;
    for (const range of edit.added) {
      inserted.push({ start: base + range.start, end: base + range.end });
    }
    for (const deletion of edit.deletions) {
      deletions.push({ at: base + deletion.at, text: deletion.text });
    }
  }

  const placed = new Set<Deletion>();

  function textStartOf(node: RenderedNode): number | null {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const value = node.value;
    if (start === undefined || end === undefined || !value) return null;
    const found = source.slice(start, end).indexOf(value);
    return found === -1 ? null : start + found;
  }

  function cut(node: RenderedNode): RenderedNode[] {
    const textStart = textStartOf(node);
    if (textStart === null || !node.value) return [node];
    const value = node.value;
    const textEnd = textStart + value.length;

    const pieces: RenderedNode[] = [];
    const deleteAt = (offset: number) => {
      for (const deletion of deletions) {
        if (deletion.at !== offset || placed.has(deletion)) continue;
        placed.add(deletion);
        pieces.push(wrap("del", DELETED_CLASSES, deletion.text));
      }
    };

    let cursor = textStart;
    while (cursor < textEnd) {
      deleteAt(cursor);
      const inside = inserted.find((range) => range.start <= cursor && cursor < range.end);
      const nextInsert = inserted.find((range) => range.start > cursor)?.start ?? textEnd;
      const nextDelete =
        deletions.find((d) => d.at > cursor && d.at < textEnd && !placed.has(d))?.at ?? textEnd;
      const next = Math.min(inside ? inside.end : nextInsert, nextDelete, textEnd);
      const text = value.slice(cursor - textStart, next - textStart);
      pieces.push(inside ? wrap("ins", INSERTED_CLASSES, text) : { type: "text", value: text });
      cursor = next;
    }
    deleteAt(textEnd);

    return pieces;
  }

  function walk(node: RenderedNode) {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text") return cut(child);
      if (child.type === "element" && child.tagName === "pre") return [child];
      walk(child);
      return [child];
    });
  }

  /*
    From the blocks down. The root's own text is the line breaks between blocks, and a passage
    added there would sit outside any paragraph.
  */
  return (tree: RenderedNode) => {
    if (inserted.length === 0 && deletions.length === 0) return;
    for (const block of tree.children ?? []) {
      if (block.type === "element" && block.tagName !== "pre") walk(block);
    }
  };
}

function wrap(tagName: "ins" | "del", classes: string[], text: string): RenderedNode {
  return {
    type: "element",
    tagName,
    properties: { className: classes },
    children: [{ type: "text", value: text }],
  };
}
