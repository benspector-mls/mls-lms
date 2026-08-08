"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Users } from "lucide-react";
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
import { ALL_STUDENTS, UNGROUPED } from "@/lib/courses/groups";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * Which of a cohort's students the screen beneath is about.
 *
 * The same control on grading triage, an assignment's queue, the gradebook, and the assignments
 * list — one component so the four cannot offer different vocabularies for the same question, and
 * so an instructor who has learned it on one screen has learned it on all of them.
 *
 * **The value lives in the query string, and choosing also records it.** The URL is what makes a
 * filtered screen linkable and what a page reads to build itself; the recorded copy is what
 * spares an instructor picking their fifteen students again on four screens every sitting.
 * `resolveGroup` holds the precedence between them.
 */
export function GroupPicker({
  courseId,
  value,
  groups,
  ungroupedCount,
  className,
}: {
  courseId: string;
  /** The selection the screen was built for, resolved by `resolveGroup`. */
  value: string;
  groups: { id: string; name: string; memberCount: number }[];
  ungroupedCount: number;
  /** Overrides the trigger's width, for the queue's sidebar where it spans the column. */
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trpc = useTRPC();

  const remember = useMutation(
    trpc.groups.setGradingGroup.mutationOptions({
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
    which would otherwise land as a filter on a group named "null". Reading it as All Students is
    the safe direction: an unfiltered screen shows more work than it should rather than less.
  */
  function choose(value: string | null) {
    const next = value ?? ALL_STUDENTS;
    const params = new URLSearchParams(searchParams.toString());
    if (next === ALL_STUDENTS) {
      params.delete("group");
    } else {
      params.set("group", next);
    }

    /*
      The submission a queue happened to have open is dropped, deliberately. It is very often a
      student the new filter excludes, and carrying it across would leave the screen showing work
      from outside the group it now claims to be about — under a banner explaining why, on every
      change of filter. Landing on the top of the new pile is what choosing a group is for.
    */
    params.delete("submission");

    const query = params.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });

    /*
      Ungrouped is not recorded. It answers "has anybody been missed" rather than "whose work do
      I grade", so remembering it would greet an instructor next week with a screen that is empty
      when everything is fine — which reads exactly like being caught up.
    */
    if (next === UNGROUPED) return;

    remember.mutate({
      courseId,
      groupId: next === ALL_STUDENTS ? null : next,
    });
  }

  return (
    <Select
      value={value}
      onValueChange={choose}
      /*
        Required, because a group's value is its id and its label is its name. Without the map
        the trigger renders whatever the value is — here a uuid, in the middle of a toolbar.
      */
      items={{
        [ALL_STUDENTS]: "All students",
        [UNGROUPED]: "Ungrouped",
        ...Object.fromEntries(groups.map((group) => [group.id, group.name])),
      }}
    >
      <SelectTrigger className={cn("w-[220px] min-w-0", className)} aria-label="Filter by group">
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {/*
          First, and not a group. Every screen's default is the whole cohort, which is what makes
          "no student is hidden unless somebody chose to hide them" true.
        */}
        <SelectItem value={ALL_STUDENTS}>All students</SelectItem>

        {groups.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Groups</SelectLabel>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                    {group.memberCount}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}

        {/*
          Offered only when somebody is in it. A permanently empty entry on a cohort where every
          student is grouped is a check that never has anything to report, and it would sit there
          inviting the click that confirms it.
        */}
        {ungroupedCount > 0 && (
          <>
            <SelectSeparator />
            <SelectItem value={UNGROUPED}>
              Ungrouped
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                {ungroupedCount}
              </span>
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
