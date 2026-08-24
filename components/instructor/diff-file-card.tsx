"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDiffHighlight } from "@/hooks/use-diff-highlight";
import { parseUnifiedPatch, type DiffHunk, type DiffLine } from "@/lib/diff/patch";
import { DIFF_KIND_META, TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

type DiffFile = RouterOutputs["pullRequests"]["diffForSubmission"]["files"][number];

/**
 * The most lines of one file this panel will draw.
 *
 * **A cap on rows instead of a scroll region inside a column that already scrolls.** The column
 * beside the grade has its own scrollbar, and a second one nested inside it would capture the
 * wheel wherever the pointer happened to be — the interaction failure that makes a diff viewer
 * unusable. So one committed lockfile is stopped from making the column forty thousand rows tall
 * by drawing five hundred of them and saying how many there were.
 */
const MAX_RENDERED_LINES = 500;

/** What a hunk header and its lines look like as a flat list of rows, with the cap applied. */
type Row =
  | { kind: "hunk"; hunk: DiffHunk; key: string }
  | { kind: "line"; line: DiffLine; index: number; key: string };

/**
 * One changed file: what happened to it, and the change itself when it is asked for.
 *
 * Its own component because it owns the parse and the syntax colours for its own file, and both
 * are wanted only once somebody expands it. Which files are open is decided by the panel above,
 * so this is controlled rather than holding its own state: Expand all is then one change rather
 * than one per card.
 */
export function DiffFileCard({
  file,
  open,
  onOpenChange,
}: {
  file: DiffFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hunks = React.useMemo(
    () => (open && file.patch !== null ? parseUnifiedPatch(file.patch).hunks : null),
    [open, file.patch],
  );

  const tokens = useDiffHighlight(hunks, file.language);

  const rendered = React.useMemo(() => {
    if (!hunks) return null;

    const rows: Row[] = [];
    let lines = 0;
    let total = 0;

    for (const [hunkIndex, hunk] of hunks.entries()) {
      total += hunk.lines.length;
      if (lines >= MAX_RENDERED_LINES) continue;

      rows.push({ kind: "hunk", hunk, key: `h${hunkIndex}` });
      for (const [lineIndex, line] of hunk.lines.entries()) {
        if (lines >= MAX_RENDERED_LINES) break;
        // The index into the flat token list, which `highlightDiffLines` produced by walking the
        // hunks in this same order. Counted here rather than derived, so the two cannot drift.
        /*
          `lines` is the index into the flat token list as well as the count: `highlightDiffLines`
          walked the hunks in this same order, and rows are drawn contiguously from the first, so
          the nth line drawn is the nth line it tokenized.
        */
        rows.push({ kind: "line", line, index: lines, key: `h${hunkIndex}l${lineIndex}` });
        lines += 1;
      }
    }

    return { rows, shown: lines, total };
  }, [hunks]);

  const meta = DIFF_KIND_META[file.kind];

  return (
    <li>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        {/*
          The trigger and the link out are siblings. Base UI's trigger renders a button, and an
          anchor inside a button is invalid markup and unreachable by keyboard — the same problem
          `UploadedFileRow` solves by putting its own trigger beside its download.
        */}
        <div className="flex items-start gap-2 px-3 py-2">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-start gap-2 text-left">
            <Badge variant="outline" className={cn("shrink-0", TONE_CLASSES[meta.tone])}>
              {meta.label}
            </Badge>

            <span className="min-w-0 flex-1 font-mono text-xs break-all">
              {file.previousPath && (
                <>
                  <span className="text-muted-foreground">{file.previousPath}</span>
                  <span className="px-1 text-muted-foreground">→</span>
                </>
              )}
              <FilePath path={file.path} />
              {/*
                Named rather than hidden. `promptExclusionReason` decides what must never be sent
                to a model; an instructor is the opposite case — a committed `.env` is exactly what
                they need to read, because they are the person who tells the student to rotate the
                key. So bulk is sorted last, labelled, and left closed, never withheld.
              */}
              {file.bulkReason && (
                <span className="pl-1.5 font-sans text-muted-foreground">({file.bulkReason})</span>
              )}
            </span>

            <span className="shrink-0 tabular-nums">
              {file.additions > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
              )}
              {file.deletions > 0 && (
                <span className="pl-1.5 text-destructive">−{file.deletions}</span>
              )}
            </span>

            <ChevronDown
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
            />
          </CollapsibleTrigger>

          {file.blobUrl && (
            <a
              href={file.blobUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${file.path} on GitHub`}
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>

        <CollapsibleContent>
          <div className="border-t border-border">
            {file.patch === null ? (
              <NoPatch file={file} />
            ) : rendered === null || rendered.rows.length === 0 ? (
              /*
                A patch this application cut before its first hunk, which happens only to a file
                whose first hunk alone is larger than the per-file ceiling. The same state a binary
                file gets, because the reader's position is the same: the diff is on GitHub.
              */
              <NoPatch file={file} />
            ) : (
              <>
                <div className="overflow-x-auto font-mono text-xs">
                  {rendered.rows.map((row) =>
                    row.kind === "hunk" ? (
                      /*
                        The gap between hunks as well as the header of one. A diff's hunks are not
                        adjacent regions of the file, and a reader who cannot see where one ends
                        reads two distant pieces of code as one.
                      */
                      <div
                        key={row.key}
                        className="bg-muted/60 px-3 py-1 text-muted-foreground select-none"
                      >
                        {`@@ -${row.hunk.oldStart},${row.hunk.oldCount} +${row.hunk.newStart},${row.hunk.newCount} @@`}
                        {row.hunk.section && (
                          <span className="pl-2 opacity-70">{row.hunk.section}</span>
                        )}
                      </div>
                    ) : (
                      <CodeLine
                        key={row.key}
                        line={row.line}
                        tokens={tokens?.[row.index] ?? null}
                      />
                    ),
                  )}
                </div>

                {rendered.shown < rendered.total && (
                  <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    {rendered.shown} of {rendered.total} changed lines shown.{" "}
                    <a
                      href={file.blobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-foreground hover:underline"
                    >
                      Open this file on GitHub
                    </a>{" "}
                    to read the rest.
                  </p>
                )}

                {file.truncated && rendered.shown === rendered.total && (
                  <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    This diff is larger than this panel will load, so it stops here.{" "}
                    <a
                      href={file.blobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-foreground hover:underline"
                    >
                      Open this file on GitHub
                    </a>{" "}
                    to read all of it.
                  </p>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * The directory muted and the filename not.
 *
 * A path is read for its last segment, and `src/components/forms/AddressFields.tsx` in one weight
 * makes the eye scan the whole string to find it.
 */
function FilePath({ path }: { path: string }) {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return <span className="text-foreground">{path}</span>;
  return (
    <>
      <span className="text-muted-foreground">{path.slice(0, cut + 1)}</span>
      <span className="text-foreground">{path.slice(cut + 1)}</span>
    </>
  );
}

/**
 * A file with no diff to draw, said in the words that are true of it.
 *
 * Never an error tone and never a spinner: nothing failed, and nothing is coming. A rename with no
 * content change is a complete account of what happened to that file, and a binary or very large
 * file is one GitHub declined to send a diff for, which is a fact about GitHub rather than about
 * the student.
 */
function NoPatch({ file }: { file: DiffFile }) {
  if (file.patchAbsence === "no-content-change") {
    return (
      <p className="px-3 py-2.5 text-xs text-muted-foreground">
        {file.previousPath
          ? "Renamed, with no change to its contents."
          : "No change to its contents."}
      </p>
    );
  }

  return (
    <p className="px-3 py-2.5 text-xs text-muted-foreground">
      GitHub did not send a diff for this file, which happens with binary files and with very large
      ones.{" "}
      {file.blobUrl && (
        <a
          href={file.blobUrl}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground hover:underline"
        >
          Open it on GitHub
        </a>
      )}{" "}
      to read it.
    </p>
  );
}

/** The tint for a row, applied to the row and never to the text, so it composes with the colours. */
const LINE_TINT = {
  add: "bg-emerald-500/[0.07] dark:bg-emerald-400/[0.09]",
  remove: "bg-destructive/[0.07] dark:bg-destructive/[0.10]",
  context: "",
} as const;

const LINE_MARKER = { add: "+", remove: "−", context: "" } as const;

function CodeLine({
  line,
  tokens,
}: {
  line: DiffLine;
  tokens: { content: string; htmlStyle?: Record<string, string> }[] | null;
}) {
  // Shown as a visible mark rather than left invisible. Without it a student's line-ending commit
  // is a diff where every line changed and every line looks identical, and there is nothing on
  // screen an instructor can point at to explain why.
  const carriageReturn = line.text.endsWith("\r");
  const text = carriageReturn ? line.text.slice(0, -1) : line.text;

  return (
    <>
      <div className={cn("grid grid-cols-[3rem_3rem_1rem_1fr]", LINE_TINT[line.kind])}>
        {/*
          `select-none` on the gutter and the marker, which together with the marker being stripped
          from the text is what makes selecting a block of this and pasting it produce code that
          compiles rather than a column of numbers.
        */}
        <span className="px-1 text-right text-muted-foreground/60 tabular-nums select-none">
          {line.oldLine ?? ""}
        </span>
        <span className="px-1 text-right text-muted-foreground/60 tabular-nums select-none">
          {line.newLine ?? ""}
        </span>
        <span className="text-center text-muted-foreground select-none">
          {LINE_MARKER[line.kind]}
        </span>
        <code className="shiki-code pr-3 whitespace-pre">
          {tokens
            ? tokens.map((token, index) => (
                <span key={index} style={token.htmlStyle as React.CSSProperties}>
                  {token.content}
                </span>
              ))
            : text}
          {carriageReturn && <span className="text-muted-foreground/60">␍</span>}
        </code>
      </div>

      {line.noNewlineAtEof && (
        // An annotation on the line above rather than a line of the file: no numbers, no tint.
        <div className="grid grid-cols-[3rem_3rem_1rem_1fr] text-muted-foreground/60">
          <span />
          <span />
          <span />
          <code className="pr-3 whitespace-pre">\ No newline at end of file</code>
        </div>
      )}
    </>
  );
}
