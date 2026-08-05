'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronsUpDown,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  Filter,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Gradebook } from '@/components/instructor/gradebook';
import { RemoveAssignmentDialog } from '@/components/instructor/remove-assignment-dialog';
import { EmptyState } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { AssignmentKindBadge } from '@/components/status-badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EnrollmentStatus } from '@/lib/generated/prisma/enums';
import { gradingQueueHref } from '@/lib/links';
import { useTRPC } from '@/trpc/client';
import { ASSIGNMENT_KIND_META, formatDate, moduleLabel, moduleOrder } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { RouterOutputs } from '@/trpc/types';

/**
 * One course from the instructor's side: what has been set, who is in it, and where
 * everybody stands.
 */

type Data = RouterOutputs['courses']['gradebook'];
type Assignment = Data['assignments'][number];

/** The kinds this course actually uses, in enum order, for the filter to offer. */
const KIND_ORDER = ['REPO', 'GOOGLE_DOC', 'FILE_UPLOAD'] as const;

export function InstructorCourseDetail({ data }: { data: Data }) {
  const activeStudents = data.enrollments.filter(
    (enrollment) => enrollment.status === 'ACTIVE',
  ).length;

  // The same count the triage screen shows, from the same field, so the two agree.
  const outstanding = data.cells.filter(
    (cell) => cell.bucket !== null && cell.bucket !== 'generating',
  ).length;

  const org = [...new Set(data.assignments.map((assignment) => assignment.githubOrg))];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={data.course.name}
        description={
          outstanding === 0
            ? data.course.cohortTerm
            : `${data.course.cohortTerm} · ${outstanding} ${outstanding === 1 ? 'submission' : 'submissions'
            } waiting on you`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/instructor"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Grading triage
              <ArrowRight data-icon="inline-end" />
            </Link>
            <Link
              href={`/instructor/courses/${data.course.id}/assignments/new`}
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              <Plus data-icon="inline-start" />
              New assignment
            </Link>
          </div>
        }
      />

      <Tabs defaultValue="assignments">
        <TabsList>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="gradebook">Gradebook</TabsTrigger>
        </TabsList>

        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab data={data} />
        </TabsContent>
        <TabsContent value="roster" className="mt-4">
          <RosterTab enrollments={data.enrollments} />
        </TabsContent>
        <TabsContent value="gradebook" className="mt-4">
          <Gradebook data={data} />
        </TabsContent>
      </Tabs>

      {/*
        Below the work rather than above it. These are facts about the course that are worth
        being able to check and are not what the screen is for — the assignments, the roster,
        and the gradebook are. At the top they spent a band of the viewport restating a count
        the tabs themselves show.
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={ClipboardList} label="Assignments" value={data.assignments.length} />
        <StatCard icon={Users} label="Active students" value={activeStudents} />
        <StatCard
          icon={GitBranch}
          label={org.length > 1 ? 'Organizations' : 'Organization'}
          value={org.length > 0 ? org.join(', ') : '—'}
          mono
        />
      </div>
    </div>
  );
}

/**
 * One column's comparison, in the direction asked for.
 *
 * Direction is applied inside each case rather than by negating the result, because one of
 * them must not flip: an assignment with no due date sorts last in **both** directions. "No
 * due date" is not earlier or later than every date, it is outside the ordering, and negating
 * the comparator would march every undated assignment to the top of the list.
 */
function compareOn(
  key: SortKey,
  dir: 'asc' | 'desc',
  a: Assignment,
  b: Assignment,
  helpers: {
    compare: (x: string, y: string) => number;
    countsFor: (assignment: Assignment) => Counts;
  },
): number {
  const sign = dir === 'asc' ? 1 : -1;

  switch (key) {
    case 'title':
      return sign * a.title.localeCompare(b.title);
    case 'module':
      return sign * helpers.compare(a.moduleTag, b.moduleTag);
    case 'due': {
      if (!a.dueAt || !b.dueAt) {
        if (!a.dueAt && !b.dueAt) return 0;
        return a.dueAt ? -1 : 1;
      }
      return sign * (a.dueAt.getTime() - b.dueAt.getTime());
    }
    case 'graded':
      return sign * (helpers.countsFor(a).graded - helpers.countsFor(b).graded);
    case 'to_grade':
      return sign * (helpers.countsFor(a).outstanding - helpers.countsFor(b).outstanding);
  }
}

/**
 * A column header that sorts, and says how.
 *
 * The arrow is on every sorted column rather than only the first, and carries its position in
 * the stack when there is more than one — without the ordinal, two arrows say the table is
 * sorted two ways and not which wins.
 */
function SortableHead({
  label,
  sortKey,
  sorts,
  onSort,
  align = 'left',
  className,
}: {
  label: string;
  sortKey: SortKey;
  sorts: SortEntry[];
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const index = sorts.findIndex((entry) => entry.key === sortKey);
  const active = index === -1 ? null : sorts[index];
  const Arrow = active?.dir === 'desc' ? ArrowDown : ArrowUp;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}`}
        className={cn(
          'group inline-flex items-center gap-1 rounded-md py-0.5 text-inherit transition-colors hover:text-foreground',
          align === 'right' && 'ml-auto flex-row-reverse',
        )}
      >
        {label}
        {active ? (
          <span className="inline-flex items-center gap-0.5 text-foreground">
            <Arrow className="size-3.5" />
            {/* Only when the order between columns is a question. */}
            {sorts.length > 1 && (
              <span className="text-[10px] font-semibold tabular-nums">{index + 1}</span>
            )}
          </span>
        ) : (
          // Present but invisible until hovered, so the columns do not shift as sorts change
          // and the header still says it can be clicked.
          <ChevronsUpDown className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
        )}
      </button>
    </TableHead>
  );
}

/**
 * Everything the table is narrowed by, apart from the search box and the status switcher.
 *
 * An empty list means "not filtered by this", not "nothing matches" — which is what lets the
 * default state be no filters at all rather than every module ticked. The two dates are
 * independently optional, so "due before the end of term" and "due after today" are both
 * expressible without inventing a bound for the other end.
 */
type FilterState = {
  modules: string[];
  kinds: Assignment['kind'][];
  /** `yyyy-mm-dd`, as the date input gives it. */
  dueFrom: string | null;
  dueTo: string | null;
};

const NO_FILTERS: FilterState = { modules: [], kinds: [], dueFrom: null, dueTo: null };

function activeFilterCount(filters: FilterState): number {
  return (
    filters.modules.length +
    filters.kinds.length +
    (filters.dueFrom ? 1 : 0) +
    (filters.dueTo ? 1 : 0)
  );
}

/**
 * Whether this assignment is inside the chosen due-date range.
 *
 * An assignment with no due date is **out** whenever either bound is set. Asking for what is
 * due in a window is asking about dated work; an undated assignment is not early or late for
 * the window, it is not in it. With neither bound set nothing is being asked and everything
 * passes, which is how undated assignments stay visible by default.
 */
function withinDueRange(dueAt: Date | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  if (!dueAt) return false;

  // Parsed as local time, the same way the authoring form reads its date input. The bounds are
  // inclusive whole days: a range of one day contains everything due that day.
  if (from && dueAt < new Date(`${from}T00:00:00`)) return false;
  if (to && dueAt > new Date(`${to}T23:59:59.999`)) return false;
  return true;
}

/**
 * The filter menu: categories down the left, the options for one category out to the right.
 *
 * A menu rather than a row of selects because the row was three controls wide before a due
 * date was one of them, and most of the time none of them is set. Multi-select rather than
 * one-of, because "modules 1 and 2" is a question an instructor actually has and a single
 * select cannot express it.
 */
function AssignmentFilterMenu({
  moduleTags,
  kindsInUse,
  filters,
  onChange,
}: {
  moduleTags: string[];
  kindsInUse: readonly Assignment['kind'][];
  filters: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const count = activeFilterCount(filters);

  /** Ticking and unticking one entry of a list, without caring which list. */
  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: count > 0 ? 'secondary' : 'outline', size: 'sm' }),
            )}
          >
            <Filter data-icon="inline-start" />
            Filter
            {/* The count is the only thing on the closed control saying anything is set at
                all — without it a filtered table looks like a course with fewer assignments. */}
            {count > 0 && (
              <span className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground tabular-nums">
                {count}
              </span>
            )}
          </button>
        }
      />

      <DropdownMenuContent align="start" className="w-52">
        {moduleTags.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Modules
              {filters.modules.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                  {filters.modules.length}
                </span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
              {/*
                The way out of a selection. With nothing ticked every module is shown, so this
                is a reset rather than a "select all" — and it is disabled when it would do
                nothing, which is also how it says what the current state is.
              */}
              <DropdownMenuItem
                disabled={filters.modules.length === 0}
                onClick={() => onChange({ ...filters, modules: [] })}
              >
                Show all modules
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {moduleTags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag}
                  checked={filters.modules.includes(tag)}
                  onCheckedChange={() =>
                    onChange({ ...filters, modules: toggle(filters.modules, tag) })
                  }
                >
                  {moduleLabel(tag)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {kindsInUse.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Submission type
              {filters.kinds.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                  {filters.kinds.length}
                </span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuItem
                disabled={filters.kinds.length === 0}
                onClick={() => onChange({ ...filters, kinds: [] })}
              >
                Show all types
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {kindsInUse.map((name) => (
                <DropdownMenuCheckboxItem
                  key={name}
                  checked={filters.kinds.includes(name)}
                  onCheckedChange={() =>
                    onChange({ ...filters, kinds: toggle(filters.kinds, name) })
                  }
                >
                  {ASSIGNMENT_KIND_META[name].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Due date
            {(filters.dueFrom || filters.dueTo) && (
              <span className="ml-1 text-xs text-muted-foreground">
                {filters.dueFrom && filters.dueTo ? 'range' : filters.dueFrom ? 'from' : 'until'}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            {/*
              Two inputs rather than menu items, so the keyboard has to be handed to them: a
              menu listens for typing to jump between its items, which would eat the digits of
              a date. Stopping the keystrokes here is what makes the fields typeable.
            */}
            <div
              className="flex flex-col gap-2 p-2"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Due on or after
                <Input
                  type="date"
                  value={filters.dueFrom ?? ''}
                  onChange={(event) =>
                    onChange({ ...filters, dueFrom: event.target.value || null })
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Due on or before
                <Input
                  type="date"
                  value={filters.dueTo ?? ''}
                  onChange={(event) => onChange({ ...filters, dueTo: event.target.value || null })}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Either can be left empty. Assignments with no due date are hidden while a date
                is set.
              </p>
              {(filters.dueFrom || filters.dueTo) && (
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, dueFrom: null, dueTo: null })}
                  className="self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Clear dates
                </button>
              )}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {count > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(NO_FILTERS)}>
              <X data-icon="inline-start" />
              Clear all filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What the table can be narrowed to. Every one of these is a question about a whole cohort. */
type AssignmentFilter = 'all' | 'to_grade' | 'published' | 'draft';
/** Which column a sort is on. Every data column in the table is one. */
type SortKey = 'title' | 'module' | 'due' | 'graded' | 'to_grade';

/**
 * A stack of sorts, most recently clicked first.
 *
 * Clicking a column that is already on top flips its direction; clicking any other column
 * pushes it to the front. So "module, then due date within it" is expressed by clicking due
 * date and then module, which is the reverse of the order they apply in — and the ordinal on
 * each header is what makes that legible rather than something to work out.
 */
type SortEntry = { key: SortKey; dir: 'asc' | 'desc' };

/**
 * Which way a column runs when it is first clicked.
 *
 * Counts start descending because the reason to sort by "to grade" is to find the assignments
 * with the most of it; text and dates start ascending, where the first row is the answer to
 * "which is earliest" or "what begins with A".
 */
const FIRST_DIRECTION: Record<SortKey, 'asc' | 'desc'> = {
  title: 'asc',
  module: 'asc',
  due: 'asc',
  graded: 'desc',
  to_grade: 'desc',
};

/** How deep the stack goes. Past three, nobody can say what order they asked for. */
const SORT_DEPTH = 3;

type Counts = { graded: number; submitted: number; outstanding: number };
const NO_COUNTS: Counts = { graded: 0, submitted: 0, outstanding: 0 };

function AssignmentsTab({ data }: { data: Data }) {
  const [query, setQuery] = React.useState('');
  const [filters, setFilters] = React.useState<FilterState>(NO_FILTERS);
  const [filter, setFilter] = React.useState<AssignmentFilter>('all');
  const [sorts, setSorts] = React.useState<SortEntry[]>([]);

  /*
    One pass over the cells rather than a filter per assignment. It matters here because the
    counts are read from inside a comparator: filtering 25 students' cells again for every
    comparison of every sort is the difference between one pass and thousands.
  */
  const counts = React.useMemo(() => {
    const map = new Map<string, Counts>(
      data.assignments.map((assignment) => [assignment.id, { ...NO_COUNTS }]),
    );

    for (const cell of data.cells) {
      const entry = map.get(cell.assignmentId);
      if (!entry) continue;
      if (cell.finalScore != null) entry.graded += 1;
      // "Handed in": accepting an assignment is not submitting it.
      if (cell.status !== 'NOT_STARTED' && cell.status !== 'ACCEPTED') entry.submitted += 1;
      if (cell.bucket !== null && cell.bucket !== 'generating') entry.outstanding += 1;
    }

    return map;
  }, [data.assignments, data.cells]);

  const countsFor = React.useCallback(
    (assignment: Assignment) => counts.get(assignment.id) ?? NO_COUNTS,
    [counts],
  );

  /** Clicking a header: flip it if it is already the active sort, else make it the active one. */
  const toggleSort = React.useCallback((key: SortKey) => {
    setSorts((prev) => {
      // Already the primary sort, so this is a request to reverse it.
      if (prev[0]?.key === key) {
        return [{ key, dir: prev[0].dir === 'asc' ? 'desc' : 'asc' }, ...prev.slice(1)];
      }

      const rest = prev.filter((entry) => entry.key !== key);
      // Promoted from further down the stack, keeping the direction already chosen for it.
      // Resetting it to the default would undo a decision the click did not ask about.
      const existing = prev.find((entry) => entry.key === key);

      return [existing ?? { key, dir: FIRST_DIRECTION[key] }, ...rest].slice(0, SORT_DEPTH);
    });
  }, []);

  if (data.assignments.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No assignments yet"
        description="Add one from the answer-keys repository — what it holds is what this course can offer."
        action={
          <Link
            href={`/instructor/courses/${data.course.id}/assignments/new`}
            className={cn(buttonVariants())}
          >
            <Plus data-icon="inline-start" />
            New assignment
          </Link>
        }
      />
    );
  }

  const compare = moduleOrder(data.course.moduleStructure);
  const term = query.trim().toLowerCase();

  const assignments = data.assignments
    .filter((assignment) => {
      // An empty list is not a filter. Every one of these reads "unless something was chosen
      // and this is not it".
      if (filters.modules.length > 0 && !filters.modules.includes(assignment.moduleTag)) {
        return false;
      }
      if (filters.kinds.length > 0 && !filters.kinds.includes(assignment.kind)) return false;
      if (!withinDueRange(assignment.dueAt, filters.dueFrom, filters.dueTo)) return false;
      if (term && !assignment.title.toLowerCase().includes(term)) return false;
      if (filter === 'published') return assignment.distributedAt !== null;
      if (filter === 'draft') return assignment.distributedAt === null;
      if (filter === 'to_grade') return countsFor(assignment).outstanding > 0;
      return true;
    })
    .sort((a, b) => {
      for (const { key, dir } of sorts) {
        const result = compareOn(key, dir, a, b, { compare, countsFor });
        if (result !== 0) return result;
      }

      /*
        Course order underneath everything, and the default when nothing has been clicked. It
        is the order the course is taught in, which is neither alphabetical nor by date —
        `moduleOrder` reads the cohort's own `moduleStructure`. Having it as the final
        tiebreak is also what stops equal rows — three assignments with nothing to grade —
        from coming back in a different order on each render.
      */
      const byModule = compare(a.moduleTag, b.moduleTag);
      return byModule !== 0 ? byModule : a.title.localeCompare(b.title);
    });

  const toGradeCount = data.assignments.filter(
    (assignment) => countsFor(assignment).outstanding > 0,
  ).length;
  const draftCount = data.assignments.filter(
    (assignment) => assignment.distributedAt === null,
  ).length;

  // Offered only when the course has more than one, the same rule the module select follows:
  // a filter with one option filters nothing and is a control to read past.
  const kindsInUse = KIND_ORDER.filter((name) =>
    data.assignments.some((assignment) => assignment.kind === name),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assignments…"
            className="pl-8"
          />
        </div>

        <AssignmentFilterMenu
          moduleTags={data.course.moduleStructure}
          kindsInUse={kindsInUse}
          filters={filters}
          onChange={setFilters}
        />

        {/*
          Sorting is done from the column headers, so the only control it needs here is the way
          back — to course order, which is the order the cohort is taught in rather than the
          absence of an order.
        */}
        {sorts.length > 0 && (
          <button
            type="button"
            onClick={() => setSorts([])}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            Reset order
          </button>
        )}
      </div>

      {/*
        The counts are of the whole course, not of what is currently shown, so switching
        between them says how much there is rather than how much of the current view there
        is. Same shape as the grading queue's filter, for the same reason.
      */}
      <div className="flex items-center gap-1 self-start rounded-lg bg-muted p-1">
        {(
          [
            { key: 'all', label: `All (${data.assignments.length})` },
            { key: 'to_grade', label: `To grade (${toGradeCount})` },
            { key: 'published', label: `Published (${data.assignments.length - draftCount})` },
            { key: 'draft', label: `Drafts (${draftCount})` },
          ] as { key: AssignmentFilter; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              filter === tab.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {assignments.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing matches"
          description="No assignment in this course matches the search and filters above."
          // The way out, from where the problem is seen. A hidden filter is easy to forget
          // about, and an empty table is exactly when it matters that it is set.
          action={
            activeFilterCount(filters) > 0 || query !== '' ? (
              <button
                type="button"
                onClick={() => {
                  setFilters(NO_FILTERS);
                  setQuery('');
                }}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <X data-icon="inline-start" />
                Clear the search and filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Assignment" sortKey="title" sorts={sorts} onSort={toggleSort} />
                <SortableHead
                  label="Module"
                  sortKey="module"
                  sorts={sorts}
                  onSort={toggleSort}
                  className="hidden md:table-cell"
                />
                <SortableHead
                  label="Due"
                  sortKey="due"
                  sorts={sorts}
                  onSort={toggleSort}
                  className="hidden sm:table-cell"
                />
                <SortableHead
                  label="Graded"
                  sortKey="graded"
                  sorts={sorts}
                  onSort={toggleSort}
                  align="right"
                  className="text-right"
                />
                <SortableHead
                  label="To grade"
                  sortKey="to_grade"
                  sorts={sorts}
                  onSort={toggleSort}
                  align="right"
                  className="text-right"
                />
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => {
                const counts = countsFor(assignment);

                return (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={gradingQueueHref(assignment.id)}
                          className="font-medium hover:underline"
                        >
                          {assignment.title}
                        </Link>
                        <AssignmentKindBadge kind={assignment.kind} />
                        {/* A student cannot see this one at all, which is worth saying rather
                        than leaving an instructor to wonder why nobody has submitted. */}
                        {assignment.distributedAt === null && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
                          >
                            Draft
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {assignment.pointValue} pts
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary" className="font-normal">
                        {moduleLabel(assignment.moduleTag)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatDate(assignment.dueAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-medium">{counts.graded}</span>
                      <span className="text-muted-foreground">/{counts.submitted}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {counts.outstanding > 0 ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
                        >
                          {counts.outstanding}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={gradingQueueHref(assignment.id)}
                          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label={`Grade ${assignment.title}`}
                        >
                          <ArrowRight className="size-4" />
                        </Link>
                        <AssignmentActions
                          assignment={assignment}
                          courseId={data.course.id}
                          hasSubmissions={counts.submitted > 0}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Edit, publish, duplicate, and remove, for one assignment.
 *
 * Publishing is the action most often wanted and is offered directly; the rest sit behind the
 * menu. Removing is last and separated, because it is the one action here that destroys
 * student work — the dialog it opens states exactly what would go.
 */
function AssignmentActions({
  assignment,
  courseId,
  hasSubmissions,
}: {
  assignment: Assignment;
  courseId: string;
  hasSubmissions: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = React.useState(false);

  const published = assignment.distributedAt !== null;

  const publish = useMutation(
    trpc.assignments.publish.mutationOptions({
      onSuccess: () => {
        toast.success(`${assignment.title} is now visible to students.`);
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const unpublish = useMutation(
    trpc.assignments.unpublish.mutationOptions({
      onSuccess: () => {
        toast.success(`${assignment.title} is hidden from students. Their work is untouched.`);
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const duplicate = useMutation(
    trpc.assignments.duplicate.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Copied to ${result.assignment.title}. It is not visible to students yet.`);
        void queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const busy = publish.isPending || unpublish.isPending || duplicate.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={busy}
              aria-label={`Actions for ${assignment.title}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={
              <Link href={`/instructor/courses/${courseId}/assignments/${assignment.id}/edit`}>
                <Pencil data-icon="inline-start" />
                Edit
              </Link>
            }
          />
          {published ? (
            <DropdownMenuItem onClick={() => unpublish.mutate({ assignmentId: assignment.id })}>
              <EyeOff data-icon="inline-start" />
              Hide from students
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => publish.mutate({ assignmentId: assignment.id })}>
              <Eye data-icon="inline-start" />
              Publish
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              duplicate.mutate({
                assignmentId: assignment.id,
                targetCourseId: courseId,
                // Into the same course, so the name has to differ. Copying to another cohort
                // keeps the name and is what the procedure is really for; that needs a course
                // picker, which waits for course creation to exist.
                assignmentRepoName: `${assignment.title}-copy`,
              })
            }
          >
            <Copy data-icon="inline-start" />
            Duplicate here
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>
            <Trash2 data-icon="inline-start" />
            {hasSubmissions ? 'Remove, with student work' : 'Remove'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RemoveAssignmentDialog
        assignmentId={assignment.id}
        title={assignment.title}
        open={removing}
        onOpenChange={setRemoving}
      />
    </>
  );
}

function RosterTab({ enrollments }: { enrollments: Data['enrollments'] }) {
  if (enrollments.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Nobody is enrolled yet"
        description="Students appear here once they have been invited to the cohort."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead className="hidden sm:table-cell">GitHub</TableHead>
            <TableHead className="text-right">Enrollment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enrollments.map((enrollment) => {
            // Before an invitation is redeemed there is no profile, only the address it
            // was sent to. That is what identifies the row until they sign in.
            const name = enrollment.student?.displayName ?? enrollment.invitedEmail;
            const email = enrollment.student?.email ?? enrollment.invitedEmail;

            return (
              <TableRow key={enrollment.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                        {enrollment.student ? initials(enrollment.student.displayName) : '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{name}</span>
                      <span className="truncate text-xs text-muted-foreground">{email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {enrollment.student?.githubUsername ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <GitBranch className="size-3.5" />
                      {enrollment.student.githubUsername}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <EnrollmentBadge status={enrollment.status} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function EnrollmentBadge({ status }: { status: EnrollmentStatus }) {
  const meta: Record<EnrollmentStatus, { label: string; className: string }> = {
    ACTIVE: {
      label: 'Active',
      className: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
    },
    INVITED: {
      label: 'Invited',
      className: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
    },
    REMOVED: { label: 'Removed', className: 'border-border text-muted-foreground' },
  };

  return (
    <Badge variant="outline" className={cn('font-normal', meta[status].className)}>
      {meta[status].label}
    </Badge>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  // One line, no vertical padding beyond what the text needs: a footnote rather than a
  // headline. `py-0` is load-bearing — the card's own default padding is what made these
  // tall.
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-2 px-3 py-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={cn(
            'ml-auto min-w-0 truncate text-xs font-medium',
            mono && 'font-mono',
          )}
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function initials(name: string | null): string {
  return (name ?? '?')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
