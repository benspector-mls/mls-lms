"use client";

import { CalendarSearch } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ProgramDaysCalendar } from "@/components/instructor/attendance-calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { attendanceHref } from "@/lib/links";
import type { SchoolDay } from "@/lib/school-time";

/**
 * Another day's board, reached from the one you are on.
 *
 * **The Schedule tab's calendar, in a dialog.** The question is "which of the days we meet", and a
 * date field would accept the Saturday in between and land on a screen for a day with no session.
 * Every held or scheduled square is the way into that day's screen, which is where a past morning
 * is corrected and where a coming one's code is read. A blank square does nothing here; making a
 * day is the Schedule tab's job.
 *
 * **Today is a button of its own**, because the board for today has its own address — the
 * attendance screen's Today tab — and a reader three weeks back in the record wants the way home
 * without finding today's square. On today's board it does nothing but close the dialog.
 *
 * Carried by today's board and by every day's screen, so a reader correcting one morning can
 * move to the next without going back through the term grid.
 */
export function JumpToDate({ programId, today }: { programId: string; today: SchoolDay }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarSearch data-icon="inline-start" />
        Jump to a date
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/*
          Wide enough for the calendar, the gap, and the key beside it — about 32rem — and no
          wider. The default width put the key beneath the grid, and a wider one left an empty
          quarter beside it. Not `w-fit`: the dialog is anchored at the viewport's centre, so
          fit-content could only grow into the right-hand half and the key spilled past the edge.
        */}
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Jump to a date</DialogTitle>
            <DialogDescription>Open any day the program meets.</DialogDescription>
          </DialogHeader>
          {/*
            Any link followed from here closes the dialog first. With `cacheComponents` on, Next
            keeps a page the reader has just left hidden rather than unmounted, and brings its
            state back on return — so a dialog left open when a day square was pressed was still
            open when the reader came back to this page by Back or by Today. Capturing the click
            here covers every day square and the Today button without the calendar, which the
            Schedule tab also draws, having to know it sits in a dialog.
          */}
          <div
            className="flex flex-col gap-4"
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            <div>
              <Button
                size="sm"
                variant="outline"
                render={<Link href={attendanceHref(programId)} />}
              >
                Today
              </Button>
            </div>
            <ProgramDaysCalendar programId={programId} today={today} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
