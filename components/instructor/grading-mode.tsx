"use client";

import Link from "next/link";
import * as React from "react";
import { ChevronLeft, ChevronRight, List, Maximize2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Grading mode: the screen with everything on it that is not the work.
 *
 * The two grading screens are a list beside a submission, and the list is worth its 360px while
 * an instructor is choosing what to work on. It stops being worth them the moment they have
 * chosen, and settled in to go down a cohort one student at a time — at which point the list, the
 * application sidebar and the width they take are all in the way of the two things actually being
 * read: the student's document and the feedback being written about it.
 *
 * So the mode collapses both and offers what is left of the list as this bar, with the list
 * itself a sheet the bar's leftmost button slides in when it is wanted. On a 1440px window that
 * hands the review pane about 1390px instead of about 820px, which is what takes it from too
 * narrow to hold the document beside the grade to comfortably wide enough — the split is a width
 * the pane either has or does not, and this is how a laptop gets it.
 *
 * Below the `lg` breakpoint this is not a mode but the layout: the screens have no room for a
 * docked list, so the bar is always shown and the list is only ever the sheet. One presentation
 * at every width, entered by a button where there is a wider one to come back to.
 *
 * One component for both screens. The grading queue's list is one assignment's students and the
 * student overview's is one student's assignments, but the shape either side of the divider is the
 * same, and so is what an instructor does with it.
 */

/**
 * The mode itself, and the only thing here that touches the application sidebar.
 *
 * What it was before is remembered rather than assumed, so an instructor who already works with
 * the sidebar collapsed is not handed it back expanded on the way out.
 *
 * **The restore also runs on unmount**, which is not tidiness. `setOpen` writes the `sidebar_state`
 * cookie, so a session left through the breadcrumb rather than through the Exit button would
 * otherwise leave every other screen in the application collapsed, with nothing to say why.
 */
export function useGradingMode() {
  const { isMobile, open, setOpen } = useSidebar();
  const [on, setOn] = React.useState(false);

  /*
    Putting the sidebar back, held in a ref because one of the two callers is the unmount cleanup
    below — which is registered once and would otherwise call `setOpen` from the first render
    forever, and `setOpen` is a new function whenever the sidebar's own state changes.
  */
  const before = React.useRef<boolean | null>(null);
  const restore = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    restore.current = () => {
      if (before.current !== null && !isMobile) setOpen(before.current);
      before.current = null;
    };
  });

  React.useEffect(() => () => restore.current(), []);

  return {
    on,
    enter: () => {
      // On a phone the sidebar is a sheet that is already shut, so there is nothing to collapse
      // and nothing to put back.
      if (!isMobile) {
        before.current = open;
        setOpen(false);
      }
      setOn(true);
    },
    exit: () => {
      restore.current();
      setOn(false);
    },
  };
}

/*
  The way into grading mode and the way out.

  The way in is drawn only at `lg` and up, because a narrower window has no room for the work and
  the report side by side. The way out is drawn at every width while the mode is on. The review pane
  stays in two columns until the mode ends, so an instructor who narrows the window after entering
  the mode still needs a way back to one column.
*/

/** The way into grading mode, drawn in the list below its filter tabs. */
export function GradingModeButton({
  onEnter,
  className,
}: {
  onEnter: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onEnter}
      className={cn("max-lg:hidden", className)}
    >
      <Maximize2 data-icon="inline-start" />
      Grading mode
    </Button>
  );
}

/** The way out of grading mode, drawn in the grading mode bar beside the list button. */
function GradingModeExitButton({ onExit }: { onExit: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onExit}>
      <Minimize2 data-icon="inline-start" />
      Exit Grading Mode
    </Button>
  );
}

/**
 * The bar that replaces the list in grading mode. It holds a button that opens the list, the way
 * out of the mode, Previous and Next, and the name and status of what is open.
 *
 * **Movement follows the list as it is currently filtered.** The rows arrive in the order they
 * were drawn, so a search narrowed to one group, or the To do tab, is still in force here — Next
 * means the next one an instructor was actually looking at. The leftmost button says which filter
 * that is and how many rows it holds, and pressing it slides the list itself in as a sheet — the
 * whole list, with its search, its tabs and its badges, which is everything the jump dropdown it
 * replaced could not carry.
 *
 * Movement on the left, directly above where the queue list used to sit; the open row's name and
 * state on the right, because the pane below draws no header of its own.
 */
export function GradingModeBar({
  submissions,
  currentId,
  currentLabel,
  currentHref,
  currentDetail,
  listLabel,
  badges,
  onSelect,
  onOpenList,
  onExit,
  className,
}: {
  /** Every submission in the list, in the order it is drawn, under the name to reach it by. */
  submissions: { id: string; label: string }[];
  /** The one open, which may not be in the list at all — see below. */
  currentId: string | null;
  /** The open row's own name — a team's, a student's, an assignment's — shown beside its badges. */
  currentLabel: string | null;
  /**
   * Where that name leads — the same address the row in the list carries.
   *
   * This mode puts the list away, so the bar holds the only name on the screen, and the way
   * through to what that name is about has to be here or nowhere. A fellow's name leads to their
   * record in the course, an assignment's title to that assignment's queue. A team's name leads
   * nowhere, because a team has no screen of its own, and that caller passes nothing.
   */
  currentHref?: string;
  /** Beside the name, muted, as the row in the list draws it — who is on a team. */
  currentDetail?: string;
  /** What the list is currently showing, in the words its own tab uses. */
  listLabel: string;
  /**
   * The open submission's state — its status, whether it was late, whether a draft is waiting,
   * and the conversation on it. In this bar because the pane below has no header of its own:
   * this is where the open row's state stands beside its name, and it is the same set of pills
   * the row in the list carries, so putting the list away loses nothing. Whichever list this bar
   * fronts decides what state means for its rows, so the badges come in rather than being read
   * off a submission here.
   */
  badges?: React.ReactNode;
  onSelect: (id: string) => void;
  /** Slides the list in as a sheet over the pane. */
  onOpenList: () => void;
  /**
   * Leaves grading mode. Absent outside grading mode, where this bar serves as the header on a
   * narrow window and there is no mode to leave.
   */
  onExit?: () => void;
  className?: string;
}) {
  const at = currentId === null ? -1 : submissions.findIndex((row) => row.id === currentId);

  /*
    Nothing to move through, and every control says so.

    A submission can legitimately be open and not in the list beside it: a student who has left the
    cohort, one outside the group selected, one member's copy of their team's grade. The pane says
    which of those it is; this says only that Previous and Next have nowhere to go, which is the
    honest answer and better than a control that names somebody else's work.
  */
  const previous = at > 0 ? submissions[at - 1] : null;
  const next = at >= 0 && at < submissions.length - 1 ? submissions[at + 1] : null;

  return (
    /*
      One line from `md` up, two below it.

      Below `md`, one line has no room for the buttons, the name of what is open, and its status
      pills. So the first line holds the buttons and the name, and the pills move to a second line.

      The first line is a wrapper with `md:contents`, which makes its children items of this row
      from `md` up. Their `order` classes then arrange the one line: the list button, a spacer, the
      pills, the name, then Previous and Next.
    */
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-b border-border bg-card px-3 py-2 md:flex-row md:items-center",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 md:contents">
        <Button variant="outline" size="sm" onClick={onOpenList}>
          <List data-icon="inline-start" />
          {listLabel}
          <span className="text-muted-foreground tabular-nums">({submissions.length})</span>
        </Button>
        {onExit && <GradingModeExitButton onExit={onExit} />}

        {/*
          Everything after this is right-aligned, and an element that grows says so at both widths
          — an `ml-auto` on the name would compete with one on the pills for the same free space
          and leave the two of them adrift in the middle of the bar.
        */}
        <div aria-hidden="true" className="flex-1 md:order-2" />

        {/*
          The name of what is open. When the line is too narrow for it, the name scrolls sideways
          with its scroll bar hidden, so the whole name stays reachable without pushing Previous and
          Next off the line. `title` also shows it in full on hover.
        */}
        {currentLabel && (
          <span
            className="no-scrollbar min-w-0 overflow-x-auto text-sm font-medium whitespace-nowrap md:order-4"
            title={currentDetail ? `${currentLabel} · ${currentDetail}` : currentLabel}
          >
            {currentHref ? (
              <Link href={currentHref} className="hover:underline">
                {currentLabel}
              </Link>
            ) : (
              currentLabel
            )}
            {currentDetail && (
              <span className="font-normal text-muted-foreground"> · {currentDetail}</span>
            )}
          </span>
        )}

        {/* Worded where there is room, arrows alone where there is not. */}
        <Button
          variant="outline"
          size="sm"
          disabled={previous === null}
          onClick={() => previous && onSelect(previous.id)}
          aria-label="Previous"
          className="md:order-5"
        >
          <ChevronLeft data-icon="inline-start" />
          <span className="max-lg:hidden">Previous</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={next === null}
          onClick={() => next && onSelect(next.id)}
          aria-label="Next"
          className="md:order-6"
        >
          <span className="max-lg:hidden">Next</span>
          <ChevronRight data-icon="inline-end" />
        </Button>
      </div>

      {/* The pills wrap rather than truncate, because a cut-off pill cannot be read. */}
      {badges && <div className="flex flex-wrap items-center gap-2 md:order-3">{badges}</div>}
    </div>
  );
}
