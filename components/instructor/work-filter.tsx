"use client";

import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";
import { Filter, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  activeFilterCount,
  COLUMN_FILTER_PARAMS,
  DUE_WINDOWS,
  DUE_WINDOW_META,
  encodeColumnFilter,
  NO_COLUMN_FILTER,
  type ColumnFilter,
  type DueRange,
  type DueWindow,
} from "@/lib/gradebook/filters";
import { ASSIGNMENT_KIND_LABEL } from "@/lib/status";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";

/**
 * Which work a screen is about: its unit, how it is handed in, and when it was due.
 *
 * The same control on the gradebook and on grading triage — one component so the two cannot offer
 * different vocabularies for the same question, and so an instructor who has learned it on one has
 * learned it on both.
 *
 * **The value lives in the query string**, which is what makes a narrowed screen linkable and what
 * survives a reload. It is written *shallowly*, with the browser's own history API rather than the
 * router: both screens hold every row the filter narrows and neither refetches, so navigating here
 * would re-run a server render to produce the payload already in hand. The screens read the value
 * back with `useSearchParams`, which Next keeps in step with a native history write.
 *
 * The screens differ only in wording, which is what `trigger` and `unitsLabel` carry. The gradebook
 * narrows *columns* — the question there is "how did the cohort do on this work" — where triage
 * narrows a pile of work to do; calling both "Columns" would name a thing triage does not have.
 */
export function WorkFilter({
  filter,
  units,
  kinds,
  trigger,
  unitsLabel,
}: {
  /** The filter the screen was built with, parsed from the address by its caller. */
  filter: ColumnFilter;
  /** Every unit a reader may narrow to, in course order. */
  units: { id: string; name: string }[];
  /**
   * The kinds present in the work on screen.
   *
   * Only those, and the group disappears below two: an option that would select everything is not
   * worth offering, and a course whose assignments are all repositories has no question to ask
   * here. Derived from the *unfiltered* work by both callers, so an option cannot vanish the
   * moment it is chosen.
   */
  kinds: AssignmentKind[];
  /** The button's word: "Columns" in the gradebook, "Filter" on triage. */
  trigger: string;
  /** The units group's label: "Show columns for" in the gradebook, "Show work from" on triage. */
  unitsLabel: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeFilterCount(filter);

  /*
    Rebuilt from what is already in the address rather than from nothing, which is what carries the
    cohort and the gradebook's open tab through every change of filter. The three parameters are
    cleared first so that a filter losing a restriction loses the parameter too, rather than
    keeping a stale one nothing overwrites.
  */
  function set(next: ColumnFilter) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of COLUMN_FILTER_PARAMS) params.delete(key);
    for (const [key, value] of encodeColumnFilter(next)) params.set(key, value);

    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : pathname);
  }

  const toggleUnit = (unitId: string) =>
    set({
      ...filter,
      unitIds: filter.unitIds.includes(unitId)
        ? filter.unitIds.filter((id) => id !== unitId)
        : [...filter.unitIds, unitId],
    });

  const toggleKind = (kind: AssignmentKind) =>
    set({
      ...filter,
      kinds: filter.kinds.includes(kind)
        ? filter.kinds.filter((value) => value !== kind)
        : [...filter.kinds, kind],
    });

  /*
    The radio group's value is a string and a range is not one, so a range is offered under a name
    of its own and the dates themselves are chosen outside the menu.
  */
  const range: DueRange | null = typeof filter.due === "string" ? null : filter.due;

  const chooseDue = (value: string) =>
    set({ ...filter, due: value === "range" ? { from: null, to: null } : (value as DueWindow) });

  const setRange = (edge: keyof DueRange, value: string) =>
    set({ ...filter, due: { ...(range ?? { from: null, to: null }), [edge]: value || null } });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              <Filter data-icon="inline-start" />
              {trigger}
              {active > 0 && (
                <Badge variant="secondary" className="ml-1 tabular-nums">
                  {active}
                </Badge>
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-64">
          {/*
            **Every label sits inside the group it names.** Base UI's `Menu.GroupLabel` reads a
            context that only `Menu.Group` and `Menu.RadioGroup` provide, so a label placed as a
            sibling of its group throws on open — "MenuGroupContext is missing" — and the menu
            never appears. Which is also the correct markup: the label is what gives the group its
            accessible name, and a label outside the group names nothing.
          */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{unitsLabel}</DropdownMenuLabel>
            {units.map((unit) => (
              <DropdownMenuCheckboxItem
                key={unit.id}
                checked={filter.unitIds.includes(unit.id)}
                onCheckedChange={() => toggleUnit(unit.id)}
              >
                {unit.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>

          {kinds.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Handed in as</DropdownMenuLabel>
                {kinds.map((kind) => (
                  <DropdownMenuCheckboxItem
                    key={kind}
                    checked={filter.kinds.includes(kind)}
                    onCheckedChange={() => toggleKind(kind)}
                  >
                    {ASSIGNMENT_KIND_LABEL[kind]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={range === null ? (filter.due as string) : "range"}
            onValueChange={chooseDue}
          >
            <DropdownMenuLabel>Due</DropdownMenuLabel>
            {DUE_WINDOWS.map((window) => (
              <DropdownMenuRadioItem key={window} value={window}>
                {DUE_WINDOW_META[window].label}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value="range">Custom range</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          {active > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => set(NO_COLUMN_FILTER)}>
                <X data-icon="inline-start" />
                Clear the filter
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        Beside the menu rather than inside it. A date input is a text field, and inside an open menu
        it competes with the menu's own typeahead and arrow keys for what is typed; out here it is
        an ordinary control and nothing can swallow a keystroke.

        Both ends optional, and left empty on purpose when only one is set — "everything due since
        the term started" is one field filled in, and asking for the other would make a reader name
        a boundary they do not care about.
      */}
      {range !== null && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            From
            <Input
              type="date"
              value={range.from ?? ""}
              max={range.to ?? undefined}
              onChange={(event) => setRange("from", event.target.value)}
              className="h-8 w-[9.5rem]"
              aria-label="Due on or after"
            />
          </label>
          <label className="flex items-center gap-1.5">
            to
            <Input
              type="date"
              value={range.to ?? ""}
              min={range.from ?? undefined}
              onChange={(event) => setRange("to", event.target.value)}
              className="h-8 w-[9.5rem]"
              aria-label="Due on or before"
            />
          </label>
        </div>
      )}
    </>
  );
}
