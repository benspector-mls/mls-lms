import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { GcfTab } from "@/components/instructor/gcf-tab";
import { GradebookGrid, VerdictMark } from "@/components/instructor/gradebook-grid";
import { EmptyState } from "@/components/list-states";
import { TestStudentBadge } from "@/components/test-student-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CATEGORY_META, UNIT_CATEGORIES, type CourseUnitCategory } from "@/lib/course-units";
import { GCF_TARGET, PROCTORED_SCALE, targetLabel } from "@/lib/gcf";
import {
  allUnits,
  courseVerdictByStudent,
  groupByUnit,
  unitCompletionByStudent,
  workOf,
  type GroupedCourse,
} from "@/lib/gradebook/categories";
import { gradebookIsEmpty, sortGradebookAssignments } from "@/lib/gradebook/csv";
import { studentLabel } from "@/lib/gradebook/filters";
import { awaitingByStudent, completionLabel, type Completion } from "@/lib/gradebook/summary";
import { gradebookHref, studentHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Every student against every piece of work, in five tabs.
 *
 * **Modules, projects, and assessments are read separately**, which is what the tabs are for:
 * "how is this student doing" has three answers, and one undifferentiated grid gives an average of
 * them that describes none. Overview puts the three figures in one row so a reader who wants the
 * comparison does not have to hold three tabs in their head.
 *
 * The split is `groupByUnit` in `lib/gradebook/categories.ts`, and it is exhaustive: every
 * assignment in the payload appears under exactly one unit, on exactly one tab. A column that is
 * missing looks like work that does not exist, which is the one failure a tabbed gradebook can
 * have that an untabbed one cannot.
 *
 * **The tab lives in the address rather than in component state**, which is what keeps this a
 * server component. The alternative renders all four tabs and ships a term of grading cells to
 * every reader's browser to draw one of them — the same weight the CSV download is deliberately
 * built on the server to avoid. It also makes a tab shareable, and it is the pattern the group
 * filter beside it already uses.
 *
 * The grid on each category tab *is* a client component, because searching and sorting it are
 * things a reader does dozens of times a minute and a round trip per keystroke is not a control.
 * It receives one category's work, so three tabs' worth stays on the server.
 *
 * **The fifth tab is not coursework.** The General Coding Framework is sat at CodeSignal, outside
 * this application: there is no assignment behind a score and nothing was handed in. It is here
 * because this is where a cohort is read, and nowhere else — it takes no part in the completion
 * roll-up, since a course whose units are all finished is finished whether or not anybody has sat
 * an external benchmark yet.
 */

type Gradebook = RouterOutputs["courses"]["gradebook"];
type Gcf = RouterOutputs["gcf"]["forCourse"];
type Assignment = Gradebook["assignments"][number];
type Cell = Gradebook["cells"][number];
// From the active list rather than a whole-roster one, which this payload no longer carries.
// Either complement has the same shape, so which it is read off is a question of what exists.
type Student = Gradebook["activeEnrollments"][number]["student"];

/**
 * The five tabs, in the order they are offered.
 *
 * Overview first because it is the one that answers a question about the whole cohort; then the
 * three categories in the order `UNIT_CATEGORIES` names them, so the tab strip and every other
 * list of the categories in the application read the same way round; and the GCF last, because it
 * is the one thing here that is not this course's own work.
 */
export const GRADEBOOK_TABS = ["overview", ...UNIT_CATEGORIES, "GCF"] as const;

export type GradebookTab = (typeof GRADEBOOK_TABS)[number];

/**
 * What each tab is called.
 *
 * A map of its own rather than `CATEGORY_META[tab].tabLabel`, which is what this was and which
 * only worked while every tab but the overview was a `CourseUnitCategory`. The GCF is not one —
 * it is not coursework at all — so the lookup had to become something that covers all five.
 */
const TAB_LABEL: Record<GradebookTab, string> = {
  overview: "Overview",
  MODULE: CATEGORY_META.MODULE.tabLabel,
  PROJECT: CATEGORY_META.PROJECT.tabLabel,
  ASSESSMENT: CATEGORY_META.ASSESSMENT.tabLabel,
  GCF: "GCF",
};

/**
 * Which tab an address names, defaulting to the overview.
 *
 * Exported so the page can parse `?tab=` and pass the answer down, in the manner of
 * `parseCohortSelection`. Anything unrecognised is the overview rather than an error: a stale
 * link or a typed address should land somewhere useful, and the overview is the tab that
 * describes all three of the others.
 */
export function parseGradebookTab(value: string | undefined): GradebookTab {
  return (GRADEBOOK_TABS as readonly string[]).includes(value ?? "")
    ? (value as GradebookTab)
    : "overview";
}

export function Gradebook({
  data,
  gcf,
  tab,
  cohort,
}: {
  data: Gradebook;
  /**
   * The selected fellows' GCF results, or null on a tab that does not read them.
   *
   * Fetched by the page only for the two tabs that show them, so opening the Assignments tab does
   * not also pull a term of CodeSignal results nobody asked for.
   */
  gcf: Gcf | null;
  tab: GradebookTab;
  /** The cohort the grid was built for, carried into every tab link. */
  cohort: string;
}) {
  const active = data.activeEnrollments.map((enrollment) => enrollment.student);
  const removed = data.removedEnrollments.map((enrollment) => enrollment.student);

  /*
    Course order, which is `courseUnit.position` — the sequence an instructor set, not anything
    alphabetical or parsed out of a name. Shared with the CSV export rather than sorted here, so
    the columns of the downloaded file are these columns in this order.
  */
  const assignments = sortGradebookAssignments(data.assignments);

  /*
    The three lists the tabs draw, from the payload this render already holds. Sorting first and
    grouping second, so the units keep course order and each unit's work is re-sorted by due date
    on top of it.
  */
  const grouped = groupByUnit(assignments, data.courseUnits);

  /*
    Rendered once here rather than read inside the grid, so the due-date windows mean the same
    instant on the server and in the browser that hydrates it.
  */
  const now = new Date().toISOString();

  if (gradebookIsEmpty(data)) {
    return (
      <EmptyState
        icon={<BarChart3 />}
        title="Nothing to show yet"
        description="Grades appear here once the course has assignments and students have joined."
      />
    );
  }

  /*
    Assignments, not units. The count is there to say how much is on the other side of a tab, and
    what a tab holds is columns — "18 modules" tells a reader nothing about whether opening it
    means reading four columns or ninety. Counting units also made the Assignments tab and the
    Projects tab measure different-sized things while looking like one scale.

    Every assignment in the category, including the drafts, because the grid draws a column for
    each. Units with nothing in them contribute nothing here, which is the same reason the grid
    omits their bands.
  */
  const counts: Record<GradebookTab, number | null> = {
    overview: null,
    MODULE: workOf(grouped.MODULE).length,
    PROJECT: workOf(grouped.PROJECT).length,
    ASSESSMENT: workOf(grouped.ASSESSMENT).length,
    // Sittings rather than students, which is the same reading as the other three: how much is on
    // the other side of the tab.
    GCF: gcf?.attempts.length ?? null,
  };

  return (
    <div className="flex flex-col gap-6">
      <TabStrip courseId={data.course.id} cohort={cohort} active={tab} counts={counts} />

      {tab === "overview" ? (
        <Overview
          courseId={data.course.id}
          grouped={grouped}
          active={active}
          removed={removed}
          cells={data.cells}
          removedCells={data.removedCells}
          gcf={gcf}
        />
      ) : tab === "GCF" ? (
        gcf === null ? null : (
          <GcfTab courseId={data.course.id} data={gcf} />
        )
      ) : (
        <GradebookGrid
          courseId={data.course.id}
          category={tab}
          units={grouped[tab]}
          active={active}
          removed={removed}
          cells={data.cells}
          removedCells={data.removedCells}
          now={now}
        />
      )}
    </div>
  );
}

/**
 * The four tabs, as links.
 *
 * Links rather than buttons, so each tab is an address: shareable, bookmarkable, and reachable
 * with the browser's own back button. The cohort filter is carried through every one of them,
 * because switching tab must never silently widen the grid back to the whole roster.
 *
 * The count beside each label is how many assignments are on the other side of it, which is what
 * makes the shape of a course readable without opening all four — "forty assignments, three
 * assessment parts, five deliverables" in a glance.
 */
function TabStrip({
  courseId,
  cohort,
  active,
  counts,
}: {
  courseId: string;
  cohort: string;
  active: GradebookTab;
  counts: Record<GradebookTab, number | null>;
}) {
  const href = (tab: GradebookTab) => {
    const params = new URLSearchParams();
    if (cohort !== "all") params.set("cohort", cohort);
    if (tab !== "overview") params.set("tab", tab);
    const query = params.toString();
    return query ? `${gradebookHref(courseId)}?${query}` : gradebookHref(courseId);
  };

  return (
    <nav
      aria-label="Gradebook categories"
      className="inline-flex w-auto self-start items-center gap-1 rounded-lg bg-muted p-1"
    >
      {GRADEBOOK_TABS.map((tab) => (
        <Link
          key={tab}
          href={href(tab)}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {TAB_LABEL[tab]}
          {counts[tab] !== null && (
            <span className="text-xs tabular-nums opacity-70">{counts[tab]}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/**
 * One row per student: how many units of each category they have finished, and whether the course
 * itself is finished.
 *
 * **The point of the tab**: the three figures side by side, so "strong on modules and behind on
 * projects" is one glance rather than three. Every figure is the same one its own tab shows,
 * computed from the same functions over the same cells, so the four tabs cannot disagree.
 *
 * **Units completed rather than assignments completed**, on every one of the three. Completion is
 * one rule at three levels — an assignment is complete when it is marked so, a unit when all its
 * published assignments are, a course when all its units are — and a row that counted assignments
 * here and units on the tabs would be two different claims sharing a heading.
 */
function Overview({
  courseId,
  grouped,
  active,
  removed,
  cells,
  removedCells,
  gcf,
}: {
  courseId: string;
  grouped: GroupedCourse<Assignment>;
  active: Student[];
  removed: Student[];
  cells: Cell[];
  removedCells: Cell[];
  gcf: Gcf | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      {active.length > 0 && (
        <OverviewTable
          courseId={courseId}
          grouped={grouped}
          students={active}
          cells={cells}
          countWaiting
          gcf={gcf}
        />
      )}

      {removed.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium">Removed students</h3>
            <p className="text-xs text-muted-foreground">
              No longer in the cohort, and not counted in any figure above.
            </p>
          </div>
          <OverviewTable
            courseId={courseId}
            grouped={grouped}
            students={removed}
            cells={removedCells}
            countWaiting={false}
            gcf={gcf}
          />
        </section>
      )}
    </div>
  );
}

function OverviewTable({
  courseId,
  grouped,
  students,
  cells,
  countWaiting,
  gcf,
}: {
  courseId: string;
  grouped: GroupedCourse<Assignment>;
  students: Student[];
  cells: Cell[];
  /** The cohort's GCF results, for the one column here that is not this course's own work. */
  gcf: Gcf | null;
  /**
   * Whether an ungraded submission counts as work outstanding.
   *
   * False for the removed students' table: their work is out of triage and out of the queue, so
   * nobody is going to grade it, and a count of it would claim a task that cannot be cleared.
   */
  countWaiting: boolean;
}) {
  const byCategory: Record<CourseUnitCategory, Map<string, Completion>> = {
    MODULE: unitCompletionByStudent(cells, grouped.MODULE),
    PROJECT: unitCompletionByStudent(cells, grouped.PROJECT),
    ASSESSMENT: unitCompletionByStudent(cells, grouped.ASSESSMENT),
  };

  const possible: Record<CourseUnitCategory, number> = {
    MODULE: grouped.MODULE.length,
    PROJECT: grouped.PROJECT.length,
    ASSESSMENT: grouped.ASSESSMENT.length,
  };

  /*
    The one figure that exists nowhere else in the application: whether a student has finished the
    course. Computed over every unit of every category, from the same cells the three columns
    beside it read, so the roll-up and its parts cannot disagree.
  */
  const courseVerdicts = courseVerdictByStudent(
    cells,
    allUnits(grouped),
    students.map((student) => student.id),
  );

  const awaiting = countWaiting ? awaitingByStudent(cells) : null;

  /*
    The one figure here that is not about this course's own work: a fellow's best proctored GCF.
    Best rather than latest, and the same reading the GCF tab uses — a later, weaker sitting does
    not take away a score somebody has already achieved.
  */
  const proctoredBest = new Map<string, number>();
  for (const attempt of gcf?.attempts ?? []) {
    if (attempt.kind !== "PROCTORED") continue;
    const current = proctoredBest.get(attempt.studentId);
    if (current === undefined || attempt.score > current) {
      proctoredBest.set(attempt.studentId, attempt.score);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Student</TableHead>
            {UNIT_CATEGORIES.map((category) => (
              <TableHead key={category} className="text-center">
                <span className="mx-auto block max-w-28 text-xs leading-tight">
                  Completed
                  <br />
                  {CATEGORY_META[category].pluralNoun}
                </span>
              </TableHead>
            ))}
            <TableHead className="text-center">
              <span className="mx-auto block max-w-28 text-xs leading-tight">
                Waiting
                <br />
                on you
              </span>
            </TableHead>
            <TableHead className="text-center">
              <span className="mx-auto block max-w-28 text-xs leading-tight">Course</span>
            </TableHead>
            {gcf !== null && (
              <TableHead className="text-center">
                {/*
                  The scale and the target both said once in the heading, so the numbers beneath
                  are bare — the same convention the GCF tab uses, since a reader moving between
                  the two should not find one column of `512` and another of `512/600`.
                */}
                <span className="mx-auto block max-w-28 text-xs leading-tight">
                  Best GCF
                  <br />
                  <span className="font-normal opacity-70">
                    out of {PROCTORED_SCALE.max} · target {targetLabel("PROCTORED")}
                  </span>
                </span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => (
            <TableRow key={student.id}>
              <TableCell className="sticky left-0 z-10 bg-card font-medium">
                <div className="flex items-center gap-2">
                  <Link href={studentHref(courseId, student.id)} className="hover:underline">
                    {studentLabel(student)}
                  </Link>
                  {student.testStudentNumber !== null && <TestStudentBadge />}
                </div>
              </TableCell>

              {UNIT_CATEGORIES.map((category) => (
                <TableCell
                  key={category}
                  className="text-center text-sm font-medium tabular-nums text-muted-foreground"
                >
                  {completionLabel(byCategory[category].get(student.id), possible[category])}
                </TableCell>
              ))}

              {/*
                Amber when there is anything, and the same amber as the dots it counts on the
                other tabs. Zero is muted rather than hidden: "nothing waiting" is worth reading,
                and a blank cell says only that something failed to render.
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

              <TableCell className="text-center">
                <VerdictMark verdict={courseVerdicts.get(student.id) ?? "pending"} />
              </TableCell>

              {gcf !== null && (
                <TableCell
                  className={cn(
                    "text-center text-sm font-medium tabular-nums",
                    (proctoredBest.get(student.id) ?? 0) >= GCF_TARGET.PROCTORED
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground",
                  )}
                >
                  {proctoredBest.get(student.id) ?? "—"}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
