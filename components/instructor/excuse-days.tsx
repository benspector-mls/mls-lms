"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarOff } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatSchoolDay } from "@/lib/school-time";
import { useTRPC } from "@/trpc/client";

/**
 * Excusing one fellow for a stretch of days, from their record.
 *
 * **The dates behave as they do in Remove days.** Choosing a first day carries the last day with
 * it, so excusing a single morning is one field, and once the last day has been chosen the first
 * stops dragging it — otherwise correcting the start of a range would quietly throw away its end.
 *
 * **Clearing lives in the same dialog**, because the person who needs it is the one who just
 * excused the wrong week, and the dates they need are the ones already in these fields.
 */
export function ExcuseDays({
  programId,
  enrollmentId,
  name,
}: {
  programId: string;
  enrollmentId: string;
  name: string;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [toChosen, setToChosen] = React.useState(false);
  const [note, setNote] = React.useState("");

  const close = () => {
    setOpen(false);
    setFrom("");
    setTo("");
    setToChosen(false);
    setNote("");
  };

  const excuse = useMutation(
    trpc.attendance.excuseDays.mutationOptions(
      settled({
        onSuccess: (result) => {
          if (result.excused.length === 0 && result.kept.length === 0) {
            toast.info(
              "There are no class days between those dates. Days ahead appear once the program has a schedule.",
            );
            return;
          }
          const excused = `${result.excused.length} day${result.excused.length === 1 ? "" : "s"} excused.`;
          toast.success(
            result.kept.length === 0
              ? excused
              : `${excused} ${result.kept.map(formatSchoolDay).join(", ")} kept, because ${name} ` +
                  `checked in that day.`,
          );
          close();
        },
      }),
    ),
  );

  const clear = useMutation(
    trpc.attendance.clearExcusedDays.mutationOptions(
      settled({
        onSuccess: (result) => {
          if (result.cleared.length === 0) {
            toast.info("There were no excused days to clear from today onward.");
            return;
          }
          toast.success(
            `${result.cleared.length} excused day${result.cleared.length === 1 ? "" : "s"} cleared.`,
          );
          close();
        },
      }),
    ),
  );

  const valid = from !== "" && to !== "" && to >= from;
  const pending = excuse.isPending || clear.isPending;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarOff />
        Excuse days
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excuse {name}</DialogTitle>
            <DialogDescription>
              Marks every class day from the first date to the last as excused. Choose only a
              first date to excuse one day. Days {name} checked themselves into are kept.
              Clearing removes excusals between the same dates, from today onward only.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">From</span>
              <Input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  if (!toChosen) setTo(event.target.value);
                }}
                className="w-40"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">To</span>
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => {
                  setTo(event.target.value);
                  setToChosen(event.target.value !== "");
                }}
                className="w-40"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Note</span>
            <Textarea
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why they will be out"
            />
            {/* Worth saying, because a note written as a staff aside would otherwise reach the
                fellow on their own calendar. */}
            <span className="text-xs text-muted-foreground">
              {name} sees this note on their attendance calendar.
            </span>
          </label>

          <DialogFooter>
            {/*
              Clearing takes the same dates, from today onward, and ignores the note. Past
              excusals are changed on that day's board, where a replacement status is chosen.
            */}
            <Button
              size="sm"
              variant="outline"
              disabled={!valid || pending}
              onClick={() => clear.mutate({ programId, enrollmentId, from, to })}
            >
              Clear excused days
            </Button>
            <Button
              size="sm"
              disabled={!valid || pending}
              onClick={() =>
                excuse.mutate({ programId, enrollmentId, from, to, note: note.trim() || undefined })
              }
            >
              Excuse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
