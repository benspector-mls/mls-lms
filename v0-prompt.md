# Vercel V0 prompt — Marcy LMS interface

Copy everything below the line into V0. It describes the interface only; the backend
exists and is not part of this task.

Keep this file in step with the tRPC routers. The types in it are copied from what the
procedures actually return, and a prompt that invents field names produces components
that cannot be wired up.

---

You have generated a strong initial draft of the frontend application. However, things have
changed since I first asked you to build this. What follows is an updated prompt for you
to build, some of which makes large changes to your design, primarily in regard to the 
assignment grading views, and some of which uses your existing design. First identify
the differences and ask for clarification when there isn't enough information to make a 
design choice. Here is the new prompt:

Build the interface for **Marcy LMS**, the assignment and grading application for The
Marcy Lab School, a nine-month software engineering programme. It replaces GitHub
Classroom. Students accept an assignment, work in their own GitHub repository, and open
a pull request. The application runs the instructor's test suite against their code and
drafts a feedback report, which an instructor reviews, edits if needed, and approves
before the student ever sees it.

Produce React components only, with mock data inline. No API calls, no database, no
server actions.

## Stack

Next.js App Router, TypeScript, Tailwind, and shadcn/ui — all already installed. Use
shadcn components (`Card`, `Badge`, `Button`, `Table`, `Tabs`, `Accordion`, `Dialog`,
`Textarea`, `Input`) rather than hand-rolled equivalents. Light and dark themes both.

The student screens must work on a phone — that is where students check a grade. The
instructor grading queue is desktop-first and does not need to collapse gracefully to a
narrow screen; grading on a phone is not a workflow worth designing for.

## The thing that makes this interface hard

**The application drafts grades; it does not issue them.** Every automatically produced
score is a proposal that an instructor accepts, edits, or rejects, and the interface's
job is to make the reasons for doubt visible rather than presenting every number with
the same confidence. Four things must never be flattened into a generic "status" chip:

1. **A score checked against a real test run** and a score resting only on a model reading
   the code are not the same. Say which is which, in words.
2. **A draft describing an older commit** is not wrong, but it describes different code.
3. **Notes written for the instructor** must be visibly separate from the report the
   student reads. Mixing them risks an instructor sending a student an internal remark.
4. **A grade that was recorded but whose comment never posted** is a recoverable state,
   and it is only recoverable if somebody can see it.

If a design decision is between "clean" and "honest about uncertainty", choose honest.

## Screens

### 1. `/courses` — the courses you belong to

A short list of cards. Students and instructors see the same shape; instructors also see
a link into each course's instructor view. Empty state: "You are not enrolled in any
courses yet."

### 2. `/courses/[courseId]` — assignments, as the student sees them

One card per assignment: title, module tag, point value, due date, and the caller's own
submission if one exists. Depending on state the card shows:

- **No submission** → an "Accept assignment" button.
- **`ACCEPTED`** → links to their repository, and a short instruction to work on the
  `draft` branch and open a pull request into `main` when finished. Make it clear that
  **opening the pull request is the act of submitting.**
- **`SUBMITTED`** → links to the repository and pull request, submitted date, a "late"
  badge when late.
- **`GRADED`** → the score, whether it met the completion threshold, and the feedback.
  **Render the feedback as markdown**, not as preformatted text — headings, checklists,
  tables, and code blocks all appear in it. Collapsed behind a "Read feedback" control.
- **Graded, and the student has pushed since** → a plain statement that there are newer
  commits than the grade describes, and a button "Ask for another review". Explain that
  pushing alone does not request one. This is not an error state and must not look like
  one; students commit while they work.
- **`RESUBMITTED`** → "You have asked for another look."

`SubmissionStatus` also carries `DRAFT_READY`, `NEEDS_MANUAL_REVIEW`, and
`GRADING_FAILED`. Those describe where the work sits in the instructor's queue, and a
student has nothing to do about any of them. **Never show a student a raw status name.**
All three read to them as "submitted, waiting on your instructor" — a student who sees
"grading failed" or "needs manual review" reasonably concludes they did something wrong.

**Feedback accumulates.** A student who resubmits gets a second report about different
work; earlier rounds stay, collapsed behind "Earlier feedback (N rounds)", each labelled
with its date and score. Reading them in order is how a student sees what changed, so
design that as a feature rather than an archive since we eventually want to be able to 
analyze a students history of feedback to make claims about their growth and progression.

### 3. `/instructor/assignments/[assignmentId]` — the grading queue

The screen where the real work happens and it is the most important screen of the application
to get right. There is a lot of information to show and if it is too crowded then using it will
be painful rather than enjoyable. It needs one row or card per student submission, showing
the student, status, late badge, "revised since grading" badge, links to the repository
and pull request, and the current commit. 

Sorting and filtering matter here: an instructor grading a cohort of twenty-five wants
the ones needing attention first. Offer filters for "needs review", "not yet graded",
"revised since grading", and "graded".

Perhaps this list of assignments appears as a side panel such that an instructor may click
on a submission and the submission details appear on the right. This view should be optimized
for desktop use as it is not recommended for instructors to be grading in a mobile format.

The submission must display the following:

**Test results.** Suite name, pass count, duration, and the individual test names with
their status. Also, when present, a list of protected files the student changed — test
files, configuration — which is a signal worth showing prominently but is **not** a
score. Include a "Run tests" button and a run history.

> Design note: the pass rate is *not* the grade. A submission can pass every test and
> still score poorly for hardcoded values or poor structure. Never render pass rate as
> if it were the score, and never place them so close together that they read as the
> same number.

**Generating a report.** A "Generate report" button, becoming "Regenerate report" once a
draft exists. Two things about it shape the design:

- **It takes 30 to 90 seconds**, and the instructor waits. A spinner that sits still for
  a minute and a half reads as a hang. Show that work is happening and roughly how long
  it takes, keep the rest of the screen usable, and do not let the button be pressed
  twice.
- **Sometimes it cannot run**, because the student has not opened a pull request or the
  assignment has no rubric mapping. In that case show the specific reason in place of the
  button rather than a disabled control — a greyed-out button invites clicking and says
  nothing about why it will not work.

The same applies to "Run tests", which takes about 30 seconds.

**Grading drafts.** For each section of the assignment (an assignment may have two — a short
response and a coding section, graded against different rubrics with different point
values, though most will just have one section), show:

- The section score and percentage.
- A badge saying whether automated tests were used, and which framework. Some assignments
  — frontend design work, short responses — have none by design, so this is a statement of
  fact rather than a warning. The framework comes from the test run's `runnerPreset`: `node-jest`, 
  `node-vitest`, `python-pytest`, etc., or none
- When the flag `TEST_RUN_MISSING` is present, a badge ("Test Run Missing"): this section
  expects test results and none exist for this commit, so it was graded without them.
- When the flag `TEST_MATCH_MISSING` is present, a badge ("Test File Missing"): the tests
  ran but none matched this section's `testNamePattern`, so the score was reached without
  them. Either the pattern is wrong or the tests it names do not exist.

  Both of these are faults, not neutral facts — unlike the badge above. Give them enough
  weight that an instructor does not approve past them without deciding to.
- Flag badges (short codes, see the types below).
- A visibly separate block, **"Instructor Notes"** (not shown to the student),
  holding prose notes for the instructor.
- The report itself, as **rendered markdown by default**, with a toggle to the raw text.
  Rendered is the default because it is what the student will receive, and markdown that
  fails to render shows up there as visibly wrong output — a broken table appears as
  literal pipes, a wrong code fence as unhighlighted text. The raw view is for editing
  and for working out *why* something renders wrongly, not for spotting that it does.
- An **Edit** control giving a textarea for the report and a number input for the score.
  Warn inline when the score written in the report text disagrees with the score in the
  input — approving is blocked while they disagree. Offer "Discard my edits" to restore
  the model's original, and badge an edited section as "edited by you".
- An **Approve** button that confirms before acting, because it posts to GitHub and puts
  text in front of a student. The confirmation should say what will happen in plain
  words, not just "Are you sure?".

Draft history is collapsed by default. Approved drafts are labelled "sent to the
student" with a date; unapproved ones are proposals.

### 4. `/instructor/courses/[courseId]/gradebook` — exists in the current design

I love the current design but the cells should be clickable (when a student has something
to be graded) that takes the instructor to that `/instructor/assignments/[assignmentId]` page
with the clicked-on student's submission pulled up.

For that to work the grading queue has to be addressable by submission, not only by
assignment: link to `/instructor/assignments/[assignmentId]?submission=<submissionId>` and
have that page open with the named submission selected in the detail pane. Falling back to
the first submission when the parameter is absent or unrecognised.

## Data shapes

Copied from the procedures. Use these names exactly.

```ts
type Role = 'STUDENT' | 'INSTRUCTOR' | 'ADMIN';

type SubmissionStatus =
  | 'NOT_STARTED' | 'ACCEPTED' | 'SUBMITTED' | 'DRAFT_READY'
  | 'GRADED' | 'RESUBMITTED' | 'GRADING_FAILED' | 'NEEDS_MANUAL_REVIEW';

type Course = {
  id: string; name: string; cohortTerm: string; archivedAt: Date | null;
};

type Assignment = {
  id: string; title: string; moduleTag: string;
  pointValue: number;            // the sum of its sections
  completionThreshold: number;   // 0.75
  dueAt: Date | null; assignmentRepoName: string | null; courseId: string;
};

type Submission = {
  id: string; status: SubmissionStatus;
  repoFullName: string | null; repoUrl: string | null;
  prUrl: string | null; prNumber: number | null;
  headSha: string | null;        // the commit the pull request is at now
  gradedHeadSha: string | null;  // the commit the grade describes
  submittedAt: Date | null; isLate: boolean | null; lastActivityAt: Date | null;
  finalScore: number | null; finalScorePossible: number | null;
  isComplete: boolean | null;    // finalScore / finalScorePossible >= threshold
  feedbackMarkdown: string | null;
  gradedAt: Date | null;
  student: { id: string; displayName: string | null; email: string | null;
             githubUsername: string | null };
};
// headSha !== gradedHeadSha  →  "revised since grading"

type TestRun = {
  id: string; headSha: string;
  trigger: 'MANUAL' | 'WEBHOOK';
  // ERRORED means the infrastructure failed — fetching the archive, the sandbox, the
  // setup command. It is never a zero score, and must not be shown as one. COMPLETED
  // with failures is a successful run of a suite the student did not pass.
  status: 'RUNNING' | 'COMPLETED' | 'TIMED_OUT' | 'ERRORED';
  runnerPreset: string;
  testsTotal: number | null; testsPassed: number | null;
  testsFailed: number | null; testsSkipped: number | null;
  passRate: number | null;       // NOT the score. null for an empty suite.
  results: { suite: string; name: string; status: 'passed' | 'failed' | 'skipped';
             message?: string }[];
  tamperedPaths: { path: string; kind: 'modified' | 'removed' | 'renamed' }[];
  stdoutTail: string | null; stderrTail: string | null; errorDetail: string | null;
  startedAt: Date; finishedAt: Date | null;
  durationMs: number | null; setupDurationMs: number | null;
};

type GradingDraft = {
  id: string; headSha: string;
  status: 'GENERATING' | 'READY' | 'NEEDS_MANUAL_REVIEW' | 'FAILED'
        | 'SUPERSEDED' | 'APPROVED';
  errorDetail: string | null;    // for NEEDS_MANUAL_REVIEW, one reason per line
  modelMetadata: {
    provider: string; promptVersion: string; gradingAssetsCommitSha: string;
    usage: { promptTokens: number; completionTokens: number;
             cachedPromptTokens: number; cacheWriteTokens: number };
    sectionsGraded: string[]; sectionsNotSubmitted: string[];
  } | null;
  createdAt: Date;
  approvedAt: Date | null;       // non-null means the student has read this
  postedPrCommentId: bigint | null;  // null after approval = comment never posted
  sections: GradingDraftSection[];
};

type GradingDraftSection = {
  id: string;
  sectionType: 'short_response' | 'coding_algorithm' | 'coding_sql' | 'coding_frontend';
  reportMarkdown: string | null;      // what the model wrote
  scoreEarned: number | null; scorePossible: number | null;
  rubricItems: { label: string; criterion: string;
                 scoreEarned: number; scorePossible: number; note: string | null }[];
  // Short codes, rendered as badges. Each names why points were lost.
  //   writing:   MECHANICAL | CLARITY | MARKDOWN | STRUCTURE
  //   technical: INCOMPLETE | UNDERSTANDING | TERMINOLOGY
  //   test evidence, exactly one per section:
  //     TEST_EVIDENCE      — claims checked against a real run
  //     NO_TESTS_EXPECTED  — this section has no suite by design; ordinary
  //     TEST_RUN_MISSING   — tests expected, no run at this commit; a fault
  //     TEST_MATCH_MISSING — tests ran, the section's pattern matched none; a fault
  //   added by the pipeline: LOW_CONFIDENCE
  //     ARITHMETIC_MISMATCH | REPORT_TEXT_SCORE_MISMATCH | INTERNAL_LABEL_IN_REPORT
  //     TEST_CLAIM_CONTRADICTION | UNKNOWN_TEST_CLAIMED | FULL_CREDIT_DESPITE_FAILURES
  //     PROTECTED_PATHS_CHANGED | SCORE_OUT_OF_RANGE
  flags: string[];
  instructorNotes: string[];          // prose, NEVER shown to the student
  confidence: 'HIGH' | 'LOW' | null;
  submissionProcessNote: string | null;
  editedReportMarkdown: string | null;  // the instructor's revision, if any
  editedScoreEarned: number | null;
  editedAt: Date | null;
};
// What to display is `editedReportMarkdown ?? reportMarkdown`, and
// `editedScoreEarned ?? scoreEarned`.
```

## Do not

- Do not show `instructorNotes` anywhere a student could see them, and do not merge them
  into the report body.
- Do not use a modal for the whole grading review; an instructor needs the code, the
  tests, and the report at once.
- Do not add a "reject" or "regrade with different instructions" control. Regenerating
  and editing are the two actions that exist.
- Do not invent fields. If something seems missing, leave the space for it rather than
  inventing a name.

## Voice

The audience is early-career engineers and the people teaching them. Plain, direct,
encouraging, never cute. Empty states say what to do next. Error states say what
happened and what to try. No exclamation marks, no emoji.
