"use client";

import Link from "next/link";
import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Filter, Search, X } from "lucide-react";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TestStudentBadge } from "@/components/test-student-badge";
import { CATEGORY_META, type CourseUnitCategory } from "@/lib/course-units";
import {
  cellsFor,
  published,
  type UnitVerdict,
  type UnitWithWork,
} from "@/lib/gradebook/categories";
import {
  activeFilterCount,
  DUE_WINDOWS,
  DUE_WINDOW_META,
  filterAssignments,
  filterIsActive,
  NO_COLUMN_FILTER,
  searchStudents,
  sortStudents,
  namesSameColumn,
  studentLabel,
  toggleSort,
  type ColumnFilter,
  type DueWindow,
  type RowSort,
  type SortColumn,
} from "@/lib/gradebook/filters";
import {
  awaitingByStudent,
  completionByAssignment,
  completionByStudent,
  completionLabel,
  type Completion,
} from "@/lib/gradebook/summary";
import { gradingQueueHref, studentHref } from "@/lib/links";
import {
  ASSIGNMENT_KIND_META,
  formatDueDate,
  scoreLabel,
  scorePercent,
  SUBMISSION_STATUS_META,
} from "@/lib/status";
import { cn } from "@/lib/utils";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";
import type { RouterOutputs } from "@/trpc/types";

/**
 * One category of a course, as a grid: every student against every piece of work in it.
 *
 * **The units are bands of columns rather than separate tables.** A module, a project, and an
 * assessment are all course units now, so all three categories draw the same grid — and a reader
 * comparing two modules should be able to read across one row rather than scroll between two
 * tables that happen to share a student column. Each band opens with the unit's own verdict, so
 * "has this student finished Mod 4" is readable beside the deliverables that answer it.
 *
 * **A client component, and the only one in the gradebook.** The controls are the reason: a search
 * box that round-tripped to the server would rebuild the whole grid per keystroke. It receives one
 * category's assignments and cells rather than the whole payload, which is what keeps the other
 * three tabs' work out of the browser — the same reason the tab itself is an address.
 *
 * Every figure is computed from the array this render already holds, never a second read, so a
 * total and the cells beneath it cannot describe different sets of work.
 */

type Gradebook = RouterOutputs["courses"]["gradebook"];
type Assignment = Gradebook["assignments"][number];
type Cell = Gradebook["cells"][number];
type Student = Gradebook["activeEnrollments"][number]["student"];

/** Whether an ungraded submission is work outstanding, or simply never got graded. */
type Pending = "waiting" | "not-graded";

export function GradebookGrid({
  courseId,
  category,
  units,
  active,
  removed,
  cells,
  removedCells,
  now,
}: {
  courseId: string;
  category: CourseUnitCategory;
  /** Every unit of this category, in course order, with its assignments attached. */
  units: UnitWithWork<Assignment>[];
  active: Student[];
  removed: Student[];
  cells: Cell[];
  removedCells: Cell[];
  /**
   * When the page was rendered, as an ISO string.
   *
   * From the server rather than read here, so the due-date windows do not shift between the
   * markup React sent and the markup it hydrates — and so "past due" means the same instant for
   * the heading and for the columns beneath it.
   */
  now: string;
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<ColumnFilter>(NO_COLUMN_FILTER);
  const [sort, setSort] = React.useState<RowSort>({ by: "name", direction: "asc" });

  const at = React.useMemo(() => new Date(now), [now]);

  /**
   * The units that hold any work at all, which is every band this grid can draw.
   *
   * **A unit with no assignments is omitted.** A band is a verdict column and the assignments it
   * is a verdict on; with nothing in it there is no verdict to give and no column to give it
   * beside, so it contributes a heading, an "Overall" that reads "Not finished" for the whole
   * cohort, and nothing else — a column of grey dots claiming a term's students have not finished
   * something that does not exist.
   *
   * This is where the gradebook parts company with the Curriculum screen, which keeps its empty
   * units deliberately: there, an instructor who has just created a project needs to see it where
   * they put it, or the act of creating it looks like it failed. That is a screen about what a
   * course *contains*. This one is about what students have *done*, and there is nothing to have
   * done yet.
   */
  const filled = React.useMemo(() => units.filter((entry) => entry.work.length > 0), [units]);

  /*
    The bands as the filter leaves them. A unit whose work the filter emptied drops out for the
    same reason an empty one never appeared.
  */
  const visible = React.useMemo(() => {
    if (!filterIsActive(filter)) return filled;

    return filled
      .map((entry) => ({ ...entry, work: filterAssignments(entry.work, filter, at) }))
      .filter((entry) => entry.work.length > 0);
  }, [filled, filter, at]);

  const work = React.useMemo(() => visible.flatMap((entry) => entry.work), [visible]);

  const meta = CATEGORY_META[category];

  if (units.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No {meta.pluralNoun} in this cohort yet.</p>
    );
  }

  /*
    Units exist, and none of them holds anything. Said differently from "no modules yet", because
    it is a different situation with a different thing to do about it: the units are there and the
    work has still to be written.
  */
  if (filled.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No {meta.partPluralNoun} in any of this cohort&apos;s {meta.pluralNoun} yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Controls
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        units={filled}
        columns={work.length}
        totalColumns={filled.reduce((sum, entry) => sum + entry.work.length, 0)}
      />

      <CellLegend />

      {work.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nothing matches that filter. Clear it to see every {meta.partNoun} again.
        </p>
      ) : (
        <>
          <Band
            courseId={courseId}
            units={visible}
            allUnits={filled}
            students={searchStudents(active, query)}
            cells={cells}
            work={work}
            pending="waiting"
            sort={sort}
            onSort={setSort}
            emptySearch={active.length > 0}
          />

          {removed.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-medium">Removed students</h3>
                <p className="text-xs text-muted-foreground">
                  No longer in the cohort, and not counted in any figure above. Their work and the
                  feedback they were given stay readable — to them, and here.
                </p>
              </div>
              {/*
                The one thing the two tables differ by. An ungraded submission from a student who
                has left is not waiting on anybody: it is out of triage and out of the queue, so
                nobody is going to grade it. The amber "waiting on you" dot here would claim an
                outstanding task that does not exist and cannot be cleared.
              */}
              <Band
                courseId={courseId}
                units={visible}
                allUnits={filled}
                students={searchStudents(removed, query)}
                cells={removedCells}
                work={work}
                pending="not-graded"
                sort={sort}
                onSort={setSort}
                emptySearch={removed.length > 0}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The search box and the column filter, above the grid.
 *
 * Two controls answering two different questions, which is why they are not one. Searching
 * narrows *rows* — "how is this student doing" — and the filter narrows *columns* — "how did the
 * cohort do on this work". Folding them into one box would mean a query that sometimes hid
 * students and sometimes hid assignments, and no way to say which was meant.
 */
function Controls({
  query,
  onQuery,
  filter,
  onFilter,
  units,
  columns,
  totalColumns,
}: {
  query: string;
  onQuery: (value: string) => void;
  filter: ColumnFilter;
  onFilter: (value: ColumnFilter) => void;
  units: UnitWithWork<Assignment>[];
  columns: number;
  totalColumns: number;
}) {
  const kinds = React.useMemo(() => {
    const present = new Set<AssignmentKind>();
    for (const entry of units) for (const item of entry.work) present.add(item.kind);
    return [...present];
  }, [units]);

  const active = activeFilterCount(filter);

  const toggleUnit = (unitId: string) =>
    onFilter({
      ...filter,
      unitIds: filter.unitIds.includes(unitId)
        ? filter.unitIds.filter((id) => id !== unitId)
        : [...filter.unitIds, unitId],
    });

  const toggleKind = (kind: AssignmentKind) =>
    onFilter({
      ...filter,
      kinds: filter.kinds.includes(kind)
        ? filter.kinds.filter((value) => value !== kind)
        : [...filter.kinds, kind],
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search students"
          aria-label="Search students by name"
          className="pl-8"
        />
        {query !== "" && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear the search"
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              <Filter data-icon="inline-start" />
              Columns
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
            <DropdownMenuLabel>Show columns for</DropdownMenuLabel>
            {units.map((entry) => (
              <DropdownMenuCheckboxItem
                key={entry.unit.id}
                checked={filter.unitIds.includes(entry.unit.id)}
                onCheckedChange={() => toggleUnit(entry.unit.id)}
              >
                {entry.unit.name}
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
                    {ASSIGNMENT_KIND_META[kind].label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={filter.due}
            onValueChange={(value) => onFilter({ ...filter, due: value as DueWindow })}
          >
            <DropdownMenuLabel>Due</DropdownMenuLabel>
            {DUE_WINDOWS.map((window) => (
              <DropdownMenuRadioItem key={window} value={window}>
                {DUE_WINDOW_META[window].label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          {active > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onFilter(NO_COLUMN_FILTER)}>
                <X data-icon="inline-start" />
                Clear the filter
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        What was narrowed to, in words. A grid of four columns is a different claim depending on
        whether the course has four assignments or forty, and nothing else on screen says which.
      */}
      {filterIsActive(filter) && (
        <p className="text-xs text-muted-foreground">
          {columns} of {totalColumns} columns
        </p>
      )}
    </div>
  );
}

/**
 * The grid itself: students down, units across, each unit opening with its own verdict.
 *
 * `pending` is the whole of what the two callers differ by — whether a submission with no score
 * yet is work outstanding or simply something that never got graded.
 */
function Band({
  courseId,
  units,
  allUnits,
  students,
  cells,
  work,
  pending,
  sort,
  onSort,
  emptySearch,
}: {
  courseId: string;
  /** The units as filtered, which is what the columns are drawn from. */
  units: UnitWithWork<Assignment>[];
  /**
   * The same units before the column filter, which is what the verdicts are computed from.
   *
   * Units the filter emptied are still in here, so ticking one deliverable off in the menu
   * narrows the columns without changing whether a student has completed the project.
   */
  allUnits: UnitWithWork<Assignment>[];
  students: Student[];
  cells: Cell[];
  work: Assignment[];
  pending: Pending;
  sort: RowSort;
  onSort: (sort: RowSort) => void;
  emptySearch: boolean;
}) {
  const shown = React.useMemo(() => cellsFor(cells, work), [cells, work]);

  const byKey = React.useMemo(
    () => new Map(shown.map((cell) => [`${cell.assignmentId}:${cell.studentId}`, cell])),
    [shown],
  );

  const downColumn = completionByAssignment(shown, students.length);
  const acrossRow = completionByStudent(shown, work.length);

  /*
    **From `shown` rather than `cells`, so the figure counts the columns beside it.** `cells` is
    every submission in the course; counting those here gave every tab the same number — a student
    with five pieces of work outstanding across the whole course read as five on the Modules tab,
    five on Projects, and five on Assessments, while the row beside it held two amber dots. The
    column has to be the amber dots in that row, or it is a different claim wearing their colour.

    Null where a pending submission is not work outstanding. In the removed students' table it is
    not: that work is out of triage and out of the queue, so nobody is going to grade it — the
    same reason the amber dot is suppressed there.
  */
  const awaiting = pending === "waiting" ? awaitingByStudent(shown) : null;

  /**
   * How much of each unit each student has finished: "3/5", per unit, per student.
   *
   * **A fraction rather than a word.** The cell used to read "Complete", "Incomplete", or "Not
   * finished", and the middle two were a distinction only the code knew — one meant every
   * assignment had been marked and at least one fell short, the other that something was still
   * with an instructor. Nobody reading a grid can be expected to hold that apart, and a red word
   * for "marked and fell short" beside a grey one for "not marked yet" made the pair look like a
   * judgment and a lesser judgment. A count says what is actually known: how many of the unit's
   * assignments this student has finished, out of how many there are.
   *
   * **Published work only, on both halves of the fraction.** A student cannot finish what has not
   * been handed out, so counting drafts would mean an instructor writing next week's assignment
   * turning "5/5" into "5/6" for everyone who had finished the unit. It is the same rule the
   * course roll-up and the student's own course page use, so all three agree.
   *
   * Computed from every assignment in the unit — from `allUnits`, never from the filtered columns.
   * Otherwise ticking one deliverable off in the filter menu would change how much of the project
   * a student had done, which is a different fact from the one the reader narrowed.
   */
  const unitProgress = React.useMemo(() => {
    const map = new Map<string, Map<string, Completion>>();

    for (const entry of allUnits) {
      const live = published(entry.work);
      map.set(entry.unit.id, completionByStudent(cellsFor(cells, live), live.length));
    }

    return map;
  }, [allUnits, cells]);

  /** Whether a student has finished a whole unit, which is the only thing the colour says. */
  const isUnitComplete = (unitId: string, studentId: string): boolean => {
    const progress = unitProgress.get(unitId)?.get(studentId);
    return progress != null && progress.possible > 0 && progress.complete === progress.possible;
  };

  const rows = React.useMemo(
    () =>
      sortStudents(students, sort, {
        completed: (studentId) => acrossRow.get(studentId)?.complete ?? 0,
        waiting: (studentId) => awaiting?.get(studentId) ?? 0,
        score: (studentId, assignmentId) => {
          const cell = byKey.get(`${assignmentId}:${studentId}`);
          if (!cell || cell.finalScore == null) return null;
          return scorePercent(cell.finalScore, cell.finalScorePossible) ?? cell.finalScore;
        },
      }),
    [students, sort, acrossRow, awaiting, byKey],
  );

  if (students.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        {emptySearch ? "No student matches that search." : "Nobody in this cohort yet."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          {/*
            The bands: one heading over each group of columns beneath it.

            **The frozen cell is the student column and nothing else.** It used to span the two
            summary columns as well, which made the pinned block three columns wide — so scrolling
            across left a broad empty area frozen at the left edge with the unit names starting
            somewhere off to the right of it. Only the name has to stay visible while reading
            across; the summary figures scroll with the work they count.

            So the two summary columns get a band of their own rather than sitting under the
            frozen cell. That is what they are — a summary of the whole tab, not part of any one
            unit — and the divider between it and the first unit is the point rather than a cost.
          */}
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-card" />
            <TableHead
              colSpan={2}
              className="border-l border-border text-center text-xs font-medium"
            >
              Summary
            </TableHead>
            {units.map((entry) => (
              <TableHead
                key={entry.unit.id}
                colSpan={1 + entry.work.length}
                className="border-l border-border text-center text-xs font-medium"
              >
                {entry.unit.name}
              </TableHead>
            ))}
          </TableRow>

          <TableRow>
            <SortableHead
              className="sticky left-0 z-10 bg-card"
              label="Student"
              sort={sort}
              column={{ by: "name" }}
              onSort={onSort}
            />
            <SortableHead
              className="border-l border-border"
              label={
                <span className="mx-auto block max-w-28 text-xs leading-tight">
                  Completed
                  <br />
                  work
                </span>
              }
              sort={sort}
              column={{ by: "completed" }}
              onSort={onSort}
              center
            />
            <SortableHead
              label={
                <span className="mx-auto block max-w-28 text-xs leading-tight">
                  Waiting
                  <br />
                  on you
                </span>
              }
              sort={sort}
              column={{ by: "waiting" }}
              onSort={onSort}
              center
            />

            {units.map((entry) => (
              <React.Fragment key={entry.unit.id}>
                <TableHead className="border-l border-border py-2 text-center align-middle">
                  <span className="mx-auto block max-w-28 text-xs leading-tight">Overall</span>
                </TableHead>
                {/*
                  **Wrapped rather than truncated.** Assignment titles in this course are long and
                  share prefixes — `swe-checkpoint-summative-1-4` and `swe-checkpoint-summative-1-5`
                  are the same twenty characters until the end — so a column clipped to one line
                  showed every one of them as the same word followed by an ellipsis, and the only
                  way to tell two apart was to hover each in turn.

                  `whitespace-normal` is doing real work: `TableHead` sets `whitespace-nowrap` for
                  every other table in the application, and without overriding it here the titles
                  ran straight through their neighbours instead of wrapping. A fixed width is what
                  gives the wrap somewhere to happen.

                  Centred in the cell, so a one-line title and a three-line one share a middle
                  rather than a top or a bottom edge — which is what keeps a row of mixed lengths
                  from reading as ragged.
                */}
                {entry.work.map((assignment) => (
                  <TableHead
                    key={assignment.id}
                    className="w-40 min-w-40 py-2 text-center align-middle whitespace-normal"
                  >
                    <div className="flex items-start justify-center gap-1">
                      {/*
                        No point value here: every cell below already reads earned/possible, so a
                        column total would be the same number said twice.
                      */}
                      <Link
                        href={gradingQueueHref(courseId, assignment.id)}
                        className="min-w-0 text-xs leading-tight break-words hover:underline"
                        title={
                          assignment.dueAt
                            ? `${assignment.title} · due ${formatDueDate(assignment.dueAt)}`
                            : assignment.title
                        }
                      >
                        {assignment.title}
                      </Link>
                      <SortArrow
                        active={namesSameColumn(sort, {
                          by: "assignment",
                          assignmentId: assignment.id,
                        })}
                        direction={sort.direction}
                        label={`Sort by ${assignment.title}`}
                        onClick={() =>
                          onSort(
                            toggleSort(sort, { by: "assignment", assignmentId: assignment.id }),
                          )
                        }
                      />
                    </div>
                  </TableHead>
                ))}
              </React.Fragment>
            ))}
          </TableRow>

          {/*
            How many finished each column, directly under its name and above the students.

            A second header row rather than the first row of the body, because it describes the
            columns rather than belonging to anybody — a summary sitting among the students reads
            as a student, and on a cohort of five that matters.
          */}
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-card text-xs font-normal text-muted-foreground">
              Completed
            </TableHead>
            {/*
              The band divider runs the whole height of the table, not only across its heading.
              Every unit band draws it on its own first column; the Summary band has to as well,
              or the frozen student column runs straight into the figures beside it while every
              other group on the row is fenced.
            */}
            <TableHead className="border-l border-border" />
            <TableHead />
            {units.map((entry) => {
              // How many students have finished the whole unit, which is a different question
              // from the fraction each student's own cell below shows.
              const complete = students.filter((student) =>
                isUnitComplete(entry.unit.id, student.id),
              ).length;

              return (
                <React.Fragment key={entry.unit.id}>
                  <TableHead className="border-l border-border text-center text-xs font-medium tabular-nums text-muted-foreground">
                    {completionLabel({ complete, possible: students.length }, students.length)}
                  </TableHead>
                  {entry.work.map((assignment) => (
                    <TableHead
                      key={assignment.id}
                      className="text-center text-xs font-medium tabular-nums text-muted-foreground"
                    >
                      {completionLabel(downColumn.get(assignment.id), students.length)}
                    </TableHead>
                  ))}
                </React.Fragment>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((student) => (
            <TableRow key={student.id}>
              <TableCell className="sticky left-0 z-10 bg-card font-medium">
                {/* Into their record for this cohort. A row of scores prompts "what happened
                    with this person", and the name is where a reader already points. */}
                <div className="flex items-center gap-2">
                  <Link href={studentHref(courseId, student.id)} className="hover:underline">
                    {studentLabel(student)}
                  </Link>
                  {student.testStudentNumber !== null && <TestStudentBadge />}
                </div>
              </TableCell>

              <TableCell className="border-l border-border text-center text-sm font-medium tabular-nums text-muted-foreground">
                {completionLabel(acrossRow.get(student.id), work.length)}
              </TableCell>

              {/*
                Amber when there is anything, and the same amber as the dots it counts, so a reader
                scanning this column for the students who need attention is looking for the colour
                the cells beside it already use. Zero is muted rather than hidden: "nothing waiting"
                is worth reading, and a blank cell says only that something failed to render.
              */}
              <TableCell
                className={cn(
                  "text-center text-sm tabular-nums",
                  awaiting?.get(student.id)
                    ? "font-medium text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                {awaiting === null ? "—" : (awaiting.get(student.id) ?? 0)}
              </TableCell>

              {units.map((entry) => (
                <React.Fragment key={entry.unit.id}>
                  {/*
                    Green only when the whole unit is finished, and muted otherwise. One thing the
                    colour says, so it can be read without a legend — a second colour for "marked
                    and fell short" was the half of the old three-state mark that nobody could
                    tell from "not marked yet".
                  */}
                  <TableCell
                    className={cn(
                      "border-l border-border text-center text-sm font-medium tabular-nums",
                      isUnitComplete(entry.unit.id, student.id)
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {completionLabel(
                      unitProgress.get(entry.unit.id)?.get(student.id),
                      published(entry.work).length,
                    )}
                  </TableCell>
                  {entry.work.map((assignment) => (
                    <ScoreCell
                      key={assignment.id}
                      courseId={courseId}
                      assignmentId={assignment.id}
                      cell={byKey.get(`${assignment.id}:${student.id}`)}
                      pending={pending}
                    />
                  ))}
                </React.Fragment>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** A header that sorts the rows, with the arrow showing which way when it is the active one. */
function SortableHead({
  label,
  sort,
  column,
  onSort,
  className,
  center,
}: {
  label: React.ReactNode;
  sort: RowSort;
  column: SortColumn;
  onSort: (sort: RowSort) => void;
  className?: string;
  center?: boolean;
}) {
  const active = namesSameColumn(sort, column);

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(toggleSort(sort, column))}
        className={cn(
          "flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
          center && "mx-auto",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <SortIcon active={active} direction={sort.direction} />
      </button>
    </TableHead>
  );
}

/** The arrow beside an assignment's title, which is a button of its own so the title stays a link. */
function SortArrow({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: "asc" | "desc";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground/60",
      )}
    >
      <SortIcon active={active} direction={direction} />
    </button>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="size-3 shrink-0" aria-hidden />;
  return direction === "asc" ? (
    <ArrowUp className="size-3 shrink-0" aria-hidden />
  ) : (
    <ArrowDown className="size-3 shrink-0" aria-hidden />
  );
}

/**
 * Whether a student has finished the whole course: done, or not yet.
 *
 * **Two states on screen, not three.** The underlying verdict still distinguishes "incomplete" —
 * every unit marked and one fell short — from "pending", something still with an instructor, and
 * that distinction is real. It was not *legible*: a red word and a grey word sat side by side in
 * a column with no legend, and the pair read as a judgment and a lesser judgment rather than as
 * "finished badly" against "not finished yet". So the two share an appearance here, and the red
 * is gone: this column answers one question, and the answer is yes or not yet.
 *
 * Green is the same green completion uses everywhere else in the interface, which is why nothing
 * else in this file is allowed to be.
 */
const VERDICT_META: Record<UnitVerdict, { label: string; dot: string; text: string }> = {
  complete: {
    label: "Complete",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  incomplete: {
    label: "Not complete",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
  pending: {
    label: "Not complete",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
};

export function VerdictMark({ verdict }: { verdict: UnitVerdict }) {
  const meta = VERDICT_META[verdict];

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", meta.text)}>
      <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * The marks a cell carries when it has no score, drawn from one definition.
 *
 * **One shape at three fills, rather than three unrelated symbols.** They were a dot, a dot, and an
 * em dash, and the dash was the odd one — a typographic mark for "no value" standing in a row with
 * two pieces of interface, which read as a different kind of thing rather than as the first step of
 * the same scale. A ring, a grey dot, and an amber dot are one scale, in the order work actually
 * moves: nothing taken up, taken up, handed in.
 *
 * The same distinction is drawn the same way on the student's progress bar, where "not accepted" is
 * outlined and "accepted" is filled. Two screens describing one fact should not need two visual
 * languages to do it.
 *
 * **Fill against outline rather than two colours**, which is what keeps the pair legible to a
 * reader who cannot tell the hues apart — and every mark carries its label as text besides.
 */
const CELL_MARK = {
  notStarted: "border border-muted-foreground/50",
  accepted: "bg-muted-foreground/40",
  waiting: "bg-amber-500",
} as const;

function CellMark({ kind, label }: { kind: keyof typeof CELL_MARK; label?: string }) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", CELL_MARK[kind])}
      aria-label={label}
      title={label}
      // Decoration wherever the label is already beside it in text, which is the legend.
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}

/**
 * What a cell that is not a score means.
 *
 * **Four marks that are not self-explanatory, and the grid is where they appear.** A number is
 * read without help, where a mark is a convention — and the one the grid most needs to keep apart
 * is the empty ring against the grey dot, since never having started is not the same as having
 * scored nothing.
 *
 * **The labels come from `SUBMISSION_STATUS_META` rather than being written here.** That map is the
 * instructor's vocabulary, read by the triage list, the queue, and every badge in the application,
 * so a legend naming these states itself would be a second set of words for them, free to drift
 * from the badges a reader sees the moment they follow a cell.
 *
 * **The sentences beside them are written here, and deliberately not taken from the same map.**
 * Those descriptions are about repositories — "No repository created yet", "Repository created; no
 * pull request opened yet" — which is true of a `REPO` assignment and false of the other three
 * kinds. A gradebook mixes kinds freely, so a legend explaining every em dash in a column of Google
 * Docs as a missing repository would be confidently wrong. These say the same thing without naming
 * a mechanism.
 *
 * `NOT_STARTED` is the empty ring and `ACCEPTED` the grey dot, which is what those cells mean in
 * practice: the row exists only once a student has taken the work up, so its absence is a student
 * who has not. The amber dot has no status behind it, because it is not a status — `bucket` is a
 * triage question, and "Waiting on you" is the phrase the cell itself already uses. The fourth
 * entry is the one that carries a score *and* a dot, which is the state below.
 */
function CellLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <LegendItem
        mark={<CellMark kind="notStarted" />}
        label={SUBMISSION_STATUS_META.NOT_STARTED.label}
        description="never accepted, and nothing handed in"
      />
      <LegendItem
        mark={<CellMark kind="accepted" />}
        label={SUBMISSION_STATUS_META.ACCEPTED.label}
        description="taken up, with nothing handed in yet"
      />
      <LegendItem
        mark={<CellMark kind="waiting" />}
        label="Waiting on you"
        description="handed in and not yet graded"
      />
      <LegendItem
        mark={
          <span className="flex items-center gap-0.5">
            <span className="text-[10px] font-medium tabular-nums text-foreground">8/10</span>
            <CellMark kind="waiting" />
          </span>
        }
        label={SUBMISSION_STATUS_META.RESUBMITTED.label}
        description="graded and back with you — the score shown is the old one"
      />
    </ul>
  );
}

function LegendItem({
  mark,
  label,
  description,
}: {
  mark: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <li className="flex items-center gap-1.5">
      {/* A fixed width so the marks line up, since a score and a dot are different sizes. */}
      <span className="flex shrink-0 items-center justify-center">{mark}</span>
      <span className="font-medium text-foreground">{label}</span>
      {/*
        The description beside the label rather than in a tooltip. They are one clause each, and a
        legend that has to be hovered to be read is a legend nobody reads — which is the whole
        failure it exists to prevent.
      */}
      <span>— {description}</span>
    </li>
  );
}

/**
 * One student against one assignment: a score, or the mark that says why there is not one.
 *
 * **A scored cell that is back in triage shows its score and an amber dot together.** This is the
 * state a grid of scores could not previously express: a student who was graded and then handed in
 * improved work read exactly like a student who was graded and stopped — and the first is the one
 * an instructor most needs to catch. The score stays because the last grade is still the standing
 * one; the dot is the same amber as every other "waiting on you" mark, because it is the same
 * fact, and it is drawn from the same `bucket` the column beside it counts.
 */
function ScoreCell({
  courseId,
  assignmentId,
  cell,
  pending,
}: {
  courseId: string;
  assignmentId: string;
  cell: Cell | undefined;
  pending: Pending;
}) {
  if (!cell) {
    /*
      No submission row at all, which is the same fact as `NOT_STARTED` and drawn the same way.
      An empty ring rather than an em dash: the dash was a typographic mark for "no value"
      sitting among two interface dots, and it read as a different kind of thing rather than as
      the first step of the same scale.
    */
    return (
      <TableCell className="text-center">
        <span className="flex items-center justify-center">
          <CellMark kind="notStarted" label={SUBMISSION_STATUS_META.NOT_STARTED.label} />
        </span>
      </TableCell>
    );
  }

  const graded = cell.finalScore != null;

  /*
    **Any cell that is in a triage bucket carries the amber dot, scored or not.** The bucket is
    the same fact the "Waiting on you" column counts, so drawing the dot on exactly the bucketed
    cells is what makes the column equal the dots in its row rather than a number a reader has to
    take on trust. It also covers the resubmission case without naming it: work that was graded
    and handed in again is back in triage, which is precisely when the dot should return.

    Suppressed in the removed students' table for the reason that column is: nobody is going to
    grade that work, so a mark claiming it is waiting would name a task that cannot be cleared.
  */
  const waiting = cell.bucket != null && pending === "waiting";

  return (
    <TableCell className="p-0 text-center">
      <Link
        href={gradingQueueHref(courseId, assignmentId, cell.id)}
        className="flex h-11 items-center justify-center gap-1 px-3 transition-colors hover:bg-muted/60"
      >
        {graded ? (
          <>
            {/*
              **Green means complete, not "high".** The colour used to turn at 90%, which is a
              number this application decides nothing else by — so an assignment whose threshold
              is 75% could be comfortably passed and still read as plain black, while the row's
              own verdict beside it said complete. `isComplete` is the assignment's own threshold
              applied by `approveDraft`, so the cell now agrees with the verdict, the student's
              progress bar, and every other place completion is claimed.

              Null is neither: a score with no completion decision recorded is uncoloured rather
              than guessed at.
            */}
            <span
              className={cn(
                "text-sm font-medium tabular-nums",
                cell.isComplete === false
                  ? "text-destructive"
                  : cell.isComplete === true
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-foreground",
              )}
            >
              {scoreLabel(cell.finalScore, cell.finalScorePossible)}
            </span>
            {waiting && <CellMark kind="waiting" label="Waiting on you" />}
          </>
        ) : pending === "not-graded" ? (
          // In words rather than as a dot. A dot needs a legend, and the one thing worth
          // knowing about a removed student's ungraded work is exactly that: it was never graded.
          <span className="text-xs text-muted-foreground">Not graded</span>
        ) : (
          /*
            Accepted or submitted but not graded. A mark rather than a number, because there is
            no number yet — and the same mark the legend draws, from `CELL_MARK`, so the two
            cannot come to disagree.

            The label goes through `SUBMISSION_STATUS_META` rather than the raw column, which put
            `NOT_STARTED` in a tooltip. The legend names these states in the instructor's
            vocabulary, and a cell answering in database values would not match the words a
            reader had just been given.
          */
          <CellMark
            kind={cell.bucket ? "waiting" : "accepted"}
            label={cell.bucket ? "Waiting on you" : SUBMISSION_STATUS_META[cell.status].label}
          />
        )}
      </Link>
    </TableCell>
  );
}
