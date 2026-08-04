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
- [Phase 7: assignment authoring](#phase-7-assignment-authoring)
    - [What manual grading means for the machinery](#what-manual-grading-means-for-the-machinery)
  - [Step 0. The kind axis — done](#step-0-the-kind-axis--done)
  - [The principle this hangs on](#the-principle-this-hangs-on)
  - [Step 1. A catalogue per kind](#step-1-a-catalogue-per-kind)
  - [Step 2. One schema for an assignment's shape — done, as `lib/assignments/spec.ts`](#step-2-one-schema-for-an-assignments-shape--done-as-libassignmentsspects)
  - [Step 3. Procedures — `trpc/routers/assignments.ts`](#step-3-procedures--trpcroutersassignmentsts)
  - [Step 4. `distributedAt` becomes the publish flag](#step-4-distributedat-becomes-the-publish-flag)
  - [Step 5. Screens](#step-5-screens)
  - [Files](#files)
  - [Phase 7 verification](#phase-7-verification)
  - [Not in this phase](#not-in-this-phase)
- [Token management](#token-management)
- [A code review pass](#a-code-review-pass)
  - [An automated test suite](#an-automated-test-suite)
- [Salesforce synchronization](#salesforce-synchronization)
  - [Questions I need answered](#questions-i-need-answered)
  - [What may need to be built on the Salesforce end](#what-may-need-to-be-built-on-the-salesforce-end)
  - [The shape of the work here, once those are answered](#the-shape-of-the-work-here-once-those-are-answered)
- [Course creation](#course-creation)
- [Student enrollment](#student-enrollment)
- [An admin view for approving instructors](#an-admin-view-for-approving-instructors)
- [AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments)
  - [Instructor-authored rubrics are a prerequisite, not a companion](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion)
- [Open thinking: where rubrics, answer keys, and sample reports live](#open-thinking-where-rubrics-answer-keys-and-sample-reports-live)
- [Deferred, with the schema left open](#deferred-with-the-schema-left-open)
- [Open items](#open-items)

---

## The order of work

The sequence, most immediate first. A feature's own section says what is known and what is still undecided about it; several are a heading and a paragraph because the thinking has not been done yet, and saying so is more useful than inventing detail.

1. **[Assignment authoring](#phase-7-assignment-authoring)** — in progress. The kind axis and the validation schema are built; the catalogue, the procedures, and the screens are not.
2. **[Token management](#token-management)** — what a report costs and where the cost actually is, and a filter so that nothing gitignored is ever sent to the model. That last one is a disclosure fix as much as a cost one, which is an argument for pulling it forward if a student ever commits a `.env`.
3. **[A code review pass](#a-code-review-pass)** — Prisma usage, logic, architecture, and organization, before more surface area is added on top. Includes [adding an automated test suite](#an-automated-test-suite), which is decided rather than open.
4. **[Salesforce synchronization](#salesforce-synchronization)** — blocked on a conversation with the consultants who built our Salesforce implementation. The questions that conversation has to answer are written out below. Note that it manages assignment records as well as submission records, so it depends on assignment authoring rather than merely following it.
5. **[Course creation](#course-creation)**
6. **[Student enrollment](#student-enrollment)** — including assignments targeted at some students, and excusing a student from one.
7. **[An admin view for approving instructors](#an-admin-view-for-approving-instructors)**
8. **[AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments)** — which begins with [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), since none of the four fixed section types fits a resume or a reflection. No longer deferred.

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

## Phase 7: assignment authoring

**Started.** The kind axis and the validation schema are built; the catalogue, the procedures, and the screens are not.

The application can grade, review, approve, and deliver. It cannot create the thing being graded. Every course, enrollment, and assignment in the database exists because `prisma/seed.ts` put it there, and the seed does not generalize: `SEED_ASSIGNMENTS` is a hardcoded map of three repository names to their section mappings, and an unknown template fails the seed rather than guessing. Setting up a real cohort is currently impossible without editing TypeScript. The seed's own comments already named the gap — the map is "a stopgap until an instructor can enter them when creating an assignment."

**Scope is assignment authoring only**: creating, editing, duplicating, and removing assignments within a course that already exists. Course creation and the invite-link flow come after; note that nothing reads `inviteToken` today, so a newly created course would have no way to gain students.

**Not repository-only, on reflection.** The plan originally scoped this to repository-backed assignments alone, on the reasoning that the catalogue — the answer-keys repository as the single source of truth for what assignments exist — only needs the one shape it already has. That reasoning does not survive contact with the goal: authoring is only worth building if it can eventually create *every* assignment the program gives, and a Google Doc reflection or an uploaded resume PDF has no repository, no template, and no pull request to diff. Building the form against a repository-shaped catalogue first would mean writing the authoring path twice — once now, once when a non-repo kind arrives and cannot fill three required columns.

**All three kinds are creatable in this phase. Non-repo kinds are graded by hand.** That is the decision that makes the scope tractable: a Google Doc or an uploaded file can be created, published, seen by a student, and graded — with an instructor typing the score and the feedback — with no rubric, no answer keys, and no model call. Everything that would require AI grading for those kinds waits for [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), and everything that would require reading a Google Doc's contents waits with it.

The reason this is worth doing now rather than after is that it removes the last reason to keep assignments outside the application. An instructor can put every assignment they give into one place, and the ones the pipeline cannot grade yet are graded the way they are graded today, in the same interface as the rest.

#### What manual grading means for the machinery

The useful realization: **a manual grade is the existing review screen with an empty draft, not a new screen.** Approving already copies section markdown and scores onto the submission, computes `isComplete` against the threshold, and shows the student — none of which cares where the text came from. So a manual grade is a `GradingDraft` whose sections start blank and whose `modelMetadata` is null, edited through the same editor and released through the same `approve`. The gradebook, the student's feedback screen, and the score history all work unchanged.

Five things that do have to change, each small and each currently written as though a repository always exists:

- **`IMPLEMENTED_KINDS` grows to all three.** It currently gates `accept`, so it has to stop meaning "can be graded by the pipeline" and start meaning "can be created and graded at all".
- **A section says how it is graded — done.** A second discriminated union, on the section: `{ grading: "ai", type, rubricId, answerKeyPaths, ... }` against `{ grading: "manual", label, pointValue }`. Strict on both sides, so a manual section cannot carry a rubric it would never have applied and an AI section cannot omit one it needs. `pointValue` is still required on both and the assignment total is still their sum, so a mixed assignment — coding graded by the pipeline, a reflection graded by hand — adds up correctly. `isAiGraded` and `isManualOnly` are the two readers. `generateReportForSubmission` filters manual sections out before classification and refuses an assignment where nothing is left, naming the review screen instead. Migration `20260804143312_section_grading` backfills `grading: "ai"` into existing rows, so there is one representation in the database rather than a rule that absence means AI.
- **`accept` has nothing to generate**, so what "accepting" means for these kinds is an open question. The likely answer is that it does not exist: there is no repository to create, so the submission row can be created lazily the first time an instructor grades that student. The gradebook already treats a missing row as not started, which is exactly right here.
- **Delivery is in-app only.** `approve` posts a pull request comment, and there is no pull request. It already tolerates that comment failing, but it should not attempt one — the student's feedback screen reads the submission's own columns and needs nothing else.
- **Triage needs a bucket that is not about generating a report.** `triageBucket` returns `needs_report` for a submitted assignment with no draft, which for a manual assignment would tell an instructor to press a button that should not be there. It needs to distinguish "no report has been generated" from "this is graded by hand and has not been graded yet".

### Step 0. The kind axis — done

Before any form, the schema had to stop assuming "assignment" means "GitHub repository."

- **`AssignmentKind` enum**, all three values named — `REPO`, `GOOGLE_DOC`, `FILE_UPLOAD` — with only `REPO` implemented. Naming the axis now is what forces every future code path to say which kinds it handles, rather than silently working for one and breaking on another. `IMPLEMENTED_KINDS` in `lib/assignments/spec.ts` is the single line that changes when a kind becomes real.
- **`templateRepo`, `assignmentRepoName`, and `githubOrg` are now nullable columns**, required only when `kind` is `REPO`. The requirement lives in the Zod schema, not the column, because a column cannot express "required for one kind" and a `NOT NULL` would force a Google Doc assignment to invent a repository name. `@@unique([courseId, assignmentRepoName])` needed no migration to accommodate this — Postgres treats NULLs as distinct in a unique constraint.
- **`lib/assignments/spec.ts`** holds `assignmentSpecSchema`, a Zod discriminated union on `kind`. `parseAssignmentSpec` returns `pointValue` computed from the sections rather than accepting it, so no input can make the total disagree with the reports beneath it. `repositorySource(assignment)` is the one place every repository-assuming code path narrows the three nullable columns, and it distinguishes two failures that must not be reported as one another: `UnsupportedAssignmentKindError` (a Google Doc assignment — a feature that does not exist yet) from `AssignmentConfigurationError` (a `REPO` row missing a column — a row that should never have been written, naming which column).
- **`prisma/seed.ts` now calls `parseAssignmentSpec`** instead of computing the point total and writing columns directly, so the seeded shape and the future authored shape are validated by the same rules and cannot drift.
- **`lib/sandbox/run-tests.ts`, `lib/grade/generate-report.ts`, and `trpc/routers/assignments.ts`** — the three places that read a repository off an assignment — now go through `repositorySource` rather than reading `templateRepo` off the row directly. The compiler found all three once the columns went nullable, which is the point of doing this before the form: `tsc` enumerates the coupling instead of a grep hoping to find it.
- **`scripts/verify-authoring.ts`** (`npm run verify:authoring`) checks the schema as pure functions: point values are refused when absent or zero and cannot be set on the assignment directly, an unknown section type or kind is refused, a `testNamePattern` with no `evidence: "tests"` is refused (silently ignored otherwise, which grades with no test evidence while looking like it consulted some), a Google Doc assignment accepts no repository or runner fields and they come out null, and `repositorySource` throws the right error for each of the two failure cases above.

What Step 0 deliberately does not do: there is still no catalogue for the two unimplemented kinds, no procedure that writes a new assignment, and no screen. Those are Steps 1 through 5 below, updated to route on kind rather than assume `REPO`.

### The principle this hangs on

An assignment's `sections` array decides which rubric applies, which answer keys are loaded, and which tests count as evidence for which section. It is the highest-leverage and least forgiving data in the system: a wrong `moduleTag` or a mistyped answer key path does not throw, it produces a **confident wrong grade** discovered hours later, or a `NEEDS_MANUAL_REVIEW` whose cause is not obvious.

So validate at authoring time against the real sources, using the machinery grading already uses. The form refuses to save a mapping that would fail at grading time. Every field has something real to check against, which is what makes this tractable:

| Field                       | Checked against                              | Existing code                                         |
| --------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `templateRepo`              | the repository exists and the App can see it | `getRepo` — `lib/github/repos.ts`                     |
| `sections[].answerKeyPaths` | the files exist in the grading-guides repo   | `loadGradingAssets` internals — `lib/grade/assets.ts` |
| `runnerPreset`              | a known preset that resolves                 | `resolveRunner` — `lib/sandbox/presets.ts`            |
| `sections[].type`           | one of the four with a rubric heading        | `SECTION_ASSETS` — `lib/grade/assets.ts`              |
| `sections[].rubricId`       | the four seeded `Rubric` rows                | database                                              |
| `moduleTag`                 | the course's own `moduleStructure`           | database                                              |

### Step 1. A catalogue per kind

**The form's first question is the kind, and the kind selects the catalogue.** Each kind's catalogue answers the same two questions through its own interface — `list()` what exists, `resolve(choice)` into the fields that populate the form — so adding a kind later means writing one new file against that interface rather than reopening this one.

**`REPO`: the answer-keys repository as the catalogue.** `answer-keys/{moduleTag}/{assignmentRepoName}/` is already the shape the seed encodes. Reading it rather than asking an instructor to retype it does two things: it removes the most error-prone field, and it makes the repository the **single source of truth for what repository-backed assignments the curriculum contains**. Adding one to a course becomes picking one that exists; putting a new directory in the repository is what makes a new assignment available to add. There is no second list to keep in step.

**Built.** `AssetSource` gained `list`, implemented for both sources — `readdirSync` for the local clone, `listRepoDirectory` in `lib/github/files.ts` for the API — and the three catalogue functions are exported from `lib/grade/assets.ts`: `listAssignmentDirs(moduleTag)`, `listAnswerKeys(moduleTag, repoName)`, and `checkAnswerKeyPaths(paths)` for live validation. All three go through `resolveSource()` and the existing `answerKeyPathIn()` guard, so the catalogue lists what grading would read and cannot admit a path grading would refuse.

Three decisions worth knowing, each made because the obvious alternative was worse:

- **`listAnswerKeys` recurses.** `swe-1-3-node-modules` keeps its keys under `madlib-challenge/`, so a top-level listing would silently omit them and an instructor would tick an incomplete set. Depth is bounded at three to stop a symlinked loop in a local clone.
- **`listRepoDirectory` is non-recursive, one request per directory.** The alternative — the git trees API with `recursive=1` — returns every path in a 23MB repository to find three answer keys.
- **`checkAnswerKeyPaths` reports a traversal path as a finding rather than throwing**, so one bad entry does not hide whether the others are right. The same guard still refuses it; only the reporting differs.

Verified in `verify:assets`, whose strongest check needs no network: the paths the catalogue reports for `swe-1-3-node-modules` are exactly the three `prisma/seed.ts` hardcodes, nested ones included. Those were written by hand against the repository, so agreement means the catalogue reads the same structure the working pipeline was configured from. It also lists 12 assignments in mod-1 where the seed knows 3, which is the point of having it.

**Both sources are compared rather than assumed to agree**, and do: 12 assignments and 3 answer keys from each, in the same order. `readdirSync` and the contents API are separate implementations, and a catalogue that offered different assignments in development and on the deployment would put an assignment into a course whose answer keys grading cannot find — silently, because each half looks right on its own.

A consequence worth surfacing rather than hiding: an existing assignment whose directory is no longer in the repository has been renamed or retired upstream. `validateDraft` reports that as a finding, so a curriculum change shows up as a warning on the course page instead of as a grading failure weeks later.

**Two repositories, one name.** The catalogue lives in the grading-guides repository — private, read over the API, holds the answer keys. The template a student's repository is generated from is a different repository in a different organization, `{githubOrg}/{directory name}`, exactly as the seed derives it. The directory name is the link between them, which is why picking from the catalogue can fill both, but the two are checked separately and against different installations: the catalogue through `GRADING_ASSETS_INSTALLATION_ID`, the template through the main one. An assignment can have answer keys and no template, or the reverse, and each is its own finding.

**`GOOGLE_DOC` and `FILE_UPLOAD`: not built, and each needs its own source of truth for the same reason `REPO`'s does.** A form that lets an instructor paste any Google Doc link or type any title has the same drift problem the repository catalogue exists to prevent — nothing forces internal organization, so "what Google Doc assignments exist" has no single answer to check a new one against. The shape most likely to work, not yet designed in detail: a shared Drive folder per module plays the role `answer-keys/{moduleTag}/` plays for `REPO`, and an instructor picks a document from it rather than pasting an arbitrary link. `FILE_UPLOAD` likely needs no catalogue at all, since there is no pre-existing thing to pick from — an instructor is describing a submission format (accepted file types, a size limit), not selecting among curriculum content. Settle this when a real `GOOGLE_DOC` or `FILE_UPLOAD` assignment is the next thing being built, not speculatively now.

### Step 2. One schema for an assignment's shape — done, as `lib/assignments/spec.ts`

Built in [Step 0](#step-0-the-kind-axis--done) as `assignmentSpecSchema`, a discriminated union on `kind` rather than a flat schema for the `sections` array alone — the union is what let the GitHub fields become "required for `REPO`, absent for the others" instead of always-required. `sectionsPointTotal` and `prisma/seed.ts` calling through `parseAssignmentSpec` are both done, described there.

### Step 3. Procedures — `trpc/routers/assignments.ts`

All `instructorProcedure`, all gated on the caller teaching the course via the existing `assertCourseMember` pattern plus an explicit teaches check, as `courses.gradebook` does.

- **`validateDraft`** — what the form calls as fields change. Runs the whole table above for `REPO`, skips the GitHub-specific rows for the other kinds (already expressed in `assignmentSpecSchema`, so this procedure mostly wraps a `.safeParse` and turns Zod issues into per-field findings), and returns them. No writes.
- **`answerKeyOptions({ moduleTag, repoName })`** — wraps `listAnswerKeys`.
- **`create`** — calls `parseAssignmentSpec` (built — see [Step 0](#step-0-the-kind-axis--done)), which is where `pointValue` and the kind-conditional requirements are already enforced, and writes with `distributedAt: null`.
- **`update`** — same validation. Refuses to change `assignmentRepoName` once any submission exists, because student repositories are already named after it.
- **`publish` / `unpublish`** — sets or clears `distributedAt`.
- **`duplicate({ assignmentId, targetCourseId, assignmentRepoName, dueAt })`** — copies a proven mapping. Built at the assignment level now so that course creation, later, becomes a loop over this rather than new logic.
- **`removalImpact({ assignmentId })`** — counts what deletion would destroy: submissions, approved feedback rounds, test runs, and the repository names that would be left behind on GitHub. Read-only, so the confirmation can state facts rather than generalities.
- **`remove({ assignmentId, confirmTitle })`** — deletes the assignment and everything cascading from it, whatever has been submitted.

  **The typed confirmation is enforced in the procedure, not the dialog.** It refuses unless `confirmTitle` matches the assignment's title exactly, which is the same shape as the approval guards: the interface warns, the procedure is what actually refuses. A guard that lives only in a dialog is decoration, and this is the one irreversible operation in the application.

  It returns what it destroyed, so the confirmation afterwards is also specific. Student repositories are deliberately **not** deleted from GitHub — losing a student's work because an instructor tidied a course would be a worse failure than an orphaned repository, and the names are reported so they can be cleaned up deliberately.

### Step 4. `distributedAt` becomes the publish flag

It is selected in `assignmentFields` and read by nothing. It already means what is needed, so there is no migration.

- `assignments.listForCourse` filters to `distributedAt != null` when the caller is not an instructor on the course.
- The instructor course page shows drafts with a badge.

This is what makes authoring safe: an assignment can be built over several sittings without a student seeing a half-finished one, and a mapping can be corrected before anyone is graded against it.

### Step 5. Screens

- `/instructor/courses/[courseId]/assignments/new` and `.../[assignmentId]/edit` — one client form component, `components/instructor/assignment-form.tsx`, with a `section-editor.tsx` sub-form. Validation findings render inline; save is disabled while any check fails.
- Entry points on `components/instructor/course-detail.tsx`: a "New assignment" action in the header, and "Edit", "Duplicate", and "Remove" per row in the assignments tab.
- **The first question the form asks is the kind**, which selects the catalogue (see Step 1) and therefore which fields appear at all — a Google Doc or file-upload assignment never shows `githubOrg` or a runner preset, rather than showing them disabled. For `REPO`, choosing a module from `course.moduleStructure` and then an assignment the answer-keys repository holds for it fills `assignmentRepoName`, `title`, and the template repository name — all three are the directory name, as the seed does — and pre-ticks the answer keys found inside. `githubOrg` defaults to what the course's other assignments use, and the rubric follows from the section type. What is left to enter is what genuinely needs a person: point values per section, the due date, and the test evidence pattern.
- **Nothing an instructor can select is typed by hand.** The runner preset is a select populated from `RUNNER_PRESETS`, not a text field — a typo'd preset is a grading failure weeks later, and the cheapest fix is an interface where the wrong value cannot be expressed. The same applies to the section type and the rubric. `lib/sandbox/presets.ts` carries no `server-only` import and neither does its one dependency, so the form imports the list directly rather than needing a procedure to enumerate it.

  The schema check stays regardless. A select is a convenience and the procedure is what refuses — the same division as the approval guards and the typed removal confirmation, for the same reason: the request that arrives can carry anything the browser did not send.
- Removal uses a dialog showing the counts from `removalImpact` and requiring the title to be typed — `components/instructor/remove-assignment-dialog.tsx`.

### Files

- **Done:** `lib/assignments/spec.ts`, `scripts/verify-authoring.ts`, one migration (`20260803022300_assignment_kind`)
- **Changed already, as part of Step 0:** `prisma/schema.prisma` (the `AssignmentKind` enum and three nullable columns), `lib/sandbox/run-tests.ts`, `lib/grade/generate-report.ts`, `trpc/routers/assignments.ts` (`accept` narrows through `repositorySource` now), `prisma/seed.ts` (calls `parseAssignmentSpec`)
- **Still to build:** `components/instructor/assignment-form.tsx`, `components/instructor/section-editor.tsx`, `components/instructor/remove-assignment-dialog.tsx`, two pages under `app/(shell)/instructor/courses/[courseId]/assignments/`, and the rest of `lib/grade/assets.ts` / `lib/github/files.ts` (`list`, `listRepoDirectory`) and `components/instructor/course-detail.tsx` for Steps 1, 3, and 5

### Phase 7 verification

The strongest available check, and the reason to do it first: **author `swe-1-3-node-modules` through the new procedures and diff the resulting row against what the seed produces.** That assignment already grades correctly end to end, so an identical row proves the authoring path produces grading-correct output rather than merely well-formed output.

`scripts/verify-authoring.ts` already covers what needs no database — schema-level rules on the union, added as Step 0 landed:

- ~~a mistyped answer key path is refused, and the message names the path~~ — needs the catalogue (Step 1); not yet checkable
- ~~a path escaping `answer-keys` is refused by the same guard grading uses~~ — same
- **Done.** An unknown `runnerPreset` is refused, naming it — `assignmentSpecSchema` calls the same `resolveRunner` grading uses, via `superRefine`
- **Done.** `pointValue` equals the sum of sections and cannot be set independently — `parseAssignmentSpec` computes it and the schema is `.strict()`, so passing it is a validation error, not a silent overwrite
- **Done.** An unknown section type is refused; an unknown `kind` is refused
- **Done.** A `testNamePattern` with no `evidence: "tests"` is refused, naming the section index
- **Done.** A `REPO` spec missing `templateRepo`, `assignmentRepoName`, or `githubOrg` is refused; a `GOOGLE_DOC` spec supplying any of them, or a runner preset, is refused
- **Done.** `repositorySource` throws `UnsupportedAssignmentKindError` for an unimplemented kind and `AssignmentConfigurationError`, naming the missing column, for a misconfigured `REPO` row

Still pending, once the procedures exist:

- an unreachable `templateRepo` is refused (needs `getRepo` — a real GitHub call)
- renaming `assignmentRepoName` is refused once a submission exists
- a duplicate into the same course with a colliding repo name is refused
- an unpublished assignment is invisible to a student and visible to an instructor
- an instructor who does not teach the course is refused every procedure
- an assignment the answer-keys repository no longer contains is reported as a finding
- `remove` refuses when `confirmTitle` does not match, **called directly rather than through the interface** — that is the whole point of the check living in the procedure
- `removalImpact` counts match what `remove` actually destroys, verified inside a rolled-back transaction so no real grades are harmed proving it

Existing suites must stay green — `verify:grade`, `verify:approve`, `verify:sandbox`, and `verify:assets` in particular, since this changes `lib/grade/assets.ts`.

Finally, on localhost: create an assignment, confirm the student sees nothing until it is published, publish it, accept it as the student, and generate a report — the same loop already verified against the seeded assignments, but against one no seed script knows about.

### Not in this phase

- **[Course creation](#course-creation)** and **[student enrollment](#student-enrollment)**, including the invite-link flow. `duplicate` is built to make the course case cheap when it comes.
- **AI grading for assignments with no template repository.** Creating and hand-grading them *is* in this phase, per the scope above. What is not: reading a Google Doc's contents or an uploaded file, and generating a report from it. That needs Drive or storage access and [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), and it is [item 8](#the-order-of-work).
- **Any soft delete or archive.** Removal is permanent by decision, so there is no recovery path in the application. The database's own backups are the only way back from a mistaken removal.
- **Deleting student repositories** when an assignment is removed. They are reported and left alone.

---

## Token management

Three concerns that all come down to what ends up in a prompt: what it costs, how much of the context window it consumes, and what it discloses.

**Nothing gitignored may reach the model.** Today the student's files come from the pull request's own diff, so an ignored file can only appear if the student committed it — which happens. All three concerns land on this one filter, and the third is the one that makes it more than an optimization:

- **Cost.** Every file sent is billed as input, and a committed dependency tree is many files.
- **Context.** A committed `node_modules` can exceed the context window on its own, which fails the run outright rather than making it expensive. Keeping the prompt to the student's actual work is also what keeps the model's attention on it.
- **Disclosure.** A committed `.env` would put the student's own secrets into a third party's logs. Nothing about that is recoverable after the fact, and it is a reason not to leave this behind four features.

The filter belongs beside `belongsToSection` in `lib/grade/classify.ts`, and should read the repository's own `.gitignore` rather than only matching a fixed list, since the templates carry one. Worth noting the same rule already exists on the sandbox side for a different reason — the runner receives a git archive, so gitignored files were never there to begin with. This closes the equivalent gap on the grading side.

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

- **The ordering is forced.** A submission record presumably cannot exist without its assignment record, so authoring an assignment has to create the Salesforce side before any grade for it can sync. That makes this feature depend on [assignment authoring](#phase-7-assignment-authoring) rather than merely following it.
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

## Course creation

An instructor creates a cohort rather than a seed script doing it. `duplicate` in [assignment authoring](#step-3-procedures--trpcroutersassignmentsts) is built at the assignment level specifically so this becomes a loop over proven assignment mappings rather than new logic.

Two things already in the schema that this has to settle: `Course.moduleStructure` is a JSON array of module tags, which is what orders a course's assignments and what the authoring form offers as module choices — a new course needs those entered or copied. And a course with no students is useless, so this is bound to student enrollment below.

---

## Student enrollment

**The invite-link flow.** The decision is already recorded as standing: an instructor adds a student by name and email, the system generates an invite token, and the student's first GitHub login binds their identity to the enrollment. This avoids the instructor needing to know each student's GitHub username in advance. `Enrollment.inviteToken` exists and is unique; nothing reads it, so this is the piece that makes a created course usable.

**Targeted assignments, and excusing a student.** A new capability rather than a screen, and it needs a data-model decision. Today an assignment implicitly applies to every active enrollment in its course — a submission row appears when a student accepts, and the gradebook treats a missing row as not started. Neither "this assignment is only for these students" nor "this student is excused from this one" can be expressed. The options are a per-student exclusion row against an assignment, or an explicit targeting list, and the choice matters for the gradebook: an excused student must read as excused rather than as missing work, or the distinction is worthless.

---

## An admin view for approving instructors

Today `Profile.role` is set by hand in the database. The feature is a request-and-approve flow: someone signs up, an admin sees them pending, and grants instructor access.

One constraint this must not violate, and the reason it deserves care rather than a quick form: migration `20260730024911_tighten_profiles_grants` exists because a signed-in student could once have set their own `role` to `ADMIN` from browser JavaScript. Any approval flow goes through a procedure that checks the caller is an admin. The role column must never become writable by the account it describes.

---

## AI grading for non-coding assignments

Short response is already graded and calibrated against an instructor's own marking, so this means the work that has no repository: a Google Doc, an uploaded PDF, a presentation. It depends on [assignment authoring](#phase-7-assignment-authoring) supporting those kinds first, because the pipeline's inputs change shape — there is no pull request diff, no changed-file list, and no test evidence, so "the student's work" has to be fetched from Drive or from storage instead.

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

## Deferred, with the schema left open

- **SQL sandbox execution.** The design is settled: boot an ephemeral PostgreSQL, run `setup.sql`, and compare each numbered query's result set — rows, columns, and order — against `queries-solution.sql` programmatically, which makes SQL correctness fully deterministic with no model judgment involved. It needs an E2B template with PostgreSQL installed, and is the largest gap in what can be graded deterministically.
- **Frontend execution scoring.** Matches today's manual process, which is a README checklist and a code-reading judgment. Lint and build only, to catch hard errors.
- **The GitBook resource link index.** Pre-build a heading-to-URL index for `marcy-curriculum-docs` per module — the URL scheme is fixed at `.../{module}/{lesson}#{subheading}` — and pass candidate links in context for the model to select from rather than construct. Until this exists, prompts omit a recommended resources section entirely rather than risk invented URLs.
- **Answer keys in the cacheable prefix.** They are identical for every student of a given assignment but sit in the user content, so they are billed at full input price on every run. Moving them into the system block would give each assignment its own cache entry. Worth roughly 6 percent of the cost of a report, which is why it waits behind the `effort` question.
- ~~Instructor-authored rubrics~~ — no longer deferred. They are a prerequisite for [AI grading for non-coding assignments](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), which is where the work is described.
- **Bulk grading** beyond the basic gradebook table, and a single action that generates reports for every submission still waiting on one.
- **An early-intervention dashboard.** `lastActivityAt`, `isLate`, and `status` already support it.
- **A per-student record that accumulates over time and informs grading.** Requires deciding what is tracked and deserves its own design discussion.
- **A grading assistant mode** that identifies patterns across a student's assignments relative to a rubric. Depends on the previous item existing first.

Assignment types with no `rubric.md` section yet, such as some mod-5 and mod-8 assignments, route to `needs_manual_review` rather than expanding the rubric now.

---

## Open items

- **`GRADING_ASSETS_REPO` is commented out in `.env.local`**, so `verify:assets` skips its whole remote half — the rubric over the API, and the check that both sources list the same catalogue. Uncommenting it makes those run by default; without it they are only exercised by passing the variable inline, which nobody will remember to do. The installation id it needs is correct now: the development App is installed on `The-Marcy-Lab-School`, and both halves pass when the repo variable is supplied.
- **Which GitHub organization.** Everything verified so far used `marcy-lms-test`. Changing to `The-Marcy-Lab-School-Assignments` is a separate, deliberate step.
- **Project-wide Supabase default privileges.** Undecided, pending a conversation with your partner. Until it is decided, every new table needs its own `REVOKE` and row level security statements.
- **`package.json` merge policy for a legitimate dependency collision.** The template wins on a version collision, which is correct when the assignment specifies a version deliberately. Revisit if an assignment ever wants students to choose one.
