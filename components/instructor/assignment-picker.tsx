"use client";

import { Combobox } from "@base-ui/react/combobox";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, NotebookPen, Search } from "lucide-react";
import * as React from "react";

import { gradingQueueHref, ungradedQueueHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * Which assignment the grading queue beside this is open on, switchable to another in the course.
 *
 * Grouped by module, in curriculum order — the same shape `courseUnits.listForCourse` already
 * computes for the Curriculum screen's own tree, read here rather than recomputed: a unit, the
 * work in it, in the order an instructor put it in.
 *
 * A combobox rather than a select, because a course has dozens of assignments and finding one by
 * scrolling every module is slower than typing a few letters of its title. The box opens on the
 * search field; the list beneath it keeps the modules, filtered to the assignments whose title
 * matches what was typed.
 *
 * The assignment is a segment of the address, not a query parameter, so choosing one is a
 * navigation rather than a filter — `gradingQueueHref` builds the same path a breadcrumb or a
 * triage link would.
 *
 * Above the modules, one more choice: every ungraded submission in the course, which is the same
 * screen open on all of the course's waiting work at once.
 */
const UNGRADED = "ungraded";

/** One choice in the picker: an assignment, or every ungraded submission. */
type AssignmentChoice = { id: string; title: string; draft: boolean };

const UNGRADED_CHOICE: AssignmentChoice = {
  id: UNGRADED,
  title: "All ungraded submissions",
  draft: false,
};

export function AssignmentPicker({
  courseId,
  assignmentId,
  assignmentTitle,
  className,
}: {
  courseId: string;
  /** The assignment this queue is currently open on, or null when it is open on every ungraded submission. */
  assignmentId: string | null;
  /** Known already from the page this queue was built for, so the trigger never renders blank
   * while the fuller list is still in flight. Null with `assignmentId`. */
  assignmentTitle: string | null;
  className?: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();

  const units = useQuery(trpc.courseUnits.listForCourse.queryOptions({ courseId }));

  const groups = React.useMemo(
    () => [
      { value: "", label: "", items: [UNGRADED_CHOICE] },
      ...(units.data ?? [])
        .filter((unit) => unit.assignments.length > 0)
        .map((unit) => ({
          value: unit.id,
          label: unit.name,
          items: unit.assignments.map((assignment): AssignmentChoice => ({
            id: assignment.id,
            title: assignment.title,
            // Said rather than hidden — an instructor is entitled to open their own draft.
            draft: assignment.distributedAt === null,
          })),
        })),
    ],
    [units.data],
  );

  const current = assignmentId ?? UNGRADED;

  /*
    Found in the list once it has loaded. Until then the open assignment is built from the title
    the page already holds, so the trigger names it rather than falling back to another choice.
  */
  let selected = groups.flatMap((group) => group.items).find((choice) => choice.id === current);
  if (!selected) {
    selected =
      assignmentId && assignmentTitle
        ? { id: assignmentId, title: assignmentTitle, draft: false }
        : UNGRADED_CHOICE;
  }

  function choose(id: string | null) {
    if (!id || id === current) return;

    /*
      The cohort filter follows; the open submission does not. `?submission=` and `?fellow=` name
      a row on the assignment being left, and carrying either across would open this screen on
      whatever id happens to collide, or on nothing at all.
    */
    const params = new URLSearchParams(searchParams.toString());
    params.delete("submission");
    params.delete("fellow");
    const query = params.toString();

    const href = id === UNGRADED ? ungradedQueueHref(courseId) : gradingQueueHref(courseId, id);
    router.push(query ? `${href}?${query}` : href);
  }

  return (
    <Combobox.Root
      items={groups}
      value={selected}
      onValueChange={(next) => choose(next?.id ?? null)}
      itemToStringLabel={(choice: AssignmentChoice) => choice.title}
      isItemEqualToValue={(a: AssignmentChoice, b: AssignmentChoice) => a.id === b.id}
    >
      <Combobox.Trigger
        aria-label="Switch assignment"
        className={cn(
          "flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        <NotebookPen className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">
          <Combobox.Value />
        </span>
        <Combobox.Icon
          render={
            <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          }
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={4} className="isolate z-50">
          <Combobox.Popup className="isolate z-50 flex max-h-(--available-height) w-auto max-w-(--available-width) min-w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Combobox.Input
                placeholder="Search assignments"
                aria-label="Search assignments"
                className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty className="px-2.5 py-3 text-sm text-muted-foreground empty:hidden">
              No assignment matches.
            </Combobox.Empty>
            <Combobox.List className="overflow-y-auto p-1">
              {(group: { value: string; label: string; items: AssignmentChoice[] }) => (
                <Combobox.Group key={group.value} items={group.items}>
                  {group.label !== "" && (
                    <Combobox.GroupLabel className="px-1.5 py-1 text-xs text-muted-foreground">
                      {group.label}
                    </Combobox.GroupLabel>
                  )}
                  <Combobox.Collection>
                    {(choice: AssignmentChoice) => (
                      <Combobox.Item
                        key={choice.id}
                        value={choice}
                        className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        <span className="whitespace-nowrap">{choice.title}</span>
                        {choice.draft && (
                          <span className="text-xs text-muted-foreground">Draft</span>
                        )}
                        <Combobox.ItemIndicator
                          render={
                            <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
                          }
                        >
                          <Check className="size-4" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
