"use client";

import { useMutation } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import {
  formatSchoolDay,
  instantAtSchoolClock,
  schoolClockOf,
  type SchoolDay,
} from "@/lib/school-time";
import { useTRPC } from "@/trpc/client";

/**
 * The three facts about one day an instructor can be wrong about.
 *
 * **One day, never the schedule behind it.** A program that meets at half past nine has one
 * Tuesday that started at half past ten, and the only way to say so used to be editing the
 * schedule — which rewrites the clock of every day still standing after today. This writes the
 * one day, and the term around it is untouched.
 *
 * The two cases it is for are the morning that got away and the morning that has not come. A
 * schedule saved in the evening makes today with a nine thirty start and a backstop eight hours
 * later, so the day exists with a code that never worked and nobody could check into: giving it a
 * window that covers this evening is what lets the class be taken at all. And tomorrow's class
 * starting an hour late is a thing known the day before, which is when this can be set.
 *
 * **Only the fields that were touched are sent.** A dialog that posted all three every time would
 * restate a start nobody edited, which matters more than it looks: the server recomputes every
 * self check-in against the start it is given, and the audit trail would record a correction that
 * did not happen. Each field compares against what it was opened with, and an untouched one is
 * left out of the call entirely.
 *
 * **Times are the school's, not the browser's.** They go in as `"10:30"` against this session's own
 * day and come back as instants through `instantAtSchoolClock`, so an instructor working from a
 * laptop still on Pacific time sets the morning the class actually starts.
 *
 * The refusal stays in the dialog rather than becoming a toast: a message about a time somebody
 * typed has to still be on screen while they fix it.
 */
export function EditSession({
  sessionId,
  day,
  startedAt,
  endsAt,
  lateAfterMinutes,
  busy,
}: {
  sessionId: string;
  day: SchoolDay;
  /** Both halves of the window, which every session but a prepared one has. */
  startedAt: Date;
  endsAt: Date;
  lateAfterMinutes: number;
  busy: boolean;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [open, setOpen] = React.useState(false);

  /*
    What the dialog was opened with, which is both what the fields start at and what "unchanged"
    means when it is saved. Held in state rather than derived on each render, because the screen
    behind this polls: a session re-read while somebody is typing must not move the value they are
    comparing against, or the field they never touched would start looking edited.
  */
  const [opened, setOpened] = React.useState(() => ({
    startsAt: schoolClockOf(startedAt),
    endsAt: schoolClockOf(endsAt),
    lateAfter: String(lateAfterMinutes),
  }));
  const [startsAtClock, setStartsAtClock] = React.useState(opened.startsAt);
  const [endsAtClock, setEndsAtClock] = React.useState(opened.endsAt);
  const [lateAfter, setLateAfter] = React.useState(opened.lateAfter);

  const edit = useMutation(
    trpc.attendance.updateSession.mutationOptions(
      settled({
        onError: shownInPlace,
        onSuccess: (result) => {
          setOpen(false);
          toast.success(
            result.recomputed === 0
              ? `${formatSchoolDay(day)} runs on its own clock now.`
              : `${formatSchoolDay(day)} runs on its own clock now. ${result.recomputed} check-in${
                  result.recomputed === 1 ? " was" : "s were"
                } recounted against it.`,
          );
        },
      }),
    ),
  );

  function show(showing: boolean) {
    if (showing) {
      // Opened against what the session says right now, which a poll behind the dialog may have
      // moved since this component was first drawn.
      const now = {
        startsAt: schoolClockOf(startedAt),
        endsAt: schoolClockOf(endsAt),
        lateAfter: String(lateAfterMinutes),
      };
      setOpened(now);
      setStartsAtClock(now.startsAt);
      setEndsAtClock(now.endsAt);
      setLateAfter(now.lateAfter);
      edit.reset();
    }
    setOpen(showing);
  }

  const minutes = Number(lateAfter);
  const complete =
    startsAtClock !== "" &&
    endsAtClock !== "" &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= 1440;

  const changed =
    startsAtClock !== opened.startsAt ||
    endsAtClock !== opened.endsAt ||
    lateAfter !== opened.lateAfter;

  function save() {
    edit.mutate({
      sessionId,
      startedAt:
        startsAtClock === opened.startsAt ? undefined : instantAtSchoolClock(day, startsAtClock),
      endsAt: endsAtClock === opened.endsAt ? undefined : instantAtSchoolClock(day, endsAtClock),
      lateAfterMinutes: lateAfter === opened.lateAfter ? undefined : minutes,
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => show(true)}>
        <Pencil data-icon="inline-start" />
        Edit session
      </Button>

      <Dialog open={open} onOpenChange={show}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {formatSchoolDay(day)}</DialogTitle>
            <DialogDescription>
              This day only. The program&apos;s schedule and every other day it makes are left as
              they are. The code works from two hours before the class starts until it stops taking
              check-ins.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Class starts at</span>
              <Input
                type="time"
                value={startsAtClock}
                onChange={(event) => setStartsAtClock(event.target.value)}
                className="w-32"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">The code stops working at</span>
              <Input
                type="time"
                value={endsAtClock}
                onChange={(event) => setEndsAtClock(event.target.value)}
                className="w-32"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">On time for</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={lateAfter}
                  onChange={(event) => setLateAfter(event.target.value)}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </label>
          </div>

          {/*
            Moving the start or the threshold restates who was late, so the sentence is here before
            the press rather than in the toast after it.
          */}
          <p className="text-xs text-muted-foreground">
            Everybody who checked themselves in is recounted against the clock you save here. A
            status you set by hand is never changed.
          </p>

          {edit.error ? (
            <p className="text-xs text-destructive" role="alert">
              {edit.error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => show(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!complete || !changed || edit.isPending} onClick={save}>
              Save this day
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
