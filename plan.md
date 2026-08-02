# mls-lms — GitHub Classroom replacement with built-in AI grading

- [What this application is for](#what-this-application-is-for)
- [How the whole loop works](#how-the-whole-loop-works)
- [Stack](#stack)
- [Standing decisions](#standing-decisions)
- [Data model](#data-model)
- [Phase 1: GitHub App and submission loop — built and verified](#phase-1-github-app-and-submission-loop--built-and-verified)
- [Phase 2: deterministic test execution in E2B](#phase-2-deterministic-test-execution-in-e2b)
- [Phase 3: AI report generation](#phase-3-ai-report-generation)
- [Phase 4: automatic triggering and orchestration](#phase-4-automatic-triggering-and-orchestration)
- [Phase 5: review, approval, and resubmission](#phase-5-review-approval-and-resubmission)
- [Phase 6: interface pass](#phase-6-interface-pass)
- [Deferred, with the schema left open](#deferred-with-the-schema-left-open)
- [Open items](#open-items)

---

## What this application is for

GitHub Classroom is being discontinued. Grading one assignment today touches four systems by hand: clone the repository, run the tests and work through the manual grading toolkit, post feedback as a pull request comment, re-enter the grade in Google Classroom, and re-enter the grade and its metadata in Salesforce. The same grade and feedback is typed three times. That is a transcription-error risk and a drain on instructor time that should be going into actually reviewing student work, since methodical feedback is a stated core competency of the program rather than a nice-to-have.

This application replaces GitHub Classroom's repository provisioning and automates the grading workflow that already exists in `grading/swe-assignment-grading-guides/grading-toolkit/`. One instructor action — approving a report — records the grade, posts the feedback, and shows it to the student.

Two deliberate departures from GitHub Classroom's design:

- **No separate feedback branch.** The existing student ritual is preserved exactly as documented in `marcy-curriculum-docs/how-tos/working-with-assignments.md` and confirmed against real student repository history: students work on a `draft` branch, open a pull request from `draft` into `main`, and add the instructor as a reviewer. That pull request is the submission signal.
- **AI grading reports are part of the first working version, not a later addition.** The manual grading toolkit already does real evaluation work, so automating it is the point of the build. Reports always land as a draft for instructor review and are never posted automatically, so a person remains the last word on feedback quality.

### Where the code comes from

A working version of this product exists in the predecessor application `marcy-lms`, built on Next.js with Drizzle, a development-only cookie authentication stub, a PostgreSQL job table, a polling Node worker process, Docker sandboxing, and Groq. Its verification of repository provisioning, the webhook, and job enqueueing all passed against the `marcy-lms-test` GitHub organization.

`mls-lms` is the same product on a different stack. Product behavior carries over; the technology underneath does not. Several modules port across with little change and are named in the phases below. The original written specification is `misc-projects/marcy-lms/description.md`.

---

## How the whole loop works

```
Student clicks "Accept assignment"
        │
        ▼
GitHub App generates a repository from the assignment template and adds the
student and every course instructor as collaborators
        │
Student works on `draft`, opens a pull request into `main`, tags the instructor
        │
        ▼
GitHub webhook (pull_request: opened / reopened / synchronize)
        │  matched to a submission by repository name; status becomes SUBMITTED
        ▼
Test execution in an E2B sandbox
        │  instructor's tests from the template repository, run against the
        │  student's code, with no network access and no credentials present
        ▼
Report generation
        │  one schema-constrained language model call per gradable section,
        │  given the rubric, the answer key, the student's code, and the
        │  verified test results
        ▼
Draft report awaiting instructor review
        │
        ▼
Instructor approves
        │  grade recorded, pull request comment posted, student sees feedback
        ▼
Done — one action, everything downstream updates
```

---

## Stack

| Concern                   | Choice                                                                                   | State                       |
| ------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| Framework                 | Next.js App Router on Vercel                                                             | Built                       |
| Database                  | Supabase PostgreSQL                                                                      | Built                       |
| ORM                       | Prisma 7 with `@prisma/adapter-pg`                                                       | Built; 7 migrations applied |
| Authentication            | Supabase Auth with GitHub OAuth, including identity linking onto existing email accounts | Built and verified          |
| Authorization             | Row level security with column level grants, plus tRPC role procedures                   | Built                       |
| Data fetching             | tRPC with Prisma                                                                         | Built                       |
| Interface                 | Tailwind with shadcn; Vercel V0 for iteration                                            | Minimal pages built         |
| GitHub integration        | GitHub App with Octokit                                                                  | Built and verified          |
| Code sandbox              | E2B (`e2b` 2.37.0)                                                                       | Built and verified          |
| Language model            | Claude `claude-opus-5`, behind a provider interface                                      | Built and verified          |
| Asynchronous job handling | Undecided — see [Phase 4](#phase-4-automatic-triggering-and-orchestration)               | Phase 4                     |

### What ports across from the predecessor application

`lib/github/*` transferred with minimal change, because those modules use Octokit and have little coupling to the ORM. The following are still to be ported and are largely mechanical translations: `classify.ts`, `grade/assets.ts`, `grade/prompts.ts`, `grade/schema.ts`, `grade/cross-check.ts`, and `persist.ts`.

`worker/sandbox/*` — roughly 360 lines wrapping Docker — is replaced by the E2B SDK and is not ported.

---

## Standing decisions

These are settled. They do not need to be revisited.

- **The existing student workflow is the submission signal.** A pull request from `draft` into `main`, with the instructor added as a reviewer.
- **AI reports are always drafts.** Nothing posts to GitHub and nothing counts as graded until an instructor approves it in the application.
- **Files the student can modify are never trusted as grading input.** This excludes `scores/scores.json` and the `hooks/pre-commit` hook that writes it, which a student can disable locally; the `tests/` directory inside the student's own repository; and `classroom.yml`. Every grading fact is produced again on the server on every graded run.
- **The instructor's tests come from the assignment template repository**, fetched fresh on every run, because students never have write access there. Confirmed by inspecting a real template repository: the Jest tests in `tests/*.spec.js` live in the template, while the grading toolkit and answer keys repository holds reference solutions only, which are used as language model context and never executed.
- **Grading is not run inside the student's repository via GitHub Actions.** That would mean trusting a workflow file living in territory the student can push to, which is the same problem as trusting their `tests/` directory. This is also why the accept flow removes the old `classroom.yml` from every generated repository.
- **Deterministic facts are computed by code and the model may only report them.** Test results, lint findings, and SQL comparisons are inputs the model must honor. A cross-check compares the model's claims against those facts.
- **Test results are one input to the rubric, not the score.** Explained in full in [Phase 2 step 2](#step-2-which-sections-a-test-run-is-evidence-for) and enforced in [Phase 3's cross-check](#what-the-cross-check-may-and-may-not-assert).
- **Each assignment stores an explicit `sections` mapping** rather than guessing file paths by convention. Real assignments do not use consistent `{from-scratch,debug,modify}.js` filenames, and one pull request can contain more than one gradable section.
- **The rubric taxonomy is fixed at the four sections that exist in `rubric.md` today**: `SHORT_RESPONSE`, `CODING_ALGORITHM_FLUENCY`, `CODING_SQL_FLUENCY`, and `CODING_FRONTEND`. Instructor-authored rubrics are a reasonable later extension and are not needed now.
- **Completion is judged at 75 percent**, matching the Complete/Incomplete policy in `working-with-assignments.md`. Stored per assignment as `completionThreshold`.
- **Students join a course by invite link.** An instructor adds a student by name and email, the system generates an invite token, and the student's first GitHub login binds their identity to the enrollment. This avoids requiring the instructor to know each student's GitHub username in advance.
- **GitHub's numeric user ID is the durable identity key**, because usernames are mutable.
- **The sandbox never holds a GitHub token.** [Phase 2 step 3](#step-3-getting-the-code-in-with-no-credentials-in-the-sandbox).
- **Verification happens against the `marcy-lms-test` organization**, never the production organization, until a flow is proven.

---

## Data model

Seven migrations are applied. The models below exist in `prisma/schema.prisma` unless marked otherwise.

`AuthUser`, `Profile`, `Course`, `CourseInstructor`, `Enrollment`, `Rubric`, `Assignment`, `Submission`, `GradingDraft`, `GradingDraftSection`, `TestRun`, and the enums `Role`, `EnrollmentStatus`, `RubricScaleType`, `SubmissionStatus`, `SalesforceSyncStatus`, `GradingDraftStatus`, `Confidence`, `TestRunStatus`, and `TestRunTrigger`.

Conventions: UUID primary keys, `timestamptz` timestamps, `created_at` and `updated_at` on every table, snake_case column names mapped from camelCase fields.

**Migrations are authored with `migrate diff`, not `migrate dev`.** `prisma migrate dev` reports drift on this database and offers to reset both the `auth` and `public` schemas. The drift is not real: `tables.external` in `prisma.config.ts` excludes Supabase's auth *tables* from diffing, but there is no equivalent for enum *types*, so Supabase's own `aal_level`, `factor_type`, `one_time_token_type` and the rest always look like enums the migration history did not create. The full authoring recipe is at the bottom of `prisma.config.ts`; `npm run db:migrate` is replaced by a guard that points at it.

### Notes on individual tables

**`profiles`** has a one-to-one relationship with `auth.users` and carries the `Role` enum, `githubUsername`, display name fallback, and `githubUserId BigInt? @unique`. The numeric ID is recorded by the `sync_github_identity` trigger from `auth.identities.provider_id`, guarded by a regular expression because that column is text and other providers put non-numeric values in it. Repository naming still uses the username, because that is the existing convention, which is why `submissions.repo_github_login_at_creation` exists.

**`assignments`** carries `templateRepo`, `assignmentRepoName`, `githubOrg`, `completionThreshold`, `dueAt`, `distributedAt`, and the `sections` JSON array. `@@unique([courseId, assignmentRepoName])` prevents two assignments in one course from generating colliding repository names.

**`submissions`** is one row per assignment and student. It carries repository identity, pull request identity, `headSha`, `submittedAt`, `isLate`, `lastActivityAt`, the final score fields, and three dormant Salesforce columns. `repoFullName` is unique, which is what lets the webhook match an event to a submission with one indexed lookup. The Salesforce columns are present so a future synchronization job can query `WHERE salesforce_sync_status = 'PENDING'` without a migration at that point; nothing writes them today, and the field mapping is prerequisite work owed before that phase.

**`grading_drafts`** is one row per grading run, keyed by submission and head SHA. A new push creates a new row and marks the previous one `SUPERSEDED` rather than overwriting it, so an instructor's in-progress review of an older run is never silently replaced. `modelMetadata` records the model id, prompt version, grading asset commit SHA, and token usage, for reproducibility.

**`grading_draft_sections`** are child rows, because one submission can have more than one graded section per run. The submission's final score on approval is the sum of a run's section scores. The review interface renders each section separately, matching how reports actually look today, while the gradebook shows the rolled-up number.

### Additions each phase makes

| Phase | Addition                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| 2     | **Applied.** New table `test_runs`, defined in [step 7](#step-7-storage--the-test_runs-table)                           |
| 2     | **Applied.** `assignments.runnerPreset String @default("none")`, `assignments.runnerConfig Json?`, `assignments.templateRef String?` |
| 3     | Nothing. `grading_drafts` and `grading_draft_sections` already exist and are unwritten.                                 |
| 4     | Either a `grading_jobs` table or `grading_drafts.workflowRunId String?`, depending on the orchestration decision        |
| 5     | `submissions.gradedHeadSha String?` and one new `SubmissionStatus` value, `RESUBMITTED`                                 |

### Every new table needs explicit privilege statements

Supabase's default privileges grant all permissions on new tables in the `public` schema to the `anon` and `authenticated` database roles. This is the same vulnerability that migration `20260730024911_tighten_profiles_grants` fixed for `profiles`, where a signed-in student could have changed their own `role` column to `ADMIN` directly from browser JavaScript.

All access to these tables goes through tRPC and Prisma, which connects as the table owner and is therefore not restricted by row level security. So the simplest correct configuration is to deny browser access entirely:

```sql
REVOKE ALL ON TABLE public.<table> FROM anon, authenticated;
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;  -- no policies means no access
```

Row level security with zero policies denies everything by default, so the browser cannot read or write these tables at all and authorization lives in exactly one place: procedure code.

The tradeoff is that this rules out querying these tables directly from the browser with supabase-js. Adding policies later to a table students already depend on is harder than including them from the start, so if direct browser access is likely to be wanted, decide before the table ships. A project-wide default privileges setting would make this per-table work unnecessary; until that is decided, every new table needs its own statements.

---

## Phase 1: GitHub App and submission loop — built and verified

No AI, no sandbox. A student can accept an assignment, work on it, open a pull request, and have the application notice.

### The GitHub App

**Permissions:** Administration (read and write, for repository generation and collaborator management), Contents (read and write, for template generation and reading files), Pull requests (read and write, for reading state and posting the approval comment), Metadata (read).

**Webhook events:** `pull_request` only. No `push` subscription is needed, because the pull request is the submission signal.

Configuration lives in `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_APP_INSTALLATION_ID`. During local development the webhook URL is a smee.io channel forwarded to `/api/webhooks/github`; once deployed it becomes the real domain and the tunnel is removed.

### What exists

**`lib/github/`** — `app-client.ts` mints installation tokens and provides a lazily-constructed Octokit instance. `repos.ts` holds `generateRepoFromTemplate`, `getRepo`, `addCollaborator`, and `removeClassroomWorkflow`. `prs.ts` holds `getPullRequestFiles` and `postOrUpdatePrComment`, neither used yet. `webhook-verify.ts` verifies `X-Hub-Signature-256`.

**`trpc/routers/`** — `courses.listMine` and `courses.roster`; `assignments.listForCourse` and `assignments.accept`; `submissions.mine` and `submissions.listForAssignment`. Role enforcement uses `profileProcedure`, `studentProcedure`, and `instructorProcedure` from `trpc/init.ts`.

**`assignments.accept`** creates the repository from the template as `{assignmentRepoName}-{github login}`, adds the student as a collaborator with push permission, adds every `course_instructors` row for that course as a collaborator, removes `classroom.yml`, records the repository identity on the submission, and sets the status to `ACCEPTED`. It is idempotent: if a previous attempt created the repository but its database write never landed, it reuses the existing repository rather than failing on the name collision. An instructor with no linked GitHub account is skipped with a warning rather than failing the whole operation.

**`app/api/webhooks/github/route.ts`** verifies the signature against the raw request body, answers `ping` so the app's settings page shows a green check, ignores events and actions it does not handle with a 200 so GitHub does not mark the webhook as failing, and for `opened`, `reopened`, and `synchronize` targeting `main` matches `repository.full_name` to a submission and updates it.

The work is awaited before responding, rather than responding first and continuing in the background. The predecessor application did the latter, with a comment noting it would need `waitUntil` on a runtime that stops executing after the response is sent. Vercel is exactly that kind of runtime, so unawaited work would be cancelled unpredictably. Awaiting is safe here because the work is one database update taking milliseconds, far inside GitHub's timeout of roughly 10 seconds.

**`lib/supabase/proxy.ts`** excludes `/api` from the authentication redirect, so GitHub's unauthenticated webhook request reaches the route instead of receiving a 307 redirect to `/auth/login`.

**Pages** — `app/courses/`, `app/courses/[courseId]/`, and `app/instructor/assignments/[assignmentId]/`, plus `components/accept-assignment-button.tsx`.

### Phase 1 verification — all five passed

1. `migrate deploy` and the seed script run; the student dashboard and instructor roster render.
2. Against `marcy-lms-test`: `accept` creates a repository from the template, the student and instructors are collaborators, and `classroom.yml` is absent.
3. A real pull request from `draft` into `main` fires the webhook, the signature verifies, and the submission becomes `SUBMITTED` with `isLate` computed.
4. `accept` run a second time for the same assignment reuses the existing repository without failing.
5. A webhook request with an invalid signature is rejected with a 401.

---

## Phase 2: deterministic test execution in E2B

The output of this phase is a stored, trustworthy answer to one question: **what do the instructor's tests say about this student's code at this commit?** No language model is involved and nothing is posted to GitHub.

This is separate from report generation because the two fail in unrelated ways. A wrong score from a combined pipeline has two candidate causes — the sandbox produced the wrong results, or the model misread correct ones — and a wrong score here has one.

### Step 1. Runner configuration, so the sandbox is not tied to this project's stack

The sandbox must run Node, Python, React, and eventually SQL assignments. Nothing about the runner may assume the technology this application itself is built with.

Configuration lives in code as named presets, with a per-assignment override for the exceptions:

```ts
// lib/sandbox/presets.ts
export type RunnerPreset = {
  e2bTemplate: string;        // E2B template id; "base" carries Node and Python
  setupCommands: string[];    // run with network access
  testCommand: string;        // run with network access revoked
  resultFormat: ResultFormat; // which parser reads the output
  resultPath?: string;        // file the runner writes, read back out of the sandbox
  timeoutMs: number;
  /// When true, students may add their own dependencies: package.json is merged
  /// rather than restored, the lockfile is left alone, and setup uses
  /// `npm install` instead of `npm ci`. See step 4.
  allowStudentDependencies: boolean;
};
```

`Assignment.runnerPreset` names one; `Assignment.runnerConfig` is a shallow override merged over it. Most assignments name a preset and configure nothing. An assignment needing a system dependency gets a purpose-built E2B template and names it in `runnerConfig.e2bTemplate`, with no code change.

**`none` is a real preset and the default.** Many assignments have no automated tests at all: short response assignments have nothing to execute, and frontend assignments have tests this build cannot run yet. These are not a degenerate case to handle at the edges — they are a large fraction of the assignments in the program, and the design treats "no tests exist" as an ordinary state.

The default is `none` rather than `node-jest` so that an unconfigured assignment produces no evidence instead of quietly producing the wrong evidence. An assignment that should run tests and does not is visible on the instructor page as "no automated tests". The reverse mistake, a Python assignment silently running `npx jest`, would surface as an `ERRORED` run that looks like a sandbox defect. The seed sets `node-jest` explicitly for the assignments that use it.

Presets to define now:

| Preset          | Template | Setup                             | Test command                                                       | Parser        |
| --------------- | -------- | --------------------------------- | ------------------------------------------------------------------ | ------------- |
| `node-jest`     | `base`   | `npm ci`, falling back to `npm i` | `npx jest --ci --json --outputFile=/results/jest.json`             | `jest-json`   |
| `node-vitest`   | `base`   | `npm ci`                          | `npx vitest run --reporter=json --outputFile=/results/vitest.json` | `vitest-json` |
| `python-pytest` | `base`   | `pip install -r requirements.txt` | `pytest --json-report --json-report-file=/results/pytest.json`     | `pytest-json` |

React assignments that have runnable tests use `node-jest` or `node-vitest` unchanged, because a component test is still a Node process. SQL is deliberately absent — it needs a template with PostgreSQL installed and is the first thing to build once this phase works.

### Step 2. Which sections a test run is evidence for

A test run is per repository, because a suite executes once. Gradable sections are per pull request, and today one pull request can contain both a section the suite covers and a section it does not — an algorithm exercise alongside a short response question. So the mapping from run to section is explicit, for the same reason `assignment.sections` already avoids guessing file paths by convention.

Each entry in `assignment.sections` gains two optional fields:

```jsonc
{
  "type": "coding_algorithm",
  "rubricId": "...",
  "answerKeyPaths": ["mod-1-js-fundamentals/swe-1-4-loops/from-scratch.js"],
  "reportTemplate": "coding-fluency",
  // Absent means "no deterministic evidence for this section".
  "evidence": "tests",
  // Absent with evidence:"tests" means the whole suite counts toward this section.
  "testNamePattern": "^from-scratch"
}
```

Three cases follow, and each is legitimate:

| Assignment           | `runnerPreset` | Section `evidence` | What Phase 3 has to work with                               |
| -------------------- | -------------- | ------------------ | ----------------------------------------------------------- |
| Algorithm exercise   | `node-jest`    | `tests`            | Rubric and answer keys, plus verified pass and fail results |
| Short response       | `none`         | absent             | Rubric and answer keys only                                 |
| Blended pull request | `node-jest`    | per section        | Verified results for one section, not the other             |

**Test results are one input to the rubric, not the score.** The coding rubric treats "passes all tests" as one criterion among several. A submission that passes every test by returning hardcoded expected values, or by an approach that is correct but wildly inefficient, has satisfied that one criterion and should still lose points elsewhere. A test run cannot detect either of those; reading the code detects them, which is the model's job in Phase 3. So a run is evidence about one criterion, and a section with no run is missing that evidence rather than being ungradable.

What the results are allowed to constrain is therefore narrower than it first appears, and Phase 3's cross-check states it precisely.

#### This is a transitional mechanism

The intended future state is **one section per assignment**, with coding and short response split into separate assignments over separate template repositories — `swe-1-4-loops` and `swe-1-4-loops-sr` — and therefore separate submissions. That state needs no new machinery: separate assignments already work, and the existing `@@unique([courseId, assignmentRepoName])` and `Submission.repoFullName @unique` constraints already fit it.

Per-section configuration is still worth building, for two reasons. The blended assignments exist right now, and separating them is a curriculum change made assignment by assignment rather than a code change made once, so the system has to grade what is actually in the repositories during the transition. And in the target state this mechanism costs nothing: an assignment has a one-entry `sections` array, `evidence` is read from that entry, and the code path is identical. Nothing gets rebuilt when the separation finishes.

### Step 3. Getting the code in, with no credentials in the sandbox

**The sandbox does not clone, and never holds a GitHub token.**

The obvious implementation is `git clone https://x-access-token:$TOKEN@github.com/...` inside the sandbox. Do not do this. That token is an *installation* token: it carries write access to every repository in the organization, including every other student's. The one process it would be handed to is the process running code written by a student. A `postinstall` script in a modified `package.json` reads the environment and sends it elsewhere, and the sandbox has network access during installation by definition, because that is what installing requires.

Instead both trees are fetched on the server and uploaded as bytes:

1. `GET /repos/{owner}/{repo}/tarball/{head_sha}` — the student's code at the exact commit the webhook recorded, not whatever the branch points at by the time the run starts.
2. `GET /repos/{owner}/{repo}/tarball/{ref}` on `assignment.templateRepo` — the tests that will actually execute. Resolve the ref to a commit SHA first and record it on the run.

Two archives are all that is needed. Deciding what the student changed requires no third copy of the template, because the pull request's own diff already answers it — see step 4.

Each archive goes into the sandbox as a single `.tar.gz` write followed by `tar xzf`, which is one upload rather than one call per file. GitHub's tarballs contain a single top-level directory with a generated name, so extraction uses `--strip-components=1` into a known path.

Add `lib/github/archives.ts` for this.

### Step 4. Protected paths: detect changes and overwrite them

Two separate obligations that are easy to conflate. The instructor needs to know a student edited the tests, and the score must be computed as if they had not.

A protected path is any path whose contents are grading infrastructure rather than student work. Default set, overridable per preset:

```
tests/**            jest.config.*      vitest.config.*     package.json
package-lock.json   .eslintrc*         eslint.config.*     pytest.ini
conftest.py         requirements.txt   .github/workflows/**
```

**`scores/**` and `hooks/**` are deliberately absent**, even though both are grading
infrastructure by any plain reading. The mod-1 templates carry a `hooks/pre-commit`
that runs the suite and then does `git add scores/scores.json`, so a student's every
commit stages a rewritten scores file. Protecting that path would report a change on
every mod-1 submission and route all of them to manual review — a finding against
every student, produced by the assignment's own tooling doing what it was built to do.

Leaving them unprotected costs nothing, because protecting them was never what made
them untrustworthy. Nothing reads `scores.json` as a grading signal, and nothing runs
the hook: the runner invokes `npx jest` directly rather than `npm test`, the hook is
installed by a `preinstall` script that `--ignore-scripts` skips, and git hooks do not
execute in the sandbox at all. A student may leave whatever they like in `scores/`;
the result comes from the template's tests.

The `score-tests` module these files belong to is being retired in favour of plain
Jest suites. Nothing here changes when it goes.

#### Detection comes from the pull request diff

The tests that execute always come from the template, which is what makes the score independent of anything the student did to their own copy of the tests.

Detection is a separate question, and GitHub answers it directly. `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` returns every file the pull request changes, each with a `status` of `added`, `modified`, `removed`, or `renamed`, plus `previous_filename` for renames. Reporting is then a match of those paths against the protected set.

This is exactly the right comparison because of how student repositories are created. `generateRepoFromTemplate` calls `POST /repos/{template_owner}/{template_repo}/generate`, which produces a repository whose default branch holds one commit containing the template's files as they were at that moment. The student branches from there and opens a pull request back into it. The diff is therefore measured against the template snapshot *that student received*, and it reports exactly the files that student changed.

It also cannot report an instructor's work as a student's. The diff never examines the current template, so a bug fixed in the template mid-cohort does not appear in any student's pull request. Nothing about detection depends on which template commit is current, which is what allows the template to be corrected freely.

`getPullRequestFiles` in `lib/github/prs.ts` already makes this call but returns only `filename`. Widen its return type to include `status` and `previous_filename`. Note the endpoint's ceiling of 3,000 files, which no assignment repository will approach.

**Two limits of this method, both worth knowing.**

*Changes committed straight to the default branch are invisible to it.* If a student edits `tests/` on their own `main` and only then branches, the edit sits in the pull request's base and no diff shows it. This is a reporting gap and never a scoring gap, because the template's tests are restored before the suite runs regardless. It is also cheaply detectable: a repository generated from a template begins with exactly one commit, so `GET /repos/{owner}/{repo}/commits?sha={default_branch}&per_page=2` returning two or more commits means the default branch was written to. Committing to `main` is not itself misconduct and many students do it, so treat that result as "the pull request diff is not the whole story here" rather than as a finding. Add the check only if you find you want it.

*It reports that `package.json` changed, not which keys changed.* Key-level reporting comes from the merge described below, which necessarily knows which template-asserted keys the student had given a different value.

Execution is unchanged by any of this. The template's version of every protected path is copied over the student tree before the suite runs, and files the student added inside a protected directory are removed. `package.json` is the one exception.

#### Which template commit the tests come from

`Assignment.templateRef String?`, where null means the template's default branch.

Year-to-year change needs no special handling, because the data model already separates cohorts: an `Assignment` belongs to a `Course`, and a `Course` is one cohort. Next year's cohort gets its own `Assignment` row referring to whatever the template looks like then, and this year's row is unaffected.

Within a cohort, following the default branch is the behavior to want. A bug found by the first student to accept is fixed by pushing to the template, and every run after that — including re-runs for students who accepted before the fix — uses the corrected version. The fix reaches every student without touching a single student repository, and because detection does not involve the current template, it does so without making anyone look dishonest.

Two cases call for naming an exact commit SHA in `templateRef` instead:

- **Archiving a finished cohort.** Set it to a specific commit at the end of a cohort, so that re-grading an old submission years later reproduces the result it originally received rather than running that year's code against a much newer template.
- **A template change that adds work rather than correcting it.** New tests for files earlier students never received will fail on work they were never asked to do. Holding `templateRef` at the earlier commit for students already in progress contains that.

Every run records the template commit whose tests it used, in `test_runs.templateCommitSha`. That is what makes "these tests are newer than what the student was given" answerable after the fact, without storing anything on `Submission`.

**Policy: delivered assignments do not gain new content.** Corrections to existing files are expected and are the reason the default branch is followed. Adding files to an assignment students already hold is avoided, because those students do not receive them by any automatic means. Where it becomes necessary, the students who already accepted need explicit instructions, and because a generated repository and its template share no history, that merge requires `git remote add template <url> && git fetch template && git merge template/main --allow-unrelated-histories`. Treating the addition as a new assignment is usually the smaller cost.

#### `package.json`: a structured merge, not a wholesale restore

Wholesale restoration would protect the `test` script, which is otherwise trivially redirected to `echo ok`. But an assignment may deliberately ask students to add a dependency to the repository's own `package.json`, and restoring the template's file would delete that addition and fail their run on a missing module.

Worth being precise about which assignments those actually are, because the obvious candidate is not one. `swe-1-3-node-modules` is entirely about `npm install`, yet it needs `allowStudentDependencies: false`: the student runs `npm init -y` and installs `prompt-sync` inside `src/madlib-challenge/`, a **nested** package. Only the repository's own root `package.json` is a protected path, so a nested one is ordinary student work that is never restored or merged. The flag governs the root file alone.

`package.json` is JSON, so it can be merged field by field rather than treated as one opaque blob. Two categories:

| Keys                                                                                               | Rule                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts`, `type`, and any inline runner configuration (`jest`, `vitest`, `mocha`, `eslintConfig`) | Merged key by key, with the **template winning every collision**. A student may add a `start` script; a student may not redefine `test`.       |
| `dependencies`, `devDependencies`                                                                  | Student additions are **kept**. The template wins on collision, so a version the assignment specifies cannot be replaced with a different one. |

Any key the template asserts and the student overrode is recorded as `package.json#scripts.test` or similar, so the instructor sees the specific attempt rather than a whole-file difference.

Two consequences follow for assignments that permit student dependencies, controlled by the preset field `allowStudentDependencies`:

- **The lockfile cannot be restored.** A restored `package-lock.json` no longer matches the merged `package.json`, and `npm ci` exists specifically to fail in that situation. When `allowStudentDependencies` is true, the student's lockfile is kept and setup uses `npm install`. When false, both files are restored wholesale and setup uses `npm ci`, which is faster and fully deterministic.
- **Arbitrary packages are downloaded, but their install scripts do not run.** Every preset installs with `--ignore-scripts`, so a package's `postinstall` never executes and its contents are inert until something imports them — by which point the network is revoked. This began as a necessity rather than a precaution: the assignment templates install a git hook during setup with `cp hooks/pre-commit .git/hooks/`, and the sandbox receives a tarball rather than a clone, so with scripts enabled the install fails outright. It is also the stronger security position, because it removes the one path by which a student could reach the network during setup.

  The cost is that a dependency needing its install script to fetch a platform binary — esbuild, which Vitest depends on, or sharp — will not work under the default presets. Such an assignment needs a custom E2B template with those dependencies already present, which is the direction this is heading anyway.

  Even with scripts disabled, this stage is only safe because of step 3: the sandbox holds no GitHub token and nothing else from `process.env`. Had it been given a credential to clone with, no amount of `--ignore-scripts` would help.

### Step 5. The sandbox run

The sequence matters, specifically where the network is revoked:

1. `Sandbox.create({ template, timeoutMs, allowInternetAccess: true })`.
2. Upload and extract the student archive to `/work`, then overlay the template's protected paths.
3. Run the setup commands **with** network access. Installing dependencies requires it.
4. **Revoke network access** with `sandbox.updateNetwork({ allowInternetAccess: false })`.
5. Run the test command with a hard timeout, capturing stdout, stderr, and the exit code.
6. Read `/results/*.json` back out of the sandbox.
7. `sandbox.kill()` in a `finally` block. A leaked sandbox bills until its own timeout expires.

Steps 3 and 4 reproduce the Docker design of the predecessor application, which installed from a cached image and then ran with `--network none`. E2B supports both `allowInternetAccess: false` at creation and `updateNetwork()` on a running sandbox, plus `allowOut` and `denyOut` lists for finer control. Confirmed present in e2b 2.37.0, the installed version.

The SDK has no per-command wall clock limit — `CommandStartOpts` carries only a request timeout — so the test command's hard limit is applied with `timeout --kill-after=10s` inside the sandbox. That puts the limit where the process actually runs and produces exit code 124, which is what distinguishes a student's infinite loop from a suite that merely failed. The sandbox's own lifetime is set well above the command limit, because a sandbox that expired first would make an infinite loop indistinguishable from an infrastructure failure.

Revoking the network before the tests run buys two things. Results become reproducible, because a test that reaches an outside service returns a different answer when that service is slow or unavailable, and a grade that changes without the code changing is not a grade. And student code loses its channel to the outside world for the part of the run where student code is what executes.

Never pass `process.env` through to the sandbox. Its environment gets exactly what the tests need, which for these assignments is nothing.

#### Removing the install step, and with it the network, once this works

The network is enabled at all only because installing dependencies requires it. Two ways to remove that requirement were considered, and only one of them works.

**Installing on the server and uploading the result does not work.** The idea is appealing — build `node_modules` where the credentials already live and ship it inside the archive — but a dependency tree is not portable. npm resolves optional dependencies by operating system and processor architecture, so tools such as esbuild, Rollup, and sharp install a different binary package on each platform, and native modules such as `better-sqlite3` compile against one specific Node ABI. A tree built on macOS, or on Vercel's Linux, is not reliably the tree the sandbox needs, and Vitest depends on esbuild, so this is not a rare case. Python is worse, because wheels are platform-specific by design. Size is the secondary objection: a React and Jest tree commonly runs to hundreds of megabytes across tens of thousands of files, so compressing and uploading it every run would be slower than installing inside the sandbox and would move the cost onto the request path.

**Building a custom E2B template with dependencies already present does work**, because the template is built in the same Linux environment the sandbox runs. The sandbox then starts with `node_modules` in place, the setup step disappears, and `allowInternetAccess: false` can be set at creation and never changed. This is both stricter and faster than install-then-revoke, and removing the install step is likely the largest speed improvement available in this phase.

It is not step one because it needs a template build per dependency set and a rebuild whenever a dependency set changes. Assignment templates across the program share a small number of dependency sets, so a handful of E2B templates covers most of it, but that inventory is worth building against measured install times rather than in advance of them. So: implement install-then-revoke first, record `durationMs` and the setup command's share of it during verification, then build templates for the dependency sets that justify one. Assignments with `allowStudentDependencies: true` keep the install step and the temporary network permanently, since the student's dependencies are not known ahead of time.

#### A test must assert something the archive can carry

The runner receives a git archive, so a test can only check what git tracks. An
assertion about anything else cannot pass — not in this sandbox, and not in any clone,
checkout, or CI job either.

`swe-1-3-node-modules` was the first case. Its `madlib.spec.js` asserted that
`src/madlib-challenge/node_modules/prompt-sync` existed **on disk**, alongside the
assertion that the nested `package.json` listed it. Since `node_modules/` is gitignored,
that check could only ever pass on the machine where the student ran `npm install`, so a
correct submission lost the point everywhere else.

The assertion was removed from the template. That was deliberately preferred over
teaching the runner to install nested packages, for a reason worth keeping in mind as
more assignments are converted: **a per-assignment runner override fixes one assignment,
while fixing the test fixes it everywhere the tests run.** The dependency listing is
still checked, which is the actual learning objective, and a separate test still checks
that `prompt-sync` is imported and initialised.

`assignment.runnerConfig` remains the escape hatch for genuine cases — an assignment
needing a different E2B template, a longer timeout, or an extra setup step that is about
the environment rather than about a mis-specified test. The SQL preset will need it.
Nothing needs it today.

### Step 6. Parsers

One function per `ResultFormat`, all returning the same normalized shape, so the database schema and everything downstream is runner-independent:

```ts
type NormalizedResults = {
  total: number; passed: number; failed: number; skipped: number;
  tests: { suite: string; name: string; status: "passed" | "failed" | "skipped";
           durationMs?: number; failureMessage?: string }[];
};
```

Parse failure is not test failure. A suite that crashes before writing its JSON, or writes something unparseable, is an `ERRORED` run rather than a zero score. Conflating the two is how a student receives a zero for an infrastructure problem.

### Step 7. Storage — the `test_runs` table

Deterministic results get their own table rather than columns on `grading_drafts`, because they outlive any one draft: re-generating a report against the same commit should not rerun the tests, and Phase 3's cross-check reads this table as its source of truth.

```prisma
enum TestRunStatus {
  RUNNING
  COMPLETED   // the suite ran to completion; pass or fail is testsFailed, not this
  TIMED_OUT
  ERRORED     // infrastructure: fetch, sandbox, extraction, or parse failed
  @@schema("public")
}

enum TestRunTrigger { MANUAL WEBHOOK  @@schema("public") }

model TestRun {
  id           String  @id @default(uuid()) @db.Uuid
  submissionId String  @map("submission_id") @db.Uuid
  headSha      String  @map("head_sha")
  trigger      TestRunTrigger @default(MANUAL)
  status       TestRunStatus  @default(RUNNING)

  runnerPreset      String  @map("runner_preset")
  e2bTemplate       String  @map("e2b_template")
  sandboxId         String? @map("sandbox_id")
  /// The template commit whose tests actually ran.
  templateCommitSha String? @map("template_commit_sha")

  setupExitCode Int?  @map("setup_exit_code")
  testExitCode  Int?  @map("test_exit_code")
  testsTotal    Int?  @map("tests_total")
  testsPassed   Int?  @map("tests_passed")
  testsFailed   Int?  @map("tests_failed")
  testsSkipped  Int?  @map("tests_skipped")
  /// passed / total. NOT the score, and not compared against
  /// assignment.completionThreshold — completion is judged on the final rubric
  /// score, of which test outcomes are one input. See Phase 3's cross-check.
  passRate      Float? @map("pass_rate")

  /// NormalizedResults.tests — per-test detail, identical shape for every runner.
  results       Json   @default("[]")
  /// [{ path, kind: "added"|"modified"|"removed"|"renamed" }] — protected paths the
  /// pull request changes, taken from the pull request's own diff and therefore
  /// measured against the template snapshot this student received. Non-empty is a
  /// finding an instructor must see, not an automatic penalty.
  tamperedPaths Json   @default("[]") @map("tampered_paths")

  /// Truncated. Whole suites can emit megabytes and nothing downstream reads past
  /// the first few thousand lines.
  stdoutTail  String? @map("stdout_tail")
  stderrTail  String? @map("stderr_tail")
  errorDetail String? @map("error_detail")

  startedAt  DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)
  /// Wall clock. An input to the Phase 4 orchestration decision.
  durationMs Int?      @map("duration_ms")

  submission Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)

  @@index([submissionId, headSha])
  @@map("test_runs")
  @@schema("public")
}
```

Rows are never updated in place after completion and reruns append, so the history of a submission stays legible.

**A submission with no rows at all is normal, not an error.** Every assignment whose `runnerPreset` is `none` has zero test runs forever. Nothing downstream may treat the absence of a row as a failure, a pending state, or a zero — which is why the relation is a plain one-to-many with no expectation of at least one, and why `Submission` gains no `latestTestRunId` pointer that would read as "missing" when empty. Three states are distinct and every consumer has to tell them apart:

| State                             | How it is represented                        |
| --------------------------------- | -------------------------------------------- |
| This assignment has no tests      | No `test_runs` rows; `runnerPreset = "none"` |
| Tests exist and have not been run | No rows; `runnerPreset` is something else    |
| Tests ran and failed              | A `COMPLETED` row with `testsFailed > 0`     |

### Step 8. Triggering a run

`lib/sandbox/run-tests.ts` exports one function:

```ts
export async function runTestsForSubmission(
  submissionId: string,
  opts: { trigger: TestRunTrigger },
): Promise<TestRun>
```

It takes an id and reads everything else itself. It does not know what invoked it. This is the whole accommodation this phase makes for the deferred orchestration decision: whichever design Phase 4 chooses, its worker loop or its step function calls exactly this.

It throws when `runnerPreset` resolves to `none`, rather than writing an `ERRORED` row. An assignment with no tests has not failed at anything, and a table of `ERRORED` rows against every short response submission would be noise hiding real infrastructure failures.

For this phase the only caller is an instructor-only tRPC mutation, `testRuns.start`, awaited inside the request. Nothing about that is production-shaped, and it is not meant to be — it means the sandbox can be debugged with a stack trace in the terminal rather than through a queue. Add `testRuns.listForSubmission` and `testRuns.get` for reading. On the existing instructor assignment page, add a "Run tests" button per submission and a results view showing pass counts, per-test failures, changed protected paths, and duration.

For an assignment with `runnerPreset: "none"` the button is absent — not present and disabled, and not present and failing — with the text "No automated tests for this assignment" in its place. This is the common case for short response and frontend assignments and should read as a normal state of the world rather than as something broken or unconfigured.

The webhook is **not** connected to this in Phase 2. It continues to do only what it does now.

### Phase 2 verification

Two scripts cover everything that does not require pushing a commit to a student
repository. `npm run verify:sandbox` checks the pure logic — path matching, tamper
reporting, the `package.json` merge, the restore script, and all three parsers —
with no sandbox involved. `npm run verify:e2b` creates one real sandbox and checks
the properties only a real sandbox can show. `npm run tests:run` executes a real
submission from the terminal, which is where a sandbox failure is diagnosed.

**Passed**, against `marcy-lms-test/swe-1-4-loops-benspector3` and the
`marcy-lms-test/swe-1-4-loops` template.

- **A passing submission scores 1.** The answer keys committed to the student's draft
  branch: `COMPLETED`, 13 of 13, pass rate 1, no tamper findings.
- **Genuine failures are recorded.** The template's stub code: 1 of 13, with every
  failure name and message stored.
- **Editing a test to hide broken code does not work.** `loop5to10` was broken to log
  5 through 9, and the assertion edited from 6 calls to 5 to match. The run reports
  `Expected number of calls: 6` — the template's assertion, not the student's — so the
  result is 12 of 13, and `tests/from-scratch.spec.js` appears in `tamperedPaths`. The
  attempt cost a point rather than winning one.
- **A test file the student adds never executes.** `tests/cheat.spec.js` with two
  free-passing tests: reported as `added`, and the total stayed at 13 rather than
  rising to 15, because `tests/` is replaced wholesale.
- **An instructor's template fix is never reported as a student's edit.** The
  template's assertion was corrected after the student had accepted: the corrected
  test ran, `templateCommitSha` moved to the new commit, the result changed from 12 of
  13 to 13 of 13, and **`tamperedPaths` stayed empty**.
- **Renaming a suite out of `tests/` neither hides it nor escapes notice.**
  `tests/debug.spec.js` moved to `notes-debug.spec.js.bak`: reported as `removed
  tests/debug.spec.js`, attributed to the protected source path rather than to the
  unprotected destination, and all 13 tests still ran.
- **A routine mod-1 commit reports nothing.** The templates' `hooks/pre-commit` stages
  a rewritten `scores/scores.json` on every commit, and that produces no finding —
  see the note on unprotected paths above.
- **A broken `testCommand` is an infrastructure failure, not a zero.** `ERRORED`, the
  unrecognised flag quoted in `errorDetail`, and `tests_total`, `tests_passed` and
  `pass_rate` all null with an empty `results` array.
- **An assignment with no tests throws rather than recording a failure.**
  `NoRunnerConfiguredError`, and the `test_runs` row count was unchanged.
- **Nothing from `process.env` reaches the sandbox.** Checked by name for the GitHub
  private key, app id, webhook secret and installation id, the E2B key, the Supabase
  service role key, both database URLs, and the Groq key, plus a canary variable set
  immediately before the sandbox was created.
- **The network works before revocation and not after**, same outbound request either
  side of `updateNetwork`.
- **An endless command is killed** with exit code 124, reported as `TIMED_OUT` rather
  than as an error, and the sandbox still answers afterward.
- **No sandbox is left running**, confirmed through `Sandbox.list`.
- **Setup duration is recorded separately.** Consistently 6 to 12 seconds of a 30 to
  38 second run, which is the input to the custom-template decision.

- **A second assignment grades correctly with no per-assignment configuration.**
  `swe-1-3-node-modules`, whose student work includes a nested npm package: 11 of 11,
  pass rate 1, `runner_config` null. Its nested `package.json` and its `prompt-sync`
  dependency both survive the protected-path overlay, because only the repository's
  root `package.json` is protected.
- **The full Phase 1 loop still works unattended.** `assignments.accept` created the
  repository and added collaborators, and opening the pull request drove the webhook to
  `SUBMITTED` with the pull request number and head commit recorded — with no manual
  database edits.
- **Setup cost varies by dependency set**, which is the argument for custom templates:
  9.6s of a 33.4s run for `swe-1-4-loops`, 16.9s of a 41.1s run for
  `swe-1-3-node-modules`.

**Still to check.**

1. A Python assignment on `python-pytest`, for results shaped identically to the Jest
   ones. No Python template exists in `assignment-templates/` yet.
2. `allowStudentDependencies: true` against an assignment that genuinely asks students
   to add a dependency to the repository's **root** `package.json`. No current
   assignment does — `swe-1-3-node-modules` looked like the candidate and turned out
   not to be, since its dependency lives in a nested package. Note that the default
   presets install with `--ignore-scripts`, so a dependency needing an install script
   to fetch a platform binary needs an override.
3. A student repository generated from a template *before* the `score-tests` cleanup,
   graded against the cleaned template. The reasoning says it works — the wholesale
   devDependency restore drops `score-tests`, the template's clean specs replace the
   student's, and the surviving `preinstall` never runs under `--ignore-scripts` — but
   it is unverified until the cleaned `swe-1-4-loops` template is pushed to the
   organization. The existing student repository is exactly that case.

Section-to-run mapping on a blended assignment is a Phase 3 concern and is verified
there, since nothing in this phase reads `sections`.

---

## Phase 3: AI report generation

One schema-constrained language model call per gradable section, given fixed inputs. Test execution is not part of this phase: where it happened at all, it happened already and its results are read from the database.

The stages are: load the submission, the assignment, and its most recent `test_run` if one exists; fetch the answer keys named in `assignment.sections`; classify which sections the pull request contains; generate the report; cross-check it; record the draft.

### Section classification is deterministic code, not a model judgment

`agent-rules.md`'s file-path rules become an ordered classifier over the pull request's changed paths: `short-response.md` means short response; `src/*.js` with Jest in `package.json` means algorithm; `.sql` without Jest means SQL; HTML, CSS, JSX, and server files mean frontend. The result is intersected against the assignment's `sections` mapping. A section expected but absent is reported as not submitted, matching the existing rule. A section present but unexpected routes to `needs_manual_review`.

This is `classify.ts` in the predecessor application and ports across directly.

### The call

Not an agentic tool-use loop. Every discovery and side-effecting step from `agent-rules.md` has already happened deterministically, so what remains is judgment over fixed inputs, which is more reliable and cheaper as a single well-stocked call.

**System prompt:** `agent-rules.md`'s tone and formatting rules — second person, two-beat summary, impact before root cause, verbatim checklist copying, half-credit nesting — plus the matching `rubric.md` section, plus the matching `sample-*-report.md` template.

**User content:** the assignment README, which carries the verbatim frontend and SQL checklists; the relevant answer key files, labeled as reference and never shown to the student; the student's changed files; and the verified results from the `test_run`.

**Output:** schema-constrained JSON containing the rendered markdown and machine-readable `{scoreEarned, scorePossible, rubricItems[], flags[], instructorNotes[], confidence, submissionProcessNote, testClaims[]}`.

`flags` is a closed vocabulary of short codes, because the same database column also carries codes the pipeline writes itself and the review interface renders every entry as a badge. Prose belongs in `instructorNotes`, described below.

Each flag records **why a student lost points**, and each corresponds to a bullet in a `rubric.md` score band, so a flag traces back to the written criterion behind it. A section that earned full marks carries none.

| Writing Quality | Technical Score |
| --- | --- |
| `MECHANICAL` — spelling and grammar | `INCOMPLETE` — parts of the question unanswered |
| `CLARITY` — vague, contradictory, or needlessly complex | `UNDERSTANDING` — gaps, inaccuracies, misunderstanding |
| `MARKDOWN` — does not render, or unused where it would help | `TERMINOLOGY` — missing or misused |
| `STRUCTURE` — unclear structure, poor flow | |

**No flag text ever appears in the report a student reads.** Approving a draft posts its markdown to the pull request, so a `FLAG:` line left in the text is an internal label delivered to a student with no way to take it back. The prompt forbids it and `cross-check.ts` holds any draft whose text contains one — guidance alone is not a guarantee for the one leak that cannot be undone. The student is still told, in the report's own voice, that their writing needs proofreading; what they never see is the code.

### One section, one call, one report

An assignment with two gradable sections produces two model calls and two reports, each against its own rubric, its own answer keys, and its own point value. A checkpoint's short response and its coding work are not commensurable, and nothing in the pipeline tries to combine them into a single narrative.

**Point values live on the section, not the assignment.** `assignments.point_value` is the sum of its sections and exists for the gradebook; the number sent to the model is always the section's own. `sections` is a JSON column, so this needs no migration. `swe-checkpoint-summative-1-4` is 40: a short response worth 15 (3 technical points for each of 4 questions plus one 3-point writing score) and a frontend section worth 25 (one point per README checklist item).

A section reaching the model without a point value is refused rather than defaulted. Told nothing about the maximum, a model invents one — an early run scored a 13-test assignment out of 40 — and a plausible score against an invented denominator cannot be distinguished downstream from a real one. The draft fails with a message naming the section.

This is also what the instructor authoring form collects: a point value per section, not one per assignment.

### Why a section has no test results

Four outcomes rather than two, recorded as one flag per section. "This assignment has no
suite" and "this assignment has a suite and none of it ran" are opposite situations that
looked identical while both were `NO_TEST_EVIDENCE`.

| Flag | Meaning | |
| --- | --- | --- |
| `TEST_EVIDENCE` | Claims were checked against a real run | ordinary |
| `NO_TESTS_EXPECTED` | The section declares no `evidence: "tests"` | ordinary |
| `TEST_RUN_MISSING` | Tests expected, no completed run at this commit | a fault |
| `TEST_MATCH_MISSING` | Tests ran, the section's `testNamePattern` matched none of them | a fault |

Short response and frontend work carry `NO_TESTS_EXPECTED` as a plain statement of fact
and nothing is wrong. The last two mean the model graded without a constraint it was
supposed to have, so each adds a review reason naming what is missing and what to do —
run the tests, or fix the pattern.

### Notes to the instructor

`instructorNotes` is free text the model writes for the instructor and that is never shown to the student. It exists because the two audiences need different things: "the point value I was given does not divide evenly into this README's checklist" is exactly what an instructor needs before approving a score, and exactly what a student should not read.

The field earns its place on real submissions. Grading the checkpoint produced "the README checklist contains 25 items, but this section was specified as 15 points, so I weighted every item at 0.6" — a genuine configuration problem that no deterministic check would have found. Grading `swe-1-4-loops` produced "the student's three files are byte-for-byte identical to the reference solution", which is a plagiarism signal the pipeline has no other way to express.

A note does not by itself route a draft to manual review. `confidence: "low"` is the mechanism for that, and the model sets both when it could not assess the work.

### Provider isolation

One interface with two implementations. Pipeline code calls `getReportGenerator()` and never references a vendor; selection happens through `GRADING_LLM_PROVIDER=claude|groq`.

```
lib/grade/
├─ provider.ts           # the only module the pipeline imports
├─ providers/claude.ts   # Claude: output_config.format with messages.parse()
└─ providers/groq.ts     # Groq: strict json_schema response format
```

```ts
// provider.ts — the contract
export interface ReportGenerator {
  readonly name: string;
  generate(input: { system: string; user: string }): Promise<{
    output: GradingReport;         // validated against the zod schema, and typed
    usage: {
      promptTokens: number;
      completionTokens: number;
      cachedPromptTokens?: number; // read from cache
      cacheWriteTokens?: number;   // written to cache, billed above base rate
    };
    modelId: string;               // recorded in grading_drafts.model_metadata
  }>;
}
```

The contract carries a zod schema rather than a JSON Schema document, because each provider has a better path than a hand-rolled validator and passing JSON Schema alone would throw the Claude path away. Claude's SDK derives the response format from the schema and parses through it with `messages.parse()` and `zodOutputFormat()`; Groq needs a plain JSON Schema in its request body, which the same schema derives.

**Claude is the provider in use, on `claude-opus-5`.** Groq's `openai/gpt-oss-120b` with strict `json_schema` remains implemented and is the only Groq model and mode combination confirmed to guarantee schema-conformant output, but its free tier caps requests at 8,000 tokens per minute and a frontend prompt does not fit: those carry several answer keys and a verbatim README checklist. An algorithm assignment fits at roughly 7,000 tokens; the checkpoint needs about 12,400 by Groq's count and is rejected with a 413.

Two differences the interface must not hide:

- **Claude's JSON schema support rejects numeric constraints** such as `minimum` and `maximum`, rejects string length limits, and requires `additionalProperties: false`. The schema must avoid those constraints, which means the arithmetic verification in the cross-check remains necessary. Schema validation on either provider does not make it redundant.
- **Claude reports cached tokens separately from `promptTokens`, not as a subset of it.** A run that writes the cache therefore shows zero reads and an unchanged prompt count, which is indistinguishable from caching being broken unless the write count is also recorded. All four counts go into `model_metadata`.

### What a report costs

Measured on Claude, one section per run. Costs are normalized to a cache hit so the only variable is `effort`:

| Section            | Effort | Uncached input | Cached | Output | Cost   | Wall clock |
| ------------------ | ------ | -------------- | ------ | ------ | ------ | ---------- |
| `coding_algorithm` | high   | 5,207          | 5,624  | 2,646  | $0.095 | 31s        |
| `coding_algorithm` | medium | 5,207          | 5,624  | 2,365  | $0.088 | 27s        |
| `coding_frontend`  | high   | 12,392         | 7,590  | 3,396  | $0.151 | 40s        |
| `coding_frontend`  | medium | 12,392         | 7,590  | 2,631  | $0.132 | 29s        |

Output is roughly 60 percent of the cost, because thinking is billed as output. `GRADING_LLM_EFFORT` therefore moves total cost more than prompt caching or model tier do, and it is left at `high`: the gap is 7 to 14 percent, which does not buy enough to trade grading quality for.

**`high` looked twice as expensive as this until the point values were fixed.** Graded against a single assignment-wide point value, the frontend section was told it was worth 15 while its README checklist had 25 items, and `high` spent 6,715 output tokens — nearly double the 3,396 above — reasoning about the contradiction and explaining the compromise it had settled on. Almost all of the apparent saving from lowering `effort` was the model thinking hard about a misconfiguration. It is worth remembering before reaching for `effort` as a cost lever again: measure the prompt first.

Effort did not change the outcome on any submission. Both levels scored `swe-1-4-loops` 30/30 and the checkpoint 1/25, at the same confidence, and both raised the same notes to the instructor — including that the student's files were byte-for-byte identical to the reference solution, and that the checkpoint submission was thin enough to warrant a conversation rather than only a score. Four data points is not calibration, which is Phase 3 verification item 7.

**Caching works, and its window is short.** A repeated frontend request read 7,590 tokens and wrote none. A later request for the same prompt wrote all 7,590 again, because the default cache lifetime is five minutes. Caching therefore pays when a cohort is graded in one burst and pays nothing when grading is spread across an evening — which is an input to Phase 4's orchestration design, not a detail. A one-hour lifetime is available at double the write price.

Only the system prompt is cacheable today, which is 38 percent of the frontend input. The answer keys sit in the user content even though they are identical for every student of a given assignment — see [deferred items](#deferred-with-the-schema-left-open).

At `medium`, a cohort of 25 students costs roughly $2.20 for an algorithm assignment and $3.60 for a frontend one.

### What the cross-check may and may not assert

Test results are a fact the model must not contradict, and one rubric input among several. They are not the score, so the check is asymmetric:

| Situation                                                       | Verdict                                          |
| --------------------------------------------------------------- | ------------------------------------------------ |
| Model states a test passed that the run records as failed       | Contradiction → `needs_manual_review`            |
| Model awards the "passes all tests" criterion when tests failed | Contradiction → `needs_manual_review`            |
| Model withholds points despite all tests passing                | **Legitimate** — hardcoding, inefficiency, style |
| Model's `rubric_items` do not sum to its reported score         | Arithmetic error → `needs_manual_review`         |

The third row is the one that matters most and the one a naive implementation gets wrong. A check written as "claimed score must match pass rate" would flag exactly the judgment the model is there to make: a student who returns hardcoded values to satisfy the assertions passes every test and has demonstrated nothing.

So the check compares the model's *claims about test outcomes* against the run, and never its score against the pass rate.

This also means the arithmetic verification applies to every section, tested or not — it is the only automatic check available when a section has no run.

The cross-check operates per section, because within one submission some sections are bound by test evidence and some are not. A non-empty `tamperedPaths` routes to `needs_manual_review` regardless of score. `grading_draft_sections` records whether a run informed it, so the review interface can show which sections had their test claims verified and which rest entirely on the model's reading of the code. Presenting both with the same authority would be misleading.

### Failure handling

Any of these produces `needs_manual_review` with the specific reason attached, never a fabricated score: fetch or authentication failure, a test runner crash as opposed to failing tests, no section type matched, an assignment with no `sections` mapping, a model call or schema validation failure, or the model self-reporting low confidence.

### Grading assets

`grading-toolkit/` and `answer-keys/` come from one of two sources, chosen by whether `GRADING_ASSETS_PATH` is set.

**A local clone**, when it is. Editing `rubric.md` and re-grading immediately is how the rubric actually gets tuned, and a loop requiring a commit and push first would stop that happening. Development only.

**The private repository through the GitHub API**, otherwise, which is what a deployed host uses. Individual files rather than the repository archive: the archive is 23MB and over 20 seconds, almost all of it images grading never reads, while a run needs the rubric, the agent rules, one sample report, and a handful of answer keys — measured at roughly 200ms each and fetched in parallel.

Files are read at a resolved commit SHA, never at a branch name, so a run taking ninety seconds cannot read half its rubric from before a push and half from after. Content is cached under `sha:path` with no expiry, which is safe because the content of a path at a given commit cannot change. The branch head itself is re-resolved every 60 seconds, so a pushed rubric change takes effect within a minute without a webhook.

Either way the commit SHA is recorded in `grading_drafts.model_metadata` alongside the model id, prompt version, and token usage, so a report traces back to the exact rubric that produced it.

**A GitHub App is installed per organization.** The guides are in `The-Marcy-Lab-School` while the student repositories are in `marcy-lms-test`, and the installation covering one cannot read the other. `GRADING_ASSETS_INSTALLATION_ID` names the second installation; `scripts/list-installations.ts` prints the ids. `npm run verify:assets` exercises the deployed path with the local clone forced off, and is the check that a deployment can read its rubric at all.

### Phase 3 verification

`npm run verify:grade` covers everything that needs no model or network — 37 checks, all passing. Items 1 through 6 are done; item 7 is outstanding.

1. **Done.** `classify.ts` as a pure function: a known algorithm file classifies as `coding_algorithm`; an unexpected `.sql` file surfaces as unexpected. The rules are ordered and the first match wins, so both directions of the algorithm-or-frontend distinction are checked: a flat `src/*.js` file is an algorithm exercise when the template has a Jest suite and frontend work when it does not.
2. **Done.** The stamped `gradingAssetsCommitSha` matches `git -C $GRADING_ASSETS_PATH rev-parse HEAD`. Rubric section extraction is checked as a pure function, including that a missing section throws rather than silently grading against nothing.
3. **Done.** `swe-1-4-loops` with every test passing scores 30/30 at high confidence. A submission that broke its code and edited the assertion to match scored 12/13 with the template's own assertion executing.
4. **Done.** Full credit claimed alongside a failing test is caught as `FULL_CREDIT_DESPITE_FAILURES`; claiming a failed test passed is caught as `TEST_CLAIM_CONTRADICTION`, in both the bare and `Suite › name` forms the prompt uses.
5. **Done.** A submission with all tests passing but hardcoded return values is not flagged merely for scoring below full credit. No check compares score against pass rate, and one exists specifically to keep it that way.
6. **Done.** The checkpoint assignment has no test suite, produced a draft, and the arithmetic check applied to it. The section is flagged `NO_TESTS_EXPECTED` on the row and labelled in the review interface as having no suite by design, which is distinct from a section that expected one and did not get it.
7. **Done.** `npm run calibrate` grades a sample submission and compares the result against the report an instructor wrote about it. The toolkit holds two short response pairs; pair 1 is the exemplar embedded in the prompt, and **pair 2 is held out**, which is the only reason grading it measures anything.

   | | pair 1 (exemplar) | pair 2 (held out) |
   | --- | --- | --- |
   | Total | 12/15 = 12/15 | 11/15 against 12/15 |
   | Per-question technical | all four agree | **all four agree** |
   | Writing quality | 1 = 1 | 1 against 2 |

   Every technical score across both pairs agrees with the instructor's. The one
   remaining difference is pair 2's writing score, on an acknowledged boundary case:
   the model places it at 1 and quotes the rubric back, since the 2 band requires that
   errors "do not take away from the understanding". It raises `CLARITY` alongside
   `MECHANICAL`, so it is still reading two sentences as harder to follow than the
   instructor does. An instructor may reasonably prefer 2. That is the kind of judgment
   a rubric cannot fully specify, and the reason a draft is reviewed rather than
   published.

   Calibration also found two errors in the reference reports rather than in the
   pipeline, both since corrected: report 2 scored a question against a submission that
   had been fixed without the report being updated, and report 1 documented typos and a
   garbled sentence without raising the mechanical errors flag its own rubric required.
   The one real disagreement is pair 2's writing score, on an acknowledged boundary case. The model placed it at 1 and quoted the rubric back: the 2 band requires that errors "do not take away from the understanding", and two sentences in that submission do. An instructor may still prefer 2. That is the kind of judgment a rubric cannot fully specify, and the reason a draft is reviewed rather than published.

   Coding sections are not calibrated. Scoring them is closer to objective, and no graded samples exist.

### Whole numbers, and where the hesitation goes

Rubric scales are a fixed set of bands, each with a written description. A 1.5 corresponds to no description in the rubric and cannot be explained to a student, so the prompt requires whole numbers and directs a genuine boundary case into `instructorNotes` instead, naming both bands and the reason for choosing one.

The effect is visible in the calibration output. Asked only for a number, the model returned 1.5 with a note that the work sat between two bands. Asked for a band, it returned 1 with a note quoting the rubric clause that decided it. The second can be reviewed; the first hides the judgment inside an average.

---

## Phase 4: triggering and orchestration

Deferred until after Phase 6, and the question it answers has changed.

### Whether grading should be automatic at all

The original design had the webhook start a run on every `opened`, `reopened`, and `synchronize`. That is worth reconsidering before it is built, because each run costs real money and most of them would be wasted.

A student who opens a pull request, closes it, opens another, and pushes six more commits generates a report per event. None of the intermediate ones is read by anybody. At roughly $0.15 a report and a cohort of twenty-five, a week of ordinary student behaviour is a meaningful bill for drafts nobody looks at — and every one of them lands in the instructor's queue as something to scroll past.

The alternative is a **grading session**: the instructor sits down, presses "generate pending reports", and the application grades every submission whose current commit has no draft. One report per submission per state of the code, generated when somebody is actually about to read it. Cost tracks the work an instructor does rather than the commits a student makes, and there is nothing to prune.

It also fits how grading actually happens, which is in batches at a sitting rather than continuously.

This does not need the webhook to trigger anything, so the requirements below are about the batch, not about responding to GitHub inside ten seconds:

1. The intent to grade is recorded durably before work begins, so a submission is never silently skipped.
2. Work that fails partway through can be retried without repeating what already succeeded.
3. The same submission is never graded twice concurrently.
4. A batch of twenty-five submissions is not bound by one function invocation's time limit, though a single submission comfortably is.
5. Progress is readable from PostgreSQL while the batch runs, because the instructor is watching it.

Requirement 4 is the only one that still argues for anything beyond a plain function. **A single submission takes about two minutes at the worst measured case against a 300-second limit**, so fanning out one invocation per submission satisfies it without a worker process or step-by-step continuation. The measurements are in [what a report costs](#what-a-report-costs) and the durations table below.

The designs that follow were written for the automatic version and are kept because the durability and concurrency questions are the same either way.

### If it does become automatic

The webhook starts a run on `opened`, `reopened`, and `synchronize`, and marks any existing draft `SUPERSEDED` on `synchronize`. Everything before this phase is callable as a plain function taking a submission id, so this phase adds a caller and changes nothing else.

This is where the asynchronous job design is chosen. It is deliberately not decided yet, because Phases 1 through 3 do not need it: Phase 1's work is one database update, and Phases 2 and 3 keep a human waiting for the slow part on purpose.

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

Phase 2 measures the first half of that time for real. Once a few dozen runs are recorded, `test_runs.duration_ms` answers the question this decision actually turns on: whether test execution alone already approaches the limit, or whether it is the model call that pushes the total past it.

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

## Phase 5: review, approval, and resubmission

### The state machine

```
NOT_STARTED → ACCEPTED → SUBMITTED → DRAFT_READY → GRADED → RESUBMITTED
                                                                  │
                                                     ┌────────────┘
                                                     ▼
                                              back to SUBMITTED
side states: GRADING_FAILED, NEEDS_MANUAL_REVIEW — surfaced the same way as
DRAFT_READY but with a reason instead of, or alongside, a score
```

### The review screen

Renders each `grading_draft_section` — markdown plus its score — and a "needs manual review" banner carrying the specific reason when the pipeline could not produce a confident draft. Never a silently wrong score. The first version is render and approve only; inline editing of scores and notes is deferred.

### The Approve action

One write that fans everything out, in a single transaction:

1. Copy `report_markdown` and the scores from `grading_draft_sections` to the submission's `feedbackMarkdown`, `finalScore`, and `finalScorePossible`; compute `isComplete` against `completionThreshold`; record `gradedBy`, `gradedAt`, and `gradedHeadSha`; set the status to `GRADED`.
2. Post — or, on resubmission, patch — a pull request comment through `postOrUpdatePrComment`. Best-effort and retryable, so a brief GitHub outage does not block the grade. Editing rather than appending matters on resubmission, so a student sees one updated review instead of a growing list.
3. The student's assignment page reads the graded fields immediately. There is no separate publish step.
4. Set `salesforceSyncStatus` to `PENDING`, inert until that phase exists.

### Resubmission after a grade

An instructor needs to know when a student has revised work that was already graded. A student needs to commit freely without each commit reading as a request for re-review. Two requirements, met by two mechanisms.

**The automatic part: newer code exists.** GitHub sends `pull_request.synchronize` on every push to an open pull request's branch, and the handler already records `headSha`. With `gradedHeadSha` recorded at approval, `headSha !== gradedHeadSha` means there is code newer than what was graded. It is a comparison of two columns, needs no API call, and is available the instant the push happens. Display it as a plain fact — "revised since grading" — and leave it at that.

**The webhook's status rule — built.** Opening the pull request is the act of submitting. `synchronize` records the new commit through `headSha` and `lastActivityAt` and does not touch the status, because a commit is not a claim of completion and a graded submission must not drop back into the queue because someone fixed a typo.

| Event                   | Current status      | Result                              |
| ----------------------- | ------------------- | ----------------------------------- |
| `opened` / `reopened`   | anything but graded | `SUBMITTED`                         |
| `opened` / `reopened`   | `GRADED`, `RESUBMITTED` | `RESUBMITTED`                   |
| `synchronize`           | any                 | untouched                           |

Keyed on the current status as well as the action, because the action alone is not enough: a student who closes a pull request and opens a new one fires `opened` a second time, and treating that as a first submission would reset a graded row and lose the distinction the queue depends on.

This rule costs something, and it is the right cost. A student who opens a pull request before starting appears in the queue with almost nothing in it. An instructor sees that immediately — and the model already remarks on it — whereas work that is never declared ready is silently never reviewed. Students need to be told that opening the pull request is the submission.

**The explicit part: the student is ready.** A commit is not a claim of completion, so the transition to "review this again" needs a deliberate act. A button in the application, setting the status to `RESUBMITTED`, is the mechanism: the state lives in the same database the instructor's queue is built from, and it works no matter how irregular a student's commit habits are. `SUBMITTED` cannot serve, because it does not distinguish a first submission from a revision, and an instructor working through a list needs to see which is which.

A GitHub-native alternative exists: students work in a draft pull request and mark it ready when finished, which sends `pull_request.ready_for_review`. It costs no interface at all and keeps students in the tool they are already using. The cost is that it depends on the draft pull request habit holding, and a student who opens an ordinary pull request never produces the event. The button has no such failure mode, which is why it is the recommendation.

Together the two produce information neither gives alone: a submission with newer code and no readiness declaration is a student still working, or one who finished and forgot to say so.

Automatically re-running tests and re-generating a draft when a student declares readiness is Phase 4 work and uses the same trigger path as everything else there.

### Phase 5 verification

All six are done, against `swe-1-4-loops-benspector3` in `marcy-lms-test`. Items 4 to 6 are re-runnable with `npm run verify:resubmission`, which drives the procedures through tRPC callers so authorization is exercised alongside the behaviour.

1. **Done.** Approving recorded 30/30, set `isComplete` against the 75 percent threshold, wrote `gradedHeadSha`, marked the draft `APPROVED`, and posted comment `5154457674`. Approving the same draft twice is refused rather than posting the feedback again.
2. **Done.** The instructor path from assignments to submissions to the review surface calls through, and a student calling the same procedures is refused with `FORBIDDEN`.
3. **Done.** The student's page reads the graded columns directly, so the feedback appears on approval with no publish step — and appears even when the comment failed to post.
4. **Done.** A real commit pushed to the `draft` branch after grading left the status at `GRADED`, moved `headSha` to `e950431`, and left `gradedHeadSha` at `7d1b6f4`, which is what marks the submission revised since grading.
5. **Done.** The student's declaration set `RESUBMITTED`, and the instructor's queue distinguishes it from a first submission.
6. **Done, and the expected behaviour changed.** A second approval posts a **new** comment rather than editing the first: the pull request now carries `5154457674` for `7d1b6f4` and `5154783511` for `e950431`. Feedback on a resubmission describes different work, and the two read in order are the record of what the student changed — see [one section, one call, one report](#one-section-one-call-one-report). Approving also cleared the revised-since-grading state by advancing `gradedHeadSha`.

---

## Phase 6: interface pass

Generate a prompt for Vercel V0 that produces the interface only, with no backend, once the data shapes are settled. Everything before this is deliberately minimal pages that exercise the procedures.

---

## Deferred, with the schema left open

- **Salesforce synchronization.** The three dormant columns exist. The field mapping is prerequisite work owed before this is built, not something to guess.
- **SQL sandbox execution.** The design is settled: boot an ephemeral PostgreSQL, run `setup.sql`, and compare each numbered query's result set — rows, columns, and order — against `queries-solution.sql` programmatically, which makes SQL correctness fully deterministic with no model judgment involved. It needs an E2B template with PostgreSQL installed and is the first thing to build after Phase 2 works.
- **Frontend execution scoring.** Matches today's manual process, which is a README checklist and a code-reading judgment. Lint and build only, to catch hard errors.
- **The GitBook resource link index.** Pre-build a heading-to-URL index for `marcy-curriculum-docs` per module — the URL scheme is fixed at `.../{module}/{lesson}#{subheading}` — and pass candidate links in context for the model to select from rather than construct. Until this exists, prompts omit a recommended resources section entirely rather than risk invented URLs.
- **Answer keys in the cacheable prefix.** They are identical for every student of a given assignment but sit in the user content, so they are billed at full input price on every run. Moving them into the system block would give each assignment its own cache entry. Worth roughly 6 percent of the cost of a report, which is why it waits behind the `effort` question.
- **Instructor-authored rubrics** beyond the four fixed types.
- **Inline score and note editing** in the review interface.
- **Bulk grading** beyond the basic gradebook table.
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
