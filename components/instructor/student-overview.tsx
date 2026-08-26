"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ArrowLeft, GitBranch, Inbox, Mail, UserMinus } from "lucide-react";

import { BatchGenerate } from "@/components/instructor/batch-generate";
import {
  GradingModeBar,
  GradingModeButton,
  useGradingMode,
} from "@/components/instructor/grading-mode";
import { GradingReview } from "@/components/instructor/grading-review";
import { SubmissionRow } from "@/components/instructor/submission-row";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BatchState } from "@/hooks/use-batch-generate";
import { CATEGORY_META, type CourseUnitCategory } from "@/lib/course-units";
import { courseHref, studentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { initials } from "@/lib/people";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * One fellow's whole record in one course, with the selected submission open beside it.
 *
 * **The grading queue's other axis, and deliberately the same screen.** The queue is one assignment
 * across many students; this is one student across many assignments. The row component and the
 * review surface are shared rather than reimplemented, so reading a student's work looks and
 * behaves exactly like grading it — because it is the same act, approached from the other side.
 *
 * What differs is small and each difference has a reason. There is no search box: filtering one
 * student by name is nothing. Every assignment gets a row, including ones they never started,
 * because "has not begun this" is a fact about a student that a list of only their submissions
 * cannot state. And the row's second line is the module rather than a relative time, since forty
 * rows all reading "3 days ago" order nothing.
 */

type Data = RouterOutputs["submissions"]["listForStudent"];
type Row = Data["rows"][number];

type Filter = "all" | "needs_review" | "graded" | "not_started";

export function StudentOverview({ data, now }: { data: Data; now: Date }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("submission");
  const grading = useGradingMode();

  const [filter, setFilter] = React.useState<Filter>("all");

  const started = data.rows.filter((row) => row.submission !== null);

  const needsReview = (row: Row) =>
    row.submission != null &&
    row.submission.bucket !== null &&
    row.submission.bucket !== "generating";

  const counts = {
    all: data.rows.length,
    needs_review: data.rows.filter(needsReview).length,
    graded: started.filter((row) => row.submission!.status === "GRADED").length,
    not_started: data.rows.filter((row) => row.submission === null).length,
  };

  /* Lifted only so a row can show a spinner while its report is being generated. */
  const [batch, setBatch] = React.useState<BatchState | null>(null);

  const filtered = data.rows.filter((row) => {
    if (filter === "needs_review") return needsReview(row);
    if (filter === "graded") return row.submission?.status === "GRADED";
    if (filter === "not_started") return row.submission === null;
    return true;
  });

  /*
    The selection survives a filter that no longer contains it, and falls back to the first row that
    *has* a submission rather than the first row — opening this screen on an assignment nobody has
    started would show an empty review pane and read as the page being broken.
  */
  const selected =
    started.find((row) => row.submission!.id === selectedId) ??
    filtered.find((row) => row.submission !== null) ??
    started[0] ??
    null;

  function select(submissionId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("submission", submissionId);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const name = displayNameOf(data.student, "Unknown student");

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
      <StudentHeader data={data} name={name} />

      {/*
        In grading mode the list is not narrowed, it is put away: what an instructor wanted from it
        is two buttons, and those are on the other side of the divider. Hidden rather than
        unmounted, so it comes back holding the search text, the tab and the scroll it was left
        with.
      */}
      <div
        className={cn("grid min-h-0 flex-1 grid-cols-1", !grading.on && "lg:grid-cols-[360px_1fr]")}
      >
        <aside
          className={cn(
            "flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0",
            grading.on && "hidden",
          )}
        >
          <div className="border-b border-border p-3">
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  { key: "all", label: `All`, count: counts.all },
                  { key: "needs_review", label: `To do`, count: counts.needs_review },
                  { key: "graded", label: `Graded`, count: counts.graded },
                  { key: "not_started", label: `Not started`, count: counts.not_started },
                ] as { key: Filter; label: string; count: number }[]
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key)}
                  className={cn(
                    "flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors",
                    filter === tab.key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  <br />({tab.count})
                </button>
              ))}
            </div>

            {/*
              Scoped to the filtered list, as on the grading queue, so the button acts on what is
              being looked at. Rows with no submission carry no bucket and are simply not
              candidates — a student cannot have a report generated for work they never started.
            */}
            <BatchGenerate
              className="mt-3"
              candidates={filtered.flatMap((row) =>
                row.submission
                  ? [
                      {
                        submissionId: row.submission.id,
                        label: row.assignment.title,
                        bucket: row.submission.bucket,
                      },
                    ]
                  : [],
              )}
              /*
                Off, unlike the queue. Each row here is a *different* assignment with its own
                rubric section and its own answer keys, so no two subjects share a system prompt
                and there is no cache for a first run to warm — holding one back would only make
                an already small batch slower.
              */
              warmFirst={false}
              onStateChange={setBatch}
            />

            <GradingModeButton onEnter={grading.enter} className="mt-3" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <Inbox className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">Nothing here</p>
                <p className="text-xs text-muted-foreground">
                  {counts.all === 0
                    ? "This course has no assignments yet."
                    : "No assignments match."}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((row) =>
                  row.submission ? (
                    <SubmissionRow
                      key={row.assignment.id}
                      row={row.submission}
                      primary={row.assignment.title}
                      /*
                        The module, and the project or assessment where there is one. Reading a
                        student's record down the page, a deliverable named on its own is missing
                        what explains it — that it is one part of a larger piece of work.
                      */
                      secondary={secondaryLine(row.assignment)}
                      active={selected?.assignment.id === row.assignment.id}
                      onSelect={() => select(row.submission!.id)}
                      now={now}
                      pending={batch?.inFlight.has(row.submission.id) ?? false}
                    />
                  ) : (
                    <NotStartedRow key={row.assignment.id} row={row} />
                  ),
                )}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
          {grading.on && (
            <GradingModeBar
              /*
                Only rows there is something to grade on. An assignment the student has not started
                has no submission, so it is not somewhere Next can go — the pane would have nothing
                to open.
              */
              submissions={filtered.flatMap((row) =>
                row.submission ? [{ id: row.submission.id, label: row.assignment.title }] : [],
              )}
              currentId={selected?.submission?.id ?? null}
              jumpLabel="Jump to an assignment"
              listLabel={
                filter === "needs_review"
                  ? "To do"
                  : filter === "graded"
                    ? "Graded"
                    : filter === "not_started"
                      ? "Not started"
                      : "All assignments"
              }
              onSelect={select}
              onExit={grading.exit}
            />
          )}

          {/*
            `min-h-0 flex-1` because the review pane sizes itself with `h-full` and scrolls inside.
            Without it the header above would push the approve button off the screen.
          */}
          <div className="min-h-0 flex-1">
            {selected?.submission ? (
              // Keyed on the submission so moving between assignments resets the editor rather
              // than carrying unsaved edits from one report onto another.
              <GradingReview
                key={selected.submission.id}
                submission={selected.submission}
                assignmentId={selected.assignment.id}
                assignmentTitle={selected.assignment.title}
                assignmentKind={selected.assignment.kind}
                // Per row here, where the queue reads it once for the page: every row on this
                // screen is a different assignment, and the threshold is what decides whether a
                // score passes.
                completionThreshold={selected.assignment.completionThreshold}
                now={now}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <Inbox className="size-10 text-muted-foreground" />
                <p className="text-base font-medium">Nothing handed in yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {name} has not started any of this course&apos;s assignments. Their work opens
                  here once there is some.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Who this is, and which course you are reading them in.
 *
 * The email and GitHub username are the point of the header rather than decoration: they are what
 * an instructor needs when a repository name does not match the person they expected, and there
 * was previously nowhere in the application to look them up.
 */
function StudentHeader({ data, name }: { data: Data; name: string }) {
  const router = useRouter();
  const removed = data.enrollmentStatus !== "ACTIVE";

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border bg-card px-4 py-3 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
          {initials(name)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-base font-semibold">{name}</h1>
            {removed && (
              <Badge variant="outline" className="gap-1 font-normal">
                <UserMinus className="size-3" />
                Removed from this program
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {data.student.email && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{data.student.email}</span>
              </span>
            )}
            {data.student.githubUsername ? (
              <a
                href={`https://github.com/${data.student.githubUsername}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <GitBranch className="size-3 shrink-0" />@{data.student.githubUsername}
              </a>
            ) : (
              // Worth saying rather than leaving blank: without a linked GitHub account this
              // student cannot accept a repository assignment at all, which is the explanation
              // for a row of "not started" that would otherwise look like avoidance.
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <GitBranch className="size-3 shrink-0" />
                No GitHub account linked
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          The course being read, switchable to another this fellow is in. Separate from the
          sidebar's course switcher, which knows nothing about this fellow and would offer courses
          they are not in — a student repeating a module has two records, and this is how you get
          from one to the other.
        */}
        {data.courses.length > 1 ? (
          <Select
            value={data.course.id}
            onValueChange={(id) => {
              if (id) router.push(studentHref(id, data.student.id));
            }}
            items={Object.fromEntries(
              data.courses.map((course) => [course.id, `${course.name} · ${course.term}`]),
            )}
          >
            <SelectTrigger size="sm" aria-label="Which course">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {data.courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{course.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {course.term}
                        {course.enrolledAs !== "ACTIVE" && " · removed"}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">
            {data.course.name} · {data.program.term}
          </span>
        )}

        <Link
          href={courseHref(data.course.id)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Course
        </Link>
      </div>
    </header>
  );
}

/**
 * An assignment this student has no submission for.
 *
 * Not selectable, because there is nothing to open. Present because its absence would be
 * indistinguishable from the assignment not existing — the count above says how many, and this is
 * which ones.
 */
function NotStartedRow({ row }: { row: Row }) {
  return (
    <li>
      <div className="flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2.5 opacity-60">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{row.assignment.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {secondaryLine(row.assignment)}
          </span>
        </div>
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {row.assignment.distributedAt === null ? "Not published" : "Not started"}
        </span>
      </div>
    </li>
  );
}

/**
 * What sits under an assignment's title in one student's record: the unit it belongs to, and what
 * kind of unit that is.
 *
 * The category is named only for a project or an assessment. A module is what most of a course is
 * made of, so saying so on every row would be a word repeated forty times to distinguish nothing;
 * the two that are *not* modules are exactly the rows where the word carries information —
 * reading a student's record down the page, a deliverable named on its own is missing what
 * explains it, that it is one part of a larger piece of work.
 *
 * Here rather than inline so the two rows this list draws — a submission and a not-started
 * assignment — cannot come to describe the same assignment differently.
 */
export function secondaryLine(assignment: {
  courseUnit: { name: string; category: CourseUnitCategory };
}): string {
  const { name, category } = assignment.courseUnit;
  if (category === "MODULE") return name;

  return `${name} · ${CATEGORY_META[category].noun}`;
}
