"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import * as React from "react";

import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDiffHighlight } from "@/hooks/use-diff-highlight";
import {
  changedRanges,
  parseUnifiedPatch,
  type ChangedRange,
  type DiffHunk,
  type DiffLine,
} from "@/lib/diff/patch";
import { DIFF_KIND_META, TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
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
  submissionId,
  file,
  open,
  onOpenChange,
}: {
  submissionId: string;
  file: DiffFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /*
    A Markdown file opens rendered, because a short response is answered inside the template's own
    file and reading the answers is why it is opened. Every Markdown file follows the one rule, a
    README in a coding project included, since telling the two apart would need something to tell
    them apart by. A removed file has no final version to render.
  */
  const previewable = file.language === "markdown" && file.kind !== "removed";
  const [view, setView] = React.useState<"preview" | "diff">("preview");
  const showsPreview = previewable && view === "preview";

  const hunks = React.useMemo(
    () => (open && file.patch !== null ? parseUnifiedPatch(file.patch).hunks : null),
    [open, file.patch],
  );

  // Coloured only when the diff is what is showing; the preview has no use for the tokens.
  const tokens = useDiffHighlight(showsPreview ? null : hunks, file.language);

  /*
    The lines of the new file this pull request added, which the preview shades. None for a file
    the pull request created: every block of it is the fellow's, and shading all of them says
    nothing that the sentence above the preview does not.
  */
  const changedLines = React.useMemo(() => {
    if (!hunks || file.kind === "added") return undefined;
    const added = new Set<number>();
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.kind === "add" && line.newLine !== null) added.add(line.newLine);
      }
    }
    return added;
  }, [hunks, file.kind]);

  // Indexed the same way as `tokens`: the nth line drawn is the nth entry.
  const changed = React.useMemo(() => (hunks ? changedRanges(hunks) : null), [hunks]);

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
            {previewable && (
              <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
                {(["preview", "diff"] as const).map((option) => (
                  <Button
                    key={option}
                    size="xs"
                    variant={view === option ? "default" : "outline"}
                    aria-pressed={view === option}
                    onClick={() => setView(option)}
                  >
                    {option === "preview" ? "Preview" : "Diff"}
                  </Button>
                ))}
              </div>
            )}

            {showsPreview ? (
              <MarkdownPreview
                submissionId={submissionId}
                file={file}
                changedLines={changedLines}
              />
            ) : file.patch === null ? (
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
                {/*
                  Long lines wrap rather than scroll. A horizontal scrollbar here would be a second
                  scroller inside the column that already scrolls, and a reader dragging it would lose
                  the gutter and the marker that say which line they are looking at.
                */}
                <div className="font-mono text-xs">
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
                        changed={changed?.[row.index] ?? null}
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
                    This diff is too large to show in full.{" "}
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
 * A Markdown file as the fellow left it, rendered, with the blocks this pull request added shaded.
 *
 * Fetched only while it is showing, and through a query, so stepping back to a student or
 * switching between Preview and Diff reads it from the cache. The loading and error states are the
 * ones `UploadedCode` uses, for the same reasons: the error is a sentence about the file, and a
 * retry would read the same file again.
 */
function MarkdownPreview({
  submissionId,
  file,
  changedLines,
}: {
  submissionId: string;
  file: DiffFile;
  changedLines: ReadonlySet<number> | undefined;
}) {
  const trpc = useTRPC();
  const contents = useQuery(
    trpc.pullRequests.fileAtHead.queryOptions({ submissionId, path: file.path }),
  );

  if (contents.isPending) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Opening…
      </div>
    );
  }

  if (contents.error) {
    return <p className="px-3 py-2.5 text-xs text-muted-foreground">{contents.error.message}</p>;
  }

  /*
    Named for the shading rather than the bar, because a phone shows the shading alone. A patch
    this application cut leaves the lines after the cut unknown, so the sentence says so rather
    than letting an unshaded answer read as template text.
  */
  const legend =
    file.kind === "added"
      ? "This file is new in this pull request, so all of it is the fellow's writing."
      : file.truncated
        ? "Passages shaded green were added in this pull request. The diff is too large to show " +
          "in full, so some later changes may not be shaded."
        : "Passages shaded green were added in this pull request.";

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <p className="text-xs text-muted-foreground">{legend}</p>
      <Markdown content={contents.data.text} reading changedLines={changedLines} />
    </div>
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

/** The darker shade over the characters that changed within a row, on top of `LINE_TINT`. */
const CHANGED_TINT = {
  add: "bg-emerald-500/25 dark:bg-emerald-400/25",
  remove: "bg-destructive/20 dark:bg-destructive/35",
  context: "",
} as const;

const LINE_MARKER = { add: "+", remove: "−", context: "" } as const;

type Piece = { content: string; htmlStyle?: Record<string, string> };

/**
 * The line's pieces, cut again wherever the changed range begins or ends, each marked with whether
 * it lies inside the range.
 *
 * Needed because the range is measured in characters and a syntax-coloured piece can be a whole
 * identifier: in `attackerRef.isEmpty` the edit may begin partway through a piece, and shading the
 * whole piece would mark characters that did not change.
 */
function splitAtRange(pieces: Piece[], range: ChangedRange | null) {
  if (!range) return pieces.map((piece) => ({ ...piece, changed: false }));

  const out: (Piece & { changed: boolean })[] = [];
  let offset = 0;
  for (const piece of pieces) {
    const end = offset + piece.content.length;
    const cuts = [
      offset,
      Math.min(Math.max(range.start, offset), end),
      Math.min(Math.max(range.end, offset), end),
      end,
    ];
    for (let k = 0; k < 3; k += 1) {
      if (cuts[k] === cuts[k + 1]) continue;
      out.push({
        content: piece.content.slice(cuts[k] - offset, cuts[k + 1] - offset),
        htmlStyle: piece.htmlStyle,
        changed: k === 1,
      });
    }
    offset = end;
  }
  return out;
}

function CodeLine({
  line,
  tokens,
  changed,
}: {
  line: DiffLine;
  tokens: Piece[] | null;
  changed: ChangedRange | null;
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
        {/*
          `wrap-anywhere` rather than `break-words`: a minified line or a long URL has no space to
          break at, and `break-words` leaves such a line to widen the grid column instead.
        */}
        <code className="shiki-code min-w-0 pr-3 whitespace-pre-wrap wrap-anywhere">
          {splitAtRange(tokens ?? [{ content: text }], changed).map((piece, index) => (
            <span
              key={index}
              style={piece.htmlStyle as React.CSSProperties}
              className={piece.changed ? CHANGED_TINT[line.kind] : undefined}
            >
              {piece.content}
            </span>
          ))}
          {carriageReturn && (
            <span
              className={cn(
                "text-muted-foreground/60",
                // The range reaches past the visible text only when it covers the carriage return.
                changed && changed.end > text.length && CHANGED_TINT[line.kind],
              )}
            >
              ␍
            </span>
          )}
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
