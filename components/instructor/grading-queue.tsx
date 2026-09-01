"use client";

import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Inbox, Search, UserMinus, Users } from "lucide-react";

import { BatchGenerate } from "@/components/instructor/batch-generate";
import {
  GradingModeBar,
  GradingModeButton,
  useGradingMode,
} from "@/components/instructor/grading-mode";
import { GradingReview } from "@/components/instructor/grading-review";
import { TaskReview } from "@/components/instructor/task-review";
import { CohortPicker } from "@/components/instructor/cohort-picker";
import { SubmissionRow } from "@/components/instructor/submission-row";
import type { BatchState } from "@/hooks/use-batch-generate";
import { studentHref } from "@/lib/links";
import type { CohortChoice } from "@/lib/programs/cohorts";
import { displayNameOf } from "@/lib/people";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Every submission for one assignment, with the selected one open beside the list.
 *
 * Two panes rather than a list that navigates: grading is done in a sitting, one student
 * after another, and losing the queue on every selection would make that a chore.
 * Selection lives in the query string so a particular review can be linked to — which is
 * how the triage screen sends you here.
 */

type Data = RouterOutputs["submissions"]["listForAssignment"];
type Row = Data["submissions"][number];

type Filter = "needs_review" | "graded" | "all";

export function GradingQueue({
  data,
  cohorts,
  completionThreshold,
  now,
}: {
  data: Data;
  /** The picker's options and the selection this queue was built for, from `resolveCohort`. */
  cohorts: CohortChoice;
  completionThreshold: number;
  now: Date;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("submission");
  const grading = useGradingMode();

  /*
    All, and it is the first tab as well as the opening one — a leftmost tab that is not the one
    selected reads as a control somebody has already touched.

    The queue opens on the whole assignment rather than on what is outstanding. Both are defensible
    and the difference is what the screen is for: "what do I do next" against "how is this cohort
    doing on this piece of work". The second is the one an instructor cannot get anywhere else,
    since To do is a click away and is also what triage already answers a cohort at a time.
  */
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");

  /*
    The batch's state, lifted here only so the rows can draw a spinner on what is in flight.

    This list is a prop from a server component, so nothing on it moves until the run finishes
    and refreshes. Without this, pressing Generate on twelve submissions would leave twelve rows
    looking untouched for several minutes.
  */
  const [batch, setBatch] = React.useState<BatchState | null>(null);

  /**
   * Whether this screen is a roster rather than a queue.
   *
   * A task is not graded and never waits on anybody, so "what is left to grade" is a question it
   * cannot answer. What its queue is for instead is "who has done this" — which makes every
   * fellow a row, including the ones with nothing on record.
   */
  const isTask = data.assignment.kind === "TASK";

  /*
    A student who has not opened a pull request is not in the queue. They have not done anything
    wrong and there is nothing to grade — the assignment's own page is where an instructor goes to
    see who has not started.

    **Unless they have said something.** A question asked before starting is a record an instructor
    will want to find again, and the assignment is the obvious place to look for it: without this
    the only route to it is the fellow's own record, which means already knowing who asked.

    **And unless this is a task**, where the filter is turned off entirely. A fellow who has not
    marked a task done is exactly the row an instructor came here for: the one to chase, or to mark
    done on their behalf. `notStarted` below carries the fellows who have no row at all, for the
    same reason.
  */
  const submissions = isTask
    ? data.submissions
    : data.submissions.filter(
        (row) =>
          (row.status !== "NOT_STARTED" && row.status !== "ACCEPTED") || row.commentCount > 0,
      );

  /*
    "Needs review" is the same question the triage screen asks, answered by the same
    field. A submission cannot be outstanding work on one screen and finished on the
    other.
  */
  const needsReview = (row: Row) => row.bucket !== null && row.bucket !== "generating";

  const counts = {
    needs_review: submissions.filter(needsReview).length,
    graded: submissions.filter((row) => row.status === "GRADED").length,
    all: submissions.length,
  };
  // Deliberately outside `needs_review`: a question is not work to grade, and `bucket` is null on
  // a row nobody has submitted. It counts under All, which is where the record is looked for.

  // Filtering a cohort's worth of rows is not work worth memoizing, and `submissions` is
  // a fresh array on every render anyway, so a memo here would recompute regardless.
  const term = query.trim().toLowerCase();
  const filtered = submissions
    .filter((row) => {
      if (filter === "needs_review") return needsReview(row);
      if (filter === "graded") return row.status === "GRADED";
      return true;
    })
    .filter(
      (row) =>
        !term ||
        (row.student.displayName ?? "").toLowerCase().includes(term) ||
        (row.student.githubUsername ?? "").toLowerCase().includes(term) ||
        (row.student.email ?? "").toLowerCase().includes(term),
    );

  /*
    The selection survives a filter that no longer contains it, so switching tabs does not
    quietly swap the student being read.

    `asideSubmissions` is searched too, and only here. It holds the work this queue never lists —
    a fellow who has left the program, a fellow outside the cohort currently selected, and one
    member's copy of their team's grade — and all three are things a link can legitimately name. The gradebook's Removed table links straight to
    one, and a colleague's link or a stale tab names the other. Falling through to `filtered[0]`
    for either would show a different student's report under a URL that named one, which is worse
    than an empty pane because nothing about it looks wrong.
  */
  /*
    Which fellow with no submission row is open, when one is.

    **A second selection parameter rather than a second meaning for the first.** `?submission=`
    names a row, and these fellows have none — there is nothing for it to hold. Naming the fellow
    instead keeps every existing link working and makes a link to one of these rows work too,
    which is the property this screen has always had.

    Read before `selected` below, and it is what makes the fallback there conditional: without
    that, opening a fellow with no row would land on whichever submission happened to be first and
    the pane would quietly show somebody else.

    Marking such a fellow done creates their row, and the refresh that follows moves them into
    `submissions` — at which point this names somebody no longer here, `selectedFellow` is null,
    and the fallback lands on a real row again.
  */
  const selectedFellowId = searchParams.get("fellow");
  const selectedFellow = data.notStarted.find((student) => student.id === selectedFellowId) ?? null;

  const selected =
    selectedFellow !== null
      ? null
      : (submissions.find((row) => row.id === selectedId) ??
        data.asideSubmissions.find((row) => row.id === selectedId) ??
        filtered[0] ??
        null);

  /** Why the open submission is not in the list beside it, or null when it is. */
  const asideReason =
    selected === null
      ? null
      : (data.asideSubmissions.find((row) => row.id === selected.id)?.asideReason ?? null);

  /*
    Fellows on the roster with no submission row at all. Empty for every kind but a task — see
    `notStarted` in `submissions.listForAssignment` for why only a task has them.

    Searched by the same term as the rows above, so one search box narrows one list. They are not
    counted in the tabs: the tabs count submissions, and these are the absence of one.
  */
  const notStarted = data.notStarted.filter(
    (student) =>
      !term ||
      (student.displayName ?? "").toLowerCase().includes(term) ||
      (student.githubUsername ?? "").toLowerCase().includes(term) ||
      (student.email ?? "").toLowerCase().includes(term),
  );

  function select(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("submission", id);
    params.delete("fellow");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  /** Opens a fellow who has no submission row. The mirror of `select` above. */
  function selectFellow(studentId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("fellow", studentId);
    params.delete("submission");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  /*
    No page heading. The shell's breadcrumb already reads "Triage · Grading · {title}"
    with Triage linked, so a heading here would repeat the assignment name and spend a
    fifth of the viewport doing it. This screen is worked down, not read — the list and
    the submission get the whole height.
  */
  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
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
          <div className="flex flex-col gap-3 border-b border-border p-3">
            {/*
              Above the search box and the tabs, because it decides what those two are searching
              and counting. The three tabs beneath it count the cohort, not the roster — which is
              why it cannot sit somewhere a reader might not have noticed it.
            */}
            <CohortPicker choice={cohorts} className="w-full" />
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search students…"
                className="pl-8"
              />
            </div>
            {/*
              The three tabs are three answers to "what is left to grade", which a task does not
              ask: `To do` is permanently zero because a task never enters a triage bucket, and
              `Graded` counts both verdicts together, so it would read as "done" over a fellow
              whose task came back. One view, unlabelled, is the honest shape for a roster.
            */}
            {!isTask && (
              <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                {(
                  [
                    { key: "all", label: `All`, count: counts.all },
                    {
                      key: "needs_review",
                      label: `To do`,
                      count: counts.needs_review,
                    },
                    { key: "graded", label: `Graded`, count: counts.graded },
                  ] as { key: Filter; label: string; count: number }[]
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
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
            )}

            {/*
              Scoped to what the list is currently showing rather than to the whole assignment,
              because that is what the instructor is looking at: a search narrowed to one student
              offers to generate that student's report, and the Graded tab offers nothing. A
              button above a list of twelve that quietly acted on forty would be worse than one
              that acted on nothing.
            */}
            {/*
              Absent for a task rather than disabled, the same rule the authoring form applies to
              the test runner: there is no report a task could ever have, so this is not a run with
              nothing to do, it is a question that does not apply. Left in, every row's null bucket
              would render it permanently greyed with a label explaining why.
            */}
            {!isTask && (
              <BatchGenerate
                candidates={filtered.map((row) => ({
                  submissionId: row.id,
                  label: displayNameOf(row.student, "Unknown student"),
                  bucket: row.bucket,
                }))}
                // One assignment, one rubric, one set of answer keys — so every subject shares a
                // system prompt and the first run warms the cache the rest read from.
                warmFirst
                onStateChange={setBatch}
              />
            )}

            <GradingModeButton onEnter={grading.enter} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filtered.length === 0 && notStarted.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <Inbox className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">Nothing here</p>
                <p className="text-xs text-muted-foreground">
                  {filter === "needs_review"
                    ? "Every submission for this assignment has been dealt with."
                    : "No submissions match."}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((row) => (
                  <SubmissionRow
                    key={row.id}
                    row={row}
                    /*
                      A team's row is headed by the team, because that is what the pile is a pile
                      of: one piece of work per team, not one per member. Who is on it is left to
                      the review header, so the line under the name goes on saying when the work
                      last moved — which is what this list is ordered by and what an instructor
                      reads it for.
                    */
                    primary={
                      row.team ? row.team.name : displayNameOf(row.student, "Unknown student")
                    }
                    active={selected?.id === row.id}
                    onSelect={() => select(row.id)}
                    now={now}
                    pending={batch?.inFlight.has(row.id) ?? false}
                  />
                ))}

                {/*
                  Fellows with nothing on record, after the rows that have something.

                  Their own row rather than a `SubmissionRow` fed a blank, because every line that
                  component draws — when the work last moved, whether it was late, what it scored —
                  is a fact about a submission, and these have none. What is worth saying about
                  them is their name and that nothing has happened, which is one line.

                  Below rather than interleaved: the list is ordered by what has happened, and
                  nothing having happened comes last. An instructor scanning for who to chase finds
                  them together at the bottom rather than scattered through the roster.
                */}
                {notStarted.map((student) => (
                  <li key={student.id}>
                    <button
                      type="button"
                      onClick={() => selectFellow(student.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors",
                        selectedFellow?.id === student.id ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="text-sm font-medium">
                        {displayNameOf(student, "Unknown student")}
                      </span>
                      <span className="text-xs text-muted-foreground">Not marked</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
          {grading.on && (
            <GradingModeBar
              /*
                Named the way the row beside it was named: a team's work is the team's, and
                heading it with whichever member claimed it would name somebody the work is not
                about.
              */
              submissions={filtered.map((row) => ({
                id: row.id,
                label: row.team ? row.team.name : displayNameOf(row.student, "Unknown student"),
              }))}
              currentId={selected?.id ?? null}
              jumpLabel="Jump to a student"
              listLabel={
                filter === "needs_review"
                  ? "To do"
                  : filter === "graded"
                    ? "Graded"
                    : "All students"
              }
              onSelect={select}
              onExit={grading.exit}
            />
          )}

          {/*
            Said before the work rather than left to be noticed. This submission is not in the
            list beside it, and an instructor who read a report and approved it without knowing
            the fellow had left the program would be grading somebody who is not there.

            The three reasons are told apart because they are different kinds of fact. Leaving
            the program is about the fellow; being outside the cohort currently selected is about
            the picker, which the sentence names so the fix is obvious; and being one member's
            copy of their team's work is about neither — there is nothing to fix, and what the
            instructor wants is a way to the row the work is actually on.
          */}
          {asideReason && selected && (
            <div className="flex shrink-0 items-start gap-2 border-b border-border bg-muted/60 px-4 py-2.5 text-sm">
              {asideReason === "removed" ? (
                <UserMinus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {selected.student.displayName ??
                    selected.student.githubUsername ??
                    selected.student.email ??
                    "This student"}
                </span>{" "}
                {asideReason === "removed" ? (
                  "has been removed from this program, so this is not in the queue beside it. Their work stays readable here and in the gradebook."
                ) : asideReason === "team_mirror" ? (
                  <>
                    has a copy of their team&apos;s grade here. The work, the report, and the rounds
                    of feedback are all on the team&apos;s own submission, which is where it is read
                    and released.{" "}
                    {selected.teamSubmissionId && (
                      /*
                        The link is the point of this case. An instructor arriving from a mirror's
                        gradebook cell would otherwise be parked in a pane with nothing to do and
                        no indication of where to go.
                      */
                      <button
                        type="button"
                        className="font-medium text-foreground underline underline-offset-4"
                        onClick={() => select(selected.teamSubmissionId!)}
                      >
                        Open the team&apos;s submission
                      </button>
                    )}
                  </>
                ) : (
                  "is not in the cohort you are filtered to, so this is not in the queue beside it. Switch to All fellows to work it alongside the rest."
                )}
              </p>
            </div>
          )}

          {/*
            `min-h-0 flex-1` because the review pane sizes itself with `h-full` and scrolls
            inside. Without it, the banner above would push the bottom of the pane — the approve
            button among it — off the screen.
          */}
          <div className="min-h-0 flex-1">
            {/*
              A task takes a different pane, and takes it in two situations rather than one: a
              fellow with a row, and a fellow with none. `GradingReview` is built around a
              submission — drafts, test runs, a diff, a score — so a task would be a branch
              suppressing nearly all of it, and the rowless fellow could not be passed to it at all.
            */}
            {isTask && selectedFellow ? (
              <TaskReview
                key={selectedFellow.id}
                assignmentId={data.assignment.id}
                student={selectedFellow}
                // Nothing on record, which is what having no row means.
                isComplete={null}
                markedAt={null}
                markedBy={null}
                studentHref={studentHref(data.assignment.courseId, selectedFellow.id)}
                now={now}
              />
            ) : isTask && selected ? (
              <TaskReview
                key={selected.id}
                assignmentId={data.assignment.id}
                student={selected.student}
                isComplete={selected.isComplete}
                markedAt={selected.gradedAt}
                markedBy={selected.gradedBy}
                studentHref={studentHref(data.assignment.courseId, selected.student.id)}
                now={now}
              />
            ) : selected ? (
              // Keyed on the submission so switching students resets the editor rather
              // than carrying one student's unsaved edits onto another's report.
              <GradingReview
                key={selected.id}
                submission={selected}
                assignmentId={data.assignment.id}
                assignmentTitle={data.assignment.title}
                // "What else has this person done" is the question a report prompts, and until
                // now there was nowhere in the application to answer it.
                studentHref={studentHref(data.assignment.courseId, selected.student.id)}
                // Read here rather than by the review pane, which would have to wait on its
                // own request to find out whether this assignment can have tests at all.
                assignmentKind={data.assignment.kind}
                completionThreshold={completionThreshold}
                now={now}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <Inbox className="size-10 text-muted-foreground" />
                <p className="text-base font-medium">Pick a student</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {isTask
                    ? "Whether they have done this, and the conversation about it, open here."
                    : "Their report, test results, and repository open here."}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
