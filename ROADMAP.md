# mls-lms roadmap

How the built system works is in [README.md](README.md). This file is only what is left to do.

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
- [Deferred, with the schema left open](#deferred-with-the-schema-left-open)
- [Open items](#open-items)

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

- Add `list: (dir: string) => Promise<string[] | null>` to the private `AssetSource` type in `lib/grade/assets.ts`, implemented for both sources — `readdirSync` for the local clone, and a new `listRepoDirectory` in `lib/github/files.ts` for the API. Symmetric with `read`, so development and deployment behave the same.
- Export three functions that reuse `resolveSource()` and, critically, the existing `answerKeyPathIn()` traversal guard, so authoring cannot admit a path grading would refuse: `listAssignmentDirs(moduleTag)`, `listAnswerKeys(moduleTag, repoName)`, and `checkAnswerKeyPaths(paths)` returning `{ path, found }[]` for live validation.

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

- **Course creation**, and the **invite-link flow**. `duplicate` is built to make the course case cheap when it comes.
- **Assignments with no template repository** — a Google Doc or an uploaded PDF. These need `accept` to do something other than generate a repository, and a submission with no pull request means something different to the grading pipeline.
- **Any soft delete or archive.** Removal is permanent by decision, so there is no recovery path in the application. The database's own backups are the only way back from a mistaken removal.
- **Deleting student repositories** when an assignment is removed. They are reported and left alone.

---

## Deferred, with the schema left open

- **Salesforce synchronization.** The three dormant columns exist. The field mapping is prerequisite work owed before this is built, not something to guess.
- **SQL sandbox execution.** The design is settled: boot an ephemeral PostgreSQL, run `setup.sql`, and compare each numbered query's result set — rows, columns, and order — against `queries-solution.sql` programmatically, which makes SQL correctness fully deterministic with no model judgment involved. It needs an E2B template with PostgreSQL installed, and is the largest gap in what can be graded deterministically.
- **Frontend execution scoring.** Matches today's manual process, which is a README checklist and a code-reading judgment. Lint and build only, to catch hard errors.
- **The GitBook resource link index.** Pre-build a heading-to-URL index for `marcy-curriculum-docs` per module — the URL scheme is fixed at `.../{module}/{lesson}#{subheading}` — and pass candidate links in context for the model to select from rather than construct. Until this exists, prompts omit a recommended resources section entirely rather than risk invented URLs.
- **Answer keys in the cacheable prefix.** They are identical for every student of a given assignment but sit in the user content, so they are billed at full input price on every run. Moving them into the system block would give each assignment its own cache entry. Worth roughly 6 percent of the cost of a report, which is why it waits behind the `effort` question.
- **Instructor-authored rubrics** beyond the four fixed types.
- **Bulk grading** beyond the basic gradebook table, and a single action that generates reports for every submission still waiting on one.
- **An early-intervention dashboard.** `lastActivityAt`, `isLate`, and `status` already support it.
- **A per-student record that accumulates over time and informs grading.** Requires deciding what is tracked and deserves its own design discussion.
- **A grading assistant mode** that identifies patterns across a student's assignments relative to a rubric. Depends on the previous item existing first.

Assignment types with no `rubric.md` section yet, such as some mod-5 and mod-8 assignments, route to `needs_manual_review` rather than expanding the rubric now.

---

## Open items

- **Installing the GitHub App on the organization holding the grading guides.** The code reads them over the API and is verified by `npm run verify:assets`, but the app is currently installed only on `marcy-lms-test`, so a deployed host cannot read the rubric until the app is installed on `The-Marcy-Lab-School` and `GRADING_ASSETS_INSTALLATION_ID` is set.
- **Which GitHub organization.** Everything verified so far used `marcy-lms-test`. Changing to `The-Marcy-Lab-School-Assignments` is a separate, deliberate step.
- **Project-wide Supabase default privileges.** Undecided, pending a conversation with your partner. Until it is decided, every new table needs its own `REVOKE` and row level security statements.
- **`package.json` merge policy for a legitimate dependency collision.** The template wins on a version collision, which is correct when the assignment specifies a version deliberately. Revisit if an assignment ever wants students to choose one.
