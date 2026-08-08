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
  - [Why the folder rather than a list of files](#why-the-folder-rather-than-a-list-of-files)
  - [Getting students into a course](#getting-students-into-a-course)
  - [The cohort is in every repository name](#the-cohort-is-in-every-repository-name)
  - [`assertCourseMember` and `assertActiveStudent` are two different questions](#assertcoursemember-and-assertactivestudent-are-two-different-questions)
  - [Who may teach, and who may decide that](#who-may-teach-and-who-may-decide-that)
  - [Co-teaching one cohort](#co-teaching-one-cohort)
  - [Who owns a cohort](#who-owns-a-cohort)
  - [Deleting a cohort](#deleting-a-cohort)
  - [One student, or one assignment: the same screen from two sides](#one-student-or-one-assignment-the-same-screen-from-two-sides)
  - [A removed student's work](#a-removed-students-work)
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
  - [What a student commits, and what reaches the model](#what-a-student-commits-and-what-reaches-the-model)
  - [One section, one call, one report](#one-section-one-call-one-report)
  - [Flags, and why a section has no tests](#flags-and-why-a-section-has-no-tests)
  - [What the cross-check may and may not assert](#what-the-cross-check-may-and-may-not-assert)
  - [Provider isolation](#provider-isolation)
  - [What a report costs](#what-a-report-costs)
  - [Grading assets](#grading-assets)
    - [Two asset sources](#two-asset-sources)
- [Review, approval, and delivery](#review-approval-and-delivery)
  - [Handing in a file](#handing-in-a-file)
  - [Grading by hand](#grading-by-hand)
  - [Resubmission](#resubmission)
  - [Triage](#triage)
  - [Resources: what is in a module that is not work](#resources-what-is-in-a-module-that-is-not-work)
  - [Groups, and grading a portion of a cohort](#groups-and-grading-a-portion-of-a-cohort)
- [Interface](#interface)
  - [A cohort's seven views are seven addresses](#a-cohorts-seven-views-are-seven-addresses)
  - [Copying an assignment into another cohort](#copying-an-assignment-into-another-cohort)
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

That is the loop for a repository assignment. The other three kinds have no repository and no pull request, so the first three steps are replaced: a Google Drive assignment sends the student to Google's own prompt to take a copy while the other two hand out nothing at all, submitting is something the student does rather than an event to observe, and grading is an instructor writing the feedback into an empty draft. From approval onwards it is the same path — see [grading by hand](#grading-by-hand).

Two deliberate departures from GitHub Classroom's design:

- **No separate feedback branch.** The existing student ritual is preserved exactly as documented in `marcy-curriculum-docs/how-tos/working-with-assignments.md` and confirmed against real student repository history: students work on a `draft` branch, open a pull request from `draft` into `main`, and add the instructor as a reviewer. That pull request is the submission signal.
- **AI grading reports are part of the first working version, not a later addition.** The manual grading toolkit already does real evaluation work, so automating it is the point of the build. Reports always land as a draft for instructor review and are never posted automatically, so a person remains the last word on feedback quality.

Test execution and report generation are triggered by an instructor today, not by the webhook. Whether they should become automatic — and what runs them if they do — is [the one architectural decision still open](ROADMAP.md#triggering-and-orchestration).

---

## Running it

**Stack:** Next.js 16 App Router on Vercel, Supabase PostgreSQL, Prisma 7 with `@prisma/adapter-pg`, tRPC v11, Tailwind v4 with Base UI, Supabase Auth with GitHub OAuth, GitHub App with Octokit, E2B for sandboxed test execution, and Claude `claude-sonnet-5` behind a provider interface.

You need a Supabase project, a GitHub App, an E2B key, an Anthropic key, and read access to the grading guides repository.

```sh
npm i                  # also runs prisma generate
npm run db:deploy      # apply migrations
npm run db:seed        # bootstraps an EMPTY database — see below
npm run grant:admin -- you@example.com   # the first admin; every later one comes from /admin
npm run dev            # localhost:3000
npm run dev:webhook    # in a second terminal — forwards smee.io to /api/webhooks/github
```

**`db:seed` creates; it does not modify.** It is for an empty database, and re-running it against one with real work in it leaves every existing row alone. That is a correction rather than a design: it used to reassert the shape it describes on every run, and each reassertion was a silent revert of a decision made in the application. All three happened on the development database — a renamed module was **recreated** under its seeded name, leaving an empty duplicate that a course copied from it then inherited; a removed student would have been **put back**; an edited assignment would have had its title and rubric **reverted**. Modules are now identified by position rather than name, roles are raised and never lowered, and existing enrollments and assignments are untouched. The cost is stated rather than discovered: a corrected spec does not reach a row that already exists — edit it in the application, or delete the row and seed again. The one exception is rubrics, which no router can author, so this script is their only author.

Neither script creates accounts. Identity belongs to Supabase Auth, so both the seed and `grant:admin` look up a profile a real login created and fail with an explanation if it is absent.

Copy `.env.example` to `.env.local`; it documents every variable and the traps behind several of them. In brief:

| Variable                                                                                         | Purpose                                                                      |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                               | browser client                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                      | server-side admin operations                                                 |
| `DATABASE_URL`, `DIRECT_URL`                                                                     | pooled connection for the app, direct for migrations                         |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_INSTALLATION_ID` | the App that provisions repositories and receives webhooks                   |
| `GITHUB_WEBHOOK_PROXY_URL`                                                                       | development only: the smee.io channel `dev:webhook` listens on               |
| `E2B_API_KEY`                                                                                    | sandbox                                                                      |
| `GRADING_LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GRADING_LLM_EFFORT`                | report generation                                                            |
| `ANTHROPIC_MODEL`                                                                                | optional: overrides the model, which defaults to `claude-sonnet-5`           |
| `GRADING_ASSETS_REPO`                                                                            | the repository holding `rubric.md`, `agent-rules.md`, and the sample reports |
| `GRADING_ASSETS_INSTALLATION_ID`                                                                 | optional: overrides which installation reads that repository                 |
| `GRADING_ASSETS_REF`                                                                             | optional: a branch to read the guides from instead of the default            |

`SUPABASE_SERVICE_ROLE_KEY` does double duty: server-side admin operations, and the private bucket uploaded submissions live in. Nothing else can reach that bucket — see [handing in a file](#handing-in-a-file).

**`GRADING_ASSETS_REPO` is required everywhere**, development included — there is no local-clone mode. It names the program's prompt code, not the answer keys: an assignment names the repository *its own* reference solutions live in, in a column. See [two asset sources](#two-asset-sources).

**The installation is resolved from the repository's owner**, so `GRADING_ASSETS_INSTALLATION_ID` is rarely needed. A GitHub App is installed per organization with its own id and its own token, and an assignment may name an answer-key repository in an organization the environment variables say nothing about — so the App asks itself which of its installations covers a given owner, and caches the answer including the negative one. Set the variable only to override that for the assets repository.

### Two GitHub Apps, one per environment

A GitHub App has exactly one webhook URL, and GitHub cannot reach localhost. So there are two Apps — `marcy-lms-dev` pointing at a smee.io channel, and the production App pointing at the deployed domain — and switching environments means switching four environment variables, not editing App settings. Mirror the permissions and the `pull_request` subscription across both, and give them different webhook secrets. `npm run verify:app` checks all of it, including that the private key actually parses.

**smee.io answers GitHub with 200 whether or not anything is listening.** A push that arrives while `dev:webhook` is not running is recorded as a successful delivery and dropped. Redeliver it from the App's Advanced page rather than pushing again.

---

## Scripts

Verification scripts are re-runnable and are the fastest way to find out whether a change broke something. Two things about writing one: `tsx` compiles to CommonJS, which rejects top-level `await`, so the body goes in a `main()` or a `.then()`; and anything importing a module marked `server-only` needs `--conditions=react-server` in its npm script. The first two need neither a model nor a network; the eight after them drive the real procedures against the development database inside a transaction that is rolled back.

| Script                        | What it does                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify:sandbox`      | Sandbox logic with no sandbox: path matching, tamper reporting, the `package.json` merge, the restore script, all three parsers   |
| `npm run verify:grade`        | Grading logic with no model call: classification, rubric extraction, every cross-check rule, arithmetic                           |
| `npm run verify:approve`      | The approval guards, the delivery outcomes, the triage buckets, and a hand-graded assignment end to end, all through tRPC callers |
| `npm run verify:authoring`    | The rules that decide what a valid assignment is, then the authoring procedures through tRPC callers in a rolled-back transaction |
| `npm run verify:modules`      | Creating, renaming, reordering, and removing a course's modules, through the callers                                              |
| `npm run verify:groups`       | Student groups, and that filtering to one narrows all four screens to the same set of students                                    |
| `npm run verify:resources`    | Readings, notes, and videos — including every URL shape the video embed refuses                                                   |
| `npm run verify:enrollment`   | Creating a cohort, copying one, both links, co-teaching, and the removed-student pair — through the callers                       |
| `npm run verify:staff`        | Instructor invitations, admin promotion, and the grants that stop the browser writing a role                                      |
| `npm run verify:uploads`      | The upload path end to end, including the private bucket and signed URLs                                                          |
| `npm run verify:assets`       | That a deployed host can read its rubric — forces the local clone off and reads over the API                                      |
| `npm run verify:app`          | The GitHub App this environment is configured with: key, permissions, events, installation, and where its webhook points          |
| `npm run verify:e2b`          | Creates one real sandbox and checks the properties only a real sandbox shows                                                      |
| `npm run verify:resubmission` | The resubmission and re-approval loop end to end; `--post` also posts a real comment                                              |
| `npm run tests:run`           | Runs one real submission's tests from the terminal, where a sandbox failure is diagnosable                                        |
| `npm run grade`               | Generates one real report from the terminal                                                                                       |
| `npm run calibrate`           | Grades a sample submission and compares the result against the report an instructor wrote about it                                |
| `npm run approve`             | Approves a draft from the terminal                                                                                                |
| `npm run accept`              | Runs the accept flow from the terminal                                                                                            |
| `npm run setup:storage`       | Creates the private uploads bucket, or brings its size limit and type allow-list back into step with the code                     |
| `npm run db:diff`             | Generates a migration — see [Data model](#data-model), and never `migrate dev`                                                    |

`scripts/list-installations.ts` is the odd one out: not an npm script, and run with `tsx` when a new organization's installation id is needed.

**`setup:storage` is a deploy step, not a setup step.** It builds the bucket's allow-list from `UPLOAD_FILE_TYPES`, so adding a file type means re-running it against every environment — and forgetting leaves the upload route accepting a file the bucket then refuses, which appears only on a real upload and only where nobody re-ran it. See [handing in a file](#handing-in-a-file).

---

## Standing decisions

These are settled and do not need revisiting.

- **The existing student workflow is the submission signal.** A pull request from `draft` into `main`, with the instructor added as a reviewer.
- **AI reports are always drafts.** Nothing posts to GitHub and nothing counts as graded until an instructor approves it in the application.
- **Files the student can modify are never trusted as grading input.** This excludes `scores/scores.json` and the `hooks/pre-commit` hook that writes it, which a student can disable locally; the `tests/` directory inside the student's own repository; and `classroom.yml`. Every grading fact is produced again on the server on every graded run.
- **The instructor's tests come from the assignment template repository**, fetched fresh on every run, because students never have write access there. The Jest tests in `tests/*.spec.js` live in the template; the answer-key repository holds reference solutions only, which are used as language model context and never executed.
- **Grading is not run inside the student's repository via GitHub Actions.** That would mean trusting a workflow file living in territory the student can push to, which is the same problem as trusting their `tests/` directory. It is also why the accept flow removes the old `classroom.yml` from every generated repository.
- **Deterministic facts are computed by code and the model may only report them.** Test results, lint findings, and SQL comparisons are inputs the model must honor. A cross-check compares the model's claims against those facts.
- **Test results are one input to the rubric, not the score.**
- **One grading mode per assignment.** Every section is graded by the pipeline, or every section is graded by hand. A coding exercise with a hand-marked reflection is two assignments.
- **A module is a row an instructor names, and an assignment must belong to one.** Modules are per course, ordered by an integer, and nothing about them is derived from a repository's layout.
- **A kind is fixed once an assignment exists.** Changing it would change what its existing submissions are, and there is no migration from a pull request to a document.
- **Each assignment stores an explicit `sections` mapping** rather than guessing file paths by convention. Real assignments do not use consistent `{from-scratch,debug,modify}.js` filenames, and one pull request can contain more than one gradable section.
- **The rubric taxonomy is fixed at the four sections that exist in `rubric.md` today**: `SHORT_RESPONSE`, `CODING_ALGORITHM_FLUENCY`, `CODING_SQL_FLUENCY`, and `CODING_FRONTEND`.
- **Completion is judged at 75 percent**, matching the Complete/Incomplete policy in `working-with-assignments.md`. Stored per assignment as `completionThreshold`.
- **Students join a course through one link per course.** An instructor copies it and sends it however they already talk to their students; opening it and signing in with GitHub creates the enrollment. This application holds no email credentials and sends nothing. See [getting students into a course](#getting-students-into-a-course).
- **A course link grants a course; only an admin grants a role.** The cohort's co-teaching link admits an account that is already staff to one cohort, and refuses one that is not rather than promoting it. Becoming staff at all stays with `instructor_invites` and `adminProcedure`. See [co-teaching one cohort](#co-teaching-one-cohort).
- **Deleting a cohort is permanent, owner-only, and reachable only through archiving.** Archiving is the reversible version, so it is the only route to the one that is not; the confirmation states what would go and asks for the cohort's short name. See [deleting a cohort](#deleting-a-cohort).
- **Removing a student and archiving a course make lists go quiet; they never take work back.** A removed student keeps reading the feedback they were given, and an archived cohort stays readable to the people who were in it — and stays *in their course list*, labelled, rather than becoming an address somebody has to have kept. Neither can hand anything new in. A removed student's work leaves grading triage and the grading queue's list and moves to a Removed students table in the gradebook — see [a removed student's work](#a-removed-students-work).
- **Teaching a cohort and owning one are different.** Every instructor on a course authors, grades, and reads every student's work; the owner additionally archives it and decides who else teaches it, and cannot be removed by anybody but themselves. See [who owns a cohort](#who-owns-a-cohort).
- **GitHub's numeric user ID is the durable identity key**, because usernames are mutable.
- **An uploaded submission is readable only through a signed URL a procedure minted.** The bucket is private and carries no policies, so the browser cannot reach it at all.
- **The sandbox never holds a GitHub token.**
- **Verification happens against the `marcy-lms-test` organization**, never the production organization, until a flow is proven.
- **Production gets a new GitHub organization**, not the one holding the GitHub Classroom era's templates. What matters about it is each template's provenance rather than the org itself: Classroom wrote `.github/workflows/classroom.yml` into the templates it managed, so a template forked or transferred from there brings it along while one created fresh does not.

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

`prisma/schema.prisma`, thirty migrations applied. UUID primary keys, `timestamptz` timestamps, `created_at` and `updated_at` on every table, snake_case columns mapped from camelCase fields.

```
Profile ──1:1── auth.users
        └──< InstructorInvite (created, and redeemed)

Course ──< CourseInstructor ──> CourseGroup   (which group this instructor is grading)
       ├──< Enrollment ──< GroupMembership >── CourseGroup
       ├──< CourseGroup
       └──< Module ──┬──< Assignment ──< Submission ──< GradingDraft ──< GradingDraftSection
                     │                              └──< TestRun
                     └──< Resource

Rubric ──< (referenced by assignment.sections[].rubricId)
```

Enums: `Role`, `EnrollmentStatus`, `AssignmentKind`, `ResourceKind`, `VideoProvider`, `RubricScaleType`, `SubmissionStatus`, `SalesforceSyncStatus`, `GradingDraftStatus`, `Confidence`, `TestRunStatus`, `TestRunTrigger`.

**A module has two kinds of child and they are siblings**: `Assignment`, which is submitted and graded, and `Resource`, which is neither — see [resources](#resources-what-is-in-a-module-that-is-not-work). **A group joins to an `Enrollment` rather than to a `Profile`**, so the foreign key is what guarantees a group's members are students of that group's course — see [groups](#groups-and-grading-a-portion-of-a-cohort).

**`profiles`** carries the `Role` enum, `githubUsername`, a display name fallback, and `githubUserId BigInt? @unique`. The numeric ID is recorded by the `sync_github_identity` trigger from `auth.identities.provider_id`, guarded by a regular expression because that column is text and other providers put non-numeric values in it. Repository naming still uses the username, because that is the existing convention, which is why `submissions.repo_github_login_at_creation` exists.

**`modules`** is a course's own list of modules, created and named by an instructor and tied to nothing outside the application. `assignments.moduleId` is a foreign key onto it.

**The id is the identity, not the name**, and everything about this table follows from that. A module is a label and a position, and nothing outside the application derives from it — an instructor types "Async and APIs" and that is the title. Which module an assignment belongs to and where its reference solutions live are separate questions, answered by `moduleId` and `answerKeyRepo`, which is what lets a course's module list be corrected freely:

- **Renaming is one column.** With the name as the identity, a rename rewrites every assignment that used it and still cannot fix anything outside the database, which is why an earlier plan ruled renaming out entirely.
- **"The module must exist first" is a foreign key**, not validation code a second caller could forget to run. `onDelete: Restrict`, so removing a module can never take the assignments in it — and their submissions, and every graded draft beneath those — with it.
- **Ordering is `position`**, an integer an instructor sets, and deliberately *not* unique: `reorder` rewrites the whole sequence in one statement, and a unique constraint would refuse any intermediate state where two modules briefly share a position.

`@@unique([courseId, name])` gives one "Mod 4" per course, because two modules with the same name are indistinguishable in every select an instructor picks from. Modules are **per course** rather than shared across cohorts, matching how an LMS works: one cohort reordering or dropping a module must not change another's records, including finished ones.

**`reorder` is a single raw `UPDATE`.** The obvious implementation is one update per module inside a transaction, and it has two problems: a half-applied order is worse than none, and Prisma refuses a nested interactive transaction, so any caller already inside one — every verification script — fails outright. One statement is atomic by definition and composes with whatever is above it. `course_id` is in its predicate as well as checked beforehand, so even a bypassed validation could not touch another course's rows.

**`assignments`** carries `kind`, `templateRepo`, `answerKeyRepo`, `assignmentRepoName`, `githubOrg`, `completionThreshold`, `dueAt`, `distributedAt`, `runnerPreset`, `runnerConfig`, `templateRef`, `templateDriveUrl`, `acceptedFileTypes`, `submissionInstructions`, and the `sections` JSON array. `@@unique([courseId, assignmentRepoName])` prevents two assignments in one course from generating colliding repository names.

**An assignment names the two repositories it uses**, rather than having them inferred from where it sits. Both are entered as pasted URLs and stored as `owner/repo` — `lib/assignments/repo-ref.ts` accepts a browser address, a clone URL, an SSH remote, or a bare `owner/repo`, and the schema normalizes before it validates, so the column never holds a URL that no GitHub request could be built from.

**An address that points inside the answer-key repository is understood as one.** Pasting `…/tree/main/answer-keys/mod-1-js-fundamentals/swe-1-2-strings-conditionals` — the address of the folder an instructor already has open — fills both columns at once, and the question is then finished: the files under that folder *are* the reference solutions. A `/blob/` link to a file resolves to the folder it is in, since a file path is not a folder. The branch in `/tree/main/` is **dropped**, because answer keys are read at the repository's default branch and a listing opened at some other branch would show files grading would not read.

### Why the folder rather than a list of files

A list of individual paths carries the same information — right up until somebody adds a reference solution to the folder. Then the stored list is quietly incomplete, nothing says so, and the only symptom is a slightly worse grade. Naming the folder cannot go stale, because it is resolved on every run.

What that costs, and what it buys back:

- **Recognisable binaries are skipped**, or an archive sitting beside the source files would be base64-decoded into a prompt as though it were code — `swe-checkpoint-summative-1-4` has a `solutions.zip`. The rule is a *denylist* of archives, images, documents, media, fonts, and compiled artifacts, deliberately: an allowlist would silently drop the first `.sql` or `.py` answer key somebody writes, and a reference solution left out does not fail, it just makes the grade worse.
- **Every exclusion is reported**, on the authoring screen and on the draft. "Everything in the folder" is only trustworthy if the exceptions are visible.
- **The count is capped at 40 files per section.** A backstop rather than the thing that catches a mistake — the authoring screen lists the resolved files before anything is saved, and reading `from-scratch.js`, `modify.js`, `debug.js` tells an instructor the right folder was named in a way "17 files" does not.
- **A multi-section assignment gives every section the whole folder.** `swe-checkpoint-summative-1-4` scores a short response and frontend code against different rubrics from one folder, so each section's prompt carries the other's reference material. Accepted knowingly: the direction of travel is one section per assignment, and the alternative was a second selection mechanism existing forever for one legacy assignment.

- **`templateRepo`** must be a repository the App can read *through the installation that will generate from it*, and must have GitHub's template flag set. The flag is checked at authoring time because `generate` refuses a repository that is not a template, with a message about the API rather than about the assignment — and it fails at the moment a student presses Accept. Being private is not a failure: a private template in an organization this deployment's installation covers generates perfectly well, which is how every assignment in the sandbox organization works. What being *public* buys is reach — an installation token reads any public repository, including in organizations the App was never installed on, so a public template can be named wherever it lives.
- **`answerKeyRepo`** holds the reference solutions and must be private. A public one is refused rather than warned about, because reference solutions readable by the students being graded against them is not a configuration detail.
- **`answerKeyDir`** is a folder inside it, and **every file under that folder is the reference set.** Nothing is selected. `""` is the repository root, which is the right answer for a repository holding one assignment's solutions and nothing else.

**Two answer-key failures are reported differently, on purpose.** A repository that does not exist and a private one in an organization the App was never installed on both answer 404 — from an unauthorized caller's position they are the same thing. They are not the same thing to the person reading the message: the first is a typo fixed in seconds, the second is an installation nobody can perform from a form. They are told apart by asking whether the App is installed on that owner at all, which is a question the App can answer about itself.

**The folder is browsed, not typed**, for instructors who do not have its address to hand: the authoring form walks the named repository directory by directory and lists what the chosen folder resolves to. Recursively, because keys nest — `swe-1-3-node-modules` keeps two of its three under `madlib-challenge/`, and reading only the top level would silently omit them.

What that costs, stated rather than discovered: **drift is now possible.** An assignment can name a template or an answer-key repository that is later renamed, made private, or deleted upstream. Validation checks reachability whenever a draft is saved or published and reports it as a finding, which turns drift into a message on the authoring screen rather than a grading failure weeks later.

**`kind` is what a student turns in**, and it decides how an assignment is distributed, what a submission consists of, and how feedback is delivered. `AssignmentKind` names four, and **all four can be created, published, submitted, and graded**:

| Kind           | Distributed as                         | Collected as                                    | Graded by     |
| -------------- | -------------------------------------- | ----------------------------------------------- | ------------- |
| `REPO`         | a repository generated from a template | a pull request                                  | the pipeline  |
| `GOOGLE_DRIVE` | a link to Google's own copy prompt     | a link to the student's copy                    | an instructor |
| `FILE_UPLOAD`  | nothing — there is no Accept           | [a file in private storage](#handing-in-a-file) | an instructor |
| `EXTERNAL_URL` | nothing — there is no Accept           | a link to work made elsewhere                   | an instructor |

What differs is how far the pipeline reaches, not whether a kind works. Reading a Drive file's contents or an uploaded file and generating a report from it is a separate feature and needs instructor-authored rubrics.

**`GOOGLE_DRIVE` is one kind for Docs, Sheets, and Slides**, not three. Nothing about the three differs here: each is handed out as a `/copy` link built the same way, handed in as a link to the student's own copy, and graded by hand. What distinguishes an assignment is the template it names, and the editor is a property of that link rather than of the assignment. It was called `GOOGLE_DOC` while Docs were the only editor it accepted, which named the kind after an accident of its URL check.

**Widening the check means naming the editors, not accepting any Google address.** `assignmentSpecSchema` matches `docs.google.com/(document|spreadsheets|presentation)/d/<id>/(view|edit|preview)` — the three that build their URLs the same way and take `/copy` the same way. A Form, a Drawing, a Drive folder, and a published `/pub` link are all `docs.google.com` and none of them produces a copy prompt from the substitution, so admitting them would move the failure from the field where the link was typed to every student who pressed Accept.

**`EXTERNAL_URL` is for work made on a service this application knows nothing about** — a Canva design, a Loom recording, a deployed site, a Figma file. It is distinct from `GOOGLE_DRIVE` even though both are handed in as a URL, and the difference is distribution rather than collection: a Drive assignment hands out a template to copy, which is what lets it check the submitted link against Google's URL shape and build a `/copy` prompt from its own. This kind hands out nothing, so there is no shape to check against and any https link is a legitimate answer — refusing one would mean guessing which services are allowed and being wrong the first time an instructor names a new one. `LINK_SUBMITTED_KINDS` is what the two share, and `assertCanHandIn` takes `expect: "link" | "file"` rather than a kind so that a fifth kind cannot be admitted by one caller and refused by another.

**It has no field for a starting link, deliberately.** The obvious addition is a URL for a template the student copies, and `submissionInstructions` already does that job better: it is markdown, so an instructor writes "start from [this Canva template](…)" alongside everything else the student needs to know, rather than a bare URL appearing on screen with no explanation of what to do with it. A column would also imply the copy-prompt machinery `GOOGLE_DRIVE` has, which no other service shares.

The three GitHub columns are therefore **nullable, and required only when the kind is `REPO`** — enforced by the Zod schema rather than by the columns, because a column cannot express "required for one kind" and a `NOT NULL` would force a Drive assignment to invent a repository name. `templateDriveUrl` is the mirror of that: required for `GOOGLE_DRIVE` and null otherwise, as `acceptedFileTypes` is for `FILE_UPLOAD` — non-empty for that kind and empty for the rest, empty rather than nullable because "which file types does a Drive assignment accept" has an answer and it is none. Two consequences worth knowing:

- **`@@unique([courseId, assignmentRepoName])` needed no change.** Postgres treats NULLs as distinct in a unique constraint, so it goes on constraining repository-backed assignments and ignores the rest.
- **Nothing reads those columns without asserting the kind first.** `repositorySource(assignment)` narrows all four in one place and throws otherwise, and it distinguishes three failures that must not be reported as one another. The first two are opposites: `NotRepositoryBackedError` means the kind works and simply has no repository, so the caller should not have asked, while `UnsupportedAssignmentKindError` means a kind nobody has built. `AssignmentConfigurationError` is the third and the only one an instructor can act on — a `REPO` row missing `githubOrg`, naming the column.

**Every section of an assignment is graded the same way**: all by the pipeline, or all by hand. A mix is refused by `assignmentSpecSchema`. It was expressible and nothing in the curriculum was ever one, and supporting it means a report covering some sections and not others — the generated draft carries only what the model wrote, so the assignment's own point total exceeds what approving can record, and a 30-point assignment releases as 20 out of 20. Two assignments is the answer, which is where one section per assignment is heading anyway. Several sections graded the same way stay ordinary: the checkpoint has two, both graded by the pipeline. The two non-repository kinds go further and accept only manual sections, because the pipeline's inputs are a pull request's changed files, the template's tests, and the paths `classifySections` matches, and a document has none of them.

**`lib/assignments/spec.ts` is what a valid assignment is** — one Zod definition, discriminated on `kind`, used by both the seed and (in future) the authoring procedures, so the seeded shape and the authored shape cannot drift. The assignment's `pointValue` is *returned* by `parseAssignmentSpec` rather than accepted, so no input can make the gradebook column disagree with the reports beneath it. `npm run verify:authoring` checks these rules as pure functions.

**`submissions`** is one row per assignment and student, carrying repository and pull request identity, `headSha`, `gradedHeadSha`, `submittedUrl` (a link to the work when there is no repository), the four `upload*` columns (the stored file, when the work is one — written together or all null, and never the same thing as a link), `submittedAt`, `isLate`, `lastActivityAt`, the final score fields, and three dormant Salesforce columns. `repoFullName` is unique, which is what lets the webhook match an event to a submission with one indexed lookup. The Salesforce columns exist so a future synchronization job can query `WHERE salesforce_sync_status = 'PENDING'` without a migration then; nothing writes them today.

**`grading_drafts`** is one row per grading run, keyed by submission and head SHA. A new push creates a new row and marks the previous one `SUPERSEDED` rather than overwriting it, so an instructor's in-progress review of an older run is never silently replaced. `modelMetadata` records the model id, prompt version, grading asset commit SHA, and all four token counts, and is **null on a draft an instructor wrote by hand** — which is what tells the two apart. `headSha` is nullable for the same reason: work with no commit has none, and every reader compares that column against the submission's own to decide whether a draft has been overtaken, so null compares as "no commit to be out of date against" rather than as a placeholder each of those comparisons would have to recognise. Approval details — `approvedAt`, `approvedBy`, `postedPrCommentId` — live here rather than on the submission, because each approval posts its own comment and the approved drafts of a submission in order are its feedback history.

**`grading_draft_sections`** are child rows, because one submission can have more than one graded section per run. The submission's final score on approval is the sum of a run's section scores.

**`test_runs`** is described under [test execution](#test-execution).

### Getting students into a course

**`courses.joinToken`** is one unique token per course — the student one, with **`courses.coTeachToken`** beside it for [co-teaching](#co-teaching-one-cohort). An instructor copies the link, sends it however they already talk to their students, and anyone who opens it and signs in with GitHub is enrolled. It is per *course* rather than per student because distributing the link is a person's job either way, so twenty-five tokens would buy nothing — and because this application holds no email credentials and sends nothing.

What that trades away is an allowlist, so the controls are after the fact: `regenerateJoinToken` replaces a link that reached the wrong person, and removing deals with whoever got in. The token is random rather than derived from the course id, which appears in the address bar of every course page. It is returned by exactly one procedure — `courses.roster`, which is instructor-only *and* teach-gated — and appears in nothing a student receives. The co-teach token is behind the same pair, on `courses.settings`.

### The cohort is in every repository name

**`courses.cohortSlug` prefixes every repository a cohort generates:** `{cohortSlug}-{assignmentRepoName}-{github login}`, so `swe-f26-swe-1-4-loops-benspector3` sits beside `swe-s27-swe-1-4-loops-benspector3`. It is built in one place, `studentRepoName`, because a second caller assembling it slightly differently would create repositories nothing could find again — every later lookup uses the `repoFullName` recorded on the submission.

**Without it, two cohorts of the same program collide.** The name would carry no course, so a student in both — one repeating a module, or an instructor testing a copied cohort — would want the repository their other cohort already holds. `@@unique([courseId, assignmentRepoName])` does not catch that: it is per course, and the collision domain is the organization.

**Suggested from the course name and the term together, then editable — once.** "Data Science" starting "Fall 2026" offers `data-science-f26`; "Software Engineering Fellowship" offers `sef-f26`, which an instructor who would rather read `swe-f26` across forty repository names edits. The form follows both fields until somebody edits the slug and then stops — tracked as "have they touched it" rather than by comparing the two, because typing the suggested value by hand is still taking it over.

**Both halves are in it because neither is unique on its own.** Every program a school runs starts in the fall, so a term-only suggestion made `fall-2026` the short name of whichever course was created first and a refusal for every other program starting that season — with the instructor hitting the refusal being the one who had done nothing wrong.

**The course name is either whole or its initials, never half of itself**, and which one it is does not change with the season. `software-engineeri` is a name nobody would have chosen and this is a suggestion people accept without reading closely, while `sef` is visibly an abbreviation, so somebody who wants `swe` can see there was a decision to make. The course half is measured against the longest a compacted term can be rather than against the term in hand: otherwise one character of season would cost a word of the course name, a fellowship would read `software-engineering-f26` in the autumn and `software-sp27` in the spring, and two cohorts of the same program would stop looking related — which is the whole thing the prefix is for.

**Settled when the course is created and never again.** There is no `setCohortSlug`, which is why creating a course has a review step: the only window in which changing the name means anything is before the first Accept, and a mutation that is legal for a few hours and refused forever after is a rule every reader has to learn, a check to keep correct, and a screen that has to explain which state it is in. It cost more than that, too — "has anybody accepted yet" made the gradebook the one reader that needed *every* submission rather than the active students', which is exactly the reader that broke when removed students moved to their own table. A typo caught afterwards is fixed by creating the course again, or by a one-line database update, which is safe for as long as the course has no submissions.

**It is shown on one screen, which is the cohort's settings.** That is the screen for facts about the cohort itself, and it is where the example repository name is built — with `studentRepoName`, the same function `accept` calls, so what the screen promises and what GitHub receives cannot drift apart. It also says why there is no way to change it, and counts the repositories already named after it, because "you cannot edit this" is a better answer than a field that is not there. `courses.settings` is the only procedure that returns it; the gradebook, the roster, and the assignments list all read a cohort without it.

**Frozen once anybody in the course has accepted anything**, the same rule and reason as an assignment's repository name: those repositories are already named after it, and renaming here would not rename theirs. That makes the editable window "between creating the course and the first Accept", which the screen says out loud.

Unique across every course, archived ones included, because their repositories still exist. **The constraint is what guarantees that; naming both halves only makes collisions rare.** What still collides is two cohorts of the same program in the same term, or two programs whose names abbreviate the same way, and both are a named refusal rather than a constraint error.

**Two guards remain around the collision the prefix prevents**, both near-unreachable and both cheap. `accept` looks for the claimed repository before touching GitHub and refuses naming the course that holds it. And authoring warns when the slug and the assignment name leave fewer than 39 characters for a login — GitHub allows 100 in a repository name and 39 in a login, so the two have to fit inside 59 between them.

That second one cannot fire on this curriculum, which is worth writing down so nobody recomputes it: the longest assignment name is 28 characters and the slug is capped at 24, so the worst case available is 52, leaving 46 where 39 is the most a login can be. It would take an assignment named 36 characters or more to trip. It stays as insurance against names growing, not as a live concern.

**An `Enrollment` row is created *by* somebody joining**, so `studentId` is `NOT NULL` and there is no "invited" state: `@@unique([courseId, studentId])` is what makes redeeming a link twice return the enrollment that exists rather than adding another. A removed student redeeming again is refused, and that is the one place idempotence would be wrong — if the link let them back in, removal would not stick while they still held it, so coming back is `enrollments.restore`, which the instructor calls.

**The join link is behind authentication, and the proxy carries the destination.** `/join/[token]` sits inside the authenticated shell, so an unauthenticated visitor is redirected to sign in and arrives back at the link — which is what binds the enrollment to whoever signed in, with no token left to reconcile against an identity afterwards. The proxy sets `?next=` for this reason: a join link is the one address somebody reaches having never signed in, and without it they would authenticate, land on `/courses`, and never know they were one step from joining.

### `assertCourseMember` and `assertActiveStudent` are two different questions

Because [removing and archiving never take work back](#standing-decisions), "is this person in this course" has two right answers:

|                       | Admits                                                     | Governs                                                     |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `assertCourseMember`  | active students, **removed students**, instructors, admins | a course's screens, an assignment's page, released feedback |
| `assertActiveStudent` | active students only                                       | `accept`, `submitWork`, the upload route                    |
| `adminProcedure`      | admins only                                                | everything on `/admin` — invitations, and who is an admin   |

They live side by side in `lib/courses/membership.ts` because the two `where` clauses differ by one enum value in code that otherwise reads identically. Written out at each call site, the failure is not spotting a difference — it is not noticing there was a decision to make.

**The write paths were already right, and the read paths were the work**, which is the opposite of how it looks. `accept` and `assertCanHandIn` each checked `ACTIVE` themselves — a mutation must not assume which query preceded it — so a removed student was already refused. What had to widen was the four read checks, which filtered on `ACTIVE` too and would otherwise deny a removed student the course they are meant to keep.

`courses.listMine` is the one where admitting them is not the whole answer: it returns `enrolledAs`, so the card can say *no longer enrolled*. A course that silently reappeared, indistinguishable from the cohorts they are still in, would be telling a student something false.

### Who may teach, and who may decide that

**Three mechanisms, because they answer three questions.** `staff.createInvite` is how somebody *becomes* staff and works before they have an account at all — the case that matters, since a new hire has no reason to sign in to a system they cannot yet use. `staff.setAdmin` is how an account that already exists gains more, which is what makes "an admin can let others invite people" reachable. Both are `adminProcedure`: an instructor deciding who else becomes an instructor is the escalation that guard exists to prevent. The third is a cohort's own co-teaching link, below, which decides which courses an existing instructor works in and is the one an instructor may hand out themselves.

**An invitation is single use and expires in seven days**, unlike a cohort's join link, which is reusable on purpose. The difference is what they grant — the course link admits a stranger to one cohort, this one admits them to authoring and to every student's grades in every course — so reuse buys nothing and a forwarded link costs much more. Single use is enforced by `updateMany` with `redeemedAt: null` in the `where`, not by reading the row and then writing it: that is what makes two simultaneous redemptions resolve to one winner.

**Redeeming raises the role and never lowers it.** An admin who opens an instructor link stays an admin — and the person most likely to click one to see what it does is the admin who generated it. `raiseRole` exists because the obvious `role: 'INSTRUCTOR'` silently demotes them.

**A used invitation is kept and cannot be deleted.** It has stopped being a credential and become the record of how somebody got access, which is the question an audit asks months later. Revoking their access is a role change, not a tidied list.

**Revoking the last admin is refused.** There is no procedure that grants the *first* admin — deliberately — so an application with no admins has no way back except a database edit. `npm run grant:admin -- you@example.com` is that base case as a tool; it cannot create an account, because identity belongs to Supabase Auth, and it has no reverse.

**The guarantee that is not in any procedure**: migration `20260730024911_tighten_profiles_grants` means `anon` and `authenticated` may UPDATE exactly `display_name` and `avatar_url` on `profiles`, and `instructor_invites` has no browser privileges at all. `verify:staff` asserts both, because every procedure here could be perfect and a slipped grant would still let a student promote themselves from browser JavaScript — which is why that migration exists.

### Co-teaching one cohort

`courses.coTeachToken` is a second link per course, shown on its settings screen. An instructor sends it to a colleague; opening it and pressing the button writes a `CourseInstructor` row with `isPrimary: false`. Until it existed, `CourseInstructor` rows were written in exactly one place — `courses.create`, for the creator — so a second person teaching a cohort was a database edit.

**It grants a course and never a role**, which is the whole of the design. Only an account already holding `INSTRUCTOR` or `ADMIN` can redeem it; a student is refused and told an admin has to send them an instructor invitation first, rather than being promoted. The refusal is stated on arrival as well as enforced by the procedure, because a screen that offers a button it knows will fail is worse than one that explains. Without that guard, any instructor could hand out staff access by forwarding a course link, with no admin involved and no record beyond a row — which is exactly what `adminProcedure` and `instructor_invites` exist to control.

**A second column rather than a reuse of `joinToken`**, because the two links grant opposite things: one admits a stranger to a cohort as a student, the other admits them to authoring, the gradebook, and every grade in it. And a second address, `/co-teach/[token]`, rather than one route reading both tokens — a single screen would have to work out which link it was looking at before it could say anything true about it.

**Reusable, unlike an instructor invitation.** That one is single use because staff arrive one at a time and a forwarded link costs a great deal; this one is bounded by the role check rather than by being spent, and a cohort gains co-teachers across a term. `regenerateCoTeachToken` is the control, the same as the join link.

Two refusals are about the cohort rather than the account: an archived one takes no new instructors, and somebody enrolled as a student cannot also teach it — the mirror of `enrollments.join` refusing an instructor of the course, and for the same reason, since being both would put their own submissions in the queue they are meant to be working through.

**Removing the last instructor is refused**, the same shape and reasoning as revoking the last admin: every authoring procedure gates on `CourseInstructor` rather than on the role, so a course with no rows there cannot be authored in or graded by anybody, and only a database edit brings it back. Who else can be removed, and by whom, is [who owns a cohort](#who-owns-a-cohort) below.

**Nothing is taken back on GitHub, in either direction.** `accept` adds every `course_instructors` row as a collaborator at the moment a student accepts, so an instructor added later is not a collaborator on repositories that already exist, and one removed here stays a collaborator on the ones generated while they taught. The settings screen says the first out loud, because nothing else in the application would explain why a student's code will not open. The second is the same trade as leaving student repositories alone when an assignment is removed.

### Who owns a cohort

Everybody who teaches a course does the same work in it: authoring, reading every student's submission, approving grades. **The owner decides two more things** — whether the cohort is archived, and who else teaches it. The distinction exists because a course can have a second instructor, and both of those actions reach past the person performing them.

- **The owner cannot be removed by anybody else.** They can leave on their own account; somebody else removing them is refused. Leaving is a decision about your own work, and removing the person who runs a cohort is a decision about theirs.
- **The owner can hand the cohort on.** `transferOwnership` moves it to another of the course's instructors, and leaving afterwards is then the ordinary removal everybody has. Without it, the rule above would read as "whoever set this up runs it forever", and somebody leaving the program would leave behind a cohort nobody could take responsibility for.
- **Only the owner archives, and only the owner reopens.** One mutation with a boolean, so it is one gate. The consequence is worth knowing: a co-teacher finds an archived cohort in their course list, reads all of it, and cannot bring it back. A cohort somebody else retired is not theirs to un-retire.

**Ownership is derived rather than only stored.** The owner is whoever holds `course_instructors.is_primary` — written for the creator by `courses.create`, and moved by `transferOwnership` — and when no row holds it, the owner is the longest-serving instructor on the course. `ownerOf` in `lib/courses/ownership.ts` is the only place that decides, and the settings screen reads the answer from the server rather than computing its own, so the badge on a name and the guard inside a procedure cannot come to different conclusions.

The fallback is what makes a deleted account safe. `CourseInstructor` cascades on the profile, so deleting an owner's account takes the `is_primary` row with it, and every rule above would lose its subject: a cohort with instructors, none of whom could archive it or remove anybody. Nothing here deletes a profile — that is a database action somebody takes by hand — which is exactly why it has to hold with nobody there to invoke it. The same rule covers an owner who leaves without transferring, and the procedure says who inherited rather than leaving it to be noticed.

**An admin acts as owner on every course**, deliberately rather than as a leftover of `assertTeachesCourse` admitting them. An admin is the recovery path for an owner who left without handing the cohort on, and without one every rule above is a way for a course to end up with nobody who can administer it.

**One primary per course is a database constraint**, not a convention:

```sql
CREATE UNIQUE INDEX "course_instructors_one_primary_per_course"
  ON "course_instructors" ("course_id") WHERE "is_primary";
```

Transfer is what would otherwise produce two, since it clears one row and sets another, and two owners fails quietly — every reader takes the first row it finds and everything looks normal. Prisma cannot express a partial index, so it lives in the migration rather than in `schema.prisma`; `migrate diff` cannot see it either, which is why it survives the next schema change rather than being proposed for removal.

### Deleting a cohort

Permanent, and the largest destructive operation in the application: the course takes its modules, assignments, submissions, grading drafts, sections, test runs, enrollments, and instructor rows with it. There is no soft delete anywhere here and no recovery path in the application — the database's own backups are the only way back, which the screen says rather than implies.

**Archived first, and owner only.** Archiving is reversible and this is not, so making archiving the only route to it puts a survivable step in front of a permanent one: somebody who meant "take this off my list" gets exactly that before reaching anything that cannot be undone. Owner only is the same gate archiving uses, because if any co-teacher could archive and then delete, [ownership](#who-owns-a-cohort) would buy nothing. Both conditions are asked in one place that `courses.removalImpact` and `courses.remove` share, so a screen cannot end up previewing something it is not allowed to do.

**`removalImpact` exists so the confirmation states facts.** "24 students, 12 assignments in 6 modules, 187 submissions of which 143 carry a released grade" is a sentence somebody can weigh; "this cannot be undone" is not. The counts are read before the box that unlocks the button rather than beside it.

**The typed confirmation asks for the cohort's short name, not the course name**, and is enforced in the procedure rather than in the dialog — that is the whole point of it: the interface warns and the procedure refuses. The short name is what it asks for because a program runs every term under the same name, so typing "Software Engineering Fellowship" would confirm the wrong cohort as readily as the right one, while `cohortSlug` is unique by construction.

**Uploaded files are deleted; GitHub repositories are not.** The asymmetry is deliberate. A repository holds a student's own work and they can reach it on GitHub whether or not this application still knows about it, so deleting it would destroy something — the same reasoning that leaves them alone when an assignment is removed. An object in the private bucket had exactly one reader, the row about to go, so leaving it is not preservation but a file nobody can ever reach again. The storage removal runs after the rows and is best effort, because the database is the authoritative act and a bucket that refuses should not leave a cohort half deleted; the paths that would not go are named in the result, which is the only way anybody could find them once nothing points at them.

### One student, or one assignment: the same screen from two sides

`submissions.listForAssignment` reads one assignment across many students. `submissions.listForStudent` reads one student across many assignments. **They are the same screen**, and share `reviewableSubmissionSelect`, `decorateSubmission`, `SubmissionRow`, and `GradingReview` rather than each having their own — a field selected for one and missed by the other is a crash in the review pane, not a visible difference, and two copies of a row that shows a status badge, a stale-report flag and a score would drift into disagreeing about the same submission.

Only the label differs, so only the label is a prop: the caller says who or what a row is about, and the row says what state it is in.

**Three differences, each with a reason.** A student's record has a row for *every* assignment, including ones they never started, because "has not begun this" is a fact about a student that a list of only their submissions cannot state — where the grading queue deliberately omits a student who never accepted, since that screen asks what is left to grade rather than how somebody is doing. It has no search box, because filtering one student by name is nothing. And a row's second line is the module rather than a relative time, since forty rows all reading "3 days ago" order nothing.

`completionThreshold` moves from a page-level prop to a per-row one, because every row on this screen is a different assignment and the threshold is what decides whether a score passes.

**Reachable from the three places a name appears**: the roster, the gradebook's sticky first column, and the student's name in the review header — which is where "what else has this person done" gets asked, and where until now there was no answer. The review header takes `studentHref` as an optional prop and renders plain text without it, so the student's own record does not link to the page it is already on.

The page carries its own cohort selector, listing only courses this student is in *and* the caller teaches. The sidebar's switcher knows nothing about the student and would offer cohorts they are not in; a student repeating a module has two records, and this is how you get from one to the other.

### A removed student's work

Stopping the enrollment did nothing to the submissions, so a student who had left the program stayed in grading triage indefinitely — work nobody was going to do, that could not be cleared, inside the count that says whether an instructor is caught up.

**The same two questions, asked about a cohort's work rather than about the caller**, and they sit in `membership.ts` beside the pair above for the same reason. Every instructor-facing read of a course's submissions is a **list of work waiting**, which a departed student contributes nothing to, or a **record of what happened**, which they are part of.

|                                   | Used by                                     | Effect                                                  |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `activeStudentWork(courseId)`     | `submissions.triage` and its approved count | a removed student's work is not in the pile             |
| `removedStudentIds(db, courseId)` | `submissions.listForAssignment`             | partitions one query into the queue's list and the rest |

**The counts were the second half of the job.** Fixing triage alone would have left the gradebook and the assignments list claiming work was waiting while triage showed nothing to do — with nothing on any of the three screens to reconcile them. `courses.gradebook` returns `cells` narrowed to active students and `removedCells` beside it; `courses.assignmentsOverview` computes its "to grade" column from the same set. Both are right by construction rather than by remembering to filter, and a check asserts that all three readers return the same figure — which matters more since the counting moved to the server, because a derived count cannot drift from its source and a separately computed one can.

**`listForAssignment` returns two arrays**, `submissions` and `removedSubmissions`. The queue lists only the first; the review pane opens a row from either, with a banner naming the student who has left. The gradebook's Removed table links straight there, and a link into a screen that will not show what it points at is worse than no link. Same distinction as an archived course: triage is a list of work, an assignment's queue is how work is read.

**An ungraded submission in the Removed table says "Not graded"**, not the amber "waiting on you" dot. The difference is whose action is outstanding, and nobody's is. Nothing is closed or rewritten on removal, so `enrollments.restore` puts the work straight back — every filter reads live enrollment status.

**Every partition is a set and its complement**, never two named statuses. `REMOVED` is the only non-active value today, and filters naming both would silently drop an `AUDITING` student from the roster and the gradebook alike, which is an absence nothing reports.

**A gradebook and a roster want opposite things, which is why they are two reads.** `courses.roster` returns every enrollment with its status, so the roster can show a departed student and offer to restore them. `courses.gradebook` returns `activeEnrollments` and `removedEnrollments` — complements rather than two named statuses, so nobody can go missing from both — and the grid draws them as two tables with only the active ones in any count. Separate lists rather than one filtered in the interface, because a component that had to remember which question it was asking would eventually get it wrong.

### Migrations are authored with `migrate diff`, never `migrate dev`

**A running dev server does not notice a regenerated client.** The Prisma client is generated to `lib/generated/prisma`, which is gitignored, so Next's watcher does not invalidate the compiled chunk holding it — a dev server started before a migration goes on serving the old client and reports the new column as `Unknown argument` or `Unknown field ... for select statement`, listing exactly the fields the schema had when it started. The fix is `rm -rf .next && npm run dev`, and `predev` runs `prisma generate` so a fresh start always has a current client. Worth recognising the shape of that error, because it points at the query rather than at the cause and reads like a broken select.

`prisma migrate dev` reports drift on this database and offers to reset both the `auth` and `public` schemas. The drift is not real: `tables.external` in `prisma.config.ts` excludes Supabase's auth *tables* from diffing, but there is no equivalent for enum *types*, so Supabase's own `aal_level`, `factor_type`, `one_time_token_type` and the rest always look like enums the migration history did not create. The full authoring recipe is at the bottom of `prisma.config.ts`; `npm run db:migrate` is a guard that points at it.

---

## GitHub integration

**The App.** Permissions: Administration (read and write, for repository generation and collaborator management), Contents (read and write, for template generation and reading files), Pull requests (read and write, for reading state and posting the approval comment), Members (write), Metadata (read). Webhook events: `pull_request` only — no `push` subscription, because the pull request is the submission signal.

**`lib/github/`** — `app-client.ts` mints installation tokens and provides a lazily-constructed Octokit instance. `repos.ts` holds `generateRepoFromTemplate`, `getRepo`, `addCollaborator`, and `removeClassroomWorkflow`. `prs.ts` holds `getPullRequestFiles` and `postOrUpdatePrComment`. `archives.ts` fetches repository tarballs. `files.ts` reads individual files. `webhook-verify.ts` verifies `X-Hub-Signature-256`.

**A GitHub App is installed per organization.** The grading guides are in `The-Marcy-Lab-School` while student repositories are in `marcy-lms-test`, and the installation covering one cannot read the other. So install it on every organization holding grading assets — which installation reads a given repository is then resolved from that repository's owner, with no variable to set per organization. `scripts/list-installations.ts` prints the ids.

**`assignments.accept`** branches on the kind first, because what accepting *is* depends on it. For `GOOGLE_DRIVE` it records the submission as `ACCEPTED` and returns the copy prompt — `templateDriveUrl` with its last path segment replaced by `/copy` — so the application creates nothing, holds no Google credentials, touches no student's Drive, and the copy belongs to the student from the moment Google makes it. The substitution is worth being honest about: it works because that is how Google's editor URLs are shaped, which is why `assignmentSpecSchema` checks the link's shape rather than accepting any URL — one it did not match is one the substitution would leave untouched, sending every student to the instructor's own file to edit in place. The alternative was Drive API integration with OAuth against every student's Google account, which is a great deal of machinery for something a link already does. `FILE_UPLOAD` and `EXTERNAL_URL` have no accept at all: there is nothing to hand out, so the assignment stays `NOT_STARTED` until the student submits.

For `REPO` it creates the repository from the template as `{cohortSlug}-{assignmentRepoName}-{github login}`, adds the student as a collaborator with push permission, adds every `course_instructors` row for that course as a collaborator, waits for the template copy to land, removes `classroom.yml`, records the repository identity on the submission, and sets the status to `ACCEPTED`. It is idempotent: if a previous attempt created the repository but its database write never landed, it reuses the existing repository rather than failing on the name collision. An instructor with no linked GitHub account is skipped with a warning rather than failing the whole operation.

**The template copy is asynchronous, which is why there is a wait.** Measured rather than assumed: `generate` returned after 2.1 seconds and the new repository's tree only became readable at 5.6 seconds. In between, the repository exists and is empty, and GitHub answers a contents request with 404 and the body `"This repository is empty."` — the same status as a file that genuinely is not there. The body is the only thing that tells them apart, so `waitForRepoContent` retries on that specific 404 with lengthening gaps and `removeClassroomWorkflow` returns `removed`, `absent`, or `repository-empty` rather than a bare void. Without the distinction, losing the race looked exactly like success and nothing could tell that a `classroom.yml` had been left in a student's repository.

A repository still empty after the wait is logged and not treated as a failure: it exists, the student can work in it, and refusing their Accept over a workflow file whose results nothing trusts would be the worse trade. The window matters more now than it used to, because an instructor can name any public template and an arbitrary template can be large.

**The webhook** (`app/api/webhooks/github/route.ts`) verifies the signature against the raw request body, answers `ping` so the App's settings page shows a green check, and returns 200 for events it does not handle so GitHub does not mark the webhook as failing. For `opened`, `reopened`, and `synchronize` targeting `main` it matches `repository.full_name` to a submission and applies this rule:

| Event                 | Current status          | Result        |
| --------------------- | ----------------------- | ------------- |
| `opened` / `reopened` | anything but graded     | `SUBMITTED`   |
| `opened` / `reopened` | `GRADED`, `RESUBMITTED` | `RESUBMITTED` |
| `synchronize`         | any                     | untouched     |

Keyed on the current status as well as the action, because the action alone is not enough: a student who closes a pull request and opens a new one fires `opened` a second time, and treating that as a first submission would reset a graded row. `synchronize` records the new commit and never changes the status, because a commit is not a claim of completion and a graded submission must not drop back into the queue because someone fixed a typo.

**`submissions.submitWork` is the same signal for a kind with no webhook.** A pull request opening is an event to observe; work hosted elsewhere has nothing to observe, so a student pasting the link is the declaration: it sets `SUBMITTED`, stamps `submittedAt`, stores `submittedUrl`, and computes `isLate` against `dueAt` exactly as the webhook does. Without it, finished hand-graded work would never enter triage and would read as never started. It serves both link-submitted kinds and refuses the other two: a `REPO` assignment because accepting one would let a student mark work submitted with no code to look at and would make the webhook a second authority on the same columns, and a `FILE_UPLOAD` because [storing the file is itself the act of submitting](#handing-in-a-file).

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

| Flag                 | Meaning                                                                                                                   |          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| `TEST_EVIDENCE`      | Claims were checked against a real run                                                                                    | ordinary |
| `NO_TESTS_EXPECTED`  | The section declares no `evidence: "tests"`                                                                               | ordinary |
| `TEST_RUN_MISSING`   | Tests expected, no completed run at this commit                                                                           | a fault  |
| `TEST_MATCH_MISSING` | Tests ran, the section's `testNamePattern` matched none — shown as "No matching tests", since nothing is missing a *file* | a fault  |

**Every pill explains itself on hover.** `FLAG_META` and `CONFIDENCE_META` each carry a description and the badge components render it through one wrapper, so a code an instructor has not met before says what it means without a legend to look up. The seven writing and technical flags all open with "Points came off…", because that is the thing the labels never said: each one records why the student *lost* points and a section at full marks carries none.

Two things about it worth knowing. It is a real tooltip rather than the native `title` these used to carry, which waited a second and rendered unstyled — the text existed and nobody found it. And it deliberately adds no tab stop: rendered as a span, Base UI's trigger gains no `tabIndex`, so the tooltip opens on hover and not on focus, which is the reach `title` had. Making each pill focusable would put four to eight tab stops in front of the controls that do something on this screen. If the vocabulary ever needs reading without a pointer, one legend beats eighteen tab stops.

**Confidence is a pill, not a flag.** It is a column on the section, so the review screen shows how sure the model was on every section rather than only on the uncertain ones. `FLAG_META` does carry a `LOW_CONFIDENCE` entry, because that map decodes *stored* flags and some drafts have the code in their arrays; without it a raw `LOW_CONFIDENCE` string would render as a badge.

Its description lists the reasons the prompt actually names — a file that was needed and absent, code that could not be read, a rubric that does not cover what was submitted, reference solutions that were expected and missing — and says which reason it is *not*: an ordinary borderline judgment, which the prompt forbids hedging with and directs into `instructorNotes` naming both bands. If that instruction changes, the description has to change with it.

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

**Confidence is not a cross-check finding, so it never holds a draft back.** Low confidence on work with no suite to check against is the ordinary condition of most of this curriculum, so treating it as a fault would mark almost every short response and frontend section as exceptional — which is the fastest way to teach an instructor that the marking means nothing. It is shown as a pill and read as a hint about where to look carefully.

**Every cross-check finding holds the draft back.** Each one is a contradiction — rubric points that do not sum to the score, a claim about a test that never ran, full marks beside failures — and any of them is a reason a draft must not be passed over. Findings are recorded twice on purpose, for two readers: as a flag on the section, which is what an instructor scans, and as a review reason, which is what says why the draft was held.

Everything else produces manual review with the specific reason attached, never a fabricated score: fetch or authentication failure, a runner crash as opposed to failing tests, no section type matched, an assignment with no `sections` mapping, or a model call or schema validation failure.

### Provider isolation

One interface, two implementations. Pipeline code calls `getReportGenerator()` and never references a vendor; `GRADING_LLM_PROVIDER=claude|groq` selects. The contract carries a Zod schema rather than a JSON Schema document, because each provider has a better path than a hand-rolled validator: Claude's SDK derives the response format and parses through it with `messages.parse()` and `zodOutputFormat()`, and Groq needs a plain JSON Schema in its request body, which the same schema derives.

**Claude is the provider in use, on `claude-sonnet-5`.** The model is a constant in `lib/grade/providers/claude.ts` with `ANTHROPIC_MODEL` as an override, so trying another tier costs an environment variable — what it does not cost is the [calibration](#what-is-verified-and-how) that says whether the other tier still agrees with an instructor, which is the actual work of changing it. Groq's `openai/gpt-oss-120b` with strict `json_schema` remains implemented and is the only Groq model and mode combination confirmed to guarantee schema-conformant output, but its free tier caps requests at 8,000 tokens per minute and a frontend prompt does not fit — those carry several answer keys and a verbatim README checklist, about 12,400 tokens by Groq's count, rejected with a 413.

Two differences the interface must not hide:

- **Claude's JSON schema support rejects numeric constraints** such as `minimum` and `maximum`, rejects string length limits, and requires `additionalProperties: false`. So the schema cannot express them, and the arithmetic verification in the cross-check remains necessary — schema validation on either provider does not make it redundant.
- **Claude reports cached tokens separately from `promptTokens`, not as a subset.** A run that writes the cache shows zero reads and an unchanged prompt count, indistinguishable from caching being broken unless the write count is also recorded. All four counts go into `modelMetadata`.

### What a report costs

Measured on `claude-opus-5`, one section per run, normalized to a cache hit so the only variable is `effort`. The default model is `claude-sonnet-5`, so these are the figures for the more expensive tier and the shape of the answer rather than the current bill — the proportions below hold regardless of tier, and re-measuring is [token management](ROADMAP.md#token-management):

| Section            | Effort | Uncached input | Cached | Output | Cost   | Wall clock |
| ------------------ | ------ | -------------- | ------ | ------ | ------ | ---------- |
| `coding_algorithm` | high   | 5,207          | 5,624  | 2,646  | $0.095 | 31s        |
| `coding_algorithm` | medium | 5,207          | 5,624  | 2,365  | $0.088 | 27s        |
| `coding_frontend`  | high   | 12,392         | 7,590  | 3,396  | $0.151 | 40s        |
| `coding_frontend`  | medium | 12,392         | 7,590  | 2,631  | $0.132 | 29s        |

Output is roughly 60 percent of the cost, because thinking is billed as output. `GRADING_LLM_EFFORT` therefore moves total cost more than prompt caching or model tier do, and it is left at `high`: the gap is 7 to 14 percent, which does not buy enough to trade grading quality for. At `medium`, a cohort of 25 costs roughly $2.20 for an algorithm assignment and $3.60 for a frontend one.

**Caching works, and its window is short.** A repeated request read 7,590 tokens and wrote none; a later request for the same prompt wrote all 7,590 again, because the default cache lifetime is five minutes. Caching pays when a cohort is graded in one burst and pays nothing when grading is spread across an evening — an input to the orchestration decision, not a detail. Only the system prompt is cacheable today, which is 38 percent of the frontend input.

### Grading assets

#### Two asset sources

Everything a section is graded against is read over the GitHub API, from two repositories addressed differently:

|                                               | Where it comes from                                                                   | Why there                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rubric.md`, `agent-rules.md`, sample reports | the repository `GRADING_ASSETS_REPO` names                                            | Program-wide prompt code. Every assignment in every course is graded against the same rubric and the same tone rules; one with its own would be a different program. |
| reference solutions                           | the repository the assignment's `answerKeyRepo` names, at the paths its sections name | Per assignment. A cohort keeps its solutions wherever it likes, and the curriculum's directory layout stops being a constraint on the application.                   |

Both go through one function that decides the repository, the installation, and the commit, so there is no second implementation of a read to keep in step. **Both commits are recorded** on the draft and shown on the review screen — a report traces back to the exact rubric *and* the exact reference solutions it was written against, and the rubric's commit cannot answer the second question.

An assignment naming no answer key folder reads no second repository at all: nothing is resolved, nothing is requested, and the answer-key commit is null. Naming a folder while naming no repository is refused rather than skipped, because grading silently without reference solutions is the failure the whole mechanism exists to prevent.

Individual files rather than the repository archive — the archive is 23MB and over 20 seconds, almost all of it images grading never reads, while a run needs the rubric, the agent rules, one sample report, and a handful of answer keys, roughly 200ms each and fetched in parallel.

Answer key paths come from a database column and address a private repository, so a path that would escape its root is refused with plain string logic — there is no filesystem here, and the path goes straight into a GitHub contents URL.

There was a second source: a local clone, selected by `GRADING_ASSETS_PATH`, so that `rubric.md` could be edited and re-graded without pushing. It was removed deliberately. Every source of assets after this one is external — rubrics for non-repository assignments will come from Google Drive — so reading from disk was never going to generalize, and maintaining two implementations of every read and directory listing carried a standing risk worse than the inconvenience it saved: an assignment authored against one listing and graded against another, with each half looking correct on its own. A leftover `GRADING_ASSETS_PATH` now fails loudly rather than being ignored, because silently ignoring it would mean editing the rubric and seeing no change.

The cost is real and worth stating: tuning the rubric means committing and pushing, then waiting up to a minute. Push to a branch and set `GRADING_ASSETS_REF` to iterate without touching the default branch.

Files are read at a resolved commit SHA, never at a branch name, so a run taking ninety seconds cannot read half its rubric from before a push and half from after. Content is cached under `repo@sha:path` with no expiry, which is safe because the content of a path at a given commit cannot change. The branch head is re-resolved every 60 seconds per repository, so a pushed rubric change takes effect within a minute without a webhook. `GRADING_ASSETS_REF` applies to the program assets only — it exists so a rubric can be iterated on without touching the default branch, and an answer-key repository always reads its own default.

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

The vocabulary is PDF, images, Word and plain text, spreadsheets, and Jupyter notebooks. **Each type maps its extensions to the content type they are stored under**, rather than keeping two lists side by side — the two have to agree, and lists that agree by being written in the same order agree until somebody adds one entry to one of them.

**The extension decides both whether a file is accepted and what type it is stored under; what the browser reported is not consulted for either.** Browsers disagree about the same file — a `.docx` arrives as its official type, as `application/octet-stream`, or as nothing at all depending on the operating system and whether Word is installed, and a `.ipynb` almost never arrives as anything Jupyter would recognise. Checking the reported type refuses correct work on some students' machines and not others. *Storing* it is the same failure one layer down: the bucket has its own allow-list built from these same entries, so an upload the route accepted would be refused by the bucket, on one student's machine and no other. `contentTypeFor` is what closes that, and `verify:uploads` checks that every extension has a content type and that every one of those is on the allow-list.

**Adding a type means re-running `npm run setup:storage` against every environment.** That script builds the bucket's allow-list from this same map, and forgetting to leaves the route accepting a file the bucket then refuses — a failure that appears only on a real upload, and only in the environment nobody re-ran. The script used to update an existing bucket only when the *size limit* had drifted, so re-running it after adding a type printed "Nothing else to do" and changed nothing; it now compares the type list too and names what it adds or removes.

**`verify:uploads` stores a real notebook to catch the other half of that.** Every extension having a content type is a fact about this repository; the bucket accepting that content type is a fact about *this environment*, and the two come apart exactly when a type is added and the script is not re-run somewhere. A notebook rather than a PDF because it is the newest and the least likely to be on an old allow-list by accident.

**A spreadsheet and a notebook download rather than preview.** `previewKindOf` answers `pdf` or `image` and nothing else, because no browser renders the others and an empty frame is a worse answer than a download. The notebook is the one that costs something: it is the most-read of these and the download-and-open-elsewhere loop that embedding a PDF exists to remove is exactly what a grader is left with. Rendering one is a real dependency and its own decision, so the check that says a notebook does not preview is there to record that the answer is deliberate.

**The bucket is private and has no policies for `anon` or `authenticated`, so the browser cannot reach it at all.** Every access is a signed URL, valid for five minutes, minted by `submissions.uploadUrl` for a caller it authorized — the student who owns the submission, or an instructor who teaches that course. This is the same posture the database has, and it is deliberately stronger than per-student storage policies: a policy is a second description of who may see what, and two descriptions can disagree. Here there is one, and it is procedure code. `verify:uploads` checks that the unsigned public URL for a stored object does not work and that a forged token does not either, because if that check is wrong nothing is behind it.

**Uploading is one request to `POST /api/submissions/upload`, not a signed upload URL.** The alternative — mint a URL, let the browser send bytes straight to storage, then call back to record it — has a window where the object exists and the submission was never marked handed in. A student who closed the tab in that window has work in a bucket that nothing points at and no instructor will ever see, which is the exact failure `submitWork` exists to prevent. One request also means our own code checks the size and the type before a byte is stored.

A route handler is a second entry point, and a second entry point is how an authorization rule ends up with two versions that drift. So the rule is `assertCanHandIn` in `lib/uploads/submit.ts`, called by the route *and* by `submissions.submitWork`, and it throws `TRPCError` either way — the procedure propagates it and the route maps it to a status code. One error vocabulary rather than one per transport.

**The upload is the submission, so `submitWork` refuses this kind** exactly as it refuses `REPO`. Storing the file is the act of handing in; letting the link procedure mark one submitted would put work in the queue with nothing to open.

Three details worth knowing:

- **The order of writes cannot produce a submission that reads as handed in with nothing behind it.** The row is ensured first without touching its status — the path is built from its id, and a `FILE_UPLOAD` assignment has no Accept so there is often no row at all — then the bytes are stored, then the status and the four columns are written together. A failure partway leaves a row that reads as not started, which is true, or unreferenced bytes, which is harmless. The reverse order would put work in the queue with nothing to open.
- **The check is by extension, and the browser's MIME type is not consulted.** Browsers disagree about the same file — a `.docx` arrives as its official type, as `application/octet-stream`, or as nothing, depending on the operating system and whether Word is installed — so a MIME check refuses correct work on some students' machines and not others. The extension is what the student sees and what the instructor opens. The last dot decides, so `resume.pdf.exe` is an executable. The bucket's own MIME allow-list sits behind this as a backstop, and is generous where the route is exact.
- **The student's filename is never part of the stored path**, which is `{submissionId}/{uuid}{ext}`. It is kept in `upload_filename` for what the instructor sees and what their browser calls the download. A generated segment rather than a fixed name, so re-uploading writes a new object instead of overwriting one an instructor may be part-way through reading — and the previous object is left in place rather than deleted, on the same reasoning that leaves student repositories alone when an assignment is removed.

**A PDF or an image is shown in place, not only downloaded.** Grading a cohort of resumes by downloading twenty-five files, opening each in another application, and matching filenames back to students is most of the work of grading them, so the review screen embeds the document above the feedback being written, open on arrival. It is the browser's own PDF viewer in an iframe: no dependency, no worker file to serve, and it is the viewer the instructor already knows. Word documents are not previewed, because no browser renders one and an empty frame is a worse answer than a download.

That rests on three properties of an inline signed link, none of them ours to control — the response carries the object's content type, carries no attachment disposition, and is not frame-blocked. `verify:uploads` checks all three, because a change on Supabase's side would turn the viewer into an empty box with no error. Which files can be previewed is decided by `previewKindOf` from the extension, for the same reason `checkUpload` is: a `.pdf` that arrived as `application/octet-stream` on one student's machine would otherwise be the one submission an instructor still has to download.

**An inline link lives thirty minutes where a download link lives five.** A browser's PDF viewer fetches a large document in ranges as the reader scrolls, so the URL has to outlive the reading rather than the loading — five minutes is ample to open a PDF and not ample to read one, and pages further in would silently fail to appear, which reads as a corrupt file rather than as an expired link.

The size limit is enforced in three places and only one is a guarantee: the bucket refuses a larger object, the route refuses it before storing anything, and the browser refuses it before spending a student's upload on a request that cannot succeed. The last two exist so the failure is fast and legible.

### Grading by hand

A `GOOGLE_DRIVE` or `FILE_UPLOAD` assignment, or any assignment whose sections are all manual, is graded by an instructor writing the feedback and the score. The realization that made this small: **a manual grade is the existing review screen with an empty draft, not a new screen.** `gradingDrafts.startManual` writes a `GradingDraft` with null `modelMetadata` and one blank section per declared section, carrying the section's own point value so the total is not typed twice. Everything after that is unchanged — the same editor, the same approval, the same gradebook, the same student feedback screen, and the same feedback history across resubmissions.

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

| Bucket                | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `needs_report`        | Submitted, and no report has been generated                               |
| `needs_manual_grade`  | Submitted on an assignment the pipeline cannot grade; waiting on a person |
| `draft_ready`         | A report is waiting to be reviewed                                        |
| `needs_manual_review` | The cross-check found something that gates approval                       |
| `grading_failed`      | The run failed before producing a report — infrastructure, not a zero     |
| `comment_not_posted`  | Approved, there is a pull request, and the comment never reached it       |
| `generating`          | A run is in flight; not counted as outstanding                            |

The last two are the pair that has to be kept apart from their neighbours. `needs_manual_grade` is not `needs_report` because the action differs and only one of them exists — `needs_report` offers a button that must not appear on an assignment nothing can generate a report for — and it is not `needs_manual_review`, which is a report that exists and cannot be trusted. And `comment_not_posted` requires a pull request to have existed: without that condition every finished hand-graded submission sits there permanently, in triage, the queue, and the gradebook alike, with nothing an instructor can do to clear it.

**Triage counts work the instructor has not done, which includes work not yet started.** Reports are generated *by* an instructor, so a submission with no draft at all is the first bucket rather than a footnote — an empty queue has to mean caught up, not merely nothing generated.

### Resources: what is in a module that is not work

Readings, notes, and videos. **Nothing here is graded, submitted, or in the gradebook**, and saying that plainly is most of the design — the value is that a student's course page becomes the whole of the course rather than only the parts that are marked.

`Resource` is a **sibling of `Assignment` under `Module`**, not a shared parent both hang off. The tidier model is one "module item" that is either of them, and it is a much larger migration: `Assignment` is referenced by submissions, grading drafts, and test runs. The cost of the cheap version is real and paid in exactly three places — the student's course page, the Modules screen, and the Resources screen each merge two lists — rather than across the whole schema.

Three kinds, named in the enum before any of them was built, the way `AssignmentKind` was:

| Kind    | What it is                                   | Where it lives                              |
| ------- | -------------------------------------------- | ------------------------------------------- |
| `LINK`  | A title, a URL, and one line about it        | `url`, `description`                        |
| `TEXT`  | Markdown an instructor writes                | `body`                                      |
| `VIDEO` | A YouTube or Vimeo video, played on the page | `videoProvider`, `videoId`, and a watch URL |

**The video vocabulary is closed, and that is the one sharp edge here.** The obvious implementation accepts the embed HTML an instructor pastes, which puts an arbitrary iframe on a page every student in the cohort opens. Instead `parseVideoUrl` matches a URL against the shapes the two supported providers actually use, takes the id out of it, and stores provider and id; `videoEmbedUrl` builds the frame's address from those two and never from a string anybody typed. Anything unrecognised is refused when it is saved, where an instructor can fix it. Matching is on the **parsed host** rather than a substring, because `https://evil.example/youtube.com/watch?v=…` contains "youtube.com" and is not YouTube — `verify:resources` checks that one along with a subdomain trick, a lookalike host, a `javascript:` URL, and a traversal in place of an id.

Three decisions that are absences rather than columns:

- **No draft state.** An assignment has `distributedAt` because handing one out starts a clock and creates work; a link to a reading does neither, and a student seeing one early is not the problem an unfinished assignment is. So `resources.listForCourse` returns the same rows to a student and an instructor, which is the opposite of the assignment list beside it. Adding the column later is cheap; taking a publish step away once instructors rely on it is not.
- **No `position`.** Assignments sort by due date with the undated last, resources alphabetically by title, and **resources never interleave with assignments** — they sit in a section beneath them. That is what makes the ordering question disappear rather than need an answer: two sequences are never merged, so nothing has to decide how a deadline compares to a title. Modules keep the only manual ordering in a course.
- **No `courseId`.** Every query has a module to reach through, and nothing about a resource is unique per course, so the denormalized column would be one more thing that can come to disagree with the module it hangs off. It is also what makes the authorization check natural: a write names a module, and the module is what says which course to check.

Removal is a plain confirmation rather than the typed-title one an assignment needs — that destroys submissions and released grades irreversibly, and this destroys a title and a URL. A resource cascades with its module for the same reason, where an assignment restricts: `modules.remove` refuses while assignments reference it because those carry grades, and refusing to remove an otherwise-empty module because somebody left a reading in it would be a guard against nothing.

### Groups, and grading a portion of a cohort

A cohort is usually split between its instructors — the same fifteen students each, all term — and a group is how that is said. **A group is a named set of students and nothing else.** It has no instructor, grants no permission, and decides nothing about who may grade: an instructor picks one from the filter on grading triage, an assignment's queue, the gradebook, or the assignments list, and those four screens narrow to it. The overlap stops because the piles stop overlapping, not because anything is refused — a co-teacher covering for somebody else must still be able to approve their drafts.

`CourseGroup` is a name unique within a course. `GroupMembership` joins it to an **enrollment** rather than to a profile, so the foreign key is what guarantees a group's members are students of that group's course; membership is many-to-many in both directions. `CourseInstructor.gradingGroupId` remembers which group an instructor is working, one value across every screen rather than one per screen.

Three things about it are load-bearing:

- **"All students" is the absence of a filter, not a row.** As a real group it would have to be kept in step by every path that creates an enrollment, and could be renamed, deleted, or emptied by anybody — each of which puts a student outside the default view, which is the invisibility a group exists to prevent. As `null` it makes "every student is in the default view" true by construction. **"Ungrouped"** is the picker's third kind of entry and is deliberately not remembered: it answers "has anybody been missed" rather than "whose work do I grade", and a remembered Ungrouped would greet an instructor with an empty screen when everything is fine.
- **The filter is applied on the server, in all four procedures.** Triage and the queue could narrow in the browser since both hold every row, but `assignmentsOverview` aggregates its counts before sending them and cannot. One rule with two implementations is how they come to disagree, and the visible failure is a group's name above the whole cohort's figures. `activeStudentWork` and `enrollmentsIn` in `lib/courses/membership.ts` both build from one `groupCondition`, folded into the same enrollment clause that excludes removed students — two separate `where` fragments would have collided on the `student` key and silently replaced one another.
- **A screen that narrows says what it narrowed to.** Triage reports being caught up when its piles are empty, and filtered that is a claim about the group rather than the cohort, so the heading names it. The queue keeps an out-of-group submission openable by link with a banner saying why, for the same reason it does for a removed student: falling back to the first row of the list would show a different student's report under a URL that named one.

Groups are made on the roster, which is the only instructor screen with no group filter — it is where a student who is in nothing gets placed, and a roster narrowed to a group could not show them. They are not copied when a course is copied: they are made for the cohort in front of you.

Two things this is deliberately not yet, both on the roadmap: an assignment given to a group rather than the whole cohort, and one submission handed in on behalf of a group. Groups are the table both of them want, which is why this one carries no instructor relation.

---

## Interface

`app/(shell)/` holds the signed-in application; `app/auth/` holds the Supabase auth screens.

| Route                                                       | Screen                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/courses`                                                  | A student's courses                                                    |
| `/courses/[courseId]`                                       | Assignments, status, and feedback for one course                       |
| `/instructor`                                               | Nothing: picks the most recent cohort the caller teaches and redirects |
| `/instructor/courses/[courseId]`                            | Nothing: redirects to that cohort's settings                           |
| `/instructor/courses/[courseId]/triage`                     | What is waiting on the instructor in this cohort                       |
| `/instructor/courses/[courseId]/assignments`                | Every assignment in the cohort, and where new ones are made            |
| `/instructor/courses/[courseId]/resources`                  | Readings, notes, and videos, by module. Nothing here is graded         |
| `/instructor/courses/[courseId]/gradebook`                  | Assignments × roster, each cell carrying its triage bucket             |
| `/instructor/courses/[courseId]/roster`                     | Who is in the cohort, the join link, and the cohort's groups           |
| `/instructor/courses/[courseId]/modules`                    | The order the cohort is taught in                                      |
| `/instructor/courses/[courseId]/settings`                   | The cohort itself: short name, instructors, archiving                  |
| `/instructor/courses/[courseId]/assignments/[assignmentId]` | The grading queue and the review surface, `?submission=` to open one   |
| `/instructor/courses/[courseId]/students/[studentId]`       | One student's whole record in this cohort — the queue's other axis     |
| `/instructor/assignments/[assignmentId]`                    | The queue's old address: looks up the course and redirects             |
| `/admin`                                                    | Staff: who may teach, and who may decide that. Admins only             |
| `/join/[token]`                                             | Where a cohort's student join link lands                               |
| `/invite/[token]`                                           | Where an instructor invitation lands                                   |
| `/co-teach/[token]`                                         | Where a cohort's co-teaching link lands                                |

### A cohort's seven views are seven addresses

Triage, assignments, resources, the gradebook, the roster, the modules, and the settings are the sidebar, in that order. They were tabs on one course page until that page had a heading, a cohort line, an outstanding count, a triage button, a tab bar, and a row of stat cards all competing for the same band of the screen — and none of it was the thing being read.

**Each one being an address is what buys the rest.** The course switcher can keep the view across a change of cohort, because there is a view to name. A link can point at the roster rather than at a page plus a tab nobody can bookmark. And each screen fetches its own data, which is why `courses.gradebook` split into four: opening the roster used to fetch a term's worth of grading cells to display a list of names, and the assignments list derived its per-assignment counts by filtering those cells *inside a sort comparator*, so the filtering ran again for every comparison of every sort. `courses.roster`, `courses.assignmentsOverview`, `courses.settings`, and a narrowed `courses.gradebook` each answer one screen. The counts moved to the server with them and still come from `triageBucket`, so the "to grade" column cannot disagree with the pile triage lists.

**The bare course address is a redirect to settings.** With every view a sidebar item there was nothing left for it to render, and a reader who names a cohort and nothing more is asking about the cohort. It stays a route rather than being deleted so every link that names a course goes on working.

**Two segments need more than a prefix test to highlight.** Assignments covers its own list *and* everything filed under it — one assignment's queue, its edit form, the new-assignment form — because those are reached from it, and a sidebar that went blank while you graded would be blank exactly where an instructor spends the most time. Settings owns the bare course address, so the item is lit before the redirect resolves rather than flickering. A student's record under `/students/[studentId]` deliberately matches nothing: it is reached from the roster, the gradebook, and the review header, and belongs to none of them.

**Every instructor route names its course**, because the URL is the only record of which cohort you are in. There is no remembered "current course": a remembered one disagrees with the page the moment you open a link, and a sidebar naming a different cohort than the screen is worse than one naming none. So the switcher and the navigation read the address, and where the address names no course — `/courses`, `/admin` — the switcher shows a placeholder and the whole course group is dropped rather than pointed at a guess. It used to fall back to the first course in the list, which is ordered newest-first, and the result was a sidebar confidently naming last term's cohort while you graded this term's work.

**A student's sidebar is their courses.** One row per enrolled cohort under a "My courses" heading, each a link straight into that course, with the current one highlighted. There is no "My courses" item pointing at the list, because with every course named in the sidebar it would be a row pointing at the rows beneath it — `/courses` is still a real screen, reached by the breadcrumb and by `/`, and it is the one thing offered here to somebody with no enrollment yet. Archived cohorts and ones a student has been removed from stay in the list, labelled with the same words the course cards use, and sort after the current ones: a cohort somebody has finished is still theirs to read, and one sitting unlabelled among the ones they are in would be the sidebar telling them something false.

The switcher above is instructors-only for the same reason. A student used to get a read-only card there naming their current course, which repeated what the screen already said and vanished on the course list — the one place a name would have added something.

**All courses sits in its own group above them, separated by a rule.** Everything below is scoped to one cohort and this is the way out of all of them; among them it read as a seventh view of the cohort you were already in.

Switching cohort keeps the view rather than returning to a front page: triage becomes the other cohort's triage, the roster the other cohort's roster. That only holds for the seven views every course has, so an assignment's queue, its edit form, and a student's record land on settings instead — each belongs to one cohort and cannot travel. `sameViewInCourse` is where that is decided, and a view missing from it does not fail: it falls through to settings, so switching cohort from the roster would silently land on settings and read as the switcher losing your place. All of them are checked by `verify:enrollment` for that reason.

The breadcrumb names the cohort as plain text rather than as a link, because there is no course home for it to point at — the address it would use redirects, and a first step that lands somewhere the reader did not name is worse than one that only says where they are.

`lib/links.ts` is the one place these are constructed, so the triage list and the gradebook cells agree on where a submission opens, and `lib/instructor/course-scope.ts` redirects the two routes that name a course twice over — as a segment and through the assignment — when the two disagree.

Three routes outside that table. `/api/trpc/[trpc]` is the endpoint every browser query and mutation arrives at, and is the only one of the three that is not an exception to anything. `/api/webhooks/github` and `/api/submissions/upload` are: GitHub's own request and a multipart form cannot go through tRPC — see [handing in a file](#handing-in-a-file) for why the upload does not, and why its authorization is still procedure code.

**A wide table scrolls; the page does not.** `SidebarInset` carries `min-w-0`, because it is a flex item of the sidebar row and a flex item's `min-width: auto` resolves to its content-based minimum — so the gradebook's fifty columns pushed it wider than the viewport and everything measured against it went along. The window scrolled sideways instead of the table: the header's theme toggle left the screen, the assignments list's search box and New assignment button were cut off, and the gradebook's sticky Student column stuck to a scroll that was not the one moving, so it slid over the sidebar. `w-full` does not prevent it — that sets the basis and leaves the minimum alone. With a floor of zero the width is definite at every level below, which is what lets the `overflow-x-auto` around each table be the thing that scrolls. The same rule is why `SelectTrigger`, which is `w-fit whitespace-nowrap`, gets `w-full min-w-0` wherever its label is a course name.

Base UI rather than Radix: `render={<Link/>}` replaces `asChild`, `group-data-[panel-open]` styles an open Collapsible trigger, and `Select`'s `onValueChange` passes `string | null` — null when a select is cleared, which most of these never do, so the handlers coerce. The course switcher is the exception and guards instead: its value is genuinely null wherever the address names no cohort. `Select` also needs an `items` map of value to label whenever the value is not also the label, or the trigger renders the raw value — a course id.

**"Approved" is not shown beside "Graded".** They are the same fact in two words — approving a draft is the only thing that sets a submission to `GRADED` — so the review header shows the draft's own state only when it says something the submission's does not. `draftStatusAddsSomething` in `lib/status.ts` is that rule, and it also excludes `SUPERSEDED`, which is history rather than a state to act on. The grading queue worked this out first and had it in a comment; both screens now read the same function. The draft history list is the exception and shows every state deliberately, because distinguishing the approved round from the superseded ones is the whole of its job.

**A test run has no status badge.** Everything one could report is said better immediately below it by `RunOutcome`: a spinner while running, a destructive alert explaining that an error is not a score of zero, another for a timeout, and the pass rate itself when the suite finished. The badge was the weaker of two descriptions of the same fact and the misleading one — "Completed" in green above a pass rate of 3 out of 13 is a suite that ran and work that failed. Removing it left `TestRunStatusBadge` and `TEST_RUN_STATUS_META` with no callers, so both are gone too.

**A student's course page shows every module, empty ones included.** It is built from the course's module list rather than from the assignments in it, so a student can see the shape of the course ahead of them rather than only what has been handed out. An empty module collapses by default and says so. A module whose assignments are all still drafts reads as empty to a student and full to the instructor, which is what `distributedAt` is for.

**The Modules screen is that same page with module management on it**, and that is the feature rather than a resemblance. It was a list of module names with reorder buttons — accurate, and silent about what was in a module — so the question an instructor has about their own module list, "is this in the right place and does this module have anything in it", could not be answered from the screen that manages modules. Each module is now a collapsible holding its assignments, with the reorder buttons on the header beside the module they move.

**The assignments listed there are not interactive.** No links, no menus, no publish toggles. That screen shows the shape; the assignments list is where assignments are worked on, and a second route into the grading queue that looked different from the first would be two answers to one question. The accepted cost is that something spotted in the wrong module is moved from the other screen.

### Copying an assignment into another cohort

`assignments.duplicate` has taken a `targetCourseId` since it was written — course creation copies a whole term through it — and the menu that called it hardcoded the current course. So the case it exists for, carrying an assignment from last term's cohort into this one, was reachable only by writing the call. **Copy to…** is that picker.

**The module is the part that needs a person.** A module belongs to one course, so a copy across courses cannot reuse the source's and has to be told or has to guess. Guessing is matching by name, which is the only thing two courses can agree about: exactly right when two cohorts of one program share a module sequence, and a refusal on every assignment when they have diverged. The dialog defaults to the name match where one exists and says which of the two happened, because a silent name match and a silent fallback to the first module look identical on screen and one of them is a decision somebody should be making. `targetModuleId` is checked against the target course rather than merely looked up — it is a parameter anybody can pass, and `moduleId` is a foreign key to modules rather than to modules *of this course*.

**The copy keeps its repository name across cohorts and is renamed beside itself.** `@@unique([courseId, assignmentRepoName])` is per course and the generated repositories still differ, because [the cohort's short name prefixes every one of them](#the-cohort-is-in-every-repository-name) — so renaming across cohorts would break the correspondence between two runs of one program for nothing. Only a copy sitting beside its original collides, and that name is derived in the procedure: `-copy`, then `-copy-2`, up to ten. The interface used to supply one built out of the assignment's human title, which is not a legal repository name the moment a title contains a space — so the one menu item that needed a name was the one that could not produce one.

**An archived cohort takes no copies**, the same rule as a student joining one or an instructor being added to one. It matters more than it did: archived cohorts are in the course list now, so one is a thing somebody can be looking at when they reach for a copy, and a finished term quietly gaining an assignment is a change nobody would see.

**Drafts are shown and marked** rather than hidden. A truer mirror would omit what a student cannot see, and then a module that is full to the instructor and empty to the cohort reads as simply empty — the exact confusion the screen exists to remove. Marking them makes it diagnostic rather than merely accurate. So "the page a student meets" is the shape and the ordering, not a rule about visibility — and because `modules.listForCourse` admits students, the publish filter it applies is what stops that read handing a cohort the assignments their instructor is still writing.

**Within a module, assignments are ordered by due date, earliest first, and cannot be reordered by hand.** A due date is a fact an instructor already maintains and a student already reads, so an explicit position beside it would be a second ordering to keep in step — and nothing would say which is right the day they disagree. Work with no due date sorts **last**: `nulls: 'last'` is stated rather than left to the database's default, because it is a decision — no due date is not earlier or later than every date, it is outside the ordering — and a default that changes is a silent reordering of every course page. Title remains the tie-break for work due the same day. Modules keep the only manual ordering in a course, which is the right place for it: a module is a unit of teaching, and the things inside one are already ordered by when they are due.

**`EmptyState` takes its icon as an element, `icon={<Inbox />}`, not as a component.** A lucide icon is a `forwardRef` object rather than a plain function, and `EmptyState` is a client component, so passing the component itself from a server one fails at render with "Functions cannot be passed directly to Client Components". Nothing catches that at build time and it only fires when the empty state actually shows, so three screens carried it unnoticed until a cohort with no work outstanding made one appear. The prop is now typed `ReactNode`, which turns the old spelling into a compile error — the same shape `action` has always had.

**Anything the instructor's course screens render comes from a server component**, fetched once and passed down as a prop — so a mutation there needs `router.refresh()` and not only `queryClient.invalidateQueries()`. Publishing an assignment left the row showing "Draft" until a manual reload, because the browser's query cache never held that data to invalidate. Both calls are made: `invalidateQueries` for the parts that genuinely are client queries, the Modules screen among them, and `refresh()` for the server-rendered rest.

**`lib/status.ts` is the single source of presentation truth** — status vocabulary, tone classes, flag copy, relative dates, module ordering. `formatRelative(date, now)` takes the reference instant as an argument rather than reading the clock, and dates render in a fixed school timezone.

**On a score or a status pill, green means one thing: the work met the completion threshold.** `GRADED` and `APPROVED` were both the `success` tone, which put a green pill beside a 9/15 and said the opposite of the truth. Grading being finished, feedback being released, and work being complete are three different facts, and one colour cannot say all of them. Both are now `info`, and the score beside them carries the verdict in green or red.

Green survives in two places that are neither a score nor a state of student work: the `TEST_EVIDENCE` flag and `HIGH` confidence, where it means "the good case" for a question about the *evidence* rather than about the student. Both are instructor-only and sit among other flag badges, which is what keeps them from reading as a grade.

`completionMeta` in `lib/status.ts` is the one place that decides it, returning the label and the class together, and null when nothing is graded so no caller can render "Incomplete" for work nobody has looked at. The grading queue, the review pane, and the student's own row all read it, because the same decision written three times is three shades of green waiting to diverge — it already was two. The gradebook is deliberately *not* on it: its green means a score at or above 90 percent rather than a pass, which is a different question and a deliberate one.

Colour is never the only signal. The student's score carries an icon for shape and the verdict as screen-reader text, because red against green is the one pair a colourblind student is least likely to tell apart.

**The student vocabulary is narrower than the instructor's on purpose.** `SUBMITTED`, `DRAFT_READY`, `NEEDS_MANUAL_REVIEW`, and `GRADING_FAILED` all read as "Submitted" to a student. A student has no use for the state of a grading run, and "grading failed" invites a question no student can answer.

The screens came from a Vercel V0 pass once the data shapes were settled; everything before that was deliberately minimal pages that exercised the procedures.

---

## What is verified, and how

Every claim below was checked against real repositories in the `marcy-lms-test` organization, not asserted from reading the code. The re-runnable parts are the `verify:` scripts in [Scripts](#scripts); what remains outstanding is in [ROADMAP.md](ROADMAP.md).

**Provisioning and the webhook.** `accept` creates a repository from the template with the student and instructors as collaborators; run a second time it reuses the repository rather than failing. The `classroom.yml` *removal* is **not** among the verified claims, and the distinction matters: no repository in `marcy-lms-test` has one, or any workflow at all, so `removeClassroomWorkflow` reports `absent` every time it runs here and has never removed anything. It is written for templates that came from GitHub Classroom, and Phase 2 is what makes it load-bearing — an instructor can name any public template, and a great many public templates on GitHub are Classroom templates with autograding in them. What *is* verified is that it can tell "there is no such file" from "the copy has not landed", which is the part that was silently wrong. A real pull request from `draft` into `main` fires the webhook, the signature verifies, and the submission becomes `SUBMITTED` with `isLate` computed. An invalid signature is rejected with a 401.

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

**Calibration.** `npm run calibrate` grades a sample and compares it against the report an instructor wrote about the same work. The toolkit holds two short response pairs; pair 1 is the exemplar embedded in the prompt and **pair 2 is held out**, which is the only reason grading it measures anything. The figures below were produced on `claude-opus-5` and predate the current default, so re-running them is [the first thing under token management](ROADMAP.md#token-management) — this is the one check that says a change of model tier is safe.

|                        | pair 1 (exemplar) | pair 2 (held out)   |
| ---------------------- | ----------------- | ------------------- |
| Total                  | 12/15 = 12/15     | 11/15 against 12/15 |
| Per-question technical | all four agree    | **all four agree**  |
| Writing quality        | 1 = 1             | 1 against 2         |

Every technical score across both pairs agrees with the instructor's. The one difference is pair 2's writing score, on an acknowledged boundary case: the model places it at 1 and quotes the rubric back, since the 2 band requires that errors "do not take away from the understanding". An instructor may reasonably prefer 2 — which is the kind of judgment a rubric cannot fully specify, and the reason a draft is reviewed rather than published. Calibration also found two errors in the reference reports rather than in the pipeline, both since corrected. Coding sections are not calibrated: scoring them is closer to objective, and no graded samples exist.

**Modules.** `verify:modules` is 35 checks through the tRPC callers inside a rolled-back transaction: a new module goes at the end, a name is trimmed, a blank one is refused, a duplicate in one course is refused, renaming changes the name and not the position, reordering rewrites every position as a dense sequence from zero, a partial order or one listing a module twice is refused, an empty module can be removed, **a module holding assignments cannot be — by the procedure with a count, and by the foreign key underneath it** — and a student can read the list but call none of the writes, while an instructor who does not teach the course cannot either — and an empty module still reaches the student's course page, because that page renders a section per module rather than per module that happens to hold work.

The list now carries each module's assignments, so three more things are checked about them: they come back in **due-date order with the undated one last**, against a module whose rows were created out of order and whose undated assignment sorts first alphabetically, so neither insertion order nor the title could produce the expected answer; an unpublished assignment is returned to an instructor and **not to a student**, which is the reason that procedure reads the membership rather than discarding it; and `_count` deliberately disagrees with the length of that list, because removal is refused on drafts too and a count of only what the caller can see would offer a Remove button the procedure then refuses.

One thing that verification taught rather than confirmed: **provoking a database constraint aborts the whole Postgres transaction**, so every check that trips a unique index or a foreign key needs a transaction of its own. Discovered by having the first duplicate-name check take eleven unrelated checks down with it.

**Resources.** `verify:resources` is 61 checks, and the half that matters most is a pure function. **A video URL this application does not recognise must be refused rather than framed**, so `parseVideoUrl` is checked against every shape the two providers actually use — watch links, share links, shorts, the mobile host, Vimeo's channel and unlisted forms — and against twelve that must come back null: a host merely *containing* `youtube.com`, a subdomain trick, a lookalike host, a `javascript:` URL, a `data:` URL, another video service, a channel rather than a video, an id of the wrong length, and a traversal in place of one. Every one of those is a string a substring match would accept. The embed and watch addresses are checked to be rebuilt from the stored id rather than echoed from the paste, which is what collapses the twenty ways of writing one YouTube link into one and stops this application printing a link to something its own embed refused.

The rest drives the procedures in a rolled-back transaction: resources come back alphabetically rather than in insertion order (created deliberately as Zebra, Apple, Mango so insertion order cannot produce the answer), a student sees exactly the same rows an instructor does because there is no draft state to filter on, changing a resource's kind clears the columns the old kind used, a module from another course is refused, and neither a student nor an instructor who does not teach the course can write anything. The last check is the cascade: a resource is deleted with its module, where an assignment would have refused the deletion.

Writing it changed the code once. The spec's branches were not `.strict()`, so Zod silently stripped a stray key — a caller sending a link's fields under a note's kind would have seen it saved as something else with no error anywhere. `resourceColumns` nulls the column regardless, so nothing unclean could reach the database; strictness is what makes the caller's mistake visible instead of invisible. `assignmentSpecSchema` was already strict throughout, so this was a divergence rather than a decision.

**Groups.** `verify:groups` is 43 checks, and most of them are not about the group table. A group is a named set of students used to split a cohort between its instructors, and what has to hold is that **filtering to one narrows grading triage, an assignment's queue, the gradebook, and the assignments list to the same set of people** — the day two of those disagree, one screen says an instructor is caught up while another says work is waiting, with nothing on either to reconcile them. So the strongest checks compare a filtered read against an unfiltered one: the group's pile plus everybody else's pile is exactly the whole pile, the gradebook narrows its cells and not only its rows, no per-assignment count exceeds the cohort's, and an out-of-group submission stays openable by link rather than being replaced by whichever student is at the top of the list. Around them: a group from another course matches nothing rather than everything, Ungrouped agrees with the picker's own figure, a removed student keeps their membership and stays out of the pile until they are restored, choosing a group is remembered and deleting it returns the instructor to all students, and a student can call none of it while an instructor who does not teach the course cannot either.

It also found a defect rather than confirming one. `setMembers` replaced a group's membership inside its own `$transaction`, which is invisible in the running application and fails outright for any caller already in one — a nested interactive transaction cannot see its parent's uncommitted rows, so the check script hit a foreign key on a group it had just created. The same constraint `modules.reorder` works around with a single statement. Writing the difference instead of the whole set fixes it and has the better failure mode besides: delete-then-insert leaves an emptied group if the insert fails, which is the worst possible intermediate state for the only record of who grades whom.

**Handing in a file, and handing in a link.** `verify:uploads` is 88 checks. The pure half is what may be stored: the extension decides and the last dot wins, so `resume.pdf.exe` is refused; a file at exactly the limit is accepted and one byte over is not; a path is built from the submission id and never from the student's filename; and a filename keeps its spaces while losing its slashes, quotes, and control characters. The live half stores a real object, fetches it back through a signed URL and compares the bytes, and then checks the two things the whole design rests on — **the unsigned public URL for that same object does not work, and a forged token does not either.** The rest runs through the tRPC callers inside a rolled-back transaction: an unpublished assignment cannot be handed in to, `submitWork` refuses this kind, a `.png` is refused where PDFs were asked for, uploading is what sets `SUBMITTED` and computes `isLate`, the submission lands in `needs_manual_grade`, and the student who uploaded it and the instructor who teaches the course can both fetch it while another student is refused. It also authors an `EXTERNAL_URL` assignment and checks that the two link-submitted kinds land on the right side of every rule: it cannot be accepted, it cannot be handed in as a file, submitting the link is what enters the queue, and it waits on a person like every hand-graded kind. Objects written inside the transaction are removed afterwards, because a rollback undoes the rows and not the bytes.

The embedded preview is checked too — that an inline link serves the object as its own content type, with no attachment disposition and no frame-blocking header, and that a download link still asks the browser to save it.

**A hand-graded assignment, end to end.** `verify:approve` authors a `GOOGLE_DRIVE` assignment through `create`, publishes it, accepts it as the student and gets the `/copy` link back with no repository created, submits a document link, finds the submission in the queue as `needs_manual_grade`, opens a blank draft, presses the button a second time and gets the same draft rather than a second one, is refused approval while the section is blank, writes a score and feedback, releases it, and then confirms the released submission is in **no** bucket — not in triage, not in the queue, not in the gradebook — with delivery reported as `not_applicable` and no error message, and that the student sees the grade. All of it through the tRPC callers inside a transaction that is rolled back.

That last part is the check the whole delivery change exists for. It also required `approveDraft` to accept the caller's Prisma client: it read the module's own, so rows created inside a caller's transaction were invisible to it and the most consequential write in the application could only ever be tested up to the guards that refuse before writing.

**Co-teaching, ownership, and moving between cohorts.** `verify:enrollment` is 199 checks and covers all of it through the callers inside a rolled-back transaction. The co-teaching group takes **one account** and puts it through the rule: refused while it is a student, with the refusal naming an instructor invitation and no `CourseInstructor` row written; promoted inside the transaction; then eligible, admitted, and — the check the feature exists for — able to call a teach-gated procedure on the cohort, because a row that exists but does not actually let somebody work in the course would look entirely correct in the database. Redeeming twice adds nothing and leaves one row. An archived cohort and a cohort they are enrolled in as a student both refuse them. Replacing the link stops the old one and leaves the instructors already on the course untouched. Removing one of two is allowed and takes their access with it; removing the last is refused, with the count asserted to be one first, because a spare instructor lying around would make that refusal pass while measuring nothing.

**The ownership group is written in pairs**, because a one-sided check passes against a guard that refuses everybody: the owner is allowed and the co-teacher is refused at the same call, for archiving, reopening, removing the owner, and handing the cohort on. Three of its parts are worth knowing about. It **demotes the cohort's owner to `INSTRUCTOR` for the duration** and restores the role afterwards — the seeded course's creator is the deployment's admin, and `assertOwnsCourse` lets an admin through, so without that every "the owner may" check would have been passing on the admin bypass while claiming to measure ownership. It reaches the state a deleted owner's account would leave behind by **clearing `is_primary` off a course directly**, since nothing in the application deletes a profile, and then backdates one row, because Postgres resolves `now()` to the transaction's start time and both rows would otherwise share a `createdAt` to the microsecond — leaving the fallback's tie-break to decide a check about longest service. And it **reads the partial unique index out of `pg_indexes`** rather than trying to write a second primary row: the constraint is the one rule here that lives in the database rather than in a procedure, so a deployment that has not run the migration is a thing this should notice, and provoking it would abort the transaction every other check runs inside.

**The deletion group is mostly refusals**, and every one of them also asserts the cohort is still there afterwards — a refusal returning the right code while the rows went anyway would look correct in every log the script produces. A live cohort refuses both the delete and the impact read; a co-teacher refuses both on an archived one; the wrong confirmation string refuses and leaves the course untouched. What the successful delete then asserts is the cascade, one foreign key at a time, because the one that is wrong is the one leaving rows pointing at a course that no longer exists.

The switcher's arithmetic is checked as a pure function against **all six** sidebar views plus the five addresses that cannot travel between cohorts. That table is not a completeness gesture: a view missing from `sameViewInCourse` does not throw, it falls through to settings, so the failure it prevents is switching cohort from the roster and silently landing somewhere else.

**Approval and resubmission.** Approving recorded 30/30, set `isComplete`, wrote `gradedHeadSha`, and posted a comment; approving the same draft twice is refused rather than posting again. A student calling instructor procedures is refused with `FORBIDDEN`, and cross-course access is refused for an instructor who does not teach the course. A real commit pushed after grading left the status at `GRADED` and moved `headSha` while `gradedHeadSha` stayed put, which is what marks a submission revised since grading. The student's declaration set `RESUBMITTED`, and a second approval posted a distinct second comment.

Destructive and authorization paths are checked inside **rolled-back transactions** against live data — `throw new Error('ROLLBACK')` and catch — so a guard can be proven against real rows without harming any.

---

## Deploying

Vercel, with the environment variables above. Three things to know:

- **`GRADING_ASSETS_REPO` must be set**, and the App must be installed on the organization holding the guides *and* on every organization an assignment names as its answer keys. `GRADING_ASSETS_PATH` must not be set anywhere — it now raises `GradingAssetsError` rather than being ignored. Variables are bound when a deployment is created, so changing one requires a redeploy to take effect.
- **The webhook URL belongs to the App, not to the deployment.** Changing it on the App takes effect immediately with no redeploy, because the deployed handler reads nothing about where the delivery came from.
- **The GitHub App must be installed on the organization holding the grading guides**, not only on the one holding student repositories. `npm run verify:assets` is the check that a deployed host can read its rubric at all.
