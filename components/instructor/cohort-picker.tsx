"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_STUDENTS, UNASSIGNED, type CohortChoice } from "@/lib/programs/cohorts";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * Which of a program's fellows the screen beneath is about.
 *
 * The same control on grading triage, an assignment's queue, the gradebook, and the assignments
 * list — one component so the four cannot offer different vocabularies for the same question, and
 * so an instructor who has learned it on one screen has learned it on all of them.
 *
 * **The value lives in the query string, and choosing also records it.** The URL is what makes a
 * filtered screen linkable and what a page reads to build itself; the recorded copy is what
 * spares an instructor picking their fifteen fellows again on four screens every sitting.
 * `resolveCohort` holds the precedence between them.
 *
 * **A cohort belongs to the program, and the four screens that carry this belong to a course.** So
 * the recorded choice is against the program: an instructor who grades the same fifteen has said so
 * once for every course of the program rather than once per course. That is why this takes a
 * `programId` while sitting on course screens — each of them resolved it to build itself.
 */
export function CohortPicker({
  choice,
  className,
}: {
  /** The options, the counts, and the selection this screen was built for, from `resolveCohort`. */
  choice: CohortChoice;
  /** Overrides the trigger's width, for the queue's sidebar where it spans the column. */
  className?: string;
}) {
  const { programId, cohorts, unassignedCount } = choice;
  const router = useRouter();
  const searchParams = useSearchParams();
  const trpc = useTRPC();

  /*
    The server rebuilds the screen beneath for every change of filter, and the old screen stays up
    until the new one arrives. If the picker showed only what the server last sent, it would keep
    showing the previous cohort for that whole wait, and an instructor would believe the click had
    not registered and pick again. So the picker shows the chosen value the moment it is chosen,
    and replaces its icon with a spinner until the screen beneath has caught up with it.
  */
  const [isPending, startTransition] = React.useTransition();
  const [value, setOptimisticValue] = React.useOptimistic(choice.cohort);

  const remember = useMutation(
    trpc.cohorts.setCohort.mutationOptions({
      /*
        The screen has already moved by the time this fails, and it should stay moved: the filter
        an instructor chose is applied whether or not it was written down. So the failure is
        reported as what it is — the choice will not survive the next visit — rather than by
        putting the picker back where it was, which would look like the filter itself failed.
      */
      onError: (error) => {
        toast.error("That filter could not be saved for next time.", {
          description: error.message,
        });
      },
    }),
  );

  /*
    Null means the select was cleared rather than changed, which this one has no control for and
    which would otherwise land as a filter on a cohort named "null". Reading it as All Fellows is
    the safe direction: an unfiltered screen shows more work than it should rather than less.
  */
  function choose(value: string | null) {
    const next = value ?? ALL_STUDENTS;
    const params = new URLSearchParams(searchParams.toString());

    /*
      All Fellows is written into the query string like any other choice. A query string with no
      cohort tells `resolveCohort` to fall back on the remembered one, and the mutation below that
      changes the remembered one has usually not finished when the server rebuilds the screen. So
      a missing parameter would bring back the cohort the instructor had just left, both on the
      screen and in this picker, until the next reload.
    */
    params.set("cohort", next);

    /*
      The submission a queue happened to have open is dropped, deliberately. It is very often a
      fellow the new filter excludes, and carrying it across would leave the screen showing work
      from outside the cohort it now claims to be about — under a banner explaining why, on every
      change of filter. Landing on the top of the new pile is what choosing a cohort is for.
    */
    params.delete("submission");

    startTransition(() => {
      setOptimisticValue(next);
      router.replace(`?${params.toString()}`, { scroll: false });
    });

    /*
      No cohort is not recorded. It answers "has anybody been missed" rather than "whose work do
      I grade", so remembering it would greet an instructor next week with a screen that is empty
      when everything is fine — which reads exactly like being caught up.
    */
    if (next === UNASSIGNED) return;

    remember.mutate({
      programId,
      cohortId: next === ALL_STUDENTS ? null : next,
    });
  }

  return (
    <Select
      value={value}
      onValueChange={choose}
      /*
        Required, because a cohort's value is its id and its label is its name. Without the map
        the trigger renders whatever the value is — here a uuid, in the middle of a toolbar.
      */
      items={{
        [ALL_STUDENTS]: "All fellows",
        [UNASSIGNED]: "No cohort",
        ...Object.fromEntries(cohorts.map((cohort) => [cohort.id, cohort.name])),
      }}
    >
      <SelectTrigger
        className={cn("w-[220px] min-w-0", className)}
        aria-label="Filter by cohort"
        aria-busy={isPending}
      >
        {isPending ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Users className="size-4 shrink-0 text-muted-foreground" />
        )}
        <SelectValue />
      </SelectTrigger>
      {/*
        Under the trigger, not over it, as the program switcher does. The default positioning puts
        the selected row on top of the trigger, so choosing a cohort low in the list pushes All
        fellows and the cohorts above it past the top of the window, where an instructor cannot
        reach them. Anchoring the popup below the trigger starts the list at its first row.
      */}
      <SelectContent alignItemWithTrigger={false} align="start">
        {/*
          First, and not a cohort. Every screen's default is the whole roster, which is what makes
          "no fellow is hidden unless somebody chose to hide them" true.
        */}
        <SelectItem value={ALL_STUDENTS}>All fellows</SelectItem>

        {cohorts.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Cohorts</SelectLabel>
              {cohorts.map((cohort) => (
                <SelectItem key={cohort.id} value={cohort.id}>
                  {cohort.name}
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                    {cohort.memberCount}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}

        {/*
          Offered only when somebody is in it. A permanently empty entry on a program where every
          fellow is placed is a check that never has anything to report, and it would sit there
          inviting the click that confirms it.
        */}
        {unassignedCount > 0 && (
          <>
            <SelectSeparator />
            <SelectItem value={UNASSIGNED}>
              No cohort
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                {unassignedCount}
              </span>
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
