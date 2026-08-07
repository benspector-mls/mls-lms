'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as React from 'react';
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
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
  UserMinus,
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
import { Button, buttonVariants } from '@/components/ui/button';
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
import { ModulesTab } from '@/components/instructor/modules-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cohortSlugProblem, MAX_COHORT_SLUG } from '@/lib/courses/cohort-slug';
import type { EnrollmentStatus } from '@/lib/generated/prisma/enums';
import { gradingQueueHref, triageHref } from '@/lib/links';
import { useTRPC } from '@/trpc/client';
import { ASSIGNMENT_KIND_META, formatDate } from '@/lib/status';
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
  const activeStudents = data.activeEnrollments.length;

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
            <ArchiveCourseButton
              courseId={data.course.id}
              archived={data.course.archivedAt !== null}
            />
            {/* This cohort's, not every cohort's — the button used to land on a pile that
                mixed in every other course the instructor teaches. */}
            <Link
              href={triageHref(data.course.id)}
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

      {/*
        Said at the top of the course rather than only on the card that lists it, because this is
        the screen an instructor is on when they wonder why nothing is happening.
      */}
      {data.course.archivedAt !== null && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {/*
            "Out of triage" and not "out of the grading queue", which is what this said and
            was not true. Triage is a list of work waiting to be done, and a finished cohort's
            work is not waiting; the queue for a named assignment is how its submissions are
            read, and emptying that would take the feedback back.
          */}
          <p className="text-muted-foreground">
            This cohort is archived. It is off everyone&apos;s active course list and its
            submissions are out of grading triage. Everything stays readable to the people who
            were in it — this page, the gradebook, and every assignment&apos;s own queue — and
            nothing new can be handed in.
          </p>
        </div>
      )}

      <Tabs defaultValue="assignments">
        <TabsList>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          {/* Beside Assignments, which is where they group by module already. */}
          <TabsTrigger value="modules">Modules</TabsTrigger>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="gradebook">Gradebook</TabsTrigger>
        </TabsList>

        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab data={data} />
        </TabsContent>
        <TabsContent value="modules" className="mt-4">
          <ModulesTab courseId={data.course.id} />
        </TabsContent>
        <TabsContent value="roster" className="mt-4">
          <RosterTab
            courseId={data.course.id}
            enrollments={data.enrollments}
            joinToken={data.course.joinToken}
            cohortSlug={data.course.cohortSlug}
            // Any submission means at least one repository is already named after the slug,
            // which is what freezes it.
            frozen={data.cells.length > 0}
          />
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
/**
 * Course order: the order the modules are taught in, which is neither alphabetical nor by
 * date. `position` is what an instructor sets on the Modules tab, so this is that decision
 * rather than anything parsed out of a name.
 */
function compareByModule(a: Assignment, b: Assignment): number {
  return (
    a.module.position - b.module.position ||
    a.module.name.localeCompare(b.module.name) ||
    a.title.localeCompare(b.title)
  );
}

function compareOn(
  key: SortKey,
  dir: 'asc' | 'desc',
  a: Assignment,
  b: Assignment,
  helpers: {
    countsFor: (assignment: Assignment) => Counts;
  },
): number {
  const sign = dir === 'asc' ? 1 : -1;

  switch (key) {
    case 'title':
      return sign * a.title.localeCompare(b.title);
    case 'module':
      return sign * compareByModule(a, b);
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
  modules,
  kindsInUse,
  filters,
  onChange,
}: {
  modules: { id: string; name: string }[];
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
        {modules.length > 1 && (
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
              {modules.map((moduleRow) => (
                <DropdownMenuCheckboxItem
                  key={moduleRow.id}
                  checked={filters.modules.includes(moduleRow.id)}
                  onCheckedChange={() =>
                    onChange({ ...filters, modules: toggle(filters.modules, moduleRow.id) })
                  }
                >
                  {moduleRow.name}
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
        icon={<ClipboardList />}
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

  const term = query.trim().toLowerCase();

  const assignments = data.assignments
    .filter((assignment) => {
      // An empty list is not a filter. Every one of these reads "unless something was chosen
      // and this is not it".
      if (filters.modules.length > 0 && !filters.modules.includes(assignment.module.id)) {
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
        const result = compareOn(key, dir, a, b, { countsFor });
        if (result !== 0) return result;
      }

      /*
        Course order underneath everything, and the default when nothing has been clicked.
        Having it as the final tiebreak is also what stops equal rows — three assignments with
        nothing to grade — from coming back in a different order on each render.
      */
      return compareByModule(a, b);
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
          modules={data.course.modules}
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
          icon={<Search />}
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
                          href={gradingQueueHref(data.course.id, assignment.id)}
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
                        {assignment.module.name}
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
                          href={gradingQueueHref(data.course.id, assignment.id)}
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
  const router = useRouter();
  const [removing, setRemoving] = React.useState(false);

  /*
    Both, and both are needed for different halves of this screen.

    This page's assignments, roster, and gradebook are fetched by a *server* component and
    passed down as a prop, so the browser's query cache never held them — `invalidateQueries`
    has nothing to invalidate and the row went on showing "Draft" until the page was reloaded
    by hand. `router.refresh()` re-runs the server component, which is what updates them.
    `invalidateQueries` is still right for the parts that *are* client queries, the Modules tab
    among them, since duplicating or removing an assignment changes its module's count.
  */
  const settled = () => {
    void queryClient.invalidateQueries();
    router.refresh();
  };

  const published = assignment.distributedAt !== null;

  const publish = useMutation(
    trpc.assignments.publish.mutationOptions({
      onSuccess: () => {
        toast.success(`${assignment.title} is now visible to students.`);
        settled();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const unpublish = useMutation(
    trpc.assignments.unpublish.mutationOptions({
      onSuccess: () => {
        toast.success(`${assignment.title} is hidden from students. Their work is untouched.`);
        settled();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const duplicate = useMutation(
    trpc.assignments.duplicate.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Copied to ${result.assignment.title}. It is not visible to students yet.`);
        settled();
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

/**
 * Retiring a cohort, or bringing it back.
 *
 * Two clicks to archive and one to unarchive, deliberately asymmetric. Archiving is the one that
 * changes what a whole cohort of students sees, so it says what it will do first; unarchiving
 * only undoes it, and a confirmation on an undo is a confirmation nobody reads.
 */
function ArchiveCourseButton({
  courseId,
  archived,
}: {
  courseId: string;
  archived: boolean;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);

  const setArchived = useMutation(
    trpc.courses.setArchived.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.archivedAt === null
            ? `${result.name} is active again.`
            : `${result.name} is archived.`,
        );
        setConfirming(false);
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (archived) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={setArchived.isPending}
        onClick={() => setArchived.mutate({ courseId, archived: false })}
      >
        <RotateCcw data-icon="inline-start" />
        Reopen cohort
      </Button>
    );
  }

  if (!confirming) {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        <Archive data-icon="inline-start" />
        Archive cohort
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={setArchived.isPending}
        onClick={() => setArchived.mutate({ courseId, archived: true })}
      >
        Archive — students keep their feedback
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * The roster: the join link, and who has used it.
 *
 * **Removed students are shown, not filtered out.** This is the instructor's own list and the
 * one screen where a departed student has to be visible — they are who Restore acts on, and a
 * roster that silently omitted them would make removal look like deletion.
 */
function RosterTab({
  courseId,
  enrollments,
  joinToken,
  cohortSlug,
  frozen,
}: {
  courseId: string;
  enrollments: Data['enrollments'];
  joinToken: string;
  cohortSlug: string;
  /** True once anything has been accepted, which is when the short name stops being editable. */
  frozen: boolean;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const settled = {
    onSuccess: () => router.refresh(),
    onError: (error: { message: string }) => toast.error(error.message),
  };

  const remove = useMutation(
    trpc.enrollments.remove.mutationOptions({
      ...settled,
      onSuccess: (result) => {
        toast.success(`Removed ${result.studentName} from the cohort.`);
        router.refresh();
      },
    }),
  );
  const restore = useMutation(
    trpc.enrollments.restore.mutationOptions({
      ...settled,
      onSuccess: (result) => {
        toast.success(`${result.studentName} is back in the cohort.`);
        router.refresh();
      },
    }),
  );
  const regenerate = useMutation(
    trpc.courses.regenerateJoinToken.mutationOptions({
      ...settled,
      onSuccess: () => {
        toast.success('New join link. The old one no longer works.');
        router.refresh();
      },
    }),
  );

  const busy = remove.isPending || restore.isPending || regenerate.isPending;
  const active = enrollments.filter((enrollment) => enrollment.status === 'ACTIVE').length;

  return (
    <div className="flex flex-col gap-4">
      {/*
        Both are things to settle before students arrive, which is why they sit together on the
        screen an instructor opens first with a new cohort. The short name is above the link
        deliberately: it is the one with a deadline, since the first Accept freezes it.
      */}
      <CohortSlugCard courseId={courseId} cohortSlug={cohortSlug} frozen={frozen} />

      <JoinLinkCard
        joinToken={joinToken}
        active={active}
        busy={busy}
        onRegenerate={() => regenerate.mutate({ courseId })}
      />

      {enrollments.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nobody has joined yet"
          description="Send the link above. Students appear here as they use it."
        />
      ) : (
        <RosterTable
          enrollments={enrollments}
          busy={busy}
          onRemove={(enrollmentId) => remove.mutate({ enrollmentId })}
          onRestore={(enrollmentId) => restore.mutate({ enrollmentId })}
        />
      )}
    </div>
  );
}

/**
 * The cohort's short name, which prefixes every repository it generates.
 *
 * Shown whether or not it can still be changed, because it explains the repository names an
 * instructor is looking at either way. When it is frozen the field is replaced by the reason
 * rather than disabled: a disabled input invites a click and explains nothing.
 */
function CohortSlugCard({
  courseId,
  cohortSlug,
  frozen,
}: {
  courseId: string;
  cohortSlug: string;
  frozen: boolean;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const [value, setValue] = React.useState(cohortSlug);
  const [editing, setEditing] = React.useState(false);

  const save = useMutation(
    trpc.courses.setCohortSlug.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Repositories will be named ${result.cohortSlug}-assignment-githubname.`);
        setEditing(false);
        router.refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const problem = value === '' ? null : cohortSlugProblem(value);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4">
      <span className="text-sm font-medium">Short name</span>

      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (problem || value === '') return;
            save.mutate({ courseId, cohortSlug: value });
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={value}
              autoFocus
              maxLength={MAX_COHORT_SLUG}
              className="max-w-40 font-mono"
              onChange={(event) => setValue(event.target.value.toLowerCase())}
            />
            <Button type="submit" size="sm" disabled={save.isPending || problem !== null || value === ''}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue(cohortSlug);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
          {problem && <span className="text-xs text-destructive">{problem}</span>}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md border border-border bg-background px-2 py-1 text-xs">
            {cohortSlug}-assignment-githubname
          </code>
          {!frozen && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil data-icon="inline-start" />
              Change
            </Button>
          )}
        </div>
      )}

      <span className="text-xs text-muted-foreground">
        {frozen
          ? 'Students have already accepted work, and their repositories are named after this. Changing it here would not rename theirs.'
          : 'Every repository this cohort generates starts with it. Editable until the first student accepts something.'}
      </span>
    </div>
  );
}

/**
 * The one link that enrolls a student, and the only control over it.
 *
 * The link is shown rather than hidden behind a reveal: it is not a password, it is something
 * an instructor has to copy and send at the start of every term, and putting it behind a click
 * would make the common action slower to protect against a screenshot.
 *
 * **Regenerating says what it costs before it happens.** Anyone who has not joined yet is
 * holding a link that is about to stop working, so the confirmation names that rather than
 * asking "are you sure".
 */
function JoinLinkCard({
  joinToken,
  active,
  busy,
  onRegenerate,
}: {
  joinToken: string;
  active: number;
  busy: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // Built in the browser, because the server rendering this has no reliable idea what host the
  // instructor is looking at — a preview deployment and production share the same code.
  const [origin, setOrigin] = React.useState('');
  React.useEffect(() => setOrigin(window.location.origin), []);
  const link = origin ? `${origin}/join/${joinToken}` : `/join/${joinToken}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Join link</span>
        <span className="text-xs text-muted-foreground">
          Send this to your students however you already talk to them. Anyone who opens it and
          signs in with GitHub joins this cohort, so treat it as you would a class password.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-xs">
          {link}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            The current link stops working immediately. The {active}{' '}
            {active === 1 ? 'student' : 'students'} already in the cohort stay enrolled — anyone
            who has not joined yet will need the new link.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onRegenerate();
                setConfirming(false);
              }}
            >
              Replace the link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setConfirming(true)}
        >
          Replace this link
        </button>
      )}
    </div>
  );
}

function RosterTable({
  enrollments,
  busy,
  onRemove,
  onRestore,
}: {
  enrollments: Data['enrollments'];
  busy: boolean;
  onRemove: (enrollmentId: string) => void;
  onRestore: (enrollmentId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead className="hidden sm:table-cell">GitHub</TableHead>
            <TableHead>Enrollment</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enrollments.map((enrollment) => {
            // An enrollment always has a student now, because the row is created by somebody
            // joining. The fallbacks are for a profile that has signed in with GitHub and
            // never set a display name.
            const name =
              enrollment.student.displayName ??
              enrollment.student.githubUsername ??
              enrollment.student.email ??
              'Unnamed';
            const removed = enrollment.status === 'REMOVED';

            return (
              <TableRow key={enrollment.id} className={removed ? 'opacity-60' : undefined}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                        {initials(enrollment.student.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {enrollment.student.email ?? '—'}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {enrollment.student.githubUsername ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <GitBranch className="size-3.5" />
                      {enrollment.student.githubUsername}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <EnrollmentBadge status={enrollment.status} />
                </TableCell>
                <TableCell className="text-right">
                  {removed ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onRestore(enrollment.id)}
                    >
                      <RotateCcw data-icon="inline-start" />
                      Restore
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => onRemove(enrollment.id)}
                    >
                      <UserMinus data-icon="inline-start" />
                      Remove
                    </Button>
                  )}
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
    // Grey rather than red. Removing a student is an ordinary administrative act, not a
    // failure, and their work is untouched — a warning colour would say otherwise.
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
