"use client";

import * as React from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useFileHighlight } from "@/hooks/use-file-highlight";
import { languageForFence, type DiffLanguage } from "@/lib/diff/languages";
import type { PreviewChanges } from "@/lib/diff/patch";
import { rehypeMarkChanged, rehypeMarkEdits } from "@/lib/markdown/mark-changed";
import { cn } from "@/lib/utils";

// Real GFM markdown rendering. This is deliberate: feedback contains headings,
// checklists, tables, and code blocks, and the instructor needs to see exactly
// what the student will receive. Markdown that fails to render shows up here as
// visibly wrong output (a broken table becomes literal pipes) rather than being
// silently smoothed over.
export function Markdown({
  content,
  className,
  reading = false,
  changes,
}: {
  content: string;
  className?: string;
  /**
   * Draws a fellow's own writing to be read rather than glanced at: prose at full contrast and a
   * size up. Feedback stays muted and small so that it sits quietly beside the rest of the review
   * screen; a short response is the thing on the screen being read.
   */
  reading?: boolean;
  /**
   * What a diff added to `content`, by line number. Each block holding a wholly new line is
   * shaded, which is how the preview of a short response tells the fellow's answers from the
   * template's questions. Inside an edited block, the words added are marked and the words taken
   * out are struck through where they stood. See `rehypeMarkChanged` and `rehypeMarkEdits`.
   */
  changes?: PreviewChanges;
}) {
  const prose = reading ? "text-foreground" : "text-muted-foreground";
  const headingSize = reading
    ? { h1: "text-xl", h2: "text-lg", h3: "text-base" }
    : { h1: "text-base", h2: "text-sm", h3: "text-sm" };

  const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [];
  if (changes) {
    rehypePlugins.push([rehypeMarkEdits, content, changes.editedLines]);
    rehypePlugins.push([
      rehypeMarkChanged,
      changes.addedLines,
      new Set(changes.editedLines.keys()),
    ]);
  }

  return (
    <div
      /*
        The size before `leading-relaxed`, because `cn` reads a font size such as `text-base` as
        setting the line height too, and drops a `leading-` class that comes before it.
      */
      className={cn(
        "marcy-md",
        reading ? "text-base" : "text-sm",
        "leading-relaxed text-foreground",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          h1: ({ children }) => (
            <h1 className={cn("mt-4 mb-2 font-semibold tracking-tight first:mt-0", headingSize.h1)}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className={cn("mt-4 mb-2 font-semibold tracking-tight first:mt-0", headingSize.h2)}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className={cn("mt-3 mb-1 font-semibold first:mt-0", headingSize.h3)}>{children}</h3>
          ),
          p: ({ children }) => <p className={cn("my-2 first:mt-0 last:mb-0", prose)}>{children}</p>,
          ul: ({ children }) => (
            <ul
              className={cn(
                "my-2 flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground/60",
                prose,
              )}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className={cn(
                "my-2 flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground/60",
                prose,
              )}
            >
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
          code: ({ className: cls, children, node }) => {
            const fence = /language-([\w-]+)/.exec(cls ?? "");
            if (fence) {
              const language = languageForFence(fence[1]);
              if (language && node) {
                return (
                  <HighlightedCode node={node} language={language} className={cls}>
                    {children}
                  </HighlightedCode>
                );
              }
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
            <td
              className={cn("border-b border-border px-3 py-2 [tr:last-child_&]:border-b-0", prose)}
            >
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

/** The parts of a fenced code block's node that `HighlightedCode` reads. */
type CodeNode = {
  type: string;
  value?: string;
  tagName?: string;
  children?: CodeNode[];
};

/** Every piece of text under a node, in order. */
export function textOf(node: CodeNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/**
 * A fenced code block whose fence names a language, in syntax colours.
 *
 * Coloured in the browser through `useFileHighlight`, the hook an uploaded code file uses, so a
 * grammar already fetched for a diff or a file is not fetched again. Until the tokens arrive, and
 * for good in a browser that cannot load the highlighter, the block is drawn exactly as it was
 * before colouring existed: plain code is perfectly readable code.
 *
 * **The tokens are elements with text children and never markup**, for the reason `UploadedCode`
 * gives: a fellow or an instructor wrote every character of this, and a string of HTML built
 * around it would be a way to put script in a page.
 */
export function HighlightedCode({
  node,
  language,
  className,
  children,
}: {
  node: CodeNode;
  language: DiffLanguage;
  className?: string;
  children: React.ReactNode;
}) {
  // The parser ends a fenced block's text with the newline before the closing fence.
  const text = textOf(node).replace(/\n$/, "");
  const tokens = useFileHighlight(text, language);

  if (tokens === null) {
    return <code className={cn("font-mono text-[0.85em]", className)}>{children}</code>;
  }

  const lines = text.split("\n");
  const coloured = tokens.map((line, index) => (
    <React.Fragment key={index}>
      {index > 0 && "\n"}
      {line
        ? line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={token.htmlStyle as React.CSSProperties}>
              {token.content}
            </span>
          ))
        : lines[index]}
    </React.Fragment>
  ));

  return <code className={cn("shiki-code font-mono text-[0.85em]", className)}>{coloured}</code>;
}
