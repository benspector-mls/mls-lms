"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ArrowLeft, GitBranch, Inbox, Mail, MessageSquare, UserMinus } from "lucide-react";

import { BatchGenerate } from "@/components/instructor/batch-generate";
import { StudentPicker } from "@/components/instructor/student-picker";
import {
  GradingModeBar,
  GradingModeButton,
  useGradingMode,
} from "@/components/instructor/grading-mode";
import { GradingReview } from "@/components/instructor/grading-review";
import { SubmissionRow } from "@/components/instructor/submission-row";
import { TaskReview } from "@/components/instructor/task-review";
import { taskIsSelfMarked } from "@/lib/assignments/spec";
import { Badge } from "@/components/ui/badge";
import { DraftStatusBadge, LatenessBadge, SubmissionStatusBadge } from "@/components/status-badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BatchState } from "@/hooks/use-batch-generate";
import { useReleaseGrade } from "@/hooks/use-release-grade";
import { CATEGORY_META, type CourseUnitCategory } from "@/lib/course-units";
import { courseHref, gradingQueueHref, programStudentHref, studentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { initials } from "@/lib/people";
import { draftStatusAddsSomething } from "@/lib/status";
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

  /*
    Whether the list is slid over the pane as a sheet — the list's only form below the `lg`
    breakpoint, and its grading-mode form above it, exactly as on the grading queue. Picking a row
    closes it, and so do Escape and the dimmed pane behind it.
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

  /*
    Releases run up here rather than in the review pane, which is keyed on the submission and can
    unmount while one is in flight. No advance on this screen — a fellow's record has nowhere to
    go next — so the release simply runs behind whatever is read next.
  */
  const releasing = useReleaseGrade({ reopen: (submissionId) => select(submissionId) });

  const filtered = data.rows.filter((row) => {
    if (filter === "needs_review") return needsReview(row);
    if (filter === "graded") return row.submission?.status === "GRADED";
    if (filter === "not_started") return row.submission === null;
    return true;
  });

  /*
    Which assignment with no submission row is open, when one is.

    **A second selection parameter rather than a second meaning for the first** — the decision the
    queue's `?fellow=` records, met from the other side: there the fixed thing is the assignment
    and the rowless thing is a fellow, here the fellow is fixed and the rowless thing is a task
    they have not started. `?submission=` names a row, and these have none.

    Resolved against any row by assignment id rather than only the rowless ones, because an act
    performed here creates the row — marking a task done, or agreeing an extension — and the
    refresh that follows should land back on the same assignment, now through its submission,
    rather than on the fallback.

    **Only a row the pane can draw.** A task opens with or without a submission, because "nobody
    has marked this" is exactly the row an instructor wants — the one to chase, or to mark done on
    the fellow's behalf. Every other kind needs one, so a hand-typed address naming work nobody has
    begun falls through to the fallback rather than opening a pane with nothing in it. Extensions
    are agreed from the assignment's own row in the curriculum, not from here.
  */
  const selectedAssignmentId = searchParams.get("assignment");
  const byAssignment = data.rows.find((row) => row.assignment.id === selectedAssignmentId);
  const selectedByAssignment =
    byAssignment && (byAssignment.assignment.kind === "TASK" || byAssignment.submission !== null)
      ? byAssignment
      : null;

  /*
    The selection survives a filter that no longer contains it, and falls back to the first row that
    *has* a submission rather than the first row — opening this screen on an assignment nobody has
    started would show an empty review pane and read as the page being broken.
  */
  const selected =
    started.find((row) => row.submission!.id === selectedId) ??
    selectedByAssignment ??
    filtered.find((row) => row.submission !== null) ??
    started[0] ??
    null;

  function select(submissionId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("submission", submissionId);
    params.delete("assignment");
    router.replace(`?${params.toString()}`, { scroll: false });
    // Picking a row is what the sheet was opened for, so picking one closes it.
    setListOpen(false);
  }

  /** Opens a task the fellow has not started. The mirror of `select` above. */
  function selectAssignment(assignmentId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("assignment", assignmentId);
    params.delete("submission");
    router.replace(`?${params.toString()}`, { scroll: false });
    setListOpen(false);
  }

  const name = displayNameOf(data.student, "Unknown student");

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
      <StudentHeader data={data} name={name} />

      {/*
        In grading mode the list is not narrowed, it is put away: what an instructor wanted from it
        is two buttons, and those are on the other side of the divider.

        One aside element in every layout, and only its presentation changes — docked as the left
        column in the wide two-pane layout, a fixed sheet slid in from the left everywhere else —
        for the reasons the grading queue's aside gives: the same element, so the tab and the
        scroll survive every change of form.
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
          <div className="border-b border-border p-3">
            {/*
              Above the tabs, because it names what they count. This aside otherwise carries no
              cohort filter of its own — one fellow's whole record is the unit this screen reads,
              and the picker is the way to a different one without a trip back to the roster.
            */}
            <StudentPicker
              courseId={data.course.id}
              studentId={data.student.id}
              studentName={name}
              className="mb-3"
            />
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

            {/* Only beside the docked list — see the grading queue's note on this button. */}
            <GradingModeButton
              onEnter={grading.enter}
              className={cn("mt-3", grading.on ? "hidden" : "max-lg:hidden")}
            />
          </div>

          {/*
            `relative` for the reason the grading queue's list carries it: the rows hold
            `sr-only` spans, which are absolutely positioned and would otherwise resolve against
            the shell and stretch the window past a long list instead of scrolling with it.
          */}
          <div className="relative min-h-0 flex-1 overflow-y-auto p-2">
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
                      dueAt={row.assignment.dueAt}
                      primary={row.assignment.title}
                      /*
                        The title leads to this assignment's own queue, which is the same work
                        read across the cohort instead of down one fellow — the question a title
                        prompts here is how everybody else did on it. The submission is carried
                        along so the queue opens on the piece of work being read rather than on
                        an empty pane: the pane holds still and the list beside it turns from
                        this fellow's assignments into this assignment's fellows.
                      */
                      primaryHref={gradingQueueHref(
                        data.course.id,
                        row.assignment.id,
                        row.submission.id,
                      )}
                      /*
                        The module, and the project or assessment where there is one. Reading a
                        student's record down the page, a deliverable named on its own is missing
                        what explains it — that it is one part of a larger piece of work.
                      */
                      secondary={secondaryLine(row.assignment)}
                      active={selected?.assignment.id === row.assignment.id}
                      onSelect={() => select(row.submission!.id)}
                      now={now}
                      pending={
                        (batch?.inFlight.has(row.submission.id) ?? false) ||
                        releasing.inFlight.has(row.submission.id)
                      }
                    />
                  ) : (
                    <NotStartedRow
                      key={row.assignment.id}
                      row={row}
                      // Nothing handed in, so the queue opens on no one in particular.
                      href={gradingQueueHref(data.course.id, row.assignment.id)}
                      active={selected?.assignment.id === row.assignment.id}
                      /*
                        Openable only as a task, where "nobody has touched this" is exactly the row
                        an instructor wants: the one to chase, or to mark done on their behalf.
                        Every other kind has nothing a pane could show until work exists.
                      */
                      onSelect={
                        row.assignment.kind === "TASK"
                          ? () => selectAssignment(row.assignment.id)
                          : undefined
                      }
                    />
                  ),
                )}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
          {/*
            Always rendered, shown by width, exactly as on the grading queue: below `lg` the bar
            is the layout's own header, and at `lg` and up it belongs to grading mode alone.
          */}
          <GradingModeBar
            className={grading.on ? undefined : "lg:hidden"}
            /*
                Only rows there is something to grade on. An assignment the student has not started
                has no submission, so it is not somewhere Next can go — the pane would have nothing
                to open.
              */
            submissions={filtered.flatMap((row) =>
              row.submission ? [{ id: row.submission.id, label: row.assignment.title }] : [],
            )}
            currentId={selected?.submission?.id ?? null}
            currentLabel={selected?.assignment.title ?? null}
            /*
                The same address the rows in the list carry, here because this mode put the list
                away and the bar is the only place the open assignment is named.
              */
            currentHref={
              selected
                ? gradingQueueHref(data.course.id, selected.assignment.id, selected.submission?.id)
                : undefined
            }
            // The pane below draws no header — the list this bar stands in for is what showed the
            // open assignment's state, so the state stands here beside the name.
            badges={
              selected?.submission ? (
                <span className="flex flex-wrap items-center gap-2">
                  <SubmissionStatusBadge status={selected.submission.status} />
                  <LatenessBadge
                    dueAt={selected.assignment.dueAt}
                    submission={selected.submission}
                  />
                  {/*
                      The draft's own state, on the same rule the hidden row applies: shown only
                      where it says something the submission's status does not. Writing a report
                      does not move the submission, so a draft waiting for approval is a fact
                      this bar would otherwise leave to a list that is no longer on the screen.
                    */}
                  {selected.submission.activeDraft &&
                    draftStatusAddsSomething(selected.submission.activeDraft.status) && (
                      <DraftStatusBadge status={selected.submission.activeDraft.status} />
                    )}
                  {/*
                      The conversation, said the way the hidden row says it: teal while somebody
                      is owed an answer, muted once nobody is. This mode put the list away, so the
                      bar is the one place left that can say a reply is owed — and the badge is an
                      anchor to the thread, the jump the old header's badge carried.
                    */}
                  {selected.submission.commentCount > 0 && (
                    <Badge
                      variant="outline"
                      render={<a href={`#comments-${data.student.id}`} />}
                      className={cn(
                        "gap-1 font-normal",
                        selected.submission.commentsAwaitReply
                          ? "border-teal-500/40 text-teal-700 dark:text-teal-300"
                          : "text-muted-foreground",
                      )}
                    >
                      <MessageSquare className="size-3" />
                      <span className="tabular-nums">{selected.submission.commentCount}</span>
                      <span className="sr-only">
                        {selected.submission.commentsAwaitReply
                          ? " comments, waiting on a reply"
                          : " comments"}
                      </span>
                    </Badge>
                  )}
                </span>
              ) : null
            }
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
            onOpenList={() => setListOpen(true)}
            onExit={grading.exit}
          />

          {/*
            `min-h-0 flex-1` because the review pane sizes itself with `h-full` and scrolls inside.
            Without it the header above would push the approve button off the screen.
          */}
          <div className="min-h-0 flex-1">
            {/*
              A task takes the pane built for one, exactly as the grading queue decides it: a task
              has no report, no test runs and no score, so `GradingReview` would offer to generate
              a report about work that can never have one. It opens with or without a submission
              row — a task nobody has marked has none, and nothing on record is what the pane's
              nulls say. Whether the fellow could have marked it themselves comes off the row's own
              assignment, because every row on this screen is a different assignment.
            */}
            {selected?.assignment.kind === "TASK" ? (
              <TaskReview
                key={selected.submission?.id ?? selected.assignment.id}
                assignmentId={selected.assignment.id}
                student={data.student}
                isComplete={selected.submission?.isComplete ?? null}
                markedAt={selected.submission?.gradedAt ?? null}
                markedBy={selected.submission?.gradedBy ?? null}
                selfMarked={taskIsSelfMarked(selected.assignment)}
                now={now}
              />
            ) : selected?.submission && selected.submission.status !== "NOT_STARTED" ? (
              /*
                Keyed on the submission so moving between assignments resets the editor rather
                than carrying unsaved edits from one report onto another.

                **A row that says `NOT_STARTED` is not work to review**, and the pane says so
                below instead. Such a row exists because something *else* created it — a question
                asked in the comments, or an extension agreed before the fellow began — and
                reviewing it would offer to generate a report about nothing. `ACCEPTED` is
                deliberately on this side of the line: a repository has been generated, and the
                link to it is exactly what an instructor opens the pane for.
              */
              <GradingReview
                key={selected.submission.id}
                submission={selected.submission}
                assignmentId={selected.assignment.id}
                assignmentDueAt={selected.assignment.dueAt}
                assignmentKind={selected.assignment.kind}
                // Per row here, where the queue reads it once for the page: every row on this
                // screen is a different assignment, and the threshold is what decides whether a
                // score passes.
                completionThreshold={selected.assignment.completionThreshold}
                now={now}
                release={releasing.release}
                releasing={releasing.inFlight.has(selected.submission.id)}
              />
            ) : (
              /*
                Two situations, and they used to share one sentence. With every assignment now
                openable, "nothing here" can mean the fellow has started nothing in the whole
                course *or* that this one assignment is untouched — and the second is a row an
                instructor deliberately opened, so a message about the course would read as the
                screen having lost their selection.

                The strip above is the rest of the answer: an extension can be agreed from here,
                which is the reason an unstarted assignment opens at all.
              */
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <Inbox className="size-10 text-muted-foreground" />
                <p className="text-base font-medium">Nothing handed in yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {selected === null ? (
                    <>
                      {name} has not started any of this course&apos;s assignments. Their work opens
                      here once there is some.
                    </>
                  ) : (
                    <>
                      {name} has handed nothing in for {selected.assignment.title}. Their work opens
                      here once there is some.
                    </>
                  )}
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
 *
 * The name leads out of the course to the fellow's record on the program's roster, which is the
 * screen about the person rather than about their work: their attendance, their cohort, their
 * coaching history, and a line per course. This screen answers "how are they doing in this
 * course"; that one answers "how are they doing", and the name is the way between the two.
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
            <h1 className="truncate text-base font-semibold">
              <Link
                href={programStudentHref(data.program.id, data.student.id)}
                className="hover:underline"
              >
                {name}
              </Link>
            </h1>
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
 * Present because its absence would be indistinguishable from the assignment not existing — the
 * count above says how many, and this is which ones. Selectable only where the caller passes
 * `onSelect`, which it does for a task: a task with nothing on record is exactly the row an
 * instructor came for, where every other kind has nothing a pane could show. "Not marked" rather
 * than "Not started" on those, in the words the queue's rowless rows use — nothing has been said
 * about the task, which is not the same claim as the fellow not having begun it.
 */
function NotStartedRow({
  row,
  href,
  active = false,
  onSelect,
}: {
  row: Row;
  /** This assignment's queue, which the title leads to as it does on every row above. */
  href: string;
  active?: boolean;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">
          <Link href={href} className="pointer-events-auto hover:underline">
            {row.assignment.title}
          </Link>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {secondaryLine(row.assignment)}
        </span>
      </div>
      {/*
        No "Not published" among these. The record holds released work only, so every row here is
        work the fellow has actually been given and has not begun.
      */}
      <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
        {row.assignment.kind === "TASK" ? "Not marked" : "Not started"}
      </span>
    </>
  );

  return (
    <li className="group relative">
      {/*
        Where the row can be opened at all, the selecting button is a layer behind the content
        rather than wrapped around it — the arrangement `SubmissionRow` uses, and for the same
        reason: a link inside a button is not valid HTML. The content above it is transparent to
        the pointer, so only the title takes its own clicks.
      */}
      {onSelect && (
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Open ${row.assignment.title}`}
          className={cn(
            "absolute inset-0 rounded-md transition-colors",
            active ? "bg-muted" : "hover:bg-muted/60",
          )}
        />
      )}
      <div
        className={cn(
          "relative flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2.5 text-left transition-opacity",
          onSelect && "pointer-events-none",
          active ? undefined : onSelect ? "opacity-60 group-hover:opacity-100" : "opacity-60",
        )}
      >
        {body}
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
