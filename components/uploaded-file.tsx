"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronRight, Download, FileUp, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTRPC } from "@/trpc/client";
import { formatBytes, previewKindOf } from "@/lib/uploads/file-types";

/**
 * One uploaded file: what it is, a preview where a browser can show one, and a download.
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
 */
export function UploadedFileRow({
  submissionId,
  filename,
  sizeBytes,
  isLate = false,
  label = "The file you submitted",
  previewByDefault = false,
}: {
  submissionId: string;
  filename: string;
  sizeBytes: number | null;
  isLate?: boolean;
  label?: string;
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

  const previewKind = previewKindOf(filename);
  const [open, setOpen] = React.useState(previewByDefault && previewKind !== null);

  const download = useMutation(
    trpc.submissions.uploadUrl.mutationOptions({
      onSuccess: ({ url }) => {
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
      },
      onError: (err) => setError(err.message),
    }),
  );

  const preview = useMutation(
    trpc.submissions.uploadUrl.mutationOptions({
      onSuccess: ({ url }) => setPreviewUrl(url),
      onError: (err) => setError(err.message),
    }),
  );

  /*
    Fetched when the preview is first opened and then kept, rather than re-signed on every
    toggle. Collapsing and expanding a document is not a new request for it, and a fresh URL
    each time would restart a large PDF's loading.
  */
  React.useEffect(() => {
    if (!open || previewKind === null) return;
    if (previewUrl !== null || preview.isPending) return;
    preview.mutate({ submissionId, disposition: "inline" });
    // Deliberately keyed on what decides whether a fetch is owed, not on the mutation object,
    // which is a new reference on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewKind, previewUrl, submissionId]);

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <FileUp className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">
            {label}
            {isLate ? " (late)" : ""}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {filename}
            {sizeBytes === null ? "" : ` — ${formatBytes(sizeBytes)}`}
          </span>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={download.isPending}
        onClick={() => download.mutate({ submissionId, disposition: "attachment" })}
      >
        {download.isPending ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <Download data-icon="inline-start" />
        )}
        {download.isPending ? "Preparing…" : "Download"}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
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
            {open ? "Hide" : "Show"} {previewKind === "pdf" ? "the document" : "the image"}
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="mt-2">
              {previewUrl === null ? (
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
                  className="h-[70vh] min-h-80 w-full rounded-md border border-border bg-muted/30"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={filename}
                  className="max-h-[70vh] w-auto max-w-full rounded-md border border-border"
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
