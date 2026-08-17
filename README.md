# mls-lms

A replacement for GitHub Classroom, with AI grading reports built in, for The Marcy Lab School's nine-month fullstack program.

GitHub Classroom is being discontinued. Grading one assignment today touches four systems by hand: clone the repository, run the tests and work through the manual grading toolkit, post feedback as a pull request comment, re-enter the grade in Google Classroom, and re-enter the grade and its metadata in Salesforce. The same grade and feedback is typed three times — a transcription-error risk and a drain on instructor time that should be going into actually reviewing student work.

This application provisions the repositories and automates the grading workflow that already exists in `grading/swe-assignment-grading-guides/grading-toolkit/`. One instructor action — approving a report — records the grade, posts the feedback to the pull request, and shows it to the student.

The loop it replaces: a student accepts an assignment and a repository is generated for them, they work on `draft` and open a pull request into `main`, the instructor's own tests run against their code in a sandbox, and a language model drafts a grading report the instructor reviews before anybody sees it. That loop and every decision underneath it is in [ARCHITECTURE.md](ARCHITECTURE.md).

**Where everything else is:**

- **[FEATURES.md](FEATURES.md)** — what the application does, for admins, instructors, and students. Written for people using it rather than building it.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — why it is built this way, what protects student data, and what has been verified against real repositories.
- **[ROADMAP.md](ROADMAP.md)** — what is left to build.
- **[USER-TESTING.md](USER-TESTING.md)** — tasks for a moderated session with an instructor.

---

## Running it

**Stack:** Next.js 16 App Router on Vercel, Supabase PostgreSQL, Prisma 7 with `@prisma/adapter-pg`, tRPC v11, Tailwind v4 with Base UI, Supabase Auth with GitHub OAuth, GitHub App with Octokit, E2B for sandboxed test execution, and Claude `claude-sonnet-5` behind a provider interface.

You need a Supabase project, a GitHub App, an E2B key, an Anthropic key, and read access to the grading guides repository.

```sh
npm i                  # also runs prisma generate
npm run db:deploy      # apply migrations
npm run dev            # localhost:3000
```

**Now sign in with GitHub, once as each of the two accounts the seed expects** — `SEED_INSTRUCTOR_EMAIL` and `SEED_STUDENT_EMAIL`, which default to the two addresses named in `prisma/seed.ts`. Enable the GitHub provider in Supabase first, as described below, or there is nothing to sign in with. Nothing after this point works until both of those sign-ins have happened.

```sh
npm run db:seed                          # bootstraps an EMPTY database — see below
npm run grant:admin -- you@example.com   # the first admin; every later one comes from /admin
npm run dev:webhook                      # in a second terminal — forwards smee.io to /api/webhooks/github
```

**`db:seed` creates; it does not modify.** It is for an empty database, and re-running it against one with real work in it leaves every existing row alone. That way a corrected spec does not reach a row that already exists — edit it in the application, or delete the row and seed again. The one exception is rubrics, which no router can author, so this script is their only author.

Neither script creates accounts, which is why the sign-ins come first. Identity belongs to Supabase Auth, so both the seed and `grant:admin` look up profiles that a real login created and fail with an explanation if one is absent. The seed needs both of them — the instructor it makes primary on the course and the student it enrolls — and `grant:admin` needs the one address you pass it. The student's account also has to have GitHub linked, because accepting an assignment names the repository after their GitHub login; signing in through GitHub is what links it.

**In the Supabase dashboard, enable the GitHub provider and disable the Email one** (Authentication → Sign In / Providers). Both matter, and the second one is the step to do before students arrive: the publishable key is public, so email signup and password sign-in stay reachable against the Supabase API whatever this application's screens offer, and **until that provider is off anyone on the internet can still create an account**. See [signing in](ARCHITECTURE.md#signing-in) for why sign-in is GitHub alone, and [settings to check in the Supabase dashboard](ARCHITECTURE.md#settings-to-check-in-the-supabase-dashboard) for the rest of what lives there rather than here.

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

`SUPABASE_SERVICE_ROLE_KEY` does double duty: server-side admin operations, and the private bucket uploaded submissions live in. Nothing else can reach that bucket — see [handing in a file](ARCHITECTURE.md#handing-in-a-file).

**`GRADING_ASSETS_REPO` is required everywhere**, development included — there is no local-clone mode. It names the program's prompt code, not the answer keys: an assignment names the repository *its own* reference solutions live in, in a column. See [two asset sources](ARCHITECTURE.md#two-asset-sources).

**The installation is resolved from the repository's owner**, so `GRADING_ASSETS_INSTALLATION_ID` is rarely needed. A GitHub App is installed per organization with its own id and its own token, and an assignment may name an answer-key repository in an organization the environment variables say nothing about — so the App asks itself which of its installations covers a given owner, and caches the answer including the negative one. Set the variable only to override that for the assets repository.

### Two GitHub Apps, one per environment

A GitHub App has exactly one webhook URL, and GitHub cannot reach localhost. So there are two Apps — `marcy-lms-dev` pointing at a smee.io channel, and the production App pointing at the deployed domain — and switching environments means switching four environment variables, not editing App settings. Mirror the permissions and the `pull_request` subscription across both, and give them different webhook secrets. `npm run verify:app` checks all of it, including that the private key actually parses.

**smee.io answers GitHub with 200 whether or not anything is listening.** A push that arrives while `dev:webhook` is not running is recorded as a successful delivery and dropped. Redeliver it from the App's Advanced page rather than pushing again.

---

## Scripts

**`npm test` first.** The pure logic runs under Jest — the section registry, the status vocabulary, the assignment spec, the video URL parser, the upload file-type map, the sandbox's path matching and parsers, and every cross-check rule — and it needs no database, no network, and no credentials, so it runs in well under a second and reports per case. That is the net a change is checked against before anything slower.

Everything below it is a script, because everything below it needs something real: the development database, a repository, a sandbox, or a model call. They are re-runnable and are the fastest way to find out whether a change broke a *flow*. Two things about writing one: `tsx` compiles to CommonJS, which rejects top-level `await`, so the body goes in a `main()` or a `.then()`; and anything importing a module marked `server-only` needs `--conditions=react-server` in its npm script. Ten of them drive the real procedures against the development database inside a transaction that is rolled back. `scripts/verify/harness.ts` holds the `check`, `refusal`, and transaction helpers they share; `scripts/verify/BASELINE.md` records what each one reported before the [review pass](ARCHITECTURE.md#one-way-to-ask-each-question), which is what a run is compared against — a script that quietly stops checking something exits zero too.

| Script                        | What it does                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                    | Every unit test. `npm test -- tests/lib/grade` runs one directory; `-t "a pattern"` runs one case                                                                                                |
| `npm run typecheck`           | `tsc --noEmit`, which is the whole of it — `next build` typechecks too, and does far more                                                                                                        |
| `npm run verify:approve`      | The approval guards, the delivery outcomes, the triage buckets, and a hand-graded assignment end to end, all through tRPC callers                                                                |
| `npm run verify:authoring`    | The rules that decide what a valid assignment is, then the authoring procedures through tRPC callers in a rolled-back transaction                                                                |
| `npm run verify:modules`      | Creating, renaming, reordering, and removing a course's modules, through the callers                                                                                                             |
| `npm run verify:groups`       | Student groups, and that filtering to one narrows all four screens to the same set of students                                                                                                   |
| `npm run verify:resources`    | Readings, notes, and videos — including every URL shape the video embed refuses                                                                                                                  |
| `npm run verify:enrollment`   | Creating a cohort, copying one, the roster and both links, co-teaching, and the removed-student pair — through the callers                                                                       |
| `npm run verify:attendance`   | Starting a session, the session code and replacing one that got out, corrections, the backstop, ending and reopening — plus the two rules that live in Postgres rather than in a procedure        |
| `npm run verify:staff`        | Instructor invitations, admin promotion, and the grants that stop a role being set from client JavaScript                                                                                        |
| `npm run verify:uploads`      | The upload path end to end, including the private bucket and signed URLs                                                                                                                         |
| `npm run verify:assets`       | That a deployed host can read its rubric — forces the local clone off and reads over the API                                                                                                     |
| `npm run verify:app`          | The GitHub App this environment is configured with: key, permissions, events, installation, and where its webhook points                                                                         |
| `npm run verify:e2b`          | Creates one real sandbox and checks the properties only a real sandbox shows                                                                                                                     |
| `npm run verify:resubmission` | The resubmission and re-approval loop end to end; `--post` also posts a real comment                                                                                                             |
| `npm run verify:test-student` | Test students: who may make one, the switch in both directions, and the counts. `--live` also creates and deletes a real account; `--live --github` also generates and deletes a real repository |
| `npm run verify:dashboard`    | A student's dashboard and progress bar against live rows, and that neither reaches another student's work                                                                                        |
| `npm run tests:run`           | Runs one real submission's tests from the terminal, where a sandbox failure is diagnosable                                                                                                       |
| `npm run grade`               | Generates one real report from the terminal                                                                                                                                                      |
| `npm run calibrate`           | Grades a sample submission and compares the result against the report an instructor wrote about it                                                                                               |
| `npm run approve`             | Approves a draft from the terminal                                                                                                                                                               |
| `npm run accept`              | Runs the accept flow from the terminal                                                                                                                                                           |
| `npm run setup:storage`       | Creates the private uploads bucket, or brings its size limit and type allow-list back into step with the code                                                                                    |
| `npm run db:diff`             | Generates a migration — see [Data model](ARCHITECTURE.md#data-model), and never `migrate dev`                                                                                                    |

`scripts/list-installations.ts` is the odd one out: not an npm script, and run with `tsx` when a new organization's installation id is needed.

**`setup:storage` is a deploy step, not a setup step.** It builds the bucket's allow-list from `UPLOAD_FILE_TYPES`, so adding a file type means re-running it against every environment — and forgetting leaves the upload route accepting a file the bucket then refuses, which appears only on a real upload and only where nobody re-ran it. See [handing in a file](ARCHITECTURE.md#handing-in-a-file).

---

## Deploying

Vercel, with the environment variables above. Three things to know:

- **`GRADING_ASSETS_REPO` must be set**, and the App must be installed on the organization holding the guides *and* on every organization an assignment names as its answer keys. `GRADING_ASSETS_PATH` must not be set anywhere — it now raises `GradingAssetsError` rather than being ignored. Variables are bound when a deployment is created, so changing one requires a redeploy to take effect.
- **The webhook URL belongs to the App, not to the deployment.** Changing it on the App takes effect immediately with no redeploy, because the deployed handler reads nothing about where the delivery came from.
- **The GitHub App must be installed on the organization holding the grading guides**, not only on the one holding student repositories. `npm run verify:assets` is the check that a deployed host can read its rubric at all.
