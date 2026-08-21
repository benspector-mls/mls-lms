"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
 * What is left of the list once it is gone: where you are in it, the way to either side, and the
 * way straight to one of them.
 *
 * **Movement follows the list as it is currently filtered.** The rows arrive in the order they
 * were drawn, so a search narrowed to one group, or the To do tab, is still in force here — Next
 * means the next one an instructor was actually looking at, and the dropdown offers exactly the
 * names that list holds. Which filter that is stays written beside the count, because a dropdown
 * missing a student it does not explain reads as a fault rather than as a filter.
 *
 * Placed at the top of the submission pane with the movement on the right, directly above Approve
 * and release: approving and moving on are one gesture repeated all afternoon, and they belong
 * under the same hand.
 */
export function GradingModeBar({
  submissions,
  currentId,
  listLabel,
  jumpLabel,
  onSelect,
  onExit,
}: {
  /** Every submission in the list, in the order it is drawn, under the name to reach it by. */
  submissions: { id: string; label: string }[];
  /** The one open, which may not be in the list at all — see below. */
  currentId: string | null;
  /** What the list is currently showing, in the words its own tab uses. */
  listLabel: string;
  /** What the dropdown is a list of, in this screen's own noun: a student, or an assignment. */
  jumpLabel: string;
  onSelect: (id: string) => void;
  onExit: () => void;
}) {
  const at = currentId === null ? -1 : submissions.findIndex((row) => row.id === currentId);

  /*
    Nothing to move through, and every control says so.

    A submission can legitimately be open and not in the list beside it: a student who has left the
    cohort, one outside the group selected, one member's copy of their team's grade. The pane says
    which of those it is; this says only that Previous and Next have nowhere to go and that the
    dropdown is not showing what is open, which is the honest answer and better than a control that
    names somebody else's work.
  */
  const previous = at > 0 ? submissions[at - 1] : null;
  const next = at >= 0 && at < submissions.length - 1 ? submissions[at + 1] : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
      <Button variant="ghost" size="sm" onClick={onExit}>
        <Minimize2 data-icon="inline-start" />
        Exit grading mode
      </Button>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {/*
          The list itself, folded into one control. Going three students back is otherwise three
          presses of Previous, each one loading a submission nobody wanted to look at.
        */}
        <Select
          value={at >= 0 ? currentId : null}
          onValueChange={(id) => id && onSelect(id)}
          items={Object.fromEntries(submissions.map((row) => [row.id, row.label]))}
        >
          <SelectTrigger size="sm" aria-label={jumpLabel} className="w-56 min-w-0">
            <SelectValue placeholder={jumpLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {submissions.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground tabular-nums">
          {at >= 0 ? `${at + 1} of ${submissions.length}` : `${submissions.length} in the list`} ·{" "}
          {listLabel}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={previous === null}
            onClick={() => previous && onSelect(previous.id)}
          >
            <ChevronLeft data-icon="inline-start" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={next === null}
            onClick={() => next && onSelect(next.id)}
          >
            Next
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}
