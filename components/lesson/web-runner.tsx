"use client";

import { Play, RotateCcw } from "lucide-react";
import * as React from "react";

import { CodeEditor } from "@/components/lesson/code-editor";
import { Button } from "@/components/ui/button";
import { buildWebPage, type RunKind } from "@/lib/lessons/runnable";
import { cn } from "@/lib/utils";

type Log = { level: "log" | "info" | "warn" | "error"; text: string };

/**
 * An HTML block being run, with the CSS and JavaScript blocks that go with it, or a JavaScript
 * block on its own: each part in an editor, a frame beneath them showing the page, and a console
 * panel under the frame for what the scripts log and for errors.
 *
 * **The page runs in a sandboxed frame without an origin of its own**: `sandbox="allow-scripts"`
 * and no `allow-same-origin`, so the code can draw and run but cannot read the fellow's session
 * or reach the application. The console bridge that `buildWebPage` puts at the top of the page
 * sends each log and error out as a message, and the panel takes only messages from this frame
 * that the bridge marked. A JavaScript block alone runs in a frame that is not shown, so only
 * its console is seen.
 *
 * Run rebuilds the page from the editors; the frame's key changes with every run so that the
 * same page is loaded afresh, which is what a fellow pressing Run again expects.
 */
export function WebRunner({
  kind,
  html: originalHtml,
  css: originalCss,
  js: originalJs,
}: {
  kind: Exclude<RunKind, "python">;
  html: string;
  css: string;
  js: string;
}) {
  const [html, setHtml] = React.useState(originalHtml);
  const [css, setCss] = React.useState(originalCss);
  const [js, setJs] = React.useState(originalJs);
  const [page, setPage] = React.useState(() =>
    buildWebPage({ html: originalHtml, css: originalCss, js: originalJs }),
  );
  const [runs, setRuns] = React.useState(1);
  const [logs, setLogs] = React.useState<Log[]>([]);
  const frame = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data: unknown = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        (data as { source?: unknown }).source !== "lesson-runner"
      ) {
        return;
      }
      const { level, text } = data as { level: Log["level"]; text: string };
      setLogs((current) => [...current, { level, text: String(text) }]);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const run = () => {
    setLogs([]);
    setPage(buildWebPage({ html, css, js }));
    setRuns((count) => count + 1);
  };

  const reset = () => {
    setHtml(originalHtml);
    setCss(originalCss);
    setJs(originalJs);
  };
  const untouched = html === originalHtml && css === originalCss && js === originalJs;

  const showsHtml = kind === "web";
  const showsCss = kind === "web" && originalCss !== "";
  const showsJs = kind === "javascript" || originalJs !== "";
  const several = [showsHtml, showsCss, showsJs].filter(Boolean).length > 1;

  return (
    <div className="my-4 flex flex-col gap-2">
      {showsHtml && (
        <Part label="HTML" labelled={several}>
          <CodeEditor value={html} onChange={setHtml} language="html" ariaLabel="HTML" />
        </Part>
      )}
      {showsCss && (
        <Part label="CSS" labelled={several}>
          <CodeEditor value={css} onChange={setCss} language="css" ariaLabel="CSS" />
        </Part>
      )}
      {showsJs && (
        <Part label="JavaScript" labelled={several}>
          <CodeEditor value={js} onChange={setJs} language="javascript" ariaLabel="JavaScript" />
        </Part>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="xs" onClick={run}>
          <Play aria-hidden data-icon="inline-start" />
          Run
        </Button>
        <Button type="button" variant="ghost" size="xs" onClick={reset} disabled={untouched}>
          <RotateCcw aria-hidden data-icon="inline-start" />
          Reset
        </Button>
      </div>
      <iframe
        key={runs}
        ref={frame}
        title={kind === "web" ? "The page the code draws" : "Where the script runs"}
        sandbox="allow-scripts"
        srcDoc={page}
        className={cn(
          "w-full rounded-md border border-border bg-white",
          kind === "web" ? "h-64" : "hidden",
        )}
      />
      <div className="rounded-md border border-border bg-muted/60 p-2 font-mono text-[0.8em]">
        <p className="mb-1 text-[0.75rem] font-sans tracking-wide text-muted-foreground uppercase">
          Console
        </p>
        {logs.length === 0 ? (
          <p className="text-muted-foreground">Nothing logged.</p>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {logs.map((log, index) => (
              <li
                key={index}
                className={cn(
                  "whitespace-pre-wrap",
                  log.level === "error" && "text-destructive",
                  log.level === "warn" && "text-amber-700 dark:text-amber-400",
                )}
              >
                {log.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** One editor with its name above it, when there is more than one to tell apart. */
function Part({
  label,
  labelled,
  children,
}: {
  label: string;
  labelled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {labelled && (
        <p className="text-[0.75rem] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}
