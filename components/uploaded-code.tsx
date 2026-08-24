"use client";

import type { ThemedToken } from "@shikijs/core";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { useFileHighlight } from "@/hooks/use-file-highlight";
import { languageForPath } from "@/lib/diff/languages";
import { useTRPC } from "@/trpc/client";

/**
 * One uploaded code file, read on the screen the grade is written on.
 *
 * **The reason this exists rather than an iframe.** A PDF and an image are handed to the browser,
 * which has a viewer for each. A Python script has no such viewer, so the alternative is
 * downloading twenty-five scripts and matching filenames back to students in an editor — the loop
 * the embedded PDF preview exists to remove. Everything needed to avoid it is already here: a
 * highlighter, a Python grammar loaded for pull request diffs, and a way of rendering coloured
 * tokens.
 *
 * **The tokens are elements with text children and never markup.** Shiki can return a string of
 * HTML, and using it would be the shorter path and the wrong one: a student writes every byte of
 * this file, and the difference between a `<span>` holding their text and a string of HTML built
 * around it is the difference between code on a screen and script in a page.
 */

/**
 * The most lines this will draw.
 *
 * Generous for a script and a ceiling all the same, following `MAX_RENDERED_LINES` in
 * `diff-file-card.tsx` and for the same reason: the column beside the grade scrolls, and a file
 * that makes it forty thousand rows tall is a screen nobody can use. The procedure has its own
 * ceiling in bytes, so a file that reaches this one is unusual — a generated data table, most
 * likely, in which case the count and the download are the useful answer.
 */
const MAX_RENDERED_LINES = 2000;

export function UploadedCode({
  submissionId,
  filename,
}: {
  submissionId: string;
  filename: string;
}) {
  const trpc = useTRPC();

  /*
    A query, so re-opening this or stepping back to a student in the queue reads it from the cache.
    That is the whole difference from `uploadUrl`, which has to be a mutation because a signed URL
    expires; text does not.
  */
  const file = useQuery(trpc.submissions.uploadText.queryOptions({ submissionId }));

  /*
    The lines as they will be drawn, and the same text handed to the grammar.

    Normalized once and used for both, which is what keeps the token list and the rows aligned:
    `codeToTokens` returns one entry per line of the text it was given, so tokenizing anything but
    the exact lines below would map colours onto the wrong rows.

    A trailing `\r` comes off each line rather than being shown. The diff renderer draws a visible
    `␍` instead, because there a line-ending commit is the thing an instructor cannot otherwise
    explain; a whole file written on Windows has one on every line, where the mark would be noise.
    A single empty last line is dropped, so a file ending in a newline — which is every file that
    should — does not show a phantom line after its last one.
  */
  const { lines, text, total } = React.useMemo(() => {
    if (file.data === undefined) return { lines: null, text: null, total: 0 };

    const all = file.data.text
      .split("\n")
      .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
    if (all.length > 1 && all[all.length - 1] === "") all.pop();

    const shown = all.slice(0, MAX_RENDERED_LINES);
    return { lines: shown, text: shown.join("\n"), total: all.length };
  }, [file.data]);

  const language = React.useMemo(() => languageForPath(filename), [filename]);
  const tokens = useFileHighlight(text, language);

  if (file.isPending) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Opening…
      </div>
    );
  }

  /*
    The procedure's own sentence, which is a fact about the file rather than a failure: too long to
    show, or no longer there. Never a retry button — pressing it again reads the same file.
  */
  if (file.error || lines === null) {
    return (
      <p className="rounded-md border border-border px-3 py-2.5 text-sm text-muted-foreground">
        {file.error?.message ?? "That file could not be read."}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="overflow-x-auto py-1 font-mono text-xs">
        {lines.map((line, index) => (
          <CodeLine key={index} number={index + 1} text={line} tokens={tokens?.[index] ?? null} />
        ))}
      </div>

      {total > lines.length && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {lines.length} of {total} lines shown. Download the file to read the rest.
        </p>
      )}
    </div>
  );
}

/**
 * One line: its number, then its text.
 *
 * `select-none` on the number is what makes selecting a block and pasting it produce code that
 * runs rather than a column of numbers — the same trick the diff renderer's own `CodeLine`
 * documents. The grid rather than a table so a long line scrolls the container instead of
 * stretching the column.
 */
function CodeLine({
  number,
  text,
  tokens,
}: {
  number: number;
  text: string;
  tokens: ThemedToken[] | null;
}) {
  return (
    <div className="grid grid-cols-[3rem_1fr]">
      <span className="px-1 text-right text-muted-foreground/60 tabular-nums select-none">
        {number}
      </span>
      <code className="shiki-code pr-3 whitespace-pre">
        {tokens
          ? tokens.map((token, index) => (
              <span key={index} style={token.htmlStyle as React.CSSProperties}>
                {token.content}
              </span>
            ))
          : text}
      </code>
    </div>
  );
}
