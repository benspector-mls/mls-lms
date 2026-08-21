"use client";

import { ChevronRight, FileText } from "lucide-react";
import * as React from "react";

import { SubmittedLinkHeading, SubmittedLinkRow } from "@/components/submitted-link";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DRIVE_DOC_KIND_LABEL, driveEmbedUrl, parseDriveDocUrl } from "@/lib/drive/embed";
import { cn } from "@/lib/utils";

/**
 * A Google document a student handed in, read in place.
 *
 * **The counterpart of `UploadedFileRow` for work that was linked rather than uploaded**, and for
 * the same reason that one exists: grading a cohort by opening twenty-five documents in
 * twenty-five tabs and matching each one back to a name is most of the work of grading them. So
 * the document sits in the column beside the grade, and reading the work and writing about it
 * become one screen instead of two.
 *
 * **The address stays on screen even with the document under it.** That is not habit — the
 * commonest mistake on a Drive assignment is handing in the instructor's template rather than
 * your own copy of it, and the two are told apart by the tail of the URL. `SubmittedLinkHeading`
 * is shared with `SubmittedLinkRow` so that the fact cannot be lost by drawing this card
 * differently.
 *
 * **Nothing here asks Google anything.** The frame is a page the instructor's own browser fetches,
 * with their own session, which is what makes a document shared to the school open through
 * **Open** even when it will not render in a cross-origin frame. The alternative — this server
 * checking whether a document is readable before showing it — cannot tell "not shared" from
 * "no such document", because Google answers 404 to an anonymous request either way. It would buy
 * a request per card, a state per outcome, and a worse answer than the frame gives by rendering.
 */
export function SubmittedDocumentRow({
  url,
  label,
  isLate = false,
  previewByDefault = false,
  className,
}: {
  url: string;
  /** What this document is to the reader — the student's own work, or a student's. */
  label: string;
  isLate?: boolean;
  /**
   * Open the document without being asked. True on the review screen, where reading the work is
   * the whole reason the instructor is there, and false on the student's own page, where they
   * know what they handed in and only want to check that it arrived.
   */
  previewByDefault?: boolean;
  className?: string;
}) {
  const ref = parseDriveDocUrl(url);
  const [open, setOpen] = React.useState(previewByDefault);

  /*
    Not a document this application can show, so the card is the one for an address: the link, the
    host, and a way to open it. Decided here rather than at each call site, so a screen cannot
    render a frame for a Canva board by forgetting to ask.

    Deliberately the same function the frame's address is built from. A parser that said yes here
    and a builder that produced something else would split the pane for a document and then fail
    to show it, which is the one failure with nothing on screen to explain it.
  */
  if (!ref) {
    return <SubmittedLinkRow url={url} label={label} isLate={isLate} className={className} />;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-background p-4",
        className,
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        {/*
          Above the trigger rather than wrapped by it, for the reason `UploadedFileRow` gives: the
          heading holds the **Open** anchor, and an anchor inside a button is invalid markup and
          unreachable by keyboard.
        */}
        <SubmittedLinkHeading url={url} label={label} isLate={isLate} icon={FileText} />

        {/*
          **"Hide the document", in those words.** It is the documented way an instructor takes the
          width of the pane back — named in FEATURES.md and in the "No toggle, deliberately" note
          in ARCHITECTURE.md, because no screen here stores an interface preference. An uploaded
          file already offers it under this name, and a Drive document in the same column has to
          offer the same thing under the same name or the documented way out is missing for half
          the kinds that reach this column.
        */}
        <CollapsibleTrigger className="group mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 transition-transform group-data-[panel-open]:rotate-90"
          />
          {open ? "Hide" : "Show"} the document
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 flex flex-col gap-2">
            {/*
              Mounted only once opened. A collapsed card that had already loaded a Google editor
              page would be a third-party page load nobody asked for, on a screen whose subject is
              the grade beside it.
            */}
            {open && (
              <iframe
                src={driveEmbedUrl(ref)}
                title={`${label} — ${DRIVE_DOC_KIND_LABEL[ref.kind]}`}
                /*
                  The same box an uploaded PDF gets, to the class: the two are the same thing in
                  the same column for two different kinds of assignment, so they are the same size.

                  There is no counterpart here to the `#toolbar=0&view=FitH` fragment that card
                  sends. That one addresses a PDF viewer the *browser* supplies; a Google page
                  draws its own chrome, which Google decides and a fragment cannot change.
                */
                className="h-[70vh] min-h-80 w-full rounded-md border border-border bg-muted/30"
                /*
                  Empty rather than omitted. An empty permissions policy is what a cross-origin
                  frame gets by default, so this changes nothing mechanically and puts the intent
                  on the page: a document needs no camera, no microphone, no geolocation and no
                  payment handler. The opposite decision from `resource-item.tsx`, which lists a
                  narrow set because a video *player* needs features to play.
                */
                allow=""
                /*
                  No `sandbox`, and it is the attribute a reviewer asks about. Every Google editor
                  surface is script-rendered, so `sandbox` without `allow-scripts` renders nothing
                  at all — and a token list one entry short breaks the frame in a way that looks
                  exactly like a sharing problem, which is the confusion this card exists to
                  remove. What protects this page is cross-origin isolation, already in force: the
                  frame is a Google page, it cannot read this document, and the only thing a
                  student controls about it is which document id.
                */
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}

            {/*
              One sentence, said whether or not the frame rendered, because a page cannot be told
              that a cross-origin frame drew an error.

              What Google shows in that case is its own request-for-access page, which is clear
              about what it is and silent about which side is wrong — so this names the two ways it
              happens and who can fix each. The second sentence matters even where link sharing is
              the norm: a document shared with the school reads perfectly for a signed-in
              instructor in a new tab and never renders here, because the frame has no access to
              their Google session.
            */}
            <p className="text-xs text-muted-foreground">
              If Google asks for access above, the student has not shared this document — ask them
              to set it to “Anyone with the link can view”. If they shared it with the school
              instead, <span className="font-medium text-foreground">Open</span> still works for you
              even though the preview cannot.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
