"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, Gauge } from "lucide-react";
import * as React from "react";

import { HelpTip } from "@/components/help-tip";
import { EmptyState } from "@/components/list-states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  stickyColumn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ATTENDANCE_DRIFT_REASON_LABEL, DRIFT_RULE } from "@/lib/attendance/summary";
import { CHECK_TREND_RULE } from "@/lib/checks/trends";
import { CATEGORY_LABEL, type CheckCategory } from "@/lib/checks/levels";
import { CATEGORY_META, UNIT_CATEGORIES } from "@/lib/course-units";
import type { CourseUnitCategory } from "@/lib/generated/prisma/enums";
import { ASSIGNMENT_DRIFT_RULE, DRIFT_REASON_LABEL } from "@/lib/gradebook/summary";
import { programStudentHref } from "@/lib/links";
import { initials } from "@/lib/people";
import {
  COURSES_PARAM,
  PERFORMANCE_BUCKET_LABEL,
  PERFORMANCE_BUCKETS,
  PERFORMANCE_RULE,
  shownCourseIds,
  standingAcross,
  type PerformanceBucket,
  type Standing,
} from "@/lib/programs/performance";
import { formatPercent } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

type Payload = RouterOutputs["programs"]["performance"];
/** A fellow as the server sends them: attendance, and one reading per course. */
type Reading = Payload["fellows"][number];
/** The same fellow with their standing across the shown courses, which is what the grid draws. */
type Fellow = Reading & { standing: Standing };
type Course = Payload["courses"][number];

/**
 * The Performance screen: every real fellow in one of three groups, and the few there is not yet
 * enough to say about, with the readings behind the group laid out across the row.
 *
 * **Read against the courses chosen in the page header.** The groups, the All courses figures and
 * the bands all follow the course filter, so the roster can be sorted by how it is doing in one
 * course, in this month's, or in all of them. Attendance belongs to the program and counts
 * whichever are shown. `standingAcross` in lib/programs/performance.ts is the computation.
 *
 * **A grid for the whole roster**, the fellow's Trends section turned on its side. Attendance
 * comes first, then the program-wide figures — work handed in on time, and the share of
 * assignments, projects and assessments completed — then a band of columns per course: the
 * deadlines hit, the work of each kind completed, and the average understanding level on the last
 * few checks. A cell whose rule trips is filled red, so the reason a fellow is in needs support is
 * on the row rather than a click away.
 *
 * **Counted by what was done rather than what was not.** A column says how many deadlines were
 * hit and how much work was completed, so a row reads as what a fellow has achieved; the drift
 * rules underneath are unchanged, and a cell still turns red where one trips.
 *
 * **One table per group, at the same column widths**, so each group can be read on its own and the
 * four still line up as one grid down the page.
 *
 * **Every column sorts, and one choice sorts all four tables**, since they are one grid: a reader
 * sorting by a course's deadlines wants that order in every group. Until a column is chosen, each
 * group is worst first, because the screen is read from the top and acted on until somebody runs
 * out of afternoon. The rule is `performanceBucket` in lib/programs/performance.ts.
 */
export function ProgramPerformance({
  programId,
  data,
  cohortName,
}: {
  programId: string;
  data: Payload;
  /** Cohort id to name, so a row prints a name rather than searching the list for one. */
  cohortName: Map<string, string>;
}) {
  const [sort, setSort] = React.useState<Sort | null>(null);

  /*
    The course filter in the page header decides which courses everything is read against: the
    bands drawn, the All courses figures, and each fellow's group. The payload holds every course's
    reading, so a change of selection is arithmetic here rather than a request.
  */
  const param = useSearchParams().get(COURSES_PARAM);
  const courses = React.useMemo(() => {
    const shown = shownCourseIds(param, data.courses, data.programArchived);
    return data.courses.filter((course) => shown.has(course.id));
  }, [param, data.courses, data.programArchived]);

  const fellows = React.useMemo(
    () =>
      data.fellows.map((fellow): Fellow => ({
        ...fellow,
        standing: standingAcross(fellow.attendance, courses, fellow.courses),
      })),
    [data.fellows, courses],
  );

  const columns = React.useMemo(
    () =>
      columnsFor(
        courses,
        // The kinds of unit any shown course has released work in, in the gradebook's order.
        UNIT_CATEGORIES.filter((category) =>
          courses.some((course) => course.categories.includes(category)),
        ),
      ),
    [courses],
  );

  if (fellows.length === 0) {
    return (
      <EmptyState
        icon={<Gauge />}
        title="Nobody to read yet"
        description="Fellows appear here once they are on the roster. Test students and removed fellows are never measured."
      />
    );
  }

  const byBucket = new Map<PerformanceBucket, Fellow[]>(
    PERFORMANCE_BUCKETS.map((bucket) => [bucket, []]),
  );
  for (const fellow of fellows) byBucket.get(fellow.standing.bucket)!.push(fellow);

  const order = (rows: Fellow[]) => {
    const column = sort && columns.find((candidate) => candidate.key === sort.key);
    if (!sort || !column) return [...rows].sort(worstFirst);
    return [...rows].sort((a, b) =>
      compare(column.sortValue(a), column.sortValue(b), sort.direction),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <span>
          Any red cell means needs support, however good the term has been. Meeting the bar is{" "}
          {percent(PERFORMANCE_RULE.onTimeAtLeast)} of work handed in on time and{" "}
          {percent(PERFORMANCE_RULE.meetingAttendanceAtLeast)} attendance; exceeding asks the same
          with {percent(PERFORMANCE_RULE.exceedingAttendanceAtLeast)} attendance.
        </span>
        <HelpTip>
          On time means handed in by the deadline or by an agreed extension, whether or not it has
          been graded. Completed means graded complete, out of everything released so far. Nobody is
          placed in a group until something has come due and {PERFORMANCE_RULE.needsSessionsAtLeast}{" "}
          mornings have been counted. Understanding never turns a cell red. Press a column&apos;s
          name to sort every group by it.
        </HelpTip>
      </p>

      {PERFORMANCE_BUCKETS.map((bucket) => {
        const rows = byBucket.get(bucket)!;
        if (rows.length === 0) return null;

        return (
          <section key={bucket} className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium">
                {PERFORMANCE_BUCKET_LABEL[bucket]} · {rows.length}
              </h2>
              <p className="text-xs text-muted-foreground">{BUCKET_DESCRIPTION[bucket]}</p>
            </div>
            <PerformanceGrid
              programId={programId}
              columns={columns}
              fellows={order(rows)}
              cohortName={cohortName}
              sort={sort}
              onSort={setSort}
            />
          </section>
        );
      })}
    </div>
  );
}

const BUCKET_DESCRIPTION: Record<PerformanceBucket, string> = {
  "needs-support":
    "Flagged on attendance or work, or below the bar on either term figure. Worth a conversation this week.",
  meeting: "On time with their work and here most mornings, with nothing flagged.",
  exceeding: "On time with their work, here nearly every morning, and nothing flagged.",
  "too-early":
    "Nothing has come due yet, or too few mornings have been counted to read their attendance.",
};

// ===========================================================================
// Columns
// ===========================================================================

/** A figure to sort by: a number, or null for a cell with nothing in it yet, which sorts last. */
type SortValue = number | null;

/**
 * One column of the grid: which band it sits in, what it is called, how it sorts, and what it
 * draws. The header rows, the cells, and the sort all read this one list, so a column cannot be
 * drawn under one heading and sorted by another's figure.
 */
type Column = {
  key: string;
  /** The band heading this column sits under; consecutive columns with the same band share it. */
  band: Band;
  title: string;
  help?: React.ReactNode;
  sortValue: (fellow: Fellow) => SortValue;
  render: (fellow: Fellow) => CellContent;
};

/**
 * A heading over a run of columns. `archived` marks a finished course's band, drawn with a dotted
 * edge and a marker, because it is only on the screen when somebody chose to read it.
 */
type Band = { key: string; label: React.ReactNode; archived?: boolean };

/** What a cell holds: a figure, the line under it, and the rule's name when it trips. */
type CellContent = { value: string; detail: string; flag?: string | null; title?: string };

const EMPTY = (detail: string): CellContent => ({ value: "—", detail });

function fraction(done: number, of: number): SortValue {
  return of === 0 ? null : done / of;
}

function columnsFor(courses: Course[], categories: CourseUnitCategory[]): Column[] {
  const attendance = {
    key: "attendance",
    label: (
      <>
        Attendance
        <HelpTip>
          Recent absence and tardiness both read the last {DRIFT_RULE.lateOf} mornings. Absence is
          flagged at {DRIFT_RULE.missedAtLeast} or more, and tardiness at {DRIFT_RULE.lateAtLeast}{" "}
          or more — the same rule as the attendance screen&apos;s own list. The overall rate is the
          whole term.
        </HelpTip>
      </>
    ),
  };
  const allCourses = {
    key: "all",
    label: (
      <>
        All courses
        <HelpTip>
          On time submissions is the share of past-due work handed in by its deadline. The completed
          columns are the share graded complete, out of everything released so far. All of them
          count only the courses shown.
        </HelpTip>
      </>
    ),
  };

  const columns: Column[] = [
    {
      key: "rate",
      band: attendance,
      title: "Overall Rate",
      sortValue: (f) => fraction(f.attendance.attended, f.attendance.eligible),
      render: (f) =>
        f.attendance.eligible === 0
          ? EMPTY("no mornings yet")
          : {
              value: formatPercent(f.attendance.attended / f.attendance.eligible),
              detail: `${f.attendance.attended} of ${f.attendance.eligible}`,
            },
    },
    {
      key: "absence",
      band: attendance,
      title: "Recent Absence",
      sortValue: (f) => f.attendance.recent?.missed ?? null,
      render: (f) =>
        f.attendance.recent
          ? {
              value: `${f.attendance.recent.missed} of ${f.attendance.recent.missedOf}`,
              detail: "recent mornings",
              flag:
                f.attendance.reason === "missing" ? ATTENDANCE_DRIFT_REASON_LABEL.missing : null,
            }
          : EMPTY("too few yet"),
    },
    {
      key: "tardiness",
      band: attendance,
      title: "Recent Tardiness",
      sortValue: (f) => f.attendance.recent?.late ?? null,
      render: (f) =>
        f.attendance.recent
          ? {
              value: `${f.attendance.recent.late} of ${f.attendance.recent.lateOf}`,
              detail: "recent mornings",
              flag: f.attendance.reason === "late" ? ATTENDANCE_DRIFT_REASON_LABEL.late : null,
            }
          : EMPTY("too few yet"),
    },
    {
      key: "onTime",
      band: allCourses,
      title: "On time submissions",
      sortValue: (f) =>
        f.standing.onTime ? f.standing.onTime.onTime / f.standing.onTime.due : null,
      render: (f) =>
        f.standing.onTime
          ? {
              value: formatPercent(f.standing.onTime.onTime / f.standing.onTime.due),
              detail: `${f.standing.onTime.onTime} of ${f.standing.onTime.due}`,
            }
          : EMPTY("nothing due yet"),
    },
    ...categories.map((category): Column => ({
      key: `all:${category}`,
      band: allCourses,
      title: completedTitle(category),
      sortValue: (f) => {
        const completion = f.standing.completion[category];
        return completion ? fraction(completion.complete, completion.possible) : null;
      },
      render: (f) => completionCell(f.standing.completion[category]),
    })),
  ];

  courses.forEach((course, index) => {
    const band: Band = {
      key: `course:${course.id}`,
      archived: course.archived,
      label: (
        <>
          <span className="truncate">{course.name}</span>
          {course.archived && (
            <span className="shrink-0 rounded-sm border border-dotted border-muted-foreground/60 px-1 text-[10px] font-normal text-muted-foreground">
              Archived
            </span>
          )}
        </>
      ),
    };
    const reading = (f: Fellow) => f.courses[course.id]!;

    if (course.hasWork) {
      columns.push({
        key: `course:${course.id}:deadlines`,
        band,
        title: "Deadlines Hit",
        help:
          index === 0 ? (
            <>
              Handed in on time, of the last {ASSIGNMENT_DRIFT_RULE.dueOf} assignments due in the
              course. Flagged when {ASSIGNMENT_DRIFT_RULE.slippedAtLeast} or more of them were
              missed or late.
            </>
          ) : undefined,
        sortValue: (f) => {
          const recent = reading(f).recent;
          return recent ? fraction(recent.due - recent.missed - recent.late, recent.due) : null;
        },
        render: (f) => {
          const { recent, reasons } = reading(f);
          if (!recent || recent.due === 0) return EMPTY("nothing due yet");
          return {
            value: `${recent.due - recent.missed - recent.late} of ${recent.due}`,
            detail: `${recent.late} late, ${recent.missed} missing`,
            flag: reasons.includes("deadlines") ? DRIFT_REASON_LABEL.deadlines : null,
          };
        },
      });
    }

    course.categories.forEach((category, position) => {
      columns.push({
        key: `course:${course.id}:${category}`,
        band,
        title: completedTitle(category),
        /*
          The course's "Falling short" flag is drawn on its first completion column. The rule reads
          the fellow's last few graded assignments in the course, whatever kind of unit they sit in,
          so it has no column of its own; this is the column nearest to what it measures.
        */
        help:
          index === 0 && position === 0 ? (
            <>
              Graded complete, of everything of this kind released in the course. Flagged when{" "}
              {ASSIGNMENT_DRIFT_RULE.incompleteAtLeast} or more of the fellow&apos;s last{" "}
              {ASSIGNMENT_DRIFT_RULE.gradedOf} graded assignments in the course fell short.
            </>
          ) : undefined,
        sortValue: (f) => {
          const completion = reading(f).completion[category];
          return completion ? fraction(completion.complete, completion.possible) : null;
        },
        render: (f) => {
          const { completion, recent, reasons } = reading(f);
          const cell = completionCell(completion[category]);
          if (position !== 0 || !reasons.includes("falling-short") || !recent) return cell;
          return {
            ...cell,
            flag: DRIFT_REASON_LABEL["falling-short"],
            title: `${recent.graded - recent.incomplete} of the last ${recent.graded} graded were complete`,
          };
        },
      });
    });

    if (course.hasChecks) {
      columns.push({
        key: `course:${course.id}:understanding`,
        band,
        title: "Understanding",
        help:
          index === 0 ? (
            <>
              The average level on the latest attempt at each of the last{" "}
              {CHECK_TREND_RULE.checksOf} checks for understanding: 1 is Blocked, 2 Understands
              facts, 3 Making connections. Never flagged.
            </>
          ) : undefined,
        sortValue: (f) => reading(f).checks?.averageLevel ?? null,
        render: (f) => {
          const checks = reading(f).checks;
          if (!checks || checks.averageLevel === null) {
            return EMPTY(checks ? `${checks.answered} of ${checks.checks} answered` : "no checks");
          }
          return {
            value: checks.averageLevel.toFixed(1),
            detail: CATEGORY_LABEL[Math.round(checks.averageLevel) as CheckCategory],
            title: `${checks.answered} of the last ${checks.checks} answered`,
          };
        },
      });
    }
  });

  return columns;
}

function completedTitle(category: CourseUnitCategory): string {
  return `${CATEGORY_META[category].tabLabel} Completed`;
}

function completionCell(
  completion: { complete: number; possible: number } | undefined,
): CellContent {
  if (!completion || completion.possible === 0) return EMPTY("none released");
  return {
    value: formatPercent(completion.complete / completion.possible),
    detail: `${completion.complete} of ${completion.possible}`,
  };
}

// ===========================================================================
// Sorting
// ===========================================================================

/** A column key, or "name" for the fellow column, and which way. */
type Sort = { key: string; direction: "asc" | "desc" };

/** More flags first, then the lower on-time share, then the lower attendance. */
function worstFirst(a: Fellow, b: Fellow): number {
  return (
    b.standing.flags.length - a.standing.flags.length ||
    ratio(a.standing.onTime) - ratio(b.standing.onTime) ||
    (a.attendance.rate ?? 1) - (b.attendance.rate ?? 1)
  );
}

function ratio(onTime: Standing["onTime"]): number {
  return onTime === null ? 1 : onTime.onTime / onTime.due;
}

/** Empty cells last in either direction, since a reader sorting a column is reading its figures. */
function compare(a: SortValue | string, b: SortValue | string, direction: Sort["direction"]) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order = typeof a === "string" ? a.localeCompare(b as string) : a - (b as number);
  return direction === "asc" ? order : -order;
}

/** The first press sorts ascending, the next descending, and a third returns to worst first. */
function nextSort(current: Sort | null, key: string): Sort | null {
  if (current?.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

function fellowName(fellow: Fellow): string {
  const { student } = fellow;
  return student.displayName ?? student.githubUsername ?? student.email ?? "Unnamed";
}

// ===========================================================================
// The table
// ===========================================================================

/** The width of the fellow column and of every figure column, the same in every group's table. */
const FELLOW_REM = 13;
const FIGURE_REM = 8.5;

/**
 * One group's table.
 *
 * **Every group's table has the same columns at the same widths**, fixed rather than sized to
 * their contents, so the four tables read as one grid broken into sections: a course's band sits
 * at the same place in each, and an eye moving down the page stays in one column.
 */
function PerformanceGrid({
  programId,
  columns,
  fellows,
  cohortName,
  sort,
  onSort,
}: {
  programId: string;
  columns: Column[];
  fellows: Fellow[];
  cohortName: Map<string, string>;
  sort: Sort | null;
  onSort: (sort: Sort | null) => void;
}) {
  // Consecutive columns under one band heading, in order.
  const bands: (Band & { span: number })[] = [];
  for (const column of columns) {
    const last = bands[bands.length - 1];
    if (last?.key === column.band.key) last.span += 1;
    else bands.push({ ...column.band, span: 1 });
  }
  const bandStarts = new Set(
    columns.filter((column, i) => columns[i - 1]?.band.key !== column.band.key).map((c) => c.key),
  );
  /*
    The line a column draws on its left: solid where a band begins, dotted where an archived
    course's band begins, and none inside a band. The band after an archived one keeps its own
    solid line, so the dotted run reads as one bracket around the finished course.
  */
  const edgeOf = (column: Column) =>
    bandStarts.has(column.key)
      ? column.band.archived
        ? "border-l border-dotted border-muted-foreground/60"
        : "border-l border-border"
      : null;

  const nameSorted = (rows: Fellow[]) =>
    sort?.key === "name"
      ? [...rows].sort((a, b) => compare(fellowName(a), fellowName(b), sort.direction))
      : rows;

  return (
    // As wide as the grid and no wider, so a program with one course is not a narrow table inside
    // a page-wide border; the table scrolls sideways inside it once it outgrows the page.
    <div className="w-fit max-w-full rounded-lg border border-border">
      <Table
        className="table-fixed"
        style={{ width: `${FELLOW_REM + columns.length * FIGURE_REM}rem` }}
      >
        <colgroup>
          <col style={{ width: `${FELLOW_REM}rem` }} />
          {columns.map((column) => (
            <col key={column.key} style={{ width: `${FIGURE_REM}rem` }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead
              rowSpan={2}
              className={cn(stickyColumn, "align-bottom")}
              aria-sort={ariaSort(sort, "name")}
            >
              <SortButton label="Fellow" sortKey="name" sort={sort} onSort={onSort} />
            </TableHead>
            {bands.map((band) => (
              <TableHead
                key={band.key}
                colSpan={band.span}
                className={cn(
                  "h-8 text-xs",
                  band.archived
                    ? "border-x border-t border-dotted border-muted-foreground/60"
                    : "border-l border-border",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">{band.label}</span>
              </TableHead>
            ))}
          </TableRow>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                aria-sort={ariaSort(sort, column.key)}
                className={cn(
                  "h-auto py-1.5 align-bottom text-xs font-normal whitespace-normal",
                  edgeOf(column),
                )}
              >
                <span className="flex items-end gap-1">
                  <SortButton
                    label={column.title}
                    sortKey={column.key}
                    sort={sort}
                    onSort={onSort}
                  />
                  {column.help && <HelpTip>{column.help}</HelpTip>}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {nameSorted(fellows).map((fellow) => (
            <TableRow key={fellow.enrollmentId}>
              {/*
                The fellow column stays put while the course bands scroll beneath it, because a row
                of figures without a name beside it is a row nobody can act on.
              */}
              <TableCell className={stickyColumn}>
                <div className="flex items-center gap-3">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                      {initials(fellow.student.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={programStudentHref(programId, fellow.student.id)}
                      className="truncate font-medium hover:underline"
                    >
                      {fellowName(fellow)}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground">
                      {fellow.cohortId === null
                        ? "No cohort"
                        : (cohortName.get(fellow.cohortId) ?? "Unknown cohort")}
                    </span>
                  </div>
                </div>
              </TableCell>
              {columns.map((column) => (
                <Cell key={column.key} edge={edgeOf(column)} content={column.render(fellow)} />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ariaSort(sort: Sort | null, key: string): "ascending" | "descending" | undefined {
  if (sort?.key !== key) return undefined;
  return sort.direction === "asc" ? "ascending" : "descending";
}

function SortButton({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: string;
  sort: Sort | null;
  onSort: (sort: Sort | null) => void;
}) {
  const active = sort?.key === sortKey;

  return (
    <button
      type="button"
      onClick={() => onSort(nextSort(sort, sortKey))}
      aria-label={`Sort by ${label.toLowerCase()}`}
      className={cn(
        "flex items-end gap-1 rounded-sm text-left transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      {!active ? (
        <ChevronsUpDown className="mb-0.5 size-3 shrink-0" aria-hidden />
      ) : sort.direction === "asc" ? (
        <ArrowUp className="mb-0.5 size-3 shrink-0" aria-hidden />
      ) : (
        <ArrowDown className="mb-0.5 size-3 shrink-0" aria-hidden />
      )}
    </button>
  );
}

/**
 * One figure in the grid, with its cell filled red when its rule trips.
 *
 * **No flag text on the screen**, so a row of red cells stays as compact as a row of plain ones and
 * the figure is what the eye lands on. The rule's name is still in the cell for a screen reader,
 * and in the tooltip for anybody who hovers, so the red is never the only way to know which rule
 * tripped.
 */
function Cell({ edge, content }: { edge: string | null; content: CellContent }) {
  const { value, detail, flag, title } = content;

  return (
    <TableCell
      className={cn(edge, flag && "bg-destructive/10 text-destructive")}
      title={title ?? flag ?? undefined}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-sm tabular-nums">{value}</span>
        <span className="truncate text-xs opacity-70">{detail}</span>
        {flag && <span className="sr-only">Flagged: {flag}</span>}
      </div>
    </TableCell>
  );
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)} percent`;
}
