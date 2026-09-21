"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useTRPC } from "@/trpc/client";

/**
 * How long after the day starts a fellow still counts as on time.
 *
 * **The program's own number, because it is one**: a program that begins with fifteen minutes of
 * standup and one that begins with a quiz disagree about when the door closes, and neither is
 * wrong. One value rather than one per course, which is the duplication attendance moving up
 * removed — there is one morning, so there is one answer.
 *
 * **Beside "Class meets" rather than with the program's identity**, because it answers the same
 * question that block does: what a day of this program looks like. It sat among the program's name
 * and its courses while attendance had no schedule to belong to.
 *
 * **It reaches every day that has not begun**, including the whole term ahead that a schedule has
 * already made. Days already begun keep what they ran under, which is what makes the setting
 * editable at all: read live, changing it in November would silently convert a term of recorded
 * lateness and no report would agree with any report printed before it.
 */
export function ProgramLateness({
  program,
}: {
  program: { id: string; attendanceLateAfterMinutes: number };
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [minutes, setMinutes] = React.useState(String(program.attendanceLateAfterMinutes));

  const save = useMutation(
    trpc.programs.setAttendanceLateAfter.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.attendanceLateAfterMinutes === 0
              ? "Arriving after the day starts now counts as late."
              : `The first ${result.attendanceLateAfterMinutes} minutes now count as on time.`,
          ),
      }),
    ),
  );

  const parsed = Number(minutes);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 120;
  const changed = parsed !== program.attendanceLateAfterMinutes;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Counting somebody late</h2>
        <p className="text-xs text-muted-foreground">
          Measured from the time class starts, not from when a fellow opens the page. Arriving
          before class begins is on time, however early.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate({ programId: program.id, minutes: parsed });
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Minutes that still count as on time</span>
          <Input
            value={minutes}
            onChange={(event) => setMinutes(event.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            className="w-24"
          />
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!valid || !changed || save.isPending}
        >
          Save
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Applies to every day that has not begun, including the days the schedule has already made.
        Nothing already recorded changes — to correct a morning that was taken with the wrong
        number, open that day from the calendar.
      </p>
    </section>
  );
}
