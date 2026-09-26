"use client";

import Link from "next/link";
import * as React from "react";

import { HelpTip } from "@/components/help-tip";
import { SortableHead, VerdictMark } from "@/components/instructor/gradebook-grid";
import { TestStudentBadge } from "@/components/test-student-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  stickyColumn,
  stickyColumnContent,
  stickyHeader,
  stickyHeaderContainer,
} from "@/components/ui/table";
import { CATEGORY_META, UNIT_CATEGORIES, type CourseUnitCategory } from "@/lib/course-units";
import { GCF_TARGET, PROCTORED_SCALE, targetLabel } from "@/lib/gcf";
import {
  allUnits,
  countedUnits,
  courseVerdictByStudent,
  unitCompletionByStudent,
  workOf,
  type GroupedCourse,
  type UnitVerdict,
} from "@/lib/gradebook/categories";
import { sortStudents, studentLabel, type RowSort } from "@/lib/gradebook/filters";
import {
  ASSIGNMENT_DRIFT_RULE,
  assignmentDriftList,
  awaitingByStudent,
  completionByStudent,
  completionLabel,
  DRIFT_REASON_LABEL,
  lateByStudent,
  missingByStudent,
  recentWorkByStudent,
  recentWorkSentence,
  type Completion,
} from "@/lib/gradebook/summary";
import { studentHref } from "@/lib/links";
import type { RouterOutputs } from "@/trpc/types";
import { cn } from "@/lib/utils";

type Gradebook = RouterOutputs["courses"]["gradebook"];
type Gcf = RouterOutputs["gcf"]["forCourse"];
type Assignment = Gradebook["assignments"][number];
type Cell = Gradebook["cells"][number];
type Student = Gradebook["activeEnrollments"][number]["student"];

/**
 * One row per student: how many units of each category they have finished, their course-wide
 * figures, and whether the course itself is finished.
 *
 * **The point of the tab**: the figures side by side, so "strong on modules and behind on
 * projects" is one glance rather than three. Every figure is the same one its own tab shows,
 * computed from the same functions over the same cells, so the tabs cannot disagree.
 *
 * **Two scales, deliberately, and the headings say which is which.** The three per-category
 * columns count *units* — an assignment is complete when it is marked so, a unit when all its
 * published assignments are, a course when all its units are — which is the reading the Course
 * roll-up beside them is built on. The three course-wide columns count *assignments and
 * hand-ins* across every category: completed assignments, handed in late, and missing are the
 * per-tab summary figures summed over the whole course, and the CSV export has always carried
 * exactly these totals under exactly these words.
 *
 * **Sortable, with no search box.** The Overview answers "who, across everything" — sorting any
 * column is that question ordered; filtering it is the grids' job, where the work being filtered
 * is on screen. Which is also why this is a client component where the rest of the gradebook
 * frame stays on the server: a header that sorts is click state, and it is the only state here.
 */
export function Overview({
  courseId,
  grouped,
  active,
  removed,
  cells,
  removedCells,
  gcf,
  now,
}: {
  courseId: string;
  grouped: GroupedCourse<Assignment>;
  active: Student[];
  removed: Student[];
  cells: Cell[];
  removedCells: Cell[];
  gcf: Gcf | null;
  /** The page's one clock, serialized across the boundary — what "missing" is measured at. */
  now: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      {active.length > 0 && (
        <>
          <NeedsAConversation
            courseId={courseId}
            grouped={grouped}
            students={active}
            cells={cells}
            now={now}
          />
          <OverviewTable
            courseId={courseId}
            grouped={grouped}
            students={active}
            cells={cells}
            countWaiting
            gcf={gcf}
            now={now}
          />
        </>
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
            now={now}
          />
        </section>
      )}
    </div>
  );
}

/**
 * Who is drifting, above the table that holds the term.
 *
 * **The attendance screen's "Needs a conversation", for the work.** The table beneath carries the
 * term-long late and missing totals, and those hide exactly the fellow this list is for: somebody
 * who finished every module in September and has handed nothing in for a fortnight. The rule is
 * one hover away, behind the "?" in the heading, because a list somebody is expected to act on has
 * to say what put a person on it, or the reader is deciding whether to trust an unexplained
 * judgement rather than what to do about a fellow.
 *
 * Computed from the same cells and the same clock the table reads, so a fellow on this list has the
 * missing and late marks in their row that put them here. Test students are left out, as they are
 * from every figure that is about the cohort.
 *
 * Only the active roster: a removed fellow is not somebody to have a conversation with about this
 * week's deadlines.
 */
function NeedsAConversation({
  courseId,
  grouped,
  students,
  cells,
  now,
}: {
  courseId: string;
  grouped: GroupedCourse<Assignment>;
  students: Student[];
  cells: Cell[];
  now: string;
}) {
  const counted = students.filter((student) => student.testStudentNumber === null);
  const recents = recentWorkByStudent(
    counted.map((student) => student.id),
    workOf(allUnits(grouped)),
    cells,
    new Date(now),
  );
  const drifting = assignmentDriftList(recents.values());
  const byId = new Map(counted.map((student) => [student.id, student]));

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        Needs a conversation · {drifting.length}
        <HelpTip>
          Missed or handed in late {ASSIGNMENT_DRIFT_RULE.slippedAtLeast} or more of the last{" "}
          {ASSIGNMENT_DRIFT_RULE.dueOf} assignments due, or fell short on{" "}
          {ASSIGNMENT_DRIFT_RULE.incompleteAtLeast} or more of their last{" "}
          {ASSIGNMENT_DRIFT_RULE.gradedOf} graded. Recent rather than cumulative, because somebody
          who finished every module in September and has handed nothing in this fortnight is the
          person to talk to today.
        </HelpTip>
      </h3>

      {drifting.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Nobody is drifting by that rule.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {drifting.map((entry) => {
            const student = byId.get(entry.recent.studentId);
            if (!student) return null;
            return (
              <li
                key={student.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={studentHref(courseId, student.id)}
                    className="font-medium hover:underline"
                  >
                    {studentLabel(student)}
                  </Link>
                  {entry.reasons.map((reason) => (
                    <span key={reason} className="font-medium text-destructive">
                      {DRIFT_REASON_LABEL[reason]}
                    </span>
                  ))}
                </span>
                <span>{recentWorkSentence(entry.recent)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Sorting by the course column ranks the verdicts, further along first. "Pending" ranks lowest
 * rather than null: a fellow who has not finished is an answer, where a fellow with no GCF
 * sitting is the absence of one.
 */
const VERDICT_RANK: Record<UnitVerdict, number> = { complete: 2, incomplete: 1, pending: 0 };

function OverviewTable({
  courseId,
  grouped,
  students,
  cells,
  countWaiting,
  gcf,
  now,
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
  now: string;
}) {
  const [sort, setSort] = React.useState<RowSort>({ by: "name", direction: "asc" });

  const byCategory: Record<CourseUnitCategory, Map<string, Completion>> = {
    MODULE: unitCompletionByStudent(cells, grouped.MODULE),
    PROJECT: unitCompletionByStudent(cells, grouped.PROJECT),
    ASSESSMENT: unitCompletionByStudent(cells, grouped.ASSESSMENT),
  };

  /*
    **Units that hold released work, not every unit of the category.** A project whose deliverables
    are all still drafts cannot be finished by anybody, so counting it turns "2 of 2 projects" into
    "2 of 3" for a whole cohort the moment an instructor starts writing the next one — a figure that
    falls the day work is *authored* rather than the day anything changes about the fellow.

    `unitHasVerdict` rather than a count written here, because it is the rule the numerator beside
    this already uses: `unitCompletionByStudent` measures against the units that have a verdict, and
    the two halves of one fraction reading different sets of units is how "3 of 2" appears. It is
    also what the course roll-up counts, so the three figures in a row agree.
  */
  const possible: Record<CourseUnitCategory, number> = {
    MODULE: countedUnits(grouped.MODULE),
    PROJECT: countedUnits(grouped.PROJECT),
    ASSESSMENT: countedUnits(grouped.ASSESSMENT),
  };

  /*
    The course-wide three, over every assignment of every category. The gradebook payload holds
    released work only, so there is no draft to filter out of the denominator here — and the cells
    are already course-wide, so no `cellsFor` narrowing either. `lateByStudent` and
    `missingByStudent` are the CSV's own calls; the file and this table show one set of totals.
  */
  const at = new Date(now);
  const work = workOf(allUnits(grouped));
  const completedAssignments = completionByStudent(cells, work.length);
  const late = lateByStudent(cells, work);
  const missing = missingByStudent(
    students.map((student) => student.id),
    work,
    cells,
    at,
  );

  /*
    The one figure that exists nowhere else in the application: whether a student has finished the
    course. Computed over every unit of every category, from the same cells the columns beside it
    read, so the roll-up and its parts cannot disagree.
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

  const sorted = sortStudents(students, sort, {
    completed: (id) => completedAssignments.get(id)?.complete ?? 0,
    waiting: (id) => awaiting?.get(id) ?? 0,
    late: (id) => late.get(id) ?? 0,
    missing: (id) => missing.get(id) ?? 0,
    // No per-assignment columns on this table, so the rank an assignment sort would read is null.
    score: () => null,
    category: (id, category) => byCategory[category as CourseUnitCategory].get(id)?.complete ?? 0,
    course: (id) => VERDICT_RANK[courseVerdicts.get(id) ?? "pending"],
    gcf: (id) => proctoredBest.get(id) ?? null,
  });

  const heading = (top: string, bottom: string) => (
    <span className="block max-w-28 text-xs leading-tight">
      {top}
      <br />
      {bottom}
    </span>
  );

  /*
    The border's `overflow-hidden` is not a scroller: the container inside `Table` scrolls both
    axes now, and this div's overflow only clips the opaque sticky cells to the rounded corner.
  */
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table containerClassName={stickyHeaderContainer}>
        <TableHeader className={stickyHeader}>
          <TableRow>
            <SortableHead
              label="Student"
              sort={sort}
              column={{ by: "name" }}
              onSort={setSort}
              className={stickyColumn}
            />
            {UNIT_CATEGORIES.map((category) => (
              <SortableHead
                key={category}
                label={heading("Completed", CATEGORY_META[category].pluralNoun)}
                sort={sort}
                column={{ by: "category", category }}
                onSort={setSort}
                center
                className="text-center"
              />
            ))}
            <SortableHead
              label={heading("Completed", "assignments")}
              sort={sort}
              column={{ by: "completed" }}
              onSort={setSort}
              center
              className="text-center"
            />
            <SortableHead
              label={heading("Handed in", "late")}
              sort={sort}
              column={{ by: "late" }}
              onSort={setSort}
              center
              className="text-center"
            />
            <SortableHead
              label={<span className="block max-w-28 text-xs leading-tight">Missing</span>}
              sort={sort}
              column={{ by: "missing" }}
              onSort={setSort}
              center
              className="text-center"
            />
            <SortableHead
              label={heading("Waiting", "on you")}
              sort={sort}
              column={{ by: "waiting" }}
              onSort={setSort}
              center
              className="text-center"
            />
            <SortableHead
              label={<span className="block max-w-28 text-xs leading-tight">Course</span>}
              sort={sort}
              column={{ by: "course" }}
              onSort={setSort}
              center
              className="text-center"
            />
            {gcf !== null && (
              <SortableHead
                label={
                  /*
                    The scale and the target both said once in the heading, so the numbers beneath
                    are bare — the same convention the GCF tab uses, since a reader moving between
                    the two should not find one column of `512` and another of `512/600`.
                  */
                  <span className="block max-w-28 text-xs leading-tight">
                    Best GCF
                    <br />
                    <span className="font-normal opacity-70">
                      out of {PROCTORED_SCALE.max} · target {targetLabel("PROCTORED")}
                    </span>
                  </span>
                }
                sort={sort}
                column={{ by: "gcf" }}
                onSort={setSort}
                center
                className="text-center"
              />
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((student) => (
            <TableRow key={student.id}>
              <TableCell className={cn(stickyColumn, "font-medium")}>
                <div className={stickyColumnContent}>
                  {student.testStudentNumber !== null && <TestStudentBadge />}
                  <Link href={studentHref(courseId, student.id)} className="hover:underline">
                    {studentLabel(student)}
                  </Link>
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

              <TableCell className="text-center text-sm font-medium tabular-nums text-muted-foreground">
                {completionLabel(completedAssignments.get(student.id), work.length)}
              </TableCell>

              {/*
                Late carries weight but no colour and missing is red, the grids' own reading. Zero
                is muted rather than hidden: "nothing late" is worth reading, and a blank cell says
                only that something failed to render.
              */}
              <TableCell
                className={cn(
                  "text-center text-sm tabular-nums",
                  late.get(student.id) ? "font-medium" : "text-muted-foreground",
                )}
              >
                {late.get(student.id) ?? 0}
              </TableCell>

              <TableCell
                className={cn(
                  "text-center text-sm tabular-nums",
                  missing.get(student.id)
                    ? "font-medium text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {missing.get(student.id) ?? 0}
              </TableCell>

              {/*
                Amber when there is anything, and the same amber as the dots it counts on the
                other tabs. Zero is muted rather than hidden, as above.
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
