"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Inbox, MessageSquare, UserMinus, Users } from "lucide-react";

import { AssignmentPicker } from "@/components/instructor/assignment-picker";
import { BatchGenerate } from "@/components/instructor/batch-generate";
import {
  GradingModeBar,
  GradingModeButton,
  useGradingMode,
} from "@/components/instructor/grading-mode";
import { GradingReview } from "@/components/instructor/grading-review";
import { TaskReview } from "@/components/instructor/task-review";
import { taskIsSelfMarked } from "@/lib/assignments/spec";
import { CohortPicker } from "@/components/instructor/cohort-picker";
import { SubmissionRow } from "@/components/instructor/submission-row";
import { DraftStatusBadge, LatenessBadge, SubmissionStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import type { BatchState } from "@/hooks/use-batch-generate";
import { useReleaseGrade } from "@/hooks/use-release-grade";
import { studentHref } from "@/lib/links";
import type { CohortChoice } from "@/lib/programs/cohorts";
import { displayNameOf } from "@/lib/people";
import { draftStatusAddsSomething } from "@/lib/status";
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
    Whether the list is slid over the pane as a sheet. The sheet is the list's only form below the
    `lg` breakpoint and its grading-mode form above it; picking a row closes it, and so do Escape
    and the dimmed pane behind it. While the docked two-pane layout is on screen this is inert —
    the aside ignores it there by media query rather than by mount, so the tab and the scroll
    survive every change of form.
  */
  const [listOpen, setListOpen] = React.useState(false);
  React.useEffect(() => {
    if (!listOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setListOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [listOpen]);

  /*
    All, and it is the first tab as well as the opening one — a leftmost tab that is not the one
    selected reads as a control somebody has already touched.

    The queue opens on the whole assignment rather than on what is outstanding. Both are defensible
    and the difference is what the screen is for: "what do I do next" against "how is this cohort
    doing on this piece of work". The second is the one an instructor cannot get anywhere else,
    since To do is a click away and is also what triage already answers a cohort at a time.

    A tab picked once holds for the sitting: it is kept in sessionStorage per assignment, and read
    back in an effect rather than in the initializer because this component is rendered on the
    server first, where "all" is the only answer — an initializer reading storage would hydrate
    against different markup. Not in the URL, deliberately: a colleague's link to a submission
    should not impose the sender's tab, and the sidebar's links carry no parameters anyway.
  */
  const tabStorageKey = `grading-tab:${data.assignment.id}`;
  const [filter, setFilterState] = React.useState<Filter>("all");
  React.useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(tabStorageKey);
      if (stored === "all" || stored === "needs_review" || stored === "graded") {
        setFilterState(stored);
      }
    } catch {
      // Storage can be unavailable (private windows, blocked site data); the default stands.
    }
  }, [tabStorageKey]);
  function setFilter(next: Filter) {
    setFilterState(next);
    try {
      window.sessionStorage.setItem(tabStorageKey, next);
    } catch {
      // Remembering the tab is a convenience; failing to is not worth interrupting anything.
    }
  }

  /*
    The batch's state, lifted here only so the rows can draw a spinner on what is in flight.

    This list is a prop from a server component, so nothing on it moves until the run finishes
    and refreshes. Without this, pressing Generate on twelve submissions would leave twelve rows
    looking untouched for several minutes.
  */
  const [batch, setBatch] = React.useState<BatchState | null>(null);

  /*
    Releases run up here rather than in the review pane, because the pane is keyed on the
    submission and unmounts the moment the selection advances — which is the first thing a release
    now does. The failure toasts' "Open" action routes back through the same `select` every row
    uses.
  */
  const releasing = useReleaseGrade({ reopen: (submissionId) => select(submissionId) });

  /**
   * Whether this screen is a roster rather than a queue.
   *
   * A task is not graded and never waits on anybody, so "what is left to grade" is a question it
   * cannot answer. What its queue is for instead is "who has done this" — which makes every
   * fellow a row, including the ones with nothing on record.
   */
  const isTask = data.assignment.kind === "TASK";

  /*
    Whether fellows may mark this task themselves. Read once for the page, like `isTask` beside it,
    because it is a property of the assignment rather than of a row — and passed to the pane so it
    can say what an unmarked task means, which differs by the answer.
  */
  const selfMarked = taskIsSelfMarked(data.assignment);

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
  const filtered = submissions.filter((row) => {
    if (filter === "needs_review") return needsReview(row);
    if (filter === "graded") return row.status === "GRADED";
    return true;
  });

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

    Not counted in the tabs: the tabs count submissions, and these are the absence of one.
  */
  const notStarted = data.notStarted;

  function select(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("submission", id);
    params.delete("fellow");
    router.replace(`?${params.toString()}`, { scroll: false });
    // Picking a row is what the sheet was opened for, so picking one closes it.
    setListOpen(false);
  }

  /*
    The moment a release is asked for, the selection moves to the next student still waiting —
    computed here, before any request has gone out, which is what makes it reliable: `filtered`
    still contains the approved row, so its index says where "next" is, and the URL names the next
    student before the server refresh lands, so the refresh finds the selection already pointing
    at a row it still lists and never falls through to `filtered[0]`.

    On any tab, not only To do: the next row *still needing review* is searched forward from the
    released one and then backward, so on All the graded rows in between are stepped over. With
    nothing left to grade the selection stays put and the pane shows the released report.
  */
  function advanceAfterApproval() {
    const at = filtered.findIndex((row) => row.id === selected?.id);
    if (at === -1) return;
    const next =
      filtered.slice(at + 1).find(needsReview) ?? filtered.slice(0, at).reverse().find(needsReview);
    if (next) select(next.id);
  }

  /** Opens a fellow who has no submission row. The mirror of `select` above. */
  function selectFellow(studentId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("fellow", studentId);
    params.delete("submission");
    router.replace(`?${params.toString()}`, { scroll: false });
    setListOpen(false);
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
        is two buttons, and those are on the other side of the divider.

        One aside element in every layout, and only its presentation changes: docked as the left
        column while the wide two-pane layout is on (`lg:static` overrides every sheet class), and
        a fixed sheet slid in from the left everywhere else — below `lg`, and in grading mode at
        any width. The same element rather than two, so the tab and the scroll survive entering
        the mode or narrowing the window; and off-screen rather than unmounted,
        for the same reason.
      */}
      <div
        className={cn("grid min-h-0 flex-1 grid-cols-1", !grading.on && "lg:grid-cols-[360px_1fr]")}
      >
        {listOpen && (
          <div
            aria-hidden
            onClick={() => setListOpen(false)}
            className={cn("fixed inset-0 z-40 bg-black/40", !grading.on && "lg:hidden")}
          />
        )}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex min-h-0 w-[85vw] max-w-80 flex-col border-r border-border bg-background shadow-lg transition-transform duration-300 motion-reduce:transition-none",
            listOpen ? "translate-x-0" : "-translate-x-full",
            !grading.on &&
              "lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:shadow-none lg:transition-none",
          )}
        >
          <div className="flex flex-col gap-3 border-b border-border p-3">
            {/*
              Above the assignment picker and the tabs, because it decides what those two are
              counting. The three tabs beneath it count the cohort, not the roster — which is why
              it cannot sit somewhere a reader might not have noticed it.
            */}
            <CohortPicker choice={cohorts} className="w-full" />
            <AssignmentPicker
              courseId={data.assignment.courseId}
              assignmentId={data.assignment.id}
              assignmentTitle={data.assignment.title}
            />
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
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>
            )}

            {/*
              Scoped to what the list is currently showing rather than to the whole assignment,
              because that is what the instructor is looking at: the Graded tab offers nothing to
              generate. A button above a list of twelve that quietly acted on forty would be worse
              than one that acted on nothing.
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

            {/*
              Only beside the docked list. Below `lg` this layout already is grading mode, and in
              the mode itself the button would re-enter it — collapsing a sidebar that is already
              collapsed and forgetting how it was found.
            */}
            <GradingModeButton
              onEnter={grading.enter}
              className={grading.on ? "hidden" : "max-lg:hidden"}
            />
          </div>

          {/*
            `relative` for the reason the review pane's scrollers carry it: the rows hold
            `sr-only` spans, which are absolutely positioned and would otherwise resolve against
            the shell and stretch the window past a long roster instead of scrolling with it.
          */}
          <div className="relative min-h-0 flex-1 overflow-y-auto p-2">
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
                    dueAt={data.assignment.dueAt}
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
                    /*
                      The name leads to the fellow's record in this course, which answers the
                      question a name in a queue prompts: what else has this person handed in,
                      and how did it go. A team's row is headed by the team, and a team has no
                      record of its own — sending it to whichever member claimed the work would
                      name somebody the work is not about — so that row's heading stays plain
                      text and the members are linked from the review pane instead.
                    */
                    primaryHref={
                      row.team ? undefined : studentHref(data.assignment.courseId, row.student.id)
                    }
                    active={selected?.id === row.id}
                    onSelect={() => select(row.id)}
                    now={now}
                    pending={
                      (batch?.inFlight.has(row.id) ?? false) || releasing.inFlight.has(row.id)
                    }
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
                  <li key={student.id} className="relative">
                    {/*
                      Selecting behind, the name linking above — the arrangement `SubmissionRow`
                      uses, and for the same reason: a link inside a button is not valid HTML.
                      A fellow with nothing on record is the one most worth reading up on, so
                      their name leads to their record here as it does on every row above.
                    */}
                    <button
                      type="button"
                      onClick={() => selectFellow(student.id)}
                      aria-label={`Open ${displayNameOf(student, "Unknown student")}`}
                      className={cn(
                        "absolute inset-0 rounded-md transition-colors",
                        selectedFellow?.id === student.id ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    />
                    <div className="pointer-events-none relative flex flex-col items-start gap-0.5 px-3 py-2 text-left">
                      <span className="text-sm font-medium">
                        <Link
                          href={studentHref(data.assignment.courseId, student.id)}
                          className="pointer-events-auto hover:underline"
                        >
                          {displayNameOf(student, "Unknown student")}
                        </Link>
                      </span>
                      <span className="text-xs text-muted-foreground">Not marked</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
          {/*
            Always rendered, shown by width: below `lg` the bar is the layout's own header, and at
            `lg` and up it belongs to grading mode alone — the docked list holds everything it
            says.
          */}
          <GradingModeBar
            className={grading.on ? undefined : "lg:hidden"}
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
            currentLabel={
              selected
                ? selected.team
                  ? selected.team.name
                  : displayNameOf(selected.student, "Unknown student")
                : selectedFellow
                  ? displayNameOf(selectedFellow, "Unknown student")
                  : null
            }
            /*
                The same record the rows in the list link to, which is why it is here at all: in
                this mode the list is put away, so the bar carries the only name on the screen and
                has to carry the way to that name's record with it. A team name leads nowhere, as
                in the list.
              */
            currentHref={
              selected
                ? selected.team
                  ? undefined
                  : studentHref(data.assignment.courseId, selected.student.id)
                : selectedFellow
                  ? studentHref(data.assignment.courseId, selectedFellow.id)
                  : undefined
            }
            /*
                The pane below draws no header — the list this bar stands in for is what named the
                open student's state, so the state stands here instead, beside the name. A task's
                pane names its own state (done, or not), so only graded work sends badges up.
              */
            badges={
              selected && !isTask ? (
                <span className="flex flex-wrap items-center gap-2">
                  <SubmissionStatusBadge status={selected.status} />
                  <LatenessBadge dueAt={data.assignment.dueAt} submission={selected} />
                  {/*
                      The draft's own state, on the same rule the hidden row applies: shown only
                      where it says something the submission's status does not. Writing a report
                      does not move the submission, so a draft waiting for approval is a fact
                      this bar would otherwise leave to a list that is no longer on the screen.
                    */}
                  {selected.activeDraft &&
                    draftStatusAddsSomething(selected.activeDraft.status) && (
                      <DraftStatusBadge status={selected.activeDraft.status} />
                    )}
                  {/*
                      The conversation, said the way the hidden row says it: teal while somebody
                      is owed an answer, muted once nobody is. This mode put the list away, so the
                      bar is the one place left that can say a reply is owed — and the badge is an
                      anchor to the thread, the jump the old header's badge carried.
                    */}
                  {selected.commentCount > 0 && (
                    <Badge
                      variant="outline"
                      render={<a href={`#comments-${selected.student.id}`} />}
                      className={cn(
                        "gap-1 font-normal",
                        selected.commentsAwaitReply
                          ? "border-teal-500/40 text-teal-700 dark:text-teal-300"
                          : "text-muted-foreground",
                      )}
                    >
                      <MessageSquare className="size-3" />
                      <span className="tabular-nums">{selected.commentCount}</span>
                      <span className="sr-only">
                        {selected.commentsAwaitReply
                          ? " comments, waiting on a reply"
                          : " comments"}
                      </span>
                    </Badge>
                  )}
                </span>
              ) : null
            }
            listLabel={
              filter === "needs_review" ? "To do" : filter === "graded" ? "Graded" : "All students"
            }
            onSelect={select}
            onOpenList={() => setListOpen(true)}
            onExit={grading.exit}
          />

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
                selfMarked={selfMarked}
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
                selfMarked={selfMarked}
                now={now}
              />
            ) : selected ? (
              // Keyed on the submission so switching students resets the editor rather
              // than carrying one student's unsaved edits onto another's report.
              <GradingReview
                key={selected.id}
                submission={selected}
                assignmentId={data.assignment.id}
                assignmentDueAt={data.assignment.dueAt}
                // Links each member of a team's line to their own record — "what else has this
                // person done" is the question a report prompts about a member.
                studentHref={studentHref(data.assignment.courseId, selected.student.id)}
                // Read here rather than by the review pane, which would have to wait on its
                // own request to find out whether this assignment can have tests at all.
                assignmentKind={data.assignment.kind}
                completionThreshold={completionThreshold}
                now={now}
                onApproved={advanceAfterApproval}
                release={releasing.release}
                releasing={releasing.inFlight.has(selected.id)}
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
