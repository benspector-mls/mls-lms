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

You need two Supabase projects — one for development and one for the deployment, described in [two Supabase projects](#two-supabase-projects-one-per-environment) — a GitHub App, an E2B key, an Anthropic key, and read access to the grading guides repository. The steps below set up whichever project `.env.local` names.

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

### Two Supabase projects, one per environment

Development and the deployment have separate Supabase projects, and `.env.local` names the development one. Nothing run on a laptop can reach the rows holding real grades, and a new migration meets real data in development before it meets a fellow's.

Five variables differ between them: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, and `DIRECT_URL`. **Take both connection strings from the project's own Connect dialog rather than editing the other project's** — the pooler hostname carries a region and a numeric prefix assigned per project, so swapping a reference into the wrong host fails with `FATAL: (ENOTFOUND) tenant/user postgres.<ref> not found`.

**Each project needs its own GitHub OAuth application**, for the same reason there are two GitHub Apps: an OAuth application has one authorization callback URL, and the callback belongs to the Supabase project rather than to the machine — `https://<project-ref>.supabase.co/auth/v1/callback`. Localhost is configured on the Supabase side instead, as the development project's Site URL and in its Redirect URLs. Disable the Email provider on both, as described above.

**The deployment's database is reached by naming it, never by editing `.env.local`.** `.env.deployment.local` holds the four values a terminal command needs — `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — and `db:status:deployment`, `db:deploy:deployment`, and `setup:storage:deployment` run the ordinary script with those values in place. `scripts/with-deployment-env.ts` is what puts them there, and it refuses to run rather than let a missing value fall through to the development one. The filename is deliberately not `.env.production.local`, which Next.js loads automatically whenever `NODE_ENV` is production, ahead of `.env.local`.

**Both Apps are installed on the same organization**, so a pull request there is delivered to each of them. A delivery reaching `dev:webhook` for a repository that only the deployment's database knows about matches nothing and is logged as an unknown repository. That is the separation working, not a fault.

### Two GitHub Apps, one per environment

A GitHub App has exactly one webhook URL, and GitHub cannot reach localhost. So there are two Apps — `marcy-lms-dev` pointing at a smee.io channel, and the production App pointing at the deployed domain — and switching environments means switching four environment variables, not editing App settings. Mirror the permissions and the `pull_request` subscription across both, and give them different webhook secrets. `npm run verify:app` checks all of it, including that the private key actually parses.

**smee.io answers GitHub with 200 whether or not anything is listening.** A push that arrives while `dev:webhook` is not running is recorded as a successful delivery and dropped. Redeliver it from the App's Advanced page rather than pushing again.

---

## Scripts

**`npm test` first.** The pure logic runs under Jest — the section registry, the status vocabulary, the assignment spec, the video URL parser, the upload file-type map, the sandbox's path matching and parsers, and every cross-check rule — and it needs no database, no network, and no credentials, so it runs in well under a second and reports per case. That is the net a change is checked against before anything slower.

**`npm run test:integration` second.** The same runner, against a real Postgres. These drive the real procedures through tRPC callers as real people, inside a transaction that is rolled back, so they check the things a unit test cannot reach: that a procedure refuses the caller it should, and that a `where` clause is actually there. Prisma connects as the table owner and is not restricted by row level security, so that clause is the only thing standing between one student and another's work.

**Each suite makes the rows it needs and reads nothing it did not write.** That is what makes them reproducible on any machine, and it is a correction rather than a nicety: the scripts they replace looked for a seeded course of the right shape and stood down when they could not find one, which is how `verify:attendance` and `verify:team-sets` came to measure nothing at all, and how `verify:dashboard` came to skip the three cross-fellow checks its own header calls the point of the file.

They run against a **disposable local database** built from the migrations, which needs a Postgres server on this machine and one command:

```sh
npm run db:test:reset        # drops and rebuilds it, then applies every migration
npm run test:integration     # about two seconds
```

`db:test:reset` refuses any host but this machine and any database whose name does not end in `_test`, because it drops what it is given. There is no seed: `prisma/seed.ts` looks up profiles that a real GitHub sign-in created, and there is no signing in to a local Postgres — so the suites build their own accounts through `auth.users` and the on-signup trigger, which is the path a real account arrives by. `prisma.config.ts` already carries the stub of Supabase's `auth` schema that makes this possible, and the setup script reads it from there rather than keeping a second copy.

`npm run test:integration:supabase` runs the identical suites against the development Supabase project instead. Worth doing before a release, because it is the only way to see these procedures meet the same database the deployment uses; not the thing to run on every change, because it takes about a hundred seconds rather than two and at that length the pooler intermittently times out a whole file.

`tests/integration/fixtures.ts` holds the builders — `makeWorld` is a program with a course, a unit, an instructor and as many fellows as a group asks for. `tests/integration/transaction.ts` holds `withRollback`, which opens a transaction for a `describe` and discards it afterwards, and `required`, which **fails** a group whose fixture is missing rather than skipping it, because a group that measured nothing must not report a pass.

Everything below those is a script, because everything below them needs something real that a rolled-back transaction cannot stand in for: a repository, a sandbox, a model call, a live third-party response, or an environment's own configuration. They are re-runnable and are the fastest way to find out whether a change broke a *flow*. Two things about writing one: `tsx` compiles to CommonJS, which rejects top-level `await`, so the body goes in a `main()` or a `.then()`; and anything importing a module marked `server-only` needs `--conditions=react-server` in its npm script. `scripts/verify/harness.ts` holds the `check`, `refusal`, and transaction helpers they share; `scripts/verify/BASELINE.md` records what each one reported before the [review pass](ARCHITECTURE.md#one-way-to-ask-each-question), which is what a run is compared against — a script that quietly stops checking something exits zero too. That hand-kept comparison is what a test framework does by itself, which is why every script that moved above has a row in that file saying where its number went rather than a number to keep.

| Script                        | What it does                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                    | Every unit test. `npm test -- tests/lib/grade` runs one directory; `-t "a pattern"` runs one case                                                                                                |
| `npm run test:integration`    | The procedures against the local test database, in rolled-back transactions. `-- modules` runs one suite; `-t "a pattern"` runs one case                                                         |
| `npm run test:integration:supabase` | The same suites against the development Supabase project                                                                                                                                  |
| `npm run db:test:reset`       | Drops and rebuilds the local test database from the migrations. Refuses any host but this machine and any name not ending `_test`                                                                |
| `npm run typecheck`           | `tsc --noEmit`, which is the whole of it — `next build` typechecks too, and does far more                                                                                                        |
| `npm run verify:authoring`    | The six questions only GitHub can answer about an assignment draft: an unreachable template, one that is not a template, a missing answer key repository, and an organization the App is not installed on |
| `npm run verify:uploads`      | The private bucket itself: that it is private, enforces its own size limit and allow-list, and a real object stored and removed again                                                            |
| `npm run verify:assets`       | That a deployed host can read its rubric — forces the local clone off and reads over the API                                                                                                     |
| `npm run verify:app`          | The GitHub App this environment is configured with: key, permissions, events, installation, and where its webhook points                                                                         |
| `npm run verify:e2b`          | Creates one real sandbox and checks the properties only a real sandbox shows                                                                                                                     |
| `npm run verify:resubmission` | The resubmission and re-approval loop end to end; `--post` also posts a real comment                                                                                                             |
| `npm run verify:test-student` | The half of test students that makes something real: `--live` creates and deletes an account, `--live --github` also generates and deletes a repository, and the last check is that the run left nothing behind |
| `npm run verify:calendar`     | The calendar feed over real HTTP: its headers, that it shows exactly what the dashboard shows, and that it refuses a token nobody holds. Needs the application running; `--base=<url>` points it elsewhere |
| `npm run tests:run`           | Runs one real submission's tests from the terminal, where a sandbox failure is diagnosable                                                                                                       |
| `npm run grade`               | Generates one real report from the terminal                                                                                                                                                      |
| `npm run calibrate`           | Grades a sample submission and compares the result against the report an instructor wrote about it                                                                                               |
| `npm run approve`             | Approves a draft from the terminal                                                                                                                                                               |
| `npm run accept`              | Runs the accept flow from the terminal                                                                                                                                                           |
| `npm run rename:org`          | Points the database at a GitHub organization's new name after it has been renamed on GitHub — the webhook matches `repo_full_name` exactly, so nothing else recovers those rows. Reports by default; `--write` makes the change    |
| `npm run setup:storage`       | Creates the private uploads bucket, or brings its size limit and type allow-list back into step with the code                                                                                    |
| `npm run db:diff`             | Generates a migration — see [Data model](ARCHITECTURE.md#data-model), and never `migrate dev`                                                                                                    |
| `npm run db:status:deployment` | `db:status` against the deployment's Supabase project instead of the development one                                                                                                            |
| `npm run db:deploy:deployment` | `db:deploy` against the deployment — the second half of applying a migration, and the only thing that applies one there                                                                          |
| `npm run setup:storage:deployment` | `setup:storage` against the deployment's bucket                                                                                                                                              |

`scripts/list-installations.ts` is the odd one out: not an npm script, and run with `tsx` when a new organization's installation id is needed.

**The three `:deployment` scripts are the same scripts, pointed elsewhere.** Each runs its ordinary counterpart with `.env.deployment.local` in place, through `scripts/with-deployment-env.ts` — so there is one definition of what `db:deploy` does and one of where it runs, rather than two of each. The wrapper prints the project reference before it runs anything and refuses outright if the file is missing a value, since dotenv would otherwise let that value fall through to the development one and report success against the wrong database.

**`setup:storage` is a deploy step, not a setup step, and so is `db:deploy`.** `setup:storage` builds the bucket's allow-list from `UPLOAD_FILE_TYPES`, so adding a file type means re-running it against every environment — and forgetting leaves the upload route accepting a file the bucket then refuses, which appears only on a real upload and only where nobody re-ran it. See [handing in a file](ARCHITECTURE.md#handing-in-a-file). Migrations work the same way now that there are two databases: applying one in development is half the job.

---

## Deploying

Vercel, with the environment variables above — the deployment's Supabase values, not the ones in `.env.local`. Four things to know:

- **`GRADING_ASSETS_REPO` must be set**, and the App must be installed on the organization holding the guides *and* on every organization an assignment names as its answer keys. `GRADING_ASSETS_PATH` must not be set anywhere — it now raises `GradingAssetsError` rather than being ignored. Variables are bound when a deployment is created, so changing one requires a redeploy to take effect.
- **The webhook URL belongs to the App, not to the deployment.** Changing it on the App takes effect immediately with no redeploy, because the deployed handler reads nothing about where the delivery came from.
- **The GitHub App must be installed on the organization holding the grading guides**, not only on the one holding student repositories. `npm run verify:assets` is the check that a deployed host can read its rubric at all.
- **The schema is not deployed with the code.** Vercel builds the application; nothing there applies a migration. A migration reaches the deployment only when somebody runs it, which is the price of the two databases being separate and is why the command says which one it means:

```sh
npm run db:status:deployment    # what the deployment is missing
npm run db:deploy:deployment    # apply it there
```


### Shipping a change without disrupting anybody

**During a deploy the old code and the new code are both live**, and every rule below comes from one question: can each survive what the other left behind? A browser tab loaded a minute ago is running the previous bundle and will go on running it until somebody reloads, so "the old code" means real requests and not a theoretical case.

That gives one principle, applied at whichever layer is changing: **add the new thing while the old thing still works, move everything over, and only then remove the old thing.**

| What is changing | What to do |
| --- | --- |
| Code only, purely additive | Push. Nothing old breaks. |
| Code that removes or renames something a browser calls — a route, a procedure, an input shape | Stale bundles still call the old name. Keep it for one release, or deploy when nobody is using it. |
| An additive migration — a nullable column, a new table, a new enum value | `npm run db:deploy:deployment` **first**, then push. Old code ignores a column it does not select. |
| A destructive migration — dropping, renaming, or adding `NOT NULL` | Never in one release. Add the new column, deploy code writing both, backfill, deploy code reading the new one, drop the old one later. A rename is an add, a backfill and a drop wearing one word. |
| A new accepted file type | `npm run setup:storage:deployment` **before** the code deploy, or `beginUpload` accepts a file the bucket then refuses. |
| An environment variable | Set it in Vercel, then redeploy. Variables are bound when a deployment is created. |
| The GitHub App's webhook URL or installation | Takes effect immediately. No redeploy. |

**Rollback is instant for code and impossible for a migration.** Vercel can promote the previous deployment back in seconds; `prisma migrate deploy` has no undo, and rolling the code back leaves the schema where it was. So every migration must be survivable by the release before it — follow the destructive-migration steps above and it always is, which is what keeps rollback a real option. Shipping a migration the previous code cannot tolerate is giving that up, and is worth knowing you are doing.

**Timing is the cheapest lever there is.** This is a school: the cost of a bad deploy is concentrated in the hours around a due date and during class. The same commit carries very different risk at 7am on a Saturday and at 10pm the night before something is due.

### Previews

Pushing a branch other than `main` creates a preview deployment at its own URL, which is where a risky change should be tried before it reaches a cohort. Two things make that safe rather than dangerous, and both are configuration rather than code:

- **Preview variables point at the development Supabase project**, so a preview cannot touch real grades. In Vercel, under Settings → Environment Variables, every variable is scoped to Production, Preview, or Development separately: give Preview the values from `.env.local`. Getting this wrong is worse than having no preview at all, because a preview that writes to the deployment's database looks exactly like one that does not.
- **The preview's own URL is on the development project's redirect allowlist**, or nobody can sign in to it. `github-auth-button.tsx` builds the callback from `window.location.origin`, so on a preview that is `https://<project>-git-<branch>-<slug>.vercel.app/auth/callback`. Supabase accepts wildcards, so one entry of `https://*-<slug>.vercel.app/**` under Authentication → URL Configuration → Redirect URLs covers every preview this project will ever create.

A preview receives no GitHub webhooks — the App delivers to one URL, which is the deployment's — so a pull request opened against a student repository will not appear there. Everything that does not depend on a delivery behaves as it does in production.
