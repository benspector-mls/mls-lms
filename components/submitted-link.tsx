import { Link2 } from "lucide-react";

import { panelSurface } from "@/components/ui/card";
import { formatDateTime, LATENESS_META, linkHost } from "@/lib/status";
import type { Lateness } from "@/lib/submissions/hand-in";
import { cn } from "@/lib/utils";

/**
 * What a submitted link says about itself: where it goes, written out, and clickable.
 *
 * **The URL itself is the feature, and it is also the control.** This used to be a button reading
 * "Open what the student submitted" and nothing else, which asks an instructor to click into an
 * address they have not been shown — from a page of forty students, in a browser signed into a
 * school account, onto whatever a student pasted. A submitted link is untrusted input in a way an
 * uploaded file is not: the file goes to a private bucket this application controls, and the link
 * goes anywhere. Reading the address and following it are now one thing in one place, so the
 * address cannot be skipped on the way to opening it, and the row keeps a button's width for the
 * controls that are not simply "go where this goes".
 *
 * Seeing it also catches the ordinary mistakes, which are far more common than the alarming ones.
 * A Drive assignment submitted as `docs.google.com/document/d/…/template` is the instructor's own
 * template rather than the student's copy; one submitted as a `localhost` address or a bare file
 * path is a paste that never had a chance of working. Every one of those is obvious from the text
 * and invisible behind a button.
 *
 * The host is drawn separately and first because it is the part worth reading, and the full
 * address underneath in a monospace face that wraps rather than truncates — a URL cut off at the
 * width of a column hides its own tail, which is exactly where a wrong one differs.
 *
 * **Its own component because two cards need it identically.** `SubmittedLinkRow` below is the
 * whole card for an address this application cannot show; `SubmittedDocumentRow` puts a frame
 * under this same heading for one it can. Sharing the markup is what stops the two from drifting
 * into looking like different kinds of thing, when they are one fact about a submission — and it
 * is what guarantees the address stays on screen even once the document is there to read.
 */
export function SubmittedLinkHeading({
  url,
  label,
  lateness = "onTime",
  addedAt,
  icon: Icon = Link2,
  actions,
}: {
  url: string;
  /** What this link is to the reader — the student's own work, or a student's. */
  label: string;
  /**
   * Whether this arrived on time, by a deadline agreed with an instructor, or late.
   *
   * A verdict rather than the `isLate` boolean it replaces, because those are not the same
   * question: work handed in by an agreed deadline is late by the column and not by the word a
   * fellow should be shown for it. `lateness` in lib/submissions/hand-in.ts is what decides.
   */
  lateness?: Lateness;
  /**
   * When this link was attached, shown beside the label. See `UploadedFileRow`, which draws the
   * same line for the same reason: on a resubmission the attachment worth reading is the last
   * one to arrive, and nothing else on the card says which that is.
   */
  addedAt?: Date | null;
  /** Overridden where the link turns out to be a document, so the row is headed like one. */
  icon?: React.ElementType;
  /**
   * Controls at the right end of the row, opposite the address.
   *
   * Passed in rather than drawn here, because this heading does not know whether there is anything
   * under it to put away — a link this application cannot show has nothing, and a card offering to
   * hide nothing would be a control over empty space.
   */
  actions?: React.ReactNode;
}) {
  const host = linkHost(url);

  return (
    /*
      **One line, and the address gives way rather than the controls.** A submitted address is
      usually long enough to fill this row on its own, so a row allowed to wrap put whatever sits
      beside it on a second line — and since the length of the address decided that, the control
      landed in a different place on every card. An instructor working down a column of submissions
      then had to look for it on each one rather than move the pointer to where it was on the last.

      Not wrapping is what pins it. The address shrinks instead: it may shrink below the width of
      its own contents, which `min-w-0` is what permits, and it scrolls within whatever is left.
      The controls are `shrink-0`, so the room comes out of the address and never out of them.
    */
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
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
          {/*
            **One line that scrolls, rather than truncation or a wrap.**

            All three of a wrong address's tells are at its end: the document id, the `/template`
            where an `/edit` should be, the `localhost` that never had a chance of working. So an
            ellipsis is the one treatment this cannot have — it hides exactly the part worth
            checking, and hides that it is hiding it.

            Scrolling keeps the whole address reachable while costing the card one line. Wrapping
            also showed all of it, but a long address then grew the card by three or four lines in a
            column where the thing being read is the work below, and the height of the heading came
            out of that.

            **`no-scrollbar`, because the bar would be drawn across the address itself.** This is
            one line of small text, and on a platform that gives a scrollbar real space rather than
            floating it — Windows — the bar sits under the descenders of the very characters it is
            there to reveal. The address stays reachable without it: a swipe or a shift-wheel moves
            it, and tabbing to it scrolls it into view.

            **`w-fit`, so the box ends where the address does.** Stretched to the row it would be a
            band of blank space that navigates when clicked, which is how an instructor opens a
            student's link by missing what they were aiming at. `max-w-full` is what still lets it
            scroll once the address is longer than the room.

            **An anchor only where `linkHost` accepted the address**, which is what keeps a
            `javascript:` submission from becoming a script that runs on an instructor's signed-in
            page. Refusing at the point the element is created is the version of this that cannot
            be got wrong later — a check that only stopped the click would leave the href in the
            document for anything else to find.
          */}
          {host ? (
            <a
              href={url}
              target="_blank"
              /*
                `noopener` as well as `noreferrer`, and it is not decoration here: this is a link a
                student chose, and without it the page it opens gets a handle on this one through
                `window.opener` and can navigate it somewhere else.
              */
              rel="noreferrer noopener"
              /*
                Underlined standing rather than on hover. Nothing else here is clickable, and an
                address that only announces itself under the pointer is one an instructor has to
                discover by waving at it.
              */
              className="no-scrollbar w-fit max-w-full overflow-x-auto font-mono text-xs whitespace-nowrap text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-current"
            >
              {url}
            </a>
          ) : (
            <span className="no-scrollbar w-fit max-w-full overflow-x-auto font-mono text-xs whitespace-nowrap text-muted-foreground">
              {url}
            </span>
          )}
        </div>
      </div>

      {/*
        The right end of the row, drawn only where something was handed to it. Opening the link is
        no longer a control here — the address is — so a card with nothing to collapse has nothing
        at this end and the address takes the whole row.
      */}
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A link a student handed in that this application cannot show: the address, and a way to open it.
 *
 * The counterpart of `UploadedFileRow`, deliberately the same shape and the same position on both
 * screens: the two are the same fact about a submission for the two kinds that carry it. Where the
 * address turns out to be a document — a Google Doc, a Sheet, a deck — `SubmittedDocumentRow`
 * takes over and puts the document itself under this heading.
 */
export function SubmittedLinkRow({
  url,
  label,
  lateness = "onTime",
  addedAt,
  className,
}: {
  url: string;
  label: string;
  /**
   * Whether this arrived on time, by a deadline agreed with an instructor, or late.
   *
   * A verdict rather than the `isLate` boolean it replaces, because those are not the same
   * question: work handed in by an agreed deadline is late by the column and not by the word a
   * fellow should be shown for it. `lateness` in lib/submissions/hand-in.ts is what decides.
   */
  lateness?: Lateness;
  /** When it was attached — see `SubmittedLinkHeading`, which draws it. */
  addedAt?: Date | null;
  className?: string;
}) {
  const host = linkHost(url);

  return (
    <div className={cn(panelSurface, "flex flex-col gap-3 p-4", className)}>
      <SubmittedLinkHeading url={url} label={label} lateness={lateness} addedAt={addedAt} />

      {host ? (
        <p className="text-xs text-muted-foreground">
          Opens <span className="font-medium text-foreground">{host}</span> in a new tab.
        </p>
      ) : (
        /*
          Said rather than left as a missing button. Submissions predating the scheme check can
          hold one of these, and an instructor looking at work they cannot open needs to know it
          is the submission that is wrong rather than the screen.
        */
        <p className="text-xs text-destructive">
          This is not a web address that can be opened. Ask for it to be submitted again.
        </p>
      )}
    </div>
  );
}
