"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ListTree,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";

import { TestStudentBadge } from "@/components/test-student-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatTakenOn,
  GCF_KIND_META,
  GCF_KINDS,
  gcfScoreLabel,
  RECENT_SHOWN,
  scaleLabel,
  standingFor,
  targetLabel,
} from "@/lib/gcf";
import { searchStudents, studentLabel } from "@/lib/gradebook/filters";
import { cn } from "@/lib/utils";
import type { GcfKind } from "@/lib/gcf";
import type { RouterOutputs } from "@/trpc/types";

import { GcfAttemptDialog } from "./gcf-attempt-dialog";
import { GcfImportDialog } from "./gcf-import-dialog";

/**
 * The cohort against the General Coding Framework.
 *
 * **One row per student rather than a grid**, and that is a decision the data forces. Attempts are
 * ragged — a term's export has a median of eight practice attempts per fellow and a maximum of
 * twelve, each on its own date — so a column per attempt would put a different day under
 * "Attempt 2" for every row, and the column heading would be a lie about all but one of them.
 *
 * So each kind gets three figures: how many attempts, the best, and the most recent. **Best and
 * latest side by side is the point.** One number cannot say whether somebody is improving; two
 * that differ say the peak is behind them, which is the thing worth acting on before the real
 * attempt.
 *
 * The two kinds are never added, averaged, or compared. A proctored score is a calibrated index
 * from 200 to 600 and a mock is raw test-case correctness out of however many tasks it had — the
 * same fellow's 512 and 840 are not two measurements of one thing.
 */

type Gcf = RouterOutputs["gcf"]["forCourse"];
type Student = Gcf["activeStudents"][number];
type Attempt = Gcf["attempts"][number];

type SortKey = "name" | GcfKind;
type Sort = { by: SortKey; direction: "asc" | "desc" };

export function GcfTab({ courseId, data }: { courseId: string; data: Gcf }) {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<Sort>({ by: "name", direction: "asc" });
  const [importing, setImporting] = React.useState(false);
  const [open, setOpen] = React.useState<Student | null>(null);
  const [recording, setRecording] = React.useState(false);

  /** Attempts keyed by student, so a row is a lookup rather than a scan of the whole cohort. */
  const byStudent = React.useMemo(() => {
    const map = new Map<string, Attempt[]>();
    for (const attempt of data.attempts) {
      const own = map.get(attempt.studentId);
      if (own) own.push(attempt);
      else map.set(attempt.studentId, [attempt]);
    }
    return map;
  }, [data.attempts]);

  const rows = React.useMemo(() => {
    const searched = searchStudents(data.activeStudents, query);
    const sign = sort.direction === "asc" ? 1 : -1;

    return [...searched].sort((a, b) => {
      if (sort.by === "name") return sign * studentLabel(a).localeCompare(studentLabel(b));

      const best = (student: Student) =>
        standingFor(byStudent.get(student.id) ?? [], sort.by as GcfKind).best?.score ?? null;

      const left = best(a);
      const right = best(b);

      /*
        A fellow who has not sat it goes last whichever way the column points. Never having taken
        the assessment is not a low score, the same distinction the gradebook's cells draw between
        an empty ring and a zero — and sorting by a column nobody has a value in should not
        shuffle the roster into an arbitrary order.
      */
      if (left === null && right === null) return studentLabel(a).localeCompare(studentLabel(b));
      if (left === null) return 1;
      if (right === null) return -1;

      return sign * (left - right) || studentLabel(a).localeCompare(studentLabel(b));
    });
  }, [data.activeStudents, query, sort, byStudent]);

  /*
    The scale each kind is measured on across this whole cohort. Over `data.attempts` rather than
    the searched rows, so narrowing the roster cannot change what the heading claims.
  */
  const scales = React.useMemo(
    () =>
      Object.fromEntries(
        GCF_KINDS.map((kind) => [kind, scaleLabel(data.attempts, kind)]),
      ) as Record<GcfKind, string | null>,
    [data.attempts],
  );

  const toggle = (by: SortKey) =>
    setSort((current) =>
      current.by === by
        ? { by, direction: current.direction === "asc" ? "desc" : "asc" }
        : // A name opens A-to-Z; a score opens highest first, because the question behind sorting
          // by a score is who is furthest along.
          { by, direction: by === "name" ? "asc" : "desc" },
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search students"
            aria-label="Search students by name"
            className="pl-8"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Button type="button" size="sm" onClick={() => setImporting(true)}>
          <Upload data-icon="inline-start" />
          Import from CodeSignal
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setRecording(true)}>
          <Plus data-icon="inline-start" />
          Record an attempt
        </Button>
      </div>

      {/*
        What the two numbers mean, said once above the table rather than in a tooltip on each
        column. The scales are genuinely different quantities, and a reader who assumes 840 beats
        512 has misread the whole tab.
      */}
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {GCF_KINDS.map((kind) => (
          <li key={kind}>
            <span className="font-medium text-foreground">{GCF_KIND_META[kind].label}</span> —{" "}
            {GCF_KIND_META[kind].blurb} Target {targetLabel(kind)}.
          </li>
        ))}
      </ul>

      {/*
        Said in words, because the difference from every other tab is not something an icon alone
        can carry: there, a student's name is a link to their record; here it opens what they have
        attempted, which is the only place this data can be read or corrected.
      */}
      <p className="text-xs text-muted-foreground">
        Select a student to see every attempt they have made, add one, or explain a flag.
      </p>

      {data.activeStudents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody in this cohort yet.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No student matches that search.
        </p>
      ) : (
        <StandingsTable
          rows={rows}
          byStudent={byStudent}
          scales={scales}
          sort={sort}
          onSort={toggle}
          onOpen={setOpen}
        />
      )}

      {data.removedStudents.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium">Removed students</h3>
            <p className="text-xs text-muted-foreground">
              No longer in the cohort. Their results are kept and stay readable — to them, and here.
            </p>
          </div>
          <StandingsTable
            rows={searchStudents(data.removedStudents, query)}
            byStudent={byStudent}
            scales={scales}
            sort={sort}
            onSort={toggle}
            onOpen={setOpen}
          />
        </section>
      )}

      <GcfImportDialog courseId={courseId} open={importing} onOpenChange={setImporting} />

      <GcfAttemptDialog
        courseId={courseId}
        students={data.activeStudents}
        student={open}
        attempts={open ? (byStudent.get(open.id) ?? []) : []}
        open={open !== null || recording}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(null);
            setRecording(false);
          }
        }}
      />
    </div>
  );
}

function StandingsTable({
  rows,
  byStudent,
  scales,
  sort,
  onSort,
  onOpen,
}: {
  rows: Student[];
  byStudent: Map<string, Attempt[]>;
  /**
   * The scale each band's heading names, or null where this cohort's attempts do not share one.
   *
   * Computed once over the whole cohort and passed in, rather than per table, so the active and
   * removed students' tables cannot end up naming different scales for one kind.
   */
  scales: Record<GcfKind, string | null>;
  sort: Sort;
  onSort: (by: SortKey) => void;
  onOpen: (student: Student) => void;
}) {
  /**
   * A score, written for a column whose heading may or may not have named the scale.
   *
   * Bare where it did — which is every ordinary course — and with its own denominator where it
   * could not, so a cohort holding mocks of two different lengths still reads correctly rather
   * than being measured against a maximum that is only true of some of them.
   */
  const score = (attempt: Attempt, kind: GcfKind): string =>
    scales[kind] === null ? gcfScoreLabel(attempt) : String(attempt.score);

  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-card" />
            {GCF_KINDS.map((kind) => (
              <TableHead
                key={kind}
                colSpan={3}
                className="border-l border-border text-center text-xs font-medium"
              >
                {GCF_KIND_META[kind].label}
                {/*
                  The scale, said once over the whole band so no cell beneath has to repeat it.
                  Absent where this cohort's attempts of this kind do not share one — a mock is
                  300 points a task, so a course holding both a four-task and a three-task mock
                  has no single maximum to name, and those cells carry their own denominators
                  instead.
                */}
                {scales[kind] && <span className="font-normal opacity-70"> ({scales[kind]})</span>}
              </TableHead>
            ))}
          </TableRow>

          <TableRow>
            <SortHead
              className="sticky left-0 z-10 bg-card"
              label="Student"
              active={sort.by === "name"}
              direction={sort.direction}
              onClick={() => onSort("name")}
            />
            {GCF_KINDS.map((kind) => (
              <React.Fragment key={kind}>
                <TableHead className="border-l border-border text-center text-xs">
                  Attempts
                </TableHead>
                <SortHead
                  center
                  label={
                    <span className="text-xs leading-tight">
                      Best
                      <br />
                      <span className="font-normal opacity-70">target {targetLabel(kind)}</span>
                    </span>
                  }
                  active={sort.by === kind}
                  direction={sort.direction}
                  onClick={() => onSort(kind)}
                />
                <TableHead className="text-center text-xs">
                  <span className="block leading-tight">
                    Last {RECENT_SHOWN}
                    <br />
                    <span className="font-normal opacity-70">newest first</span>
                  </span>
                </TableHead>
              </React.Fragment>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((student) => {
            const attempts = byStudent.get(student.id) ?? [];

            return (
              <TableRow key={student.id}>
                <TableCell className="sticky left-0 z-10 bg-card font-medium">
                  {/*
                    **The name opens this fellow's attempts, and has to say so.**

                    Everywhere else in the gradebook the first column is a link to the student's
                    record; here it is a button that opens a dialog. Same place, same styling,
                    different behaviour — which is exactly the kind of thing a reader learns once
                    by being surprised. So it is marked: an icon that is not a link's, a title and
                    an accessible name that state what will happen, and a hint above the table for
                    the reader who has not hovered anything yet.

                    The record itself is not lost, only moved: the dialog links to it, so the
                    destination the other tabs go to is one further click rather than gone.
                  */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(student)}
                      title={`See ${studentLabel(student)}'s GCF attempts`}
                      aria-label={`See ${studentLabel(student)}'s GCF attempts`}
                      className="group flex min-w-0 items-center gap-1.5 text-left"
                    >
                      <ListTree
                        className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                        aria-hidden
                      />
                      <span className="truncate group-hover:underline">
                        {studentLabel(student)}
                      </span>
                    </button>
                    {student.testStudentNumber !== null && <TestStudentBadge />}
                  </div>
                </TableCell>

                {GCF_KINDS.map((kind) => {
                  const standing = standingFor(attempts, kind);

                  return (
                    <React.Fragment key={kind}>
                      <TableCell className="border-l border-border text-center text-sm tabular-nums text-muted-foreground">
                        {standing.attempts === 0 ? "—" : standing.attempts}
                      </TableCell>

                      {/*
                        Green at or above the target and muted below, with the target named in the
                        heading so the colour needs no legend. One thing the colour says.
                      */}
                      <TableCell
                        className={cn(
                          "text-center text-sm font-medium tabular-nums",
                          standing.reached
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {standing.best ? score(standing.best, kind) : "—"}
                      </TableCell>

                      {/*
                        The last few results rather than only the most recent one.

                        One score says where somebody stands; three say which way they are going,
                        which is the thing worth acting on before a proctored attempt. Newest
                        first, so the column reads in the same direction as the rest of the
                        application's lists.

                        **Fewer than three is shown as fewer, and never attempted says so in
                        words.** A dash would put "has not attempted this" in the same visual
                        place as a low score, and those are the two states an instructor most
                        needs to tell apart.
                      */}
                      <TableCell className="text-center text-sm">
                        {standing.recent.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Not attempted</span>
                        ) : (
                          <span className="flex flex-col items-center leading-tight">
                            <span className="flex flex-wrap items-baseline justify-center gap-x-1.5 tabular-nums">
                              {standing.recent.map((attempt, index) => (
                                <span
                                  key={attempt.id}
                                  className={cn(
                                    index === 0
                                      ? "font-medium text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {score(attempt, kind)}
                                  {index < standing.recent.length - 1 && (
                                    <span className="ml-1.5 opacity-40" aria-hidden>
                                      ·
                                    </span>
                                  )}
                                </span>
                              ))}
                            </span>
                            <span className="text-[11px] text-muted-foreground opacity-70">
                              {formatTakenOn(standing.recent[0]!.takenOn)}
                            </span>
                          </span>
                        )}
                      </TableCell>
                    </React.Fragment>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortHead({
  label,
  active,
  direction,
  onClick,
  className,
  center,
}: {
  label: React.ReactNode;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  className?: string;
  center?: boolean;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
          center && "mx-auto",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {!active ? (
          <ChevronsUpDown className="size-3 shrink-0" aria-hidden />
        ) : direction === "asc" ? (
          <ArrowUp className="size-3 shrink-0" aria-hidden />
        ) : (
          <ArrowDown className="size-3 shrink-0" aria-hidden />
        )}
      </button>
    </TableHead>
  );
}
