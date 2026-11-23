"use client";

import { ChevronDown, ChevronRight, Play } from "lucide-react";
import dynamic from "next/dynamic";
import * as React from "react";

import { CopyButton } from "@/components/lesson/copy-button";
import { Button } from "@/components/ui/button";
import type { RunKind } from "@/lib/lessons/runnable";

/*
  Loaded when Run is first pressed, not with the lesson: the terminal, the editor and their
  grammars are a few hundred kilobytes that a reader who only reads never needs. Until then the
  block is the plain highlighted code every other block is.
*/
const PythonRunner = dynamic(
  () => import("@/components/lesson/python-runner").then((module) => module.PythonRunner),
  { ssr: false, loading: () => <Loading /> },
);
const WebRunner = dynamic(
  () => import("@/components/lesson/web-runner").then((module) => module.WebRunner),
  { ssr: false, loading: () => <Loading /> },
);

function Loading() {
  return <p className="my-4 text-sm text-muted-foreground">Loading the runner…</p>;
}

/** The heading over a block's hidden setup, wherever it is shown. */
export const EARLIER_CODE = "Earlier code this block uses";

/**
 * A block's hidden setup above the block, closed to one line until opened. A fellow who copies
 * the block into a file of their own would otherwise get a NameError with no sign on the page of
 * which code ran first.
 */
function EarlierCode({ code }: { code: string }) {
  const [open, setOpen] = React.useState(false);
  const lines = code.split("\n").length;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-b border-border bg-muted">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-3 py-1 text-left text-[0.8em] text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Chevron aria-hidden className="size-3.5" />
        {EARLIER_CODE} ({lines} {lines === 1 ? "line" : "lines"})
      </button>
      {open && (
        <pre className="overflow-x-auto px-3 pb-2 font-mono text-[0.85em] leading-relaxed">
          {code}
        </pre>
      )}
    </div>
  );
}

/**
 * A code block a fellow can run: the block as it is drawn everywhere, with a Run button beside
 * Copy. Pressing Run replaces the block with the runner for its kind, which holds the code in an
 * editor above a terminal or a frame, and runs it at once. See `lib/lessons/runnable.ts` for
 * which blocks these are.
 */
export function RunnableBlock({
  kind,
  code,
  css,
  js,
  setup,
  setupMissing,
  children,
}: {
  kind: RunKind;
  /** The block's text, as written. */
  code: string;
  /** For an HTML block, the CSS and JavaScript blocks that follow it, if any. */
  css?: string;
  js?: string;
  /** For a Python block, the hidden setups it names, as one program to run before it. */
  setup?: string;
  /** The names of setups the block asks for that its page does not define. */
  setupMissing?: string;
  /** The block's highlighted code, drawn until Run is pressed. */
  children: React.ReactNode;
}) {
  const [running, setRunning] = React.useState(false);

  if (!running) {
    return (
      <div data-code-block className="my-4 overflow-hidden rounded-md border border-border bg-muted/60">
        {setup !== undefined && <EarlierCode code={setup} />}
        {/* The buttons are placed against the block's own code, under any setup strip. */}
        <div className="relative">
          <pre className="overflow-x-auto p-3 pr-28 leading-relaxed">{children}</pre>
          <CopyButton text={code} />
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="absolute top-2 right-11"
            onClick={() => setRunning(true)}
          >
            <Play aria-hidden data-icon="inline-start" />
            Run
          </Button>
        </div>
      </div>
    );
  }

  if (kind === "python") {
    return <PythonRunner code={code} setup={setup} setupMissing={setupMissing} />;
  }
  return (
    <WebRunner
      kind={kind}
      html={kind === "web" ? code : ""}
      css={css ?? ""}
      js={kind === "javascript" ? code : (js ?? "")}
    />
  );
}
