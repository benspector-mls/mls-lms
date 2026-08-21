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
import { GroupPicker } from "@/components/instructor/group-picker";
import { SubmissionRow } from "@/components/instructor/submission-row";
import type { BatchState } from "@/hooks/use-batch-generate";
import { studentHref } from "@/lib/links";
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
  courseId,
  groups,
  completionThreshold,
  now,
}: {
  data: Data;
  /** For the picker, which records a selection against a course rather than an assignment. */
  courseId: string;
  /** The picker's options and the selection this queue was built for, from `resolveGroup`. */
  groups: {
    group: string;
    groups: { id: string; name: string; memberCount: number }[];
    ungroupedCount: number;
  };
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

  /*
    A student who has not opened a pull request is not in the queue. They have not done
    anything wrong and there is nothing to grade — the assignment's own page is where an
    instructor goes to see who has not started.
  */
  const submissions = data.submissions.filter(
    (row) => row.status !== "NOT_STARTED" && row.status !== "ACCEPTED",
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
    a student who has left the cohort, a student outside the group currently selected, and one
    member's copy of their team's grade — and all three are things a link can legitimately name. The gradebook's Removed table links straight to
    one, and a colleague's link or a stale tab names the other. Falling through to `filtered[0]`
    for either would show a different student's report under a URL that named one, which is worse
    than an empty pane because nothing about it looks wrong.
  */
  const selected =
    submissions.find((row) => row.id === selectedId) ??
    data.asideSubmissions.find((row) => row.id === selectedId) ??
    filtered[0] ??
    null;

  /** Why the open submission is not in the list beside it, or null when it is. */
  const asideReason =
    selected === null
      ? null
      : (data.asideSubmissions.find((row) => row.id === selected.id)?.asideReason ?? null);

  function select(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("submission", id);
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
              and counting. The three tabs beneath it count the group, not the cohort — which is
              why it cannot sit somewhere a reader might not have noticed it.
            */}
            <GroupPicker
              courseId={courseId}
              value={groups.group}
              groups={groups.groups}
              ungroupedCount={groups.ungroupedCount}
              className="w-full"
            />
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search students…"
                className="pl-8"
              />
            </div>
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

            {/*
              Scoped to what the list is currently showing rather than to the whole assignment,
              because that is what the instructor is looking at: a search narrowed to one student
              offers to generate that student's report, and the Graded tab offers nothing. A
              button above a list of twelve that quietly acted on forty would be worse than one
              that acted on nothing.
            */}
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

            <GradingModeButton onEnter={grading.enter} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filtered.length === 0 ? (
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
            the student had left the cohort would be grading somebody who is not there.

            The three reasons are told apart because they are different kinds of fact. Leaving
            the cohort is about the student; being outside the group currently selected is about
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
                  "has been removed from this cohort, so this is not in the queue beside it. Their work stays readable here and in the gradebook."
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
                  "is not in the group you are filtered to, so this is not in the queue beside it. Switch to All students to work it alongside the rest."
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
            {selected ? (
              // Keyed on the submission so switching students resets the editor rather
              // than carrying one student's unsaved edits onto another's report.
              <GradingReview
                key={selected.id}
                submission={selected}
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
                  Their report, test results, and repository open here.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
