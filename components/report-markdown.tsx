'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * A grading report, rendered.
 *
 * One component for both audiences so that the student's view and the instructor's
 * preview cannot disagree about how a report will look. An instructor approving a
 * report is deciding to send *this*, and a preview that renders differently from the
 * real thing is worse than no preview.
 *
 * Raw HTML is deliberately not enabled. `react-markdown` ignores embedded HTML unless
 * `rehype-raw` is added, and this text comes from a language model, so leaving that
 * default in place means a report cannot inject markup into a page — no sanitiser to
 * configure correctly and no reliance on one being configured.
 *
 * GitHub Flavoured Markdown, because that is what the pull request comment will be
 * rendered as: task lists and tables appear in the frontend checklists constantly, and
 * plain CommonMark would show them as literal brackets and pipes here while GitHub
 * rendered them properly.
 */
export function ReportMarkdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
          // Checklist items carry their own marker, so the list bullet is dropped for
          // those and kept for everything else.
          li: ({ children, className }) => (
            <li className={className?.includes('task-list-item') ? 'list-none' : ''}>
              {children}
            </li>
          ),
          code: ({ children, className }) =>
            className?.startsWith('language-') ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{children}</pre>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-4"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
          ),
          hr: () => <hr className="border-t" />,
          // Wide tables scroll inside themselves rather than stretching the page.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b p-1 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b p-1 align-top">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
