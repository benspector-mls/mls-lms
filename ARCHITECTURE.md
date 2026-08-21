# Architecture

Why mls-lms is built the way it is. How to run it is in [README.md](README.md); what it does, role by role, is in [FEATURES.md](FEATURES.md); what is left to build is in [ROADMAP.md](ROADMAP.md).

**Table of Contents**
- [The loop](#the-loop)
- [Standing decisions](#standing-decisions)
- [Request path](#request-path)
  - [One way to ask each question](#one-way-to-ask-each-question)
- [Data model](#data-model)
  - [Why the folder rather than a list of files](#why-the-folder-rather-than-a-list-of-files)
  - [Signing in](#signing-in)
  - [Getting students into a course](#getting-students-into-a-course)
  - [The cohort is in every repository name](#the-cohort-is-in-every-repository-name)
  - [`assertCourseMember` and `assertActiveStudent` are two different questions](#assertcoursemember-and-assertactivestudent-are-two-different-questions)
  - [Who may teach, and who may decide that](#who-may-teach-and-who-may-decide-that)
  - [Co-teaching one cohort](#co-teaching-one-cohort)
  - [Who owns a cohort](#who-owns-a-cohort)
  - [Deleting a cohort](#deleting-a-cohort)
  - [One student, or one assignment: the same screen from two sides](#one-student-or-one-assignment-the-same-screen-from-two-sides)
  - [A removed student's work](#a-removed-students-work)
  - [Seeing a course as a student sees it](#seeing-a-course-as-a-student-sees-it)
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
  - [A ceiling on what a mistake can spend](#a-ceiling-on-what-a-mistake-can-spend)
  - [Grading assets](#grading-assets)
    - [Two asset sources](#two-asset-sources)
- [Review, approval, and delivery](#review-approval-and-delivery)
  - [Handing in a file](#handing-in-a-file)
  - [Grading by hand](#grading-by-hand)
  - [Correcting a submission before anybody has read it](#correcting-a-submission-before-anybody-has-read-it)
  - [What a submitted link goes to](#what-a-submitted-link-goes-to)
  - [Resubmission](#resubmission)
  - [Generating every pending report at a sitting](#generating-every-pending-report-at-a-sitting)
  - [Triage](#triage)
  - [Resources: what is in a module that is not work](#resources-what-is-in-a-module-that-is-not-work)
  - [Groups, and grading a portion of a cohort](#groups-and-grading-a-portion-of-a-cohort)
- [Interface](#interface)
  - [What is due, across every cohort](#what-is-due-across-every-cohort)
  - [Where a course stands, in one line](#where-a-course-stands-in-one-line)
  - [One assignment, in a panel](#one-assignment-in-a-panel)
  - [Whether the feedback was read](#whether-the-feedback-was-read)
  - [A cohort's seven views are seven addresses](#a-cohorts-seven-views-are-seven-addresses)
  - [Your own account, and the name a roster shows](#your-own-account-and-the-name-a-roster-shows)
  - [Copying an assignment into another cohort](#copying-an-assignment-into-another-cohort)
- [Security](#security)
  - [Where each control lives](#where-each-control-lives)
  - [Two-factor authentication](#two-factor-authentication)
  - [Getting back in if everybody is locked out of GitHub](#getting-back-in-if-everybody-is-locked-out-of-github)
  - [Settings to check in the Supabase dashboard](#settings-to-check-in-the-supabase-dashboard)
  - [Settings to add at the platform edge](#settings-to-add-at-the-platform-edge)
  - [What the audit log records](#what-the-audit-log-records)
  - [What is not covered](#what-is-not-covered)
- [What is verified, and how](#what-is-verified-and-how)


---

## The loop

```
Student clicks "Accept assignment"
        ▼
GitHub App generates a repository from the template, adds the student and
every course instructor as collaborators
        ▼
Student works on `draft`, opens a pull request into `main`
        ▼
Webhook (pull_request: opened / reopened / synchronize), matched to a
submission by repository name; status becomes SUBMITTED
        ▼
Test execution in an E2B sandbox: the template's tests against the student's
code, no network access, no credentials present
        ▼
Report generation: one schema-constrained model call per gradable section,
given the rubric, the answer key, the student's code, and the test results
        ▼
Draft report awaiting instructor review
        ▼
Instructor approves: grade recorded, pull request comment posted, student
sees feedback
```

- That is the `REPO` loop. The other three kinds have no repository and no pull request: a Drive assignment sends the student to Google's own copy prompt, the other two hand out nothing, submitting is an act by the student rather than an event to observe, and grading is an instructor writing into an empty draft. From approval onwards the path is the same — see [grading by hand](#grading-by-hand).
- **No separate feedback branch.** Students work on `draft` and open a pull request into `main`, as documented in `marcy-curriculum-docs/how-tos/working-with-assignments.md`. That pull request is the submission signal.
- **AI reports are in the first working version.** They always land as a draft for instructor review and are never posted automatically.
- **Test execution and report generation are triggered by an instructor, not by the webhook.** Whether they become automatic is [the one architectural decision still open](ROADMAP.md#triggering-and-orchestration).

---

## Standing decisions

Settled; not revisited.

- **The submission signal is a pull request from `draft` into `main`.**
- **AI reports are always drafts.** Nothing posts to GitHub and nothing counts as graded until an instructor approves it.
- **Files the student can modify are never trusted as grading input** — `scores/scores.json`, the `hooks/pre-commit` that writes it, the student repository's `tests/`, and `classroom.yml`. Every grading fact is produced again on the server on every graded run.
- **The instructor's tests come from the template repository**, fetched fresh each run, because students have no write access there. `tests/*.spec.js` lives in the template; the answer-key repository holds reference solutions only, used as model context and never executed.
- **Grading never runs inside the student's repository via GitHub Actions**, because a workflow file lives where the student can push. This is also why accept removes `classroom.yml` from every generated repository.
- **Deterministic facts are computed by code; the model may only report them.** A cross-check compares the model's claims against test results, lint findings, and SQL comparisons.
- **Test results are one input to the rubric, not the score.**
- **One grading mode per assignment.** Every section is graded by the pipeline, or every section by hand. A coding exercise with a hand-marked reflection is two assignments.
- **A module is a row an instructor names, and an assignment must belong to one.** Modules are per course, ordered by an integer, and derive nothing from a repository's layout.
- **A kind is fixed once an assignment exists.** There is no migration from a pull request to a document.
- **Each assignment stores an explicit `sections` mapping** rather than guessing paths by convention. Filenames are inconsistent across real assignments, and one pull request can hold more than one gradable section.
- **The rubric taxonomy is the four sections in `rubric.md`**: `SHORT_RESPONSE`, `CODING_ALGORITHM_FLUENCY`, `CODING_SQL_FLUENCY`, `CODING_FRONTEND`.
- **Completion is judged at 75 percent**, per the Complete/Incomplete policy in `working-with-assignments.md`. Stored per assignment as `completionThreshold`.
- **A student is admitted by a link and a list, never by either alone.** The instructor records who they expect, then sends the one join link however they already reach students. This application holds no email credentials and sends nothing. See [getting students into a course](#getting-students-into-a-course).
- **Signing in is GitHub and nothing else.** No password form, no self-service signup; two-factor is GitHub's. See [signing in](#signing-in).
- **A course link grants a course; only an admin grants a role.** The co-teaching link admits an account that is already staff, and refuses one that is not rather than promoting it. See [co-teaching one cohort](#co-teaching-one-cohort).
- **Deleting a cohort is permanent, owner-only, and reachable only through archiving.** The confirmation states what would go and asks for the cohort's short name. See [deleting a cohort](#deleting-a-cohort).
- **Removing a student and archiving a course make lists go quiet; they never take work back.** A removed student keeps reading their feedback; an archived cohort stays readable, and stays in the course list, labelled. Neither can hand anything new in. See [a removed student's work](#a-removed-students-work).
- **Teaching a cohort and owning one differ.** Every instructor authors, grades, and reads every student's work; the owner also archives it and decides who else teaches it, and can only be removed by themselves. See [who owns a cohort](#who-owns-a-cohort).
- **GitHub's numeric user ID is the durable identity key**, because usernames change.
- **An uploaded submission is readable only through a signed URL a procedure minted.** The bucket is private and carries no policies.
- **The acts that decide who sees whose work are recorded and cannot be rewritten.** `audit_events` is append-only, enforced by triggers rather than grants because Prisma owns the table. The actor is always the real signed-in person, never a test student being viewed as.
- **The two operations that cost money are capped per person per hour** — grading drafts and test runs. See [a ceiling on what a mistake can spend](#a-ceiling-on-what-a-mistake-can-spend).
- **The sandbox never holds a GitHub token.**
- **Verification runs against the `marcy-lms-test` organization**, never production, until a flow is proven.
- **Production gets a new GitHub organization.** What matters is each template's provenance: Classroom wrote `.github/workflows/classroom.yml` into templates it managed, so a template forked or transferred from there carries it and one created fresh does not.

---

## Request path

- **Every read and write goes through tRPC into Prisma.** Nothing queries PostgreSQL from the browser.
- **Authorization lives in exactly one place: procedure code.** `trpc/init.ts` layers `protectedProcedure` (a session), `profileProcedure` (a profile row), `studentProcedure`, `instructorProcedure` (`INSTRUCTOR` or `ADMIN`), and `adminProcedure`.
- **Instructor procedures also check that the caller teaches *this* course**, because the role alone would let one cohort's instructor read another's.

### One way to ask each question

That check has two shapes, chosen by what the input names.

- **`courseProcedure` — the input names the course.** `instructorProcedure` plus a `courseId` input plus the check, so a procedure built on it cannot omit the check. tRPC merges chained `.input()` schemas, so a procedure adding its own keeps `courseId` and no call site changes. Around twenty procedures use it.
- **The `teachable*` loaders in `lib/courses/scope.ts` — the input names a row.** A module id says nothing about its course until the row is read, so loading and authorizing are one act. One per entity: `teachableCourse`, `teachableModule`, `teachableAssignment`, `teachableSubmission`, `teachableEnrollment`, `teachableGroup`, `teachableResource`, `teachableDraft`, `teachableTestRun`. Each caller chooses its own `select`.

```ts
const submission = await teachableSubmission(ctx, input.submissionId, {
  id: true, repoFullName: true, headSha: true,
  assignment: { select: { id: true, title: true, runnerPreset: true } },
});
```

- **The check is a condition in the `where`, not a join in the `select`**, which keeps the loader one query and has three consequences: the caller's `select` reaches Prisma untouched so the payload type is exactly what they asked for; an admin has no condition added at all; and `NOT_FOUND` is still told from `FORBIDDEN` by a `count` that runs only when the first query returns nothing.
- **Three questions deliberately use neither**, each with a comment saying why: an instructor refused enrollment as a student in their own course, reading a remembered `gradingGroupId` off the instructor row, and grading triage — which answers "not yours" with an empty pile rather than a refusal.

Underneath, the database denies the client-side roles outright:

```sql
REVOKE ALL ON TABLE public.<table> FROM anon, authenticated;
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;  -- no policies means no access
```

- **`anon` and `authenticated` hold no privilege on any table in `public`, and a new table inherits none.** Those are the roles the browser's Supabase client connects as, so this closes querying a table directly from client JavaScript. It restricts no person: every read and write goes through a procedure, which reaches Postgres as Prisma, the table owner.
- **Migration `20260814024306_revoke_public_grants_project_wide` makes that the default** by subtracting the two roles from Supabase's default privileges for every role that creates a table here. The block above is still written on each new table, because the default belongs to the database and the block travels with the table.
- **It is needed because Supabase grants everything on new `public` tables.** That is how a signed-in student could once set their own `role` to `ADMIN` from browser JavaScript — closed for `profiles` by `20260730024911_tighten_profiles_grants`. The one table still exposed to the default is `_prisma_migrations`, which Prisma creates itself.
- **The tradeoff is that these tables cannot be read with supabase-js.** Nothing does: the browser's Supabase client handles authentication and sign-out and makes no `.from(...)` call anywhere.
- **`ALTER DEFAULT PRIVILEGES FOR ROLE` requires membership in the role it names**, so the migration guards on `pg_has_role` — the migration user is not a member of `supabase_admin`.
- **`trpc/server.tsx` invokes procedures in-process**, so server components take no HTTP hop and `Date` values stay `Date` values. The browser link uses a relative URL, which is why there is no `APP_URL` variable.
- **Queries are batched into one request; mutations are not.** `httpBatchLink` collapses same-tick calls, which suits a screen's several small queries and breaks anything that fans out: N batched mutations share one invocation, one timeout, and one failure. [Batch report generation](#generating-every-pending-report-at-a-sitting) fires several two-minute mutations against a 300-second limit. `splitLink` routes on `op.type`. Measured: three queries make one request, three mutations make three.
- **Cache Components is on** (`cacheComponents: true`). A route may not read uncached data outside `<Suspense>`, including `params`, so every dynamic page is a static shell whose async child awaits:

```tsx
export default function Page({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CourseView params={params} />
    </Suspense>
  );
}
```

- **`lib/supabase/proxy.ts` excludes `/api` from the authentication redirect**, so GitHub's unauthenticated webhook reaches the route instead of a 307 to `/auth/login`.

---

## Data model

`prisma/schema.prisma`. UUID primary keys, `timestamptz` timestamps, `created_at` and `updated_at` on every table, snake_case columns mapped from camelCase fields.

```
Profile ──1:1── auth.users
        └──< InstructorInvite (created, and redeemed)

Course ──< CourseInstructor ──> CourseGroup   (which group this instructor is grading)
       ├──< RosterEntry                       (who is expected, before they sign in)
       ├──< Enrollment ──< GroupMembership >── CourseGroup
       │              └──< AttendanceRecord >── AttendanceSession
       ├──< CourseGroup
       ├──< TeamSet ──< Team ──< TeamMembership >── Enrollment
       ├──< AttendanceSession                 (one meeting, on one civil day)
       └──< CourseUnit ──┬──< Assignment ──< Submission ──< GradingDraft ──< GradingDraftSection
                         │        │                     └──< TestRun
                         │        └──> TeamSet   (null = each student hands in their own)
                         └──< Resource

Submission ──> Submission   (a member's mirror of the row holding their team's work)

Rubric ──< (referenced by assignment.sections[].rubricId)

AuditEvent            (no foreign keys, deliberately — see below)
```

Enums: `Role`, `EnrollmentStatus`, `AssignmentKind`, `ResourceKind`, `VideoProvider`, `RubricScaleType`, `SubmissionStatus`, `SalesforceSyncStatus`, `GradingDraftStatus`, `Confidence`, `TestRunStatus`, `TestRunTrigger`, `AttendanceStatus`, `AttendanceSource`, `AuditAction`.

- **A module has two kinds of child, and they are siblings**: `Assignment`, which is submitted and graded, and `Resource`, which is neither. See [resources](#resources-what-is-in-a-module-that-is-not-work).
- **A group joins to an `Enrollment` rather than a `Profile`**, so the foreign key guarantees a group's members are students of that group's course. See [groups](#groups-and-grading-a-portion-of-a-cohort).
- **`attendance_sessions.date` is the only `date` column in the schema**, and `attendance_records` reaches its enrollment through a composite key rather than a plain one. Both are load-bearing rather than stylistic — see [attendance](#attendance).

**`profiles`**

- Carries the `Role` enum, `githubUsername`, a display name fallback, and `githubUserId BigInt? @unique`.
- The numeric ID is written by the `sync_github_identity` trigger from `auth.identities.provider_id`, guarded by a regular expression because that column is text and other providers put non-numeric values in it.
- Repository naming uses the username, which is the existing convention, which is why `submissions.repo_github_login_at_creation` exists.
- `display_name` is filled at signup by `handle_new_user` and is the only column here a person may change about themselves, through `updateDisplayName`. See [your own account](#your-own-account-and-the-name-a-roster-shows).
- `anon` and `authenticated` may write nothing on this table. `verify:staff` asserts the writable set is empty, because a slipped grant would let a student set their own `role` from browser JavaScript without going through any procedure.

**`roster_entries`** is who is expected in a cohort, written before they have an account — see [getting students into a course](#getting-students-into-a-course). Three CHECK constraints carry what Prisma cannot say: an entry needs at least one of `github_username` and `email`, both are stored equal to their own lowercase, and `claimed_by_id` and `claimed_at` are set together or not at all.

**`audit_events`**

- An append-only record of the acts that decide who can see whose work; the list is in [what the audit log records](#what-the-audit-log-records).
- **No foreign keys, deliberately.** A key gives one of two behaviours when its target is deleted and both destroy the record: `Cascade` removes the event, `SetNull` rewrites it — which the append-only trigger would refuse anyway, deadlocking an ordinary profile deletion. Every reference is a plain uuid beside a text snapshot of the name at the time.
- Append-only is enforced by triggers on UPDATE, DELETE, and TRUNCATE rather than by grants, because grants do not constrain Prisma.
- `actor_id` is always the real signed-in person: `createTRPCContext` substitutes a test student's id onto `ctx.user` during a [view-as session](#seeing-a-course-as-a-student-sees-it), so `auditActor` reads `ctx.viewingAs` first and records the substitution in `acted_as_id`.

**`modules`**

- A course's own list, created and named by an instructor, tied to nothing outside the application. `assignments.moduleId` is a foreign key onto it.
- **The id is the identity, not the name.** Which module an assignment belongs to and where its reference solutions live are separate questions, answered by `moduleId` and `answerKeyRepo`.
- **Renaming is one column.** With the name as identity, a rename would rewrite every assignment that used it and still fix nothing outside the database.
- **"The module must exist first" is a foreign key**, not validation a second caller could forget. `onDelete: Restrict`, so removing a module cannot take its assignments, their submissions, or the drafts beneath those.
- **Ordering is `position`**, an integer an instructor sets, deliberately not unique: `reorder` rewrites the whole sequence in one statement, and a unique constraint would refuse the intermediate states.
- `@@unique([courseId, name])` gives one "Mod 4" per course. Modules are **per course**, so one cohort reordering or dropping a module cannot change another's records.
- **`reorder` is a single raw `UPDATE`.** One update per module in a transaction has two problems: a half-applied order is worse than none, and Prisma refuses a nested interactive transaction, so any caller already inside one — every verification script — fails. `course_id` is in the predicate as well as checked beforehand.

**`assignments`**

- Carries `kind`, `templateRepo`, `answerKeyRepo`, `assignmentRepoName`, `githubOrg`, `completionThreshold`, `dueAt`, `distributedAt`, `runnerPreset`, `runnerConfig`, `templateRef`, `templateDriveUrl`, `acceptedFileTypes`, `submissionInstructions`, `teamSetId`, and the `sections` JSON array.
- `@@unique([courseId, assignmentRepoName])` prevents two assignments in one course generating colliding repository names.
- **`teamSetId` is what makes an assignment [team work](#teams-and-work-handed-in-by-several-students)**, and null is one submission per student. `Restrict`, so a set cannot be deleted out from under work that was graded through it, and the foreign key is composite against `(id, courseId)` so it cannot name another cohort's set.
- **An assignment names the two repositories it uses.** Both are pasted as URLs and stored as `owner/repo`; `lib/assignments/repo-ref.ts` accepts a browser address, clone URL, SSH remote, or bare `owner/repo`, and the schema normalizes before validating.
- **An address pointing inside the answer-key repository fills both columns at once.** Pasting `…/tree/main/answer-keys/mod-1-js-fundamentals/swe-1-2-strings-conditionals` names the repository and the folder: the files under that folder are the reference solutions. A `/blob/` link resolves to its containing folder. The branch in `/tree/main/` is dropped, because answer keys are read at the default branch.

### Why the folder rather than a list of files

A stored list of paths goes stale the moment somebody adds a reference solution, with no symptom but a slightly worse grade. The folder is resolved on every run.

- **Recognisable binaries are skipped**, or an archive beside the source files would be base64-decoded into a prompt as code — `swe-checkpoint-summative-1-4` has a `solutions.zip`. The rule is a **denylist** of archives, images, documents, media, fonts, and compiled artifacts; an allowlist would silently drop the first `.sql` or `.py` answer key somebody writes.
- **Every exclusion is reported**, on the authoring screen and on the draft.
- **The count is capped at 40 files per section**, as a backstop. The authoring screen lists the resolved files before saving, which is what actually catches a wrong folder.
- **A multi-section assignment gives every section the whole folder**, so each section's prompt carries the other's reference material. Accepted knowingly: the direction of travel is one section per assignment.

Repository fields:

- **`templateRepo`** must be readable by the installation that will generate from it and must have GitHub's template flag set. The flag is checked at authoring time, because `generate` otherwise fails at the moment a student presses Accept, with a message about the API. Private is fine — a private template in a covered organization generates normally. Public buys reach: an installation token reads any public repository, including in organizations the App was never installed on.
- **`answerKeyRepo`** holds the reference solutions and must be private. A public one is refused rather than warned about.
- **`answerKeyDir`** is a folder inside it, and every file under that folder is the reference set. `""` is the repository root.
- **Two answer-key failures are reported differently.** A repository that does not exist and a private one in an organization the App was never installed on both answer 404, but the first is a typo and the second is an installation nobody can perform from a form. They are told apart by asking whether the App is installed on that owner.
- **The folder is browsed, not typed.** The authoring form walks the named repository directory by directory and lists what the chosen folder resolves to. Recursively, because keys nest — `swe-1-3-node-modules` keeps two of its three under `madlib-challenge/`.
- **Drift is possible**, and stated rather than hidden: a named repository can be renamed, made private, or deleted upstream. Validation checks reachability whenever a draft is saved or published and reports it as a finding on the authoring screen.

**`kind`** is what a student turns in, and it decides distribution, submission, and delivery. All four can be created, published, submitted, and graded.

| Kind           | Distributed as                         | Collected as                                    | Graded by     |
| -------------- | -------------------------------------- | ----------------------------------------------- | ------------- |
| `REPO`         | a repository generated from a template | a pull request                                  | the pipeline  |
| `GOOGLE_DRIVE` | a link to Google's own copy prompt     | a link to the student's copy                    | an instructor |
| `FILE_UPLOAD`  | nothing — there is no Accept           | [a file in private storage](#handing-in-a-file) | an instructor |
| `EXTERNAL_URL` | nothing — there is no Accept           | a link to work made elsewhere                   | an instructor |

- What differs is how far the pipeline reaches, not whether a kind works. Reading a Drive file's or an uploaded file's contents and generating a report is a separate feature needing instructor-authored rubrics.
- **`GOOGLE_DRIVE` is one kind for Docs, Sheets, and Slides.** Each is handed out as a `/copy` link built the same way, handed in as a link to the student's copy, and graded by hand. The editor is a property of the link, not of the assignment.
- **The URL check names the three editors rather than accepting any Google address.** `assignmentSpecSchema` matches `docs.google.com/(document|spreadsheets|presentation)/d/<id>/(view|edit|preview)`. A Form, a Drawing, a Drive folder, and a published `/pub` link are all `docs.google.com` and none produces a copy prompt from the substitution, so admitting them would move the failure to every student who pressed Accept.
- **`EXTERNAL_URL` is for work made on a service this application knows nothing about** — Canva, Loom, a deployed site, Figma. It differs from `GOOGLE_DRIVE` in distribution: a Drive assignment hands out a template, which is what lets it check the submitted link's shape. This kind hands out nothing, so any https link is legitimate. `LINK_SUBMITTED_KINDS` is what the two share, and `assertCanHandIn` takes `expect: "link" | "file"` rather than a kind, so a fifth kind cannot be admitted by one caller and refused by another.
- **`EXTERNAL_URL` has no field for a starting link.** `submissionInstructions` is markdown and does the job better — an instructor writes "start from [this Canva template](…)" alongside everything else. A column would also imply the copy-prompt machinery that only `GOOGLE_DRIVE` has.

The three GitHub columns are **nullable, required only when the kind is `REPO`**, enforced by the Zod schema rather than by the columns. `templateDriveUrl` mirrors that for `GOOGLE_DRIVE`, and `acceptedFileTypes` for `FILE_UPLOAD` — non-empty for that kind and empty for the rest, empty rather than nullable because "which file types does a Drive assignment accept" has an answer and it is none.

- **`@@unique([courseId, assignmentRepoName])` needed no change**: Postgres treats NULLs as distinct, so it constrains repository-backed assignments and ignores the rest.
- **Nothing reads those columns without asserting the kind first.** `repositorySource(assignment)` narrows all four in one place and distinguishes three failures: `NotRepositoryBackedError` (the kind works and has no repository, so the caller should not have asked), `UnsupportedAssignmentKindError` (a kind nobody has built), and `AssignmentConfigurationError` (the only one an instructor can act on — a `REPO` row missing `githubOrg`, naming the column).

**Sections and the spec**

- **Every section of an assignment is graded the same way**, all by the pipeline or all by hand; a mix is refused by `assignmentSpecSchema`. A partial report means the assignment's point total exceeds what approving can record, so a 30-point assignment releases as 20 out of 20. Several sections graded the same way are ordinary — the checkpoint has two, both by the pipeline.
- **The two non-repository kinds accept only manual sections**, because the pipeline's inputs are a pull request's changed files, the template's tests, and the paths `classifySections` matches.
- **`lib/assignments/spec.ts` is what a valid assignment is** — one Zod definition discriminated on `kind`, used by the seed and the authoring procedures, so the seeded and authored shapes cannot drift. `pointValue` is *returned* by `parseAssignmentSpec` rather than accepted, so no input can make the gradebook column disagree with the reports beneath it. `npm run verify:authoring` checks these rules as pure functions.

**`submissions`**

- One row per assignment and student, carrying repository and pull request identity, `headSha`, `gradedHeadSha`, `submittedUrl`, the four `upload*` columns (written together or all null, never the same thing as a link), `submittedAt`, `isLate`, `lastActivityAt`, the final score fields, and three dormant Salesforce columns.
- `repoFullName` is unique, which lets the webhook match an event with one indexed lookup — and is why only the one row holding a team's work can carry one.
- **`teamId`, `teamSetId`, `teamSubmissionId` and `handedInById` are the team columns**, all null on work a student does alone. A row with a team and no `teamSubmissionId` holds that team's work; the rest point at it and are [mirrors](#teams-and-work-handed-in-by-several-students). A partial unique index on `(assignment_id, team_id)` allows exactly one of the first kind, three CHECK constraints refuse a half-written team and a row that mirrors itself, and a trigger refuses a chain of mirrors — none of which Prisma can express, so all of them are hand-written in the migration.
- The Salesforce columns let a future job query `WHERE salesforce_sync_status = 'PENDING'` without a migration then; nothing writes them today.

**`grading_drafts`**

- One row per grading run, keyed by submission and head SHA. A new push creates a new row and marks the previous one `SUPERSEDED`, so an in-progress review is never silently replaced.
- `modelMetadata` records the model id, prompt version, grading asset commit SHA, and all four token counts, and is **null on a hand-written draft** — which is what tells the two apart.
- `headSha` is nullable for the same reason: work with no commit has none, and every reader compares that column against the submission's own, so null compares as "no commit to be out of date against".
- Approval details — `approvedAt`, `approvedBy`, `postedPrCommentId` — live here rather than on the submission, because each approval posts its own comment and a submission's approved drafts in order are its feedback history.

**`grading_draft_sections`** are child rows, because one submission can have more than one graded section per run. The submission's final score on approval is the sum of a run's section scores.

**`test_runs`** is described under [test execution](#test-execution).

### Signing in

- **GitHub, and nothing else.** No password form, no self-service signup, no password reset. Students need a GitHub account for the coursework regardless, so this asks for nothing new and removes passwords to reset, reused passwords, and a reset flow reachable by anyone holding a mailbox.
- **The Supabase side is what closes it.** The publishable key is public by design, so `signUp` and `signInWithPassword` stay reachable whether or not a form calls them. Disabling the Email provider in the Supabase dashboard is the half that closes the door — and is also the way back if everybody is locked out of GitHub, which is why `app/auth/confirm/route.ts` is kept. See [getting back in](#getting-back-in-if-everybody-is-locked-out-of-github).
- **`app/auth/callback/route.ts` exchanges the PKCE code for a session.** It and `/auth/confirm` honour only relative paths in `next`, because an absolute URL would be an open redirect firing just after authentication.
- **Identity belongs to Supabase Auth.** `Profile.id` is a foreign key onto `auth.users.id`, and `handle_new_user` creates the profile. Test students are the one identity this application makes rather than receives — see [seeing a course as a student sees it](#seeing-a-course-as-a-student-sees-it).
- Two-factor is GitHub's; the dashboard settings not in this repository are under [security](#security).

### Getting students into a course

- **Two things together admit a student.** The link is unguessable, which stops somebody finding a cohort; the roster is an allowlist, which stops somebody who was *sent* the link from being admitted by it.
- **`courses.joinToken`** is one unique token per course, with **`courses.coTeachToken`** beside it. Per course rather than per student because distributing the link is a person's job either way. The token is random rather than derived from the course id, which appears in every course page's address. It is returned only by `courses.roster`, which is instructor-only and teach-gated; the co-teach token sits behind the same pair on `courses.settings`.
- **`roster_entries`** names each expected person by GitHub login, by email, or by both, with a free-text note. Entries are pasted on the roster screen; `lib/courses/roster-input.ts` parses commas or tabs in any column order, and the browser previews what it understood using the same function the procedure parses with.
- **Either key matches**, because each fails where the other covers: a student who renames their GitHub account no longer matches by login, and one whose GitHub email is private presents a `users.noreply.github.com` address that was never on any roster. Both keys are stored lowercased, with a CHECK constraint saying so.
- **One entry admits one person, once.** `claimedById` is set in the same transaction as the enrollment. A removed and later restored student still matches their own claimed entry — the check is "unclaimed, or claimed by you" — and a claimed entry cannot be deleted, because it is the record of how somebody got in.
- **An enrollment that already exists outranks the roster.** `join` and `preview` both answer from the enrollment before consulting the list. An entry can be absent for reasons that say nothing about belonging: staff are exempt, a claimed entry can be tidied, and a cohort may predate its own list.
- **Staff are exempt**, so the guarantee is "everybody enrolled as a student was expected by name, or is staff".
- **`regenerateJoinToken` and removing a student** are the controls for a link that went astray.

### The cohort is in every repository name

- **`courses.cohortSlug` prefixes every repository a cohort generates**: `{cohortSlug}-{assignmentRepoName}-{github login}`, so `swe-f26-swe-1-4-loops-benspector3` sits beside `swe-s27-swe-1-4-loops-benspector3`. Built in one place, `studentRepoName`, because a second caller assembling it differently would create repositories nothing could find again.
- **Without it, two cohorts of the same program collide.** A student in both — repeating a module, or an instructor testing a copied cohort — would want a repository their other cohort already holds. `@@unique([courseId, assignmentRepoName])` does not catch it: it is per course, and the collision domain is the organization.
- **Suggested from the course name and the term together, then editable once.** "Data Science" starting "Fall 2026" offers `data-science-f26`; "Software Engineering Fellowship" offers `sef-f26`. The form follows both fields until somebody edits the slug, tracked as "have they touched it" rather than by comparing values.
- **Both halves are in it because neither is unique alone.** Every program starts in the fall, so a term-only suggestion would make `fall-2026` the short name of whichever course was created first and a refusal for every other program that season.
- **The course name is either whole or its initials, never half of itself**, and that does not change with the season. `software-engineeri` is a name nobody would choose; `sef` is visibly an abbreviation, so somebody who wants `swe` can see there was a decision. The course half is measured against the longest a compacted term can be, so a fellowship does not read `software-engineering-f26` in autumn and `software-sp27` in spring.
- **Settled when the course is created and never again.** There is no `setCohortSlug`, which is why creating a course has a review step. A typo caught afterwards is fixed by creating the course again or by a one-line database update, which is safe while the course has no submissions.
- **Shown on one screen, the cohort's settings**, where the example repository name is built with `studentRepoName` — the same function `accept` calls. The screen says why it cannot be changed and counts the repositories already named after it. `courses.settings` is the only procedure that returns it.
- **Frozen once anybody in the course has accepted anything**, the same rule as an assignment's repository name: those repositories are already named after it.
- **Unique across every course, archived ones included**, because their repositories still exist. The constraint is the guarantee; naming both halves only makes collisions rare. Two cohorts of the same program in the same term, or two programs abbreviating the same way, are a named refusal rather than a constraint error.
- **Two guards remain**, both near-unreachable and cheap. `accept` looks for the claimed repository before touching GitHub and refuses, naming the course that holds it. Authoring warns when the slug and assignment name leave fewer than 39 characters for a login, since GitHub allows 100 in a repository name and 39 in a login. The second cannot fire on this curriculum — the longest assignment name is 28 and the slug is capped at 24, leaving 46 where 39 is the maximum — and stays as insurance against names growing.
- **An `Enrollment` row is created *by* somebody joining**, so `studentId` is `NOT NULL` and there is no "invited" state. `@@unique([courseId, studentId])` makes redeeming a link twice return the existing enrollment. A removed student redeeming again is refused, because otherwise removal would not stick while they held the link; coming back is `enrollments.restore`, called by the instructor.
- **The join link is behind authentication, and the proxy carries the destination.** `/join/[token]` sits inside the authenticated shell, so an unauthenticated visitor signs in and arrives back at the link, which binds the enrollment to whoever signed in. The proxy sets `?next=` because a join link is the one address somebody reaches having never signed in.

### `assertCourseMember` and `assertActiveStudent` are two different questions

Because [removing and archiving never take work back](#standing-decisions), "is this person in this course" has two right answers:

|                       | Admits                                                     | Governs                                                     |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `assertCourseMember`  | active students, **removed students**, instructors, admins | a course's screens, an assignment's page, released feedback |
| `assertActiveStudent` | active students only                                       | `accept`, `submitWork`, the upload route                    |
| `assertOwnsOrTeaches` | the student whose work it is, or an instructor of it       | minting a signed URL for a stored file                      |
| `adminProcedure`      | admins only                                                | everything on `/admin` — invitations, and who is an admin   |

- They live together in `lib/courses/membership.ts` because the first two `where` clauses differ by one enum value in otherwise identical code. Written at each call site, the failure is not noticing there was a decision to make.
- `assertOwnsOrTeaches` is the whole of the access control on uploads: the bucket is private and carries no policies, so there is no other route to the bytes.
- **The write paths were already right; the read paths were the work.** `accept` and `assertCanHandIn` each check `ACTIVE` themselves, because a mutation must not assume which query preceded it. The four read checks had to widen.
- **`courses.listMine` returns `enrolledAs`**, so a card can say *no longer enrolled*. A course that silently reappeared, indistinguishable from the cohorts they are still in, would tell a student something false.

### Who may teach, and who may decide that

- **Three mechanisms, for three questions.** `staff.createInvite` is how somebody *becomes* staff and works before they have an account. `staff.setAdmin` is how an existing account gains more, which makes "an admin can let others invite people" reachable. Both are `adminProcedure`, because an instructor deciding who else becomes an instructor is the escalation that guard prevents. The third is a cohort's co-teaching link, which decides which courses an existing instructor works in and is the one an instructor may hand out.
- **An invitation is single use and expires in seven days**, unlike a reusable cohort join link, because it admits somebody to authoring and to every student's grades in every course. Single use is enforced by `updateMany` with `redeemedAt: null` in the `where`, not by read-then-write, so two simultaneous redemptions resolve to one winner.
- **Redeeming raises the role and never lowers it.** `raiseRole` exists because `role: 'INSTRUCTOR'` would silently demote an admin — and the admin who generated the link is the person most likely to click it.
- **A used invitation is kept and cannot be deleted.** It has become the record of how somebody got access. Revoking access is a role change.
- **Revoking the last admin is refused.** Nothing grants the *first* admin, so an application with no admins has no way back except a database edit. `npm run grant:admin -- you@example.com` is that base case; it cannot create an account, because identity belongs to Supabase Auth, and it has no reverse.
- **The guarantee outside any procedure**: `anon` and `authenticated` hold no privilege on `profiles` or `instructor_invites`, so neither can be read or written from client JavaScript. `verify:staff` asserts the writable set on `profiles` is empty.

### Co-teaching one cohort

- **`courses.coTeachToken`** is a second link per course, shown on its settings screen. Opening it and pressing the button writes a `CourseInstructor` row with `isPrimary: false`.
- **It grants a course and never a role.** Only an account already holding `INSTRUCTOR` or `ADMIN` can redeem it; a student is refused and told an admin has to send an instructor invitation. The refusal is stated on arrival as well as enforced by the procedure. Without that guard, any instructor could hand out staff access by forwarding a link.
- **A second column rather than a reuse of `joinToken`**, because the two links grant opposite things. And a second address, `/co-teach/[token]`, so a screen never has to work out which link it is looking at before it can say anything true.
- **Reusable**, because it is bounded by the role check rather than by being spent, and a cohort gains co-teachers across a term. `regenerateCoTeachToken` is the control.
- **Two refusals are about the cohort**: an archived one takes no new instructors, and somebody enrolled as a student cannot also teach it — the mirror of `enrollments.join` refusing an instructor, since being both would put their own submissions in the queue they work through.
- **Removing the last instructor is refused**, the same shape as revoking the last admin: every authoring procedure gates on `CourseInstructor`, so a course with no rows there cannot be authored in or graded by anybody.
- **Nothing is taken back on GitHub, in either direction.** `accept` adds every `course_instructors` row as a collaborator at the moment a student accepts, so an instructor added later is not on repositories that already exist, and one removed stays a collaborator on repositories generated while they taught. The settings screen says the first out loud.

### Who owns a cohort

Everybody who teaches a course authors, reads every submission, and approves grades. **The owner also decides whether the cohort is archived and who else teaches it** — the two actions that reach past the person performing them.

- **The owner cannot be removed by anybody else.** They can leave on their own account.
- **The owner can hand the cohort on.** `transferOwnership` moves it to another of the course's instructors; leaving afterwards is the ordinary removal. Without it, the rule above would read as "whoever set this up runs it forever".
- **Only the owner archives, and only the owner reopens.** One mutation with a boolean, so it is one gate. A co-teacher finds an archived cohort in their course list, reads all of it, and cannot bring it back.
- **Ownership is derived rather than only stored.** The owner holds `course_instructors.is_primary` — written for the creator by `courses.create`, moved by `transferOwnership` — and where no row holds it, the owner is the longest-serving instructor. `ownerOf` in `lib/courses/ownership.ts` is the only place that decides, and the settings screen reads the answer from the server rather than computing its own.
- **The fallback is what makes a deleted account safe.** `CourseInstructor` cascades on the profile, so deleting an owner's account would otherwise leave a cohort with instructors, none of whom could archive it or remove anybody. Nothing here deletes a profile — that is a database action taken by hand — which is exactly why the rule has to hold with nobody there to invoke it. It also covers an owner who leaves without transferring, and the procedure says who inherited.
- **An admin acts as owner on every course**, as the recovery path for an owner who left without handing the cohort on.
- **One primary per course is a database constraint:**

```sql
CREATE UNIQUE INDEX "course_instructors_one_primary_per_course"
  ON "course_instructors" ("course_id") WHERE "is_primary";
```

Transfer is what would otherwise produce two, and two owners fails quietly — every reader takes the first row it finds. Prisma cannot express a partial index, so it lives in the migration; `migrate diff` cannot see it either, which is why it survives the next schema change rather than being proposed for removal.

### Deleting a cohort

- **Permanent, and the largest destructive operation here**: the course takes its modules, assignments, submissions, grading drafts, sections, test runs, enrollments, and instructor rows with it. There is no soft delete and no in-application recovery; the database's backups are the only way back, which the screen says.
- **Archived first, and owner only.** Archiving is reversible and this is not, so it puts a survivable step in front of a permanent one. Owner only is the same gate archiving uses, because otherwise any co-teacher could archive and then delete. Both conditions are asked in one place shared by `courses.removalImpact` and `courses.remove`.
- **`removalImpact` exists so the confirmation states facts.** "24 students, 12 assignments in 6 modules, 187 submissions of which 143 carry a released grade" is something somebody can weigh. The counts are read before the box that unlocks the button.
- **The typed confirmation asks for the cohort's short name**, enforced in the procedure rather than the dialog. The short name because a program runs every term under the same name, while `cohortSlug` is unique by construction.
- **Uploaded files are deleted; GitHub repositories are not.** A repository holds work the student can reach on GitHub regardless. An object in the private bucket had exactly one reader, the row about to go, so leaving it would be a file nobody can ever reach. Storage removal runs after the rows and is best effort, and the paths that would not go are named in the result.

### One student, or one assignment: the same screen from two sides

- `submissions.listForAssignment` reads one assignment across many students; `submissions.listForStudent` reads one student across many assignments. **They are the same screen**, sharing `reviewableSubmissionSelect`, `decorateSubmission`, `SubmissionRow`, and `GradingReview`. A field selected for one and missed by the other is a crash in the review pane, not a visible difference.
- **Only the label differs, so only the label is a prop.**
- **Three differences, each with a reason.** A student's record has a row for *every* assignment, including ones they never started, because "has not begun this" is a fact a list of only their submissions cannot state — where the grading queue omits a student who never accepted, since it asks what is left to grade. It has no search box. A row's second line is the module rather than a relative time, since forty rows reading "3 days ago" order nothing.
- `completionThreshold` moves from a page-level prop to a per-row one, because every row is a different assignment.
- **Reachable from the three places a name appears**: the roster, the gradebook's sticky first column, and the student's name in the review header. That header takes `studentHref` as an optional prop and renders plain text without it.
- **The page carries its own cohort selector**, listing only courses this student is in *and* the caller teaches. The sidebar's switcher knows nothing about the student; a student repeating a module has two records, and this is how you get from one to the other.

### A removed student's work

Stopping the enrollment does nothing to the submissions, so a departed student's work must be kept out of the piles that say whether an instructor is caught up.

**The same two questions, asked about a cohort's work rather than about the caller**, living in `membership.ts` beside the pair above. Every instructor-facing read is either a **list of work waiting**, which a departed student contributes nothing to, or a **record of what happened**, which they are part of.

|                                   | Used by                                     | Effect                                                  |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `activeStudentWork(courseId)`     | `submissions.triage` and its approved count | a removed student's work is not in the pile             |
| `removedStudentIds(db, courseId)` | `submissions.listForAssignment`             | partitions one query into the queue's list and the rest |

- **The counts are the other half.** `courses.gradebook` returns `cells` narrowed to active students and `removedCells` beside it; `courses.assignmentsOverview` computes its "to grade" column from the same set. A check asserts all three readers return the same figure.
- **`listForAssignment` returns two arrays**, `submissions` and `removedSubmissions`. The queue lists only the first; the review pane opens a row from either, with a banner naming the student who has left. The gradebook's Removed table links straight there.
- **An ungraded submission in the Removed table says "Not graded"**, not the amber "waiting on you" dot, because nobody's action is outstanding. Nothing is closed or rewritten on removal, so `enrollments.restore` puts the work straight back — every filter reads live enrollment status.
- **Every partition is a set and its complement**, never two named statuses. `REMOVED` is the only non-active value today, and filters naming both would silently drop an `AUDITING` student from the roster and the gradebook alike.
- **A gradebook and a roster want opposite things, so they are two reads.** `courses.roster` returns every enrollment with its status, so it can offer to restore. `courses.gradebook` returns `activeEnrollments` and `removedEnrollments` as complements, and the grid draws two tables with only the active ones in any count.

### Seeing a course as a student sees it

A published course cannot be checked from the outside: the Modules screen shows a course's shape and has nothing to press. A **test student** is a student-shaped identity an admin creates, looks through, accepts work as, and grades from the instructor side. Its submissions are ordinary rows and its repositories are ordinary repositories.

- **`Profile.testStudentNumber` is the whole of the data model** — one nullable unique integer whose presence says the profile is a test student and whose value is the number in its name. One column rather than a boolean beside a counter, and unique so two admins creating one at the same moment resolve at the database. `Test Student 3` carries the handle `test-student-3` and the address `test-student-3@test.invalid`, all derived in `lib/students/test-student.ts`.
- **The number counts across the deployment, not per cohort**, because a profile has no course. The same test student can sit in several cohorts, and must, since `github_username` is unique. Reusing one is safe: the repository name carries the cohort slug. The roster's dialog offers a new one or one that already exists.
- **The account is created, which nothing else here does.** `lib/supabase/admin.ts` speaks to two auth admin endpoints over plain `fetch` — not `createClient`, which eagerly builds a realtime client needing a global `WebSocket`. Both functions take an authorized caller and refuse one that is not an ADMIN, because the service role key bypasses row level security and every policy; the required parameter makes a new call site a compile error.
- **Creation is recoverable.** The on-signup trigger writes the profile and `testStudents.create` marks it. The unique address is the interlock against a concurrent creation, and an account whose profile was never marked is **claimed** on the next attempt rather than stepped over, so a create that died between the two steps is repaired by pressing the button again.
- **Switching in is one substituted field.** A session cookie holds the test student's profile id; `createTRPCContext` re-establishes on every request that the caller is an ADMIN and the target is a test student, then replaces the id on the context's user. `ctx.user` is read for its `.id` and nothing else, so `profileProcedure`, `requireRole`, `studentProcedure`, `assertActiveStudent`, and the sidebar all follow. Server Components go through the same function.
- **The cookie is unsigned and never trusted**, so an admin later demoted stops being able to use it at their next request. Entering and leaving are route handlers rather than mutations: a mutation cannot reliably write a cookie, and while the cookie is set the caller reads as a student, so an admin-guarded exit would refuse the one person entitled to press it. Leaving checks nothing. An amber bar across every screen names who is being looked through.
- **Leaving lands on the roster the admin switched in from**, recorded by a second cookie at that moment — a test student can be in several cohorts, and the question is which one was being checked. Two cookies rather than two values in one, because they carry different authority: the first is an entitlement re-established from the database on every request, the second a destination whose worst failure is the wrong roster. It is validated as a uuid before reaching a path, and cleared when a switch names no course. The fallback is `/instructor`.
- **Accepting differs in exactly one respect: who is invited.** `test-student-3` names no GitHub account, so the admin looking through it is invited instead, with push, and is the account that pushes on the test student's behalf. Everything downstream is unaware. Accepting is refused outright when there is no admin behind the test student, or that admin has no linked GitHub account — stricter than the real-student path, where a missing instructor handle is only a warning.
- **A second admin can push to somebody else's preview repository** only if they are a listed instructor of that cohort, or the organization's base permission is Write. The ordinary answer is that each admin creates their own.
- **One count excludes them and every list includes them.** `courses.listMine` leaves them out of the student count on a course card; the roster, gradebook, and triage list them like anybody, carrying a Test badge from one shared component.
- **Deleting one is wider than removing it from a cohort.** Remove is the enrollment control every student has. Delete destroys the identity: repositories are deleted from GitHub first, because the rows name them, then the auth user goes and the profile cascades with every enrollment, submission, test run, and grading draft. It reaches every cohort the test student is in, which the confirmation names. A repository that fails to delete is reported rather than fatal. `deleteRepo` is the only destructive GitHub call in the application.

### Migrations are authored with `migrate diff`, never `migrate dev`

- **A running dev server does not notice a regenerated client.** The Prisma client is generated to the gitignored `lib/generated/prisma`, so Next's watcher does not invalidate the compiled chunk holding it. A dev server started before a migration reports the new column as `Unknown argument` or `Unknown field ... for select statement`. The fix is `rm -rf .next && npm run dev`; `predev` runs `prisma generate`. The error points at the query rather than the cause, so the shape is worth recognising.
- **`prisma migrate dev` reports drift that is not real** and offers to reset both the `auth` and `public` schemas. `tables.external` in `prisma.config.ts` excludes Supabase's auth tables from diffing, but there is no equivalent for enum *types*, so `aal_level`, `factor_type`, `one_time_token_type` and the rest always look like enums the history did not create. The full recipe is at the bottom of `prisma.config.ts`; `npm run db:migrate` is a guard pointing at it.

---

## GitHub integration

- **The App.** Permissions: Administration (read/write, for repository generation and collaborators), Contents (read/write), Pull requests (read/write), Members (write), Metadata (read). Webhook events: `pull_request` only — no `push` subscription, because the pull request is the submission signal.
- **`lib/github/`** — `app-client.ts` mints installation tokens and provides a lazy Octokit instance; `repos.ts` holds `generateRepoFromTemplate`, `getRepo`, `addCollaborator`, `removeClassroomWorkflow`; `prs.ts` holds `getPullRequestFiles` and `postOrUpdatePrComment`; `archives.ts` fetches tarballs; `files.ts` reads individual files; `webhook-verify.ts` verifies `X-Hub-Signature-256`.
- **A GitHub App is installed per organization.** The grading guides are in `The-Marcy-Lab-School` and student repositories in `marcy-lms-test`, and the installation covering one cannot read the other. Install it on every organization holding grading assets; which installation reads a repository is resolved from that repository's owner, with no per-organization variable. `scripts/list-installations.ts` prints the ids.

**`assignments.accept`** authorizes, loads, then branches on the kind with a `switch` over all four, so a fifth is a compile error rather than a request falling through to the repository path. The two kinds that have an accept live in `lib/assignments/accept.ts` rather than the procedure, and take a client rather than reaching for one, so a check script can drive the act inside a transaction it then rolls back.

- **`GOOGLE_DRIVE`** records the submission as `ACCEPTED` and returns the copy prompt — `templateDriveUrl` with its last path segment replaced by `/copy`. The application creates nothing, holds no Google credentials, touches no student's Drive, and the copy belongs to the student from the moment Google makes it. The substitution works because of how Google's editor URLs are shaped, which is why `assignmentSpecSchema` checks the link's shape: an unmatched link would be left untouched, sending every student to the instructor's own file. The alternative was Drive API integration with OAuth against every student's Google account.
- **`FILE_UPLOAD` and `EXTERNAL_URL` have no accept.** There is nothing to hand out, so the assignment stays `NOT_STARTED` until the student submits.
- **`REPO`** creates the repository from the template as `{cohortSlug}-{assignmentRepoName}-{github login}`, adds the student as a collaborator with push, adds every `course_instructors` row as a collaborator, waits for the template copy to land, removes `classroom.yml`, records the repository identity, and sets `ACCEPTED`. It is idempotent: a repository created by a previous attempt whose database write never landed is reused. An instructor with no linked GitHub account is skipped with a warning.
- **The template copy is asynchronous, which is why there is a wait.** Measured: `generate` returned at 2.1 seconds and the new repository's tree became readable at 5.6. In between, GitHub answers a contents request with 404 and the body `"This repository is empty."` — the same status as a missing file, so the body is the only thing that tells them apart. `waitForRepoContent` retries on that specific 404 with lengthening gaps, and `removeClassroomWorkflow` returns `removed`, `absent`, or `repository-empty`.
- **A repository still empty after the wait is logged, not failed.** It exists and the student can work in it. The window matters more now that an instructor can name any public template, which may be large.

**The webhook** (`app/api/webhooks/github/route.ts`) verifies the signature against the raw body, answers `ping`, and returns 200 for events it does not handle so GitHub does not mark it failing. For `opened`, `reopened`, and `synchronize` targeting `main` it matches `repository.full_name` to a submission:

| Event                 | Current status          | Result        |
| --------------------- | ----------------------- | ------------- |
| `opened` / `reopened` | anything but graded     | `SUBMITTED`   |
| `opened` / `reopened` | `GRADED`, `RESUBMITTED` | `RESUBMITTED` |
| `synchronize`         | any                     | untouched     |

- **Keyed on the current status as well as the action.** A student who closes a pull request and opens a new one fires `opened` again, and treating that as a first submission would reset a graded row. `synchronize` records the new commit and never changes the status, because a commit is not a claim of completion.
- **`submissions.submitWork` is the same signal for a kind with no webhook.** It sets `SUBMITTED`, stamps `submittedAt`, stores `submittedUrl`, and computes `isLate` against `dueAt` exactly as the webhook does. It serves both link-submitted kinds and refuses the other two: `REPO`, because it would let a student mark work submitted with no code and make the webhook a second authority on the same columns, and `FILE_UPLOAD`, because [storing the file is itself the act of submitting](#handing-in-a-file).
- **A student who opens a pull request before starting appears in the queue with almost nothing in it.** That is visible immediately and the model remarks on it, where work never declared ready is silently never reviewed. Students need to be told that opening the pull request is the submission.
- **The webhook awaits its work before responding.** Vercel stops executing after the response is sent, and the work is one database update taking milliseconds, far inside GitHub's timeout of roughly 10 seconds.

---

## Test execution

The output is a stored, trustworthy answer to one question: **what do the instructor's tests say about this student's code at this commit?** No model is involved and nothing is posted to GitHub. It is separate from report generation because the two fail in unrelated ways.

```ts
export async function runTestsForSubmission(
  submissionId: string,
  opts: { trigger: TestRunTrigger },
): Promise<TestRun>
```

`lib/sandbox/run-tests.ts` exports that one function, which takes a submission id and reads everything else itself. It does not know what invoked it, which is the accommodation made for the deferred orchestration decision. Callers today are `testRuns.start`, `npm run tests:run`, and report generation.

### Runner presets

Nothing about the runner may assume the technology this application is built with. Configuration lives in code as named presets (`lib/sandbox/presets.ts`), with `assignment.runnerConfig` as a shallow per-assignment override merged over the preset.

| Preset          | Template | Setup                             | Test command                                    | Parser        |
| --------------- | -------- | --------------------------------- | ----------------------------------------------- | ------------- |
| `node-jest`     | `base`   | `npm ci`, falling back to `npm i` | `npx jest --ci --json --outputFile=…`           | `jest-json`   |
| `node-vitest`   | `base`   | `npm ci`                          | `npx vitest run --reporter=json --outputFile=…` | `vitest-json` |
| `python-pytest` | `base`   | `pip install -r requirements.txt` | `pytest --json-report --json-report-file=…`     | `pytest-json` |
| `none`          | —        | —                                 | —                                               | —             |

- **`none` is a real preset and the default.** Short response assignments have nothing to execute and frontend assignments have tests this build cannot run yet, so "no tests exist" is an ordinary state. The default is `none` rather than `node-jest` so an unconfigured assignment produces no evidence instead of the wrong evidence. `runTestsForSubmission` throws on `none` rather than writing an `ERRORED` row, and the interface shows "No automated tests for this assignment".
- **React assignments with runnable tests use `node-jest` or `node-vitest` unchanged.** SQL is absent: it needs a template with PostgreSQL installed.

### Which sections a run is evidence for

A test run is per repository, because a suite executes once. Gradable sections are per pull request, and one pull request can contain a section the suite covers alongside one it does not. So the mapping is explicit: each entry in `assignment.sections` may carry `evidence: "tests"` and a `testNamePattern`, and absence means no deterministic evidence for that section.

| Assignment           | `runnerPreset` | Section `evidence` | What report generation has to work with                     |
| -------------------- | -------------- | ------------------ | ----------------------------------------------------------- |
| Algorithm exercise   | `node-jest`    | `tests`            | Rubric and answer keys, plus verified pass and fail results |
| Short response       | `none`         | absent             | Rubric and answer keys only                                 |
| Blended pull request | `node-jest`    | per section        | Verified results for one section, not the other             |

The intended future state is **one section per assignment**, with coding and short response split over separate template repositories — `swe-1-4-loops` and `swe-1-4-loops-sr` — and therefore separate submissions. That needs no new machinery: a one-entry `sections` array reads `evidence` through the identical code path. Separating them is a curriculum change made assignment by assignment.

### Getting the code in, with no credentials in the sandbox

- **The sandbox does not clone and never holds a GitHub token.** `git clone https://x-access-token:$TOKEN@github.com/...` inside the sandbox would hand an installation token — carrying write access to every repository in the organization, including every other student's — to the process running student code. A `postinstall` script in a modified `package.json` reads the environment, and the sandbox has network access during installation by definition.
- **Both trees are fetched on the server and uploaded as bytes**: the student's code at the exact commit the webhook recorded (`tarball/{head_sha}`, not whatever the branch points at when the run starts) and the template's tests at a resolved commit SHA. Each archive goes in as a single `.tar.gz` write followed by `tar xzf --strip-components=1`. Two archives are all that is needed; the pull request's own diff answers what the student changed.
- **Never pass `process.env` through to the sandbox.** Its environment gets exactly what the tests need, which for these assignments is nothing.

### Protected paths: detect changes and overwrite them

Two obligations: the instructor needs to know a student edited the tests, and the score must be computed as if they had not.

- **A protected path is grading infrastructure rather than student work**: `tests/**`, `jest.config.*`, `vitest.config.*`, `package.json`, `package-lock.json`, `.eslintrc*`, `eslint.config.*`, `pytest.ini`, `conftest.py`, `requirements.txt`, `.github/workflows/**`. The template's version of each is copied over the student tree before the suite runs, and files the student added inside a protected directory are removed.
- **`scores/**` and `hooks/**` are deliberately absent.** The mod-1 templates carry a `hooks/pre-commit` that runs the suite and then `git add scores/scores.json`, so every student commit stages a rewritten scores file; protecting that path would report a change on every mod-1 submission. Leaving them unprotected costs nothing: nothing reads `scores.json` as a grading signal, the runner invokes `npx jest` directly rather than `npm test`, the hook is installed by a `preinstall` script that `--ignore-scripts` skips, and git hooks do not execute in the sandbox.
- **Detection comes from the pull request diff.** `GET /repos/{owner}/{repo}/pulls/{n}/files` returns every changed file with a `status` of `added`, `modified`, `removed`, or `renamed`, plus `previous_filename`. This is the right comparison because `POST /repos/{owner}/{repo}/generate` produces a repository whose default branch holds one commit of the template's files as they were at that moment, and the student branches from there — so the diff is measured against the template snapshot *that student received*.
- **It cannot report an instructor's work as a student's.** The diff never examines the current template, so a bug fixed mid-cohort does not appear in any student's pull request, and the template can be corrected freely.
- **Two limits.** Changes committed straight to the default branch are invisible to the diff — a reporting gap and never a scoring gap, since the template's tests are restored regardless. It is cheaply detectable if wanted (a generated repository begins with exactly one commit), but committing to `main` is not misconduct and many students do it. And the diff reports that `package.json` changed, not which keys changed; key-level reporting comes from the merge below.

### `package.json` is merged, not restored

Wholesale restoration would protect the `test` script, which is otherwise trivially redirected to `echo ok`, but an assignment may deliberately ask students to add a dependency, and restoring the template's file would delete the addition and fail the run on a missing module.

| Keys                                                                                       | Rule                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `scripts`, `type`, inline runner configuration (`jest`, `vitest`, `mocha`, `eslintConfig`) | Merged key by key, **template wins every collision**. A student may add a `start` script; a student may not redefine `test`. |
| `dependencies`, `devDependencies`                                                          | Student additions are **kept**. The template wins on collision, so a version the assignment specifies cannot be replaced.    |

- **Any key the template asserts and the student overrode is recorded** as `package.json#scripts.test` or similar, so the instructor sees the specific attempt rather than a whole-file difference.
- **`allowStudentDependencies` governs the root file alone.** `swe-1-3-node-modules` is entirely about `npm install` and still needs `false`: the student runs `npm init -y` and installs `prompt-sync` inside `src/madlib-challenge/`, a nested package, which is ordinary student work.
- **When true, the lockfile cannot be restored.** A restored `package-lock.json` no longer matches the merged `package.json`, and `npm ci` exists to fail in exactly that situation, so the student's lockfile is kept and setup uses `npm install`. When false, both files are restored wholesale and setup uses `npm ci`.
- **When true, arbitrary packages are downloaded, but their install scripts do not run.** Every preset installs with `--ignore-scripts`, so a `postinstall` never executes and package contents are inert until something imports them, by which point the network is revoked. This is also a necessity: the templates install a git hook during setup with `cp hooks/pre-commit .git/hooks/`, and the sandbox receives a tarball rather than a clone, so with scripts enabled the install fails outright. The cost is that a dependency needing its install script to fetch a platform binary — esbuild, which Vitest depends on, or sharp — needs a custom E2B template with it present.

### The sandbox run

The sequence matters, specifically where the network is revoked:

1. `Sandbox.create({ template, timeoutMs, allowInternetAccess: true })`
2. Upload and extract the student archive to `/work`, then overlay the template's protected paths
3. Run the setup commands **with** network access — installing requires it
4. **Revoke network access** with `sandbox.updateNetwork({ allowInternetAccess: false })`
5. Run the test command with a hard timeout, capturing stdout, stderr, and the exit code
6. Read `/results/*.json` back out
7. `sandbox.kill()` in a `finally` block — a leaked sandbox bills until its own timeout expires

- **Revoking the network before the tests run buys two things.** Results become reproducible, because a test reaching an outside service returns a different answer when that service is slow. And student code loses its channel outward for the part of the run where student code is what executes.
- **The test command's hard limit is applied with `timeout --kill-after=10s` inside the sandbox**, because the SDK has no per-command wall clock limit. That produces exit code 124, which distinguishes an infinite loop from a suite that merely failed. The sandbox's own lifetime is set well above the command limit, so an infinite loop is not confused with an infrastructure failure.
- **Measured cost: 30 to 40 seconds a run**, of which setup is 6 to 17 depending on the dependency set. Removing the install step by building custom E2B templates with dependencies present is the largest speed improvement available and would let `allowInternetAccess: false` be set at creation. Installing on the server and uploading `node_modules` does *not* work: npm resolves optional dependencies by platform and architecture, native modules compile against one Node ABI, and Python wheels are platform-specific.
- **A test must assert something the archive can carry.** The runner receives a git archive, so a test can only check what git tracks. `swe-1-3-node-modules` asserted that `src/madlib-challenge/node_modules/prompt-sync` existed on disk; since `node_modules/` is gitignored, a correct submission lost the point everywhere except the machine where the student ran `npm install`. The assertion was removed from the template, because a per-assignment runner override fixes one assignment while fixing the test fixes it everywhere the tests run.

### Parsers and storage

- **One parser per result format, all returning the same normalized shape**, so everything downstream is runner-independent.
- **Parse failure is not test failure**: a suite that crashes before writing its JSON is an `ERRORED` run rather than a zero score.
- **Deterministic results live in `test_runs` rather than on `grading_drafts`**, because they outlive any one draft: re-generating a report against the same commit does not rerun the tests, and the cross-check reads this table as its source of truth. Rows are never updated in place after completion and reruns append.
- **`tamperedPaths`** holds the protected paths the pull request changes — a finding an instructor must see, not an automatic penalty.
- **`passRate` is `passed / total`**, is not the score, and is never compared against `completionThreshold`.
- **A submission with no rows at all is normal.** Nothing downstream may treat the absence of a row as a failure, a pending state, or a zero, which is why there is no `latestTestRunId` pointer that would read as "missing" when empty.

| State                             | How it is represented                        |
| --------------------------------- | -------------------------------------------- |
| This assignment has no tests      | No `test_runs` rows; `runnerPreset = "none"` |
| Tests exist and have not been run | No rows; `runnerPreset` is something else    |
| Tests ran and failed              | A `COMPLETED` row with `testsFailed > 0`     |

---

## Report generation

`lib/grade/generate-report.ts` loads the submission and assignment, **runs the tests first if the assignment has a suite and no completed run exists at this commit**, fetches the answer keys named in `assignment.sections`, classifies which sections the pull request contains, generates, cross-checks, and records the draft. One schema-constrained model call per gradable section.

- **Section classification is deterministic code, not a model judgment.** `agent-rules.md`'s file-path rules are an ordered classifier over the changed paths: `short-response.md` is short response; `src/*.js` with Jest in `package.json` is algorithm; `.sql` without Jest is SQL; HTML, CSS, JSX, and server files are frontend. The result is intersected against the assignment's `sections` mapping. A section expected but absent is reported as not submitted; a section present but unexpected routes to manual review.
- **Not an agentic tool-use loop.** Every discovery and side-effecting step from `agent-rules.md` has already happened deterministically, so what remains is judgment over fixed inputs.
- **System prompt:** `agent-rules.md`'s tone and formatting rules — second person, two-beat summary, impact before root cause, verbatim checklist copying, half-credit nesting — plus the matching `rubric.md` section and `sample-*-report.md` template.
- **User content:** the assignment README, which carries the verbatim frontend and SQL checklists; the relevant answer key files, labeled as reference and never shown to the student; the student's changed files; and the verified results from the `test_run`.
- **Output:** schema-constrained JSON carrying the rendered markdown plus `{scoreEarned, scorePossible, rubricItems[], flags[], instructorNotes[], confidence, submissionProcessNote, testClaims[]}`.

### What a student commits, and what reaches the model

The student's files come from the pull request's own diff, so a file git was told to ignore can only appear because the student committed it. `partitionForPrompt` in `lib/grade/classify.ts` withholds those paths, and runs on the whole changed-path list before anything reads it, so classification and the prompt cannot disagree about which paths are student work.

- **Disclosure.** A committed `.env` would put the student's own secrets into a third party's logs. Nothing about that is recoverable, which is why the filter is enforced rather than advisory.
- **Context.** A committed `node_modules` can exceed the context window on its own, failing the run outright.
- **Cost.** Every file sent is billed as input.

What is withheld: environment files, credentials and private keys, dependency trees, lockfiles, build output and minified bundles, coverage output, cache directories, logs, editor and system files, and compiled artifacts.

- **It is a fixed list, deliberately not the repository's own `.gitignore`.** Templates add project-specific lines, and one of them is `server/` in a backend project, with the comment "students will build the entire backend from scratch" — those files are the deliverable, and the classifier reads `server/` as frontend work. Honoring the template's ignore file would send an empty prompt and grade the section as not submitted. The student's copy inherits the same line. A gitignored path that reached the diff is either junk or the whole submission, and no ignore file tells those apart. The test for adding an entry is that no assignment could ever ask a student to author it.
- **What was withheld is recorded on the draft** as `modelMetadata.excludedFromPrompt` — a count, a breakdown by reason, and up to twenty example paths — and the review screen says so above the report.
- **The notice distinguishes two things arriving through one mechanism.** A committed dependency tree or build directory is ordinary and needs only the explanation that those files are not in the report. A committed environment file or private key needs an action from the student: deleting the file does not remove it from history, so the credential has to be replaced, and nobody but the student can do that. Neither gates approval.

### One section, one call, one report

- **An assignment with two gradable sections produces two calls and two reports**, each against its own rubric, answer keys, and point value. A checkpoint's short response and its coding work are not commensurable, and nothing tries to combine them.
- **Point values live on the section, not the assignment.** `assignments.pointValue` is the sum of its sections and exists for the gradebook; the number sent to the model is always the section's own. A section reaching the model without one is refused rather than defaulted — told nothing about the maximum, a model invents one (an early run scored a 13-test assignment out of 40), and a plausible score against an invented denominator cannot be told from a real one.

### Flags, and why a section has no tests

`flags` is a closed vocabulary of short codes, because the same column carries codes the pipeline writes and the interface renders every entry as a badge. Prose belongs in `instructorNotes`. Each flag records **why a student lost points** and corresponds to a bullet in a `rubric.md` score band. A section at full marks carries none.

| Writing quality                                             | Technical score                                        |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `MECHANICAL` — spelling and grammar                         | `INCOMPLETE` — parts of the question unanswered        |
| `CLARITY` — vague, contradictory, or needlessly complex     | `UNDERSTANDING` — gaps, inaccuracies, misunderstanding |
| `MARKDOWN` — does not render, or unused where it would help | `TERMINOLOGY` — missing or misused                     |
| `STRUCTURE` — unclear structure, poor flow                  |                                                        |

- **No flag text ever appears in the report a student reads.** Approving posts the markdown to the pull request, so a `FLAG:` line left in the text is an internal label delivered with no way to take it back. The prompt forbids it and the cross-check holds any draft whose text contains one. The student is still told, in the report's own voice, that their writing needs proofreading.

Test evidence gets four outcomes, because "this assignment has no suite" and "this assignment has a suite and none of it ran" are opposite situations:

| Flag                 | Meaning                                                                                                                   |          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| `TEST_EVIDENCE`      | Claims were checked against a real run                                                                                    | ordinary |
| `NO_TESTS_EXPECTED`  | The section declares no `evidence: "tests"`                                                                               | ordinary |
| `TEST_RUN_MISSING`   | Tests expected, no completed run at this commit                                                                           | a fault  |
| `TEST_MATCH_MISSING` | Tests ran, the section's `testNamePattern` matched none — shown as "No matching tests", since nothing is missing a *file* | a fault  |

- **Every pill explains itself on hover.** `FLAG_META` and `CONFIDENCE_META` each carry a description and the badge components render it through one wrapper. The seven writing and technical flags all open with "Points came off…", which is what the labels never said.
- **The tooltip adds no tab stop.** Rendered as a span, Base UI's trigger gains no `tabIndex`, so it opens on hover and not on focus. Making each pill focusable would put four to eight tab stops in front of the controls that do something. If the vocabulary needs reading without a pointer, one legend beats eighteen tab stops.
- **Confidence is a pill, not a flag.** It is a column on the section, so the review screen shows how sure the model was on every section. `FLAG_META` carries a `LOW_CONFIDENCE` entry because that map decodes *stored* flags and some drafts have the code in their arrays.
- **Its description lists the reasons the prompt names** — a needed file absent, code that could not be read, a rubric that does not cover the submission, reference solutions expected and missing — and says which reason it is *not*: an ordinary borderline judgment, which the prompt forbids hedging with and directs into `instructorNotes` naming both bands. If that instruction changes, the description changes with it.
- **`instructorNotes` is free text a student never sees.** "The point value I was given does not divide evenly into this README's checklist" is what an instructor needs before approving and what a student should not read. On real submissions it produced "the README checklist contains 25 items, but this section was specified as 15 points, so I weighted every item at 0.6" — a configuration problem no deterministic check would find — and "the student's three files are byte-for-byte identical to the reference solution", a plagiarism signal the pipeline has no other way to express.
- **Whole numbers, with the hesitation in `instructorNotes`.** Rubric scales are fixed bands with written descriptions, and a 1.5 corresponds to no description and cannot be explained to a student. In calibration, asked only for a number the model returned 1.5 with a note that the work sat between bands; asked for a band it returned 1 with a note quoting the rubric clause that decided it. The second can be reviewed.

### What the cross-check may and may not assert

Test results are a fact the model must not contradict, and one rubric input among several. They are not the score, so the check is asymmetric:

| Situation                                                       | Verdict                                          |
| --------------------------------------------------------------- | ------------------------------------------------ |
| Model states a test passed that the run records as failed       | Contradiction → finding                          |
| Model awards the "passes all tests" criterion when tests failed | Contradiction → finding                          |
| Model withholds points despite all tests passing                | **Legitimate** — hardcoding, inefficiency, style |
| Model raises a flag and awards full marks in the band it scores | Contradiction → finding                          |
| Model deducts a point without raising a flag                    | **Legitimate** — judgment the bands allow        |
| Model's `rubricItems` do not sum to its reported score          | Arithmetic error → finding                       |
| Model scores the section out of a maximum the section does not carry | Contradiction → finding                     |

- **The third row is the one a naive implementation gets wrong.** A check written as "claimed score must match pass rate" would flag exactly the judgment the model is there to make: a student who returns hardcoded values passes every test and has demonstrated nothing. So the check compares the model's *claims about test outcomes* against the run, never its score against the pass rate.
- **The arithmetic verification applies to every section, tested or not.** It is the only automatic check available when a section has no run.
- **A flag names a defect one of the rubric's bands scores, so full marks in that band deducts for it nowhere.** `TERMINOLOGY` is what separates "uses correct terminology throughout" from "generally uses correct terminology", and `MECHANICAL` is a Writing band bullet, so `FLAG_WITHOUT_DEDUCTION` fires when a report raises either and awards every point in the matching band. It is asymmetric for the same reason the test rule is: full marks beside a flag is a contradiction, while a deduction with no flag is judgment the bands permit. When no line item's `criterion` names the band, the check says nothing rather than guessing at scores it cannot locate.
- **The cross-check operates per section**, because within one submission some sections are bound by test evidence and some are not. A non-empty `tamperedPaths` produces a finding regardless of score. `grading_draft_sections` records whether a run informed it, so the interface can show which sections had their claims verified.
- **Confidence is not a cross-check finding.** Low confidence on work with no suite is the ordinary condition of most of this curriculum, so treating it as a fault would mark almost every short response and frontend section as exceptional.
- **A finding directs attention rather than gating.** Each is a contradiction, and each is recorded twice for two readers: as a flag on the section, which an instructor scans, and in `errorDetail`, which names what could not be reconciled. Nothing is gated because nothing is released without an instructor approving it.
- **Everything else produces manual review with the specific reason attached, never a fabricated score**: fetch or authentication failure, a runner crash as opposed to failing tests, no section type matched, an assignment with no `sections` mapping, or a model call or schema validation failure.

### Provider isolation

- **One interface, two implementations.** Pipeline code calls `getReportGenerator()` and never references a vendor; `GRADING_LLM_PROVIDER=claude|groq` selects. The contract carries a Zod schema rather than a JSON Schema document, because Claude's SDK derives the response format through `messages.parse()` and `zodOutputFormat()`, and Groq needs a plain JSON Schema in its request body, which the same schema derives.
- **Claude is the provider in use, on `claude-sonnet-5`.** The model is a constant in `lib/grade/providers/claude.ts` with `ANTHROPIC_MODEL` as an override, so trying another tier costs an environment variable — what it does not cost is the [calibration](#what-is-verified-and-how) that says whether the other tier still agrees with an instructor. That calibration has been run against `claude-opus-5` four times across four rubric generations, and on the current one it agrees on 10 of 20 held-out completion decisions against Sonnet's 19 of 20, ranking two submissions the wrong way round every time. The cheaper tier is also the better-calibrated one.
- **Groq's `openai/gpt-oss-120b` with strict `json_schema` remains implemented** and is the only Groq model and mode combination confirmed to guarantee schema-conformant output. Its free tier caps requests at 8,000 tokens per minute and a frontend prompt does not fit — those carry several answer keys and a verbatim README checklist, about 12,400 tokens by Groq's count, rejected with a 413.
- **Claude's JSON schema support rejects numeric constraints** such as `minimum` and `maximum`, rejects string length limits, and requires `additionalProperties: false`. The schema cannot express them, so the cross-check's arithmetic verification stays necessary on either provider.
- **Claude reports cached tokens separately from `promptTokens`, not as a subset.** A run that writes the cache shows zero reads and an unchanged prompt count, indistinguishable from broken caching unless the write count is also recorded. All four counts go into `modelMetadata`.

### What a report costs

Measured on `claude-sonnet-5`, the deployed default, one section per run, at $2.00 per million input tokens and $10.00 per million output tokens. Each row is several runs of one submission, so the only variables are `effort` and the model's own run-to-run variation. Costs are normalized to a cache hit — what a run costs reading its cacheable prefix rather than writing it, which is what every submission after the first pays when a cohort is graded in one sitting.

`npm run cost` produces this table. It prices the four token counts each draft records in `model_metadata.usage`, reports both the billed and the cache-hit figure for every run, and groups by model, effort, and section type. The rates live in one table at the top of `scripts/cost.ts`, so a rate-card change is a one-line edit and no recorded measurement has to be repeated.

| Section            | Effort | Uncached input | Cacheable | Output        | Cost, median   | Cohort of 25 | Wall clock |
| ------------------ | ------ | -------------- | --------- | ------------- | -------------- | ------------ | ---------- |
| `coding_algorithm` | high   | 8,390          | 6,509     | 4,124–10,035  | $0.1132        | $2.83        | 36–99s     |
| `coding_algorithm` | medium | 8,390          | 6,509     | 3,716–7,481   | $0.0741        | $1.85        | 36–79s     |
| `coding_frontend`  | high   | 8,717          | 8,475     | 6,966–8,822   | $0.0981        | $2.45        | 128–166s   |
| `coding_frontend`  | medium | 8,717          | 8,475     | 3,643–3,984   | $0.0573        | $1.43        | 105–110s   |

- **A cost is a range, not a figure, and the reason is output tokens.** The same submission at the same effort against the same prompt produced 4,124 output tokens on one run and 10,035 on another, so a single run measures very little. Report the spread: an algorithm report costs $0.0593 to $0.1184 at `high` and a frontend one $0.0888 to $0.1073.
- **Output is 70 to 84 percent of the cost**, because thinking is billed as output. `GRADING_LLM_EFFORT` therefore moves total cost more than prompt caching or model tier, and the gap is now large enough to be a real choice: `medium` costs 35 percent less than `high` on an algorithm section and 42 percent less on a frontend one. It is left at `high` because the saving is worth about $80 per cohort-year and the cost of a worse grade is not.
- **Model tier moves cost far less than its rate card implies, and least on the smallest sections.** The same two frontend submissions on `claude-opus-5` cost $0.1437 and $0.1673 on a cache hit, so Sonnet runs at 59 to 79 percent of Opus rather than the 40 percent its rates predict. On short response the gap is narrower still: the five calibration pairs, each graded on both tiers, came to 72, 79, 81, 76, and 91 percent — a median of 79 percent, or $0.0781 a report against $0.0987. Sonnet spends the difference on thinking, and spends more of it the smaller the section: 35,383 output tokens across those five reports against Opus's 16,071, where the frontend prompt was 6,966 against 4,959. Output is 86 percent of Sonnet's short response bill and 74 percent of Opus's. Tier is worth about two cents a report, roughly $100 per cohort-year across a curriculum of 78 assignments, which is why [it is a calibration question rather than a cost one](#what-is-verified-and-how).
- **Caching works, and its window is five minutes.** A repeated request read 8,475 tokens and wrote none; a later request for the same prompt wrote all 8,475 again. Writing that prefix costs 1.25 times the input rate and reading it a tenth, so the first submission of a sitting pays about $0.02 more than the rest. Caching pays when a cohort is graded in one burst and pays nothing when grading is spread across an evening — an input to the orchestration decision. Only the system prompt is cacheable today, which is 49 percent of the frontend input.
- **A frontend report takes over two minutes of model time**, with no sandbox run involved, so a repository assignment's worst measured case is closer to three and a half minutes once a 30-to-40-second test run is added. That is the figure [triggering and orchestration](ROADMAP.md#triggering-and-orchestration) has to fit inside a 300-second function limit.

### A ceiling on what a mistake can spend

- **Generating a draft and running the tests are the only two things that cost per use**, and each is capped per person per hour — twenty drafts, sixty test runs — by `lib/audit/rate-limit.ts`.
- **What this defends against is a loop, not a stranger.** Both procedures are instructor-only, so the procedure builders keep strangers out. A batch screen retried in a tight loop, a script left running, a button pressed forty times: none malicious, all expensive. The refusal says when the caller can continue, because the person reading it is in the middle of grading.
- **Counted out of `audit_events` rather than a counter of its own.** That table is append-only, already carries `actor_id` and `occurred_at`, and already has the index this query wants. It also means the limit and the record cannot disagree.
- **Attempts are counted, not successes**, and the event is written before the call. Every attempt spends the model call, and a run that throws after the tokens are gone cost exactly as much as one that returned.
- **It is not a distributed limiter.** Two requests in the same millisecond can both read a count below the ceiling; at one school with a handful of staff, the difference between stopping at twenty and twenty-one is nothing.

### Grading assets

#### Two asset sources

Everything a section is graded against is read over the GitHub API, from two repositories addressed differently:

|                                               | Where it comes from                                                                   | Why there                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rubric.md`, `agent-rules.md`, sample reports | the repository `GRADING_ASSETS_REPO` names                                            | Program-wide prompt code. Every assignment in every course is graded against the same rubric and the same tone rules; one with its own would be a different program. |
| reference solutions                           | the repository the assignment's `answerKeyRepo` names, at the paths its sections name | Per assignment. A cohort keeps its solutions wherever it likes, and the curriculum's directory layout stops being a constraint on the application.                   |

- **Both go through one function** that decides the repository, the installation, and the commit, so there is no second implementation to keep in step.
- **Both commits are recorded** on the draft and shown on the review screen, so a report traces back to the exact rubric *and* the exact reference solutions it was written against.
- **`lib/section-types.ts` decides which heading and which sample a section type takes**, along with its label on screen and the `Rubric` row it is graded against. One registry, `satisfies Record<SectionType, …>`, so a type added and forgotten is a compile error. It imports nothing and is browser-safe, because the section editor draws its picker from the same entries the prompt is built from.
- **Detection is deliberately not in that registry.** `lib/grade/classify.ts` maps a changed path to a section type through an *ordered* list where the first match wins — which decides that a flat `src/*.js` file is an algorithm exercise when the template has a Jest suite and frontend work otherwise. Keyed by type, that order would become an accident of how the object literal was written.
- **`coding_sql` takes the frontend sample report**, because the toolkit holds no SQL one. The sample teaches the *shape* of a report and the rubric heading supplies the criteria. Both the registry entry and a test say this is deliberate.
- **An assignment naming no answer key folder reads no second repository at all**: nothing is resolved or requested, and the answer-key commit is null. Naming a folder while naming no repository is refused, because grading silently without reference solutions is the failure the mechanism exists to prevent.
- **Individual files rather than the repository archive.** The archive is 23MB and over 20 seconds, almost all images grading never reads, while a run needs the rubric, the agent rules, one sample report, and a handful of answer keys — roughly 200ms each, fetched in parallel.
- **Answer key paths come from a database column and address a private repository**, so a path that would escape its root is refused with plain string logic. There is no filesystem here; the path goes into a GitHub contents URL.
- **There is one source, not two.** Reading assets from a local clone was removed: every source after this one is external — rubrics for non-repository assignments will come from Google Drive — and two implementations of every read and listing risk an assignment authored against one listing and graded against another, each half looking correct alone. A leftover `GRADING_ASSETS_PATH` fails loudly rather than being ignored.
- **The cost is real: tuning the rubric means committing and pushing, then waiting up to a minute.** Push to a branch and set `GRADING_ASSETS_REF` to iterate without touching the default branch.
- **Files are read at a resolved commit SHA, never at a branch name**, so a ninety-second run cannot read half its rubric from before a push and half from after. Content is cached under `repo@sha:path` with no expiry, which is safe because a path's content at a given commit cannot change. The branch head is re-resolved every 60 seconds per repository, so a pushed rubric change takes effect within a minute without a webhook. `GRADING_ASSETS_REF` applies to the program assets only; an answer-key repository always reads its own default.

---

## Review, approval, and delivery

```
NOT_STARTED → ACCEPTED → SUBMITTED → GRADED → RESUBMITTED
                                                   │
                                      ┌────────────┘
                                      ▼
                               back to SUBMITTED
```

- **`submission.status` is the state of the submission, not of a grading run.** The run's state lives on the draft (`GENERATING`, `READY`, `FAILED`, `SUPERSEDED`, `APPROVED`), and only approval moves a submission to `GRADED`.
- **A run that produced a report is `READY`, whatever the cross-check found.** There is deliberately no second ready-ish state: every report is reviewed before anybody sees it, so a pair of statuses reading "ready for review" against "needs manual review" claimed a difference in whether a human was required rather than in what the pipeline noticed. What the cross-check could not reconcile is named in `errorDetail` and in each section's flags, which say where to look rather than whether to look. `NEEDS_MANUAL_REVIEW` remains in `GradingDraftStatus`, nothing writes it, and rows predating this decision are presented and triaged as ready.
- **The review screen renders each `grading_draft_section`** — markdown plus its score — with a findings banner drawn from `errorDetail` whenever the cross-check recorded something. Never a silently wrong score.
- **Every section's text and score is editable in place.** An edit is stored in `editedReportMarkdown` and `editedScoreEarned` **alongside** the model's original rather than over it, and written as null when it matches the model's value, which is how discarding one works. Two different comparisons: which sections are dirty is measured against the *effective* values, while the null-or-value decision is measured against the *model's*. Everything a student reads resolves to the edited value.

**Approve** is one transaction:

1. Copy the effective markdown and scores to the submission's `feedbackMarkdown`, `finalScore`, and `finalScorePossible`; compute `isComplete` against `completionThreshold`; record `gradedBy`, `gradedAt`, and `gradedHeadSha`; set the status to `GRADED`.
2. Post a pull request comment. Best-effort and retryable, so a brief GitHub outage does not block the grade — `grading-drafts.retryComment` sends it later, and an approval whose comment never posted is a distinct triage bucket.
3. Set `salesforceSyncStatus` to `PENDING`, inert until that phase exists.

- **Delivery has three outcomes, not two**: `posted`, `failed`, and `not_applicable`. `postedPrCommentId` being null means two opposite things — a comment that failed to send, and one there was never anywhere to send — so `deliveryOutcome` in `lib/grade/approve.ts` names which, and every reader branches on the name. Collapsed, an impossibility is reported as a fault in three places: a toast, a retry button that could never succeed, and a triage entry nothing could clear.
- **`undeliveredApprovalWhere` lives beside that function** and takes each caller's scope as an argument, so the deliverability condition cannot be dropped at one of its four call sites.
- **One edge of a derived outcome:** a repository assignment hand-graded before the student opens a pull request reads as `not_applicable` until they open one, and as `failed` afterwards. Recording the outcome at approval time is the alternative if that ever reads as wrong.
- **A section with no score or no feedback is refused** rather than released as a zero. That is what a hand-written draft starts as, and the two are indistinguishable once written.

### Handing in a file

- **A `FILE_UPLOAD` assignment declares what it accepts as `assignments.acceptedFileTypes`** — keys of `UPLOAD_FILE_TYPES` in `lib/uploads/file-types.ts`, at least one, refused by the schema when empty. Keys rather than extensions or MIME types, and checkboxes rather than a text field: a typo'd MIME type is not a validation error an instructor sees, it is a student being told their correct file is the wrong kind, on the due date.
- **The types belong on the assignment; the 25MB limit is global**, because no assignment has a reason to want a different one.
- **The vocabulary is PDF, images, Word and plain text, spreadsheets, and Jupyter notebooks.** Each type maps its extensions to the content type they are stored under, rather than two lists side by side.
- **The extension decides both whether a file is accepted and what type it is stored under; the browser's reported type is not consulted.** A `.docx` arrives as its official type, as `application/octet-stream`, or as nothing depending on the operating system and whether Word is installed, and a `.ipynb` almost never arrives as anything Jupyter would recognise. The bucket has its own allow-list built from the same entries, so an upload the route accepted under the wrong content type would be refused by the bucket on one student's machine and no other. `contentTypeFor` closes that, and `verify:uploads` checks that every extension has a content type and that every one is on the allow-list.
- **Adding a type means re-running `npm run setup:storage` against every environment.** That script builds the bucket's allow-list from the same map; forgetting leaves the route accepting a file the bucket then refuses. The script compares the type list as well as the size limit and names what it adds or removes.
- **`verify:uploads` stores a real notebook** to catch the other half: every extension having a content type is a fact about this repository, and the bucket accepting it is a fact about *this environment*. A notebook because it is the newest and the least likely to be on an old allow-list by accident.
- **A spreadsheet and a notebook download rather than preview.** `previewKindOf` answers `pdf` or `image` and nothing else, because no browser renders the others and an empty frame is a worse answer than a download. The notebook is the one that costs something — it is the most-read of these — and rendering one is a real dependency and its own decision, so a check records that the answer is deliberate.
- **The bucket is private and has no policies for `anon` or `authenticated`**, so the browser cannot reach it. Every access is a signed URL, valid for five minutes, minted by `submissions.uploadUrl` for a caller it authorized — the student who owns the submission, or an instructor who teaches that course. This is deliberately stronger than per-student storage policies, which would be a second description of who may see what. `verify:uploads` checks that the unsigned public URL for a stored object does not work and that a forged token does not either.
- **Uploading is one request to `POST /api/submissions/upload`, not a signed upload URL.** Minting a URL, letting the browser send bytes straight to storage, then calling back has a window where the object exists and the submission was never marked handed in — work in a bucket nothing points at. One request also means our own code checks the size and the type before a byte is stored.
- **The rule is `assertCanHandIn` in `lib/uploads/submit.ts`**, called by the route *and* by `submissions.submitWork`, throwing `TRPCError` either way: the procedure propagates it and the route maps it to a status code. One error vocabulary rather than one per transport.
- **The upload is the submission, so `submitWork` refuses this kind** exactly as it refuses `REPO`.
- **The order of writes cannot produce a submission that reads as handed in with nothing behind it.** The row is ensured first without touching its status — the path is built from its id — then the bytes are stored, then the status and the four columns are written together. A failure partway leaves a row reading as not started, which is true, or unreferenced bytes, which is harmless.
- **The last dot decides the extension**, so `resume.pdf.exe` is an executable. The bucket's own MIME allow-list sits behind this as a backstop, generous where the route is exact.
- **The student's filename is never part of the stored path**, which is `{submissionId}/{uuid}{ext}`. It is kept in `upload_filename` for what the instructor sees and what their browser calls the download. A generated segment means re-uploading writes a new object rather than overwriting one an instructor may be part-way through reading, and the previous object is left in place.
- **A PDF or an image is shown in place.** Grading a cohort of resumes by downloading twenty-five files and matching filenames back to students is most of the work, so the review screen embeds the document above the feedback, open on arrival, in the browser's own PDF viewer in an iframe: no dependency and no worker file to serve.
- **That rests on three properties of an inline signed link, none of them ours to control** — the response carries the object's content type, carries no attachment disposition, and is not frame-blocked. `verify:uploads` checks all three, because a change on Supabase's side would turn the viewer into an empty box with no error.
- **An inline link lives thirty minutes where a download link lives five.** A browser's PDF viewer fetches a large document in ranges as the reader scrolls, so the URL has to outlive the reading rather than the loading; pages further in would otherwise silently fail to appear, which reads as a corrupt file.
- **The size limit is enforced in three places and only one is a guarantee**: the bucket refuses a larger object, the route refuses it before storing anything, and the browser refuses it before spending a student's upload. The last two exist so the failure is fast and legible.

### The review pane's two columns

- **The split is a container query on the pane, not a media query on the window.** What has to hold two columns is the review pane, and what is left of the window after the 360px queue list and the 16rem application sidebar is not something the window knows. `GradingReview`'s scroller carries `@container` and the columns turn on at `@4xl`, which is 56rem of pane.
- **The grade column is clamped and the document takes the rest**: `minmax(0,1fr) clamp(26rem, 40%, 34rem)`. A score box and a paragraph of feedback have a size they want and no use for more — under 26rem the markdown box is too narrow to write in, over 34rem the prose runs past the measure anybody reads a paragraph across — so every pixel beyond that goes to the work rather than to white space beside it. 26rem is also exactly half the room at the width the columns appear, so neither column is squeezed under the other at the point where both are smallest. Written as a `clamp` rather than a `minmax` track deliberately: a `minmax` track grows to its maximum before an `fr` track gets anything, which is the priority backwards.
- **The column holds one of four things, and what settles which is a ranking: the work comes before the working.** A file the browser can show; a Google document a student linked; the diff of a pull request; or the working behind the score — the rubric breakdowns and the suite output. Never two of them, and a repository is the case that makes the ranking necessary rather than incidental: it has both a diff and a working, so the diff takes the column and the rubric reads under the report, which is where `DraftEditor` draws it by default. A submission with none of the four — a `.docx`, a repository whose student has accepted and not yet pushed — stays in one column rather than splitting to show an empty half.
- **Two shared functions decide it, each asked by both the column and the card it fills.** `previewKindOf` for an uploaded file and `parseDriveDocUrl` for a submitted address, so the pane cannot widen for something the card then declines to show — a `.docx` and a Canva board each answer no and stay in the one column, where the first is a row with a download button and the second is the address. The diff is decided from `prNumber` instead, which is a column already on the row: a second column that appeared when a request came back would move the grade sideways under somebody part-way through writing in it.
- **The working stacks after the grade; the work stacks before it.** On a narrow screen an instructor reads the feedback the student will read and then scrolls to what backs it up, which is the order this screen has always had, so the evidence column carries `order-last` below the breakpoint and drops it above. A document is the opposite: it is the work, and it is read first. One piece of markup reads in both orders because the split is a flex row — a column stacked, a row beside — rather than two arrangements of grid areas.
- **Each column scrolls itself, and the pane has nothing left to scroll once it splits.** Two columns of different lengths cannot share one scrollbar: the shorter one runs out and then sits there while the longer one goes on, and its last card is left below the fold with nothing that will bring it up — which is what a rubric of ten questions beside a one-section report does.
- **The pane carries `@container` and therefore no `@4xl:` class of its own.** An element cannot answer its own container query: such a class asks about the nearest container *above* it, finds none, and silently never applies. Everything that changes at the breakpoint lives on the children, and the pane is written once for both widths — a flex column that scrolls, which is what stacked needs and which split leaves with nothing to scroll.
- **What scrolls and what stacks the cards are two elements.** A flex column with a height of its own shrinks its children rather than overflowing, so the scrolling box is a plain one holding a column that is not — the shape the queue's list already has.
- **The scrolling box is padded because a card's outline is `ring-1`.** A ring is a shadow drawn outside the element, not a border drawn on it, so against the edge of a scroll container it lands outside the scrollport and is clipped away — cards lose their sides and top. The padding keeps the outline inside the box that clips it.
- **The height is `min-h-0 flex-1` down from the pane, never a `calc` against the viewport.** The same chain the queue's own list uses, and the only one this application has ever relied on: the pane knows its height, the row of columns takes it, and a child of the row is exactly as tall as the row. Naming the height as `100svh` minus the chrome above it is a guess that is wrong on some screen, because what sits above the pane differs between the queue, the student record, and grading mode — too small and a column ends early, too large and its last card is unreachable. Percentage heights are avoided for the same reason: they resolve against a chain of ancestors that has to stay definite at every link.
- **`RubricBreakdown` is its own component for this reason.** It used to be the second half of `SectionEditor`, which is fine while the two are in one column and impossible once they are in different ones; `DraftEditor` draws it under each report unless the column beside is drawing it.
- **No toggle, deliberately.** The only reason to stack is a lack of room, which the query answers exactly; the preview's own collapse is the control for wanting the width back; and no screen in this application stores an interface preference, so a toggle would need machinery to be remembered and would be forgotten at every student without it.

### Grading mode

- **It is the two-pane screens with the panes that are not the work put away**: `useGradingMode` collapses the application sidebar, the list column is hidden, and `GradingModeBar` offers what was left of the list as Previous, Next and a position. On a 1440px window that takes the review pane from about 820px to about 1390px, which is what earns the split above — the mode and the two columns are one feature reached from two directions.
- **Hidden rather than unmounted**, so the list comes back holding the search text, the tab and the scroll it was left with.
- **The sidebar is restored on unmount as well as on exit.** `setOpen` writes the `sidebar_state` cookie, so a session left through the breadcrumb would otherwise leave every other screen collapsed with nothing to say why. What it was before entering is recorded rather than assumed, so an instructor who already works collapsed is not handed it back expanded.
- **One component for both screens.** The queue's list is one assignment's students and the student overview's is one student's assignments; either side of the divider they are the same screen, and the bar takes the rows in the order they were drawn, under the name each is reached by, so the filters in force stay in force in both the dropdown and the two buttons.

### Grading by hand

- **A manual grade is the existing review screen with an empty draft, not a new screen.** `gradingDrafts.startManual` writes a `GradingDraft` with null `modelMetadata` and one blank section per declared section, carrying the section's own point value so the total is not typed twice. Everything after is unchanged: the same editor, approval, gradebook, student feedback screen, and feedback history across resubmissions.
- **The form is drawn before the draft exists, and typing into it is what creates one.** `listForSubmission` returns `handSections` — the label and point value of each hand-graded section — so `BlankHandGrade` can render the same section cards the editor renders, with an empty score box and an empty feedback box. The first score typed or feedback box opened calls `startManual`, and `startManual` returns the sections it created so the review screen can write what was already typed onto them by label before the round appears. A submission that is only read leaves no round behind, which is what keeps triage counting work somebody started.
- **A score is written when its box loses focus, and a feedback box opens the round on the click.** The round replaces the blank form with the editor, so the boxes are new ones: opening it on the first keystroke of "18" would take away the box the second was meant for, where leaving the box is the moment the score is finished and is also what happens on the way to anything else. A box asked for by a click is not offered until the round holding it exists, so nothing can be typed into one that is about to be replaced. Which boxes are open is remembered above the cards, in `FeedbackBoxes`, because the card that owns a box is rebuilt around the new round.
- **Opening it twice returns the existing draft**, because two blank drafts would leave an instructor choosing between identical empty forms, one of which their writing is not in.
- **The screen offers one action or the other and never both.** `manualOnly` comes from the server, from the same reading of the assignment that put the submission in its triage bucket.
- **The student's page reads the graded columns directly**, so feedback appears on approval with no publish step, and appears even when the comment failed to post.
- **Three guards refuse rather than warn, and they live in the procedure**: approving the same draft twice, approving a superseded draft, and a score stated in the report text that disagrees with the recorded score. That last is `statedScoreInText` in `lib/grade/report-text.ts`, free of database and network imports specifically so the browser's warning and the server's refusal are the same function.
- **A second approval posts a new comment rather than editing the first.** Feedback on a resubmission describes different work, and the two read in order are the record of what the student changed.

### Correcting a submission before anybody has read it

The three kinds handed in by link or by file — `GOOGLE_DRIVE`, `EXTERNAL_URL`, `FILE_UPLOAD` — can be corrected while the work is waiting. `REPO` needs none of this, because pushing a commit is the correction.

- **`handInMode` in `lib/status.ts` is the whole rule**, returning one of four acts: `submit` (work not yet handed in, and `ACCEPTED` counts, since taking a copy of a Drive template is receiving the work), `update` (a correction to work still waiting, which overwrites and leaves the submission where it is in the queue), `resubmit` (a second attempt after a grade), and `locked` (an instructor has the work open).
- **A student may not replace work an instructor is part-way through reading.** Handing in again is an overwrite — `submittedUrl` and the four upload columns are single-valued — so doing it mid-review would leave a grade describing a document nobody can open. Repository kinds are protected by `draftIsStale`, which compares the draft's commit against the submission's; a link or a file has no commit, so the protection is a check for an open draft.
- **That check is deliberately narrow.** `SUPERSEDED` is already replaced and `FAILED` produced nothing, so blocking on them would lock a student out over a pipeline error they can neither see nor fix. An approved draft is not caught either, which leaves the ordinary resubmission path open.
- **The check lives in `assertCanHandIn`**, so it holds for the mutation and the upload route alike. The student's screen learns the same fact from a filtered `_count` on `assignments.listForCourse`, counting exactly the draft states the server refuses on, flattened to `instructorHasStarted` before it leaves the procedure. One number and no statuses: which state a draft is in is not a student's business.
- **Where the work is locked, the screen says so where the box was.** A control that silently disappears is the same problem as one that refuses without explaining.

### What a submitted link goes to

- **A submitted link is untrusted input in a way an uploaded file is not**: the file goes to a private bucket this application controls, and the link goes wherever a student typed. `SubmittedLinkRow` shows the address — the host drawn separately and first, the full URL underneath in a monospace face that wraps rather than truncates, because a URL is read left to right and a wrong one usually differs at the end. A Drive link ending `/template` is the instructor's own copy; a `localhost` address never had a chance of working.
- **`linkHost` decides whether a link may become an anchor at all, and accepts `http` and `https` only.** `javascript:alert(1)` parses perfectly well, and `submittedUrl` is a string a student typed rendered later on an instructor's signed-in page. `data:` and `file:` are refused for the same reason. The `submitWork` schema refines on the same function, so nothing can be stored the row would then refuse to open, and the row renders no `<a>` at all rather than a disabled one, since a greyed-out button would leave the href in the document. Where the address cannot be opened the row says so, because submissions predating the check can hold one.
- **It sits beside `UploadedFileRow` on the review screen rather than inside the hand-grading card**, because that card disappears the moment a draft exists. The two components are the same fact about a submission for the two kinds that carry it. The student sees the row too, above the form that changes it.

### Resubmission

Two mechanisms, because there are two requirements: an instructor needs to know when revised work has been graded already, and a student needs to commit freely without each commit reading as a request for re-review.

- **Newer code exists** is `headSha !== gradedHeadSha`. No API call, true the instant a push lands, displayed as "revised since grading".
- **The student is ready** is a button that sets `RESUBMITTED`. `SUBMITTED` cannot serve, because it does not distinguish a first submission from a revision. The GitHub-native alternative — draft pull requests marked ready, firing `pull_request.ready_for_review` — costs no interface but depends on the draft pull request habit holding.
- **Together they say what neither says alone**: newer code with no readiness declaration is a student still working, or one who finished and forgot to say so.

### Generating every pending report at a sitting

The grading queue and a student's record each offer one button for everything outstanding on them, covering exactly the `needs_report` bucket of what the list is currently showing — so a search narrowed to one student offers that student's report, and the Graded tab offers nothing.

- **The subject set is `triageBucket`'s, not a second opinion.** `planBatch` in `lib/grade/batch.ts` filters on the `bucket` each row already carries rather than re-deriving one. A disagreement here would mean reports generated for work nobody asked about.
- **The batch is N requests, not one.** Each submission is its own tRPC call and function invocation, six at a time. A single submission takes about two minutes against a 300-second limit, so one invocation per submission satisfies the only requirement that ever argued for a worker process — see [ROADMAP.md](ROADMAP.md#what-the-review-pass-left-open). Six rather than the twenty concurrent sandboxes the account allows, because the binding limit is Anthropic's output tokens per minute and running at the cap would leave nothing for a second instructor. `NEXT_PUBLIC_BATCH_GENERATE_WIDTH` raises it without a deploy.
- **The first submission runs alone on an assignment's queue, and does not on a student's record.** The cacheable block is the system prompt, so one assignment's queue is many students against one identical prefix and firing them all cold means every request pays to *write* the cache. A student's record is the opposite: each row is a different assignment with different answer keys.
- **One submission is graded once, enforced in a single statement.** The draft is claimed with `INSERT … SELECT … WHERE NOT EXISTS`, which decides and writes at once and leaves no check-then-act window — the same reasoning as `modules.reorder`. Scoped to the commit rather than the submission, because a run against an older commit describes different code, and with `IS NOT DISTINCT FROM` rather than `=`, because `head_sha` is null for hand-graded work.
- **A claim older than fifteen minutes may be taken.** A run that dies leaves its row `GENERATING` and nothing in the interface clears one, so without expiry a crash would block that submission's report forever. Fifteen against a worst case under five is the margin that makes expiry safe.
- **Closing the tab stops the batch**: what is in flight finishes on the server and its report lands, nothing further starts, and reopening shows exactly what got done, because each draft row is its own record. For a whole cohort, that is the point at which a durable job design becomes worth building, and it is why the [automatic half](ROADMAP.md#triggering-and-orchestration) is still unbuilt.
- **The claim is taken late** — after the test run, immediately before the model calls — so two genuinely simultaneous attempts both pay for a sandbox before one discovers it lost. What the late claim prevents is the model calls, the expensive half by an order of magnitude.

### Triage

`lib/grade/triage.ts` holds one function deriving a bucket from the submission status, its draft, whether that draft is stale, and whether an approval failed to deliver. Triage, the queue filter, and the gradebook cells all call it.

| Bucket                | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `needs_report`        | Submitted, and no report has been generated                               |
| `needs_manual_grade`  | Submitted on an assignment the pipeline cannot grade; waiting on a person |
| `draft_ready`         | A report is waiting to be reviewed, with or without cross-check findings  |
| `grading_failed`      | The run failed before producing a report — infrastructure, not a zero     |
| `comment_not_posted`  | Approved, there is a pull request, and the comment never reached it       |
| `generating`          | A run is in flight; not counted as outstanding                            |

- **`needs_manual_grade` is not `needs_report`**, because the action differs and `needs_report` offers a button that must not appear on an assignment nothing can generate a report for. It is also not `needs_manual_review`, which is a report that exists and cannot be trusted.
- **`comment_not_posted` requires a pull request to have existed.** Without that condition every finished hand-graded submission sits there permanently with nothing an instructor can do to clear it.
- **Triage counts work the instructor has not done, which includes work not yet started.** Reports are generated *by* an instructor, so a submission with no draft is the first bucket rather than a footnote: an empty queue has to mean caught up.

### Resources: what is in a module that is not work

Readings, notes, and videos. **Nothing here is graded, submitted, or in the gradebook**, so a student's course page becomes the whole of the course rather than only the marked parts.

- **`Resource` is a sibling of `Assignment` under `Module`**, not a shared parent both hang off. The tidier model — one "module item" that is either — is a much larger migration, since `Assignment` is referenced by submissions, grading drafts, and test runs. The cost of the cheap version is paid in exactly three places: the student's course page, the Modules screen, and the Resources screen each merge two lists.

| Kind    | What it is                                   | Where it lives                              |
| ------- | -------------------------------------------- | ------------------------------------------- |
| `LINK`  | A title, a URL, and one line about it        | `url`, `description`                        |
| `TEXT`  | Markdown an instructor writes                | `body`                                      |
| `VIDEO` | A YouTube or Vimeo video, played on the page | `videoProvider`, `videoId`, and a watch URL |

- **The video vocabulary is closed.** Accepting pasted embed HTML would put an arbitrary iframe on a page every student opens. `parseVideoUrl` matches a URL against the shapes the two supported providers use, takes the id out, and stores provider and id; `videoEmbedUrl` builds the frame's address from those two and never from a typed string. Anything unrecognised is refused when saved, where an instructor can fix it. Matching is on the **parsed host** rather than a substring, because `https://evil.example/youtube.com/watch?v=…` contains "youtube.com" and is not YouTube.
- **No draft state.** An assignment has `distributedAt` because handing one out starts a clock; a link to a reading does not. `resources.listForCourse` returns the same rows to a student and an instructor. Adding the column later is cheap; taking a publish step away once instructors rely on it is not.
- **No `position`.** Assignments sort by due date with the undated last, resources alphabetically by title, and resources never interleave with assignments — they sit in a section beneath them. Two sequences are never merged, so nothing has to decide how a deadline compares to a title.
- **No `courseId`.** Every query has a module to reach through, so the denormalized column would be one more thing that can disagree with the module it hangs off. It also makes the authorization check natural: a write names a module, and the module says which course to check.
- **Removal is a plain confirmation** rather than the typed-title one an assignment needs, because this destroys a title and a URL. A resource cascades with its module, where an assignment restricts: `modules.remove` refuses while assignments reference it because those carry grades.

### Groups, and grading a portion of a cohort

- **A group is a named set of students and nothing else.** It has no instructor, grants no permission, and decides nothing about who may grade. An instructor picks one from the filter on grading triage, an assignment's queue, the gradebook, or the assignments list, and those four screens narrow to it. The overlap stops because the piles stop overlapping, not because anything is refused — a co-teacher covering for somebody else must still be able to approve their drafts.
- **`CourseGroup` is a name unique within a course.** `GroupMembership` joins it to an **enrollment** rather than a profile, so the foreign key guarantees a group's members are students of that group's course; membership is many-to-many. `CourseInstructor.gradingGroupId` remembers which group an instructor is working, one value across every screen.
- **"All students" is the absence of a filter, not a row.** As a real group it would have to be kept in step by every path that creates an enrollment, and could be renamed, deleted, or emptied — each of which puts a student outside the default view. As `null`, "every student is in the default view" is true by construction. **"Ungrouped"** is the picker's third kind of entry and is deliberately not remembered: it answers "has anybody been missed" rather than "whose work do I grade".
- **The filter is applied on the server, in all four procedures.** Triage and the queue could narrow in the browser, but `assignmentsOverview` aggregates its counts before sending them and cannot. `activeStudentWork` and `enrollmentsIn` in `lib/courses/membership.ts` both build from one `groupCondition`, folded into the same enrollment clause that excludes removed students — two separate `where` fragments would have collided on the `student` key and silently replaced one another.
- **A screen that narrows says what it narrowed to.** Triage reports being caught up when its piles are empty, and filtered that is a claim about the group, so the heading names it. The queue keeps an out-of-group submission openable by link with a banner saying why.
- **Groups are made on the roster**, the only instructor screen with no group filter — it is where a student who is in nothing gets placed. They are not copied when a course is copied.
- **A group is not a team, and they are separate tables.** Work handed in by several students together is a [team set](#teams-and-work-handed-in-by-several-students), and the two mechanisms share nothing. The prediction here used to be that they would share this table; building it showed why they must not. A group is a filter an instructor picks and students never see; a team hands in one piece of work, receives one grade, and its members can see each other. Sharing one table would mean every screen asking which kind it had, and would put a finished project's teams in this picker forever. What is still deferred is only [an assignment given to *part* of a cohort](ROADMAP.md#targeted-assignments-and-excusing-a-student), which is targeting rather than teamwork, and a group is still the right shape for it.

### Teams, and work handed in by several students

- **A team set is a named, reusable collection of teams inside one course.** Creating one asks for a name and a number of teams, and the instructor then places each fellow on one of them. An assignment may point at one set, and **pointing at a set is what makes the assignment team work** — there is no boolean beside it, for the same reason an assignment has no `category` column to agree or disagree with its unit's.
- **A set rather than a flat list of teams**, because a course runs several projects and each wants its own division of the same cohort. An assignment names the set, not the teams in it, so pointing the second and third deliverables of one project at the same teams is one choice rather than a list re-picked each time — and last term's divisions sit harmlessly in their own set rather than crowding anything.
- **`@@unique([teamSetId, enrollmentId])` is what makes a set a partition.** One team per fellow per set, which is what gives "which team are you on for this project" a single answer; they may be on a team in every other set. Membership joins an **enrollment** rather than a profile, following `GroupMembership`, and three composite foreign keys hold a membership to one course from both ends — there is no `courseId` a row could hold that satisfies all three while naming another cohort's student.
- **A team's submission is one row per member, and one of them holds the work.** That row carries the repository, the pull request, the pasted link, the uploaded file, and every grading draft and test run; the rest are **mirrors** pointing at it through `teamSubmissionId`, carrying status and outcome and nothing about where the work is. `studentId` stays NOT NULL and one row per (assignment, student) still holds, which is what lets the gradebook, the CSV export, a student's own feedback page and the Salesforce columns go on reading one row per student with no knowledge of teams at all.
- **Everything about *where* the work is stays on the one row** — not just `repoFullName`, which is unique anyway, but `repoUrl`, `prNumber`, `headSha`, `submittedUrl` and `uploadPath`. On five rows each is five chances to be stale, and a mirror carrying a `headSha` with no `gradedHeadSha` beside it would read as "pushed since graded" for good. `lib/submissions/team.ts` is the one place that knows the split; no call site chooses what a mirror receives.
- **Any active member may hand in, and the row does not move.** A later hand-in by a different member writes onto the same row, and `handedInById` records which of them handed in the version now standing. Moving the row instead would carry a team's feedback history between students, since a grading draft points at a submission — and one column produces the same sentence on every screen with none of that.
- **The first member to arrive claims the row, and the race is settled by losing it.** Two members pressing Accept in the same moment both find no team row and both try to claim one; the loser is refused by a partial unique index on `(assignment_id, team_id)`, looks again, and finds the winner's. Whether the repository exists is then read from the row rather than assumed from having won, so a failure at GitHub cannot leave a team with a claimed row and a repository nobody will ever create.
- **One repository per team, named after the team.** `teamRepoName` puts the team's slug where a student's login goes, because the repository belongs to the team: every active member is a collaborator with push access, and a name carrying one member's handle would say otherwise for the rest of the term. A member with no linked GitHub account is warned over rather than refused — they must not block their teammates — and is invited on their next visit.
- **Approval writes the grade to every member in one transaction.** One object serves the row holding the work and the `updateMany` over its mirrors, so the two cannot diverge; it is keyed on the column rather than on ids read a moment earlier, because a member placed on the team in between would otherwise be silently missed. Inside the transaction rather than after it, so a failure rolls the release back rather than leaving a graded submission whose teammates have no grade and a draft that refuses re-approval.
- **One `GRADE_APPROVED` audit event per member.** The action is defined as a grade released to a student, and four students receiving one is four releases — the same reasoning `ATTENDANCE_CHECKED_IN` uses. The table stores a uuid beside a snapshot of what it was called at the time precisely so a later reader never has to resolve membership *as it is now*, and team membership is editable.
- **A mirror is not work, and that is the one thing every instructor-facing read had to learn.** `triageBucket` reads `mirrorsAnotherSubmission` first — ahead of the undelivered comment that outranks everything else, because a mirror has no pull request and so is never owed one — which covers triage, the queue, `planBatch`, the assignments list's "to grade" column and the gradebook's amber dot. Two callers a parameter could not reach have their own: `gradedCount` is a `count` and filters in SQL, and `asideReason` takes the row rather than a student id. The gradebook keeps every cell, because the student really does have that grade.
- **`teamAwareWork` widens `activeStudentWork` by one case**: a team's work stays in the pile while any member is still in the cohort, since the row holding it belongs to whichever member arrived first and they can leave. It is keyed on `AND` rather than spread, because the triage pile already has an `OR` of its own and a second one would silently replace it.
- **Whether an assignment is team work is frozen once it is published**, the same rule and the same sentence `kind` uses on that form. Turning it on afterwards would force a choice of whose work survives among students who had already submitted separately; turning it off would leave every member but one holding a grade whose feedback history belonged to somebody else's submission.
- **A member sees their own team and nobody else.** The display name of the fellows on the caller's own team in the set *this* assignment names, and which of them handed in — resolved from the caller's own membership rather than from any id they could pass in. Not their email, not their GitHub handle, not their scores, not their read receipts, and nobody on another team. It is the first read in this application that shows one student anything about another, which is why the select is its own and narrower than `personSelect`.
- **A read receipt stays each member's own.** `feedbackReviewedAt` is the single column a release does not copy, so one member reading the feedback leaves it unread for the rest. `gradedAt` *is* rewritten on every release, which is what makes a second round read as unread again.
- **The report is addressed to the team, in the user half of the prompt only.** Team-ness in the cacheable system prefix would give every section type two prefixes and every team its own, so every request would be a cache write — for five to eight submissions, far too few to warm a prefix. The report is told not to attribute any part of the work to a member, not to guess from commit history, and not to add rubric items naming one: those items are free text, they sum correctly, and the cross-check would pass a per-member breakdown straight through to the students.
- **One grade for every member.** A per-member override would break the one mechanism holding the gradebook's number and the prose the student reads together — `statedScoreInText`, which approval enforces — because a member's row would say 18/30 while the only report explaining it said 24/30. The honest version of "this member gets a different grade" is an explicit action detaching their submission from the team, which is not built.

### Attendance

- **A session exists because somebody started one.** There is no calendar, no term dates, and no timetable — the first press of the morning creates the `AttendanceSession`, which is the same trade `CourseGroup` makes and has the same named consequence: **a morning nobody opened is indistinguishable from a morning the cohort did not meet.** Nothing detects a forgotten Tuesday and nothing tries; without knowing which days are school days a warning would fire on Saturdays and over winter break, and one wrong twice a week is one people stop seeing. What it buys is that snow days, field trips, and a schedule that changes in March need no maintenance at all.
- **Attendance belongs to a `Course`, not to the program above it.** A fellow belongs to a program and a cohort and takes several courses inside one, but `Course` is the only cohort-shaped model here, so three courses meeting on a Tuesday are three sessions to check into. Three cohorts is also what decides the shape of it on the dashboard: **one row each, not one card each.** A row is a line of squares, a figure, and — on a morning with a session open — four digits to type, so three of them cost three lines above the work rather than three panels. The full card, with room to say who marked you and at what time, is on the course's own attendance screen, where the rest of a fellow's record lives.
- **`date` is the project's only `@db.Date`.** Every other timestamp is a moment; a school day is what `@@unique([courseId, date])` has to be exact about, and that constraint is what makes two instructors pressing start at 9:00 and 9:01 collide instead of producing two sessions with two codes. A timestamptz holding "midnight in New York" is unique only if every writer computes the same instant, and UTC midnight, the current time, and a daylight-saving boundary each produce a second row while the constraint sits there satisfied. **The wire format is a `"YYYY-MM-DD"` string, never a `Date`** — Prisma returns the column at UTC midnight, which a browser in Brooklyn renders as the previous day. `lib/school-time.ts` owns both conversions and also owns `SCHOOL_TIME_ZONE`, which moved out of `lib/status.ts` when it stopped being only a display concern.
- **Starting a session uses `createMany` with `skipDuplicates`, not `create` in a try/catch.** Catching Prisma's P2002 cannot work inside a transaction: Postgres aborts the whole transaction on a failed statement, so the read meant to recover from the collision fails too. `ON CONFLICT DO NOTHING` never raises, and the returned count is what says who won the race.
- **The code is derived, never stored.** `HMAC-SHA256(session.codeSecret, "<sessionId>")` reduced to four digits. Nothing holds "the code", which is what makes two instructor screens agree without talking to each other and a deploy at 9:03 invisible to a room mid-check-in. The derivation reads no clock, so an instructor correcting a session that began five minutes late does not change the digits a room has already been given.
- **One code per session, and the decision is about distribution rather than cryptography.** A code that changed every thirty seconds had to be *displayed* continuously, which meant it had to occupy the shared screen — the same screen the lesson needs. The cost showed up in two places: an instructor either surrendered the screen for the first five minutes of every class, or a fellow arriving at twenty past had no way in without the lesson stopping for them. A fixed code is *distributed* once instead: read aloud, pasted into the chat, put on the first slide, or left up on a projector. This is why `sessionCode` is read by the attendance screen beside a Copy button and not only by the projector window — the code has to be distributable, and only sometimes needs to be displayed.
- **What that costs is one thing, and it is not guessing resistance.** A fixed code can be passed to somebody at home and will work until class ends, where a rotating one worked for a minute. That is the real loss and this design accepts it. Guessing is bounded by the ceilings and always was: ten thousand codes with one live code is one guess in ten thousand, where rotation had to accept the previous code too and so kept two live. `assertActiveStudent` means the guesser is already one of twenty-five people on the roster rather than the internet; the session is capped at ninety minutes; a failed attempt writes `ATTENDANCE_CHECK_IN_FAILED` and `assertWithinRate` holds it to ten in ten minutes; and a second ceiling counts failures within the session itself and stops at twenty.
- **The remedy for a leak is `rotateCode`, and it is an instructor's judgment rather than a clock.** Replacing the session secret kills the old code at once. That is the same act an instructor would want under any scheme — a rotating code never prevented a leak either, it only bounded one nobody had noticed. The control sits beside the code on the attendance screen, worded as what it does and confirmed inline, because pressing it invalidates the code twenty-five people are holding. **What none of this solves is a fellow sending the code to somebody at home** — that is collusion rather than authentication, and geolocation is spoofable, invasive, and meaningless on the two remote days. What the record does instead is make it answerable: every check-in stores `checkedInAt`, and a fellow marked in at 10:25 for a class that began at 9:00 reads as exactly that on the grid.
- **`code_secret` is never selected into a payload.** The same rule as `Course.joinToken` and sharper — that one admits somebody to a cohort, this one lets them mark themselves present from bed. `verify:attendance` walks the student-reachable payloads looking for the key, because the failure would be silent and total.
- **Two columns say a session is over, because they answer different questions.** `endsAt` is when the code stops working; `endedAt` is when a person said class was finished. A session is open while `endedAt` is null and now is before `endsAt`, so the ninety-minute backstop needs nothing to run at the ninety-minute mark — which matters, because there is no scheduler in this project. Collapsing them would mean the backstop overwrote a person's decision or a person's decision looked like a timeout, and the log could no longer tell them apart.
- **Absence is derived while a session runs and written down when it ends.** Ending it inserts an `ABSENT` / `FINALIZED` row for every active enrollment that has none, in the same transaction, `skipDuplicates` letting `@@unique([sessionId, enrollmentId])` decide who already had one. Starting a session also ends and finalizes any earlier open session of that course, so tomorrow closes yesterday's books. **A CHECK constraint makes a `FINALIZED` row that says anything but `ABSENT` unrepresentable** — it would be the application asserting attendance on the strength of no code typed and no decision made, which is the one claim this table must never support, because it is the claim a stipend is paid against.
- **A self check-in only ever creates.** It never updates, which is what stops a fellow overwriting an instructor's `EXCUSED` by typing a code they overheard — and `FINALIZED` is excluded from the already-checked-in branch, so somebody who missed the morning is refused and sent to their instructor rather than told they are already in.
- **Status is stored, not derived on read.** Lateness recomputed against a live setting would let an instructor loosen the rule in November and silently convert a term of `LATE` into `PRESENT`, so no report would agree with any report printed before it. Each session copies `Course.attendanceLateAfterMinutes` when it starts, which is what makes the setting editable at all. Editing a session recomputes self check-ins from their stored `checkedInAt` and **leaves instructor decisions alone**, because silently reverting a decision a person made about a person is the worst outcome available here.
- **The record hangs off the enrollment, following `GroupMembership`**, and its foreign key is composite — `(enrollmentId, courseId)` against a redundant `@@unique([id, courseId])` on `Enrollment`. `setStatus` takes an enrollment id from input, and this is what makes a record against another cohort's student unrepresentable rather than merely refused by the procedure that happens to write it today.
- **A fellow is only measured against sessions they were enrolled for.** Somebody who joined in March has not missed February, and counting it would put a wrong number in a real report. **An excused absence still counts as missed**, which keeps one denominator and one rate.
- **No group filter, on either attendance screen.** `resolveGroup` falls back to an instructor's remembered grading filter, so somebody who narrowed the gradebook last Tuesday would open the morning board to "11 of 15" — wrong about the room while looking entirely correct. The roster has no filter either, for a different reason: it is where groups are made.
- **A fellow's own record is a calendar, not a list.** It was a collapsed list of every session, and the collapse was the defect: a term is sixty rows of mostly "present", so it was folded away, and folded away it stopped doing the one thing it is for — letting somebody notice a pattern in their own attendance before it is pointed out to them. A month of squares says it unopened. Colour is never the only signal: every square carries its date, a letter, and a title, because a calendar that separates present from absent by hue alone is unreadable to about one fellow in twelve. Late is green with a corner mark rather than a colour of its own, since green means the session counted as attended and late does — putting it beside excused, which does not, would be the wrong grouping. The month arithmetic is `lib/attendance/calendar.ts`, on UTC throughout for the reason everything else about a school day is.
- **The month calendar and the dashboard's week strip share one vocabulary of squares**, in `lib/attendance/cells.ts`: what each kind means, what colour it is, and the rule that a morning with no session is blank rather than grey — a coloured square for a day the cohort never met is the grid inventing an absence. Two maps of class names is how one screen comes to call a Tuesday something the other does not, which is the mistake `lib/student/progress.ts` records having made once already. The week itself is Monday-first, unlike the month grid's Sunday: a month is a calendar, and a school week starts when the cohort does. Five columns is the ordinary week, and a session held at a weekend widens the row rather than being dropped from it.
- **Two tabs at one address, and a drill-down under it.** Taking attendance happens in the first minutes of class and wants a board and nothing else; reading the record happens at a desk and wants the term at once. As two addresses the morning question sat one click from the monthly one. One earlier session stays a separate route rather than a third tab, because it is reached by naming a day — a tab for "some day you have not chosen" has nothing to show until you have.
- **Two architectural firsts, both confined to this feature.** Polling belongs to attendance and nowhere else: the check-in board, the projected code, the fellow's check-in card, and the week strip on the dashboard. Every other screen is server-rendered and refreshed by `useServerMutation`, which is right when a screen changes because you changed it and wrong when it changes because twenty-five other people are — or because an instructor started a session two minutes after somebody opened their dashboard. The instructor's polls stop when the session closes, which the backstop guarantees happens. And `/present/attendance/[courseId]` is the only route outside `app/(shell)/` — it renders full-bleed so it can sit on a second monitor, on a projector, or be the one window shared into Zoom, and it costs no authorization, since the proxy redirects every path but `/`, `/login`, and `/auth`. Opening it is optional: an instructor teaching from a shared application window copies the code off the attendance screen instead, which is the case a fixed code exists to serve.

---

## Interface

`app/(shell)/` holds the signed-in application; `app/auth/` holds sign-in, the OAuth callback, the emailed-token route kept for recovery, and the error screen — see [signing in](#signing-in).

| Route                                                       | Screen                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/profile`                                                  | Your own account: the name everybody sees, and what is stored about you |
| `/dashboard`                                                | A student's work across every cohort. Where signing in lands            |
| `/courses`                                                  | A student's courses                                                     |
| `/courses/[courseId]`                                       | Assignments and progress for one course, `?assignment=` to open one     |
| `/courses/[courseId]/attendance`                            | A fellow's own attendance record in one cohort                          |
| `/instructor`                                               | Nothing: picks the most recent cohort the caller teaches and redirects  |
| `/instructor/courses/[courseId]`                            | Nothing: redirects to that cohort's settings                            |
| `/instructor/courses/[courseId]/triage`                     | What is waiting on the instructor in this cohort                        |
| `/instructor/courses/[courseId]/attendance`                 | Two tabs: today's check-in, and the whole term with its export          |
| `/instructor/courses/[courseId]/attendance/day/[date]`      | One earlier session, for correcting it                                  |
| `/instructor/courses/[courseId]/assignments`                | Every assignment in the cohort, and where new ones are made             |
| `/instructor/courses/[courseId]/resources`                  | Readings, notes, and videos, by module. Nothing here is graded          |
| `/instructor/courses/[courseId]/gradebook`                  | Assignments × roster, each cell carrying its triage bucket              |
| `/instructor/courses/[courseId]/roster`                     | Who is expected, who has joined, the join link, and the cohort's groups |
| `/instructor/courses/[courseId]/modules`                    | The order the cohort is taught in                                       |
| `/instructor/courses/[courseId]/settings`                   | The cohort itself: short name, instructors, archiving                   |
| `/instructor/courses/[courseId]/assignments/[assignmentId]` | The grading queue and the review surface, `?submission=` to open one    |
| `/instructor/courses/[courseId]/students/[studentId]`       | One student's whole record in this cohort — the queue's other axis      |
| `/instructor/assignments/[assignmentId]`                    | The queue's old address: looks up the course and redirects              |
| `/admin`                                                    | Staff: who may teach, and who may decide that. Admins only              |
| `/join/[token]`                                             | Where a cohort's student join link lands, and says whether it is theirs |
| `/invite/[token]`                                           | Where an instructor invitation lands                                    |
| `/co-teach/[token]`                                         | Where a cohort's co-teaching link lands                                 |
| `/present/attendance/[courseId]`                            | The session code, full-screen. **The only route outside the shell**     |

### What is due, across every cohort

`/dashboard` is where signing in lands and the only read with no course in its input, because **"what is due" is a question that spans cohorts**. Grading triage refuses to work across courses for the opposite reason: an instructor's "what do I do next" depends on which cohort they are teaching this hour.

- **Your week**, a strip above everything else: one row per cohort, this week's mornings as squares, the term's attendance beside them, and the check-in code on the mornings a session is open.
- **Overdue**, above the rest of the work.
- **Needs another attempt** — graded work that came back below the completion threshold, longest-outstanding first.
- **Coming up**, soonest first, with the date and how far off it is. "Thursday, Oct 9 at 11:59 PM" is what goes in a calendar and "in 2 days" is what says whether to worry.
- **Feedback to read** — graded work that met the threshold and carries a report the student has not marked read, newest first, capped at ten. A cap rather than a scroll, because a list of thirty says the opposite of "there is something new here".
- **Started, not handed in**, quieter than the rest.

Rules:

- **Nothing is dismissible.** Handing the work in is the only thing that clears a deadline, handing it in again is the only thing that clears a second attempt, and marking the report read is the only thing that clears a report. A dismiss button would let this screen say a student was finished when they were not.
- **Graded work is never a deadline**, including work below the threshold: resubmitting is a second attempt at work already handed in, and listing it as overdue would claim a missed deadline that was in fact met. What that work gets instead is its own list, which is a statement of what to do rather than of what was missed.
- **Reading a report is not doing the work.** Marking feedback read clears a row from Feedback to read and clears nothing from Needs another attempt. The two lists partition on `isComplete`, so no assignment is counted twice by somebody reading down the screen.
- **Coming up is seven days deep, and what falls outside it is counted rather than listed.** Published work runs to most of a nine-month course, and a student in week two would otherwise scroll past forty assignments they have no reason to start. The count exists so the empty state can say "nothing due this week" instead of "you are up to date" — a screen that drew no rows and reported no number would be making the same claim a dismiss button would. Overdue is never windowed.
- **"Started" means `ACCEPTED` and nothing else.** The broader reading — every published assignment not yet accepted — is most of a nine-month course.
- **The same work is available as a calendar feed**, which is the other reader of this procedure's scoping — see [subscribing a calendar to due dates](#subscribing-a-calendar-to-due-dates).
- **`assignments.listMine` is the one read behind the lists**, with a `select` much narrower than `listForCourse`'s: no `feedbackMarkdown` and no grading drafts, since the dashboard draws a score and a link. It is scoped to active enrollments in cohorts that are still running, because a removed student keeps reading their feedback but must not be told to hand in work that would be refused.
- **`attendance.myWeek` is the read behind the strip**, and the second procedure with no course in its input. It takes `attendance.today`'s scoping rather than `myHistory`'s: a fellow removed from a cohort keeps reading their record there, but has no week in it and should not be told to turn up. The week crosses the wire as days and the rate as a term — a *weekly* percentage would be a confident wrong number, because a session exists only when an instructor starts one and a forgotten Tuesday would read as a full week. Its cumulative figure comes from `summarize`, the same function the course's own attendance screen reads, so the two cannot disagree about a fellow's rate.
- **`/dashboard` forwards anybody who is not a student to `/instructor`.** That is routing rather than authorization: `listMine` would answer an instructor honestly, with the handful of cohorts they are enrolled in as a student. It is also why all three sign-in paths name one destination — two run in the browser before any profile has been read.

### Where a course stands, in one line

The student's course page opens with a segmented bar over every assignment they can see, and the number beside it — "7 of 9 complete" — is the same function as the bar's green segment. `completeCount` and `progressSegments` both live in `lib/student/progress.ts`, and neither the header nor the bar computes anything itself.

- **The bar is decoration and the text under it is the content.** The bar is `aria-hidden`, the count and legend are real text, and nothing is said in colour alone — which is what makes it readable on a phone and to a screen reader. Tooltips carry nothing the legend does not.

| Segment                | Colour        | From                                                                           |
| ---------------------- | ------------- | ------------------------------------------------------------------------------ |
| Not accepted           | outlined grey | no submission row, or `NOT_STARTED`                                            |
| Accepted, in progress  | filled grey   | `ACCEPTED`                                                                     |
| Submitted for feedback | amber         | the five queue-shaped statuses, and a resubmission of work below the threshold |
| Graded, incomplete     | red           | `GRADED` below the threshold                                                   |
| Graded, complete       | emerald       | `isComplete`                                                                   |

- **Both the tooltip and the legend lowercase the label**, so the wording lives in `SEGMENTS` in one place.
- **The colours are the tone system's**, because the bar sits directly above the status badges it summarises. Green means the completion threshold was met and nothing else, which `lib/status.ts` carries a test for.
- **The five queue statuses are one segment**, for the same reason `STUDENT_STATUS_META` gives them one label: `DRAFT_READY`, `NEEDS_MANUAL_REVIEW`, and `GRADING_FAILED` describe this application's problems rather than the student's work.
- **`isComplete` is read before the status**, which is what stops a completion being taken away. Meeting the threshold is durable, and asking for another look does not withdraw it. It also agrees with the score column beside it, which has always read `isComplete` whatever the status says.

### One assignment, in a panel

`/courses/[courseId]?assignment=<id>` opens a panel over the course list.

- **A panel rather than a row that expands, and rather than a page of its own.** The list stays visible behind it, and it has an address, which a collapsed row does not. That address is what the dashboard links to.
- **It costs no query.** Everything comes from the assignment row the course page already fetched: `listForCourse` returns the approved grading drafts, their sections already collapsed to the instructor's edits by `effectiveSection` on the server, so the model's unedited output never travels to a student's browser.
- **Submissions tab** — the instructions, how to hand in, what was handed in, and the form that changes it. `handInMode` decides which of the four sentences that form is.
- **Feedback tab** — every round, oldest first, with the read marker above them. Offered only when there is something on it, and carrying a count when there is more than one round, since a resubmission is graded afresh.
- **Which tab opens is deliberately not in the address**, unlike which assignment is: a link to a tab is a claim about what the reader should look at first, and that answer changes with the row. Feedback opens when there is feedback.
- **Every row opens**, including an unaccepted assignment, so its instructions can be read before deciding. The Accept button stays on the row as well as in the panel and stops the click from reaching the row. A module holding the assignment the address names is forced open.

### Whether the feedback was read

- **`submissions.feedbackReviewedAt` is compared against `gradedAt` rather than checked for null.** That comparison is what makes one column enough for work graded more than once: a student reads their first report, revises, and is graded again, so a null check would call the second report read before it was written. `feedbackIsUnread` is that comparison and the only thing that should ask the question.
- **It gates nothing.** Resubmitting never waits on it and `assertCanHandIn` has never heard of it. It also does not touch `lastActivityAt`, which drives the instructor's queue ordering — reading feedback is not activity on the work.

### A cohort's eight views are eight addresses

Triage, attendance, the gradebook, the modules, assignments, resources, the roster, and the settings are the sidebar, in that order — the order they are offered in, which is roughly how often an instructor reaches for them. Attendance sits second because it is the only one touched at a fixed time every morning.

- **Each one being an address is what buys the rest.** The course switcher can keep the view across a change of cohort; a link can point at the roster rather than at a page plus a tab nobody can bookmark; and each screen fetches its own data. `courses.roster`, `courses.assignmentsOverview`, `courses.settings`, and a narrowed `courses.gradebook` each answer one screen, and the counts moved to the server with them, still coming from `triageBucket`.
- **The bare course address redirects to settings.** A reader who names a cohort and nothing more is asking about the cohort. It stays a route so every link naming a course goes on working.
- **Two segments need more than a prefix test to highlight.** Assignments covers its own list *and* everything filed under it — one assignment's queue, its edit form, the new-assignment form — because a sidebar that went blank while you graded would be blank where an instructor spends the most time. Settings owns the bare course address, so the item is lit before the redirect resolves. A student's record under `/students/[studentId]` deliberately matches nothing: it is reached from the roster, the gradebook, and the review header, and belongs to none of them.
- **Every instructor route names its course**, because the URL is the only record of which cohort you are in. There is no remembered "current course": a remembered one disagrees with the page the moment you open a link. Where the address names no course — `/courses`, `/admin` — the switcher shows a placeholder and the whole course group is dropped rather than pointed at a guess.
- **A student's sidebar is their courses, and the one they are reading expands.** One row per enrolled cohort under "My courses", each linking straight into that course, with the current one highlighted and showing its own screens — Coursework and Attendance — nested beneath it. A flat list could say which course but had nothing to say which screen within it, which is how attendance first arrived reachable only from a button on the course page. Only the active course expands: three courses each showing everything they hold would be a dozen rows for three destinations, and nobody is choosing among all of them at once. There is no "My courses" item pointing at the list; `/courses` is still a real screen, reached by the breadcrumb and by `/`, and it is what is offered to somebody with no enrollment yet. Archived cohorts and ones a student was removed from stay in the list, labelled with the same words the course cards use, sorted after the current ones.
- **The switcher above is instructors-only, and the asymmetry is a decision rather than an omission.** An instructor teaches cohorts whose screens are identical and which accumulate over years, so a switcher trades one click for a sidebar of fixed height. A fellow is in three courses at once and lands on `/dashboard`, which names no course — a header switcher would greet them every morning with a control pointing at a course the screen is not about, and guessing one is what the note above says went wrong. Nesting costs a taller sidebar and keeps every course one click away.
- **All courses sits in its own group above them, separated by a rule**, because everything below is scoped to one cohort and this is the way out of all of them.
- **Switching cohort keeps the view** rather than returning to a front page. That holds only for the seven views every course has, so an assignment's queue, its edit form, and a student's record land on settings instead. `sameViewInCourse` decides, and a view missing from it falls through to settings rather than failing — which is why all of them are checked by `verify:enrollment`.
- **The breadcrumb's first step is the cohort, name and term together** — "Software Engineering Fellowship (Fall 2026)" — because a program runs every term under the same name. Parenthesised rather than the switcher's middot, since a trail already separates its steps. It costs no fetch: `courses.listMine` is what the breadcrumb reads. It is plain text rather than a link, because there is no course home for it to point at.
- **`lib/links.ts` is the one place these are constructed**, so the triage list and the gradebook cells agree on where a submission opens. `lib/instructor/course-scope.ts` redirects the two routes that name a course twice over — as a segment and through the assignment — when the two disagree.
- **A mutation on an instructor screen refreshes twice, and `useServerMutation` does both.** There are two caches: server components need `router.refresh()`, and client-fetched data (a group picker, a validation preview) needs `invalidateQueries`. Most screens have both. The hook wraps a mutation's options rather than replacing them, so a call site keeps its own `onSuccess`. Its `onError` defaults to a toast; the two forms that print the refusal beside the field pass `shownInPlace`, so silence there is a decision rather than a swallowed error.
- **`PageFallback`** is the padded container around a `ListSkeleton` that Cache Components' shell structure would otherwise need written fourteen times. Its `width` matches what the real page renders, because the skeleton is replaced in place.
- **Three routes outside that table.** `/api/trpc/[trpc]` is the endpoint every browser query and mutation arrives at. `/api/webhooks/github` and `/api/submissions/upload` are exceptions: GitHub's own request and a multipart form cannot go through tRPC — see [handing in a file](#handing-in-a-file) for why the upload's authorization is still procedure code.
- **A wide table scrolls; the page does not.** `SidebarInset` carries `min-w-0`, because a flex item's `min-width: auto` resolves to its content-based minimum, so the gradebook's fifty columns would push it wider than the viewport and the window would scroll sideways instead of the table. `w-full` does not prevent it — that sets the basis and leaves the minimum alone. With a floor of zero, the `overflow-x-auto` around each table is what scrolls. The same rule is why `SelectTrigger`, which is `w-fit whitespace-nowrap`, gets `w-full min-w-0` wherever its label is a course name.
- **Base UI rather than Radix**: `render={<Link/>}` replaces `asChild`, `group-data-[panel-open]` styles an open Collapsible trigger, and `Select`'s `onValueChange` passes `string | null`, so handlers coerce. The course switcher guards instead, since its value is genuinely null wherever the address names no cohort. `Select` also needs an `items` map of value to label whenever the value is not also the label, or the trigger renders the raw value — a course id.
- **"Approved" is not shown beside "Graded."** They are the same fact in two words, so the review header shows the draft's own state only when it says something the submission's does not. `draftStatusAddsSomething` in `lib/status.ts` is that rule, and it also excludes `SUPERSEDED`. The draft history list is the exception and shows every state, because distinguishing the approved round from the superseded ones is its job.
- **A test run has no status badge.** `RunOutcome` immediately below says everything better: a spinner while running, a destructive alert explaining that an error is not a score of zero, another for a timeout, and the pass rate when the suite finished. "Completed" in green above a pass rate of 3 out of 13 is a suite that ran and work that failed.
- **A student's course page shows every module, empty ones included**, built from the course's module list rather than from the assignments in it, so a student can see the shape of the course ahead. An empty module collapses by default and says so. A module whose assignments are all drafts reads as empty to a student and full to the instructor, which is what `distributedAt` is for.
- **The Modules screen is that same page with module management on it.** Each module is a collapsible holding its assignments, with the reorder buttons on the header beside the module they move — so "is this in the right place, and does this module have anything in it" can be answered from the screen that manages modules.
- **The assignments listed there are not interactive.** No links, no menus, no publish toggles: that screen shows the shape, and the assignments list is where assignments are worked on. The accepted cost is that something spotted in the wrong module is moved from the other screen.
- **The gradebook carries the same cells counted along both axes.** A Completed row under the assignment titles says how many students met the threshold on each — "2/5" — and a Completed assignments column says how many each student has finished, "4/10". Both come from `lib/gradebook/summary.ts`, reading the payload the grid is already drawn from.
- **Complete means `isComplete` and never a score compared against a threshold**, here as everywhere: that judgment is made once, by `approveDraft`, in the transaction that writes the status. The column is nullable, so the test is `=== true` — null is "no verdict yet". The two denominators differ on purpose: a column is measured against every student in the table, so an assignment nobody attempted reads "0/5" rather than "0/0"; a row is measured against every assignment in the course, so publishing something nobody has seen does not move a figure about work already done.
- **A second column counts what is waiting on the instructor**, from `bucket != null`, which is exactly what draws the amber dot. A bare count rather than a fraction. It is blank in the Removed students table, for the same reason the amber dot is suppressed there.
- **A legend above the grid names the three marks a cell carries when it has no score** — an empty ring, a grey dot, an amber dot, in the order work moves. One shape at three fills rather than three symbols, which is also what keeps the pair legible to a reader who cannot tell the hues apart; every mark carries its label as text. The student's progress bar draws the same distinction the same way.
- **The legend takes its labels from `SUBMISSION_STATUS_META` and writes its own descriptions.** The labels because that map is the instructor's vocabulary everywhere else; the descriptions because the map's are about repositories — "No repository created yet" — which is false of three of the four kinds, and a gradebook mixes kinds freely.
- **Each table summarises only itself**, so the Removed students table's figures contribute nothing to the cohort's. The per-student column is deliberately not a second frozen column: only one thing can be pinned to the left edge, and a second means hand-computing its offset from a first column whose width the table does not fix.
- **The grading queue opens on All.** The tabs are All, To do, and Graded, and a leftmost tab that is not selected reads as a control somebody has already touched. The queue answers "how is this cohort doing on this piece of work"; "what do I do next" is [triage](#triage).

### Your own account, and the name a roster shows

- **`/profile` belongs to a person rather than to a cohort**, which is why it sits at the top level and why a student and an instructor reach the same address. It is reached from the account menu at the foot of the sidebar and nowhere else. There is no role gate, because `me` and `updateDisplayName` are both scoped to `ctx.user.id`.
- **The display name is the only editable field.** Every account arrives with one the signup trigger derived — a GitHub profile's full name, otherwise `split_part(email, '@', 1)` — so a roster opens reading `bspector`, `amina.k`, `jrivera23`. That string is also the gradebook's column of students, the grading queue's heading, and the sentence naming whose work is being read.
- **`displayNameSchema` in `lib/people.ts` is one definition read by the form and the procedure**, for the reason `lib/assignments/spec.ts` holds one definition of an assignment. `.trim()` runs before the length checks, which makes `"  "` too short rather than two characters long. The ceiling is also a `maxLength` on the input, so it stops the typing instead of refusing the save; the floor of two is there because `initials` draws a single letter either way. There is no way to clear a name.
- **The rest of the screen is read-only and says where each value comes from**: the email is what Supabase authenticates, the GitHub login is recorded by `sync_github_identity` and is fixed once a repository has been named after it, and the role is an admin's decision on the Staff screen.
- **A card lists what the application stores about a person, and what it does not** — four columns, the cohorts and groups somebody is in, the work they hand in, their grades and feedback, and then, said outright, no date of birth, address, phone number, government identifier, or payment detail. It is hard-coded rather than generated from the schema, because a derived list would grow a row the moment a column was added, where the value of the card is that somebody decided each line belonged on it.
- **A card hands out the address of the student's own calendar feed**, and is the only place one is created or replaced. Students only, following the same judgment `/dashboard` makes when it forwards an instructor to their grading queue: a list of what is due is a student's screen. See [subscribing a calendar to due dates](#subscribing-a-calendar-to-due-dates).
- **Under an admin's test-student view this screen is the test student's**, because `createTRPCContext` substitutes the id for the whole request. Saving renames the test student, so the card says so above the amber banner already on screen. See [seeing a course as a student sees it](#seeing-a-course-as-a-student-sees-it).

### Subscribing a calendar to due dates

A student copies one address into Google Calendar, Apple Calendar, or Outlook, and their calendar polls it from then on. **There is no OAuth, no Google API, and no credential held here** — the whole feature is `GET /api/calendar/[token]`, a route that renders text, and one column on `profiles`. What it buys is that a moved deadline and a newly published assignment both reach a subscriber without anybody pressing anything.

- **A route handler rather than a procedure**, because a calendar application sends no cookie, speaks no tRPC, and wants `text/calendar`. It is reachable without a session already: `lib/supabase/proxy.ts` excludes `/api` from the sign-in redirect for the webhook's sake, so a request with no cookie passes through instead of being answered with an HTML login page — which the calendar would then try to parse as a calendar.
- **The token is the whole of the authorization**, which is why the feed carries titles, cohorts, deadlines, and a link back into the application, and never a score, a status, or whether work was handed in. The address is a credential a student may paste into a shared calendar, forward, or lose; a leaked deadline is an inconvenience and a leaked grade is not. It is `newJoinToken` — the same generator as a course's join link — written the first time somebody asks for their link and replaceable from the same card, which is what makes an address that went somewhere unintended a five-second problem.
- **One feed across every cohort, sharing `distributedToStudent` with `assignments.listMine`.** Published work, in a cohort that is not archived, with an active enrollment, and a `dueAt`. The function is in `lib/assignments/scope.ts` and is called by both readers rather than written twice, because a feed telling a student to hand in work for a cohort they have finished — or hiding an assignment their dashboard shows — is a disagreement nobody notices until somebody misses a deadline. `verify:calendar` asserts the two answer identically.
- **Times are emitted in UTC**, which needs no `VTIMEZONE` block and cannot be misread: the calendar converts them, so a deadline set at 11:59 PM in Brooklyn renders as 11:59 PM there. There is no course timezone to consult and there should not be — `SCHOOL_TIME_ZONE` exists so a deadline means the same instant to everyone in the cohort.
- **A thirty-minute block ending at the deadline, and the deadline in the title.** The event needs a duration at all because a calendar draws a zero-length event as a hairline and because iCalendar forbids a `DTEND` equal to its `DTSTART`; it runs up to the deadline rather than away from it, because the half hour before something is due is the half hour a student is looking for it. The end is the deadline rounded up to the next half hour and the start is thirty minutes before, so an 11:59 PM deadline draws from 11:30 PM to 12:00 AM and sits on the due date's own evening. The exact minute is not lost — `Due at 11:59 PM: swe-1-5-arrays` is the title, formatted by `formatSchoolTime` so the calendar says a time in the same words the dashboard does. It is the one literal time in the feed, and text is the one thing a calendar cannot convert.
- **A stable `UID` is what makes a re-poll update an event rather than duplicate it**, and it is the detail that becomes a support burden if it is wrong. It is `{assignmentId}@lms.marcylabschool.org`: the assignment's own uuid inside a namespace spelled as a domain, which is the `Message-ID` convention and is what keeps these identifiers from colliding with any other system's. **The domain is a constant and never the request's host** — built from the host, one assignment would be a different event on a preview deployment than in production, and a student who subscribed from both would hold a duplicate of every deadline.
- **The two pure modules are where the rules live and where they are tested.** `lib/calendar/due-dates.ts` decides what a deadline becomes; `lib/calendar/ics.ts` knows the format and nothing about assignments. The split is because the two fail differently: a mistake in the second produces a document no calendar will parse, and a mistake in the first produces one that parses and says the wrong thing. Three format rules are each their own function with its own test, because all three fail silently — CRLF line endings, escaping the four characters that mean something to a parser, and folding at 75 **octets** rather than characters, since folding by character count would produce lines at twice the limit and slicing a string by index can cut a multi-byte character in half.
- **Subscribing and importing are different acts, and the feed is built to steer towards the first.** Every calendar application offers both a click apart, and the wrong one appears to work: an import copies today's deadlines once and never changes again, so a student's calendar goes quietly stale with nothing to say so. Two things follow. **The response carries no `Content-Disposition`** — that header describes a file to save, and advertising a filename is what puts the download-and-import path in front of somebody. And **the Add to Google Calendar link spells the address `webcal://`**, not `https://`: Google's add-by-URL endpoint refuses an `https` address in its `cid` with "Unable to add calendar, check the URL" and accepts the identical address under `webcal`, which it maps back to `https` itself. Apple Calendar reads `webcal` as a subscription to set up for the same reason. The address offered for copying stays `https`, because that is what the "From URL" and "New Calendar Subscription" boxes take.
- **The calendar names itself twice.** `X-WR-CALNAME` is the Apple convention every client grew up on and `NAME` is what RFC 7986 added to replace it, so the feed emits both rather than betting on which a reader knows; `DESCRIPTION` and `X-WR-CALDESC` are the same pair for the sentence beneath it. **Google reads the name and shows it**, checked against a real subscription on a deployment: the calendar appears as "Marcy Lab School — due dates" and not as its address. A subscription that shows the address instead is one that has never managed to fetch, which on a local address it never will.
- **A feed on `localhost` cannot work, and it fails in a way that looks like a bug in the feed.** Google fetches the address from Google's own servers, where `localhost` is Google's machine, so the subscription is created and never fetches anything: no events appear, and the calendar keeps the URL as its name because nothing was ever read. Both symptoms have one cause and neither is visible from the application, whose own logs record no request at all. Checking a change against a real calendar means a deployment, which is why [what is verified](#what-is-verified-and-how) keeps that as a manual step rather than pretending a script can do it.
- **No `METHOD` and no `SEQUENCE`.** A feed carrying `METHOD:PUBLISH` is treated by several clients as a one-time import rather than a subscription. `SEQUENCE` is meant to be a revision counter and there is nothing here to derive one from honestly, so `LAST-MODIFIED` carries that meaning.
- **`Cache-Control: no-store`, and no rate limit.** Nothing is cached because a calendar polls roughly daily anyway, so there is no load to relieve and a cached copy would only add to the delay before a moved deadline arrives. Nothing is rate limited because the handler is one indexed lookup and one query and the token is 122 bits of randomness. Nothing is written to the audit log either: that log holds the acts that decide who can see whose work, and this address grants only the titles and dates of work its holder was already assigned.
- **The known limit, stated on the card rather than left to be discovered: a calendar checks for changes roughly once a day.** A deadline moved the night before will not reach a subscriber in time. If instructors turn out to move deadlines close to the wire in practice, that is the finding that argues for the Google API integration and nothing else is.
- **A student with nothing due gets an empty calendar, not a 404.** A valid `VCALENDAR` with no events is the honest answer and what a client expects; refusing would make a subscription that is working look broken.

### Copying an assignment into another cohort

`assignments.duplicate` takes a `targetCourseId` — course creation copies a whole term through it — and **Copy to…** is the picker that makes carrying an assignment from last term's cohort into this one reachable from the menu.

- **The module is the part that needs a person.** A module belongs to one course, so a copy across courses cannot reuse the source's. Guessing means matching by name, which is exactly right when two cohorts of one program share a module sequence and a refusal on every assignment when they have diverged. The dialog defaults to the name match where one exists and says which of the two happened. `targetModuleId` is checked against the target course rather than merely looked up, since `moduleId` is a foreign key to modules rather than to modules *of this course*.
- **The copy keeps its repository name across cohorts and is renamed beside itself.** `@@unique([courseId, assignmentRepoName])` is per course and the generated repositories still differ, because [the cohort's short name prefixes every one](#the-cohort-is-in-every-repository-name). Only a copy sitting beside its original collides, and that name is derived in the procedure: `-copy`, then `-copy-2`, up to ten. A name built from the assignment's human title is not a legal repository name the moment a title contains a space.
- **An archived cohort takes no copies**, the same rule as a student joining one or an instructor being added to one. Archived cohorts are in the course list, so one is a thing somebody can be looking at when they reach for a copy.
- **Drafts are shown and marked** rather than hidden, because a module full to the instructor and empty to the cohort otherwise reads as simply empty. "The page a student meets" is the shape and the ordering, not a rule about visibility; `modules.listForCourse` admits students, and the publish filter it applies is what stops that read handing a cohort the assignments their instructor is still writing.
- **Within a module, assignments are ordered by due date, earliest first, and cannot be reordered by hand.** A due date is a fact an instructor already maintains and a student already reads, so an explicit position beside it would be a second ordering to keep in step. Work with no due date sorts **last**, with `nulls: 'last'` stated rather than left to the database's default, because no due date is outside the ordering rather than earlier or later than every date. Title is the tie-break for work due the same day. Modules keep the only manual ordering in a course.
- **`EmptyState` takes its icon as an element, `icon={<Inbox />}`, not as a component.** A lucide icon is a `forwardRef` object rather than a plain function, and `EmptyState` is a client component, so passing the component itself from a server one fails at render with "Functions cannot be passed directly to Client Components" — and only when the empty state actually shows. The prop is typed `ReactNode`, which turns the old spelling into a compile error.
- **Anything the instructor's course screens render comes from a server component**, fetched once and passed down, so a mutation there needs `router.refresh()` and not only `queryClient.invalidateQueries()`. Both calls are made: `invalidateQueries` for the parts that genuinely are client queries, the Modules screen among them, and `refresh()` for the server-rendered rest.
- **`lib/status.ts` is the single source of presentation truth** — status vocabulary, tone classes, flag copy, relative dates, module ordering. `formatRelative(date, now)` takes the reference instant as an argument rather than reading the clock, and dates render in a fixed school timezone.
- **On a score or a status pill, green means one thing: the work met the completion threshold.** Grading being finished, feedback being released, and work being complete are three different facts, and one colour cannot say all of them, so `GRADED` and `APPROVED` are both `info` and the score beside them carries the verdict in green or red. Green survives on the `TEST_EVIDENCE` flag and `HIGH` confidence, which are questions about the *evidence* rather than about the student, are instructor-only, and sit among other flag badges.
- **`completionMeta` in `lib/status.ts` is the one place that decides it**, returning the label and the class together, and null when nothing is graded so no caller renders "Incomplete" for work nobody has looked at. The grading queue, the review pane, and the student's own row all read it. The gradebook is deliberately not on it: its green means a score at or above 90 percent rather than a pass.
- **Colour is never the only signal.** The student's score carries an icon for shape and the verdict as screen-reader text, because red against green is the pair a colourblind student is least likely to tell apart.
- **The student vocabulary is narrower than the instructor's.** `SUBMITTED`, `DRAFT_READY`, `NEEDS_MANUAL_REVIEW`, and `GRADING_FAILED` all read as "Submitted" to a student, who has no use for the state of a grading run.
- The screens came from a Vercel V0 pass once the data shapes were settled.

---

## Security

What protects student data, where each control lives, and the settings that live outside this repository. The one control that is a setup step rather than a design decision — disabling Supabase's Email provider — is in the README, under [running it](README.md#running-it), because it has to be performed before students arrive.

### Where each control lives

| Control                              | Enforced by                                      | Read the reasoning in       |
| ------------------------------------ | ------------------------------------------------ | --------------------------- |
| Who may sign in                      | Supabase (GitHub provider only)                  | `components/login-form.tsx` |
| Who may join a cohort                | Per-cohort roster, checked in `enrollments.join` | `lib/courses/roster.ts`     |
| Who may read a course                | `assertCourseMember` / `assertActiveStudent`     | `lib/courses/membership.ts` |
| Who may act in a course              | Procedure builders, not call-site checks         | `trpc/init.ts`              |
| Which cohort an instructor may touch | `courseProcedure`, `lib/courses/scope.ts`        | `trpc/init.ts`              |
| What client-side JavaScript may read | Table privileges — nothing                       | migration `20260814024306`  |
| What happened, and who did it        | Append-only `audit_events`                       | `lib/audit/record.ts`       |
| Spending on models and sandboxes     | Counts out of the audit log                      | `lib/audit/rate-limit.ts`   |

**Prisma connects as the table owner and is not restricted by row level security.** Every guard above is procedure code, which means a procedure written without a guard has no second line of defence. Build on the procedure builders in `trpc/init.ts` rather than checking roles inline.

### Two-factor authentication

- **There is none in this application, by design.** Sign-in is GitHub, so two-factor is GitHub's to enforce — a GitHub organization can require it of every member in one setting.
- If Marcy staff are in a GitHub organization, turn that setting on there. Students are not in the organization, so their own GitHub two-factor is their choice.

### Getting back in if everybody is locked out of GitHub

- Re-enable the Email provider in the Supabase dashboard and send a recovery link to an admin's address. The route that consumes it, `app/auth/confirm/route.ts`, is kept for exactly this. Turn the provider back off afterwards.
- This is why there is no break-glass password form: a form would be a permanently open door for an event that has never happened, and the dashboard is reachable whenever the Supabase account is.

### Settings to check in the Supabase dashboard

These are not in version control and none are visible from the code.

- **Email provider: off.** The important one, and a step in [running it](README.md#running-it), because until it is done anyone on the internet can still create an account.
- **Redirect URLs** (Authentication → URL Configuration): only the deployment's own origins. Both auth routes refuse non-relative `next` values, but a loose allowlist here is a separate door.
- **Rate limits** (Authentication → Rate Limits): tighten sign-in and token refresh. Supabase enforces these; the application cannot.
- **Session length**: shorter is better for an application that shows grades on shared laptops.
- **Service role key**: rotate it. It has been in a development environment since the project started, and it bypasses row level security and every policy. Prefer the newer `sb_secret_…` format, which can be issued more than once and revoked individually.

### Settings to add at the platform edge

Rate limiting inside the application covers what costs money. Two surfaces it cannot reach are better handled by Vercel WAF rules, which need no code and no dependency:

- `/auth/*` — modest per-address limit. Supabase's own limits cover the authentication endpoints; this covers the pages.
- `/join/*` and the invitation routes — tokens are 122 bits of randomness, so brute force is not a real threat. The rule exists so enumeration attempts cost something.

### What the audit log records

Role changes; invitations created, revoked, and redeemed; roster entries added and removed; enrollments joined, removed, and restored; join-token rotation; test students created and deleted; entry into a test-student view; grades released; the two operations that spend money; and attendance — a session started, updated, reopened, ended or deleted, a code rotated, a fellow checked in, a status set by hand, and a wrong code tried. Why the table has no foreign keys, and how append-only is enforced, are in [the data model](#data-model).

- **The actor is always the real signed-in person.** While an admin views as a test student, `createTRPCContext` substitutes the test student's id onto `ctx.user`, so `auditActor` reads `ctx.viewingAs` first and `acted_as_id` records that the act happened inside a preview.
- **There is no exit event for a test-student view.** The view is held by a session cookie with no lifetime, so closing the browser leaves it without any request being made, and an event absent more often than present would invite conclusions from its absence.
- **Pruning means dropping the append-only triggers deliberately.**

### What is not covered

- **No second factor on the application itself**, by design. It rests on GitHub.
- **No alerting.** The audit log is written and can be read; nothing watches it.
- **A Salesforce integration will need its own section here** when it exists: the integration user's permission set, which fields it may write, and the record of each write. `GRADE_APPROVED` events are the intended basis for that record.

---

## What is verified, and how

Every claim below was checked against real repositories in the `marcy-lms-test` organization, not asserted from reading the code. The re-runnable parts are `npm test` and the `verify:` scripts in [Scripts](README.md#scripts); what remains outstanding is in [ROADMAP.md](ROADMAP.md).

The counts quoted are what each script reported when its section was written. **`scripts/verify/BASELINE.md` is the number to compare a run against**, not these — a script grows and the prose does not.

**Provisioning and the webhook.**

- `accept` creates a repository from the template with the student and instructors as collaborators; run a second time it reuses the repository rather than failing.
- **The `classroom.yml` removal is not among the verified claims.** No repository in `marcy-lms-test` has one, or any workflow, so `removeClassroomWorkflow` reports `absent` every time and has never removed anything. It is written for templates that came from GitHub Classroom, which matters more in Phase 2, since an instructor can name any public template and many public templates carry autograding. What *is* verified is that it can tell "there is no such file" from "the copy has not landed".
- A real pull request from `draft` into `main` fires the webhook, the signature verifies, and the submission becomes `SUBMITTED` with `isLate` computed. An invalid signature is rejected with a 401.

**The sandbox**, on `swe-1-4-loops-benspector3` and `swe-1-3-node-modules-benspector3`.

- A passing submission scores 13 of 13; the template's stub code scores 1 of 13 with every failure name and message stored.
- **Editing a test to hide broken code does not work.** `loop5to10` was broken and its assertion edited from 6 calls to 5. The run reports `Expected number of calls: 6` — the template's assertion — so the result is 12 of 13 and `tests/from-scratch.spec.js` appears in `tamperedPaths`.
- A test file the student adds never executes: `tests/cheat.spec.js` with two free-passing tests was reported as `added` and the total stayed at 13.
- **An instructor's template fix is never reported as a student's edit.** Correcting the assertion after the student had accepted moved `templateCommitSha`, changed the result from 12 of 13 to 13 of 13, and left `tamperedPaths` empty.
- Renaming a suite out of `tests/` neither hides it nor escapes notice — reported against the protected source path, and every test still ran.
- A routine mod-1 commit, which stages a rewritten `scores/scores.json`, reports nothing.
- A broken `testCommand` is `ERRORED` with null counts, not a zero. An assignment with no tests throws rather than recording a failure.
- **Nothing from `process.env` reaches the sandbox**, checked by name for both GitHub key sets, the E2B key, the Supabase service role key, both database URLs, the Groq key, and a canary variable set immediately before creation.
- The network works before revocation and not after. An endless command is killed with exit code 124 and reported `TIMED_OUT`. No sandbox is left running, confirmed through `Sandbox.list`.
- A second assignment grades correctly with no per-assignment configuration, nested npm package and all.

**Grading.**

- The suites under `tests/lib/grade/` are 101 assertions with no model call, including that every path a real submission is made of survives the prompt filter while a committed `.env`, dependency tree, or build directory does not.
- **The filter was run over all 10,507 files in the curriculum repository**, which matters more than any hand-written case: every path it withheld was genuinely a build artifact, a dependency tree, a committed `.env`, or editor litter, and no directory named `build` or `out` anywhere in the curriculum holds authored work.
- On real submissions: `swe-1-4-loops` with every test passing scores 30/30 at high confidence; a submission that broke its code and edited the assertion scored 12/13 against the template's assertion; full credit claimed alongside a failing test is caught; claiming a failed test passed is caught in both the bare and `Suite › name` forms; a submission passing every test with hardcoded return values is **not** flagged merely for scoring below full credit.

**Calibration.** `npm run calibrate` grades a sample and compares it against the report an instructor wrote about the same work. The toolkit holds five short response pairs; pair 1 is the exemplar embedded in the prompt and **pairs 2, 3, 4, and 5 are held out**.

**Each pair needs a different kind of wrongness to be detectable.** Pair 2's instructor score of 12/15 sits above the 0.75 completion threshold, so only a model biased downwards can fail it. Pair 3 sits at 11/15, just below the line, and catches a model biased upwards — which is the failure that matters, because a wrongly-incomplete grade is disputed by the student and corrected while a wrongly-complete grade is appealed by nobody. **Pair 4 is the one that tests the rubric rather than the prompt:** pairs 2 and 3 share their four questions with the exemplar and differ from it in a single cell, and the model has been observed anchoring to the exemplar's scores and saying so in its instructor notes — the sample report teaches scores as well as shape. Pair 4 is five different questions on SQL, marked 13/18 and also below the threshold. **Pair 5 is the one that tests the writing band.** It shares pair 4's assignment, questions, and key deliberately: holding the questions constant makes writing quality the variable rather than topic difficulty. It is marked 17/18 — technically near-perfect, comfortably above the threshold, and carrying two mechanical slips in two different answers, which makes it the only sample where the writing band decides the score on its own.

**Calibration grades with the answer key, because production does.** The key carries a per-question list of concepts to look for, naming the terminology and points each answer has to reach; the hand-written reports these samples are compared against were marked against it, and withholding it asked the model to infer a standard that was written down. The key belongs to the pair rather than to the script — `CALIBRATION_PAIRS` in `scripts/calibrate.ts` maps each pair to its own directory, because the pairs come from different assignments and a pair with no entry is refused rather than graded keyless. For the checkpoint pairs that directory is the short response solution specifically rather than the assignment's whole answer key folder, which also holds the frontend solution: five JavaScript and CSS files a short response prompt cannot use and is billed for on every run.

Below is five runs of all five pairs per tier at `high` effort, against the defect-count technical bands and the two-axis writing band. Fifty reports in eleven minutes of wall clock at five-way parallelism, at $0.078 a report on Sonnet and $0.099 on Opus, so the fifty came to $4.42 across both tiers.

**Calibration prices itself, because nothing else can price it.** `npm run calibrate` prints what each pair cost and what the run cost, on both the billed and cache-hit bases, using the rates in `lib/grade/pricing.ts` that `npm run cost` uses. The harness writes no draft, so there is no `model_metadata.usage` row for `npm run cost` to read afterwards and the number is unrecoverable once the process exits. Rates live in one module and are duplicated nowhere, which is not tidiness: a stale table priced Sonnet at $3/$15 for weeks after it moved to $2/$10, and every figure derived from it was wrong by half without looking wrong.

| Pair, and instructor score  | `claude-sonnet-5`      | `claude-opus-5`        |
| --------------------------- | ---------------------- | ---------------------- |
| 1 (exemplar), 12/15         | 12, 12, 12, 12, 12     | 12, 12, 12, 12, 12     |
| 2 (held out), 12/15         | 12, 12, 12, 12, 12     | **11, 11, 11, 11, 11** |
| 3 (held out), 11/15         | 11, 11, 12, 11, 11     | **12, 12, 12, 12, 12** |
| 4 (held out), 13/18         | 13, 12, 13, 13, 12     | 12, 13, 12, 12, 13     |
| 5 (held out), 17/18         | 15, 16, 15, 15, 16     | 15, 16, 16, 15, 16     |
| Completion decision agrees  | **19 of 20 held-out**  | **10 of 20 held-out**  |
| Writing band exact          | **25 of 25**           | 20 of 25               |
| Technical band exact        | **17 of 25**           | 12 of 25               |

- **`claude-sonnet-5` reached the instructor's completion decision on 19 of 20 held-out runs.** The single miss is pair 3 scored 12/15 rather than 11/15 on one run of five, which crosses the threshold by a third of a point. Every other cell is either exact or a point low without changing the decision.
- **The two-axis writing band is reproduced exactly, 25 times out of 25 on Sonnet.** This is the strongest agreement any band has reached. The reasoning is reproduced too, not only the number: on pair 5 the model names the axis, cites both instances and the fact that they fall in different answers, and states that the clarity axis is clean — which is the distinction the band was rewritten to make. Pair 4 scores 3/3 and pairs 1 and 3 score 1/3, all five times each.
- **`claude-opus-5` inverts the instructor's ranking, and this is the fourth rubric generation in which it has done so.** The instructor places pair 2 above pair 3; Opus scores pair 2 at 11 and pair 3 at 12 on all five runs of each. The consequence is decisive at the threshold: it marks pair 2 incomplete on every run where the instructor marked it complete, and pair 3 complete on every run where the instructor marked it incomplete. A constant bias can be corrected and a threshold can be moved, but a model that ranks two submissions the wrong way round cannot be tuned into agreement.
- **Opus's pair 2 error is still the writing band, and the two-axis rubric now says exactly where it goes wrong.** It scores 1/3 against the instructor's 2/3 on all five runs, and it gets there by finding a clarity defect. The band requires a quotable sentence and it quotes two — but one is described as reading "as two thoughts fused into one", which is the fused-sentence case the band names as feedback and never a deduction. Opus reads a flow problem as a meaning problem. Sonnet, given the same sentences, keeps the clarity axis clean.
- **Opus is more consistent and less accurate, and that trade is the wrong way round here.** Its cells are near-deterministic where Sonnet's move by a point. But consistency records where a model sits, not whether it sits in the right place: Sonnet's misses are scattered single runs out of five, while Opus's are blocks of five, and a scattered miss is noise a second run corrects where a block of five is a bias no number of runs will. For a grade that has to land on the correct side of a threshold, centred beats repeatable.
- **Both tiers deduct on pair 5 for two items the instructor credited, and the disagreement is in the answer key rather than the rubric.** Question 1 loses a point for explaining that an array's contents disappear when the program stops without naming that the array lives *in memory*; Question 2 loses one for defining a primary key as a required identifying column without using the word *unique*. Both are items the key lists and the student demonstrated without naming, and the technical band's fourth defect — a required item absent — is being applied exactly as written. Sonnet reproduces the Question 2 deduction on 5 of 5 runs and Question 1 on 3 of 5; Opus, 5 of 5 and 2 of 5. **Fixing the key would put every Sonnet run on pair 5 at the instructor's 17/18 exactly**, which would raise exact-total agreement from 17 of 25 to 22 of 25. The open question is which look-for items require the term and which may be demonstrated instead, and it is a question about the keys.
- **Three rubric findings produced Sonnet's agreement, and each was found by disagreement rather than by reasoning.** A required item *absent* is a defect, which is what the instructor deducted for on pair 3's Question 1 — a correct explanation of block scope that never names it. The key's list of concepts is **a floor rather than a ceiling**, because supplying the key alone made pair 2 worse: the model treated a satisfied checklist as sufficient and stopped scoring, while pair 2's Question 2 covers every required item and then adds a false claim, that a private field returns a copy. And **one checkable claim per bullet**: a bundled item reading "naming that the variable has block scope *and* is referenced outside of the block" lets a half-satisfying answer round up, because half an item is not an absent item.
- **A defect list that only ever errs one way is not being applied.** Pair 4 produced the first disagreement in the strict direction, and it was a real defect in the answer key: a "Bonus" item listed among the concepts to look for, which the model counted as required. Bonus items are now absent from the keys rather than described in the rubric, which is the more robust place to fix it.
- **A raised flag did not cost a point, and `FLAG_WITHOUT_DEDUCTION` names the flagrant form of it.** The check fires when a flag is raised and the matching band is at *full* marks, which is the case it can decide mechanically. It would not have fired on the pair 3 case that prompted it, where one question had already lost a point and the check cannot tell whether that deduction was the flagged one. Catching that needs flags attributed to a rubric item rather than to the section, which is a schema change and not yet made.
- **One run in roughly ten returns a report scored out of the wrong denominator** — 0/3 on a 15-point section, internally consistent, in range, and saying nothing false about any test. Every other arithmetic rule checks the report against itself, so none of them could see it. `SCORE_POSSIBLE_MISMATCH` now compares `scorePossible` against the section's `pointValue`, which `Facts` carries as a required field so a caller cannot omit the number that makes the score mean anything. It matters more than it looks: approval copies `scorePossible` into `finalScorePossible`, so an invented denominator reached the gradebook rather than an error message.
- **A single calibration run is not a measurement.** The same submission, prompt, and model has produced 11/15, 12/15, and 13/15 on different runs, and output token counts vary more than twofold between identical ones. **The number to quote is a range, not a figure.**
- Calibration has also found three errors in the reference material rather than in the pipeline — two in the reference reports and one in an answer key — all since corrected. Coding sections are not calibrated: scoring them is closer to objective, and no graded samples exist.

**Modules.** `verify:modules` runs the tRPC callers inside a rolled-back transaction.

- A new module goes at the end, a name is trimmed, a blank one is refused, a duplicate in one course is refused, renaming changes the name and not the position, reordering rewrites every position as a dense sequence from zero, and a partial order or one listing a module twice is refused.
- An empty module can be removed; **a module holding assignments cannot be — by the procedure with a count, and by the foreign key underneath it.**
- A student can read the list but call none of the writes, and an instructor who does not teach the course cannot either.
- An empty module still reaches the student's course page, because that page renders a section per module rather than per module that happens to hold work.
- The list carries each module's assignments, so three more things hold: they come back in **due-date order with the undated one last**, against a module whose rows were created out of order and whose undated assignment sorts first alphabetically, so neither insertion order nor the title could produce the answer; an unpublished assignment is returned to an instructor and **not to a student**; and `_count` deliberately disagrees with the length of that list, because removal is refused on drafts too and a count of only what the caller can see would offer a Remove button the procedure then refuses.
- **Provoking a database constraint aborts the whole Postgres transaction**, so every check that trips a unique index or a foreign key needs a transaction of its own.

**The calendar feed.** The format is checked under `npm test`, in `tests/lib/calendar/` — 35 assertions across the two pure modules, split so a fault in one cannot hide a fault in the other. The rounding cases are named individually: an 11:59 PM deadline becomes an 11:30 PM to 12:00 AM block, a deadline already on a half hour is left alone, a minute past one rounds up, the block is always exactly thirty minutes, and both sides of both daylight-saving changes land on the Brooklyn clock's half hour rather than only on UTC's. The format half asserts CRLF throughout, the four text escapes with the backslash handled first, folding at 75 octets rather than characters, and that no line-break-sensitive value survives a fold-and-unfold round trip with a character broken — checked with two-byte, three-byte, and four-byte characters, because slicing a string by index is what cuts one in half. One case asserts what the builder cannot say: handed an event carrying a score, a status, and released feedback, none of it reaches the output, because the module is never given a submission to read from.

`verify:calendar` covers what a fixture cannot. It needs the application running, and it writes twice and puts both back.

- **The feed holds one event per dated assignment `assignments.listMine` returns, and the same ones.** That single check is why `distributedToStudent` is a shared function rather than a clause written twice — it is what would fail if the two ever came apart.
- **The exclusion of unpublished work is checked on a row the script creates for it**, unpublished with a deadline in the student's own cohort, then published. A negative check alone cannot tell "the rule works" from "that row was never going to appear"; the same row appearing the moment `distributedAt` is set is what closes that. It is deleted afterwards, in a `finally`.
- The route answers 200 with no cookie at all, as `text/calendar`, `no-store`, and `inline`; a malformed token, a well-formed token belonging to nobody, and an upper-case rendering of a real token are all 404; an unauthenticated caller cannot mint an address; and replacing one makes the old address 404 in the same breath as the new one answering.
- **It rotates a real person's token and restores it**, including a null, in a `finally`. Generating an address is the only way to reach the route, and doing it to a student who had already subscribed would silently break their subscription. A test student is preferred as the fixture for the same reason.
- **What no script can check is whether Google accepts the feed**, because that needs a publicly reachable address. That is a manual step and stays one, and it has been done: a real Google Calendar subscribed to the deployment, showed the feed's own name, drew the deadlines, and — the part the manual step exists for — **moved an event when its due date changed rather than adding a second one.** That is the stable `UID` working end to end, and it is the one property of this feature whose failure would be silent, cumulative, and unfixable by the student holding the duplicates.
- **Three faults were found this way and none of them were reachable from a local address**, which is the argument for the step rather than an aside. Google refuses an `https` address in the `cid` of its add-by-URL link and accepts `webcal`; a `Content-Disposition` header sent the first subscriber down the download-and-import path, which appears to work and never updates; and a feed on `localhost` fails by being silently unreachable from Google's servers, so the application logs nothing and the symptom — no events, and the URL shown as the calendar's name — reads as a fault in the feed.

**The student's dashboard.** `verify:dashboard` exists for the three checks that cannot be asked of a fixture: that one student's submissions do not reach another's dashboard, that no other student's submission is attached to the caller's rows, and that one student cannot mark another's feedback read. Prisma is not restricted by row level security, so each is a `where` clause and nothing else, and a missing one is invisible in the interface. The partitioning and the bar are pure functions checked under `npm test`.

- **It earned its place on the first run.** Its check that the bar's green segment and the count above it are the same number caught `progressStateOf` reading a submission's status before `isComplete`, which meant a student who passed an assignment and then asked for another look lost the completion — "5 of 9 complete" became 4 of 9. Every unit case passed while that was wrong, because none combined `RESUBMITTED` with `isComplete: true`; the development database had four of them.

**Resources.**

- The half that matters most is a pure function: **a video URL this application does not recognise must be refused rather than framed.** `parseVideoUrl` is checked against every shape the two providers use — watch links, share links, shorts, the mobile host, Vimeo's channel and unlisted forms — and against twelve that must come back null: a host merely *containing* `youtube.com`, a subdomain trick, a lookalike host, a `javascript:` URL, a `data:` URL, another video service, a channel rather than a video, an id of the wrong length, and a traversal in place of one. Every one is a string a substring match would accept.
- The embed and watch addresses are checked to be rebuilt from the stored id rather than echoed from the paste.
- The rest drives the procedures in a rolled-back transaction: resources come back alphabetically rather than in insertion order (created as Zebra, Apple, Mango), a student sees exactly the same rows an instructor does, changing a resource's kind clears the columns the old kind used, a module from another course is refused, neither a student nor an instructor who does not teach the course can write anything, and a resource is deleted with its module where an assignment would have refused the deletion.
- **Writing it changed the code once.** The spec's branches were not `.strict()`, so Zod silently stripped a stray key and a caller sending a link's fields under a note's kind would have seen it saved as something else with no error. `resourceColumns` nulls the column regardless, so nothing unclean could reach the database; strictness makes the caller's mistake visible.

**Groups.** Most of `verify:groups` is not about the group table. What has to hold is that **filtering to one group narrows grading triage, an assignment's queue, the gradebook, and the assignments list to the same set of people.**

- The strongest checks compare a filtered read against an unfiltered one: the group's pile plus everybody else's is exactly the whole pile, the gradebook narrows its cells and not only its rows, no per-assignment count exceeds the cohort's, and an out-of-group submission stays openable by link.
- Around them: a group from another course matches nothing rather than everything, Ungrouped agrees with the picker's own figure, a removed student keeps their membership and stays out of the pile until restored, choosing a group is remembered and deleting it returns the instructor to all students, and a student can call none of it while an instructor who does not teach the course cannot either.
- **It found a defect.** `setMembers` replaced a group's membership inside its own `$transaction`, which is invisible in the running application and fails for any caller already in one — the same constraint `modules.reorder` works around with a single statement. Writing the difference instead of the whole set fixes it and has the better failure mode: delete-then-insert leaves an emptied group if the insert fails.

**Handing in a file, and handing in a link.**

- The pure half of `verify:uploads`: the extension decides and the last dot wins, so `resume.pdf.exe` is refused; a file at exactly the limit is accepted and one byte over is not; a path is built from the submission id and never from the student's filename; and a filename keeps its spaces while losing its slashes, quotes, and control characters.
- The live half stores a real object, fetches it back through a signed URL and compares the bytes, and then checks the two things the design rests on — **the unsigned public URL for that object does not work, and a forged token does not either.**
- Through the tRPC callers in a rolled-back transaction: an unpublished assignment cannot be handed in to, `submitWork` refuses this kind, a `.png` is refused where PDFs were asked for, uploading is what sets `SUBMITTED` and computes `isLate`, the submission lands in `needs_manual_grade`, and the student who uploaded it and the instructor who teaches the course can both fetch it while another student is refused.
- It also authors an `EXTERNAL_URL` assignment and checks the two link-submitted kinds land on the right side of every rule: it cannot be accepted, it cannot be handed in as a file, submitting the link enters the queue, and it waits on a person.
- Objects written inside the transaction are removed afterwards, because a rollback undoes the rows and not the bytes.
- The embedded preview is checked too — an inline link serves the object as its own content type, with no attachment disposition and no frame-blocking header, and a download link still asks the browser to save it.

**A hand-graded assignment, end to end.** `verify:approve` authors a `GOOGLE_DRIVE` assignment through `create`, publishes it, accepts it as the student and gets the `/copy` link back with no repository created, submits a document link, finds the submission in the queue as `needs_manual_grade`, opens a blank draft, presses the button again and gets the same draft, is refused approval while the section is blank, writes a score and feedback, releases it, and confirms the released submission is in **no** bucket — not in triage, the queue, or the gradebook — with delivery reported as `not_applicable` and no error, and that the student sees the grade. All through the tRPC callers inside a rolled-back transaction.

- That last part required `approveDraft` to accept the caller's Prisma client: it read the module's own, so rows created inside a caller's transaction were invisible to it and the most consequential write in the application could only be tested up to the guards that refuse before writing.

**Getting into a cohort, co-teaching it, owning it, and moving between cohorts.** `verify:enrollment` covers all of it through the callers inside a rolled-back transaction.

- **Roster**: a student is refused before anybody expected them, with the screen saying so before the button rather than the mutation saying so after; added by their instructor; admitted; the entry claimed; and the claimed entry then refused deletion. Pasting the same list twice adds nobody and says so.
- **The hardest one to see**: a student's entry is deleted out from under them while they are enrolled, and nothing about their answer changes — **an enrollment that already exists outranks the list**, and every student who joined before the list existed has no entry.
- **Co-teaching** takes one account through the whole rule: refused while it is a student, with the refusal naming an instructor invitation and no `CourseInstructor` row written; promoted inside the transaction; then eligible, admitted, and able to call a teach-gated procedure on the cohort. Redeeming twice adds nothing. An archived cohort and a cohort they are enrolled in as a student both refuse them. Replacing the link stops the old one and leaves existing instructors untouched. Removing one of two is allowed and takes their access with it; removing the last is refused, with the count asserted to be one first.
- **The ownership group is written in pairs**, because a one-sided check passes against a guard that refuses everybody: the owner is allowed and the co-teacher refused at the same call, for archiving, reopening, removing the owner, and handing the cohort on. It **demotes the cohort's owner to `INSTRUCTOR` for the duration** and restores the role afterwards, because the seeded course's creator is the deployment's admin and `assertOwnsCourse` lets an admin through. It reaches the state a deleted owner's account would leave behind by **clearing `is_primary` off a course directly**, then backdates one row, since Postgres resolves `now()` to the transaction's start time and both rows would otherwise share a `createdAt` to the microsecond. And it **reads the partial unique index out of `pg_indexes`** rather than writing a second primary row, since provoking the constraint would abort the transaction every other check runs inside.
- **The deletion group is mostly refusals**, and every one also asserts the cohort is still there afterwards. A live cohort refuses both the delete and the impact read; a co-teacher refuses both on an archived one; the wrong confirmation string refuses and leaves the course untouched. The successful delete asserts the cascade one foreign key at a time.
- **The switcher's arithmetic is checked as a pure function** against all eight sidebar views plus the five addresses that cannot travel between cohorts, because a view missing from `sameViewInCourse` does not throw — it falls through to settings. Attendance is the one view with a segment beneath it that travels to the *view* rather than to settings: one day does not exist in the other cohort, but its attendance screen does.

**Approval and resubmission.** Approving recorded 30/30, set `isComplete`, wrote `gradedHeadSha`, and posted a comment; approving the same draft twice is refused rather than posting again. A student calling instructor procedures is refused with `FORBIDDEN`, and cross-course access is refused for an instructor who does not teach the course. A real commit pushed after grading left the status at `GRADED` and moved `headSha` while `gradedHeadSha` stayed put. The student's declaration set `RESUBMITTED`, and a second approval posted a distinct second comment.

**Test students.** `verify:test-student` takes `--live` and `--github` flags that each add a further group of checks.

- **`enroll` and `remove` refusing a profile that is not a test student** is the entire difference between the feature and a mutation that puts anybody in any course and deletes anybody's account with every grade they were given. Checked against a real student, against the admin's own account, and for each of the five procedures against an instructor who is **not** also an admin — written as `role: { in: ["INSTRUCTOR", "ADMIN"] }` it selects the admin on a deployment whose only instructor is one, and three checks pass by asserting that the person who is allowed is allowed.
- **The switch is checked from both ends at once** — the same cookie value permitted for an admin and refused for a student — because a substitution that works says nothing about the check that permits it.
- A marked profile drops out of the course card's count in the same read that leaves it in the roster. Accepting is refused with no admin behind it and refused again when that admin has no linked GitHub, while a real student's own missing-GitHub refusal is asserted beside them.
- `--live` creates a real account and deletes it, and **claims an account abandoned by a create that failed halfway** — a case whose residue is an address registered so its number can never be used, and a profile reading as an ordinary student.
- `--live --github` generates a real repository, then asserts it is private, that the admin can push to it, that the test student's own handle was never sent to GitHub, and that deleting the test student takes the repository with it.
- **The last check of every run is that the run left no test student behind**, so cleanup that does not finish reports its own litter rather than leaving it to be found by hand.

**Destructive and authorization paths are checked inside rolled-back transactions against live data** — `throw new Error('ROLLBACK')` and catch — so a guard can be proven against real rows without harming any.
