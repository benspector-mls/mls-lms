"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { displayNameOf } from "@/lib/people";
import {
  END_OF_DAY,
  instantAtSchoolClock,
  schoolClockOf,
  schoolDayOf,
  type SchoolClock,
} from "@/lib/school-time";
import { formatDueDate } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Every agreed deadline on one assignment: who has one, and who could be given one.
 *
 * **One surface for the whole feature**, reached from the assignment's own row in the curriculum.
 * Granting used to live on a fellow's record, which meant agreeing a deadline with six people was
 * six screens — and surveying what had been agreed was not possible at all, because no query
 * answered the question. Both follow from putting it on the assignment: the list is the roster
 * rather than the submissions, so a fellow who has handed in nothing is as grantable as one who
 * has, which matters most on self-directed work where there is no Accept and everybody who has not
 * submitted has no row.
 *
 * **A sheet rather than a dialog.** What is inside is a small management screen — a date, a
 * selectable roster annotated with what each person already has, and a change or a revoke per row —
 * and twenty-five names plus a list of grants wants vertical room a dialog does not have.
 *
 * **On team work the rows are teams.** The work is handed in once, so the deadline is the team's;
 * selecting three of a team's four members is not a request that can be honoured, and the server
 * refuses the shape as well as the screen declining to offer it.
 */

type Data = RouterOutputs["submissions"]["extensionsForAssignment"];
type Row = Data["rows"][number];

/** What one row is called: a fellow's name, or a team's. */
function rowLabel(row: Row): string {
  return row.student ? displayNameOf(row.student, "Unknown student") : (row.teamName ?? "A team");
}

export function ExtensionsSheet({
  assignmentId,
  title,
  open,
  onOpenChange,
}: {
  assignmentId: string;
  /** The assignment's title, so the sheet names itself before its query has answered. */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();

  /*
    Fetched when the sheet opens rather than with the curriculum page, which draws a row per
    assignment: a roster query per row would be forty queries to render a screen where nobody has
    opened anything.
  */
  const query = useQuery({
    ...trpc.submissions.extensionsForAssignment.queryOptions({ assignmentId }),
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Extensions — {title}</SheetTitle>
          <SheetDescription>
            {query.data?.assignment.dueAt
              ? `Due ${formatDueDate(query.data.assignment.dueAt)} for everybody else. Work handed in by an agreed deadline reads as extended rather than late.`
              : "A deadline agreed with somebody, in place of the one the class was given."}
          </SheetDescription>
        </SheetHeader>

        {query.isPending ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading who has one…
          </p>
        ) : query.isError ? (
          <p className="px-4 py-6 text-sm text-destructive">{query.error.message}</p>
        ) : (
          <SheetBody data={query.data} assignmentId={assignmentId} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ data, assignmentId }: { data: Data; assignmentId: string }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [at, setAt] = React.useState<Date | null>(null);
  const lastClock = React.useRef<SchoolClock>(END_OF_DAY);

  const noun = data.grantedTo === "team" ? "team" : "fellow";

  const grant = useMutation(
    trpc.submissions.grantExtensions.mutationOptions(
      settled({
        onSuccess: (result) => {
          setSelected(new Set());
          toast.success(`${result.changed} ${result.changed === 1 ? noun : `${noun}s`} updated.`);
        },
      }),
    ),
  );

  /** The ids the mutation wants, under whichever name this assignment takes. */
  const named = (ids: string[]) =>
    data.grantedTo === "team"
      ? { teamIds: ids as [string, ...string[]] }
      : { studentIds: ids as [string, ...string[]] };

  const submit = (ids: string[], extendedDueAt: Date | null) => {
    if (ids.length === 0) return;
    grant.mutate({ assignmentId, extendedDueAt, ...named(ids) });
  };

  const withExtension = data.rows.filter((row) => row.extension !== null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        {/*
          What already stands, before what could be added. An instructor opening this most often
          wants to know what they agreed last week rather than to agree something new, and a list
          that opened on an empty form would make them scroll to find out.
        */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Agreed so far</h3>
          {withExtension.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has an agreed deadline on this assignment.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {withExtension.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
                >
                  <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{rowLabel(row)}</span>
                  <span className="text-sky-700 dark:text-sky-300">
                    until {formatDueDate(row.extension!.extendedDueAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.extension!.grantedBy
                      ? `agreed by ${displayNameOf(row.extension!.grantedBy, "somebody")}`
                      : "agreed by somebody since removed"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={grant.isPending}
                    onClick={() => submit([row.id], null)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/*
          The roster, not the submissions — which is the whole reason this lives on the assignment.
          A fellow who has handed in nothing is as grantable as one who has.
        */}
        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">
              {data.grantedTo === "team" ? "Teams" : "Fellows"}
            </h3>
            <span className="text-xs text-muted-foreground">
              {selected.size === 0 ? "none selected" : `${selected.size} selected`}
            </span>
          </div>

          <ul className="flex flex-col">
            {data.rows.map((row) => {
              const checked = selected.has(row.id);

              return (
                <li key={row.id}>
                  <Label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-muted/60",
                      checked && "bg-muted/60",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (!next.delete(row.id)) next.add(row.id);
                          return next;
                        })
                      }
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{rowLabel(row)}</span>
                      {row.members.length > 0 && (
                        <span className="truncate text-xs text-muted-foreground">
                          {row.members
                            .map((member) => member.displayName ?? "a teammate")
                            .join(", ")}
                        </span>
                      )}
                    </span>
                    {row.extension && (
                      <span className="shrink-0 text-xs whitespace-nowrap text-sky-700 dark:text-sky-300">
                        until {formatDueDate(row.extension.extendedDueAt)}
                      </span>
                    )}
                  </Label>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/*
        The date sits with the button that applies it rather than at the top, because it is the last
        thing decided: an instructor picks who, then when. A fellow who already has one is simply
        granted again — last write wins, which is how changing one works and needs no second control.

        The same two inputs the assignment form asks a due date with, so a deadline is typed here
        the way it is typed there and both mean New York time.
      */}
      <SheetFooter className="gap-3 border-t border-border">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="extension-date">New deadline</Label>
            <Input
              id="extension-date"
              type="date"
              value={at ? schoolDayOf(at) : ""}
              onChange={(event) =>
                setAt(
                  event.target.value
                    ? instantAtSchoolClock(
                        event.target.value,
                        at ? schoolClockOf(at) : lastClock.current,
                      )
                    : null,
                )
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="extension-time">Time</Label>
            <Input
              id="extension-time"
              type="time"
              disabled={at === null}
              value={at ? schoolClockOf(at) : ""}
              onChange={(event) => {
                const clock = event.target.value || END_OF_DAY;
                lastClock.current = clock;
                setAt(at ? instantAtSchoolClock(schoolDayOf(at), clock) : null);
              }}
            />
          </div>
        </div>

        {/*
          The refusal in place rather than in a toast, because every one this mutation gives is
          about what was chosen — a date before the assignment's own, a draft, somebody off the
          roster — and a message about what you chose should stay on screen while you fix it.
        */}
        {grant.error && <p className="text-sm text-destructive">{grant.error.message}</p>}

        <Button
          type="button"
          disabled={at === null || selected.size === 0 || grant.isPending}
          onClick={() => submit([...selected], at)}
        >
          {selected.size === 0
            ? `Select ${data.grantedTo === "team" ? "teams" : "fellows"}`
            : `Give ${selected.size} ${selected.size === 1 ? noun : `${noun}s`} until this`}
        </Button>
      </SheetFooter>
    </div>
  );
}
