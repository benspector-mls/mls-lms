"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import { END_OF_DAY, instantAtSchoolClock, schoolDayOf, type SchoolDay } from "@/lib/school-time";
import { formatDueDateShort } from "@/lib/status";
import { useTRPC } from "@/trpc/client";

/**
 * Agreeing a deadline with whoever is open, from the screen where the need for one is noticed.
 *
 * **Beside the work rather than on a screen of its own, which is what it is for.** An instructor
 * opens a fellow's submission, sees that nothing is there or that what is there is late, and the
 * conversation that follows ends in a date. Until now that date could only be recorded by leaving
 * the queue for the curriculum, finding the assignment's row, opening its extensions sheet and
 * ticking the fellow's name out of a roster of twenty-five — four screens away from the one piece
 * of work the agreement is about. The sheet is still the right place to survey what has been agreed
 * across a cohort, or to agree one date with six people at once. This is the other case: this
 * fellow, this assignment, one date.
 *
 * **Granting tells the fellow nothing.** No message is sent and none ever was. They find the new
 * deadline on the assignment itself, so an agreement reached in conversation is recorded here and
 * stays a matter of that conversation.
 *
 * **The button reports before it offers.** Where a deadline has already been agreed it reads
 * "Extended until" and the date, so an instructor returning to the same fellow sees what stands
 * without opening anything — and cannot agree a second deadline in ignorance of the first, which a
 * button reading "Grant extension" over an existing agreement would invite.
 */
export function ExtensionButton({
  assignmentId,
  /**
   * Whose deadline this is, under the name the mutation takes.
   *
   * A team where the work is a team's, because the work is handed in once and the deadline belongs
   * to all of them — the server refuses a single member of a team, and every member's row is
   * brought into agreement when the team is granted one. A fellow otherwise, including a fellow
   * who has started nothing: granting creates the row that holds the agreement.
   */
  target,
  /** The deadline already agreed with them, which is what the button reports. */
  extendedDueAt,
}: {
  assignmentId: string;
  target: { kind: "student" | "team"; id: string };
  extendedDueAt: Date | null;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [open, setOpen] = React.useState(false);

  /*
    The day in the box, held as the string the input reports rather than as an instant. A date input
    reports every keystroke in its year field, so typing 2026 passes through 0002 and 0202 — and an
    instant written back into the box under the cursor would be a date nobody typed.
  */
  const [day, setDay] = React.useState<SchoolDay>("");

  /*
    Opening fills the box with what already stands, so changing an agreed deadline is an edit of the
    date on screen rather than a grant typed from nothing. Closing is what clears it: the next
    fellow opened is a different agreement, and their box should not hold the last one's date.
  */
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setDay(extendedDueAt ? schoolDayOf(extendedDueAt) : "");
    grant.reset();
  }

  const grant = useMutation(
    trpc.submissions.grantExtensions.mutationOptions(
      settled({
        // The refusal is drawn in the panel below, so it must not also fly past in a toast.
        onError: shownInPlace,
        onSuccess: (_result, variables) => {
          setOpen(false);
          toast.success(
            variables.extendedDueAt === null
              ? "The agreed deadline is withdrawn."
              : `Deadline agreed until ${formatDueDateShort(variables.extendedDueAt)}.`,
          );
        },
      }),
    ),
  );

  /** Null withdraws the agreement, which is what the mutation takes a null date to mean. */
  const submit = (extendedDueAt: Date | null) =>
    grant.mutate({
      assignmentId,
      extendedDueAt,
      ...(target.kind === "team"
        ? { teamIds: [target.id] as [string] }
        : { studentIds: [target.id] as [string] }),
    });

  /*
    The end of the chosen day, because a deadline agreed in conversation is a day rather than a
    minute: somebody told "get it to me by Friday" has until Friday is over. The sheet asks for a
    time as well, where one date is being given to a dozen people at once and the hour can matter.
  */
  const chosen = day ? instantAtSchoolClock(day, END_OF_DAY) : null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button type="button" variant={extendedDueAt ? "secondary" : "outline"} size="sm">
            <CalendarClock data-icon="inline-start" />
            {extendedDueAt
              ? `Extended until ${formatDueDateShort(extendedDueAt)}`
              : "Grant extension"}
          </Button>
        }
      />

      <PopoverContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="extension-day">
            {extendedDueAt ? "Agreed deadline" : "New deadline"}
          </Label>
          <Input
            id="extension-day"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </div>

        {/*
          The refusal in place rather than in a toast, because every one this mutation gives is
          about what was chosen — a date before the assignment's own, work nobody has been given
          yet, a fellow on a team that shares its deadline — and a message about what you chose
          should stay on screen while you fix it.
        */}
        {grant.error && <p className="text-sm text-destructive">{grant.error.message}</p>}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={chosen === null || grant.isPending}
            onClick={() => submit(chosen)}
          >
            {grant.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {extendedDueAt ? "Change" : "Grant"}
          </Button>

          {/*
            Only where there is something to withdraw. It takes the agreement back rather than
            moving it, so it ignores whatever is in the box.
          */}
          {extendedDueAt && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={grant.isPending}
              onClick={() => submit(null)}
            >
              Revoke
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
