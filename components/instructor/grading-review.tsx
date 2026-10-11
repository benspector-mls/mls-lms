"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  FolderGit2,
  GitPullRequest,
  FileText,
  History,
  Loader2,
  MessagesSquare,
  PenLine,
  RotateCcw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useServerMutation } from "@/hooks/use-server-mutation";
import type { ReleaseGrade } from "@/hooks/use-release-grade";
import { SubmittedDocumentRow } from "@/components/submitted-document";
import { UploadedFileRow } from "@/components/uploaded-file";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";
import { lateness } from "@/lib/submissions/hand-in";
import { useTRPC } from "@/trpc/client";
import { CommentsCard } from "@/components/instructor/review/comments-card";
import { DraftBody } from "@/components/instructor/review/draft-body";
import { DraftHistory } from "@/components/instructor/review/draft-history";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DraftList, QueueSubmission, StateCard } from "@/components/instructor/review/shared";
import { DiffPanel, TestEvidence } from "@/components/instructor/review/work-panels";
import { displayNameOf } from "@/lib/people";
export function GradingReview({
  submission,
  assignmentId,
  assignmentDueAt,
  assignmentKind,
  completionThreshold,
  studentHref,
  now,
  onApproved,
  release,
  releasing,
  split,
}: {
  submission: QueueSubmission;
  /**
   * The assignment this work is for.
   *
   * Passed in rather than read off the submission, because both callers already hold the
   * assignment — the queue reads it once for the page, and the fellow's record has one per row —
   * and the conversation is keyed on the assignment rather than on the submission, so that a
   * question can be asked before there is a submission at all.
   */
  assignmentId: string;
  /**
   * The deadline the class was given, which is what a hand-in is measured against.
   *
   * From the assignment rather than the submission, because lateness is computed when somebody
   * looks rather than frozen when the work arrived — so the row alone cannot answer it.
   */
  assignmentDueAt: Date | null;
  /**
   * Decides whether a test suite is even a possibility for this assignment. Typed from the
   * enum rather than spelled out, so a kind added later is a compile error in the places that
   * have to decide about it rather than a union two files disagree about.
   */
  assignmentKind: AssignmentKind;
  completionThreshold: number;
  /**
   * Where this student's own record lives, if there is somewhere to go.
   *
   * It links each member of a team's line to their record — "what else has this person done" is
   * the question a report prompts about a member. Absent on the student overview, because that
   * *is* their record, and a link to the page you are on is a dead control.
   */
  studentHref?: string;
  now: Date;
  /**
   * Called at the moment a release is asked for — before the request, not after it — so the
   * screen around this one can move on while the release runs in the background. The grading
   * queue uses it to open the next student still waiting; the fellow's own record has nowhere to
   * go next and leaves it out. A release that then fails says so in a toast carrying a way back.
   */
  onApproved?: () => void;
  /** Runs the release in the background — owned by the screen, because this pane unmounts when the queue moves on. */
  release: ReleaseGrade;
  /** True while this submission's release is in flight. */
  releasing: boolean;
  /**
   * True in grading mode, where the work has its own column beside the report. Elsewhere the pane
   * is one column and the work is its first tab.
   *
   * The screen sets this rather than the pane measuring its own width, so the layout changes only
   * when the instructor enters or leaves grading mode, never because the window was resized.
   */
  split: boolean;
}) {
  const trpc = useTRPC();

  /*
    Test evidence exists only where a template repository does. The suite comes from the
    template and runs against a checkout of the student's repository, so a Drive file or an
    uploaded file has nothing to execute — not "no tests configured", which is a real state
    an assignment can be in and worth reporting, but no such thing as tests. The card is
    absent rather than empty, and the query is not made.
  */
  const canHaveTests = assignmentKind === "REPO";

  /*
    A diff exists only where a pull request does, and `prNumber` says so without a request.

    Deciding it from a column rather than from the query is what keeps the pane still: a second
    column that appeared when a fetch came back would move the grade sideways under somebody
    part-way through writing in it. It also means the panel below is never asked about a
    submission that has no pull request, which is why the procedure treats that as a precondition
    rather than as a state to draw.

    A separate constant from `canHaveTests` rather than a shared one, because they answer
    different questions that happen to agree about the assignment kind: a suite needs the
    *template* repository it comes from, and a diff needs only the student's own pull request.
  */
  const diffAside = canHaveTests && submission.prNumber !== null;

  // The conversation about this work, read in the parent so the card below can be handed its
  // loading and error states along with the thread.
  const comments = useQuery(
    trpc.submissionComments.thread.queryOptions({
      assignmentId,
      studentId: submission.student.id,
    }),
  );

  const drafts = useQuery(
    trpc.gradingDrafts.listForSubmission.queryOptions({ submissionId: submission.id }),
  );
  const testRuns = useQuery({
    ...trpc.testRuns.listForSubmission.queryOptions({ submissionId: submission.id }),
    enabled: canHaveTests,
  });
  const diff = useQuery({
    ...trpc.pullRequests.diffForSubmission.queryOptions({ submissionId: submission.id }),
    enabled: diffAside,
  });

  /*
    The width the instructor dragged the grade column to, read from storage rather than held in
    state. Every caller keys this pane on the submission, so it is built afresh for each student,
    and a width held in state would return to the default on every one of them.
  */
  const gradeColumn = React.useRef<HTMLDivElement>(null);
  const gradeWidth = useStoredGradeWidth();

  if (drafts.isPending) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (drafts.error) {
    return (
      <div className="p-5">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Could not load this submission</AlertTitle>
          <AlertDescription>{drafts.error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = drafts.data;

  /*
    The newest round that has not been discarded, and null when every one has.

    A discarded round was never sent to anybody, so it is not a state to show or act on — that is
    the whole meaning of `SUPERSEDED`. Reading one as current did two wrong things: it hid a
    released grade behind a report its instructor had just rejected, and on work that had never
    been graded it left the screen with no way forward at all, because the released view offers no
    action on a round it thinks was discarded. Null is the honest answer in that second case, and
    it is the one the rest of this screen already knows how to render: no current round, so offer
    to start one.
  */
  const draft = data.drafts.find((entry) => entry.status !== "SUPERSEDED") ?? null;

  /*
    Rounds worth listing under the grade: released, and not the round on screen. A discarded
    round was never sent to anybody, so it is not previous feedback; the current round is on the
    card above, so listing it here would call the thing being read "previous". The list shows
    while a resubmission's round is still being written, because that is when the instructor
    checks the new work against what the student was told last time.
  */
  const previous = data.drafts.filter(
    (entry) => entry.status === "APPROVED" && entry.id !== draft?.id,
  );

  // The run that describes the code currently on the pull request. An older run is not
  // evidence about this commit, so it is not offered as if it were.
  const currentRun = testRuns.data?.runs.find((run) => run.headSha === submission.headSha) ?? null;

  /*
    Shown only where a suite is actually configured. `canHaveTests` asks about the kind and not
    about the assignment, so a repository with `runnerPreset: "none"` would otherwise carry a
    permanent card saying it has no tests. `isPending` keeps the slot while the answer is on its
    way, so the column does not jump once it arrives.
  */
  const testEvidence =
    canHaveTests && (testRuns.isPending || testRuns.data?.runnerPreset !== "none") ? (
      <TestEvidence
        submissionId={submission.id}
        runs={testRuns.data}
        currentRun={currentRun}
        loading={testRuns.isPending}
        now={now}
      />
    ) : null;

  /*
    Everything the student attached, newest first.

    Reading it is what an instructor came to this screen to do, and every card below is about it —
    so on a graded submission the work is above, or beside, the grade it was given.

    Outside the grading form rather than inside it, because the form is replaced by the editor the
    moment a round is opened and the work is most needed while the feedback is being written.

    **Newest first, because a second attachment is almost always a resubmission.** A fellow asked
    to fix something attaches the corrected document beside the one they were told to fix, and the
    grade is about the one that arrived last — so it leads the column and it is the one that
    opens. Each card says when it was added, which is the only thing that tells two drafts of the
    same document apart.

    The number in the label counts the other way, from when the work was attached: the card at the
    top of a resubmission reads "Attachment 2 of 2". Position says what to read first and the
    number says what it is, and a fellow's own page — which lists their attachments in the order
    they made them — numbers the same document the same way.

    **Only the first opens by itself.** Ten auto-opened previews would mint ten signed URLs for
    documents nobody has scrolled to; the rest carry their own "Show" trigger. With one attachment
    — which is most submissions — this is exactly what a single file rendered before.

    One element for a link whether or not it is a document: `SubmittedDocumentRow` asks the parser
    and draws whichever card the answer calls for. The address is shown either way rather than
    hidden behind the button, because the commonest mistake on a Drive assignment is handing in
    the instructor's template instead of your own copy, and the two differ only in the tail of the
    URL.
  */
  const attachments = submission.artifacts.map((artifact, index) => {
    const single = submission.artifacts.length === 1;
    const label = single
      ? "What the student handed in"
      : `Attachment ${submission.artifacts.length - index} of ${submission.artifacts.length}`;

    /*
      Said only where there is another attachment to tell this one apart from. On the one card a
      single hand-in draws, the date would answer a question nobody reading it has — there is
      nothing else it could be confused with, and the submission's own state is said above.
    */
    const addedAt = single ? null : artifact.createdAt;

    return artifact.kind === "FILE" ? (
      <UploadedFileRow
        key={artifact.id}
        artifactId={artifact.id}
        filename={artifact.uploadFilename ?? "Attachment"}
        sizeBytes={artifact.uploadSizeBytes}
        lateness={lateness({ ...submission, dueAt: assignmentDueAt })}
        label={label}
        addedAt={addedAt}
        previewByDefault={index === 0}
      />
    ) : (
      <SubmittedDocumentRow
        key={artifact.id}
        url={artifact.url ?? ""}
        label={label}
        lateness={lateness({ ...submission, dueAt: assignmentDueAt })}
        addedAt={addedAt}
        previewByDefault={index === 0}
      />
    );
  });

  /*
    **What the student handed in.** One of three, and there is always one: what they attached, the
    diff of their pull request, or a card saying there is nothing yet.

    An upload goes here whether or not it can be previewed. A `.pdf` gets a viewer and a `.docx`
    gets a download button, but both are the work, and the instructor should not have to look in a
    different place depending on the file type they asked for.
  */
  const work =
    attachments.length > 0 ? (
      <div className="flex flex-col gap-3">{attachments}</div>
    ) : diffAside ? (
      <DiffPanel
        diff={diff.data}
        loading={diff.isPending}
        error={diff.error}
        prUrl={submission.prUrl}
        prNumber={submission.prNumber}
      />
    ) : (
      <StateCard
        icon={GitPullRequest}
        title="Nothing submitted yet"
        description={
          data.manualOnly
            ? "There is nothing to grade yet."
            : "The student has a repository but has not opened a pull request."
        }
      >
        {/*
          The one state with code to look at and no pull request to reach it by. The diff panel
          carries the PR link wherever a pull request exists, so this card is the only place the
          bare repository needs a way in.
        */}
        {submission.repoUrl && (
          <a
            href={submission.repoUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            <FolderGit2 data-icon="inline-start" />
            Open the repository
            <ExternalLink data-icon="inline-end" />
          </a>
        )}
      </StateCard>
    );

  /*
    The work and its test output: the left column in grading mode, and the Work tab elsewhere. The
    test output sits under the work because it describes the same code.
  */
  const evidence = (
    <>
      {work}
      {testEvidence}
    </>
  );

  /*
    The feedback, the comments and earlier rounds of feedback, as tabs. Outside grading mode the
    work is a fourth tab, placed first because it is the left column in grading mode and instructors
    read from the work to the report in both layouts. The first tab is the one that opens.

    The Comments tab shows a dot when a reply is owed, so a waiting question is visible as soon as a
    student is opened. The labels are kept short so all four fit when the column is narrow.

    Every panel stays mounted (`keepMounted`) because two of them hold unsaved work: the report
    editor saves and reloads when it unmounts, and the reply box keeps its text in component state.
    Without `keepMounted`, switching tabs would trigger a save and discard a half-written reply.
  */
  /*
    Written out in full rather than built from a variable, because Tailwind only generates the
    classes it finds spelled out in the source.
  */
  const labelClass = split ? "@max-sm:sr-only" : "@max-md:sr-only";

  const tabs = (
    <Tabs defaultValue={split ? "report" : "work"} className="gap-3">
      {/*
        The labels collapse to icons alone when the tab row is too narrow for them. `@container`
        makes the row measure its own width rather than the window's, because the grade column can
        be dragged narrower and the docked list changes how much room the pane has.

        `sr-only` hides a label visually but keeps it as the tab's accessible name, and `title` names
        the tab on hover. The cut-off is narrower in grading mode, where only three tabs share the
        row: about 24rem for three labels, about 28rem for four.
      */}
      <div className="@container">
        <TabsList className="w-full">
          {!split && (
            <TabsTrigger value="work" title="Work">
              <FileText data-icon="inline-start" />
              <span className={labelClass}>Work</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="report" title="Feedback">
            <PenLine data-icon="inline-start" />
            <span className={labelClass}>Feedback</span>
          </TabsTrigger>
          <TabsTrigger value="conversation" title="Comments">
            <MessagesSquare data-icon="inline-start" />
            <span className={labelClass}>Comments</span>
            {/*
              Teal, the colour the student list uses for a conversation awaiting a reply, so the dot
              means the same thing in both places. It stays when the label collapses.
            */}
            {comments.data?.awaitsReply && (
              <span
                className="size-2 rounded-full bg-teal-500"
                title="A reply is owed"
                aria-label="A reply is owed"
              />
            )}
          </TabsTrigger>
          {previous.length > 0 && (
            <TabsTrigger value="history" title="History">
              <History data-icon="inline-start" />
              {/* The count stays beside the icon when the word collapses. */}
              <span className={labelClass}>History</span>({previous.length})
            </TabsTrigger>
          )}
        </TabsList>
      </div>

      {/*
        `text-base` cancels the panel's default `text-sm`, which would otherwise shrink the text in
        every card inside it.
      */}
      {!split && (
        <TabsContent value="work" keepMounted className="flex min-w-0 flex-col gap-5 text-base">
          {evidence}
        </TabsContent>
      )}

      <TabsContent value="report" keepMounted className="flex min-w-0 flex-col gap-5 text-base">
        {/*
          No key on the round, deliberately. A hand-graded round coming into being, or a refetch of
          the same round, must not remount the editor under the instructor's hands — the editor
          itself decides when a *different* round means starting over.
        */}
        <DraftBody
          submission={submission}
          completionThreshold={completionThreshold}
          draft={draft}
          data={data}
          onApproved={onApproved}
          release={release}
          releasing={releasing}
        />
      </TabsContent>

      <TabsContent value="conversation" keepMounted className="text-base">
        <CommentsCard
          assignmentId={assignmentId}
          studentId={submission.student.id}
          studentName={displayNameOf(submission.student, "this fellow")}
          thread={comments.data}
          loading={comments.isPending}
          error={comments.isError}
          onRetry={() => void comments.refetch()}
          now={now}
        />
      </TabsContent>

      {previous.length > 0 && (
        <TabsContent value="history" keepMounted className="text-base">
          <DraftHistory drafts={previous} now={now} />
        </TabsContent>
      )}
    </Tabs>
  );

  /*
    The grade column: the team, any notice about a comment that failed to post, then the tabs. The
    team and the notice sit above the tabs because they apply whichever tab is open. The team is
    named here rather than over the work because the team decides who receives the release.
  */
  const grade = (
    <div className="flex min-w-0 flex-col gap-5">
      {submission.team && (
        <TeamLine
          team={submission.team}
          studentId={submission.student.id}
          studentHref={studentHref}
        />
      )}
      <CommentRecoveryNotice submission={submission} grade={data.grade} />
      {tabs}
    </div>
  );

  /*
    The pane has no header naming the open student, because both screens that draw it already name
    them: in the queue's highlighted row, at the top of the fellow record page, and in grading
    mode's bar.
  */
  return (
    <div className="flex h-full flex-col">
      {/*
        `relative` on this scroller and on the two column scrollers below, because `sr-only`
        content is `position: absolute` and an absolute box is clipped only by ancestors on the way
        to its containing block. Without a positioned ancestor down here, the comment thread's
        live-region paragraph resolved against the shell's `SidebarInset`, skipped every overflow
        between them, and stretched the window by the height of its phantom flow position — a blank
        half-screen of scroll under every graded submission. Positioned, each scroller is the
        containing block, and the invisible box scrolls and clips with the content it belongs to.

        Outside grading mode this box scrolls the single column. In grading mode it has nothing to
        scroll, because its child fills it exactly and each column scrolls itself.
      */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto scroll-pt-5 px-5 py-5">
        {split ? (
          /*
            Grading mode: the work and the grade side by side, each scrolling on its own, so an
            instructor can read the work while writing about it.

            The grade column starts between 26rem and 34rem wide, and the work takes the rest. Below
            26rem the feedback box is too narrow to write in, and above 34rem lines of prose are too
            long to read comfortably. `GradeColumnHandle` lets the instructor move the line, between
            a 26rem minimum and 60% of the row.

            Each column can scroll because its height comes from `min-h-0 flex-1` all the way down
            from the pane, which makes it exactly as tall as the row. A height calculated from the
            viewport would be wrong, because what sits above the pane differs between the queue, a
            student's record and grading mode.

            Each column is a scrolling box holding a separate flex column of cards. A flex column with
            a fixed height shrinks its children to fit, which would draw each card smaller than its
            content.

            Each scrolling box has `p-1` padding because a card's outline (`ring-1`) is drawn outside
            the card, and the scrolling box would otherwise clip it.
          */
          <div className="mx-auto flex min-h-0 w-full max-w-[100rem] flex-1 flex-row">
            <div className="relative min-h-0 min-w-0 flex-1 scroll-pt-1 overflow-y-auto p-1">
              <div className="flex min-w-0 flex-col gap-5">{evidence}</div>
            </div>

            <GradeColumnHandle column={gradeColumn} />

            {/*
              The width is a custom property rather than a class, because a drag rewrites it on
              every pointer move and does so directly on this element: a React render per move
              would re-render the editor beneath the pointer sixty times a second.
            */}
            <div
              ref={gradeColumn}
              style={{ "--grade-w": gradeColumnWidth(gradeWidth) } as React.CSSProperties}
              className="relative min-h-0 w-(--grade-w) min-w-0 shrink-0 scroll-pt-1 overflow-y-auto p-1"
            >
              {grade}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl">{grade}</div>
        )}
      </div>
    </div>
  );
}

/** Where the dragged width of the grade column is kept. One value for every screen drawing this pane. */
const GRADE_WIDTH_KEY = "grading-review:grade-width";

/** The narrowest the grade column may be dragged: the floor its default width is clamped to. */
const GRADE_MIN_REM = 26;

/** The largest share of the row the grade column may be dragged to, so the work keeps the rest. */
const GRADE_MAX_SHARE = 0.6;

/** How far one press of an arrow key moves the line, in pixels. */
const GRADE_KEY_STEP = 32;

const gradeWidthListeners = new Set<() => void>();

/**
 * The width for this sitting when storage refuses — a browser set to block site data throws on
 * touch. Without it the line would jump back to the default the moment a drag ended.
 */
let unstoredGradeWidth: string | null = null;

function subscribeGradeWidth(listener: () => void): () => void {
  gradeWidthListeners.add(listener);
  // Another tab moving the line moves it here too, which is what one stored value means.
  window.addEventListener("storage", listener);
  return () => {
    gradeWidthListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readGradeWidth(): string | null {
  try {
    return window.localStorage.getItem(GRADE_WIDTH_KEY);
  } catch {
    return unstoredGradeWidth;
  }
}

/** `null` forgets the width, which returns the column to its default. */
function writeGradeWidth(px: number | null): void {
  unstoredGradeWidth = px === null ? null : String(px);
  try {
    if (px === null) window.localStorage.removeItem(GRADE_WIDTH_KEY);
    else window.localStorage.setItem(GRADE_WIDTH_KEY, String(px));
  } catch {
    // Nothing to do: `unstoredGradeWidth` holds it for this sitting.
  }
  for (const listener of gradeWidthListeners) listener();
}

/**
 * The stored width in pixels, or null where none is stored.
 *
 * Null on the server and through hydration, because the server cannot read the browser's storage:
 * the first paint has the default width and the stored one follows. A pane opened after that, which
 * is every student after the first, reads storage before it paints.
 */
function useStoredGradeWidth(): number | null {
  const stored = React.useSyncExternalStore(subscribeGradeWidth, readGradeWidth, () => null);
  const px = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(px) ? px : null;
}

/**
 * The grade column's width as CSS. A dragged width is still clamped, because it was chosen on a
 * pane of one width and may be drawn on a narrower one: grading mode is wider than the queue, which
 * is wider than a fellow's record.
 */
function gradeColumnWidth(px: number | null): string {
  return px === null
    ? `clamp(${GRADE_MIN_REM}rem, 40%, 34rem)`
    : `clamp(${GRADE_MIN_REM}rem, ${px}px, ${GRADE_MAX_SHARE * 100}%)`;
}

/**
 * The line between the work and the grade, which an instructor drags to give one of them more room.
 *
 * Drawn only in grading mode, the only layout with two columns. Arrow keys move it for anyone not
 * using a pointer, and a double-click returns it to the default.
 *
 * **A drag writes the width onto the column directly and stores it when the pointer lifts.** Stored
 * on every move, each move would re-render the whole pane, editor included; stored only at the end,
 * the pane renders once, with the value already on the element.
 */
function GradeColumnHandle({ column }: { column: React.RefObject<HTMLDivElement | null> }) {
  const drag = React.useRef<{ startX: number; startWidth: number; width: number | null } | null>(
    null,
  );
  const [dragging, setDragging] = React.useState(false);

  /** The same bounds `gradeColumnWidth` gives CSS, so a stored width is one CSS would draw. */
  function clampToRow(px: number): number {
    const row = column.current?.parentElement?.getBoundingClientRect().width ?? 0;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Math.round(Math.max(GRADE_MIN_REM * rem, Math.min(px, row * GRADE_MAX_SHARE)));
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !column.current) return;
    // Otherwise the drag also selects the text of both columns as it passes over them.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.clientX,
      startWidth: column.current.getBoundingClientRect().width,
      width: null,
    };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || !column.current) return;
    // The grade is the right-hand column, so moving the line left widens it.
    const width = clampToRow(drag.current.startWidth - (event.clientX - drag.current.startX));
    drag.current.width = width;
    column.current.style.setProperty("--grade-w", `${width}px`);
  }

  function endDrag() {
    if (!drag.current) return;
    // A press that never moved stores nothing, so clicking the line does not fix the default width.
    if (drag.current.width !== null) writeGradeWidth(drag.current.width);
    drag.current = null;
    setDragging(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowLeft" ? GRADE_KEY_STEP : event.key === "ArrowRight" ? -GRADE_KEY_STEP : 0;
    if (step === 0 || !column.current) return;
    event.preventDefault();
    writeGradeWidth(clampToRow(column.current.getBoundingClientRect().width + step));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the work and grade columns"
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => writeGradeWidth(null)}
      className="group relative w-6 shrink-0 cursor-col-resize touch-none outline-none"
    >
      {/* The line itself, drawn only while it is being pointed at, focused, or dragged. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-border group-focus-visible:bg-ring group-data-dragging:bg-ring"
      />
      {/* The grip, always drawn, so the line can be found before it is pointed at. */}
      <span
        aria-hidden
        className="absolute top-1/2 left-1/2 h-10 w-1.5 -translate-1/2 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/60 group-focus-visible:bg-ring group-data-dragging:bg-ring"
      />
    </div>
  );
}

/**
 * Who is on the team, and which of them handed in the version being read.
 *
 * Named rather than counted, because the release goes to all of them and a count cannot show a
 * team whose membership is wrong. Each name links to that fellow's own record, which is the
 * question a report prompts about a member — a team heading could not carry that link, because a
 * team has no record of its own.
 */
function TeamLine({
  team,
  studentId,
  studentHref,
}: {
  team: NonNullable<QueueSubmission["team"]>;
  /** Whose row is open, so each teammate's link can be built by swapping the id. */
  studentId: string;
  studentHref?: string;
}) {
  const memberHref = (memberId: string) =>
    studentHref ? studentHref.replace(studentId, memberId) : "";

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      <Users className="size-3.5 shrink-0" />
      <span>{team.setName}</span>
      <span aria-hidden>·</span>
      {team.members.map((member, index) => {
        const label = member.displayName ?? member.email ?? "Unknown";
        const href = memberHref(member.id);
        return (
          <span key={member.id}>
            {href ? (
              <Link href={href} className="text-foreground hover:underline">
                {label}
              </Link>
            ) : (
              <span className="text-foreground">{label}</span>
            )}
            {index < team.members.length - 1 && ","}
          </span>
        );
      })}
      {team.handedInBy && (
        <span>
          · handed in by{" "}
          <span className="text-foreground">{team.handedInBy.displayName ?? "a member"}</span>
        </span>
      )}
    </p>
  );
}

/**
 * A grade that was recorded but whose comment never reached the pull request.
 *
 * The grade and the comment are written in two steps on purpose, so a GitHub outage
 * during approval leaves a real grade and an unsent comment rather than losing both.
 * This is the way out of that state that does not involve approving twice.
 */
function CommentRecoveryNotice({
  submission,
  grade,
}: {
  submission: QueueSubmission;
  grade: DraftList["grade"];
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const retry = useMutation(
    trpc.gradingDrafts.retryComment.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Comment posted to the pull request.");
        },
      }),
    ),
  );

  // Only a real failure. `not_applicable` — a hand-graded assignment with no pull request
  // — is a finished grade, and offering it a retry would offer a button that cannot
  // succeed against a fault that does not exist.
  if (grade?.delivery !== "failed") return null;

  return (
    <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      <AlertTriangle className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>The feedback comment was never posted</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>
          The grade is recorded and the student can see it. Only the comment to the pull request is
          missing.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={retry.isPending}
          onClick={() => retry.mutate({ submissionId: submission.id })}
        >
          {retry.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <RotateCcw data-icon="inline-start" />
          )}
          {retry.isPending ? "Posting…" : "Post the comment"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
