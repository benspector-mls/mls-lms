import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Real GFM markdown rendering. This is deliberate: feedback contains headings,
// checklists, tables, and code blocks, and the instructor needs to see exactly
// what the student will receive. Markdown that fails to render shows up here as
// visibly wrong output (a broken table becomes literal pipes) rather than being
// silently smoothed over.
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("marcy-md text-sm leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
