"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { SCHOOL_WEEK, formatSchoolDay } from "@/lib/school-time";
import { useTRPC } from "@/trpc/client";

/**
 * When the program meets.
 *
 * **A range with the exceptions removed, which is the shape the year actually has.** A program
 * meets nearly every weekday for nine months; declaring those days one at a time is the burden
 * this replaces, and declaring them as a rule leaves only the holidays to deal with.
 *
 * **The sentence above the button is the whole safety of the screen.** Saving makes and deletes
 * attendance sessions in bulk, so it says how many of each before anything happens, and it names
 * the days it will keep because somebody has already checked into them. It comes from
 * `attendanceSchedulePreview`, which is the same arithmetic the save runs — a second
 * implementation here is how the count and the act would come to disagree.
 */

const WEEKDAY_LABEL: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

/** Monday to Friday, which is what a program that has not said otherwise means. */
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

type Program = {
  id: string;
  attendanceStartsOn: string | null;
  attendanceEndsOn: string | null;
  attendanceWeekdays: number[];
  attendanceStartsAt: string | null;
};

/** "1 day" or "3 days". Here because the sentence above the button says it three times. */
function describe(count: number, noun = "day"): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function ProgramSchedule({ program }: { program: Program }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [startsOn, setStartsOn] = React.useState(program.attendanceStartsOn ?? "");
  const [endsOn, setEndsOn] = React.useState(program.attendanceEndsOn ?? "");
  const [startsAt, setStartsAt] = React.useState(program.attendanceStartsAt ?? "09:30");
  const [weekdays, setWeekdays] = React.useState<number[]>(
    program.attendanceWeekdays.length > 0 ? program.attendanceWeekdays : DEFAULT_WEEKDAYS,
  );

  const whole = startsOn !== "" && endsOn !== "" && startsAt !== "" && weekdays.length > 0;
  const forward = startsOn === "" || endsOn === "" || endsOn >= startsOn;
  const valid = whole && forward;

  const input = {
    programId: program.id,
    startsOn: startsOn || null,
    endsOn: endsOn || null,
    weekdays,
    startsAt: startsAt || null,
  };

  const preview = useQuery({
    ...trpc.programs.attendanceSchedulePreview.queryOptions(input),
    enabled: valid,
  });

  const save = useMutation(
    trpc.programs.setAttendanceSchedule.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.make.length === 0 && result.remove.length === 0
              ? "The schedule is saved. No days changed."
              : `Saved. ${describe(result.make.length)} made, ${describe(result.remove.length)} removed.`,
          ),
      }),
    ),
  );

  const clear = useMutation(
    trpc.programs.setAttendanceSchedule.mutationOptions(
      settled({
        onSuccess: (result) => {
          setStartsOn("");
          setEndsOn("");
          setWeekdays(DEFAULT_WEEKDAYS);
          toast.success(
            `The schedule is cleared and ${describe(result.remove.length)} removed. Attendance ` +
              `goes back to being started by hand.`,
          );
        },
      }),
    ),
  );

  const busy = save.isPending || clear.isPending;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Class meets</h2>
        <p className="text-xs text-muted-foreground">
          Say when the program meets and every day makes itself, with its code ready in advance.
          Check-in opens two hours before class and the code stops working eight hours after class
          starts. Remove the days you do not meet from the attendance screen.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate(input);
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">First day</span>
          <Input
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
            className="w-40"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Last day</span>
          <Input
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
            className="w-40"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Class starts at</span>
          <Input
            type="time"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="w-32"
          />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium">Days it meets</legend>
          <div className="flex flex-wrap items-center gap-3 pt-1.5">
            {SCHOOL_WEEK.map((weekday) => (
              <label key={weekday} className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={weekdays.includes(weekday)}
                  onCheckedChange={(checked) =>
                    setWeekdays((current) =>
                      checked
                        ? [...current, weekday].sort((a, b) => a - b)
                        : current.filter((day) => day !== weekday),
                    )
                  }
                />
                {WEEKDAY_LABEL[weekday]}
              </label>
            ))}
          </div>
        </fieldset>

        <Button type="submit" size="sm" disabled={!valid || busy}>
          Save
        </Button>
      </form>

      {!forward && <p className="text-xs text-destructive">The last day comes before the first.</p>}

      {valid && preview.data && (
        <p className="text-xs text-muted-foreground">
          Saving makes {describe(preview.data.make.length)} and removes{" "}
          {describe(preview.data.remove.length)}.
          {preview.data.blocked.length > 0 && (
            <>
              {" "}
              {describe(preview.data.blocked.length)} stays, because somebody has already checked in
              on {preview.data.blocked.map(formatSchoolDay).join(", ")}.
            </>
          )}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Changing the start time applies to every day that has not begun. Today keeps the time it
        started with, because fellows may already have checked in against it — to move today, open
        it from the attendance screen.
      </p>

      {program.attendanceStartsOn !== null && (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              clear.mutate({
                programId: program.id,
                startsOn: null,
                endsOn: null,
                weekdays: [],
                startsAt: null,
              })
            }
          >
            Clear the schedule
          </Button>
        </div>
      )}
    </section>
  );
}
