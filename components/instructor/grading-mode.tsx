"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";

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
 * So the mode collapses both and offers what is left of the list as two buttons. On a 1440px
 * window that hands the review pane about 1390px instead of about 820px, which is what takes it
 * from too narrow to hold the document beside the grade to comfortably wide enough — the split is
 * a width the pane either has or does not, and this is how a laptop gets it.
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

/**
 * The way in, which sits in the list it is about to put away.
 *
 * Beside the search box and the tabs, where an instructor deciding what to work on is already
 * looking. It goes with the list, which is why the way out lives on the other side of the divider.
 */
export function GradingModeButton({
  onEnter,
  className,
}: {
  onEnter: () => void;
  className?: string;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onEnter} className={cn("w-full", className)}>
      <Maximize2 data-icon="inline-start" />
      Grading mode
    </Button>
  );
}

/**
 * What is left of the list once it is gone: where you are in it, and the way to either side.
 *
 * **Movement follows the list as it is currently filtered.** The ids arrive in the order the rows
 * were drawn, so a search narrowed to one group, or the To do tab, is still in force here — Next
 * means the next one an instructor was actually looking at, not the next one in the cohort.
 *
 * Placed at the top of the submission pane with the movement on the right, directly above Approve
 * and release: approving and moving on are one gesture repeated all afternoon, and they belong
 * under the same hand.
 */
export function GradingModeBar({
  ids,
  currentId,
  listLabel,
  onSelect,
  onExit,
}: {
  /** Every submission in the list, in the order it is drawn. */
  ids: string[];
  /** The one open, which may not be in the list at all — see below. */
  currentId: string | null;
  /** What the list is currently showing, in the words its own tab uses. */
  listLabel: string;
  onSelect: (id: string) => void;
  onExit: () => void;
}) {
  const at = currentId === null ? -1 : ids.indexOf(currentId);

  /*
    Nothing to move through, and both buttons say so.

    A submission can legitimately be open and not in the list beside it: a student who has left the
    cohort, one outside the group selected, one member's copy of their team's grade. The pane says
    which of those it is; this says only that Previous and Next have nowhere to go, which is the
    honest answer and better than a button that jumps somewhere unrelated.
  */
  const previous = at > 0 ? ids[at - 1] : null;
  const next = at >= 0 && at < ids.length - 1 ? ids[at + 1] : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
      <Button variant="ghost" size="sm" onClick={onExit}>
        <Minimize2 data-icon="inline-start" />
        Exit grading mode
      </Button>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {at >= 0 ? `${at + 1} of ${ids.length}` : `${ids.length} in the list`} · {listLabel}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={previous === null}
            onClick={() => previous && onSelect(previous)}
          >
            <ChevronLeft data-icon="inline-start" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={next === null}
            onClick={() => next && onSelect(next)}
          >
            Next
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}
