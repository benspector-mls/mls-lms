"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronRight, Download, FileUp, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { insetSurface, panelSurface } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { UploadedCode } from "@/components/uploaded-code";
import { useTRPC } from "@/trpc/client";
import { formatDateTime, LATENESS_META } from "@/lib/status";
import type { Lateness } from "@/lib/submissions/hand-in";
import { formatBytes, previewKindOf } from "@/lib/uploads/file-types";
import { cn } from "@/lib/utils";

/**
 * One uploaded file: what it is, a view of it where there is one to give, and a download.
 *
 * The reason neither the preview nor the download can be a plain link is the same: **the bucket
 * is private, so there is no URL that keeps working.** Both are signed for one request by a
 * procedure that authorized the caller, which is what makes that procedure the only route to
 * the bytes.
 *
 * **The preview is the point on the instructor's side.** Grading a cohort of resumes by
 * downloading twenty-five PDFs, opening each in a separate application, and matching filenames
 * back to students is most of the work of grading them. An embedded viewer makes reading the
 * work part of the same screen as writing the feedback. It is the browser's own PDF viewer in an
 * iframe rather than a bundled one: no dependency, no worker file to serve, and it is the viewer
 * the instructor already knows.
 *
 * **Code takes the other route, and that is why `previewKindOf` says which.** No browser has a
 * viewer for a Python script, so `UploadedCode` reads the text through a procedure of its own and
 * colours it — which means no signed URL is minted for it, and the effect below is skipped. The
 * download button is the same button either way.
 */
/**
 * Whose bytes these are, which decides which procedure signs the link.
 *
 * A submission's attachment or a goal update's, never both. Two ids rather than one callback,
 * because the minting stays inside the component that already owns it and the callers hand over
 * nothing but a row's id — the `VerdictMark` precedent for one component two screens render.
 */
type Source =
  | { artifactId: string; attachmentId?: undefined; programId?: undefined }
  | { attachmentId: string; programId: string; artifactId?: undefined };

export function UploadedFileRow({
  filename,
  sizeBytes,
  lateness = "onTime",
  label = "The file you submitted",
  addedAt,
  previewByDefault = false,
  ...source
}: Source & {
  filename: string;
  sizeBytes: number | null;
  /**
   * Whether this arrived on time, by a deadline agreed with an instructor, or late.
   *
   * A verdict rather than the `isLate` boolean it replaces, because those are not the same
   * question: work handed in by an agreed deadline is late by the column and not by the word a
   * fellow should be shown for it. `lateness` in lib/submissions/hand-in.ts is what decides.
   */
  lateness?: Lateness;
  label?: string;
  /**
   * When this file arrived, shown beside the label.
   *
   * Passed where a submission can hold more than one attachment, which in practice means a
   * resubmission: two documents with similar names, and the only thing that says which one the
   * grade is about is which of them came second. An absolute time rather than "4 days ago",
   * because a fellow who fixes something the same afternoon produces two attachments that are
   * both "4 days ago" and are told apart by the hour.
   */
  addedAt?: Date | null;
  /**
   * Open the preview without being asked. True on the review screen, where reading the work is
   * the whole reason the instructor is there, and false on the student's own page, where they
   * know what they handed in and only want to check that it arrived.
   */
  previewByDefault?: boolean;
}) {
  const trpc = useTRPC();
  const [error, setError] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  /*
    Code is read as text through `submissions.uploadText`, which has no counterpart for a goal
    update's file and is not worth one: screenshots and documents are what gets attached to a
    goal. So a `.py` on an update is offered as a download, like a file with no viewer at all.
  */
  const kind = previewKindOf(filename);
  const previewKind = source.artifactId === undefined && kind === "code" ? null : kind;

  const viaSubmission = useMutation(trpc.submissions.uploadUrl.mutationOptions());
  const viaAttachment = useMutation(trpc.coaching.updateAttachmentUrl.mutationOptions());
  const minting = viaSubmission.isPending || viaAttachment.isPending;

  /** A signed link to the bytes, from whichever procedure owns them. */
  const mint = (disposition: "attachment" | "inline") =>
    source.artifactId !== undefined
      ? viaSubmission.mutateAsync({ artifactId: source.artifactId, disposition })
      : viaAttachment.mutateAsync({
          programId: source.programId,
          attachmentId: source.attachmentId,
          disposition,
        });

  /*
    Whether a link to the bytes is what shows this file. A PDF and an image are handed to the
    browser and need one; code is read as text by `UploadedCode`, which asks for its own, so
    minting a signed URL for it would be an unused thirty-minute link in the page.
  */
  const framed = previewKind === "pdf" || previewKind === "image";

  const [open, setOpen] = React.useState(previewByDefault && previewKind !== null);

  const [downloading, setDownloading] = React.useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const { url } = await mint("attachment");
      setError(null);
      /*
        An anchor clicked from script rather than assigning `location`. The signed URL answers
        with `Content-Disposition: attachment`, so this saves the file without navigating away
        from a report the instructor is part-way through writing — and unlike `window.open` it
        is not treated as a popup, which Safari blocks when it happens after an await.
      */
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That link could not be made.");
    } finally {
      setDownloading(false);
    }
  };

  /*
    Fetched when the preview is first opened and then kept, rather than re-signed on every
    toggle. Collapsing and expanding a document is not a new request for it, and a fresh URL
    each time would restart a large PDF's loading.
  */
  const sourceKey = source.artifactId ?? source.attachmentId;
  React.useEffect(() => {
    if (!open || !framed) return;
    if (previewUrl !== null || minting) return;
    mint("inline")
      .then(({ url }) => setPreviewUrl(url))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "That preview could not be opened."),
      );
    // Deliberately keyed on what decides whether a fetch is owed, not on the mutation objects,
    // which are new references on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, framed, previewUrl, sourceKey]);

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <FileUp className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
            <span>
              {label}
              {lateness === "onTime" ? "" : ` (${LATENESS_META[lateness].label.toLowerCase()})`}
            </span>
            {addedAt && (
              <span className="text-xs font-normal text-muted-foreground">
                Added {formatDateTime(addedAt)}
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {filename}
            {sizeBytes === null ? "" : ` — ${formatBytes(sizeBytes)}`}
          </span>
        </div>
      </div>

      <Button variant="outline" size="sm" disabled={downloading} onClick={download}>
        {downloading ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <Download data-icon="inline-start" />
        )}
        {downloading ? "Preparing…" : "Download"}
      </Button>
    </div>
  );

  return (
    <div className={cn(panelSurface, "flex flex-col gap-2 p-4")}>
      {previewKind === null ? (
        heading
      ) : (
        <Collapsible open={open} onOpenChange={setOpen}>
          {heading}

          {/*
            The trigger sits below the heading rather than wrapping it, because the heading holds
            the download button and a button inside a button is invalid markup.
          */}
          <CollapsibleTrigger className="group mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-data-[panel-open]:rotate-90"
            />
            {open ? "Hide" : "Show"}{" "}
            {previewKind === "pdf"
              ? "the document"
              : previewKind === "code"
                ? "the code"
                : "the image"}
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="mt-2">
              {previewKind === "code" && source.artifactId !== undefined ? (
                <UploadedCode artifactId={source.artifactId} filename={filename} />
              ) : previewUrl === null ? (
                <div className="flex h-24 items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Opening…
                </div>
              ) : previewKind === "pdf" ? (
                <iframe
                  /*
                    Two instructions to the browser's own viewer, in the fragment.

                    `toolbar=0` puts away the strip of buttons across the top. It is the whole
                    strip or none of it — a page cannot choose which of those buttons it keeps —
                    and the whole strip is the right answer here, because it has a minimum width
                    of its own and side-scrolls the document out from under itself in a column
                    beside the grade. Nothing on it is missed: **Download** is the button beside
                    this preview, and drawing, printing and summarizing are not what an instructor
                    came to this screen for.

                    `view=FitH` opens the document fitted to the width of whatever column it is
                    in, rather than at whatever zoom the viewer would have picked. That is what
                    makes the buttons unnecessary rather than merely absent: scrolling moves
                    through the pages and ctrl+scroll changes the size.

                    **A fragment is never sent to the server**, so neither of these can affect the
                    signature on the URL. Chrome honours them; Firefox and Safari ignore them and
                    show their own toolbars, which is a difference in what an instructor sees and
                    not in what they can do.
                  */
                  src={`${previewUrl}#toolbar=0&view=FitH`}
                  title={filename}
                  // Tall enough to read a page of a resume without scrolling the page itself,
                  // and viewport-relative so it is usable on a laptop and on a large monitor.
                  className={cn(insetSurface, "h-[70vh] min-h-80 w-full")}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={filename}
                  className={cn(insetSurface, "max-h-[70vh] w-auto max-w-full")}
                />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
