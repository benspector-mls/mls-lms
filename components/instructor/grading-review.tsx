"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { SubmittedDocumentRow } from "@/components/submitted-document";
import { UploadedFileRow } from "@/components/uploaded-file";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";
import { previewKindOf } from "@/lib/uploads/file-types";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { DraftBody } from "@/components/instructor/review/draft-body";
import { DraftHistory } from "@/components/instructor/review/draft-history";
import { CommentRecoveryNotice, ReviewHeader } from "@/components/instructor/review/review-header";
import { RubricBreakdown } from "@/components/instructor/review/section-editor";
import {
  FeedbackBoxes,
  HeaderActionsSlot,
  QueueSubmission,
  readRubricItems,
} from "@/components/instructor/review/shared";
import { DiffPanel, TestEvidence } from "@/components/instructor/review/work-panels";
export function GradingReview({
  submission,
  assignmentTitle,
  assignmentKind,
  completionThreshold,
  studentHref,
  now,
}: {
  submission: QueueSubmission;
  assignmentTitle: string;
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
   * Absent on the student overview, because that *is* their record — a name linking to the page it
   * is already on is a dead control. Present in the grading queue, where "what else has this person
   * done" is the question a report prompts and there was previously no way to answer it.
   */
  studentHref?: string;
  now: Date;
}) {
  const trpc = useTRPC();
  const [actionsSlot, setActionsSlot] = React.useState<HTMLDivElement | null>(null);
  const [openBoxes, setOpenBoxes] = React.useState<readonly string[]>([]);

  const feedbackBoxes = React.useMemo(
    () => ({
      open: openBoxes,
      setOpen: (sectionType: string, open: boolean) =>
        setOpenBoxes((prev) =>
          open
            ? prev.includes(sectionType)
              ? prev
              : [...prev, sectionType]
            : prev.filter((entry) => entry !== sectionType),
        ),
    }),
    [openBoxes],
  );

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
    Rounds worth listing under the grade. A discarded round was never sent to anybody, so it is
    not previous feedback and does not belong in a list called that. The row stays in the
    database — a report that cost a model call and a report an instructor rejected are both
    things a later judgment about the grading wants — and off a screen whose subject is one
    student's record.
  */
  const history = data.drafts.filter((entry) => entry.status !== "SUPERSEDED");

  // The run that describes the code currently on the pull request. An older run is not
  // evidence about this commit, so it is not offered as if it were.
  const currentRun = testRuns.data?.runs.find((run) => run.headSha === submission.headSha) ?? null;

  /*
    Handed to `DraftBody` rather than placed here, because where the evidence belongs depends
    on what is being reviewed: below the report and its rubric breakdown when there is a
    report, and below the panel that offers to write one when there is not. The report is what
    an instructor is here to read; the evidence is why it says what it says, and that is a
    question asked second.
  */
  const testEvidence = canHaveTests ? (
    <TestEvidence
      submissionId={submission.id}
      runs={testRuns.data}
      currentRun={currentRun}
      loading={testRuns.isPending}
      now={now}
    />
  ) : null;

  /*
    The student's uploaded file, built once and placed in whichever column it belongs to.

    Reading it is what an instructor came to this screen to do, and every card below is about it —
    so on a graded submission the document is above, or beside, the grade it was given.

    Outside the grading form rather than inside it, because the form is replaced by the editor the
    moment a round is opened and the file is most needed while the feedback is being written.
  */
  const uploadedFile = submission.uploadFilename ? (
    <UploadedFileRow
      submissionId={submission.id}
      filename={submission.uploadFilename}
      sizeBytes={submission.uploadSizeBytes}
      isLate={submission.isLate ?? false}
      label="What the student uploaded"
      // Open on arrival. Reading the work is why the instructor is on this screen, and a cohort of
      // resumes graded by downloading each one in turn is most of the work of grading them.
      previewByDefault
    />
  ) : null;

  /*
    The link a student handed in, which is the document itself where it turns out to be one.

    One element for both, because `SubmittedDocumentRow` asks the parser and draws whichever card
    the answer calls for. The address is shown either way rather than hidden behind the button:
    the commonest mistake on a Drive assignment is handing in the instructor's template instead of
    your own copy, and the two differ only in the tail of the URL.
  */
  const submittedLink = submission.submittedUrl ? (
    <SubmittedDocumentRow
      url={submission.submittedUrl}
      label="What the student submitted"
      isLate={submission.isLate ?? false}
      // Open on arrival, for the reason the uploaded file above is: reading the work is why the
      // instructor is on this screen.
      previewByDefault
    />
  ) : null;

  /*
    The score's working: one card per section, and never anything the student sees.

    Read straight from the draft rather than from inside the editor, because where these belong
    depends on the room there is — see the column below.
  */
  const rubricSections = draft
    ? draft.sections.filter((section) => readRubricItems(section.rubricItems).length > 0)
    : [];

  /*
    **What goes in the column beside the grade, and which of the four kinds of thing it is.**

    One kind at a time, and never two, and what settles it is a ranking rather than the kinds
    being mutually exclusive: **the work comes before the working.** A repository has both — the
    diff is what the student wrote, and the rubric breakdown with the suite output is what the
    score rests on — so the diff takes the column and the working reads under the report, which is
    where `DraftEditor` draws it by default. Where a submission has none of the four the pane
    stays in one column rather than splitting to show an empty half.

      - A file the browser can show. `previewKindOf` is the same function the preview itself
        asks, so the two cannot disagree about what can be embedded — a `.docx` answers null and
        stays in the one column, where it is a row with a download button and nothing to read.
      - The address a student handed in. Where that address is a Google document,
        `SubmittedDocumentRow` frames the document under it and this column holds the work; where
        it is anything else, it holds the address, which is small but is still what they
        submitted and belongs on the same side the document would be. That decision is
        `parseDriveDocUrl`, asked by the card rather than here, and it is the same function the
        frame's address is built from — so a pane that widened for a document cannot then fail to
        show one.
      - The diff of a pull request, which is the work for an assignment collected as a
        repository. Present as soon as there is a pull request, which `prNumber` answers without
        a request being made.
      - The working behind the score: the rubric breakdown and the suite output. Not what the
        student handed in, and not the work — what the grade rests on. It is what the column holds
        for a repository whose student has accepted and not yet pushed.

    The last of those is the one that stacks *after* the grade rather than before it: on a narrow
    screen an instructor reads the feedback the student will read and then scrolls to what backs
    it up, which is the order that has always been on this screen. A document is the opposite: it
    is the work, and it is read first.
  */
  const documentAside =
    submission.uploadFilename !== null && previewKindOf(submission.uploadFilename) !== null;
  const linkAside = !documentAside && submittedLink !== null;
  const evidenceAside =
    !documentAside &&
    !linkAside &&
    !diffAside &&
    canHaveTests &&
    (rubricSections.length > 0 || (testRuns.data?.runs.length ?? 0) > 0);

  const aside = documentAside ? (
    uploadedFile
  ) : linkAside ? (
    submittedLink
  ) : diffAside ? (
    <DiffPanel
      diff={diff.data}
      loading={diff.isPending}
      error={diff.error}
      prUrl={submission.prUrl}
      prNumber={submission.prNumber}
    />
  ) : evidenceAside ? (
    <>
      {rubricSections.map((section) => (
        <RubricBreakdown key={section.id} section={section} />
      ))}
      {testEvidence}
    </>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      <ReviewHeader
        submission={submission}
        draft={draft}
        studentHref={studentHref}
        actionsRef={setActionsSlot}
      />

      <HeaderActionsSlot.Provider value={actionsSlot}>
        {/*
          `@container`, so the two columns below turn on at a width of this pane rather than of the
          window. It is the pane that has to hold them, and what is left of the window after the
          360px queue list and the application sidebar is not something the window knows.

          **Nothing on this element may carry an `@4xl:` class of its own.** An element cannot
          answer its own container query — a `@4xl:` class here asks about the nearest container
          *above* this one, of which there is none, so it silently never applies. Everything that
          changes at the breakpoint therefore lives on the children below, and this element is
          written once and for both widths: a flex column that scrolls, which is what stacked
          needs, and which split leaves with nothing to scroll because its one child is then
          exactly as tall as it is.
        */}
        <div className="@container flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
          {/*
            One column until there is both something to put beside the grade and the room to put it
            there, and two after that.

            What is beside the grade holds its place while the score, the feedback and the history
            scroll past it, which is the whole point: reading the work and writing about it are the
            same task and were never on the screen at the same time. `items-start` is what lets the
            column be its own height rather than the row's — a stretched column has nothing to
            stick to.

            **Every pixel past the first thousand or so belongs to the work.** A score box and a
            paragraph of feedback have a size they want and no use for more: below 26rem the
            markdown box is too narrow to write in, and past 34rem the prose runs to a measure
            nobody reads a paragraph across. So the grade is clamped between those two and the
            other column takes the rest. 26rem is also exactly half the room at the width the
            columns appear, so the grade is never squeezed below the work at the point where they
            are both smallest.

            **A row of flex children rather than grid columns, and `order` rather than placement.**
            Stacked, this is a column and the evidence sits last; split, it is a row and the
            evidence is the left of the two. One piece of markup reads in both orders because
            `order-last` is undone above the breakpoint.

            **Where each column's height comes from is the whole of why it can scroll.** It is
            `min-h-0 flex-1` down from the pane, which is the same chain the queue's own list uses
            three files away and the only one this application has ever relied on: the pane knows
            its height, the row takes it, and a child of the row is exactly as tall as the row is.
            Nothing here is a `calc` against the viewport — that is a guess about what sits above
            the pane, which differs between the queue, a student's record and grading mode, and it
            is wrong on some screen by construction. Too small and a column ends early; too large
            and its last card is below the fold with nothing that will bring it up.

            **What scrolls and what stacks the cards are two elements, not one.** A flex column
            with a height of its own shrinks its children to fit rather than overflowing, which
            leaves every card drawn smaller than the content inside it — so the scrolling box is a
            plain one and the cards are stacked in a column within it. The same shape the queue's
            list has: a box that scrolls, holding a column that does not.

            **And the scrolling box is padded, which is not decoration.** A card's outline is
            `ring-1`, and a ring is a shadow drawn *outside* the element rather than a border drawn
            on it — so against the edge of a scroll container it falls outside the scrollport and
            is clipped away, leaving cards with their sides and top missing. The padding is what
            keeps the outline inside the box that clips it.
          */}
          <div
            className={cn(
              "mx-auto flex max-w-5xl flex-col gap-5",
              aside &&
                "@4xl:w-full @4xl:max-w-[100rem] @4xl:min-h-0 @4xl:flex-1 @4xl:flex-row @4xl:gap-6",
            )}
          >
            {aside && (
              <div
                className={cn(
                  "min-w-0",
                  // Its own scroll, so a rubric of ten questions and the suite output beneath it
                  // can be read to the end without the report leaving the screen. The padding is
                  // there for the cards' outlines — see below.
                  "@4xl:min-h-0 @4xl:flex-1 @4xl:overflow-y-auto @4xl:p-1",
                  evidenceAside && "order-last @4xl:order-none",
                )}
              >
                <div className="flex min-w-0 flex-col gap-5">{aside}</div>
              </div>
            )}

            <div className="min-w-0 @4xl:min-h-0 @4xl:w-[clamp(26rem,40%,34rem)] @4xl:shrink-0 @4xl:overflow-y-auto @4xl:p-1">
              <div className="flex min-w-0 flex-col gap-5">
                {!documentAside && uploadedFile}
                {!linkAside && submittedLink}

                <CommentRecoveryNotice submission={submission} grade={data.grade} />

                {/*
                The provider sits here rather than around the whole pane because this is everything
                that reads it: the section cards are inside, and a card that opens its feedback box
                is rebuilt around a round a moment later.
              */}
                <FeedbackBoxes.Provider value={feedbackBoxes}>
                  <DraftBody
                    key={draft?.id ?? "none"}
                    submission={submission}
                    assignmentTitle={assignmentTitle}
                    completionThreshold={completionThreshold}
                    draft={draft}
                    data={data}
                    testEvidence={evidenceAside ? null : testEvidence}
                    rubricInAside={evidenceAside}
                  />
                </FeedbackBoxes.Provider>

                {history.length > 1 && (
                  <DraftHistory drafts={history} activeId={draft?.id} now={now} />
                )}
              </div>
            </div>
          </div>
        </div>
      </HeaderActionsSlot.Provider>
    </div>
  );
}
