"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, CircleHelp, Gauge } from "lucide-react";
import * as React from "react";

import { EmptyState } from "@/components/list-states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  stickyColumn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { recentAttendedShare, recentOnTimeArrivalShare } from "@/lib/attendance/summary";
import { CHECK_TREND_RULE } from "@/lib/checks/trends";
import { CATEGORY_LABEL, type CheckCategory } from "@/lib/checks/levels";
import { UNIT_CATEGORIES } from "@/lib/course-units";
import type { CourseUnitCategory } from "@/lib/generated/prisma/enums";
import { recentCompleteShare, recentOnTimeShare } from "@/lib/gradebook/summary";
import { programStudentHref } from "@/lib/links";
import { initials } from "@/lib/people";
import {
  chosenMeasures,
  completedTitle,
  COURSES_PARAM,
  MEASURE_LABEL,
  MEASURES,
  MEASURES_PARAM,
  meetingShares,
  PERFORMANCE_BUCKET_LABEL,
  PERFORMANCE_BUCKETS,
  PERFORMANCE_RULE,
  shareBand,
  shownCourseIds,
  standingAcross,
  termShare,
  type Band as CellBand,
  type Measure,
  type MeetingShare,
  type PerformanceBucket,
  type Standing,
} from "@/lib/programs/performance";
import { formatRecentWindow } from "@/lib/recent-window";
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
 * The Performance tab of the Fellows screen: every real fellow in one of three groups, and the few there is not yet
 * enough to say about, with the readings behind the group laid out across the row.
 *
 * **Read against the courses chosen in the page header.** The groups, the All courses figures and
 * the bands all follow the course filter, so the roster can be sorted by how it is doing in one
 * course, in this month's, or in all of them. Attendance belongs to the program and counts
 * whichever are shown. `standingAcross` in lib/programs/performance.ts is the computation.
 *
 * **And against the measures chosen there.** The measure filter leaves out families of coloured
 * columns: attendance, deadlines, submissions, or completion. A column of a measure left out stays
 * on the grid with its figure and is never coloured, and the groups, the worst-first order and the
 * summary read only the chosen measures, so a row shows only the reasons that placed the fellow.
 *
 * **A grid for the whole roster**, the fellow's Trends section turned on its side. Attendance
 * comes first, then the program-wide figures — deadlines hit across the term, work submitted,
 * recent graded work, and the share of assignments, projects and assessments completed — then a
 * band of columns per course: the recent deadlines hit, the recent graded work, the work of each
 * kind completed, and the average understanding level on the last few checks. A cell is filled
 * green, yellow or red by its own band, and the group is the worst band on the row, so the reason
 * a fellow is where they are is on the row rather than a click away. Understanding is a figure to
 * look at and never coloured, and a share with fewer than `PERFORMANCE_RULE.needsAtLeast` behind
 * it is printed in grey, since one miss of one is not a pattern.
 *
 * **A table above the grid says how much of the roster is at or above the bar** in each coloured
 * column, so the question "how is the cohort doing" has an answer before the question "who".
 * `meetingShares` is the count.
 *
 * **Every recent column counts over one window**, the days the filter in the page header names:
 * two weeks ending today unless the instructor chose a range. The help text names the days, so a
 * reader of a linked grid knows what "recent" meant to whoever sent it.
 *
 * **Counted by what was done rather than what was not.** A column says how many deadlines were
 * hit and how much work was completed, so a row reads as what a fellow has achieved; the rules
 * underneath count what went wrong, and a cell turns red or yellow where one trips and green
 * where none does.
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
  const searchParams = useSearchParams();
  const param = searchParams.get(COURSES_PARAM);
  const courses = React.useMemo(() => {
    const shown = shownCourseIds(param, data.courses, data.programArchived);
    return data.courses.filter((course) => shown.has(course.id));
  }, [param, data.courses, data.programArchived]);

  // The measure filter in the page header, read the same way: arithmetic here, not a request.
  const measuresParam = searchParams.get(MEASURES_PARAM);
  const measures = React.useMemo(() => chosenMeasures(measuresParam), [measuresParam]);

  const fellows = React.useMemo(
    () =>
      data.fellows.map((fellow): Fellow => ({
        ...fellow,
        standing: standingAcross(fellow.attendance, courses, fellow.courses, measures),
      })),
    [data.fellows, courses, measures],
  );

  // The kinds of unit any shown course has released work in, in the gradebook's order.
  const categories = React.useMemo(
    () =>
      UNIT_CATEGORIES.filter((category) =>
        courses.some((course) => course.categories.includes(category)),
      ),
    [courses],
  );
  const columns = React.useMemo(
    () => columnsFor(courses, categories, measures),
    [courses, categories, measures],
  );
  const shares = React.useMemo(
    () => meetingShares(fellows, categories, measures),
    [fellows, categories, measures],
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
      <MeetingSummary shares={shares} />
      <BucketingHelp window={formatRecentWindow(data.window)} measures={measures} />

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
    "At least one red cell: a term figure under 75 percent, or a recent window past its bar. Worth a conversation this week.",
  meeting:
    "No red cell, but at least one yellow: a term figure under 90 percent, or a small recent slip.",
  exceeding:
    "Every coloured cell green: every term figure at 90 percent or more, and nothing slipped recently.",
  "too-early":
    "Nothing has come due yet, or too few mornings have been counted to read their attendance.",
};

/**
 * Every rule behind the screen, in one place: how a fellow lands in each group, and what each
 * column divides.
 *
 * **Fragments rather than sentences, and the bars stated once.** The popover is glanced at mid
 * meeting to check what a cell means, and every coloured cell is read against the same two bars,
 * so each entry says only what is divided by what. The groups come first and the columns follow,
 * band by band, in the order the grid draws them.
 */
function BucketingHelp({ window, measures }: { window: string; measures: ReadonlySet<Measure> }) {
  const bars = PERFORMANCE_RULE.onTime;
  const narrowed = measures.size < MEASURES.length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="self-start">
            <CircleHelp data-icon="inline-start" />
            How does bucketing work?
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="flex max-h-[70vh] w-[min(30rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto text-xs"
      >
        <HelpSection title="Groups">
          <HelpRule name={PERFORMANCE_BUCKET_LABEL["needs-support"]}>any red cell</HelpRule>
          <HelpRule name={PERFORMANCE_BUCKET_LABEL.meeting}>any yellow, no red</HelpRule>
          <HelpRule name={PERFORMANCE_BUCKET_LABEL.exceeding}>all green</HelpRule>
          <HelpRule name={PERFORMANCE_BUCKET_LABEL["too-early"]}>
            nothing due yet, or under {PERFORMANCE_RULE.needsSessionsAtLeast} sessions counted
          </HelpRule>
        </HelpSection>

        <HelpSection title="Colors">
          <p className="text-muted-foreground">Red: under {percent(bars.meeting)}</p>
          <p className="text-muted-foreground">Yellow: under {percent(bars.exceeding)}</p>
          <p className="text-muted-foreground">Green: {percent(bars.exceeding)} and over</p>
          <p className="text-muted-foreground">
            No Color: under {PERFORMANCE_RULE.needsAtLeast} counted, or not considered for bucketing
          </p>
          <p className="text-muted-foreground">Hover a cell for its rule.</p>

          {narrowed && (
            <p className="text-muted-foreground">
              Reading{" "}
              {MEASURES.filter((measure) => measures.has(measure))
                .map((measure) => MEASURE_LABEL[measure])
                .join(", ")}{" "}
              only. Columns of the other measures are drawn and never coloured.
            </p>
          )}
        </HelpSection>

        <HelpSection title="Recent Window">
          <p className="text-muted-foreground">
            Recent covers dates ({window}). Change the window with the dates above. Defaults to the
            last two weeks.
          </p>
        </HelpSection>

        <HelpSection title="Attendance">
          <HelpRule name="Attendance Rate">
            attended ÷ sessions counted this term · excused still counts as missed
          </HelpRule>
          <HelpRule name="Recent Absence">missed ÷ sessions held recently · excused noted</HelpRule>
          <HelpRule name="Recent Tardiness">late ÷ sessions held recently</HelpRule>
        </HelpSection>

        <HelpSection title="All courses">
          <HelpRule name="Deadlines Hit">
            on time, or by an agreed extension ÷ past due · graded or not
          </HelpRule>
          <HelpRule name="Assignments Submitted">handed in, late or on time ÷ past due</HelpRule>
          <HelpRule name="Recently Completed">each course’s figure, added up</HelpRule>
          <HelpRule name="Graded … Completed">
            graded complete ÷ past due and graded · never handed in counts as incomplete · waiting
            on a grade not counted
          </HelpRule>
        </HelpSection>

        <HelpSection title="Each course">
          <HelpRule name="Recent Deadlines Hit">on time ÷ due recently</HelpRule>
          <HelpRule name="Recently Completed">
            graded complete ÷ due recently and graded · same reading as above
          </HelpRule>
          <HelpRule name="Graded … Completed">as above, this course only</HelpRule>
          <HelpRule name="Understanding">
            average level, last {CHECK_TREND_RULE.checksOf} checks · 1 Blocked · 2 Understands facts
            · 3 Making connections
          </HelpRule>
        </HelpSection>

        <p className="text-muted-foreground">Press a column name to sort every group by it.</p>
      </PopoverContent>
    </Popover>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-border pt-2.5 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One column or group: its name in a fixed column, what it means beside it, so the eye scans down the names. */
function HelpRule({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-x-3">
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

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
  /** What a coloured column measures; absent on a column that is never coloured. */
  measure?: Measure;
  title: string;
  sortValue: (fellow: Fellow) => SortValue;
  render: (fellow: Fellow) => CellContent;
};

/**
 * A heading over a run of columns. `archived` marks a finished course's band, drawn with a dotted
 * edge and a marker, because it is only on the screen when somebody chose to read it.
 */
type Band = { key: string; label: React.ReactNode; archived?: boolean };

/**
 * What a cell holds: a figure, the line under it, and why it is coloured.
 *
 * `band` is the cell's colour and `reason` names the rule that gave it, for a screen reader and
 * the tooltip. A cell with too little behind it to be read has neither.
 */
type CellContent = {
  value: string;
  detail: string;
  band?: CellBand;
  reason?: string;
  title?: string;
};

const EMPTY = (detail: string): CellContent => ({ value: "—", detail });

/** The colour of a share, with the bar it fell under in words. Nothing for a share too small to read. */
function byShare(
  share: number | null,
  rule: { meeting: number; exceeding: number },
  describe: (under: number) => string,
): Pick<CellContent, "band" | "reason"> {
  const band = shareBand(share, rule);
  if (band === null) return {};
  if (band === "green") return { band, reason: `${percent(rule.exceeding)} or over` };
  return { band, reason: describe(band === "red" ? rule.meeting : rule.exceeding) };
}

/**
 * The figure the two Recently Completed columns print. The title names what is counted,
 * so the line under the figure says which window it was counted over.
 */
function recentlyGradedCell(
  figures: { complete: number; graded: number },
  detail: string,
): CellContent {
  if (figures.graded === 0) return EMPTY("nothing graded yet");
  return { value: `${figures.complete} of ${figures.graded}`, detail };
}

function fraction(done: number, of: number): SortValue {
  return of === 0 ? null : done / of;
}

function columnsFor(
  courses: Course[],
  categories: CourseUnitCategory[],
  measures: ReadonlySet<Measure>,
): Column[] {
  const attendance = { key: "attendance", label: "Attendance" };
  const allCourses = { key: "all", label: "All courses" };

  const columns: Column[] = [
    {
      key: "rate",
      band: attendance,
      measure: "attendance",
      title: "Attendance Rate",
      sortValue: (f) => fraction(f.attendance.attended, f.attendance.eligible),
      /*
        Read against the bars only once the fellow has enough mornings to be judged, which is when
        `attendance.rate` stops being null — the figure shown before then is real, and nothing yet.
        The excused count sits beside the figure because an excused morning is still a missed one,
        and a reader deciding whether to act on a red cell wants to know how much of it had a reason.
      */
      render: (f) => {
        const { rate, attended, eligible, excused } = f.attendance;
        if (eligible === 0) return EMPTY("no mornings yet");
        return {
          value: formatPercent(attended / eligible),
          detail:
            excused > 0
              ? `${attended} of ${eligible} · ${excused} excused`
              : `${attended} of ${eligible}`,
          ...byShare(
            rate,
            PERFORMANCE_RULE.attendance,
            (under) => `Attendance under ${percent(under)}`,
          ),
        };
      },
    },
    {
      key: "absence",
      band: attendance,
      measure: "attendance",
      title: "Recent Absence",
      sortValue: (f) => f.attendance.recent?.missed ?? null,
      render: (f) => {
        const recent = f.attendance.recent;
        if (!recent) return EMPTY("too few yet");
        if (recent.missedOf === 0) return EMPTY("no mornings in the window");
        return {
          value: `${recent.missed} of ${recent.missedOf}`,
          detail: recent.excused > 0 ? `${recent.excused} excused` : "recent mornings",
          ...byShare(
            recentAttendedShare(recent),
            PERFORMANCE_RULE.absences,
            (under) => `Under ${percent(under)} of recent mornings attended`,
          ),
        };
      },
    },
    {
      key: "tardiness",
      band: attendance,
      measure: "attendance",
      title: "Recent Tardiness",
      sortValue: (f) => f.attendance.recent?.late ?? null,
      /*
        Coloured by its own count, even when absence is coloured as well. A fellow both absent and
        late is held back by both, and the grid shows every cell that does it.
      */
      render: (f) => {
        const recent = f.attendance.recent;
        if (!recent) return EMPTY("too few yet");
        if (recent.lateOf === 0) return EMPTY("no mornings in the window");
        return {
          value: `${recent.late} of ${recent.lateOf}`,
          detail: "recent mornings",
          ...byShare(
            recentOnTimeArrivalShare(recent),
            PERFORMANCE_RULE.lateArrivals,
            (under) => `Late on more than ${percent(1 - under)} of recent mornings`,
          ),
        };
      },
    },
    {
      key: "onTime",
      band: allCourses,
      measure: "deadlines",
      title: "Deadlines Hit",
      sortValue: (f) =>
        f.standing.onTime ? f.standing.onTime.onTime / f.standing.onTime.due : null,
      render: (f) => {
        const onTime = f.standing.onTime;
        if (!onTime) return EMPTY("nothing due yet");
        return {
          value: formatPercent(onTime.onTime / onTime.due),
          detail: `${onTime.onTime} of ${onTime.due}`,
          ...byShare(
            termShare(onTime.onTime, onTime.due),
            PERFORMANCE_RULE.onTime,
            (under) => `Under ${percent(under)} of deadlines hit`,
          ),
        };
      },
    },
    /*
      Beside Deadlines Hit and over the same denominator, so the two can be read as a pair: the gap
      between them is the work handed in late, and a low figure here is work that does not exist
      yet.
    */
    {
      key: "submitted",
      band: allCourses,
      measure: "submissions",
      title: "Assignments Submitted",
      sortValue: (f) =>
        f.standing.onTime ? f.standing.onTime.submitted / f.standing.onTime.due : null,
      render: (f) => {
        const onTime = f.standing.onTime;
        if (!onTime) return EMPTY("nothing due yet");
        return {
          value: formatPercent(onTime.submitted / onTime.due),
          detail: `${onTime.submitted} of ${onTime.due}`,
          ...byShare(
            termShare(onTime.submitted, onTime.due),
            PERFORMANCE_RULE.submitted,
            (under) => `Under ${percent(under)} of assignments submitted`,
          ),
        };
      },
    },
    /*
      The courses' graded windows added up, and coloured, because a single course's window will
      often hold fewer than the minimum and the pooled figure is where enough graded work exists to
      be judged.
    */
    {
      key: "recentlyGraded",
      band: allCourses,
      measure: "completion",
      title: "Recently Completed",
      sortValue: (f) =>
        fraction(f.standing.recentlyGraded.complete, f.standing.recentlyGraded.graded),
      render: (f) => {
        const { recentlyGraded } = f.standing;
        return {
          ...recentlyGradedCell(recentlyGraded, "across the shown courses"),
          ...byShare(
            termShare(recentlyGraded.complete, recentlyGraded.graded),
            PERFORMANCE_RULE.recentlyCompleted,
            (under) => `Under ${percent(under)} of recent graded work complete`,
          ),
        };
      },
    },
    ...categories.map((category): Column => ({
      key: `all:${category}`,
      band: allCourses,
      measure: "completion",
      title: completedTitle(category),
      sortValue: (f) => {
        const completion = f.standing.completion[category];
        return completion ? fraction(completion.complete, completion.possible) : null;
      },
      render: (f) => {
        const completion = f.standing.completion[category];
        const cell = completionCell(completion);
        if (!completion || completion.possible === 0) return cell;
        return {
          ...cell,
          ...byShare(
            termShare(completion.complete, completion.possible),
            PERFORMANCE_RULE.completion,
            (under) => `Under ${percent(under)} of ${completedTitle(category).toLowerCase()}`,
          ),
        };
      },
    })),
  ];

  courses.forEach((course) => {
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
        measure: "deadlines",
        title: "Recent Deadlines Hit",
        sortValue: (f) => {
          const recent = reading(f).recent;
          return recent ? fraction(recent.due - recent.missed - recent.late, recent.due) : null;
        },
        render: (f) => {
          const { recent } = reading(f);
          if (!recent || recent.due === 0) return EMPTY("nothing due in the window");
          return {
            value: `${recent.due - recent.missed - recent.late} of ${recent.due}`,
            detail: `${recent.late} late, ${recent.missed} missing`,
            ...byShare(
              recentOnTimeShare(recent),
              PERFORMANCE_RULE.recentDeadlines,
              (under) => `Under ${percent(under)} of recent deadlines hit`,
            ),
          };
        },
      });

      /*
        The graded window has a column of its own, because the rule reads the window's graded
        assignments in the course whatever kind of unit they sit in, where each Completed column
        below is one kind of work over the whole term.
      */
      columns.push({
        key: `course:${course.id}:graded`,
        band,
        measure: "completion",
        title: "Recently Completed",
        sortValue: (f) => {
          const recent = reading(f).recent;
          return recent ? fraction(recent.graded - recent.incomplete, recent.graded) : null;
        },
        render: (f) => {
          const { recent } = reading(f);
          if (!recent || recent.graded === 0) return EMPTY("nothing graded yet");
          return {
            ...recentlyGradedCell(
              { complete: recent.graded - recent.incomplete, graded: recent.graded },
              "graded or never handed in",
            ),
            ...byShare(
              recentCompleteShare(recent),
              PERFORMANCE_RULE.recentlyCompleted,
              (under) => `Under ${percent(under)} of recent graded work complete`,
            ),
          };
        },
      });
    }

    /*
      Coloured per course as well as pooled under All courses, because a kind of work a fellow is
      failing in one course can hide inside a pooled share the other courses hold up.
    */
    course.categories.forEach((category) => {
      columns.push({
        key: `course:${course.id}:${category}`,
        band,
        measure: "completion",
        title: completedTitle(category),
        sortValue: (f) => {
          const completion = reading(f).completion[category];
          return completion ? fraction(completion.complete, completion.possible) : null;
        },
        render: (f) => {
          const completion = reading(f).completion[category];
          const cell = completionCell(completion);
          if (!completion || completion.possible === 0) return cell;
          return {
            ...cell,
            ...byShare(
              termShare(completion.complete, completion.possible),
              PERFORMANCE_RULE.completion,
              (under) => `Under ${percent(under)} of ${completedTitle(category).toLowerCase()}`,
            ),
          };
        },
      });
    });

    if (course.hasChecks) {
      columns.push({
        key: `course:${course.id}:understanding`,
        band,
        title: "Understanding",
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

  /*
    A coloured column of a measure left out keeps its figure and loses its colour, so a row shows
    only the reasons that placed the fellow. The rule text goes with the colour, since the rule was
    not read.
  */
  return columns.map((column) => {
    if (!column.measure || measures.has(column.measure)) return column;
    return {
      ...column,
      render: (fellow) => {
        const { value, detail, title } = column.render(fellow);
        return { value, detail, title };
      },
    };
  });
}

function completionCell(
  completion: { complete: number; possible: number } | undefined,
): CellContent {
  if (!completion || completion.possible === 0) return EMPTY("nothing graded yet");
  return {
    value: formatPercent(completion.complete / completion.possible),
    detail: `${completion.complete} of ${completion.possible}`,
  };
}

// ===========================================================================
// The summary
// ===========================================================================

/**
 * One row per coloured column: how much of the roster is at or above the bar in it.
 *
 * **A share of the fellows with a figure**, and the row says how many that is, because "80
 * percent" over three fellows and over thirty are different findings. A column nobody has a figure
 * in yet shows a dash rather than a percentage of nobody.
 */
function MeetingSummary({ shares }: { shares: MeetingShare[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">Performance Summary</h2>
      </div>
      <div className="w-fit max-w-full overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Column</TableHead>
              <TableHead className="text-right">Meeting or higher</TableHead>
              <TableHead className="text-right">Fellows</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shares.map((share) => (
              <TableRow key={share.key}>
                <TableCell className="font-medium">{share.title}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {share.counted === 0 ? "—" : formatPercent(share.meeting / share.counted)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {share.counted === 0
                    ? "nobody to read yet"
                    : `${share.meeting} of ${share.counted}`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

// ===========================================================================
// Sorting
// ===========================================================================

/** A column key, or "name" for the fellow column, and which way. */
type Sort = { key: string; direction: "asc" | "desc" };

/** More red windows first, then more yellow, then the lower on-time share, then the lower attendance. */
function worstFirst(a: Fellow, b: Fellow): number {
  return (
    flagged(b, "red") - flagged(a, "red") ||
    flagged(b, "yellow") - flagged(a, "yellow") ||
    ratio(a.standing.onTime) - ratio(b.standing.onTime) ||
    (a.attendance.rate ?? 1) - (b.attendance.rate ?? 1)
  );
}

function flagged(fellow: Fellow, band: CellBand): number {
  return fellow.standing.flags.filter((flag) => flag.band === band).length;
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
    <div className="w-fit max-w-full overflow-hidden rounded-lg border border-border">
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
                <SortButton label={column.title} sortKey={column.key} sort={sort} onSort={onSort} />
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
 * One figure in the grid, with its cell filled green, yellow or red by its band.
 *
 * **No rule text on the screen**, so a row of coloured cells stays as compact as a row of plain
 * ones and the figure is what the eye lands on. The rule is still in the cell for a screen reader,
 * and in the tooltip for anybody who hovers, so the colour is never the only way to know which
 * rule tripped.
 */
function Cell({ edge, content }: { edge: string | null; content: CellContent }) {
  const { value, detail, band, reason, title } = content;

  return (
    <TableCell
      className={cn(
        edge,
        band === "red" && "bg-destructive/10 text-destructive",
        band === "yellow" && "bg-amber-500/15 text-amber-800 dark:text-amber-200",
        band === "green" && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
      )}
      title={title ?? reason}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-sm tabular-nums">{value}</span>
        <span className="truncate text-xs opacity-70">{detail}</span>
        {band === "red" && <span className="sr-only">Red: {reason}</span>}
        {band === "yellow" && <span className="sr-only">Yellow: {reason}</span>}
        {band === "green" && <span className="sr-only">Green: {reason}</span>}
      </div>
    </TableCell>
  );
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)} percent`;
}
