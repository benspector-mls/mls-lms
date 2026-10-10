import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Real GFM markdown rendering. This is deliberate: feedback contains headings,
// checklists, tables, and code blocks, and the instructor needs to see exactly
// what the student will receive. Markdown that fails to render shows up here as
// visibly wrong output (a broken table becomes literal pipes) rather than being
// silently smoothed over.
export function Markdown({
  content,
  className,
  sourceOffsets = false,
}: {
  content: string;
  className?: string;
  /**
   * Marks each run of text with where it begins in `content`, so that `sourceOffsetAt` can say
   * which character of the markdown a reader pointed at. Off unless asked for, because it puts a
   * `span` around every run of text, and only a preview that opens into an editor needs it.
   */
  sourceOffsets?: boolean;
}) {
  return (
    <div className={cn("marcy-md text-sm leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={sourceOffsets ? [[rehypeSourceOffsets, content]] : []}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-base font-semibold tracking-tight first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 text-sm font-semibold tracking-tight first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="my-2 text-muted-foreground first:mt-0 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground marker:text-muted-foreground/60">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 flex list-decimal flex-col gap-1 pl-5 text-muted-foreground marker:text-muted-foreground/60">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          code: ({ className: cls, children }) => {
            const isBlock = /language-/.test(cls ?? "");
            if (isBlock) {
              return <code className={cn("font-mono text-[0.85em]", cls)}>{children}</code>;
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-md border border-border bg-muted/60 p-3 text-[0.8rem] leading-relaxed text-foreground">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-3 py-2 text-muted-foreground last:border-0">
              {children}
            </td>
          ),
          input: ({ checked, type }) =>
            type === "checkbox" ? (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="mr-1.5 translate-y-[1px] accent-primary"
              />
            ) : null,
          hr: () => <hr className="my-4 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** The parts of a rendered markdown node that `rehypeSourceOffsets` reads and writes. */
type RenderedNode = {
  type: string;
  value?: string;
  children?: RenderedNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  tagName?: string;
  properties?: Record<string, number>;
};

/**
 * Wraps each run of text in a `span` carrying `data-source-start`, the offset in the markdown of
 * the run's first character, and `data-source-end`, the offset just past the run.
 *
 * **Why a span around the text rather than an attribute on the element that holds it.** The
 * components above rebuild each element from its `children` alone, so an attribute set on a `p` or
 * an `li` here would never reach the page. A span is one of those children, so it arrives intact.
 *
 * **Why the start is searched for.** The parser gives an inline code span's text the position of
 * the whole span, backticks included, and gives a fenced block's text no position at all, so that
 * text takes the range of the nearest element around it, which is the whole fence. Finding the
 * text inside that range moves the start past the markers. Text that does not appear
 * verbatim, such as a run containing an escaped `\*`, keeps the start the parser gave it, which is
 * at most a few characters out.
 *
 * Runs of only whitespace are left bare. They are never what a reader points at, and inside a
 * table a span where the browser expects only rows and cells would be invalid markup.
 */
function rehypeSourceOffsets(source: string) {
  function wrap(node: RenderedNode, around?: [number, number]) {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      const start = child.position?.start.offset ?? around?.[0];
      const end = child.position?.end.offset ?? around?.[1];
      const range: [number, number] | undefined =
        start === undefined || end === undefined ? undefined : [start, end];
      if (child.type !== "text" || !range) {
        wrap(child, range);
        return child;
      }
      if (!child.value?.trim()) return child;
      const found = source.slice(...range).indexOf(child.value);
      return {
        type: "element",
        tagName: "span",
        properties: {
          dataSourceStart: found === -1 ? range[0] : range[0] + found,
          dataSourceEnd: range[1],
        },
        children: [child],
      };
    });
  }
  return (tree: RenderedNode) => wrap(tree);
}

/**
 * The offset in the markdown of the character under a point on the screen, for a `Markdown` drawn
 * with `sourceOffsets`. Null when the point is not over text, such as the space between two
 * paragraphs or a checkbox.
 *
 * The browser says which text node is under the point and how far into it; the span around that
 * node says where the node begins in the markdown. Adding the two gives the answer, which is exact
 * for text written plainly. In a block quote or a list item running over several lines, the
 * markers that begin each later line are absent from the rendered text, so a point on one of those
 * lines lands a few characters early. The answer never passes the end of the run, so it never lands
 * in a different block.
 */
export function sourceOffsetAt(x: number, y: number): number | null {
  let node: Node | null = null;
  let offset = 0;
  // `caretPositionFromPoint` is the standard; Safari before version 26 has only the older name.
  if ("caretPositionFromPoint" in document) {
    const position = document.caretPositionFromPoint(x, y);
    node = position?.offsetNode ?? null;
    offset = position?.offset ?? 0;
  } else {
    const range = (document as Document).caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  if (node?.nodeType !== Node.TEXT_NODE) return null;

  const span = node.parentElement;
  const start = Number(span?.dataset.sourceStart);
  const end = Number(span?.dataset.sourceEnd);
  if (!span || Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.min(start + offset, end);
}
