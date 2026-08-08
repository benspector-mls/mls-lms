# mls-lms roadmap

How the built system works is in [README.md](README.md). This file is only what is left to do.

- [The order of work](#the-order-of-work)
- [Outstanding verification](#outstanding-verification)
- [Phase 4: triggering and orchestration](#phase-4-triggering-and-orchestration)
  - [Whether grading should be automatic at all](#whether-grading-should-be-automatic-at-all)
  - [If it does become automatic](#if-it-does-become-automatic)
  - [The problem this must solve](#the-problem-this-must-solve)
  - [Candidate design A: job table with a worker process](#candidate-design-a-job-table-with-a-worker-process)
  - [Candidate design B: Vercel Workflow](#candidate-design-b-vercel-workflow)
  - [E2B does not remove the need to choose](#e2b-does-not-remove-the-need-to-choose)
  - [Comparison](#comparison)
  - [What to know about Workflow before choosing Design B](#what-to-know-about-workflow-before-choosing-design-b)
- [Phase 7: assignment authoring — done](#phase-7-assignment-authoring--done)
    - [What manual grading meant for the machinery — done](#what-manual-grading-meant-for-the-machinery--done)
    - [`FILE_UPLOAD` file storage — done](#file_upload-file-storage--done)
  - [Step 0. The kind axis — done](#step-0-the-kind-axis--done)
  - [The principle this hangs on](#the-principle-this-hangs-on)
  - [Step 1. A catalogue per kind](#step-1-a-catalogue-per-kind)
  - [Step 2. One schema for an assignment's shape — done, as `lib/assignments/spec.ts`](#step-2-one-schema-for-an-assignments-shape--done-as-libassignmentsspects)
  - [Step 3. Procedures — done, in `trpc/routers/assignments.ts`](#step-3-procedures--done-in-trpcroutersassignmentsts)
  - [Step 4. `distributedAt` becomes the publish flag — done](#step-4-distributedat-becomes-the-publish-flag--done)
  - [Step 5. Screens — done](#step-5-screens--done)
  - [Files](#files)
  - [Phase 7 verification](#phase-7-verification)
  - [Not in this phase](#not-in-this-phase)
- [Modules, and where an assignment's repositories come from](#modules-and-where-an-assignments-repositories-come-from)
  - [This reverses Step 1, deliberately](#this-reverses-step-1-deliberately)
  - [Phase 1: modules are rows — done](#phase-1-modules-are-rows--done)
  - [Phase 2: an assignment names its own repositories — done](#phase-2-an-assignment-names-its-own-repositories--done)
    - [The copy is asynchronous, which is why `accept` waits](#the-copy-is-asynchronous-which-is-why-accept-waits)
  - [What is verified](#what-is-verified)
- [Token management](#token-management)
- [A code review pass](#a-code-review-pass)
  - [An automated test suite](#an-automated-test-suite)
- [Salesforce synchronization](#salesforce-synchronization)
  - [Questions I need answered](#questions-i-need-answered)
  - [What may need to be built on the Salesforce end](#what-may-need-to-be-built-on-the-salesforce-end)
  - [The shape of the work here, once those are answered](#the-shape-of-the-work-here-once-those-are-answered)
- [Getting a cohort into the application](#getting-a-cohort-into-the-application)
  - [Removing and archiving make lists go quiet; they never take work back](#removing-and-archiving-make-lists-go-quiet-they-never-take-work-back)
- [Course creation — done](#course-creation--done)
  - [Copying, and the order it has to happen in](#copying-and-the-order-it-has-to-happen-in)
  - [Archiving](#archiving)
- [Student enrollment — done](#student-enrollment--done)
  - [What the schema loses](#what-the-schema-loses)
  - [The seven readers](#the-seven-readers)
  - [Not in this design](#not-in-this-design)
- [A removed student's work — done](#a-removed-students-work--done)
  - [The short name stopped being editable](#the-short-name-stopped-being-editable)
  - [The short name names the course as well as the term](#the-short-name-names-the-course-as-well-as-the-term)
  - [The check scripts were reporting passes they had not earned](#the-check-scripts-were-reporting-passes-they-had-not-earned)
- [Course switching — done](#course-switching--done)
  - [The claim this document had wrong](#the-claim-this-document-had-wrong)
- [A student's record — done](#a-students-record--done)
- [A cohort's views became the sidebar — done](#a-cohorts-views-became-the-sidebar--done)
  - [Co-teaching, which the settings screen needed and nothing had](#co-teaching-which-the-settings-screen-needed-and-nothing-had)
- [Seeing a course as a student sees it](#seeing-a-course-as-a-student-sees-it)
- [Targeted assignments, and excusing a student](#targeted-assignments-and-excusing-a-student)
- [Course ownership — done](#course-ownership--done)
  - [What checking it found](#what-checking-it-found)
- [Archived courses need a way back, and a way out — done](#archived-courses-need-a-way-back-and-a-way-out--done)
- [Copying an assignment into another cohort — done](#copying-an-assignment-into-another-cohort--done)
- [More kinds of thing a student can hand in](#more-kinds-of-thing-a-student-can-hand-in)
- [Dividing grading between co-teachers](#dividing-grading-between-co-teachers)
- [Working a pile by what it is, not only by what it needs](#working-a-pile-by-what-it-is-not-only-by-what-it-needs)
- [The Modules screen shows the course the way a student meets it — done](#the-modules-screen-shows-the-course-the-way-a-student-meets-it--done)
  - [Two check scripts were reporting a hole that was not there](#two-check-scripts-were-reporting-a-hole-that-was-not-there)
- [Content that is not an assignment](#content-that-is-not-an-assignment)
  - [Ordering, which is settled and needs no new column](#ordering-which-is-settled-and-needs-no-new-column)
  - [A Resources page, and a course-level list](#a-resources-page-and-a-course-level-list)
  - [The three kinds](#the-three-kinds)
- [Small things](#small-things)
- [An admin view for approving instructors — done](#an-admin-view-for-approving-instructors--done)
  - [The constraint this must not violate](#the-constraint-this-must-not-violate)
  - [What the build decided that the design did not](#what-the-build-decided-that-the-design-did-not)
- [What to verify for all three](#what-to-verify-for-all-three)
- [AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments)
  - [Instructor-authored rubrics are a prerequisite, not a companion](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion)
- [Open thinking: where rubrics, answer keys, and sample reports live](#open-thinking-where-rubrics-answer-keys-and-sample-reports-live)
- [Scaling: what a hundred students costs, and where it breaks](#scaling-what-a-hundred-students-costs-and-where-it-breaks)
- [Deferred, with the schema left open](#deferred-with-the-schema-left-open)
- [Open items](#open-items)

---

## The order of work

The sequence, most immediate first. A feature's own section says what is known and what is still undecided about it; several are a heading and a paragraph because the thinking has not been done yet, and saying so is more useful than inventing detail.

**Nothing about running a cohort needs the database any more**, which is what moved measurement to the front. A course can be created, copied, filled from a join link, co-taught, and retired; somebody can be made staff by an admin and added to a cohort by whoever runs it. The first admin of a deployment is still a hand-edited row, necessarily, because there is nobody to grant it — `npm run grant:admin` is that base case as a tool.

**Two things ahead of that turned out to be gaps rather than features**, and both are closed. A cohort could be archived and then reached from nowhere in the interface, which contradicted what archiving is supposed to mean; and a course's creator could be removed from it by anybody who taught alongside them, which was the one permission in the application that nothing guarded. Deleting an archived cohort went with them, since it is the half of archiving that needed ownership to gate on.

The ordering principle is: correctness gaps, then the cheap things, then measurement, then a review of code that already works, then the features that add real surface area. Measurement before the review because a real cohort produces figures rather than estimates; the review before the large features because every one of them adds readers to the parts it would touch.

1. **[Small things](#small-things)** — the breadcrumb should name the cohort. Do it whenever something else is open in that file.
2. **[Token management](#token-management)** — what a report costs and where the cost actually is. The disclosure half is already built: [nothing a student commits that git was told to ignore reaches the model](README.md#what-a-student-commits-and-what-reaches-the-model). Better after a real cohort has run, which gives measurements rather than estimates.
3. **[A code review pass](#a-code-review-pass)** — Prisma usage, logic, architecture, and organization. Includes [adding an automated test suite](#an-automated-test-suite), which is decided rather than open.
4. **[Working a pile by what it is, not only by what it needs](#working-a-pile-by-what-it-is-not-only-by-what-it-needs)** — grading every resubmission at a sitting. A second axis over triage rather than a new bucket, for a reason worth knowing before building it.
5. **[Dividing grading between co-teachers](#dividing-grading-between-co-teachers)** — now that a cohort can have more than one instructor, nothing says who grades what.
6. **[Content that is not an assignment](#content-that-is-not-an-assignment)** — readings, rich text, embedded video, plus a Resources screen to author them. The largest of these, because it puts a second kind of thing under a module and every reader that assumes otherwise has to learn about it.
7. **[Salesforce synchronization](#salesforce-synchronization)** — blocked on a conversation with the consultants who built our Salesforce implementation. The questions that conversation has to answer are written out below. Note that it manages assignment records as well as submission records, so it depends on assignment authoring rather than merely following it.
8. **[Seeing a course as a student sees it](#seeing-a-course-as-a-student-sees-it)** — a test enrollment an instructor can look through. Its design is the one part of this area still open.
9. **[Student enrollment](#student-enrollment--done)**, remaining half: [targeted assignments and excusing a student](#targeted-assignments-and-excusing-a-student).
10. **[AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments)** — which begins with [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), since none of the four fixed section types fits a resume or a reflection. No longer deferred.

Items 1 and 4 through 6 are new and their ordering relative to each other is a proposal rather than a decision.

[Scaling](#scaling-what-a-hundred-students-costs-and-where-it-breaks) is not on the list and is not meant to be. It is a set of questions to hold rather than work to schedule, and most of what would answer them is measurement that [token management](#token-management) produces anyway.

**Done, and described in [getting a cohort into the application](#getting-a-cohort-into-the-application):** [course creation](#course-creation--done) and [student enrollment](#student-enrollment--done). A cohort can now be started, copied from a previous one, filled from a join link, co-taught, retired, found again afterwards, and finally deleted — and [who owns it](#course-ownership--done) decides which of its instructors can do the last three.

[Triggering and orchestration](#phase-4-triggering-and-orchestration) is deliberately not in that list. Generating a report is an instructor action per submission today, which works, and the batch version is a convenience rather than a blocker. It stays written down because the decision will eventually be needed and the reasoning is already done.

---

## Outstanding verification

Everything in the README's [what is verified](README.md#what-is-verified-and-how) section has been checked against real repositories. These are the gaps in it.

1. **A Python assignment on `python-pytest`**, for results shaped identically to the Jest ones. No Python template exists in `assignment-templates/` yet.
2. **`allowStudentDependencies: true`** against an assignment that genuinely asks students to add a dependency to the repository's **root** `package.json`. No current assignment does — `swe-1-3-node-modules` looked like the candidate and turned out not to be, since its dependency lives in a nested package. Note that the default presets install with `--ignore-scripts`, so a dependency needing an install script to fetch a platform binary needs an override.
3. **A student repository generated from a template *before* the `score-tests` cleanup, graded against the cleaned template.** The reasoning says it works — the wholesale devDependency restore drops `score-tests`, the template's clean specs replace the student's, and the surviving `preinstall` never runs under `--ignore-scripts` — but it is unverified until the cleaned `swe-1-4-loops` template is pushed to the organization. The existing student repository is exactly that case.
4. **`npm run verify:resubmission -- swe-1-4-loops --post`** has never been run. The behavior it covers was verified by hand — a second approval posts a distinct second comment rather than editing the first — so this is about making that check re-runnable rather than about an unknown. It costs a real model call and posts a real comment to the pull request.

---

## Phase 4: triggering and orchestration

The only architectural decision still open. Test execution and report generation are both callable as a plain function taking a submission id, so nothing built so far depends on how this is answered — and the question it answers has changed since it was first written.

### Whether grading should be automatic at all

The original design had the webhook start a run on every `opened`, `reopened`, and `synchronize`. That is worth reconsidering before it is built, because each run costs real money and most of them would be wasted.

A student who opens a pull request, closes it, opens another, and pushes six more commits generates a report per event. None of the intermediate ones is read by anybody. At roughly $0.15 a report and a cohort of twenty-five, a week of ordinary student behavior is a meaningful bill for drafts nobody looks at — and every one of them lands in the instructor's queue as something to scroll past.

The alternative is a **grading session**: the instructor sits down, presses "generate pending reports", and the application grades every submission whose current commit has no draft. One report per submission per state of the code, generated when somebody is actually about to read it. Cost tracks the work an instructor does rather than the commits a student makes, and there is nothing to prune.

It also fits how grading actually happens, which is in batches at a sitting rather than continuously.

This does not need the webhook to trigger anything, so the requirements below are about the batch, not about responding to GitHub inside ten seconds:

1. The intent to grade is recorded durably before work begins, so a submission is never silently skipped.
2. Work that fails partway through can be retried without repeating what already succeeded.
3. The same submission is never graded twice concurrently.
4. A batch of twenty-five submissions is not bound by one function invocation's time limit, though a single submission comfortably is.
5. Progress is readable from PostgreSQL while the batch runs, because the instructor is watching it.

Requirement 4 is the only one that still argues for anything beyond a plain function. **A single submission takes about two minutes at the worst measured case against a 300-second limit**, so fanning out one invocation per submission satisfies it without a worker process or step-by-step continuation. The measurements are in [what a report costs](README.md#what-a-report-costs) and the sandbox durations recorded in `test_runs.duration_ms`.

The designs that follow were written for the automatic version and are kept because the durability and concurrency questions are the same either way.

### If it does become automatic

The webhook starts a run on `opened`, `reopened`, and `synchronize`, and marks any existing draft `SUPERSEDED` on `synchronize`. Everything before this phase is callable as a plain function taking a submission id, so this phase adds a caller and changes nothing else.

This is where the asynchronous job design is chosen. It is deliberately not decided yet, because nothing built so far needs it: the webhook's work is one database update, and test execution and report generation keep a human waiting for the slow part on purpose.

### The problem this must solve

GitHub waits roughly 10 seconds for a webhook to return a response. If the response takes longer, GitHub marks the delivery as failed and sends the event again, which would cause the same pull request to be graded repeatedly and receive duplicate comments. Grading takes minutes: fetching files, installing dependencies, running the suite, and calling a language model.

So the webhook must respond immediately and the work must happen afterward. Doing the work without recording the intent first is not acceptable, because if the process stops partway through, that submission is never graded and no record exists showing that it should have been.

Requirements:

1. The webhook responds to GitHub within a few seconds.
2. The intent to grade is recorded durably before any work begins, so it survives a restart or a deployment.
3. Work that fails partway through can be retried without repeating what already succeeded.
4. The same submission is never graded twice concurrently.
5. Total elapsed grading time may exceed the time limit of a single Vercel function invocation.
6. Grading status is readable from PostgreSQL, because the instructor interface displays it.

### Candidate design A: job table with a worker process

What the predecessor application does. The webhook inserts a row into `grading_jobs` with status `queued`. A separate always-running Node process loops: claim a queued row, grade it, mark it complete, repeat.

The claim query uses `SELECT ... FOR UPDATE SKIP LOCKED`, meaning: return one queued row, lock it so no other worker can take it, and if a row is already locked, skip past it rather than waiting. That satisfies requirement 4 even with several workers running.

Requirement 5 is satisfied because the worker runs continuously with no invocation limit. The cost is that same property: a worker needs a host that runs continuously, and Vercel does not provide one, because Vercel runs functions that start when a request arrives and stop when it returns. This means a second host such as Fly.io or Railway.

### Candidate design B: Vercel Workflow

The webhook calls `start(gradeSubmissionWorkflow, [...])`, which returns immediately. The grading program is one function calling several smaller functions, each marked `"use step"`. Vercel runs each step as its own invocation and records the step's result to storage before continuing.

Because each step is a separate invocation, total elapsed time is not limited by any single invocation's limit, satisfying requirement 5 with no continuously running host. Recorded step results satisfy requirement 2 and per-step retry satisfies requirement 3.

Under this design `grading_jobs` is not needed. `grading_drafts.status` already carries the values the instructor interface reads, and would gain a `workflowRunId` column.

### E2B does not remove the need to choose

E2B runs student code on E2B's own infrastructure, which removes the requirement for a host that can run Docker. It does not remove requirement 5: the code still waits for the sandbox result and then for the language model, so total elapsed time can still exceed a single invocation's limit.

Test execution measures the first half of that time for real. Once a few dozen runs are recorded, `test_runs.duration_ms` answers the question this decision actually turns on: whether test execution alone already approaches the limit, or whether it is the model call that pushes the total past it.

### Comparison

|                                          | Design A: job table and worker               | Design B: Vercel Workflow                        |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Where the durable record lives           | A row in PostgreSQL                          | Recorded step results, plus a status column      |
| Requires an always-running host          | Yes                                          | No                                               |
| Job may exceed one function's time limit | Not applicable; the worker runs continuously | Yes; work is divided across invocations          |
| Retry logic                              | You write it                                 | Provided per step                                |
| Portable to other hosting                | Yes                                          | The step functions are; the orchestration is not |
| Debugging method                         | Standard Node debugging                      | Framework-specific inspection tools              |
| Maturity                                 | Established since PostgreSQL 9.5 in 2016     | Recent                                           |
| Places to check when a job fails         | One                                          | Two                                              |

If the debugging and maturity rows matter more than running one small additional host, Design A is a reasonable choice and this plan does not argue against it.

### What to know about Workflow before choosing Design B

Three properties follow from a single mechanism, and they are where mistakes are most likely.

**The mechanism is replay.** When a workflow resumes after an interruption, the runtime does not restore a paused program. It executes the orchestrating function again from its first line. Step calls that already completed return their recorded results instead of running a second time.

If the orchestrator calls four steps and step 3 fails:

| Execution | Step 1                  | Step 2                  | Step 3 | Step 4      |
| --------- | ----------------------- | ----------------------- | ------ | ----------- |
| First run | runs                    | runs                    | fails  | not reached |
| Retry     | returns recorded result | returns recorded result | runs   | runs        |

The orchestrator body executed twice; steps 1 and 2 executed once each.

**Consequence 1: the orchestrator runs in a restricted environment.** Because its body runs repeatedly, any side effect written directly inside it would repeat too. The runtime therefore removes the ability to perform side effects there:

| Not available inside `"use workflow"`           | Replacement                                |
| ----------------------------------------------- | ------------------------------------------ |
| The global `fetch` function                     | `import { fetch } from "workflow"`         |
| `setTimeout`, `setInterval`                     | `sleep("5s")` from `"workflow"`            |
| Node built-in modules such as `fs` and `crypto` | Move the code into a `"use step"` function |

Step functions run in a normal Node environment without these restrictions. In practice this means database access must be inside a step. Prisma requires both Node modules and network access, so a Prisma query placed in the orchestrator fails.

```ts
// Incorrect: database access in the orchestrator
export async function gradeSubmission(id: string) {
  "use workflow"
  const submission = await db.submission.findUnique({ where: { id } })  // fails
}

// Correct: database access inside a step
async function loadSubmission(id: string) {
  "use step"
  return db.submission.findUnique({ where: { id } })
}

export async function gradeSubmission(id: string) {
  "use workflow"
  const submission = await loadSubmission(id)
}
```

The rule: the orchestrator chooses the order of operations, and steps perform operations.

**Consequence 2: the orchestrator must be deterministic.** Each execution must call the same steps in the same order given the same inputs, because the runtime matches recorded results to step calls by their position in the sequence. A value that differs between executions must not affect which steps are called:

```ts
export async function gradeSubmission(id: string) {
  "use workflow"
  const startedAt = Date.now()           // a different value on every replay
  const result = await runTests(id)

  if (Date.now() - startedAt > 60_000) {  // may be true on one execution, false on another
    await recordSlowRun(id)               // so this step may or may not be called
  }
}
```

The same applies to `Math.random()`. Generate such values inside a step, where the result is recorded once and returned unchanged on replay, or pass them in as arguments to the workflow.

**Consequence 3: values crossing a step boundary must be serializable**, because they are written to storage and read back. Plain objects, arrays, strings, numbers, and `Date` are supported; functions and class instances are not. Prisma query results are plain objects, so this is normally satisfied without effort.

---

## Phase 7: assignment authoring — done

Every kind is creatable, publishable, submittable, and gradable, and nothing in this phase is outstanding. Kept because the decisions it settled are load-bearing for what comes next, and the reasoning is worth having in one place — not least that adding a fourth kind, `EXTERNAL_URL`, was an afternoon rather than a rewrite, which is what naming the axis in Step 0 bought.

An instructor can now put every assignment they give into one place, and the ones the pipeline cannot grade are graded by hand in the same interface as the rest. How each kind is distributed, collected, and graded is in the README — [the loop](README.md#the-loop), [`accept` and `submitWork`](README.md#github-integration), [handing in a file](README.md#handing-in-a-file), and [grading by hand](README.md#grading-by-hand).

**Scope was assignment authoring only**: creating, editing, duplicating, and removing assignments within a course that already exists. [Course creation and the join link](#getting-a-cohort-into-the-application) come after; note that nothing writes an enrollment today, so a newly created course would have no way to gain students.

What is deliberately *not* here, and is [item 8](#the-order-of-work): AI grading for the two non-repository kinds. That needs to read a Google Doc's contents or an uploaded file, which needs Drive or storage access, and it needs [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), since none of the four fixed section types describes a resume or a reflection.

`prisma/seed.ts`'s `SEED_ASSIGNMENTS` map is now redundant and should shrink to the minimum needed for a working local database rather than keep pretending to be a curriculum registry. That is on the [code review pass](#a-code-review-pass).

#### What manual grading meant for the machinery — done

All of it is built and described in [the README](README.md#grading-by-hand): `IMPLEMENTED_KINDS` covers every kind, `accept` branches on the kind, `submissions.submitWork` is the submission signal where there is no webhook, delivery reports three outcomes rather than two, triage has a `needs_manual_grade` bucket, and `gradingDrafts.startManual` opens the empty draft an instructor writes into.

Two decisions from that work are worth keeping here rather than only in the code, because both closed off a direction.

**One grading mode per assignment.** A mix of pipeline-graded and hand-graded sections in one assignment is refused by `assignmentSpecSchema`. It was expressible for a week and nothing in the curriculum was ever one; supporting it means a generated draft covering some of an assignment's sections and not others, which makes the assignment's point total exceed what approving can record — a 30-point assignment releasing as 20 out of 20. Two assignments is the answer, and one section per assignment is where this is heading anyway. The two non-repository kinds accept only manual sections for a stronger version of the same reason: an AI section on a document would validate, save, sit in the queue as a report waiting to be generated, and fail on the missing pull request at the moment an instructor asked for it.

**The thin case given up** is a coding repository with a hand-marked reflection inside it, which cannot be split into two assignments because each generates its own repository. It is thin because the hand-graded kinds are precisely the ones with no repository: a reflection living inside a coding repo is a `short_response` section the pipeline already grades and is calibrated on.

#### `FILE_UPLOAD` file storage — done

Built, and described in [the README](README.md#handing-in-a-file). Every decision the outline anticipated went the way it expected — a private bucket, a path keyed by submission id, types on the assignment and the limit global, its own columns rather than reusing `submittedUrl`, and a signed download — so what is worth keeping here is the two things the outline did not anticipate.

**Uploading is one request rather than a signed upload URL**, and that is a durability decision rather than a convenience. Minting a URL and letting the browser send bytes straight to storage leaves a window where the object exists and the submission was never marked handed in — a student who closed the tab in that window has work in a bucket that nothing points at, which is the same silent-never-reviewed failure `submitWork` exists to prevent. One request closes it and lets our own code check the size and the type before a byte is stored. The cost is a second entry point, paid for by `assertCanHandIn` being the one implementation of who may hand in, called by the route and by `submitWork` alike.

**The upload is the submission**, so `submitWork` now refuses `FILE_UPLOAD` exactly as it refuses `REPO`. Before this, a student could press submit on a file-upload assignment and enter the queue with nothing to open.

### Step 0. The kind axis — done

Before any form, the schema had to stop assuming "assignment" means "GitHub repository."

- **`AssignmentKind` enum**, three values named at the outset — `REPO`, `GOOGLE_DOC`, `FILE_UPLOAD` — and, at the time, only `REPO` implemented. Naming the axis before building any of it is what forced every code path to say which kinds it handles rather than silently working for one and breaking on another, and it is why making the other two real was a week's work rather than a rewrite. `IMPLEMENTED_KINDS` in `lib/assignments/spec.ts` now holds four: `EXTERNAL_URL` was added later and the compiler named every place that had to decide about it — the kind label, the badge icon, the form's two exhaustive records, and the accept refusal. Nothing had to be searched for.
- **`templateRepo`, `assignmentRepoName`, and `githubOrg` are now nullable columns**, required only when `kind` is `REPO`. The requirement lives in the Zod schema, not the column, because a column cannot express "required for one kind" and a `NOT NULL` would force a Google Doc assignment to invent a repository name. `@@unique([courseId, assignmentRepoName])` needed no migration to accommodate this — Postgres treats NULLs as distinct in a unique constraint.
- **`lib/assignments/spec.ts`** holds `assignmentSpecSchema`, a Zod discriminated union on `kind`. `parseAssignmentSpec` returns `pointValue` computed from the sections rather than accepting it, so no input can make the total disagree with the reports beneath it. `repositorySource(assignment)` is the one place every repository-assuming code path narrows the three nullable columns, and it distinguishes three failures that must not be reported as one another: `NotRepositoryBackedError` (a Google Doc assignment — it works, and the caller asked it a question about repositories), `UnsupportedAssignmentKindError` (a kind nobody has built), and `AssignmentConfigurationError` (a `REPO` row missing a column — a row that should never have been written, naming which column).
- **`prisma/seed.ts` now calls `parseAssignmentSpec`** instead of computing the point total and writing columns directly, so the seeded shape and the future authored shape are validated by the same rules and cannot drift.
- **`lib/sandbox/run-tests.ts`, `lib/grade/generate-report.ts`, and `trpc/routers/assignments.ts`** — the three places that read a repository off an assignment — now go through `repositorySource` rather than reading `templateRepo` off the row directly. The compiler found all three once the columns went nullable, which is the point of doing this before the form: `tsc` enumerates the coupling instead of a grep hoping to find it.
- **`scripts/verify-authoring.ts`** (`npm run verify:authoring`) checks the schema as pure functions: point values are refused when absent or zero and cannot be set on the assignment directly, an unknown section type or kind is refused, a `testNamePattern` with no `evidence: "tests"` is refused (silently ignored otherwise, which grades with no test evidence while looking like it consulted some), a Google Doc assignment accepts no repository or runner fields and they come out null, and `repositorySource` throws the right error for each of the two failure cases above.

The compiler found all three places that read a repository off an assignment once the columns went nullable, which is the point of doing this before the form: `tsc` enumerates the coupling instead of a grep hoping to find it. Making `grading_drafts.head_sha` nullable later did the same thing for the three places that print a commit.

### The principle this hangs on

An assignment's `sections` array decides which rubric applies, which answer keys are loaded, and which tests count as evidence for which section. It is the highest-leverage and least forgiving data in the system: a wrong rubric or a mistyped answer key path does not throw, it produces a **confident wrong grade** discovered hours later, or a `NEEDS_MANUAL_REVIEW` whose cause is not obvious.

So validate at authoring time against the real sources, using the machinery grading already uses. The form refuses to save a mapping that would fail at grading time. Every field has something real to check against, which is what makes this tractable:

| Field                 | Checked against                                                                | Existing code                               |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| `templateRepo`        | readable by the installation that generates from it, and a template repository | `getRepo` — `lib/github/repos.ts`           |
| `answerKeyRepo`       | readable, and private                                                          | `getRepo`, `installationIdForOwner`         |
| `answerKeyDir`        | a folder in `answerKeyRepo` holding at least one reference file                | `checkAnswerKeyDir` — `lib/grade/assets.ts` |
| `runnerPreset`        | a known preset that resolves                                                   | `resolveRunner` — `lib/sandbox/presets.ts`  |
| `sections[].type`     | one of the four with a rubric heading                                          | `SECTION_ASSETS` — `lib/grade/assets.ts`    |
| `sections[].rubricId` | the four seeded `Rubric` rows                                                  | database                                    |
| `moduleId`            | a module of *this* course                                                      | database, plus a foreign key                |

### Step 1. A catalogue per kind

**Superseded, and worth reading only as the reasoning it replaced.** An assignment names its own repositories — see [modules and where an assignment's repositories come from](#modules-and-where-an-assignments-repositories-come-from). The listing machinery this step built is still used, one level down, to tick answer-key files out of whichever repository an assignment names.

**The form's first question is the kind, and the kind selects the catalogue.** Each kind's catalogue answers the same two questions through its own interface — `list()` what exists, `resolve(choice)` into the fields that populate the form — so adding a kind later means writing one new file against that interface rather than reopening this one.

**`REPO`: the answer-keys repository as the catalogue.** `answer-keys/{moduleTag}/{assignmentRepoName}/` is already the shape the seed encodes. Reading it rather than asking an instructor to retype it does two things: it removes the most error-prone field, and it makes the repository the **single source of truth for what repository-backed assignments the curriculum contains**. Adding one to a course becomes picking one that exists; putting a new directory in the repository is what makes a new assignment available to add. There is no second list to keep in step.

**Built.** `AssetSource` gained `list`, implemented as `listRepoDirectory` in `lib/github/files.ts`, and the three catalogue functions are exported from `lib/grade/assets.ts`: `listAssignmentDirs(moduleTag)`, `listAnswerKeys(moduleTag, repoName)`, and `checkAnswerKeyPaths(paths)` for live validation. All three go through `assetSource()` and the existing `answerKeyPathIn()` guard, so the catalogue lists what grading would read and cannot admit a path grading would refuse.

Three decisions worth knowing, each made because the obvious alternative was worse:

- **`listAnswerKeys` recurses.** `swe-1-3-node-modules` keeps its keys under `madlib-challenge/`, so a top-level listing would silently omit them and an instructor would tick an incomplete set. Depth is bounded at three, which is well past anything the curriculum uses.
- **`listRepoDirectory` is non-recursive, one request per directory.** The alternative — the git trees API with `recursive=1` — returns every path in a 23MB repository to find three answer keys.
- **`checkAnswerKeyPaths` reports a traversal path as a finding rather than throwing**, so one bad entry does not hide whether the others are right. The same guard still refuses it; only the reporting differs.

**The local-clone source was removed while this was being built**, which is why there is no longer a check comparing two sources: there is one. Two implementations of every read and listing meant a standing risk that an assignment authored against one and graded against the other would diverge silently, and every source after this one is external anyway — Drive for non-repository rubrics — so reading from disk was not going to generalize. See [where rubrics live](#open-thinking-where-rubrics-answer-keys-and-sample-reports-live).

**`GOOGLE_DOC` and `FILE_UPLOAD` have no catalogue, and one is still worth having for `GOOGLE_DOC`.** They are creatable without one — an instructor types the title and pastes the template link — which is the same drift problem the repository catalogue exists to prevent: nothing forces internal organization, so "what Google Doc assignments exist" has no single answer to check a new one against. The shape most likely to work, not yet designed in detail: a shared Drive folder per module plays the role `answer-keys/{moduleTag}/` plays for `REPO`, and an instructor picks a document from it rather than pasting an arbitrary link. That is one authentication story with [reading a student's document for grading](#ai-grading-for-non-coding-assignments), which is the argument for doing them together rather than now.

`FILE_UPLOAD` likely needs no catalogue at all: there is no pre-existing thing to pick from, since an instructor is describing a submission format rather than selecting among curriculum content.

### Step 2. One schema for an assignment's shape — done, as `lib/assignments/spec.ts`

Built in [Step 0](#step-0-the-kind-axis--done) as `assignmentSpecSchema`, a discriminated union on `kind` rather than a flat schema for the `sections` array alone — the union is what let the GitHub fields become "required for `REPO`, absent for the others" instead of always-required. `sectionsPointTotal` and `prisma/seed.ts` calling through `parseAssignmentSpec` are both done, described there.

### Step 3. Procedures — done, in `trpc/routers/assignments.ts`

**Built**, all nine of them, all `instructorProcedure` and all gated on `assertTeaches` — a new guard, because `assertCourseMember` admits an enrolled student and the INSTRUCTOR role says nothing about *which* courses. Without the course-level check, one cohort's instructor could author or delete in another's.

Two decisions that shaped the rest:

- **One validation function, called by the form and by every write.** `validateAssignmentDraft` in `lib/assignments/validate.ts` is what `validateDraft` returns findings from and what `create`, `update`, and `duplicate` refuse on. A check the form performs and the write does not is decoration; a check the write performs and the form does not is a refusal an instructor meets only after filling everything in.
- **Findings carry a severity.** `error` blocks saving — a module belonging to another course, an unreachable or non-template template repository, a public answer-key repository, a rubric that does not match its section type, a colliding repository name. `warning` does not, and is for what is legitimately true of a saved assignment: a missing answer key means grading proceeds without a reference solution, which is worse but not useless.

The rubric pairing is worth naming, because nothing else would catch it: `RUBRIC_NAME_BY_SECTION_TYPE` in `spec.ts` fixes which rubric each section type is graded against, and the procedures check the pairing an instructor submits rather than trusting it. A coding section graded against the short response rubric produces a confident report against criteria that do not apply to the work.

- **`validateDraft`** — what the form calls as fields change. Runs the whole table above for `REPO`, skips the GitHub-specific rows for the other kinds (already expressed in `assignmentSpecSchema`, so this procedure mostly wraps a `.safeParse` and turns Zod issues into per-field findings), and returns them. No writes.
- **`browseAnswerKeys({ answerKeyRepo, dir })`** and **`answerKeyOptions({ answerKeyRepo, dir })`** — one directory of the named repository, and everything beneath it.
- **`create`** — calls `parseAssignmentSpec` (built — see [Step 0](#step-0-the-kind-axis--done)), which is where `pointValue` and the kind-conditional requirements are already enforced, and writes with `distributedAt: null`.
- **`update`** — same validation. Refuses to change `assignmentRepoName` once any submission exists, because student repositories are already named after it.
- **`publish` / `unpublish`** — sets or clears `distributedAt`.
- **`duplicate({ assignmentId, targetCourseId, assignmentRepoName, dueAt })`** — copies a proven mapping. Built at the assignment level now so that course creation, later, becomes a loop over this rather than new logic.
- **`removalImpact({ assignmentId })`** — counts what deletion would destroy: submissions, approved feedback rounds, test runs, and the repository names that would be left behind on GitHub. Read-only, so the confirmation can state facts rather than generalities.
- **`remove({ assignmentId, confirmTitle })`** — deletes the assignment and everything cascading from it, whatever has been submitted.

  **The typed confirmation is enforced in the procedure, not the dialog.** It refuses unless `confirmTitle` matches the assignment's title exactly, which is the same shape as the approval guards: the interface warns, the procedure is what actually refuses. A guard that lives only in a dialog is decoration, and this is the one irreversible operation in the application.

  It returns what it destroyed, so the confirmation afterwards is also specific. Student repositories are deliberately **not** deleted from GitHub — losing a student's work because an instructor tidied a course would be a worse failure than an orphaned repository, and the names are reported so they can be cleaned up deliberately.

### Step 4. `distributedAt` becomes the publish flag — done

No migration: it already meant this and was read by nothing.

- **Done.** `assignments.listForCourse` filters to `distributedAt != null` unless the caller teaches the course.
- **Done.** `publish` and `unpublish`. Unpublishing is allowed even after students have accepted, deliberately — the reason to unpublish is usually that something is wrong, which is exactly when it should stop being handed out. Existing submissions and grades are untouched; this controls the listing, not the work.
- Still to build: the badge on the assignments list, which is Step 5.

This is what makes authoring safe: an assignment can be built over several sittings without a student seeing a half-finished one, and a mapping can be corrected before anyone is graded against it.

### Step 5. Screens — done

- `/instructor/courses/[courseId]/assignments/new` and `.../[assignmentId]/edit` — one client form component, `components/instructor/assignment-form.tsx`, with a `section-editor.tsx` sub-form. Validation findings render inline; save is disabled while any check fails.
- Entry points on `components/instructor/assignments-list.tsx`: a "New assignment" action in the header, and "Edit", "Duplicate", and "Remove" per row.
- **The first question the form asks is the kind**, which decides which fields appear at all — a Google Doc or file-upload assignment never shows `githubOrg` or a runner preset, rather than showing them disabled. For `REPO`, an instructor pastes the two repository URLs; the repository name follows the template's own name until they change it, the runner follows what the template's `package.json` says, `githubOrg` and the answer-key repository default to what the course's other assignments use, and the rubric follows from the section type. Answer key paths are ticked from a listing of the named repository. What is left to enter is what genuinely needs a person: the title, point values per section, the due date, and the test evidence pattern.
- **Nothing an instructor can select is typed by hand.** The runner preset is a select populated from `RUNNER_PRESETS`, not a text field — a typo'd preset is a grading failure weeks later, and the cheapest fix is an interface where the wrong value cannot be expressed. The same applies to the section type and the rubric. `lib/sandbox/presets.ts` carries no `server-only` import and neither does its one dependency, so the form imports the list directly rather than needing a procedure to enumerate it.

  The schema check stays regardless. A select is a convenience and the procedure is what refuses — the same division as the approval guards and the typed removal confirmation, for the same reason: the request that arrives can carry anything the browser did not send.
- Removal uses a dialog showing the counts from `removalImpact` and requiring the title to be typed — `components/instructor/remove-assignment-dialog.tsx`.

**Built.** Two pages under `app/(shell)/instructor/courses/[courseId]/assignments/`, `assignment-form.tsx`, `section-editor.tsx`, `remove-assignment-dialog.tsx`, and entry points on the assignments list: a "New assignment" action, a Draft badge on any unpublished row, and a per-row menu with Edit, Publish or Hide, Duplicate, and Remove.

The kind is the form's first question and is fixed once an assignment exists — changing it would change what its existing submissions are, and there is no migration from a pull request to a document. Choosing a non-repository kind hides the repositories card, the runner, and the answer-key browser entirely rather than disabling them, since those are questions that do not apply rather than settings left at a default. Only one of the two "add a section" buttons is ever offered, because [an assignment has one grading mode](#what-manual-grading-meant-for-the-machinery--done) and a button that builds a refused draft is worse than no button.

Worth knowing about how it validates: the form holds a *settled* copy of the draft that trails the live one by 600ms, and only that copy is sent to `validateDraft` — the checks make real GitHub calls, so a request per keystroke would be untenable. Saving is refused until the settled copy has actually been checked, rather than merely having no errors: a draft the server has not seen has no findings, which is not the same as being valid.

**What the form no longer asks for.** Three things came out after the first real use, all because asking was worse than deriving:

- **Test evidence was a checkbox and is now a rule.** Whether the suite covers a section follows from its type and from the assignment having a runner: a short response has nothing to execute, and every other type is checked against the suite when there is one. The only two settings the checkbox could have had were "correct" and "silently graded without the evidence it should have had". `derivesTestEvidence` holds the rule and `withDerivedFields` applies it on the server, before validation, so it is not something a request can disagree with. Verified against every seeded assignment: derivation reproduces the values that were configured by hand.
- **The runner is read from the template.** `detectRunnerPreset` looks for jest or vitest in the template's `package.json`, then for a `requirements.txt`, and reports the reason as well as the answer — an inference an instructor cannot check is one they have to trust blindly. It agrees with all four hand-configured assignments, including the checkpoint reading as `none` because its `package.json` has no test dependency.
- **Reference solutions pre-tick.** They arrive from a second request after the assignment is chosen, so this is an effect rather than part of the initial draft, guarded so that an instructor who deliberately unticks them does not have them tick themselves again, and applied only to a section that has none — editing an assignment must not have its chosen subset replaced by everything in the directory.

**Point values and section types stay manual, deliberately.** They were the two candidates for a manifest in the repository, and the case is weaker than it looks: `duplicate` already carries them into the next cohort, so the cost is paid once per assignment ever rather than once per cohort, and section types are *already* declared and checked against the submission by `classifySections` — a manifest would change who authors the declaration, not whether one exists. A point value is a curriculum judgment no file states, so it needs a person or a manifest either way. See [a manifest in the repository](#deferred-with-the-schema-left-open).

### Files

Everything in Steps 0 through 5 is built. The four migrations this phase added are `20260803022300_assignment_kind`, `20260804143312_section_grading`, `20260805142600_non_repo_assignment_kinds` — adding `assignments.template_doc_url` and `submission_instructions`, `submissions.submitted_url`, and making `grading_drafts.head_sha` nullable so a draft can exist for work that has no commit — `20260805190501_file_upload_storage`, adding `assignments.accepted_file_types` and the four `submissions.upload_*` columns, and `20260805203821_external_url_kind`, adding the fourth `AssignmentKind` value.

Nothing in this phase is outstanding.

### Phase 7 verification

**Done, and re-runnable.** `npm run verify:uploads` is 88 checks over the file-upload and link-submitted paths, including a real store, sign, fetch, and remove — described in [the README](README.md#what-is-verified-and-how). `npm run verify:authoring` is 156 checks: the schema rules as pure functions, and a second half that drives the tRPC callers against the real database inside a transaction that is rolled back, because authorization is half of what these procedures are and a check that only holds when called through the interface is not a check. Its strongest check is that authoring `swe-1-3-node-modules` through `create` produces a row matching the seeded one field for field — that assignment already grades correctly end to end, so an identical row proves the authoring path produces grading-correct output rather than merely well-formed output. `npm run verify:approve` covers the hand-graded half, described in [the README](README.md#what-is-verified-and-how).

**The one thing a script cannot do is also done.** On localhost: a Google Doc assignment was authored, a student saw nothing until it was published, accepting landed on Google's copy prompt, the link came back, it was graded by hand and released. Every part of that sequence was already checked through the callers; what the walkthrough adds is that the screens carry it, which no rolled-back transaction can tell you.

### Not in this phase

- **[Course creation](#course-creation--done)** and **[student enrollment](#student-enrollment--done)**, including the join link. `duplicate` is built at the assignment level so the course case becomes a loop over it, which is what it turned out to be.
- **AI grading for assignments with no template repository.** Creating, handing in, and hand-grading them is done, and an uploaded file now has somewhere to be read *from*. What is not: reading a Google Doc's contents or an uploaded file's, and generating a report from it. That needs Drive access and [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), and it is the last [item](#the-order-of-work).
- **Any soft delete or archive.** Removal is permanent by decision, so there is no recovery path in the application. The database's own backups are the only way back from a mistaken removal.
- **Deleting student repositories** when an assignment is removed. They are reported and left alone.

---

## Modules, and where an assignment's repositories come from

**Built, in two phases.** The second depended on the first and not the other way round, which is why the first shipped alone.

A module is a row an instructor creates and names freely, like a module in any general-purpose LMS, and an assignment says which repositories it uses rather than having them inferred from where it sits.

### This reverses Step 1, deliberately

[Step 1](#step-1-a-catalogue-per-kind) argues that the answer-keys repository is the single source of truth for what repository-backed assignments the curriculum contains, so adding one is picking from a list that already exists and there is no second list to keep in step. That was right when every assignment was a repository laid out in one prescribed shape. It is wrong now: three of the four kinds have no repository at all, the shape only ever fit `REPO` assignments, and it forced the curriculum's directory names to be the application's module names forever.

**The application is the source of truth for what a course contains, and the repositories are things an assignment points at.** The cost is real and accepted: drift is possible, because an assignment can name a template or an answer-key repository that is later renamed or made private upstream. Validation checks reachability whenever a draft is saved or published and reports it as a finding, which turns drift into a message on the authoring screen rather than a grading failure weeks later.

What is *not* lost: the catalogue machinery still earns its keep one level down. The named answer-key repository is listed so its files are ticked from a list rather than typed, which is what keeps a mistyped answer-key path from becoming a confident wrong grade.

### Phase 1: modules are rows — done

**A module has an id.** `assignment.moduleId` is a foreign key, not a copied string. This is the decision the rest follows from:

- **Renaming is one column.** With the name as the identity, a rename rewrites every assignment that uses it and still cannot fix anything outside the database, which is why the earlier plan ruled renaming out entirely. With an id, renaming is free and can ship on day one.
- **"The module must exist first" is enforced by the database**, not by validation code that a second caller could forget.
- **Ordering is an integer**, not the order of a JSON array.

```
model Module {
  id        String @id @default(uuid()) @db.Uuid
  courseId  String @map("course_id") @db.Uuid
  name      String
  position  Int
  createdAt DateTime
  updatedAt DateTime

  course      Course       @relation(...)
  assignments Assignment[]

  @@unique([courseId, name])   // one "Module 3" per course
  @@unique([courseId, position])
}
```

**Per course, not program-wide.** Matches `moduleStructure` today and matches how an LMS works: one cohort reordering or dropping a module must not touch another's records. The cost is that a new cohort creates its modules again, which is the copy-from-course action [course creation](#course-creation--done) performs rather than a reason to share rows between cohorts.

**The name is free text and nothing derives from it.** `moduleLabel` and its initialisms list stop being how a module is titled — an instructor types "Async and APIs" and that is the title. `moduleLabel` survives only for as long as any pre-migration data does; `compareModuleTags` is replaced by `position`.

**The four operations, in build order.** Reordering first: it feeds presentation and nothing else, validates nothing, and could ship alone. Then creating, which is now just a name and a position. Then renaming, which the id makes trivial. Then removing, **refused while any assignment references the module**, naming the count — the same shape as `update` refusing a repository-name change once anybody has accepted, and for the same reason: a half-broken state nobody would connect back to a module they deleted is worse than a refusal.

**The eight modules, named.** These are the real ones, and they are what the seeded course should hold. Note that they are not the answer-keys repository's directory names and no longer need to be — Mod 0 has no directory at all, and `mod-2-review` and `mod-8-capstone` have directories but no module, which is exactly the freedom this change is for.

| Position | Name                                              |
| -------- | ------------------------------------------------- |
| 0        | Mod 0 - Command Line Interfaces, Git, and GitHub  |
| 1        | Mod 1 - JavaScript Fundamentals                   |
| 2        | Mod 2 - Object-Oriented Programming               |
| 3        | Mod 3 - HTML & CSS                                |
| 4        | Mod 4 - Interactive & Data-Driven User Interfaces |
| 5        | Mod 5 - Server-Side Development                   |
| 6        | Mod 6 - Databases                                 |
| 7        | Mod 7 - React                                     |

**Built**, and described in [the README](README.md#data-model). `modules` with `position` and `@@unique([courseId, name])`, `assignments.moduleId` as a `RESTRICT` foreign key, the four procedures in `trpc/routers/modules.ts`, and a Modules screen beside Assignments. `npm run verify:modules` is 29 checks through the callers.

**The migration went in one step rather than two, and could.** The plan called for a nullable `module_id` so the mapping could be checked before committing to it. In the event the backfill derives its modules from the union of the tags in use *and* the tags each course declared, so every assignment matches one by construction — which means `SET NOT NULL` in the same migration is safe, and it succeeding is itself the proof that nothing was orphaned. Hand-written rather than what `migrate diff` produced, because Prisma emits `ADD COLUMN module_id UUID NOT NULL`, which fails outright on a populated table.

`module_tag` and `Course.moduleStructure` are gone, dropped by [Phase 2](#phase-2-an-assignment-names-its-own-repositories--done) once it removed their last readers.

**Two things learned by building it**, both recorded in the code:

- **`reorder` is a single raw `UPDATE`, not one per module in a transaction.** Prisma refuses a nested interactive transaction, so the obvious implementation failed in every verification script — which is where any caller that reorders as part of a larger write would also have failed. One statement is atomic by definition.
- **Provoking a database constraint aborts the whole Postgres transaction.** A duplicate-name check and a foreign-key check each need a transaction of their own, or they take every later check in the same one down with them. Found by having exactly that happen.

**The eight modules exist and the assignments are in them.** `prisma/seed.ts` creates the modules by name and `scripts/reconcile-modules.ts` — a one-off, run once, safe to delete — moved the eight assignments out of the modules the migration derived from tags and removed those. The mapping it used is written out in that file rather than buried in a migration, because two of the old tags pointed at answer-key directories that never existed and deciding where their assignments belong was a curriculum judgment rather than a rule.

**The mapping that was applied.** Six were already right; two were not:

| Assignment                                                                                                                       | Tag today               | Goes to                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Story Prep Worksheet, `swe-1-2-strings-conditionals`, `swe-1-3-node-modules`, `swe-1-4-loops`, `swe-1-5-arrays`, Upload a Resume | `mod-1-js-fundamentals` | Mod 1                                                                                                              |
| `swe-checkpoint-summative-1-4`                                                                                                   | `mod-4-dom`             | Mod 4 — a tag that was never in the course's own list, which is why editing that assignment fails validation today |
| Submit the API you are using for your project                                                                                    | `mod-3-async-and-apis`  | **Mod 4** — confirmed. The tag pointed at a directory that never existed.                                          |

The six in Mod 1 stay there, including "Upload a Resume" and "Story Prep Worksheet" — confirmed, and easy to move later in the interface if they read oddly once a real cohort is in.

**Where it lives:** its own sidebar item beside Assignments, Roster, and Gradebook, which is where assignments already group by module. Up and down buttons rather than drag-and-drop: no new dependency, it works from the keyboard, and eight modules is not a list that needs dragging.

### Phase 2: an assignment names its own repositories — done

An assignment says which repositories it uses. The authoring form asks for two pasted URLs, the module comes from the course's own list, and nothing is inferred from a directory name.

**Built**, and described in [the README](README.md#data-model). `assignments.answer_key_repo`, both repositories normalized from a pasted URL by `lib/assignments/repo-ref.ts`, `assetSource` parameterized by repository, the answer-key repository browsed by the form rather than assumed, and the asynchronous-copy fix in `accept`. `npm run verify:assets` and `npm run verify:authoring` cover it.

- **`templateRepo` must be readable by the installation that will generate from it, and must have GitHub's template flag set.** The flag is checked because `generate` refuses a repository that is not one, and it fails at the moment a student presses Accept. **Being private is not a failure** — a private template in an organization this deployment's installation covers generates perfectly well, which is how every assignment in the sandbox organization works. That corrects what this section assumed while it was a plan: what being *public* buys is reach, not permission. **Confirmed by probe:** an installation token reads a public repository in an org the App is *not* installed on — metadata including `is_template`, individual files, and the tarball — so validation, `detectRunnerPreset` reading `package.json`, and test execution fetching the suite all work against any public template, wherever it lives.
- **`answerKeyRepo` is a column, "owner/repo", and must be private.** A public one is refused rather than warned about: reference solutions readable by the students being graded against them is not a configuration detail.
- **`answerKeyDir` is a folder inside it, and every file under that folder is the reference set.** Nothing is selected. Pasting the address of the folder an instructor already has open fills both columns and finishes the question; the branch in `/tree/main/` is dropped, since answer keys are read at the default branch. `""` is the root, for a repository holding one assignment's solutions and nothing else. This replaced a stored list of individual paths, which carried the same information until somebody added a reference solution to the folder — at which point the list was quietly incomplete and the only symptom was a slightly worse grade. Three consequences, each recorded in the code: recognisable binaries are skipped by a *denylist* (an allowlist would drop the first `.sql` answer key somebody writes), every exclusion is reported on the authoring screen and the draft, and the count is capped at 40 per section. A multi-section assignment gives every section the whole folder, which is accepted knowingly — the direction of travel is one section per assignment, and the alternative was a second selection mechanism existing forever for one legacy assignment.
- **The migration rewrites the paths, and had to.** `answer_key_repo` backfills with the value `GRADING_ASSETS_REPO` held, and every stored path gains the `answer-keys/` prefix that reading used to add — because a path in the column is now a path in the repository, with nothing between what an instructor ticked and what grading reads. Requiring every answer-key repository to have an `answer-keys/` directory at its root would have avoided the rewrite and imposed the curriculum's layout on every repository an instructor makes, which is the constraint this phase exists to remove. The rewrite is idempotent and preserves order; hand-written, because it walks a JSON column.
- **Two failures reported differently.** A repository that does not exist and a private one in an organization the App was never installed on both answer 404. Told apart by asking whether the App is installed on that owner at all, which is a question the App can answer about itself — `installationIdForOwner`, which also resolves which installation reads a given answer-key repository, caching the negative answer as well as the hit.
- **`GRADING_ASSETS_REPO` keeps a narrower job.** `rubric.md`, `agent-rules.md`, and the sample reports are program-wide prompt code, so they stay in the environment; answer keys come from the repository the assignment names. Both commits are recorded on the draft and shown on the review screen, since recording one of two would quietly weaken the claim the field exists to support.
- **`assignmentRepoName` defaults to the template's own name** and stays editable, since it names every student's repository — and stays frozen once anybody has accepted, which `update` already enforces.
- **The catalogue machinery survives one level down.** `listAnswerKeyEntries` walks the named repository directory by directory, for instructors who do not have the folder's address to hand, and `listAnswerKeys` recurses beneath the chosen one to say what naming it means. The authoring screen shows that resolved list rather than offering a choice — reading `from-scratch.js`, `modify.js`, `debug.js` says the right folder was named in a way "17 files" does not.
- **`assignments.module_tag` and `courses.module_structure` are dropped.** This phase removed their last readers, and an unread column is a second answer to a question that already has one.

**Generating from an external public template is confirmed too.** Probed with `actions/typescript-action` — public, `is_template`, in an org the App is not installed on — generated into `marcy-lms-test`: created private, all 31 root entries copied, exactly one commit, which is what the tamper report's diff comparison depends on. Nothing about the design needs the template's org to install the App.

#### The copy is asynchronous, which is why `accept` waits

Found by probe rather than assumed: `generate` returned after 2.1s and the new repository's content only became readable at 5.6s. For roughly three and a half seconds the repository exists and is empty, and GitHub answers a contents request with 404 and the body `"This repository is empty."` — the same status as a file that genuinely is not there.

The body is the only thing that tells them apart. `waitForRepoContent` retries on that specific 404 with lengthening gaps, and `removeClassroomWorkflow` returns `removed`, `absent`, or `repository-empty` rather than a bare void. `accept` waits before it reads the tree, and logs a repository that is still empty afterwards rather than failing the student's Accept — the repository exists, they can work in it, and refusing over a workflow file whose results nothing trusts would be the worse trade.

**Why it needed fixing here.** The production organization is being created fresh with no Classroom templates in it, so losing the race would cost nothing today. This phase is what changes that: an instructor can paste *any* public template URL, and a great many public templates on GitHub are Classroom templates with autograding in them. It is the first time the function is load-bearing, and the first time the window is wide, since an arbitrary template can be large.

### What is verified

Through the tRPC callers inside a rolled-back transaction: a duplicate module name in one course is refused; removing a module with assignments in it is refused and says how many; renaming leaves every assignment pointing at the same row; reordering changes nothing but `position`; a student cannot call any of it; and an assignment cannot be created against a module belonging to a different course, which is now a foreign key plus one course-level check.

For Phase 2: both repositories may be given as pasted URLs and come out as `owner/repo`; a pasted address's path becomes the answer key folder, with `/blob/` resolving to the folder the file is in and a traversal dropped; a repository that is real, readable, and not a template is refused; an answer-key repository that does not exist and an organization the App is not installed on produce *different* messages, checked by comparing them rather than only by matching each; an answer key folder at an arbitrary depth is accepted and the root is the default; a folder naming a traversal is refused where it is written as well as where it is read; a folder with no repository to read it from is refused; the archive beside `swe-checkpoint-summative-1-4`'s source files is skipped and named as an archive while the source files beside it are kept; the denylist admits `.sql`, `.py`, `.ejs`, and `Makefile`, which is the property an allowlist would not have; the prompt receives exactly the files the listing reported, so what an instructor read is what the model was given; and authoring `swe-1-3-node-modules` through `create` still produces a row matching the seeded one field for field, which is the check that says the new shape did not quietly change what grading reads.

---

## Token management

Three concerns come down to what ends up in a prompt: what it costs, how much of the context window it consumes, and what it discloses. **The third is closed** — a filter withholds committed dependency trees, environment files, credentials, and build output, described in [what a student commits and what reaches the model](README.md#what-a-student-commits-and-what-reaches-the-model). What is left is measurement.

**Where the cost actually is, measured rather than assumed.** Some of this is already answered and recorded in [what a report costs](README.md#what-a-report-costs): output is roughly 60 percent of the bill, because thinking is billed as output, and the frontend prompt's uncached input is the next largest share. What is not measured is the breakdown *within* input — the answer keys against the student's files against the rubric and agent rules — which is what would say whether [moving the answer keys into the cacheable prefix](#deferred-with-the-schema-left-open) is worth more than the 6 percent currently estimated.

**Trying a cheaper model is a calibration question, not a cost question.** The provider interface already exists, so adding one is a file in `lib/grade/providers/` and an environment variable — the work is not the integration. The work is proving the cheaper model still agrees with an instructor, and `npm run calibrate` against the held-out pair is the only tool that answers it. Two constraints learned from Groq that apply to any candidate: the model must guarantee schema-conformant structured output, and its context and rate limits have to fit a frontend prompt, which is the largest at roughly 12,000 tokens of uncached input. A model that cannot do both is not a cheaper option, it is a different failure.

---

## A code review pass

Before more surface area goes on top. This is deliberately scheduled rather than continuous, because the shape of the application only became clear once the whole loop worked, and several things were built before their eventual use was known.

Known candidates, to be confirmed rather than assumed during the pass:

- **Prisma usage.** Selects that fetch more than a screen needs, and any place a list view issues a query per row.
- **`sections` as a JSON column.** It buys schema-free iteration, and it costs referential integrity: a `rubricId` inside it is a string that nothing enforces points at a real `Rubric` row. Worth deciding deliberately now that the authoring schema validates the shape, rather than leaving it as an accident of early convenience.
- **`prisma/seed.ts`'s `SEED_ASSIGNMENTS` map**, which assignment authoring makes redundant. It should shrink to the minimum needed to get a working local database, not keep pretending to be a curriculum registry.
- **The largest modules** — `components/instructor/grading-review.tsx` and `lib/status.ts` — which are large because they are the densest screen and the single source of presentation truth respectively, not necessarily because they should be split. Check rather than assume.
### An automated test suite

Decided: this pass adds one. Today there are only the `verify:` scripts, and while they have found real defects, they are a different tool. Each is a script that prints lines and exits non-zero if any failed, which means a failure is read rather than reported, there is no way to run one case, and nothing runs them but a person remembering to.

What they are genuinely good at should not be thrown away: each one is a narrative about a subsystem, readable top to bottom, and several are written against live data or a real sandbox. So the split to aim for:

- **Unit tests** for the pure logic that currently sits inside those scripts — the `package.json` merge, protected-path matching, the parsers, classification, the cross-check rules, the assignment spec. These are all pure functions already, which is why this is mostly mechanical rather than a rewrite.
- **The `verify:` scripts keep everything that needs a real sandbox, a real repository, a real model call, or live rows** — `verify:e2b`, `verify:assets`, `verify:app`, `verify:resubmission`, `calibrate`. Those cost money or minutes and are deliberately run on purpose, not on every save.

**Jest, decided** — the program teaches it, and matching what students use has value beyond this repository. One thing left to settle: whether it runs in CI on push, which is worth it for the unit half and pointless for the half that needs credentials.

**Not started before assignment authoring is finished.** Tests written against the authoring procedures while they are still being designed would only be rewritten, and the pure logic they would cover is checked by the `verify:` scripts in the meantime.

---

## Salesforce synchronization

**Blocked on a conversation with the consultants who built our Salesforce implementation.** Everything below the questions is guesswork until that happens, which is why the field mapping was never guessed at.

**What already exists here.** `submissions` carries three dormant columns — `salesforceSyncStatus` (`PENDING`, `SYNCED`, `FAILED`), `salesforceRecordId`, and `salesforceSyncedAt` — and approving a grade sets the status to `PENDING`. Nothing reads them. They exist so that a synchronization job can query `WHERE salesforce_sync_status = 'PENDING'` without needing a migration at that point.

**What is already settled.** Salesforce tracks grades **per assignment**, on assignment submission objects. That confirms the grain the dormant columns assume: one Salesforce record per submission, keyed from a column on `submissions`, rather than a rollup computed per module or per course. Nothing needs to move.

It also widens the feature past what those columns cover. Managing assignment *and* assignment submission objects means an authored assignment has a counterpart record in Salesforce, which is a second thing to create, key, and keep in step — and `assignments` has no Salesforce columns at all today. Two consequences worth carrying into the conversation:

- **The ordering is forced.** A submission record presumably cannot exist without its assignment record, so authoring an assignment has to create the Salesforce side before any grade for it can sync. That makes this feature depend on [assignment authoring](#phase-7-assignment-authoring--done) rather than merely following it.
- **`assignments` and `courses` both need the same three columns** `submissions` already has. Correct assumption: only `submissions` has them, because it was the only table whose sync was being thought about when they were added. A course is presumably a cohort or program record on their end and an assignment hangs off it, so all three levels need to hold their Salesforce id and sync state. One small migration once the objects' shapes are known — deliberately not written until then, on the same reasoning that left the field mapping un-guessed.

### Questions I need answered

**What a record represents.** This decides everything else, so it is first:

- What object does a grade live on? What is its exact API name?
- I would like to be able to have my application manage assignment and assignment submission objects (CRUD). What objects do assignments and assignment submissions live on? What are their API names?
- What is the most relevant object relationship between a student and their assignments/submissions? Program Enrollment?
- What is the manual process today, and which field does someone fill in by hand? I want to replace exactly that, not something adjacent to it.

**How a student is identified.** What I hold is an email address and a GitHub numeric user ID, and the GitHub ID is meaningless on your end:

- What is the reliable key for a student — the Contact Id, an email, or a student ID number we assign?
- If it is email: is it guaranteed to match the email they sign in to our application with? What should happen when it does not?
- Can I be given the Salesforce Id for each student once, to store against their profile, rather than matching on email every time?

**The fields, and the shape they expect.** I have a raw score, a maximum, a complete/incomplete determination at 75 percent, a graded-at timestamp, a late flag, and the feedback text itself:

- Which of those do you actually want, and what are the exact API names and types?
- Is the grade a number, a percentage, or a picklist? If a picklist, what are the valid values, exactly as spelled?
- Do you want the feedback text at all? It is markdown and can run to several hundred words, so I need to know whether to send it, and whether to strip the formatting.
- Are there required fields on that object that I have no way to supply?

**API access.** I need server-to-server access with no human in the loop:

- Which API should I use — REST, sObject Collections, or Bulk? Volume is small: one write per approved grade, so roughly 25 per assignment per cohort.
- Can we set up a Connected App with the OAuth JWT bearer flow, and who creates it and issues the certificate?
- Is there an integration user I should authenticate as, or should one be created? What profile or permission set should it have — I want the narrowest that works.
- Is there a sandbox org I can develop and test against, and how do I get access?
- What API request limits are we working within?

**Re-syncing without creating duplicates.** A grade can be corrected after it has been sent, and a student can resubmit and be graded again:

- Can you add an External Id field to that object — unique, holding our submission's UUID — so I can upsert against it? Without one I have to store the record Id and hope it does not change, and any retry risks a duplicate row.
- On a resubmission, do you want the existing record updated, or a second record so the history is visible? Our side keeps every round of feedback, so either is possible.
- If a grade is corrected here after it has synced, may I overwrite what is in Salesforce, or is Salesforce the system of record once written?

**What else fires when I write.** This is the part I cannot see and am most likely to break:

- Are there validation rules, triggers, flows, or required-field rules on that object that a write would set off?
- Does anything downstream read those fields — reports, dashboards, a program-completion calculation, anything that emails a student or a funder?
- Could someone edit a grade directly in Salesforce? If so, we need to agree which side wins.

### What may need to be built on the Salesforce end

Worth flagging in the same conversation, since some of it is their work rather than mine: a unique External Id field for idempotent upserts; the object or the fields themselves if per-assignment grades are not currently modelled; a Connected App and a least-privilege integration user; agreed picklist values; sandbox access; and confirmation that no existing automation reacts badly to an integration writing these fields.

### The shape of the work here, once those are answered

A job that reads `PENDING` submissions, writes them, and records `SYNCED` with the record Id or `FAILED` with the reason. Deliberately not part of the approval transaction: approving already posts a pull request comment best-effort for the same reason, because a grade must not fail to be recorded because a third party is unavailable. That makes the sync retryable and makes a failed sync visible as a state rather than a lost write, which is the same shape as the undelivered-comment triage bucket.

---

## Getting a cohort into the application

Three features that interlock: a course has to exist, students have to get into it, and somebody other than a hand-edited database row has to be allowed to teach. **All three are built.**

One rule they all share, decided once here rather than three times below.

### Removing and archiving make lists go quiet; they never take work back

A student removed from a cohort keeps reading the feedback they were given. An archived course stays readable to the people who were in it. What both do is stop appearing in the lists of work outstanding: out of grading triage, out of the queue an instructor works down, and out of every count that says whether they are caught up.

**What "out of the gradebook" means is narrower than it sounds, and the difference is the whole feature.** A removed student is out of the *cohort's* figures and into a Removed students table below them — same grid, same columns, their own rows. Their history is the reason the row was kept rather than deleted: how somebody did before they left the program is worth being able to read afterwards. Same in the roster, so an instructor can see who was here and put them back. And an assignment's own grading queue still opens their work when a link names it, because that is how a submission is read rather than a list of what is waiting.

The reason is that the alternative takes something back. A student who was shown a grade and then removed would find the grade gone, and there is no version of that which is not worse than a course they can still open. Cohorts also end for the ordinary reason that they finished, which is not an event that should retract anything.

**This splits membership into two questions**, and that is the load-bearing consequence:

- **May read** — an active student, a removed student, an instructor of the course, an admin. A course's screens, an assignment's own page, released feedback, a submission's own history.
- **Is an active participant** — an active student only. `accept`, `submitWork`, the upload route, and anything that creates or changes a submission.

**The write paths are already right, and the read paths are the work.** That is the opposite of what it looks like from the outside, so it is worth being exact. `accept` and `assertCanHandIn` each check `status: 'ACTIVE'` themselves, deliberately — a mutation must not assume which query preceded it — so a removed student is already refused by both and neither changes. What has to widen is every read check, because they all filter on `ACTIVE` too and therefore refuse a removed student the course they are supposed to keep.

So the risk in this change is not "a removed student can still submit". It is the reverse: widening a read check by one line and widening a write path by accident, in a file where the two look identical. Which is the argument for the two questions being two named functions rather than a `where` clause repeated at each site — `assertCourseMember` and something like `assertActiveStudent`, next to each other, so a new caller has to choose.

`status: 'ACTIVE'` appears in **seven places in application code** and four more in the verification scripts. Each of the seven is one of the two questions above or a third — *counts as a student in this figure* — which the gradebook, the roster, and the course-card count all ask. They are enumerated in [the seven readers](#the-seven-readers) below.

---

## Course creation — done

An instructor creates a cohort rather than a seed script doing it. **Built**: `courses.create`, `courses.setArchived`, `courses.regenerateJoinToken`, and a New course form on the course list. `npm run verify:enrollment` covers this and enrollment together, because the two share a transaction's worth of setup and the interesting checks cross both.

**`create({ name, cohortTerm, copyFromCourseId? })`**, and the creator becomes the primary instructor: a `CourseInstructor` row with `isPrimary: true`. That matters more than it sounds, because every authoring procedure checks `CourseInstructor` rather than the role — an instructor who is not in that table for a course cannot author anything in it. Which is correct, and is why creating a course has to write that row in the same transaction.

**Any instructor may create one.** Not admin-only: a cohort belongs to whoever runs it, and an admin who had to create every course would be a bottleneck for no benefit. Admins see all courses already.

**No uniqueness on name and term.** Two sections of the same cohort running at once is a real arrangement, and a constraint here would refuse it for tidiness.

### Copying, and the order it has to happen in

Copying is optional — the first course in a deployment has nothing to copy from — and when it happens it is modules, then assignments, in that order. **The order is forced rather than preferred.** `duplicate` matches a module across courses *by name* and refuses when the target has no module of that name rather than guessing, so copying assignments before their modules exist fails on every one of them.

Renaming the copied modules comes after, which is safe precisely because [the module id is the identity](#phase-1-modules-are-rows--done) — a rename is one column and every copied assignment goes on pointing at the same row.

**What does not carry across: `dueAt`.** A new cohort has new dates, and a copied assignment inheriting last term's due date would mark a whole cohort late on day one. `duplicate` already takes `dueAt` optionally and defaults it to null.

**What does: everything the assignment *is*** — both repositories, the answer key folder, the runner preset and config, the sections, the point values, the completion threshold, the submission instructions. `@@unique([courseId, assignmentRepoName])` is per course, so a copied assignment keeps its repository name without colliding with the cohort it came from.

**Copies arrive unpublished**, which `duplicate` already does. A copied cohort is reviewed before students see it, because the reason to copy is that last term's version was nearly right rather than exactly right.

### Archiving

`Course.archivedAt` exists, `listMine` and the student course list already filter and label on it, and **nothing has ever set it.** One seeded cohort never needed it; a school running three cohorts a year needs it inside the first year, or every instructor sees every cohort that ever ran.

`archive` and `unarchive` set and clear the column. Reversible, deliberately: archiving is a tidying action and a tidying action that cannot be undone gets avoided instead of used.

An archived course is readable by its members and accepts nothing new — the same pair as a removed student, for the same reason. Its submissions leave grading triage, because that is a list of work waiting to be done and a finished cohort's work is not waiting.

---

## Student enrollment — done

**Built**: `trpc/routers/enrollments.ts` with `preview`, `join`, `remove`, and `restore`; `/join/[token]`; and a Roster screen that shows the link and who has used it.

**One join link per course.** The instructor copies it and sends it however they already talk to their students; opening it and signing in with GitHub enrolls you. There is no email infrastructure in this application and this design does not add any — no provider, no sending domain, no delivery states to chase.

`Course.joinToken` is a unique column generated when the course is created. **`regenerateJoinToken` replaces it**, which is the only control over who can use it: a link that has been forwarded to the wrong person is invalidated by making a new one, and the wrongly-enrolled person is removed from the roster. That is the accepted trade — anyone holding the link joins immediately, and a leak is found by reading the roster rather than prevented.

**`join({ token })` is idempotent**, which is what makes a reusable link safe. `@@unique([courseId, studentId])` means a second redemption returns the enrollment that exists rather than creating another.

**A removed student redeeming the link again is refused.** This is the one place idempotence is the wrong instinct: if rejoining were automatic, removing somebody would not stick while they still held the link, and the instructor would have no way to make it stick short of rotating the link for the whole cohort. Rejoining is the instructor's action, not the removed student's.

### What the schema loses

The per-student invite this replaces is still in the columns, and all of it goes:

- **`Enrollment.inviteToken`** — a unique token per row, when the token now belongs to the course.
- **`Enrollment.invitedEmail`** — `NOT NULL` today, and nothing knows an address in advance any more. The student's email is on their `Profile` once they have signed in, which is the only moment it is knowable.
- **`Enrollment.studentId` becomes `NOT NULL`.** It is nullable to hold "invited but not yet bound", a state that no longer exists: an enrollment row is created *by* a student joining, so there is never one without a student.
- **`EnrollmentStatus.INVITED`** — unreachable once nothing can create an unbound enrollment. Removed rather than left in place, because an enum value nothing produces is a question every future reader has to ask and answer. Postgres cannot drop an enum value in place, so this is create-type, alter-column-with-cast, drop-type — six lines, on a table with one row per student per cohort.

That leaves `status` as `ACTIVE | REMOVED`, which could be a boolean and stays an enum: `DROPPED` and `AUDITING` are the kind of thing a school asks for, and widening an enum is a migration where widening a boolean is a rewrite.

### The seven readers

Every place in application code that asks for `status: 'ACTIVE'`, and which of the three questions from [the shared rule](#removing-and-archiving-make-lists-go-quiet-they-never-take-work-back) it is really asking:

| Where                                            | Question            | Changes?                                        |
| ------------------------------------------------ | ------------------- | ----------------------------------------------- |
| `assignments.ts` — `assertCourseMember`          | may read            | **yes** — admit `REMOVED`                       |
| `courses.ts:95` — `get`'s membership check       | may read            | **yes** — admit `REMOVED`                       |
| `modules.ts:90` — `listForCourse` membership     | may read            | **yes** — admit `REMOVED`                       |
| `courses.ts:24` — `listMine`                     | may read            | **yes** — admit `REMOVED`, and label the course |
| `courses.ts:40` — `_count.enrollments` on a card | counts as a student | no                                              |
| `assignments.ts:341` — `accept`                  | active participant  | no                                              |
| `lib/uploads/submit.ts` — `assertCanHandIn`      | active participant  | no                                              |

Four widen, three stay. `courses.gradebook` and `submissions.triage` are not on this list because they filter through the *submission* rather than the enrollment, which is a second thing to check rather than a third to change: a removed student's existing submissions would go on appearing in both, and both are lists of a cohort's current state.

**The one to get right is `listMine`**, because it is the only one where the intended behaviour is not simply "admit them". A removed student whose course silently reappears in their list, indistinguishable from the ones they are in, is worse than not seeing it. It needs the label as well as the row, in the same way the student course list already labels an archived one.

### Not in this design

**Adding a student directly, without the link.** An instructor who knows a student already has an account might reasonably want to add them. It needs a way to find a person by email across the whole application, which is a search over `Profile` that nothing else needs and that exposes who else uses the system. The link covers the case that actually happens at the start of term.

**[Preview-as-student](#seeing-a-course-as-a-student-sees-it)**, which stays its own item and says there why it is not bundled here.

**Targeted assignments and excusing a student**, which stays below as its own decision. It is a data-model change rather than a screen and it does not block a cohort from running.

---

## A removed student's work — done

Removing somebody stopped their enrollment and did nothing to their submissions, so a student who had left the program stayed in grading triage indefinitely: work nobody was ever going to do, that could not be cleared, inside the count that says whether an instructor is caught up.

**The rule is one sentence, applied in six places.** A removed student's work is not the cohort's outstanding work, and it is not deleted. So every instructor-facing read of a course's submissions is one of two kinds and has to know which: a **list of work waiting**, which a departed student contributes nothing to, or a **record of what happened**, which they are part of. `lib/courses/membership.ts` holds both halves next to each other — `activeStudentWork` for the lists, `removedStudentIds` for the reads that return both sets — for the same reason `assertCourseMember` and `assertActiveStudent` already live there: the two differ by one enum value in code that otherwise reads identically, and the failure is not spotting a difference, it is not noticing there was a decision to make.

Where each lands: **out of** grading triage and its approved count, out of the grading queue's list, out of the gradebook grid, out of the course heading's "N submissions waiting on you", out of the per-assignment "to grade" column. **Into** a Removed students table in the gradebook and another in the roster.

**The counts were the real second half.** Fixing only triage would have left the gradebook and the assignments list claiming work was waiting while triage showed nothing to do, with nothing on any of the three screens to reconcile them. `courses.gradebook` returns `cells` narrowed to active students and `removedCells` beside it, and `courses.assignmentsOverview` computes its "to grade" column from the same set, so those readers are right by construction rather than by remembering to filter.

**The queue keeps a removed student openable without listing them.** `listForAssignment` returns `submissions` and `removedSubmissions`; the pile is the cohort, and asking for one submission by name still answers, with a banner saying who has left. The gradebook's Removed table links straight into it, and a link into a screen that will not show what it points at is worse than no link. Same distinction as an archived course: triage is a list of work, the queue is how work is read.

**An ungraded submission in the Removed table says "Not graded", not "waiting on you".** The difference is whose action is outstanding, and nobody's is. Nothing is closed or rewritten on removal, which is what makes Restore put the work straight back — the filters read live enrollment status.

**Every partition is a set and its complement**, not two named statuses. `REMOVED` is the only non-active value today, and a pair of filters naming both would silently drop an `AUDITING` student from the roster and the gradebook alike — an absence nothing reports.

### The short name stopped being editable

Not cosmetic, and not really about removed students until it was. `setCohortSlug` is gone; the cohort's short name is settled when the course is created and never again.

It was editable until the first Accept, which made "has anybody accepted yet" a question the gradebook had to answer — `frozen={data.cells.length > 0}` — and that was the **one reader of `cells` that needed every submission rather than the active students'.** Narrowing `cells` under it would have reported a cohort's name as free to change while repositories were already named after it, and renaming it then orphans every one of them. Removing the mutation removed the reader.

What it bought was correcting a typo, in a window measured in hours against a nine-month cohort, at the cost of a rule every reader has to learn and a screen that has to explain which state it is in. A typo caught afterwards is fixed by creating the course again, or by a one-line database update, which is safe for exactly as long as the course has no submissions.

**Creating a course now has a review step** for the same reason: the short name cannot be taken back, and copying can bring a term's worth of assignments into the wrong cohort. The form's primary button says Review rather than Create, because it is not the button that creates anything. The review names the course, the cohort, the repository pattern the short name produces, and what copying will bring across.

**The short name is read on two screens: the review step, and the cohort's settings.** The review step is where it is decided. Settings is where it is looked up afterwards, alongside an example of the repository name it produces, the count of repositories already named after it, and the reason there is no way to change it — see [a cohort's six views](README.md#a-cohorts-six-views-are-six-addresses). It is returned by `courses.settings` and by nothing else; the gradebook, the roster, and the assignments list all read a cohort without it.

### The short name names the course as well as the term

It was suggested from the cohort term alone, so "Fall 2026" offered `fall-2026`. That is not unique and was never going to be: **every program a school runs starts in the fall.** The first course created in a season took `fall-2026`, and every other program starting that season hit a uniqueness refusal — with the instructor who hit it being the one who had done nothing wrong. It looked fine with one program running.

`suggestCohortSlug({ courseName, cohortTerm })` composes both halves. "Data Science" starting "Fall 2026" offers `data-science-f26`; "Software Engineering Fellowship" offers `sef-f26`, which an instructor edits to `swe-f26`.

**The course name is either whole or its initials, never half of itself.** `software-engineeri` is a name nobody would have chosen and this is a suggestion people accept without reading closely, while `sef` is visibly an abbreviation — somebody who wants `swe` can see there was a decision to make.

**One program's short name is the same shape in every season**, which is the part worth knowing about. The course half is measured against the longest a compacted term can be — four characters, `sp27` — rather than against the term in hand. Measured against the term itself, one character of season would cost a word of the course name: a fellowship reading `software-engineering-f26` in the autumn and `software-sp27` in the spring, with two cohorts of the same program no longer looking related. Which is the whole thing the prefix exists for.

**Uniqueness is still the database's.** `cohort_slug` is unique across every course and that constraint is what guarantees it; naming both halves only moves collisions from routine to rare. Two cohorts of the same program in the same term still collide, and two programs whose names abbreviate the same way do too — both refused in words rather than by a constraint error.

Existing cohorts keep the slugs they have, because the short name is frozen and their repositories are already named after it. This changes what a *new* course is offered.

### The check scripts were reporting passes they had not earned

Found while verifying the above, and worth more than the feature. Five scripts required an **active** enrollment on the seeded course to run their database checks, and printed "All checks passed" when they could not find one. Removing a student in the running application — which is what this whole item is about — was enough to silently stop 4 of the 8 suites: `verify:modules` ran nothing at all, and `authoring`, `approve`, and `uploads` each dropped a whole group, all while reporting success.

Two fixes, and the second is the one that matters. Each script now picks a student **regardless of enrollment status**, because what it needs is somebody to *be*: the checks that act as a student are reads and refusals, both of which admit a removed student by design. The two whose lifecycle genuinely hands work in restore the enrollment inside their existing rolled-back transaction. And **a skip is now reported and exits non-zero** — a run that checked nothing is not a run that passed, and the failure mode here was a green result that meant nothing.

---

## Course switching — done

Not a planned item. It is what the first second course found: three separate defects that could not exist while there was one cohort, and one wrong claim in this document.

**Every instructor route now names its course**, and the switcher and the navigation read it from there. The sidebar had been deriving the current cohort from the address where it could and falling back to the first course in the list where it could not — and `listMine` is ordered newest-first, so on the triage screen and the grading queue it named last term's cohort. Worse, the "Course" link in the navigation never consulted the address at all: it was the first course unconditionally, so grading one cohort's queue and then clicking Course took you into a different cohort. That is what moved `/instructor` to `/instructor/courses/[courseId]/triage` and `/instructor/assignments/[id]` to `/instructor/courses/[courseId]/assignments/[id]`; both old addresses redirect, the first by picking the caller's most recent cohort and the second by asking the assignment which course it belongs to.

**There is deliberately no remembered "current course".** The URL is the whole of the state. A remembered one disagrees with the page the moment somebody opens a link, and a sidebar naming a different cohort than the screen is worse than one naming none — so where the address names no course, the switcher shows a placeholder and the Course link is dropped rather than pointed at an arbitrary cohort. Guessing is exactly what went wrong.

**Switching cohort keeps the view.** Triage becomes the other cohort's triage, the gradebook the other cohort's gradebook. Only for the screens every course has: an assignment belongs to one cohort, so its queue and its edit form land on the cohort's settings instead.

**Triage is one cohort's, and the course is required rather than optional.** Two terms' work interleaved has no state in which the screen is empty and no order in which to work it — "what do I do next" is not a question that can be answered across cohorts. Leaving an unscoped mode available is how the screen came to use one.

**Two routes name their course twice** — as a segment and through the assignment — and nothing stopped the two disagreeing. Access was never affected, because every procedure checks the assignment's own course rather than the segment; what broke was everything that reads the segment, so the sidebar named the wrong cohort and the edit form offered the wrong course's modules. `lib/instructor/course-scope.ts` redirects to the address where both agree.

### The claim this document had wrong

`triage` filtered `archivedAt: null` in its admin branch and not in its instructor branch, so an archived cohort stayed in triage for everyone who teaches it and left it only for the reader who teaches nothing. Three places above and the archived-course banner all said otherwise, and the check listed under [what to verify](#what-to-verify-for-all-three) was never written. Both are now true and checked.

The banner also said an archived cohort's submissions leave *the grading queue*, which was never the intent: triage is a list of work outstanding, and an assignment's queue is how its submissions are read. Emptying the second would take the feedback back, which is the one thing archiving must not do.

---

## A student's record — done

**Built**: `submissions.listForStudent`, `components/instructor/student-overview.tsx`, `components/instructor/submission-row.tsx` shared with the grading queue, and `/instructor/courses/[courseId]/students/[studentId]`, reachable from the roster, the gradebook, and the review header.

Not on this list before, and it should have been. Nothing in the application answered "how is this person doing" — the gradebook gave a row of numbers with no feedback behind them, and the grading queue could only be entered one assignment at a time. An instructor asked about a student had to open every assignment they had submitted to.

**It is the grading queue's other axis, and deliberately the same screen.** The queue is one assignment across many students; this is one student across many assignments. The row and the review surface are shared rather than reimplemented, which is the whole design decision: reading a student's work looks and behaves exactly like grading it, because it is the same act approached from the other side. Two copies would drift, and the drift would read as one screen being wrong about the same submission.

**A row for every assignment, not for every submission.** "Has not begun this" is a fact about a student that a list of their submissions cannot state, and it is the sharpest difference from the queue — where a student who never accepted is deliberately absent, because that screen asks what is left to grade. Unpublished assignments are included too: an instructor is entitled to see the ones the cohort cannot, and leaving them out would make this list disagree with the gradebook beside it for no reason a reader could work out.

**The cohort selector is the page's own.** It lists only courses this student is in and the caller teaches. The sidebar's switcher knows nothing about the student and would offer cohorts they are not in — and a student repeating a module has two records, which is exactly when this is needed.

Refusing a student who is not in the cohort with `NOT_FOUND` rather than returning an empty list, because an empty list reads as "this person has done nothing", which is a different and false statement.

---

## A cohort's views became the sidebar — done

**Built**, and described in [the README](README.md#a-cohorts-six-views-are-six-addresses). Not a planned item; it came out of the course page having accumulated a heading, a cohort line, an outstanding count, a triage button, a four-tab bar, and a row of stat cards, none of which was the thing being read.

Triage, assignments, the gradebook, the roster, the modules, and the settings are six sidebar items and six addresses. "All courses" sits above them in its own group, separated. The Course navigation item is gone, and so is the button on triage that pointed at it.

**What the change was really about is that each view is now an address.** The switcher keeps the view across a change of cohort because there is a view to name; a link can point at the roster rather than at a page plus a tab; and each screen fetches what it needs. That last one is the part with teeth: `courses.gradebook` served all four tabs, so opening the roster fetched a term's worth of grading cells to list names, and the assignments tab derived its per-assignment counts by filtering those cells **inside a sort comparator** — once per comparison, per sort. It is four procedures now, and the counts are computed on the server from the same `triageBucket` the gradebook and triage use.

**The bare course address redirects to settings.** With every view a sidebar item there was nothing left for it to render. Kept as a route rather than deleted so every link that names a course goes on working.

**Three things that had no home went.** The heading with its "N submissions waiting on you" — triage answers that, which is now one click from anywhere. The Grading triage button, which was a link to a sidebar item. And the three stat cards: the assignment count and the active-student count are what the two lists beside them already were, and the organization moved to settings, where it sits with the short name because both are what a repository name is made of. The archived-cohort banner moved to settings too, beside the button that causes it.

### Co-teaching, which the settings screen needed and nothing had

The one part of this that was a feature rather than a rearrangement. Settings was meant to carry an invitation link for a colleague, and nothing in the application could add an instructor to an existing course: `CourseInstructor` rows were written in exactly one place, `courses.create`, for the creator.

`courses.coTeachToken` is that link, and the design is one sentence — **it grants a course and never a role.** Only an account already holding `INSTRUCTOR` or `ADMIN` can redeem it; a student is refused and told an admin has to send them an instructor invitation first. Without that, any instructor could hand out staff access by forwarding a course link, with no admin involved and no record beyond a row, which is what `adminProcedure` exists to prevent. Everything else follows: a second column rather than a reuse of `joinToken`, since the two grant opposite things; a second address, since one screen reading both tokens would have to work out which link it was looking at before it could say anything true; reusable rather than single use, since the role check is what bounds it; and removing the last instructor refused, the same shape as revoking the last admin.

**The limitation is stated on the screen rather than left to be discovered.** `accept` adds collaborators at the moment a student accepts, so an instructor added later is not on the repositories that already exist, and one removed stays on the ones generated while they taught. Nothing else in the application would explain why a student's code will not open.

`npm run verify:enrollment` covers it — 27 checks whose centre is one account refused as a student, promoted, then admitted and able to call a teach-gated procedure, because a `CourseInstructor` row that exists but does not actually let somebody work in the cohort would look entirely correct in the database.

---

## Seeing a course as a student sees it

An instructor should be able to look at what they have published the way a student meets it — the assignment list, the accept button, the submission instructions, the feedback screen. It is the cheapest way to catch an assignment whose instructions make no sense or whose kind hands out the wrong thing, and there is currently no way to do it.

`/courses` used to offer this by accident and got it backwards: the obvious link took an instructor to the *student* view of their own course, which is not what a student sees at all. It shows the instructor their own submissions, and they have none — so an instructor previewing their course would conclude every assignment was unstarted, which is true of them and true of nobody else. That link now opens the instructor view and the second one is gone.

Doing it properly needs a **test enrollment**: a student-shaped identity the instructor can look through, enrolled in every course automatically, whose submissions are real rows so accepting and submitting behave normally. What that has to settle:

- **Whose rows are they.** One test profile per instructor, per course, or one for the whole application. Per instructor is the least surprising — two instructors previewing the same course would otherwise fight over one submission — and the most rows.
- **It must not appear anywhere a real student does.** The gradebook, the roster, triage, the queue, and every count on a course card. That is a filter in more places than it sounds, and each one missed reports a test row as a student who has not started. A flag on `Enrollment` or `Profile` is the mechanism; finding all the readers is the work.
- **Whether it can be graded.** Almost certainly not: an approved grade on a test row would reach the Salesforce sync as a real one. Refusing at approval is the safer end.
- **How an instructor switches into it**, and how obvious it is that they are in it. A preview that looks like the real thing is a way to grade the wrong person.

**Separate from [enrollment](#student-enrollment--done), and after it.** The argument for bundling them is that both add a roster state every reader has to learn about, and it is weaker than it looks: teaching those readers about `REMOVED` is the expensive pass, and adding a third state to a pattern that already exists is much cheaper than establishing the pattern. This is also the only part of this area whose design is unresolved — the four questions above — and there is a version that costs nothing meanwhile, which is joining your own course with a second GitHub account.

---

## Targeted assignments, and excusing a student

A new capability rather than a screen, and it needs a data-model decision. Today an assignment implicitly applies to every active enrollment in its course — a submission row appears when a student accepts, and the gradebook treats a missing row as not started. Neither "this assignment is only for these students" nor "this student is excused from this one" can be expressed. The options are a per-student exclusion row against an assignment, or an explicit targeting list, and the choice matters for the gradebook: an excused student must read as excused rather than as missing work, or the distinction is worthless.

---

## Course ownership — done

**Built**, and described in [the README](README.md#who-owns-a-cohort). `CourseInstructor.isPrimary` marked whoever created the cohort and meant almost nothing: `removeInstructor` refused only the *last* instructor, so anybody who taught a course could remove its creator, and `setArchived` was teach-gated rather than owner-gated, so any co-teacher could retire a cohort somebody else ran. Neither was malice waiting to happen so much as a permission nothing guarded, which became worth guarding the moment a course could have a second instructor.

Three changes, and they are one feature rather than three:

- **The owner cannot be removed by anybody else.** A check comparing the caller against the row, not just against the count.
- **The owner can transfer the course**, which is what makes the first rule livable. Without it, "the owner cannot be removed" reads as "the person who set this up runs it forever", and somebody who leaves the program leaves a cohort nobody can take responsibility for. Transfer moves `isPrimary` to another existing instructor of the course; leaving afterwards is then the ordinary `removeInstructor` they already have.
- **Only the owner archives, and only the owner reopens.** Retiring a cohort changes what every student in it sees, which is the one action here with reach beyond the instructor performing it. Reopening is the same gate because it is the same mutation with a boolean, and the consequence is worth stating rather than discovering: a co-teacher can find an archived cohort in their course list, read all of it, and not bring it back. That is the right side to err on — an archived cohort somebody else retired is not theirs to un-retire.

**This reversed something the README stated.** It said the primary instructor was removable on purpose, so that "who created this" does not outrank "who runs it now" — which was right when the only alternative was permanence, and stopped being right once transfer existed. Transfer is what answers that objection, which is why the two had to ship together.

**An admin is above all of it.** `assertTeachesCourse` already lets an admin act on any course, and ownership does not narrow that: an admin can remove an owner, archive anybody's cohort, and hand one on. Deliberate rather than a leftover of a guard written for something else — an admin is the recovery path for an owner who left the program without transferring, and without it every rule above is a way for a cohort to end up with nobody who can administer it.

**Ownership is derived rather than only stored.** The owner is whoever holds `isPrimary`; when no row does, it is the longest-serving instructor on the course — earliest `createdAt` — and a course with no instructors has no owner. One function answers the question and every reader calls it, so the badge on the settings screen and the guard inside the procedure cannot come to different conclusions about who the owner is.

The fallback is what makes a deleted account safe. `CourseInstructor` cascades on the profile, so deleting an owner's account takes the `isPrimary` row with it, and every rule above then has no subject: a cohort left with instructors, none of whom can archive it or remove anybody. Nothing in the application deletes a profile — that is a database action somebody takes by hand — so this is an integrity rule rather than a feature path, and it has to hold with nobody there to invoke it. Writing the row to an admin instead is worse: an admin's reach comes from the role rather than from a `CourseInstructor` row, so inserting one would put every orphaned cohort into that admin's own course list as a course they teach.

**One primary per course is a database constraint.** `is_primary` is a boolean carrying a uniqueness rule the schema does not state, so two rows on one course are representable — and transfer is the operation that would produce them, since it clears one row and sets another. Two owners is two people who can each archive the cohort and neither of whom can be removed, and it fails quietly: the join preview takes the first row it finds and looks entirely normal. A partial unique index says it instead:

```sql
CREATE UNIQUE INDEX "course_instructors_one_primary_per_course"
  ON "course_instructors" ("course_id") WHERE "is_primary";
```

Prisma cannot express a partial index, so it lives in the migration and not in `schema.prisma`. That would normally mean the next schema change proposes dropping it; it does not, because `migrate diff` cannot see it either, which is checked rather than assumed. Being checked per statement, transfer clears the old owner before setting the new one, inside a transaction.

### What checking it found

`verify:enrollment` is 161 checks, and the ownership group is written in pairs — the owner allowed and the co-teacher refused at the same call — because a one-sided check passes against a guard that refuses everybody. Three things came out of writing it, and all three are about the *script* rather than the feature.

**The group was measuring the admin bypass and calling it ownership.** The seeded cohort's creator is the deployment's admin, and `assertOwnsCourse` lets an admin through, so every "the owner may" check passed for a reason unrelated to owning anything — and would have kept passing with ownership removed entirely. It now demotes that account to `INSTRUCTOR` for the duration of the group and restores the role afterwards, which is also what makes the admin bypass checkable on purpose at the end rather than by accident throughout. The check that caught it was the one expecting a refusal *after* a transfer: the old owner archived the cohort anyway.

**The script was choosing its instructor by whichever row came back first.** `courseInstructor.findFirst` with no ordering was fine while a course had one instructor and stopped being fine the moment it could have two, because archiving is now owner-gated — a run that picked the co-teacher would report a working guard as a broken feature, and one that picked the owner would pass by luck. It asks for the owner now. Same family as [the two scripts choosing an outsider by a proxy](#two-check-scripts-were-reporting-a-hole-that-was-not-there), which is the second time this shape has appeared.

**Postgres resolves `now()` to the transaction's start time**, and the whole script is one transaction — so two `CourseInstructor` rows written minutes apart in code share a `createdAt` to the microsecond. The fallback check would have been measuring its tie-break rather than the longest-service rule it claims to be about. One row is backdated so the ordering is real.

The constraint itself is read out of `pg_indexes` rather than provoked. Writing a second primary row would prove the same thing and abort the transaction every other check runs inside — and reading it is what makes this notice a deployment where the migration has not been run, which is the failure mode a rule living in the database rather than in a procedure actually has.

---

## Archived courses need a way back, and a way out — done

**Archiving used to lose the cohort.** `courses.listMine` filtered `archivedAt: null` with no way to ask for the rest, so once a cohort was archived there was no link to it from anywhere in the interface. Every procedure still admitted its members — `courses.get`, the gradebook, an assignment's queue, a student's released feedback — so the work was all there and reachable by a URL somebody happened to still have. The README said an archived cohort "stays readable to the people who were in it", which was true of the procedures and false of the navigation.

**`listMine` returns them now, labelled**, in the way it already labels a course a student was removed from, and each reader decides what to do with them. The course list puts them in a section of their own beneath the running ones, with a line saying what an archived cohort still is; the course switcher lists them last and names them, which also fixes a switcher that printed a bare uuid whenever the address was an archived cohort's; and the two readers that want the cohort somebody is in the middle of — the `/instructor` landing redirect, and the copy-from picker on a new course — filter on `archivedAt` themselves.

**The copy-from picker is the one that gets better rather than merely correct.** A cohort is normally copied the term after it finished, which is exactly when the source has been archived — so the list that used to be filtered was empty at the moment it was most wanted.

Two checks replaced the two that asserted the old behaviour: an archived cohort is in the list and carries the label, and — from the other side — a student whose cohort has been archived still has it on their own list while its work is out of triage. That second one is the half a reader is most likely to get wrong, because "archived" reads as "gone".

**Deleting an archived course was the second half, and it is the destructive one.** Removal is permanent by decision — there is no soft delete anywhere in the application — and a course cascades to its modules, assignments, submissions, grading drafts, sections, test runs, enrollments, and instructor rows. It has the same shape as `assignments.remove`, which is the closest precedent and got this right: a `removalImpact` read that counts what would go, a typed confirmation enforced **in the procedure** rather than in the dialog, and a report afterwards of what was destroyed.

Two constraints, both now gates rather than intentions:

- **Archived first.** Deleting a live cohort is refused, because archiving is reversible and deletion is not — making it the only path means the destructive action always has a survivable step in front of it, and somebody who meant "take this off my list" gets exactly that before reaching anything permanent.
- **Owner only**, which [ownership](#course-ownership--done) made expressible: `assertOwnsCourse` is the gate, the same one archiving uses. If any co-teacher could archive and then delete, those rules would buy nothing. Both conditions are asked in one place that the read and the mutation share, so the day one of them is added to the mutation and forgotten on the query, a screen does not start previewing something it cannot do.

**The confirmation asks for the cohort's short name, not the course name.** A program runs every term under the same name, so typing "Software Engineering Fellowship" would confirm the wrong cohort as readily as the right one — and `cohortSlug` is unique by construction, which is what makes it the thing that identifies *this* term. The impact read returns it so the screen and the procedure ask for the same string.

**Uploaded files are deleted; GitHub repositories are not.** That asymmetry looks inconsistent and is the point. A repository holds a student's own work and they can reach it on GitHub whether or not this application still knows about it, so deleting it would destroy something — losing a cohort's work because somebody tidied a course list is the worse failure, and the same reasoning already leaves them alone when an assignment is removed. An object in the private bucket had exactly one reader, which is the row about to go: leaving it is not preservation but a file nobody can ever reach again, paid for forever. The storage removal runs after the rows and is best effort, because the database is the authoritative act and a bucket that refuses should not leave a cohort half deleted; the paths that would not go are named in the result, which is the only way anybody could find them afterwards.

Nine of the checks are refusals, and every one of them also asserts the cohort is **still there** — a refusal that returned the right code while the rows went anyway would look correct in every log the script produces. The cascade is asserted rather than assumed for the same reason: each of those foreign keys carries its own `onDelete`, and the one that is wrong is the one leaving rows pointing at a course that no longer exists.

The database's own backups are the only way back from a mistaken deletion. That is already true of removing an assignment and is restated on a screen that can destroy a whole term.

---

## Copying an assignment into another cohort — done

**Built**, and described in [the README](README.md#copying-an-assignment-into-another-cohort). Most of it already existed: `assignments.duplicate` has taken a `targetCourseId` since it was written, teach-gates *both* courses so an instructor cannot read a cohort they do not teach, and copies through `copyAssignmentInto`, which carries both repositories, the answer key folder, the runner, the sections, the point values, and the submission instructions — and no submissions, because it writes a new row rather than moving one. Copies arrive unpublished, and course creation already looped over it to copy a whole term. What was missing was a course picker: the menu hardcoded the current course, so the cross-cohort case the procedure was written for was reachable only by writing the call.

**The module was the real design question**, and it is answered by naming it. `copyAssignmentInto` matches the source's module across courses by name and refuses when the target has none — the right refusal, and it means copying into a cohort whose modules are named differently fails on every assignment. Of the three options on the table, the cheapest was to say plainly which module is missing and the useful one was to name the target module; the dialog does both, defaulting to the name match where one exists and saying which of the two just happened. A silent name match and a silent fallback to the first module look identical on screen, and one of them is a decision somebody should be making.

`targetModuleId` is checked against the target course rather than merely looked up. A module id is a parameter anybody can pass, and `moduleId` is a foreign key to modules rather than to modules *of this course* — so without the check a copy could be filed under a third cohort's module, which no screen would show and no constraint would catch.

**The copy keeps `assignmentRepoName` across cohorts**, which was the other thing to decide. It is per course by constraint and the generated repositories still differ, because [the cohort's short name prefixes every one of them](README.md#the-cohort-is-in-every-repository-name) — so renaming would break the correspondence between two runs of one program for nothing.

**Copying within a course was the case that had to rename, and the button did not.** It built a name out of the assignment's human title, which is not a legal repository name the moment a title contains a space — so the one thing that menu item needed to do was the one thing it could not. The name is derived in the procedure now: `-copy`, then `-copy-2`, up to ten, bounded because a loop with no ceiling around a database query is a worse failure than the refusal.

**An archived cohort takes no copies**, added with the rest because archived cohorts are now [in the course list](#archived-courses-need-a-way-back-and-a-way-out--done). One is a thing somebody can be looking at when they reach for a copy, and a finished term quietly gaining an assignment is a change nobody would see.

`verify:authoring` is 156 checks. The one worth reading is that copying the same assignment into one cohort twice is refused — it follows from the copy keeping its repository name, it is the reason the name-match check needs a second target cohort, and it is the kind of thing a script discovers by colliding with its own fixture rather than by being written down first.

---

## More kinds of thing a student can hand in — done

**Built**, and described in [the README](README.md#handing-in-a-file). Two of the three were a few lines. The third was not what it looked like.

**Jupyter notebooks and spreadsheets are entries in `UPLOAD_FILE_TYPES`** — `notebook` for `.ipynb`, `spreadsheet` for `.xlsx`, `.xls`, and `.csv`. That map is a closed vocabulary on purpose: an instructor ticks named types and the extensions follow, because a typo'd MIME type is a student being told their correct file is the wrong kind on the due date.

**Adding them turned up a defect the existing types already had.** The map kept extensions and MIME types as two lists side by side, and the stored content type was whatever the browser reported — so a `.docx` arriving as `application/octet-stream` on a machine without Word was accepted by the route and refused by the bucket, which builds its allow-list from those same MIME types. On that student's machine and no other. A notebook makes it certain rather than occasional: browsers report `.ipynb` as `application/json`, as `application/octet-stream`, or as nothing. Each type now maps its extensions **to** the content type they are stored under, `contentTypeFor` decides it, and the browser's claim is not passed to the storage layer at all.

**`npm run setup:storage` has to be re-run against every environment**, because that script builds the bucket's allow-list from this map. Forgetting leaves the route accepting a file the bucket then refuses, which appears only on a real upload and only where nobody re-ran it.

**Neither previews.** `previewKindOf` answers `pdf` or `image` and everything else downloads, which is the honest answer for a spreadsheet and a poor one for a notebook — the most-read of these and the one where the download-and-open-elsewhere loop that [embedding a PDF exists to remove](README.md#handing-in-a-file) costs most. Rendering one is a real dependency and its own decision; the check saying a notebook does not preview is there so the answer reads as deliberate rather than as an oversight.

### Google Slides was not a file type, and the kind was misnamed

`GOOGLE_DOC` is now `GOOGLE_DRIVE`, and `templateDocUrl` is `templateDriveUrl`. Slides and Sheets are the same shape as Docs: handed out as a copy link, handed in as a link to the student's own copy, graded by hand. The `/copy` substitution is a property of how Google's editor URLs are built and it holds for all three — so they were never three kinds, they were one kind named after the only editor its URL check happened to accept.

**Widening the check meant naming the editors, not accepting any Google address.** The pattern matches `docs.google.com/(document|spreadsheets|presentation)/d/<id>/(view|edit|preview)`. A Form, a Drawing, a Drive folder, and a published `/pub` link are all `docs.google.com` and none of them produces a copy prompt from the substitution, so admitting them would move the failure from the field where the link was typed to every student who pressed Accept. That is the whole reason the shape is checked rather than trusted, and widening it without widening the substitution to match would have thrown it away.

The alternative was a fifth `AssignmentKind`, and the deciding question was whether "a slide deck" and "a document" are different things to an instructor authoring an assignment or the same thing with a different link. They are the same thing: the fields, the distribution, the collection, and the grading are identical, and the only difference is which editor the template opens in.

**The migration is two renames** — `ALTER TYPE ... RENAME VALUE` and `ALTER TABLE ... RENAME COLUMN`. Both are metadata-only in Postgres, both keep every existing row exactly as it is, and neither has a window in which a row means something different from what it meant a moment before. **It is required rather than optional**, unlike the ones before it: until it runs, every read of an assignment names a column the database does not have.

An Excel spreadsheet had the same fork and it is settled the same way, in the other direction: a `.xlsx` upload and a Google Sheet link are genuinely different assignments — one is a file in private storage and the other is a link to a file the student owns — so both exist and an instructor picks the kind that matches what they are asking for.

---

## Dividing grading between co-teachers

A cohort can have more than one instructor now, and nothing says who grades what. Two people working the same triage list either duplicate each other or quietly assume the other is doing it, and both failures are invisible until a student is waiting.

Nothing exists for this — there is no grader column anywhere — so the whole thing is a design question. What has to be settled:

- **The grain.** Per assignment ("you take the loops exercise") is the coarsest and matches how the work is actually divided; per student ("you take these twelve") is how a cohort is usually split for feedback continuity; per submission is the finest and the only one that lets two people share one large assignment. They are not exclusive and the first two are probably both wanted, which is an argument for storing the assignment rather than deriving it.
- **Advisory or enforced.** Whether a submission assigned to somebody else is hidden, dimmed, or merely labelled. Enforcement is the wrong instinct here: co-teachers cover for each other, and a screen that refuses to let one of them approve a draft at the moment they have time is worse than one that says whose it is.
- **What the counts mean.** "N waiting on you" currently means "waiting on anybody who teaches this cohort", and three readers were just made to agree on that one figure. A per-grader figure is a **fourth question**, not a filter over the third — and the honest version shows both, because "nothing assigned to me" and "this cohort is caught up" are different facts and only one of them means an instructor can stop.
- **What happens when the assigned grader leaves.** `removeInstructor` would otherwise leave submissions assigned to somebody who cannot open them, which is worse than unassigned because it reads as covered.

This is worth doing after [working a pile by what it is](#working-a-pile-by-what-it-is-not-only-by-what-it-needs), because both add an axis to the same screen and the other one is smaller and has no schema.

---

## Working a pile by what it is, not only by what it needs

"Grade all the resubmissions at one sitting" is a real way to work, and triage cannot express it — **for a reason worth knowing before building anything.** `triageBucket` is a vocabulary of *what action is outstanding*: no report yet, to grade by hand, draft ready, held for review, failed, never delivered. It is deliberately not a vocabulary of what a submission *is*. A resubmission with no report and a first submission with no report are both `needs_report`, because the action is identical, and that is what makes the buckets exhaustive and the counts trustworthy.

So this is a **second axis over the same pile**, not a seventh bucket. Adding `resubmission` to the enum would break the property every count on three screens rests on — that the buckets partition the outstanding work — because a submission would then belong to two.

What the axis is made of is already on the row: `submission.status` distinguishes `SUBMITTED` from `RESUBMITTED`, `isLate` is computed at submission, and "revised since grading" is `headSha !== gradedHeadSha` and needs no query. So the filter is presentation over data that exists, which is what makes this small.

Two things it needs beyond a filter control:

- **It has to work across assignments**, which is the whole point — triage is already cohort-wide, so this belongs there rather than on one assignment's queue, and the queue's own filter should probably learn the same axis for consistency.
- **A way to work the filtered set in order.** Grading twenty resubmissions means opening one, approving it, and wanting the next one without going back to a list. The review surface has no next-and-previous today, and a filter that hands somebody twenty items and no way to walk them is half the feature. That is shared with [dividing grading](#dividing-grading-between-co-teachers), which produces exactly the same need.

---

## The Modules screen shows the course the way a student meets it — done

**Built**, and described in [the README](README.md#interface). It was a list of module names with up and down buttons — accurate, and it says nothing about what is *in* a module. So the question an instructor actually has about their module list, "is this in the right place and does this module have anything in it", cannot be answered from the screen that manages modules.

**It becomes the student's course page, with module management on it.** Each module is a dropdown, the same collapsible the student page already uses, holding that module's assignments in due-date order and its resources beneath them in alphabetical order. The reordering buttons move onto the module headers, beside the module they move. Creating, renaming, and removing a module stay here too — everything about modules in one place, which is what it already was.

**The assignments and resources listed here are not interactive.** No links, no per-row menus, no publish toggles. This screen shows the *shape* of the course; the Assignments screen is where assignments are worked on, and a second route to the grading queue that looked different from the first would be two answers to the same question. The cost is real and accepted: an instructor who spots something in the wrong module here goes to Assignments to move it.

**The Assignments screen is unchanged and stays the working surface.** Its table, search box, module and kind and due-date filters, five sortable columns, and All/To grade/Published/Drafts switcher are how an instructor finds one assignment among fifty and finds where the grading is, and none of that survives an accordion. It is also where a new assignment is created. The two screens answer different questions — this one "what does this course look like", that one "which assignment do I need" — and neither is a worse version of the other.

**Drafts are shown, with the Draft badge the assignments table already uses.** The alternative is a truer mirror — omit what a student cannot see — and it is the wrong trade: a module that is full to the instructor and empty to students would then read as simply empty, which is the exact confusion this screen exists to remove. Marking them instead makes it diagnostic rather than merely accurate, and answers the question directly: *this* is why your students see nothing in Mod 4. So "mirrors what students see" is the shape and the ordering, not a rule about visibility.

**This is not [seeing a course as a student sees it](#seeing-a-course-as-a-student-sees-it) and does not replace it.** That item is a test enrollment an instructor can look *through* — the accept button, the submission instructions, the feedback screen, the whole flow. This is the shape only, with no submissions and nothing to press. What it does do is cover the cheapest and most common case for free: catching an assignment filed under the wrong module, or a module that is empty when it should not be.

Almost all of the rendering already existed in `components/student/course-detail.tsx` — `groupByModule` builds from the course's module list so an empty module still appears, and `ModuleSection` is the collapsible, open when it has contents and closed when it does not. The work was a version of it that takes module actions and renders non-interactive rows, not a new component from nothing.

**Resources are not in it**, because they do not exist yet — [that is the next item](#content-that-is-not-an-assignment). Each module's Resources section slots in beneath its assignments when they do, and nothing about the screen has to change to accept them.

### Two check scripts were reporting a hole that was not there

Found by running the suite after this change, and worth more than the feature it came out of. Both `verify:modules` and `verify:authoring` prove that an instructor who does not teach a course cannot act in it — the check the INSTRUCTOR role alone cannot make — and both picked their outsider as **"an instructor who is not the one this script acts as"**. That was the same question only while a course had exactly one instructor.

Co-teaching made it false. The seeded course gained a second instructor, the query started returning somebody who *does* teach it, and both scripts reported a failure that was the check being wrong rather than the procedure. The reverse is the worse case and the reason this is not merely a broken test: on a different set of rows the same query picks a genuine outsider and the check passes **by luck**, proving nothing while looking correct — and `verify:modules` had been skipping it entirely for want of any second instructor at all.

Both now ask the question they are actually about, `instructorOf: { none: { courseId } }`, which cannot go stale as courses gain or lose instructors. Same family as [the check scripts reporting passes they had not earned](#the-check-scripts-were-reporting-passes-they-had-not-earned): a script that selects its fixtures by a proxy for the property it needs will eventually select the wrong one, and the failure is silent in the direction that matters.

---

## Content that is not an assignment

Readings and external links, open-ended rich text, and embedded video. The largest of these items, and the reason is not the editor — it is that a module currently has exactly one kind of child.

**`assignments.moduleId` is a foreign key and assignments are a module's only children.** A student's course page renders a section per module and fills it from the assignment list; the gradebook's columns are assignments; triage counts submissions against assignments. Putting a second kind of thing under a module means every one of those readers has to decide what it does about a thing with no submission, no score, no due date, and no gradebook column.

That is the same shape as the problem [the kind axis](#step-0-the-kind-axis--done) solved, and the lesson from it applies directly: **name the axis in the schema before building any screen**, and let the compiler enumerate the readers rather than a search hoping to find them. That is what made adding a fourth `AssignmentKind` an afternoon.

The model decision, which should be made before anything else:

- **A sibling table under `Module`** — `ModuleContent` or similar, with its own `kind` — keeps assignments exactly as they are and costs every reader that wants "everything in this module in order" a merge of two lists.
- **A shared parent** — a module item that is either an assignment or content — is the tidier model and a much larger migration, since `Assignment` is referenced by submissions, drafts, and test runs.

The first is almost certainly right for the same reason the modules table was: the cheap version that does not touch what already works.

### Ordering, which is settled and needs no new column

**Resources do not interleave with assignments.** A module reads as its assignments, then a Resources section beneath them. That is what makes the ordering question go away rather than needing an answer:

- **Assignments sort by due date, earliest first, and cannot be reordered by hand.** A due date is a fact an instructor already maintains and a student already reads, so an explicit position beside it would be a second ordering to keep in step with the first — and the day the two disagree, nothing says which is right. An assignment with no due date sorts **last**, which is the rule the assignments table's own due-date sort already applies in both directions: no due date is not earlier or later than every date, it is outside the ordering.
- **Resources sort alphabetically by title.** They have no date and no natural sequence, so the only orderings available are alphabetical and manual, and alphabetical is the one that needs nothing maintained.

So neither `Assignment` nor the content table gains a `position`, and modules keep the only manual ordering in the course — which is the right place for it, because a module is a unit of teaching and the things inside one are already ordered by when they are due.

**One consequence reaches the student side.** `assignments.listForCourse` orders by `[{ module: { position } }, { title }]` today, so a student's course page is alphabetical within a module. Due-date ordering changes that page as well as the instructor's, which is an improvement and worth stating rather than discovering: it is a change to what every current student sees.

### A Resources page, and a course-level list

**Its own screen and its own sidebar item**, beside Assignments, listing every resource in the course grouped by module with the actions to add, edit, and remove one. The same shape as Assignments for the same reason: the thing being authored gets a screen, and the module accordion is where the result is read.

**Every resource belongs to a module**, so `moduleId` is a `NOT NULL` foreign key exactly as it is on `Assignment`. There is no course-level resource, because a student reads the course as a list of modules and a resource outside all of them has nowhere to appear.

**No draft state, deliberately.** Assignments have `distributedAt` because handing one out starts a clock and creates work; a link to a reading does neither, and a student seeing one early is not a problem the way an unfinished assignment is. So a resource is visible as soon as it is added, and there is no publish step, no Draft badge, and no fourth thing for the module accordion to explain. If that turns out to be wrong, adding the column later is cheap — the reverse, taking a publish step away once instructors rely on it, is not.

### The three kinds

- **A link with a title and a description** is the whole of the readings case, and it is the one to build first because it needs no editor at all.
- **Rich text** should be markdown, because `submissionInstructions` already is and the report markdown a student reads already renders through this application's own renderer. A second content format would mean a second renderer and a second set of rules about what is allowed in it.
- **Embedded video** is a URL plus an iframe, and the only real decision is whether arbitrary embed HTML is ever accepted — it should not be, for the same reason the upload check is a closed vocabulary. Store the video id, build the embed, and refuse anything that is not a URL shape the application recognises.

Nothing here is graded, nothing is submitted, and nothing appears in the gradebook. Saying that plainly is most of the design: the value is that a student's course page becomes the whole of the course rather than only the parts that are marked.

---

## Small things

Individually not worth their own section, and kept here so they are not lost. Each one is small enough to do whenever something else is open in the same file.

- **The breadcrumb should read "Course Name (cohort)".** It names the cohort as plain text and gives only the name, so two terms of the same program produce identical trails — which is the fact the course switcher spends a whole control on. The data is already there and needs no new fetch: `ShellBreadcrumb` reads `courses.listMine`, which selects `cohortTerm`, and `useBreadcrumbs` simply types its parameter as `{ id, name }[]` and ignores the rest.

---

## An admin view for approving instructors — done

**Built**: `trpc/routers/staff.ts`, `lib/staff/invite.ts`, `adminProcedure` in `trpc/init.ts`, the `instructor_invites` table, `/admin` with People and Invitations tabs, `/invite/[token]`, and `npm run grant:admin` for the base case. Checked by `npm run verify:staff`.

Two mechanisms, because they answer two different questions: how somebody *becomes* an instructor, and how an existing account gains more.

**An instructor invite link.** An admin generates one and sends it; whoever opens it and signs in with GitHub is an instructor. This works before the person has an account at all, which is the case that matters — a new hire has no reason to sign in to a system they cannot use yet, and a flow that requires them to sign in first, do nothing, and wait to be found on a list is a worse first day.

`instructor_invites` holds a unique token, who created it, an expiry, and — once redeemed — when and by whom. **Single use and expiring**, both because the link grants staff access and a forwarded one is a sharper edge than the course link's: the course link admits a stranger to one cohort, this one admits them to authoring and to every student's grades. Recording who redeemed it is what makes "how did this person get access" answerable afterwards.

**Redeeming never lowers a role.** An admin who opens an instructor link stays an admin. Stated because the obvious implementation is `role = 'INSTRUCTOR'`, which silently demotes.

**A People screen, for accounts that already exist.** Grant admin to an instructor, and revoke. This is what makes the answer to the original question — an admin can make other instructors admins, so they can invite instructors themselves — actually available, since promotion acts on somebody who is already here.

**Refused if it would leave no admins.** Revoking the last one locks every remaining person out of this screen permanently, recoverable only by editing the database. The check is cheap and the failure is not.

### The constraint this must not violate

Migration `20260730024911_tighten_profiles_grants` exists because a signed-in student could once have set their own `role` to `ADMIN` from browser JavaScript. **The role column must never be writable by the account it describes**, and that is a property of the database grants rather than of any procedure — so a correct procedure is necessary and not sufficient. Any migration touching `profiles` re-checks it.

**`adminProcedure` is added to `trpc/init.ts`.** `Role` has three values and `instructorProcedure` is `requireRole('INSTRUCTOR', 'ADMIN')`, so an admin is currently an instructor with wider reach, compared by hand in twelve places. This is the first admin-only feature, so it is where that becomes a procedure — for the reason every other guard here is one: a check remembered at twelve call sites is a check forgotten at the thirteenth.

**The first admin of a deployment is a hand-edited row, necessarily**, because there is nobody to grant it. Worth writing down rather than discovering: this feature does not remove the need for database access, it removes it from the ordinary case. `npm run grant:admin -- you@example.com` is that base case made into a tool rather than a psql session — it cannot create an account, because identity belongs to Supabase Auth, and it deliberately has no reverse: taking admin away is an ordinary decision the Admin screen makes, with the last-admin check that a script bypassing the procedure would not have.

### What the build decided that the design did not

**Single use is enforced by a conditional update, not by a read.** `updateMany` with `redeemedAt: null` in the `where` is what makes two simultaneous redemptions resolve to one winner — the second matches no rows. Reading the invitation and then writing it leaves a window where both callers saw it unused, and this is the one credential in the application where two people getting in on one link matters.

**Redeemed beats expired**, wherever an invitation's state is named. An invitation that was used and has since passed its expiry is the record of somebody being given access; calling it "expired" would hide the fact worth keeping. `inviteState` orders the two for that reason and nothing else.

**A used invitation cannot be deleted.** The row has stopped being a credential and become the record of how somebody got access — the delete button is absent and the procedure refuses it, because tidying that list is how the audit trail would quietly go missing. Revoking their access is a role change, which is a different control.

**`setAdmin` refuses a student.** It only moves an account between INSTRUCTOR and ADMIN. Accepting a student id would make this screen a second path to staff access with no record of it, which is the thing the invitation exists to prevent — so making somebody staff is always an invitation, and this only decides how much.

**The grants are checked, not assumed.** `verify:staff` asserts that `anon` and `authenticated` can UPDATE exactly `display_name` and `avatar_url` on `profiles` and nothing else, that they have no privilege at all on `instructor_invites`, and that row level security is on. That is the most valuable check in the file: it is the only one that would still fail if every procedure here were perfect.

---

## What to verify for all three

Through the tRPC callers inside a rolled-back transaction, which is what `verify:authoring` and `verify:modules` already do — authorization is half of what these procedures are, and a rule that only holds when called through the interface is not a rule.

- **A created course has its creator as primary instructor**, and that instructor can immediately author an assignment in it. The second half is the real check: a course whose `CourseInstructor` row was not written looks fine until somebody tries to use it.
- **A copy reproduces every module and every assignment**, unpublished, with `dueAt` cleared and both repositories and the answer key folder intact — and copying into a course whose modules do not exist yet is refused rather than half-applied.
- **A copied cohort generates different repository names from the one it came from**, built through the same function `accept` calls rather than reassembled in the check. A duplicate short name is refused, an illegal one is refused, a term with nothing usable in it is refused rather than guessed at, and nothing can change it after the course exists — asserted against the router rather than against a screen, because "the button is not rendered" is a different claim.
- **A removed student's work leaves triage and the grading queue and stays in the gradebook.** Both halves, plus the two that make them meaningful: nobody *else's* work leaves with it, and the student is asserted to have work in triage before anything removes them — every other assertion here is that a list does not contain something, which a student with nothing outstanding would satisfy while measuring nothing.
- **The queue's two lists together are every submission for the assignment**, counted against the table. Written as one query partitioned in two, because a filter and its complement written separately can each miss a row and nothing would report it.
- **The course heading's outstanding count equals what triage shows.** The two are the same claim on two screens, and they disagreed once already.
- **Restoring a student puts their outstanding work back.** Nothing was closed or rewritten on removal, which is what makes it reversible.
- **A student cannot create a course**, and an instructor cannot archive a course they do not teach.
- **Redeeming a join link twice yields one enrollment.** Redeeming a rotated link is refused. Redeeming as a removed student is refused.
- **A removed student can still read the course and their released feedback, and cannot accept, submit, or upload.** Both halves, in the same check, because the pair is the whole point — and because the four widened read checks and the three untouched write checks are the same `where` clause in the same files.
- **A removed student's course is still in `listMine`, and labelled.** The one reader whose right answer is not simply "admit them".
- **A removed student is not counted in the course card's enrollment count.** The one counting reader on the list; the gradebook and triage filter through submissions instead, so what they do with a departed student's existing work is checked rather than changed.
- **An archived course leaves the active lists and stays readable**, and its submissions leave grading triage and come back when it is reopened — while staying readable in the assignment's own queue throughout. Guarded by a check that the cohort has work in triage *before* anything empties it, because every assertion here is that some pile is empty and a cohort with nothing outstanding would pass all of them while measuring nothing.
- **Triage is scoped to the cohort asked for**, checked against a cohort with work and a copy of it with none.
- **An instructor invite is single use**, refuses after expiry, does not demote an admin who opens it, and records who redeemed it. The single-use check is a pair: a *second person* is refused, while the person who used it can open their own link again — each half looks correct without the other, and only together do they mean "one link, one instructor, and a bookmark is not an error".
- **An instructor cannot promote anybody, themselves included**, called directly against the procedure rather than through a screen — six refusals, because that is the escalation `adminProcedure` exists to prevent and one missing guard is the whole of it.
- **Revoking the last admin is refused**, with the count asserted to be one first. A second admin lying around would make that check pass while testing nothing, and the failure it prevents is the only one in this application with no recovery path inside it.
- **A student cannot be promoted directly**, so staff access always leaves a record.
- **The database grants are checked, not the procedures that rely on them**: `anon` and `authenticated` may UPDATE exactly `display_name` and `avatar_url` on `profiles`, have no privilege at all on `instructor_invites`, and row level security is on. The one check here that would still fail if every procedure were correct.

---

## AI grading for non-coding assignments

Short response is already graded and calibrated against an instructor's own marking, so this means the work that has no repository: a Google Doc, an uploaded PDF, a presentation. It depends on [assignment authoring](#phase-7-assignment-authoring--done) supporting those kinds first, because the pipeline's inputs change shape — there is no pull request diff, no changed-file list, and no test evidence, so "the student's work" has to be fetched from Drive or from storage instead.

### Instructor-authored rubrics are a prerequisite, not a companion

Confirmed rather than assumed: this feature requires them. The taxonomy is fixed at the four sections that exist in `rubric.md`, and a resume, a reflection, or a presentation matches none of them — so there is no version of this feature that ships against the current four. It stops being a deferred nice-to-have and becomes the first thing built when this item comes up.

What that touches, so the size is not a surprise:

- **`Rubric` rows are real database rows already**, with a `RubricScaleType`, so storing an authored one is not the hard part.
- **`SECTION_ASSETS` in `lib/grade/assets.ts` is the hard part.** Each of the four section types maps to a heading in `rubric.md` and a sample report file, both read from the grading-guides repository. An instructor-authored rubric has neither, so the rubric text and the sample have to come from the database instead — which means the asset loader stops being "read the file at this path" and becomes "read the file, or read the row."
- **The prompt is built from those assets**, so an authored rubric has to produce the same three things the file-backed ones do: a scale with a written description per band, a heading's worth of criteria, and an example of a good report. The third is the one instructors will not think to provide and the model most needs — worth deciding whether an authored rubric can borrow the closest existing sample rather than requiring a new one.
- **Whole numbers and the flags vocabulary** are properties of the rubric, not of the pipeline. An authored scale still has to be bands with descriptions, or the "no 1.5, put the hesitation in `instructorNotes`" rule has nothing to anchor to.

This is also what makes the section types no longer a closed set, which the classifier currently assumes — `SectionType` is a union of four string literals and `classifySections` matches file paths against them. An authored rubric attached to a Google Doc assignment has no file paths to classify, so the two land together: classification only runs for kinds where "which files did the student change" is a meaningful question.

---

## Open thinking: where rubrics, answer keys, and sample reports live

**Not decided, and deliberately not being implemented.** Written down because it changes the shape of `lib/grade/assets.ts`, and knowing it is coming affects how much is invested there in the meantime.

The idea: move **rubrics** out of the grading-guides repository into a shared Google Drive folder, so that a non-technical instructor can write and upload one without touching git. Answer keys for technical assignments stay in GitHub, where they belong next to the code; answer keys for non-technical assignments live in Drive. Sample feedback reports possibly move too. The grading-guides repository simplifies to a collection of answer keys, and `agent-rules.md` moves into this application's own file structure.

**The strongest part of this is `agent-rules.md` moving into the repository.** It is not reference material, it is prompt code: it sets tone, formatting, the two-beat summary, the half-credit nesting rule, and the prohibition on flag text reaching a student. A change to it changes every grade the application produces. That belongs in a pull request with a diff and a deploy, not in a documents folder — and `modelMetadata` already records a prompt version, which would then be a version of something in this repository.

**The strongest argument for Drive is the one that motivated it**: a rubric written by an instructor who does not use git is a rubric that never gets written otherwise. That is the whole reason instructor-authored rubrics matter, so this is not a minor convenience.

Three things to work out before it is worth doing, each of which is a real cost rather than a detail:

- **Reproducibility is currently a commit SHA.** Assets are read at a resolved commit, cached under `sha:path` with no expiry — safe because content at a commit cannot change — and that SHA is stamped into `modelMetadata` so any report traces back to the exact rubric that produced it. Drive has no equivalent single identifier for a set of files. It does have a revision id per file, so the property is recoverable, but the shape changes: one SHA becomes a set of per-file revision ids, and every place that treats the asset commit as one value has to stop doing that.
- **Sample reports argue against moving.** They steer the model's output format as directly as `agent-rules.md` does, so the same reasoning that says agent rules belong in the repository says samples do too. This is the one part of the idea that cuts against itself, and worth resolving deliberately rather than by whichever is more convenient to move.
- **It is a second Drive integration, and that is an argument for timing rather than against.** Reading a student's Google Doc submission needs Drive access anyway. Doing both at once — assets from Drive, submissions from Drive — costs one authentication story instead of two, which suggests this belongs with [AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments) rather than as its own project.

Also unresolved, and cheap to note now: an instructor uploading a rubric to a folder is not the same as an instructor *authoring* one in the application. The first is a file whose structure nothing validates; the second is rows with bands and descriptions the prompt can be built from. A rubric the model has to be handed as an opaque document is a weaker input than one with a scale it can be told to score against, so "instructors upload rubrics to Drive" and "instructors author rubrics in the application" are different features that happen to serve the same person.

---

## Scaling: what a hundred students costs, and where it breaks

**Questions to hold rather than work to schedule.** Nothing here is a known problem — the largest thing this has run against is one cohort — and most of what would answer it is measurement [token management](#token-management) produces anyway. It is written down because the answers change what [triggering and orchestration](#phase-4-triggering-and-orchestration) should be, and that decision is already waiting.

**What is already measured**, from [what a report costs](README.md#what-a-report-costs) and the sandbox durations in `test_runs.duration_ms`: a report is roughly $0.09 to $0.15 at `high` effort, output is about 60 percent of it because thinking is billed as output, a sandbox run is 30 to 40 seconds, and a single submission end to end is about two minutes at the worst measured case. So a hundred students on one frontend assignment is on the order of $15 and, if run one after another, over three hours of wall clock. Neither figure is alarming; both are worth knowing before a batch button exists.

**Concurrency is the question Phase 4 already frames.** Its requirement 4 — that a batch must not be bound by one function invocation's limit — is answered by fanning out one invocation per submission, because two minutes sits comfortably inside 300 seconds. What a hundred students changes is not that arithmetic but what happens when a hundred of those invocations run at once, which is where every vendor limit below actually bites.

**Anthropic.** Rate limits are per organization and counted in requests and tokens per minute, so the ceiling on a batch is not the money, it is how many reports can be in flight before requests start being refused. Two things follow: whatever runs the batch needs to handle a rate-limit response by waiting rather than by failing a submission, and [prompt caching's five-minute window](README.md#what-a-report-costs) means a burst is meaningfully cheaper than the same work spread across an evening — which argues for the grading-session model rather than against it. Worth separating from developer tooling: the grading spend is the Anthropic API, and Claude Code is a different line item that scales with how much is built rather than with how many students there are.

**E2B.** Concurrent sandbox count is the limit that matters, not total minutes, and a sandbox bills until its own timeout expires — which is why `sandbox.kill()` is in a `finally` block. A hundred concurrent runs is the first time a leak would be expensive rather than merely untidy. The other thing a hundred students changes is that 6 to 17 seconds of dependency installation per run stops being a detail: [building custom templates with dependencies already present](README.md#the-sandbox-run) is the largest speed improvement available and it gets more valuable linearly.

**Supabase.** The application connects through the pooled `DATABASE_URL` and migrations use `DIRECT_URL`, which is the arrangement that survives many concurrent functions — a serverless fan-out against a direct connection is how a connection pool gets exhausted. Two other limits to know: the storage bucket for uploaded submissions grows without bound, since a re-upload writes a new object and [the previous one is deliberately left in place](README.md#handing-in-a-file), and a hundred students' resumes at up to 25MB is a real number. Nothing prunes it today.

**Vercel.** The 300-second function limit is the one already reasoned about. Beyond it: a fan-out of a hundred invocations is a hundred invocations' worth of Active CPU billing, and the webhook path is unaffected because it does one database write.

**The one that is not a vendor limit.** A hundred students produce a hundred drafts an instructor has to read, and no amount of concurrency helps with that. Triage, [working a pile by what it is](#working-a-pile-by-what-it-is-not-only-by-what-it-needs), and [dividing grading between co-teachers](#dividing-grading-between-co-teachers) are the parts of this list that actually address a cohort of a hundred, which is worth noticing given they are the three cheapest items on it.

---

## Deferred, with the schema left open

- **SQL sandbox execution.** The design is settled: boot an ephemeral PostgreSQL, run `setup.sql`, and compare each numbered query's result set — rows, columns, and order — against `queries-solution.sql` programmatically, which makes SQL correctness fully deterministic with no model judgment involved. It needs an E2B template with PostgreSQL installed, and is the largest gap in what can be graded deterministically.
- **Frontend execution scoring.** Matches today's manual process, which is a README checklist and a code-reading judgment. Lint and build only, to catch hard errors.
- **The GitBook resource link index.** Pre-build a heading-to-URL index for `marcy-curriculum-docs` per module — the URL scheme is fixed at `.../{module}/{lesson}#{subheading}` — and pass candidate links in context for the model to select from rather than construct. Until this exists, prompts omit a recommended resources section entirely rather than risk invented URLs.
- **Answer keys in the cacheable prefix.** They are identical for every student of a given assignment but sit in the user content, so they are billed at full input price on every run. Moving them into the system block would give each assignment its own cache entry. Worth roughly 6 percent of the cost of a report, which is why it waits behind the `effort` question.
- ~~Instructor-authored rubrics~~ — no longer deferred. They are a prerequisite for [AI grading for non-coding assignments](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), which is where the work is described.
- **A manifest in the assignment repository.** A file in each template — `assignment.json` rather than a block in `package.json`, since `package.json` is a protected path the sandbox merges under its own rules and Python and SQL assignments have none — declaring section types, point values, and answer keys. It would let `SEED_ASSIGNMENTS` be deleted, make the repository the author of what an assignment *is* rather than an instructor retyping it, and support a drift check when a cohort's copy no longer matches the curriculum. Deferred because the recurring cost it removes is already covered by `duplicate`, and because designing it after a real cohort has been set up beats designing it against a guess. Any version of it must read from the template and never a student's copy, and be read server-side rather than trusted from the browser.
- **Bulk grading** beyond the basic gradebook table, and a single action that generates reports for every submission still waiting on one.
- **An early-intervention dashboard.** `lastActivityAt`, `isLate`, and `status` already support it.
- **A per-student record that accumulates over time and informs grading.** Requires deciding what is tracked and deserves its own design discussion.
- **A grading assistant mode** that identifies patterns across a student's assignments relative to a rubric. Depends on the previous item existing first.

Assignment types with no `rubric.md` section yet, such as some mod-5 and mod-8 assignments, route to `needs_manual_review` rather than expanding the rubric now.

---

## Open items

- **`GRADING_ASSETS_REPO` must be set in `.env.local`.** It is now required rather than optional, since the local-clone source is gone, so grading and `verify:assets` both fail without it. The installation id beside it is already correct: the development App is installed on `The-Marcy-Lab-School`.
- **Which GitHub organization — settled.** A **new organization**, created for this, rather than `The-Marcy-Lab-School-Assignments`. That org holds the GitHub Classroom era's templates and will not be used at all. Everything verified so far used `marcy-lms-test`, and moving to the new one is a matter of `SEED_GITHUB_ORG`, an App installation, and each assignment's `githubOrg`.

  **What matters about the new org is the templates' provenance, not its name.** Classroom wrote `.github/workflows/classroom.yml` into the assignment templates it managed, and every repository generated from one inherits it. A template created fresh, or copied from `marcy-lms-test` — confirmed clean, 27 templates and no workflows at all — carries nothing. A template forked, transferred, or imported from the Classroom-era org brings the workflow with it. So the rule to hold when populating the new org is where each template came from.
- **Project-wide Supabase default privileges.** Undecided, pending a conversation with your partner. Until it is decided, every new table needs its own `REVOKE` and row level security statements.
- **`package.json` merge policy for a legitimate dependency collision.** The template wins on a version collision, which is correct when the assignment specifies a version deliberately. Revisit if an assignment ever wants students to choose one.
