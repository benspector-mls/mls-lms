# Vercel V0 prompt — Marcy LMS interface

Copy everything below the line into V0. It describes the interface only; the backend
exists and is not part of this task.

Keep this file in step with the tRPC routers. The types in it are copied from what the
procedures actually return, and a prompt that invents field names produces components
that cannot be wired up.

---

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
Responsive: instructors use a laptop, students often a phone.

## The thing that makes this interface hard

**The application drafts grades; it does not issue them.** Every automatically produced
score is a proposal that an instructor accepts, edits, or rejects, and the interface's
job is to make the reasons for doubt visible rather than presenting every number with
the same confidence. Four things must never be flattened into a generic "status" chip:

1. **A score checked against a real test run** and one resting only on a model reading
   the code are not equally trustworthy. Say which is which, in words.
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

**Feedback accumulates.** A student who resubmits gets a second report about different
work; earlier rounds stay, collapsed behind "Earlier feedback (N rounds)", each labelled
with its date and score. Reading them in order is how a student sees what changed, so
design that as a feature rather than an archive.

### 3. `/instructor/assignments/[assignmentId]` — the grading queue

The screen where the real work happens. One row or card per student submission, showing
the student, status, late badge, "revised since grading" badge, links to the repository
and pull request, and the current commit.

Sorting and filtering matter here: an instructor grading a cohort of twenty-five wants
the ones needing attention first. Offer filters for "needs review", "not yet graded",
"revised since grading", and "graded".

Each submission expands to two panels.

**Test results.** Suite name, pass count, duration, and the individual test names with
their status. Also, when present, a list of protected files the student changed — test
files, configuration — which is a signal worth showing prominently but is **not** a
score. Include a "Run tests" button and a run history.

> Design note: the pass rate is *not* the grade. A submission can pass every test and
> still score poorly for hardcoded values or poor structure. Never render pass rate as
> if it were the score, and never place them so close together that they read as the
> same number.

**Grading drafts.** For each section of the assignment (a checkpoint has two — a short
response and a coding section, graded against different rubrics with different point
values), show:

- The section score and percentage.
- A badge saying **"test claims verified"** or **"no test evidence"**, and for the
  latter a sentence: nothing automatic constrains this score, read the code first.
- Flag badges (short codes, see the types below).
- A visibly separate block, **"The model's caveats — not shown to the student"**,
  holding prose notes for the instructor.
- The report itself. **Default to raw markdown in a monospace block**, with a "Preview"
  toggle that renders it exactly as the student will see it. Raw is the default on
  purpose: the instructor is deciding whether to send this text, and markdown that does
  not render is a defect they need to see.
- An **Edit** control giving a textarea for the report and a number input for the score.
  Warn inline when the score written in the report text disagrees with the score in the
  input — approving is blocked while they disagree. Offer "Discard my edits" to restore
  the model's original, and badge an edited section as "edited by you".
- An **Approve** button that confirms before acting, because it posts to GitHub and puts
  text in front of a student. The confirmation should say what will happen in plain
  words, not just "Are you sure?".

Draft history is collapsed by default. Approved drafts are labelled "sent to the
student" with a date; unapproved ones are proposals.

### 4. `/instructor/courses/[courseId]/gradebook` — new, does not exist yet

A table: students down the side, assignments across the top, scores in the cells. Show
completion against the threshold rather than only a raw score, mark late submissions,
and make ungraded cells obviously different from zero-scored ones. A student who did not
submit and a student who scored zero are not the same thing and must not look alike.

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
  //   added by the pipeline: TEST_EVIDENCE | NO_TEST_EVIDENCE | LOW_CONFIDENCE
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

- Do not render the instructor's report view as HTML by default. Raw first, preview
  behind a toggle.
- Do not show `instructorNotes` anywhere a student could see them, and do not merge them
  into the report body.
- Do not present a section with `NO_TEST_EVIDENCE` with the same visual weight as a
  verified one.
- Do not display `passRate` as the grade.
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
