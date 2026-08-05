# mls-lms

A replacement for GitHub Classroom, with AI grading reports built in, for The Marcy Lab School's nine-month fullstack program.

GitHub Classroom is being discontinued. Grading one assignment today touches four systems by hand: clone the repository, run the tests and work through the manual grading toolkit, post feedback as a pull request comment, re-enter the grade in Google Classroom, and re-enter the grade and its metadata in Salesforce. The same grade and feedback is typed three times — a transcription-error risk and a drain on instructor time that should be going into actually reviewing student work, since methodical feedback is a stated core competency of the program rather than a nice-to-have.

This application provisions the repositories and automates the grading workflow that already exists in `grading/swe-assignment-grading-guides/grading-toolkit/`. One instructor action — approving a report — records the grade, posts the feedback to the pull request, and shows it to the student.

Work still ahead is in [ROADMAP.md](ROADMAP.md).

- [The loop](#the-loop)
- [Running it](#running-it)
  - [Two GitHub Apps, one per environment](#two-github-apps-one-per-environment)
- [Scripts](#scripts)
- [Standing decisions](#standing-decisions)
- [Request path](#request-path)
- [Data model](#data-model)
  - [Migrations are authored with `migrate diff`, never `migrate dev`](#migrations-are-authored-with-migrate-diff-never-migrate-dev)
- [GitHub integration](#github-integration)
- [Test execution](#test-execution)
  - [Runner presets](#runner-presets)
  - [Which sections a run is evidence for](#which-sections-a-run-is-evidence-for)
  - [Getting the code in, with no credentials in the sandbox](#getting-the-code-in-with-no-credentials-in-the-sandbox)
  - [Protected paths: detect changes and overwrite them](#protected-paths-detect-changes-and-overwrite-them)
  - [`package.json` is merged, not restored](#packagejson-is-merged-not-restored)
  - [The sandbox run](#the-sandbox-run)
  - [Parsers and storage](#parsers-and-storage)
- [Report generation](#report-generation)
  - [One section, one call, one report](#one-section-one-call-one-report)
  - [Flags, and why a section has no tests](#flags-and-why-a-section-has-no-tests)
  - [What the cross-check may and may not assert](#what-the-cross-check-may-and-may-not-assert)
  - [Provider isolation](#provider-isolation)
  - [What a report costs](#what-a-report-costs)
  - [Grading assets](#grading-assets)
- [Review, approval, and delivery](#review-approval-and-delivery)
  - [Grading by hand](#grading-by-hand)
  - [Resubmission](#resubmission)
  - [Triage](#triage)
- [Interface](#interface)
- [What is verified, and how](#what-is-verified-and-how)
- [Deploying](#deploying)

---

## The loop

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

That is the loop for a repository assignment. A Google Doc or an uploaded file has no repository and no pull request, so the first three steps are replaced: accepting sends the student to Google's own prompt to take a copy, submitting is a button they press rather than an event to observe, and grading is an instructor writing the feedback into an empty draft. From approval onwards it is the same path — see [grading by hand](#grading-by-hand).

Two deliberate departures from GitHub Classroom's design:

- **No separate feedback branch.** The existing student ritual is preserved exactly as documented in `marcy-curriculum-docs/how-tos/working-with-assignments.md` and confirmed against real student repository history: students work on a `draft` branch, open a pull request from `draft` into `main`, and add the instructor as a reviewer. That pull request is the submission signal.
- **AI grading reports are part of the first working version, not a later addition.** The manual grading toolkit already does real evaluation work, so automating it is the point of the build. Reports always land as a draft for instructor review and are never posted automatically, so a person remains the last word on feedback quality.

Test execution and report generation are triggered by an instructor today, not by the webhook. Whether they should become automatic — and what runs them if they do — is [the one architectural decision still open](ROADMAP.md#phase-4-triggering-and-orchestration).

---

## Running it

**Stack:** Next.js 16 App Router on Vercel, Supabase PostgreSQL, Prisma 7 with `@prisma/adapter-pg`, tRPC v11, Tailwind v4 with Base UI, Supabase Auth with GitHub OAuth, GitHub App with Octokit, E2B for sandboxed test execution, and Claude `claude-opus-5` behind a provider interface.

You need a Supabase project, a GitHub App, an E2B key, an Anthropic key, and read access to the grading guides repository.

```sh
npm i                  # also runs prisma generate
npm run db:deploy      # apply migrations
npm run db:seed        # courses, rubrics, three assignments, enrollments
npm run dev            # localhost:3000
npm run dev:webhook    # in a second terminal — forwards smee.io to /api/webhooks/github
```

Copy `.env.example` to `.env.local`; it documents every variable and the traps behind several of them. In brief:

| Variable                                                                                         | Purpose                                                        |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                               | browser client                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                      | server-side admin operations                                   |
| `DATABASE_URL`, `DIRECT_URL`                                                                     | pooled connection for the app, direct for migrations           |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_INSTALLATION_ID` | the App that provisions repositories and receives webhooks     |
| `GITHUB_WEBHOOK_PROXY_URL`                                                                       | development only: the smee.io channel `dev:webhook` listens on |
| `E2B_API_KEY`                                                                                    | sandbox                                                        |
| `GRADING_LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GRADING_LLM_EFFORT`                | report generation                                              |
| `GRADING_ASSETS_REPO`, `GRADING_ASSETS_INSTALLATION_ID`                                          | the grading guides repository, read over the API in every environment |
| `GRADING_ASSETS_REF`                                                                             | optional: a branch to read the guides from instead of the default |

`SUPABASE_SERVICE_ROLE_KEY` does double duty: server-side admin operations, and the private bucket uploaded submissions live in. Nothing else can reach that bucket — see [handing in a file](#handing-in-a-file).

**`GRADING_ASSETS_REPO` and `GRADING_ASSETS_INSTALLATION_ID` are required everywhere**, development included — there is no local-clone mode. The installation has to be one belonging to *this* environment's App: the development and production Apps have separate installations, so an id that works for one returns 404 for the other.

### Two GitHub Apps, one per environment

A GitHub App has exactly one webhook URL, and GitHub cannot reach localhost. So there are two Apps — `marcy-lms-dev` pointing at a smee.io channel, and the production App pointing at the deployed domain — and switching environments means switching four environment variables, not editing App settings. Mirror the permissions and the `pull_request` subscription across both, and give them different webhook secrets. `npm run verify:app` checks all of it, including that the private key actually parses.

**smee.io answers GitHub with 200 whether or not anything is listening.** A push that arrives while `dev:webhook` is not running is recorded as a successful delivery and dropped. Redeliver it from the App's Advanced page rather than pushing again.

---

## Scripts

Verification scripts are re-runnable and are the fastest way to find out whether a change broke something. Two things about writing one: `tsx` compiles to CommonJS, which rejects top-level `await`, so the body goes in a `main()` or a `.then()`; and anything importing a module marked `server-only` needs `--conditions=react-server` in its npm script. Those that need no model or network are the first four.

| Script                        | What it does                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify:sandbox`      | Sandbox logic with no sandbox: path matching, tamper reporting, the `package.json` merge, the restore script, all three parsers |
| `npm run verify:grade`        | Grading logic with no model call: classification, rubric extraction, every cross-check rule, arithmetic                         |
| `npm run verify:approve`      | The approval guards, the delivery outcomes, the triage buckets, and a hand-graded assignment end to end, all through tRPC callers |
| `npm run verify:assets`       | That a deployed host can read its rubric — forces the local clone off and reads over the API                                    |
| `npm run verify:app`          | The GitHub App this environment is configured with: key, permissions, events, installation, and where its webhook points        |
| `npm run verify:e2b`          | Creates one real sandbox and checks the properties only a real sandbox shows                                                    |
| `npm run verify:resubmission` | The resubmission and re-approval loop end to end; `--post` also posts a real comment                                            |
| `npm run tests:run`           | Runs one real submission's tests from the terminal, where a sandbox failure is diagnosable                                      |
| `npm run grade`               | Generates one real report from the terminal                                                                                     |
| `npm run calibrate`           | Grades a sample submission and compares the result against the report an instructor wrote about it                              |
| `npm run approve`             | Approves a draft from the terminal                                                                                              |
| `npm run accept`              | Runs the accept flow from the terminal                                                                                          |
| `npm run db:diff`             | Generates a migration — see [Data model](#data-model), and never `migrate dev`                                                  |

---

## Standing decisions

These are settled and do not need revisiting.

- **The existing student workflow is the submission signal.** A pull request from `draft` into `main`, with the instructor added as a reviewer.
- **AI reports are always drafts.** Nothing posts to GitHub and nothing counts as graded until an instructor approves it in the application.
- **Files the student can modify are never trusted as grading input.** This excludes `scores/scores.json` and the `hooks/pre-commit` hook that writes it, which a student can disable locally; the `tests/` directory inside the student's own repository; and `classroom.yml`. Every grading fact is produced again on the server on every graded run.
- **The instructor's tests come from the assignment template repository**, fetched fresh on every run, because students never have write access there. The Jest tests in `tests/*.spec.js` live in the template; the grading toolkit and answer keys repository holds reference solutions only, which are used as language model context and never executed.
- **Grading is not run inside the student's repository via GitHub Actions.** That would mean trusting a workflow file living in territory the student can push to, which is the same problem as trusting their `tests/` directory. It is also why the accept flow removes the old `classroom.yml` from every generated repository.
- **Deterministic facts are computed by code and the model may only report them.** Test results, lint findings, and SQL comparisons are inputs the model must honor. A cross-check compares the model's claims against those facts.
- **Test results are one input to the rubric, not the score.**
- **One grading mode per assignment.** Every section is graded by the pipeline, or every section is graded by hand. A coding exercise with a hand-marked reflection is two assignments.
- **Each assignment stores an explicit `sections` mapping** rather than guessing file paths by convention. Real assignments do not use consistent `{from-scratch,debug,modify}.js` filenames, and one pull request can contain more than one gradable section.
- **The rubric taxonomy is fixed at the four sections that exist in `rubric.md` today**: `SHORT_RESPONSE`, `CODING_ALGORITHM_FLUENCY`, `CODING_SQL_FLUENCY`, and `CODING_FRONTEND`.
- **Completion is judged at 75 percent**, matching the Complete/Incomplete policy in `working-with-assignments.md`. Stored per assignment as `completionThreshold`.
- **Students join a course by invite link.** An instructor adds a student by name and email, the system generates an invite token, and the student's first GitHub login binds their identity to the enrollment. This avoids requiring the instructor to know each student's GitHub username in advance. (The token column exists; the flow that consumes it does not — see [ROADMAP.md](ROADMAP.md).)
- **GitHub's numeric user ID is the durable identity key**, because usernames are mutable.
- **An uploaded submission is readable only through a signed URL a procedure minted.** The bucket is private and carries no policies, so the browser cannot reach it at all.
- **The sandbox never holds a GitHub token.**
- **Verification happens against the `marcy-lms-test` organization**, never the production organization, until a flow is proven.

---

## Request path

Every read and write goes through tRPC into Prisma. Nothing queries PostgreSQL from the browser.

**Authorization lives in exactly one place: procedure code.** `trpc/init.ts` layers `protectedProcedure` (a session), `profileProcedure` (a profile row), `studentProcedure`, and `instructorProcedure` (`INSTRUCTOR` or `ADMIN`). Instructor procedures additionally check that the caller teaches *this* course rather than merely holding the role, because a role alone would let one cohort's instructor read another's.

Underneath, the database denies the browser outright:

```sql
REVOKE ALL ON TABLE public.<table> FROM anon, authenticated;
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;  -- no policies means no access
```

Supabase grants all permissions on new `public` tables to `anon` and `authenticated` by default. That is the vulnerability migration `20260730024911_tighten_profiles_grants` fixed for `profiles`, where a signed-in student could have set their own `role` to `ADMIN` from browser JavaScript. Row level security with zero policies denies everything, and Prisma connects as the table owner so it is unaffected. **Every new table needs its own statements** until a project-wide default privileges setting is decided. The tradeoff is that these tables cannot be read directly with supabase-js; adding policies later to a table students depend on is harder than including them from the start.

**`trpc/server.tsx` invokes procedures directly in-process** — no HTTP hop for server components, so `Date` values stay `Date` values. The browser link uses a relative URL, which is why no `APP_URL` variable exists.

**Cache Components is on** (`cacheComponents: true` in `next.config.ts`). A route may not read uncached data outside `<Suspense>`, and **that includes `params`**. Every dynamic page is therefore a static shell whose async child does the awaiting:

```tsx
export default function Page({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CourseView params={params} />
    </Suspense>
  );
}
```

`lib/supabase/proxy.ts` excludes `/api` from the authentication redirect, so GitHub's unauthenticated webhook request reaches the route instead of a 307 to `/auth/login`.

---

## Data model

`prisma/schema.prisma`, sixteen migrations applied. UUID primary keys, `timestamptz` timestamps, `created_at` and `updated_at` on every table, snake_case columns mapped from camelCase fields.

```
Profile ──1:1── auth.users
Course ──< CourseInstructor, Enrollment, Assignment
Assignment ──< Submission ──< GradingDraft ──< GradingDraftSection
                          └──< TestRun
Rubric ──< (referenced by assignment.sections[].rubricId)
```

Enums: `Role`, `EnrollmentStatus`, `RubricScaleType`, `SubmissionStatus`, `SalesforceSyncStatus`, `GradingDraftStatus`, `Confidence`, `TestRunStatus`, `TestRunTrigger`.

**`profiles`** carries the `Role` enum, `githubUsername`, a display name fallback, and `githubUserId BigInt? @unique`. The numeric ID is recorded by the `sync_github_identity` trigger from `auth.identities.provider_id`, guarded by a regular expression because that column is text and other providers put non-numeric values in it. Repository naming still uses the username, because that is the existing convention, which is why `submissions.repo_github_login_at_creation` exists.

**`assignments`** carries `kind`, `templateRepo`, `assignmentRepoName`, `githubOrg`, `completionThreshold`, `dueAt`, `distributedAt`, `runnerPreset`, `runnerConfig`, `templateRef`, `templateDocUrl`, `acceptedFileTypes`, `submissionInstructions`, and the `sections` JSON array. `@@unique([courseId, assignmentRepoName])` prevents two assignments in one course from generating colliding repository names.

**`kind` is what a student turns in**, and it decides how an assignment is distributed, what a submission consists of, and how feedback is delivered. `AssignmentKind` names three — `REPO`, `GOOGLE_DOC`, `FILE_UPLOAD` — and **all three can be created, published, submitted, and graded**. What differs is how far the pipeline reaches: a `REPO` assignment is distributed from a template, collected as a pull request, and graded by the model, while the other two are distributed as a link or as instructions, collected as [a link the student pastes or a file they upload](#handing-in-a-file), and [graded by an instructor typing the score and the feedback](#grading-by-hand). Reading a Google Doc's contents or an uploaded file and generating a report from it is a separate feature and needs instructor-authored rubrics.

The three GitHub columns are therefore **nullable, and required only when the kind is `REPO`** — enforced by the Zod schema rather than by the columns, because a column cannot express "required for one kind" and a `NOT NULL` would force a Google Doc assignment to invent a repository name. `templateDocUrl` is the mirror of that: required for `GOOGLE_DOC` and null otherwise, as `acceptedFileTypes` is for `FILE_UPLOAD` — non-empty for that kind and empty for the rest, empty rather than nullable because "which file types does a Google Doc assignment accept" has an answer and it is none. Two consequences worth knowing:

- **`@@unique([courseId, assignmentRepoName])` needed no change.** Postgres treats NULLs as distinct in a unique constraint, so it goes on constraining repository-backed assignments and ignores the rest.
- **Nothing reads those columns without asserting the kind first.** `repositorySource(assignment)` narrows all four in one place and throws otherwise, and it distinguishes three failures that must not be reported as one another. The first two are opposites: `NotRepositoryBackedError` means the kind works and simply has no repository, so the caller should not have asked, while `UnsupportedAssignmentKindError` means a kind nobody has built. `AssignmentConfigurationError` is the third and the only one an instructor can act on — a `REPO` row missing `githubOrg`, naming the column.

**Every section of an assignment is graded the same way**: all by the pipeline, or all by hand. A mix is refused by `assignmentSpecSchema`. It was expressible and nothing in the curriculum was ever one, and supporting it means a report covering some sections and not others — the generated draft carries only what the model wrote, so the assignment's own point total exceeds what approving can record, and a 30-point assignment releases as 20 out of 20. Two assignments is the answer, which is where one section per assignment is heading anyway. Several sections graded the same way stay ordinary: the checkpoint has two, both graded by the pipeline. The two non-repository kinds go further and accept only manual sections, because the pipeline's inputs are a pull request's changed files, the template's tests, and the paths `classifySections` matches, and a document has none of them.

**`lib/assignments/spec.ts` is what a valid assignment is** — one Zod definition, discriminated on `kind`, used by both the seed and (in future) the authoring procedures, so the seeded shape and the authored shape cannot drift. The assignment's `pointValue` is *returned* by `parseAssignmentSpec` rather than accepted, so no input can make the gradebook column disagree with the reports beneath it. `npm run verify:authoring` checks these rules as pure functions.

**`submissions`** is one row per assignment and student, carrying repository and pull request identity, `headSha`, `gradedHeadSha`, `submittedUrl` (a link to the work when there is no repository), the four `upload*` columns (the stored file, when the work is one — written together or all null, and never the same thing as a link), `submittedAt`, `isLate`, `lastActivityAt`, the final score fields, and three dormant Salesforce columns. `repoFullName` is unique, which is what lets the webhook match an event to a submission with one indexed lookup. The Salesforce columns exist so a future synchronization job can query `WHERE salesforce_sync_status = 'PENDING'` without a migration then; nothing writes them today.

**`grading_drafts`** is one row per grading run, keyed by submission and head SHA. A new push creates a new row and marks the previous one `SUPERSEDED` rather than overwriting it, so an instructor's in-progress review of an older run is never silently replaced. `modelMetadata` records the model id, prompt version, grading asset commit SHA, and all four token counts, and is **null on a draft an instructor wrote by hand** — which is what tells the two apart. `headSha` is nullable for the same reason: work with no commit has none, and every reader compares that column against the submission's own to decide whether a draft has been overtaken, so null compares as "no commit to be out of date against" rather than as a placeholder each of those comparisons would have to recognise. Approval details — `approvedAt`, `approvedBy`, `postedPrCommentId` — live here rather than on the submission, because each approval posts its own comment and the approved drafts of a submission in order are its feedback history.

**`grading_draft_sections`** are child rows, because one submission can have more than one graded section per run. The submission's final score on approval is the sum of a run's section scores.

**`test_runs`** is described under [test execution](#test-execution).

### Migrations are authored with `migrate diff`, never `migrate dev`

**A running dev server does not notice a regenerated client.** The Prisma client is generated to `lib/generated/prisma`, which is gitignored, so Next's watcher does not invalidate the compiled chunk holding it — a dev server started before a migration goes on serving the old client and reports the new column as `Unknown argument` or `Unknown field ... for select statement`, listing exactly the fields the schema had when it started. The fix is `rm -rf .next && npm run dev`, and `predev` runs `prisma generate` so a fresh start always has a current client. Worth recognising the shape of that error, because it points at the query rather than at the cause and reads like a broken select.

`prisma migrate dev` reports drift on this database and offers to reset both the `auth` and `public` schemas. The drift is not real: `tables.external` in `prisma.config.ts` excludes Supabase's auth *tables* from diffing, but there is no equivalent for enum *types*, so Supabase's own `aal_level`, `factor_type`, `one_time_token_type` and the rest always look like enums the migration history did not create. The full authoring recipe is at the bottom of `prisma.config.ts`; `npm run db:migrate` is a guard that points at it.

---

## GitHub integration

**The App.** Permissions: Administration (read and write, for repository generation and collaborator management), Contents (read and write, for template generation and reading files), Pull requests (read and write, for reading state and posting the approval comment), Members (write), Metadata (read). Webhook events: `pull_request` only — no `push` subscription, because the pull request is the submission signal.

**`lib/github/`** — `app-client.ts` mints installation tokens and provides a lazily-constructed Octokit instance. `repos.ts` holds `generateRepoFromTemplate`, `getRepo`, `addCollaborator`, and `removeClassroomWorkflow`. `prs.ts` holds `getPullRequestFiles` and `postOrUpdatePrComment`. `archives.ts` fetches repository tarballs. `files.ts` reads individual files. `webhook-verify.ts` verifies `X-Hub-Signature-256`.

**A GitHub App is installed per organization.** The grading guides are in `The-Marcy-Lab-School` while student repositories are in `marcy-lms-test`, and the installation covering one cannot read the other. `GRADING_ASSETS_INSTALLATION_ID` names the second installation; `scripts/list-installations.ts` prints the ids.

**`assignments.accept`** branches on the kind first, because what accepting *is* depends on it. For `GOOGLE_DOC` it records the submission as `ACCEPTED` and returns the copy prompt — `templateDocUrl` with its last path segment replaced by `/copy` — so the application creates nothing, holds no Google credentials, touches no student's Drive, and the copy belongs to the student from the moment Google makes it. The substitution is worth being honest about: it works because that is how Google Docs URLs are shaped, which is why `assignmentSpecSchema` checks the link's shape rather than accepting any URL — one it did not match is one the substitution would leave untouched, sending every student to the instructor's own document to edit in place. The alternative was Drive API integration with OAuth against every student's Google account, which is a great deal of machinery for something a link already does. `FILE_UPLOAD` has no accept at all: there is nothing to hand out, so the assignment stays `NOT_STARTED` until the student submits.

For `REPO` it creates the repository from the template as `{assignmentRepoName}-{github login}`, adds the student as a collaborator with push permission, adds every `course_instructors` row for that course as a collaborator, removes `classroom.yml`, records the repository identity on the submission, and sets the status to `ACCEPTED`. It is idempotent: if a previous attempt created the repository but its database write never landed, it reuses the existing repository rather than failing on the name collision. An instructor with no linked GitHub account is skipped with a warning rather than failing the whole operation.

**The webhook** (`app/api/webhooks/github/route.ts`) verifies the signature against the raw request body, answers `ping` so the App's settings page shows a green check, and returns 200 for events it does not handle so GitHub does not mark the webhook as failing. For `opened`, `reopened`, and `synchronize` targeting `main` it matches `repository.full_name` to a submission and applies this rule:

| Event                 | Current status          | Result        |
| --------------------- | ----------------------- | ------------- |
| `opened` / `reopened` | anything but graded     | `SUBMITTED`   |
| `opened` / `reopened` | `GRADED`, `RESUBMITTED` | `RESUBMITTED` |
| `synchronize`         | any                     | untouched     |

Keyed on the current status as well as the action, because the action alone is not enough: a student who closes a pull request and opens a new one fires `opened` a second time, and treating that as a first submission would reset a graded row. `synchronize` records the new commit and never changes the status, because a commit is not a claim of completion and a graded submission must not drop back into the queue because someone fixed a typo.

**`submissions.submitWork` is the same signal for a kind with no webhook.** A pull request opening is an event to observe; a document has nothing to observe, so a student pressing Submit is the declaration: it sets `SUBMITTED`, stamps `submittedAt`, stores `submittedUrl`, and computes `isLate` against `dueAt` exactly as the webhook does. Without it, finished hand-graded work would never enter triage and would read as never started. It refuses a `REPO` assignment outright, because accepting one there would let a student mark work submitted with no code to look at and would make the webhook a second authority on the same columns.

This rule costs something, and it is the right cost. A student who opens a pull request before starting appears in the queue with almost nothing in it — visible immediately, and the model remarks on it — whereas work that is never declared ready is silently never reviewed. Students need to be told that opening the pull request is the submission.

**The webhook awaits its work before responding**, rather than responding first and continuing in the background. The predecessor did the latter, with a comment noting it would need `waitUntil` on a runtime that stops executing after the response is sent. Vercel is exactly that kind of runtime. Awaiting is safe here because the work is one database update taking milliseconds, far inside GitHub's timeout of roughly 10 seconds.

---

## Test execution

The output is a stored, trustworthy answer to one question: **what do the instructor's tests say about this student's code at this commit?** No language model is involved and nothing is posted to GitHub. It is separate from report generation because the two fail in unrelated ways — a wrong score from a combined pipeline has two candidate causes, and a wrong score here has one.

`lib/sandbox/run-tests.ts` exports one function that takes a submission id and reads everything else itself:

```ts
export async function runTestsForSubmission(
  submissionId: string,
  opts: { trigger: TestRunTrigger },
): Promise<TestRun>
```

It does not know what invoked it, which is the whole accommodation made for the deferred orchestration decision. Today the callers are the instructor-only `testRuns.start` mutation, `npm run tests:run`, and report generation.

### Runner presets

Nothing about the runner may assume the technology this application is built with. Configuration lives in code as named presets (`lib/sandbox/presets.ts`), with `assignment.runnerConfig` as a shallow per-assignment override merged over the preset.

| Preset          | Template | Setup                             | Test command                                    | Parser        |
| --------------- | -------- | --------------------------------- | ----------------------------------------------- | ------------- |
| `node-jest`     | `base`   | `npm ci`, falling back to `npm i` | `npx jest --ci --json --outputFile=…`           | `jest-json`   |
| `node-vitest`   | `base`   | `npm ci`                          | `npx vitest run --reporter=json --outputFile=…` | `vitest-json` |
| `python-pytest` | `base`   | `pip install -r requirements.txt` | `pytest --json-report --json-report-file=…`     | `pytest-json` |
| `none`          | —        | —                                 | —                                               | —             |

**`none` is a real preset and the default.** Short response assignments have nothing to execute and frontend assignments have tests this build cannot run yet; together they are a large fraction of the program, so "no tests exist" is an ordinary state rather than an edge case. The default is `none` rather than `node-jest` so an unconfigured assignment produces no evidence instead of quietly producing the wrong evidence — a Python assignment silently running `npx jest` would look like a sandbox defect. `runTestsForSubmission` throws on `none` rather than writing an `ERRORED` row, and the interface shows "No automated tests for this assignment" instead of a disabled button.

React assignments with runnable tests use `node-jest` or `node-vitest` unchanged, because a component test is still a Node process. SQL is absent: it needs a template with PostgreSQL installed.

### Which sections a run is evidence for

A test run is per repository, because a suite executes once. Gradable sections are per pull request, and one pull request today can contain a section the suite covers alongside one it does not. So the mapping is explicit — each entry in `assignment.sections` may carry `evidence: "tests"` and a `testNamePattern`, and absence means no deterministic evidence for that section.

| Assignment           | `runnerPreset` | Section `evidence` | What report generation has to work with                     |
| -------------------- | -------------- | ------------------ | ----------------------------------------------------------- |
| Algorithm exercise   | `node-jest`    | `tests`            | Rubric and answer keys, plus verified pass and fail results |
| Short response       | `none`         | absent             | Rubric and answer keys only                                 |
| Blended pull request | `node-jest`    | per section        | Verified results for one section, not the other             |

This is transitional. The intended future state is **one section per assignment**, with coding and short response split into separate assignments over separate template repositories — `swe-1-4-loops` and `swe-1-4-loops-sr` — and therefore separate submissions. That state needs no new machinery, and this mechanism costs nothing in it: a one-entry `sections` array reads `evidence` from that entry through the identical code path. Meanwhile the blended assignments exist, and separating them is a curriculum change made assignment by assignment.

### Getting the code in, with no credentials in the sandbox

**The sandbox does not clone, and never holds a GitHub token.** The obvious implementation — `git clone https://x-access-token:$TOKEN@github.com/...` inside the sandbox — hands an *installation* token, which carries write access to every repository in the organization including every other student's, to the one process that is running code a student wrote. A `postinstall` script in a modified `package.json` reads the environment and sends it elsewhere, and the sandbox has network access during installation by definition.

Instead both trees are fetched on the server and uploaded as bytes: the student's code at the exact commit the webhook recorded (`tarball/{head_sha}`, not whatever the branch points at by the time the run starts) and the template's tests at a resolved commit SHA. Each archive goes in as a single `.tar.gz` write followed by `tar xzf --strip-components=1`, which is one upload rather than one call per file. Two archives are all that is needed; deciding what the student changed takes no third copy, because the pull request's own diff answers it.

Never pass `process.env` through to the sandbox. Its environment gets exactly what the tests need, which for these assignments is nothing.

### Protected paths: detect changes and overwrite them

Two obligations that are easy to conflate. The instructor needs to know a student edited the tests, and the score must be computed as if they had not.

A protected path is any path whose contents are grading infrastructure rather than student work: `tests/**`, `jest.config.*`, `vitest.config.*`, `package.json`, `package-lock.json`, `.eslintrc*`, `eslint.config.*`, `pytest.ini`, `conftest.py`, `requirements.txt`, `.github/workflows/**`. The template's version of every one is copied over the student tree before the suite runs, and files the student added inside a protected directory are removed.

**`scores/**` and `hooks/**` are deliberately absent**, though both are grading infrastructure by any plain reading. The mod-1 templates carry a `hooks/pre-commit` that runs the suite and then does `git add scores/scores.json`, so every student commit stages a rewritten scores file. Protecting that path would report a change on every mod-1 submission and route all of them to manual review — a finding against every student, produced by the assignment's own tooling doing what it was built to do. Leaving them unprotected costs nothing, because protecting them was never what made them untrustworthy: nothing reads `scores.json` as a grading signal, and nothing runs the hook. The runner invokes `npx jest` directly rather than `npm test`, the hook is installed by a `preinstall` script that `--ignore-scripts` skips, and git hooks do not execute in the sandbox at all.

**Detection comes from the pull request diff.** `GET /repos/{owner}/{repo}/pulls/{n}/files` returns every changed file with a `status` of `added`, `modified`, `removed`, or `renamed`, plus `previous_filename`. This is exactly the right comparison because of how student repositories are created: `POST /repos/{owner}/{repo}/generate` produces a repository whose default branch holds one commit containing the template's files as they were at that moment, and the student branches from there. The diff is measured against the template snapshot *that student received*.

It also cannot report an instructor's work as a student's. The diff never examines the current template, so a bug fixed mid-cohort does not appear in any student's pull request. Nothing about detection depends on which template commit is current, which is what allows the template to be corrected freely.

Two limits, both worth knowing. *Changes committed straight to the default branch are invisible to it* — a reporting gap and never a scoring gap, since the template's tests are restored regardless. It is cheaply detectable if wanted: a generated repository begins with exactly one commit, so two or more on the default branch means it was written to. Committing to `main` is not misconduct and many students do it, so that reads as "the diff is not the whole story here" rather than as a finding. And *it reports that `package.json` changed, not which keys changed* — key-level reporting comes from the merge below.

### `package.json` is merged, not restored

Wholesale restoration would protect the `test` script, which is otherwise trivially redirected to `echo ok`. But an assignment may deliberately ask students to add a dependency, and restoring the template's file would delete the addition and fail the run on a missing module.

| Keys                                                                                       | Rule                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `scripts`, `type`, inline runner configuration (`jest`, `vitest`, `mocha`, `eslintConfig`) | Merged key by key, **template wins every collision**. A student may add a `start` script; a student may not redefine `test`. |
| `dependencies`, `devDependencies`                                                          | Student additions are **kept**. The template wins on collision, so a version the assignment specifies cannot be replaced.    |

Any key the template asserts and the student overrode is recorded as `package.json#scripts.test` or similar, so the instructor sees the specific attempt rather than a whole-file difference.

Worth being precise about which assignments need `allowStudentDependencies: true`, because the obvious candidate is not one. `swe-1-3-node-modules` is entirely about `npm install`, yet it needs `false`: the student runs `npm init -y` and installs `prompt-sync` inside `src/madlib-challenge/`, a **nested** package. Only the root `package.json` is protected, so a nested one is ordinary student work. The flag governs the root file alone.

Two consequences when it is true:

- **The lockfile cannot be restored.** A restored `package-lock.json` no longer matches the merged `package.json`, and `npm ci` exists to fail in exactly that situation. So the student's lockfile is kept and setup uses `npm install`. When false, both files are restored wholesale and setup uses `npm ci`, which is faster and fully deterministic.
- **Arbitrary packages are downloaded, but their install scripts do not run.** Every preset installs with `--ignore-scripts`, so a `postinstall` never executes and package contents are inert until something imports them — by which point the network is revoked. This began as a necessity rather than a precaution: the templates install a git hook during setup with `cp hooks/pre-commit .git/hooks/`, and the sandbox receives a tarball rather than a clone, so with scripts enabled the install fails outright. It is also the stronger security position. The cost is that a dependency needing its install script to fetch a platform binary — esbuild, which Vitest depends on, or sharp — needs a custom E2B template with it already present.

### The sandbox run

The sequence matters, specifically where the network is revoked:

1. `Sandbox.create({ template, timeoutMs, allowInternetAccess: true })`
2. Upload and extract the student archive to `/work`, then overlay the template's protected paths
3. Run the setup commands **with** network access — installing requires it
4. **Revoke network access** with `sandbox.updateNetwork({ allowInternetAccess: false })`
5. Run the test command with a hard timeout, capturing stdout, stderr, and the exit code
6. Read `/results/*.json` back out
7. `sandbox.kill()` in a `finally` block — a leaked sandbox bills until its own timeout expires

Revoking the network before the tests run buys two things. Results become reproducible, because a test that reaches an outside service returns a different answer when that service is slow, and a grade that changes without the code changing is not a grade. And student code loses its channel to the outside world for the part of the run where student code is what executes.

The SDK has no per-command wall clock limit, so the test command's hard limit is applied with `timeout --kill-after=10s` inside the sandbox. That puts the limit where the process runs and produces exit code 124, which is what distinguishes a student's infinite loop from a suite that merely failed. The sandbox's own lifetime is set well above the command limit, because a sandbox that expired first would make an infinite loop indistinguishable from an infrastructure failure.

Measured cost: 30 to 40 seconds a run, of which setup is 6 to 17 depending on the dependency set. Removing the install step — by building custom E2B templates with dependencies already present, which works because the template is built in the same Linux environment the sandbox runs — is the largest speed improvement available and would let `allowInternetAccess: false` be set at creation and never changed. Installing on the server and uploading `node_modules` instead does *not* work: npm resolves optional dependencies by platform and architecture, native modules compile against one Node ABI, and Python wheels are platform-specific by design.

**A test must assert something the archive can carry.** The runner receives a git archive, so a test can only check what git tracks. `swe-1-3-node-modules` asserted that `src/madlib-challenge/node_modules/prompt-sync` existed on disk; since `node_modules/` is gitignored, that check could only pass on the machine where the student ran `npm install`, so a correct submission lost the point everywhere else — in this sandbox, in any clone, and in any CI job. The assertion was removed from the template rather than teaching the runner to install nested packages, and the reason generalizes: **a per-assignment runner override fixes one assignment, while fixing the test fixes it everywhere the tests run.**

### Parsers and storage

One parser per result format, all returning the same normalized shape, so everything downstream is runner-independent. **Parse failure is not test failure**: a suite that crashes before writing its JSON is an `ERRORED` run rather than a zero score. Conflating the two is how a student receives a zero for an infrastructure problem.

Deterministic results live in `test_runs` rather than on `grading_drafts`, because they outlive any one draft: re-generating a report against the same commit does not rerun the tests, and the cross-check reads this table as its source of truth. Rows are never updated in place after completion and reruns append, so the history of a submission stays legible. `tamperedPaths` holds the protected paths the pull request changes — a finding an instructor must see, not an automatic penalty. `passRate` is `passed / total` and is **not** the score and never compared against `completionThreshold`.

**A submission with no rows at all is normal, not an error.** Nothing downstream may treat the absence of a row as a failure, a pending state, or a zero — which is why there is no `latestTestRunId` pointer that would read as "missing" when empty. Three states are distinct and every consumer has to tell them apart:

| State                             | How it is represented                        |
| --------------------------------- | -------------------------------------------- |
| This assignment has no tests      | No `test_runs` rows; `runnerPreset = "none"` |
| Tests exist and have not been run | No rows; `runnerPreset` is something else    |
| Tests ran and failed              | A `COMPLETED` row with `testsFailed > 0`     |

---

## Report generation

One schema-constrained language model call per gradable section, given fixed inputs. `lib/grade/generate-report.ts` loads the submission and assignment, **runs the tests first if the assignment has a suite and no completed run exists at this commit**, fetches the answer keys named in `assignment.sections`, classifies which sections the pull request contains, generates, cross-checks, and records the draft.

**Section classification is deterministic code, not a model judgment.** `agent-rules.md`'s file-path rules are an ordered classifier over the pull request's changed paths: `short-response.md` means short response; `src/*.js` with Jest in `package.json` means algorithm; `.sql` without Jest means SQL; HTML, CSS, JSX, and server files mean frontend. The result is intersected against the assignment's `sections` mapping. A section expected but absent is reported as not submitted; a section present but unexpected routes to manual review.

**Not an agentic tool-use loop.** Every discovery and side-effecting step from `agent-rules.md` has already happened deterministically, so what remains is judgment over fixed inputs — more reliable and cheaper as a single well-stocked call.

- **System prompt:** `agent-rules.md`'s tone and formatting rules — second person, two-beat summary, impact before root cause, verbatim checklist copying, half-credit nesting — plus the matching `rubric.md` section and `sample-*-report.md` template.
- **User content:** the assignment README, which carries the verbatim frontend and SQL checklists; the relevant answer key files, labeled as reference and never shown to the student; the student's changed files; and the verified results from the `test_run`.
- **Output:** schema-constrained JSON carrying the rendered markdown plus `{scoreEarned, scorePossible, rubricItems[], flags[], instructorNotes[], confidence, submissionProcessNote, testClaims[]}`.

### What a student commits, and what reaches the model

The student's files come from the pull request's own diff, so a file git was told to ignore can only appear because the student committed it — which happens. `partitionForPrompt` in `lib/grade/classify.ts` withholds those paths, and it runs on the whole changed-path list before anything reads it, so classification and the prompt cannot disagree about which paths are student work. A committed `dist/bundle.js` should not make a frontend section read as present any more than it should be sent.

Three concerns land on this one filter, and the third is what makes it more than an optimization:

- **Disclosure.** A committed `.env` would put the student's own secrets into a third party's logs. Nothing about that is recoverable afterwards, which is why the filter is enforced rather than advisory.
- **Context.** A committed `node_modules` can exceed the context window on its own, which fails the run outright rather than merely making it expensive.
- **Cost.** Every file sent is billed as input, and a dependency tree is many files.

What is withheld: environment files, credentials and private keys, dependency trees, lockfiles, build output and minified bundles, coverage output, cache directories, logs, editor and system files, and compiled artifacts.

**It is a fixed list, and deliberately not the repository's own `.gitignore`.** Reading that file looks more principled and is unsafe. Templates add project-specific lines, and one of them is `server/` in a backend project, with the comment "students will build the entire backend from scratch" — those files are the deliverable, and the classifier reads `server/` as frontend work. Honoring the template's ignore file would send an empty prompt and grade the section as not submitted, which is the confident wrong grade the filter exists to prevent. The student's own copy is no better, since it inherits the same line. A gitignored path that reached the diff is either junk or the whole submission, and no ignore file tells those apart. So the test for adding an entry is that no assignment could ever ask a student to author it, which is stricter than "the templates ignore it".

Every standard Node ignore line is already covered by such a list. Reading the file would add only the project-specific lines, which are precisely the dangerous ones.

What was withheld is recorded on the draft as `modelMetadata.excludedFromPrompt` — a count, a breakdown by reason, and up to twenty example paths rather than the raw list, since a committed dependency tree is thousands of paths — and the review screen says so above the report. Recording it and showing nobody would mean a report written without files the student did commit reads exactly like one written with them.

**The notice distinguishes two things that arrive through one mechanism.** A committed dependency tree or build directory is ordinary, is not misconduct, and needs only the explanation that those files are not in the report. A committed environment file or private key needs an action from the student: deleting the file does not remove it from the repository's history, so the credential itself has to be replaced, and nobody but the student can do that. Neither gates approval.

### One section, one call, one report

An assignment with two gradable sections produces two model calls and two reports, each against its own rubric, answer keys, and point value. A checkpoint's short response and its coding work are not commensurable, and nothing tries to combine them into a single narrative.

**Point values live on the section, not the assignment.** `assignments.pointValue` is the sum of its sections and exists for the gradebook; the number sent to the model is always the section's own. A section reaching the model without one is refused rather than defaulted — told nothing about the maximum, a model invents one (an early run scored a 13-test assignment out of 40), and a plausible score against an invented denominator cannot be distinguished downstream from a real one.

### Flags, and why a section has no tests

`flags` is a closed vocabulary of short codes, because the same column carries codes the pipeline writes itself and the interface renders every entry as a badge. Prose belongs in `instructorNotes`. Each flag records **why a student lost points** and corresponds to a bullet in a `rubric.md` score band, so it traces back to the written criterion behind it. A section that earned full marks carries none.

| Writing quality                                             | Technical score                                        |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `MECHANICAL` — spelling and grammar                         | `INCOMPLETE` — parts of the question unanswered        |
| `CLARITY` — vague, contradictory, or needlessly complex     | `UNDERSTANDING` — gaps, inaccuracies, misunderstanding |
| `MARKDOWN` — does not render, or unused where it would help | `TERMINOLOGY` — missing or misused                     |
| `STRUCTURE` — unclear structure, poor flow                  |                                                        |

**No flag text ever appears in the report a student reads.** Approving a draft posts its markdown to the pull request, so a `FLAG:` line left in the text is an internal label delivered to a student with no way to take it back. The prompt forbids it and the cross-check holds any draft whose text contains one — guidance alone is not a guarantee for the one leak that cannot be undone. The student is still told, in the report's own voice, that their writing needs proofreading; what they never see is the code.

Test evidence gets four outcomes rather than two, because "this assignment has no suite" and "this assignment has a suite and none of it ran" are opposite situations:

| Flag                 | Meaning                                                 |          |
| -------------------- | ------------------------------------------------------- | -------- |
| `TEST_EVIDENCE`      | Claims were checked against a real run                  | ordinary |
| `NO_TESTS_EXPECTED`  | The section declares no `evidence: "tests"`             | ordinary |
| `TEST_RUN_MISSING`   | Tests expected, no completed run at this commit         | a fault  |
| `TEST_MATCH_MISSING` | Tests ran, the section's `testNamePattern` matched none | a fault  |

**`instructorNotes`** is free text for the instructor that a student never sees, because the two audiences need different things. "The point value I was given does not divide evenly into this README's checklist" is exactly what an instructor needs before approving a score and exactly what a student should not read. It earns its place on real submissions: grading the checkpoint produced "the README checklist contains 25 items, but this section was specified as 15 points, so I weighted every item at 0.6", a genuine configuration problem no deterministic check would have found; grading `swe-1-4-loops` produced "the student's three files are byte-for-byte identical to the reference solution", a plagiarism signal the pipeline has no other way to express.

**Whole numbers, and where the hesitation goes.** Rubric scales are fixed bands with written descriptions. A 1.5 corresponds to no description and cannot be explained to a student, so the prompt requires whole numbers and directs a genuine boundary case into `instructorNotes` naming both bands and the reason for choosing one. The effect is visible in calibration: asked only for a number the model returned 1.5 with a note that the work sat between bands; asked for a band it returned 1 with a note quoting the rubric clause that decided it. The second can be reviewed; the first hides the judgment inside an average.

### What the cross-check may and may not assert

Test results are a fact the model must not contradict, and one rubric input among several. They are not the score, so the check is asymmetric:

| Situation                                                       | Verdict                                          |
| --------------------------------------------------------------- | ------------------------------------------------ |
| Model states a test passed that the run records as failed       | Contradiction → manual review                    |
| Model awards the "passes all tests" criterion when tests failed | Contradiction → manual review                    |
| Model withholds points despite all tests passing                | **Legitimate** — hardcoding, inefficiency, style |
| Model's `rubricItems` do not sum to its reported score          | Arithmetic error → manual review                 |

The third row is the one that matters most and the one a naive implementation gets wrong. A check written as "claimed score must match pass rate" would flag exactly the judgment the model is there to make: a student who returns hardcoded values to satisfy the assertions passes every test and has demonstrated nothing. So the check compares the model's *claims about test outcomes* against the run, and never its score against the pass rate. The arithmetic verification therefore applies to every section, tested or not — it is the only automatic check available when a section has no run.

The cross-check operates per section, because within one submission some sections are bound by test evidence and some are not. A non-empty `tamperedPaths` routes to manual review regardless of score. `grading_draft_sections` records whether a run informed it, so the interface can show which sections had their claims verified and which rest entirely on the model's reading of the code — presenting both with the same authority would be misleading.

**Low confidence does not hold a draft back.** It is reported as a badge. This is only sound because nothing is ever sent without approval: a finding that holds a draft has to mean the instructor cannot trust what the text says, and low confidence on untested work is the ordinary condition of a large fraction of this program's assignments. `findingGatesApproval` in `lib/grade/cross-check.ts` is where that list lives, and reversing the decision means moving `LOW_CONFIDENCE` out of the non-gating set.

Everything else produces manual review with the specific reason attached, never a fabricated score: fetch or authentication failure, a runner crash as opposed to failing tests, no section type matched, an assignment with no `sections` mapping, or a model call or schema validation failure.

### Provider isolation

One interface, two implementations. Pipeline code calls `getReportGenerator()` and never references a vendor; `GRADING_LLM_PROVIDER=claude|groq` selects. The contract carries a Zod schema rather than a JSON Schema document, because each provider has a better path than a hand-rolled validator: Claude's SDK derives the response format and parses through it with `messages.parse()` and `zodOutputFormat()`, and Groq needs a plain JSON Schema in its request body, which the same schema derives.

**Claude on `claude-opus-5` is the provider in use.** Groq's `openai/gpt-oss-120b` with strict `json_schema` remains implemented and is the only Groq model and mode combination confirmed to guarantee schema-conformant output, but its free tier caps requests at 8,000 tokens per minute and a frontend prompt does not fit — those carry several answer keys and a verbatim README checklist, about 12,400 tokens by Groq's count, rejected with a 413.

Two differences the interface must not hide:

- **Claude's JSON schema support rejects numeric constraints** such as `minimum` and `maximum`, rejects string length limits, and requires `additionalProperties: false`. So the schema cannot express them, and the arithmetic verification in the cross-check remains necessary — schema validation on either provider does not make it redundant.
- **Claude reports cached tokens separately from `promptTokens`, not as a subset.** A run that writes the cache shows zero reads and an unchanged prompt count, indistinguishable from caching being broken unless the write count is also recorded. All four counts go into `modelMetadata`.

### What a report costs

Measured on Claude, one section per run, normalized to a cache hit so the only variable is `effort`:

| Section            | Effort | Uncached input | Cached | Output | Cost   | Wall clock |
| ------------------ | ------ | -------------- | ------ | ------ | ------ | ---------- |
| `coding_algorithm` | high   | 5,207          | 5,624  | 2,646  | $0.095 | 31s        |
| `coding_algorithm` | medium | 5,207          | 5,624  | 2,365  | $0.088 | 27s        |
| `coding_frontend`  | high   | 12,392         | 7,590  | 3,396  | $0.151 | 40s        |
| `coding_frontend`  | medium | 12,392         | 7,590  | 2,631  | $0.132 | 29s        |

Output is roughly 60 percent of the cost, because thinking is billed as output. `GRADING_LLM_EFFORT` therefore moves total cost more than prompt caching or model tier do, and it is left at `high`: the gap is 7 to 14 percent, which does not buy enough to trade grading quality for. At `medium`, a cohort of 25 costs roughly $2.20 for an algorithm assignment and $3.60 for a frontend one.

**Caching works, and its window is short.** A repeated request read 7,590 tokens and wrote none; a later request for the same prompt wrote all 7,590 again, because the default cache lifetime is five minutes. Caching pays when a cohort is graded in one burst and pays nothing when grading is spread across an evening — an input to the orchestration decision, not a detail. Only the system prompt is cacheable today, which is 38 percent of the frontend input.

### Grading assets

`grading-toolkit/` and `answer-keys/` come from **one source in every environment: the private repository, read through the GitHub API.** Individual files rather than the repository archive — the archive is 23MB and over 20 seconds, almost all of it images grading never reads, while a run needs the rubric, the agent rules, one sample report, and a handful of answer keys, roughly 200ms each and fetched in parallel.

There was a second source: a local clone, selected by `GRADING_ASSETS_PATH`, so that `rubric.md` could be edited and re-graded without pushing. It was removed deliberately. Every source of assets after this one is external — rubrics for non-repository assignments will come from Google Drive — so reading from disk was never going to generalize, and maintaining two implementations of every read and directory listing carried a standing risk worse than the inconvenience it saved: an assignment authored against one listing and graded against another, with each half looking correct on its own. A leftover `GRADING_ASSETS_PATH` now fails loudly rather than being ignored, because silently ignoring it would mean editing the rubric and seeing no change.

The cost is real and worth stating: tuning the rubric means committing and pushing, then waiting up to a minute. Push to a branch and set `GRADING_ASSETS_REF` to iterate without touching the default branch.

Files are read at a resolved commit SHA, never at a branch name, so a run taking ninety seconds cannot read half its rubric from before a push and half from after. Content is cached under `sha:path` with no expiry, which is safe because the content of a path at a given commit cannot change. The branch head is re-resolved every 60 seconds, so a pushed rubric change takes effect within a minute without a webhook. The commit SHA is recorded in `modelMetadata`, so a report traces back to the exact rubric that produced it.

---

## Review, approval, and delivery

```
NOT_STARTED → ACCEPTED → SUBMITTED → GRADED → RESUBMITTED
                                                   │
                                      ┌────────────┘
                                      ▼
                               back to SUBMITTED
```

`submission.status` is the state of the *submission*, not of a grading run. The run's state lives on the draft (`GENERATING`, `READY`, `NEEDS_MANUAL_REVIEW`, `FAILED`, `SUPERSEDED`, `APPROVED`), and only approval moves a submission to `GRADED`. Keeping one authority for each beats two that can drift.

**The review screen** renders each `grading_draft_section` — markdown plus its score — with a manual-review banner carrying the specific reason when the pipeline could not produce a confident draft. Never a silently wrong score.

**Every section's text and score is editable in place**, and an edit is stored in `editedReportMarkdown` and `editedScoreEarned` **alongside** the model's original rather than over it, so what the model proposed stays recoverable. An edit is written as null when it matches the model's value, which is how discarding one works. Note the two different comparisons this needs: which sections are dirty is measured against the *effective* values, while the null-or-value decision is measured against the *model's*. Everything a student reads resolves to the edited value where one exists — the pull request comment and the feedback screen both.

**Approve** is one transaction that fans everything out:

1. Copy the effective markdown and scores to the submission's `feedbackMarkdown`, `finalScore`, and `finalScorePossible`; compute `isComplete` against `completionThreshold`; record `gradedBy`, `gradedAt`, and `gradedHeadSha`; set the status to `GRADED`.
2. Post a pull request comment. Best-effort and retryable, so a brief GitHub outage does not block the grade — `grading-drafts.retryComment` sends it later, and an approval whose comment never posted is a distinct triage bucket rather than an invisible failure.
3. Set `salesforceSyncStatus` to `PENDING`, inert until that phase exists.

**Delivery has three outcomes, not two**: `posted`, `failed`, and `not_applicable`. `postedPrCommentId` being null means two opposite things — a comment that failed to send, and one there was never anywhere to send — so `deliveryOutcome` in `lib/grade/approve.ts` names which, and every reader branches on the name. Collapsing them reported an impossibility as a fault in three places at once: a toast saying the comment did not post, a retry button that could never succeed, and a triage entry nothing could clear. The Prisma predicate that finds undelivered approvals lives beside that function as `undeliveredApprovalWhere`, and takes each caller's scope as an argument so the deliverability condition cannot be dropped at one of its four call sites — one decides what a loaded row means and the other decides which rows come back, and a difference between them would be invisible from either side.

A derived outcome rather than a column has one edge worth knowing: a repository assignment hand-graded before the student opens a pull request reads as `not_applicable` until they open one, and as `failed` afterwards. There is somewhere to post by then, so that is arguably right — but it is a behaviour a stored column would not have, and recording the outcome at approval time is the alternative if it ever reads as wrong.

**A section with no score or no feedback is refused** rather than released as a zero. That is what a hand-written draft starts as, and the two are indistinguishable once written.

### Handing in a file

A `FILE_UPLOAD` assignment declares what it accepts as `assignments.acceptedFileTypes` — keys of `UPLOAD_FILE_TYPES` in `lib/uploads/file-types.ts`, at least one, refused by the schema when empty. Keys rather than extensions or MIME types, and a set of checkboxes rather than a text field, for the reason the runner preset is a select: a typo'd MIME type is not a validation error an instructor sees, it is a student being told their correct file is the wrong kind, on the due date. The types belong on the assignment because "one PDF" and "a screenshot of your finished page" are different assignments; the 25MB limit is global, because no assignment has a reason to want a different one.

**The bucket is private and has no policies for `anon` or `authenticated`, so the browser cannot reach it at all.** Every access is a signed URL, valid for five minutes, minted by `submissions.uploadUrl` for a caller it authorized — the student who owns the submission, or an instructor who teaches that course. This is the same posture the database has, and it is deliberately stronger than per-student storage policies: a policy is a second description of who may see what, and two descriptions can disagree. Here there is one, and it is procedure code. `verify:uploads` checks that the unsigned public URL for a stored object does not work and that a forged token does not either, because if that check is wrong nothing is behind it.

**Uploading is one request to `POST /api/submissions/upload`, not a signed upload URL.** The alternative — mint a URL, let the browser send bytes straight to storage, then call back to record it — has a window where the object exists and the submission was never marked handed in. A student who closed the tab in that window has work in a bucket that nothing points at and no instructor will ever see, which is the exact failure `submitWork` exists to prevent. One request also means our own code checks the size and the type before a byte is stored.

A route handler is a second entry point, and a second entry point is how an authorization rule ends up with two versions that drift. So the rule is `assertCanHandIn` in `lib/uploads/submit.ts`, called by the route *and* by `submissions.submitWork`, and it throws `TRPCError` either way — the procedure propagates it and the route maps it to a status code. One error vocabulary rather than one per transport.

**The upload is the submission, so `submitWork` refuses this kind** exactly as it refuses `REPO`. Storing the file is the act of handing in; letting the link procedure mark one submitted would put work in the queue with nothing to open.

Three details worth knowing:

- **The order of writes cannot produce a submission that reads as handed in with nothing behind it.** The row is ensured first without touching its status — the path is built from its id, and a `FILE_UPLOAD` assignment has no Accept so there is often no row at all — then the bytes are stored, then the status and the four columns are written together. A failure partway leaves a row that reads as not started, which is true, or unreferenced bytes, which is harmless. The reverse order would put work in the queue with nothing to open.
- **The check is by extension, and the browser's MIME type is not consulted.** Browsers disagree about the same file — a `.docx` arrives as its official type, as `application/octet-stream`, or as nothing, depending on the operating system and whether Word is installed — so a MIME check refuses correct work on some students' machines and not others. The extension is what the student sees and what the instructor opens. The last dot decides, so `resume.pdf.exe` is an executable. The bucket's own MIME allow-list sits behind this as a backstop, and is generous where the route is exact.
- **The student's filename is never part of the stored path**, which is `{submissionId}/{uuid}{ext}`. It is kept in `upload_filename` for what the instructor sees and what their browser calls the download. A generated segment rather than a fixed name, so re-uploading writes a new object instead of overwriting one an instructor may be part-way through reading — and the previous object is left in place rather than deleted, on the same reasoning that leaves student repositories alone when an assignment is removed.

The size limit is enforced in three places and only one is a guarantee: the bucket refuses a larger object, the route refuses it before storing anything, and the browser refuses it before spending a student's upload on a request that cannot succeed. The last two exist so the failure is fast and legible.

### Grading by hand

A `GOOGLE_DOC` or `FILE_UPLOAD` assignment, or any assignment whose sections are all manual, is graded by an instructor writing the feedback and the score. The realization that made this small: **a manual grade is the existing review screen with an empty draft, not a new screen.** `gradingDrafts.startManual` writes a `GradingDraft` with null `modelMetadata` and one blank section per declared section, carrying the section's own point value so the total is not typed twice. Everything after that is unchanged — the same editor, the same approval, the same gradebook, the same student feedback screen, and the same feedback history across resubmissions.

Pressing it twice returns the existing draft rather than opening a second one, because two blank drafts for one submission would leave an instructor choosing between identical empty forms, one of which their writing is not in.

The screen offers one action or the other and never both: `manualOnly` comes from the server, from the same reading of the assignment that put the submission in its triage bucket. So there is no "generate a report" button on work nothing can generate one for, and no "grade again" beside a draft an instructor wrote themselves.

The student's page reads the graded columns directly, so feedback appears on approval with no publish step — and appears even when the comment failed to post.

Three guards refuse rather than warn, and they live in the procedure because a guard that lives only in a dialog is decoration: approving the same draft twice, approving a superseded draft, and a score stated in the report text that disagrees with the recorded score. That last check is `statedScoreInText` in `lib/grade/report-text.ts`, which is free of database and network imports specifically so the browser's warning and the server's refusal are literally the same function.

**A second approval posts a new comment rather than editing the first.** Feedback on a resubmission describes different work, and the two read in order are the record of what the student changed.

### Resubmission

An instructor needs to know when a student has revised work that was already graded; a student needs to commit freely without each commit reading as a request for re-review. Two mechanisms, because those are two requirements.

**Newer code exists** is a comparison of two columns: `headSha !== gradedHeadSha`. It needs no API call and is true the instant a push lands. Displayed as a plain fact — "revised since grading".

**The student is ready** is a deliberate act: a button that sets `RESUBMITTED`. `SUBMITTED` cannot serve, because it does not distinguish a first submission from a revision and an instructor working through a list needs to see which is which. A GitHub-native alternative exists — draft pull requests marked ready, which fires `pull_request.ready_for_review` — and costs no interface at all, but it depends on the draft pull request habit holding, and a student who opens an ordinary pull request never produces the event.

Together they produce information neither gives alone: a submission with newer code and no readiness declaration is a student still working, or one who finished and forgot to say so.

### Triage

`lib/grade/triage.ts` holds one function that derives a bucket from the submission status, its draft, whether that draft is stale, and whether an approval failed to deliver. Triage, the queue filter, and the gradebook cells all call it, so the three cannot disagree about what is outstanding.

| Bucket                | Meaning                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `needs_report`        | Submitted, and no report has been generated                                 |
| `needs_manual_grade`  | Submitted on an assignment the pipeline cannot grade; waiting on a person    |
| `draft_ready`         | A report is waiting to be reviewed                                          |
| `needs_manual_review` | The cross-check found something that gates approval                         |
| `grading_failed`      | The run failed before producing a report — infrastructure, not a zero       |
| `comment_not_posted`  | Approved, there is a pull request, and the comment never reached it          |
| `generating`          | A run is in flight; not counted as outstanding                              |

The last two are the pair that has to be kept apart from their neighbours. `needs_manual_grade` is not `needs_report` because the action differs and only one of them exists — `needs_report` offers a button that must not appear on an assignment nothing can generate a report for — and it is not `needs_manual_review`, which is a report that exists and cannot be trusted. And `comment_not_posted` requires a pull request to have existed: without that condition every finished hand-graded submission sits there permanently, in triage, the queue, and the gradebook alike, with nothing an instructor can do to clear it.

**Triage counts work the instructor has not done, which includes work not yet started.** Reports are generated *by* an instructor, so a submission with no draft at all is the first bucket rather than a footnote — an empty queue has to mean caught up, not merely nothing generated.

---

## Interface

`app/(shell)/` holds the signed-in application; `app/auth/` holds the Supabase auth screens.

| Route                                      | Screen                                                               |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `/courses`                                 | A student's courses                                                  |
| `/courses/[courseId]`                      | Assignments, status, and feedback for one course                     |
| `/instructor`                              | Triage across every course the instructor teaches                    |
| `/instructor/courses/[courseId]`           | One course: assignments and roster                                   |
| `/instructor/courses/[courseId]/gradebook` | Assignments × roster, each cell carrying its triage bucket           |
| `/instructor/assignments/[assignmentId]`   | The grading queue and the review surface, `?submission=` to open one |

`lib/links.ts` is the one place these are constructed, so the triage list and the gradebook cells agree on where a submission opens.

Two routes outside that table: `/api/webhooks/github` and `/api/submissions/upload`. Both exist because a browser form or GitHub's own request cannot go through tRPC — see [handing in a file](#handing-in-a-file) for why the upload does not, and why its authorization is still procedure code.

Base UI rather than Radix: `render={<Link/>}` replaces `asChild`, `group-data-[panel-open]` styles an open Collapsible trigger, and `Select`'s `onValueChange` passes `string | null` — null when a select is cleared, which most of these never do, so the handlers coerce.

**`lib/status.ts` is the single source of presentation truth** — status vocabulary, tone classes, flag copy, relative dates, module ordering. `formatRelative(date, now)` takes the reference instant as an argument rather than reading the clock, and dates render in a fixed school timezone.

**The student vocabulary is narrower than the instructor's on purpose.** `SUBMITTED`, `DRAFT_READY`, `NEEDS_MANUAL_REVIEW`, and `GRADING_FAILED` all read as "Submitted" to a student. A student has no use for the state of a grading run, and "grading failed" invites a question no student can answer.

The screens came from a Vercel V0 pass once the data shapes were settled; everything before that was deliberately minimal pages that exercised the procedures.

---

## What is verified, and how

Every claim below was checked against real repositories in the `marcy-lms-test` organization, not asserted from reading the code. The re-runnable parts are the `verify:` scripts in [Scripts](#scripts); what remains outstanding is in [ROADMAP.md](ROADMAP.md).

**Provisioning and the webhook.** `accept` creates a repository from the template with the student and instructors as collaborators and no `classroom.yml`; run a second time it reuses the repository rather than failing. A real pull request from `draft` into `main` fires the webhook, the signature verifies, and the submission becomes `SUBMITTED` with `isLate` computed. An invalid signature is rejected with a 401.

**The sandbox, on `swe-1-4-loops-benspector3` and `swe-1-3-node-modules-benspector3`.**

- A passing submission scores 13 of 13; the template's stub code scores 1 of 13 with every failure name and message stored.
- **Editing a test to hide broken code does not work.** `loop5to10` was broken and its assertion edited from 6 calls to 5 to match. The run reports `Expected number of calls: 6` — the template's assertion — so the result is 12 of 13 and `tests/from-scratch.spec.js` appears in `tamperedPaths`. The attempt cost a point rather than winning one.
- A test file the student adds never executes: `tests/cheat.spec.js` with two free-passing tests was reported as `added` and the total stayed at 13.
- **An instructor's template fix is never reported as a student's edit.** The assertion was corrected after the student had accepted: the corrected test ran, `templateCommitSha` moved, the result changed from 12 of 13 to 13 of 13, and `tamperedPaths` stayed empty.
- Renaming a suite out of `tests/` neither hides it nor escapes notice — reported against the protected source path, and all 13 tests still ran.
- A routine mod-1 commit, which stages a rewritten `scores/scores.json`, reports nothing.
- A broken `testCommand` is `ERRORED` with null counts, not a zero. An assignment with no tests throws rather than recording a failure.
- **Nothing from `process.env` reaches the sandbox**, checked by name for both GitHub key sets, the E2B key, the Supabase service role key, both database URLs, the Groq key, and a canary variable set immediately before creation.
- The network works before revocation and not after. An endless command is killed with exit code 124 and reported `TIMED_OUT`. No sandbox is left running, confirmed through `Sandbox.list`.
- A second assignment grades correctly with no per-assignment configuration, nested npm package and all.

**Grading.** `verify:grade` is 101 checks with no model call, including that every path a real submission is made of survives the prompt filter while a committed `.env`, dependency tree, or build directory does not — a false positive there would grade a section against a prompt with the student's work missing from it. The filter was also run over all 10,507 files in the curriculum repository, which is the check that matters more than any hand-written case: every path it withheld was genuinely a build artifact, a dependency tree, a committed `.env`, or editor litter, and no directory named `build` or `out` anywhere in the curriculum holds authored work. On real submissions: `swe-1-4-loops` with every test passing scores 30/30 at high confidence; a submission that broke its code and edited the assertion scored 12/13 against the template's own assertion; full credit claimed alongside a failing test is caught; claiming a failed test passed is caught in both the bare and `Suite › name` forms; a submission that passes every test with hardcoded return values is **not** flagged merely for scoring below full credit.

**Calibration.** `npm run calibrate` grades a sample and compares it against the report an instructor wrote about the same work. The toolkit holds two short response pairs; pair 1 is the exemplar embedded in the prompt and **pair 2 is held out**, which is the only reason grading it measures anything.

|                        | pair 1 (exemplar) | pair 2 (held out)   |
| ---------------------- | ----------------- | ------------------- |
| Total                  | 12/15 = 12/15     | 11/15 against 12/15 |
| Per-question technical | all four agree    | **all four agree**  |
| Writing quality        | 1 = 1             | 1 against 2         |

Every technical score across both pairs agrees with the instructor's. The one difference is pair 2's writing score, on an acknowledged boundary case: the model places it at 1 and quotes the rubric back, since the 2 band requires that errors "do not take away from the understanding". An instructor may reasonably prefer 2 — which is the kind of judgment a rubric cannot fully specify, and the reason a draft is reviewed rather than published. Calibration also found two errors in the reference reports rather than in the pipeline, both since corrected. Coding sections are not calibrated: scoring them is closer to objective, and no graded samples exist.

**Handing in a file.** `verify:uploads` is 57 checks. The pure half is what may be stored: the extension decides and the last dot wins, so `resume.pdf.exe` is refused; a file at exactly the limit is accepted and one byte over is not; a path is built from the submission id and never from the student's filename; and a filename keeps its spaces while losing its slashes, quotes, and control characters. The live half stores a real object, fetches it back through a signed URL and compares the bytes, and then checks the two things the whole design rests on — **the unsigned public URL for that same object does not work, and a forged token does not either.** The rest runs through the tRPC callers inside a rolled-back transaction: an unpublished assignment cannot be handed in to, `submitWork` refuses this kind, a `.png` is refused where PDFs were asked for, uploading is what sets `SUBMITTED` and computes `isLate`, the submission lands in `needs_manual_grade`, and the student who uploaded it and the instructor who teaches the course can both fetch it while another student is refused. Objects written inside the transaction are removed afterwards, because a rollback undoes the rows and not the bytes.

**A hand-graded assignment, end to end.** `verify:approve` authors a `GOOGLE_DOC` assignment through `create`, publishes it, accepts it as the student and gets the `/copy` link back with no repository created, submits a document link, finds the submission in the queue as `needs_manual_grade`, opens a blank draft, presses the button a second time and gets the same draft rather than a second one, is refused approval while the section is blank, writes a score and feedback, releases it, and then confirms the released submission is in **no** bucket — not in triage, not in the queue, not in the gradebook — with delivery reported as `not_applicable` and no error message, and that the student sees the grade. All of it through the tRPC callers inside a transaction that is rolled back.

That last part is the check the whole delivery change exists for. It also required `approveDraft` to accept the caller's Prisma client: it read the module's own, so rows created inside a caller's transaction were invisible to it and the most consequential write in the application could only ever be tested up to the guards that refuse before writing.

**Approval and resubmission.** Approving recorded 30/30, set `isComplete`, wrote `gradedHeadSha`, and posted a comment; approving the same draft twice is refused rather than posting again. A student calling instructor procedures is refused with `FORBIDDEN`, and cross-course access is refused for an instructor who does not teach the course. A real commit pushed after grading left the status at `GRADED` and moved `headSha` while `gradedHeadSha` stayed put, which is what marks a submission revised since grading. The student's declaration set `RESUBMITTED`, and a second approval posted a distinct second comment.

Destructive and authorization paths are checked inside **rolled-back transactions** against live data — `throw new Error('ROLLBACK')` and catch — so a guard can be proven against real rows without harming any.

---

## Deploying

Vercel, with the environment variables above. Three things to know:

- **`GRADING_ASSETS_REPO` and `GRADING_ASSETS_INSTALLATION_ID` must be set**, and the App must be installed on the organization holding the guides. `GRADING_ASSETS_PATH` must not be set anywhere — it now raises `GradingAssetsError` rather than being ignored. Variables are bound when a deployment is created, so changing one requires a redeploy to take effect.
- **The webhook URL belongs to the App, not to the deployment.** Changing it on the App takes effect immediately with no redeploy, because the deployed handler reads nothing about where the delivery came from.
- **The GitHub App must be installed on the organization holding the grading guides**, not only on the one holding student repositories. `npm run verify:assets` is the check that a deployed host can read its rubric at all.
