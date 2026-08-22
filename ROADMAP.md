# mls-lms roadmap

How the built system works is in [ARCHITECTURE.md](ARCHITECTURE.md); what it does, role by role, is in [FEATURES.md](FEATURES.md). This file is only what is left to do.

It is grouped by the kind of work an item is: measurement, the instructor's grading hour, the student's side of the application, authoring assignments, the grading pipeline, running a cohort, and Salesforce. Each group ends with a **Deferred** list — items in that area that are deliberately not scheduled, several of which the database schema already leaves room for. [The order of work](#the-order-of-work) reads the same items in the order they should be built, which cuts across the groups.

- [The order of work](#the-order-of-work)
- [Measurement, and the state of what is built](#measurement-and-the-state-of-what-is-built)
  - [Outstanding verification](#outstanding-verification)
  - [Token management](#token-management)
  - [What the review pass left open](#what-the-review-pass-left-open)
  - [Scaling: what a hundred students costs, and where it breaks](#scaling-what-a-hundred-students-costs-and-where-it-breaks)
- [The instructor's grading hour](#the-instructors-grading-hour)
  - [Reading the changed files without leaving the review](#reading-the-changed-files-without-leaving-the-review)
  - [Working a pile by what it is, not only by what it needs](#working-a-pile-by-what-it-is-not-only-by-what-it-needs)
  - [An evaluation of one student's growth across a term](#an-evaluation-of-one-students-growth-across-a-term)
  - [Deferred: the grading hour](#deferred-the-grading-hour)
- [What a student sees and does](#what-a-student-sees-and-does)
  - [Notes a student keeps on their own work](#notes-a-student-keeps-on-their-own-work)
  - [Subscribing a calendar to due dates](#subscribing-a-calendar-to-due-dates)
  - [A chat scoped to a student's own course context](#a-chat-scoped-to-a-students-own-course-context)
  - [Deferred: what a student sees](#deferred-what-a-student-sees)
- [Authoring assignments and handing them out](#authoring-assignments-and-handing-them-out)
  - [Targeted assignments, and excusing a student](#targeted-assignments-and-excusing-a-student)
  - [AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments)
    - [Instructor-authored rubrics are a prerequisite, not a companion](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion)
  - [Deferred: authoring and handing out](#deferred-authoring-and-handing-out)
- [The grading pipeline](#the-grading-pipeline)
  - [Triggering and orchestration](#triggering-and-orchestration)
    - [The grading session is built; automatic grading is the part still open](#the-grading-session-is-built-automatic-grading-is-the-part-still-open)
    - [If it does become automatic](#if-it-does-become-automatic)
    - [The problem this must solve](#the-problem-this-must-solve)
    - [Candidate design A: job table with a worker process](#candidate-design-a-job-table-with-a-worker-process)
    - [Candidate design B: Vercel Workflow](#candidate-design-b-vercel-workflow)
    - [E2B does not remove the need to choose](#e2b-does-not-remove-the-need-to-choose)
    - [Comparison](#comparison)
    - [What to know about Workflow before choosing Design B](#what-to-know-about-workflow-before-choosing-design-b)
  - [Where rubrics, answer keys, and sample reports live](#where-rubrics-answer-keys-and-sample-reports-live)
  - [Deferred: the grading pipeline](#deferred-the-grading-pipeline)
- [Running a cohort: enrollment and attendance](#running-a-cohort-enrollment-and-attendance)
  - [The GCF, and what is left of it](#the-gcf-and-what-is-left-of-it)
  - [Deferred: running a cohort](#deferred-running-a-cohort)
- [Salesforce synchronization](#salesforce-synchronization)
  - [What came back from Idlewild](#what-came-back-from-idlewild)
  - [Questions I need answered](#questions-i-need-answered)
  - [What may need to be built on the Salesforce end](#what-may-need-to-be-built-on-the-salesforce-end)
  - [The shape of the work here, once those are answered](#the-shape-of-the-work-here-once-those-are-answered)
  - [Deferred: Salesforce](#deferred-salesforce)
- [Settled decisions and standing limits](#settled-decisions-and-standing-limits)

---

## The order of work

**Nothing about running a cohort needs manual entry in the database any more.** A course can be created, copied from a previous one, filled from a join link, co-taught, split into groups, divided into teams, retired, found again afterwards, and finally deleted. Assignments of all four kinds can be authored, published, handed out — to each student or to a team — handed in by any member of one, graded by the pipeline or by hand, and released to everybody who did the work, and readings, notes, and videos sit under a module beside its work. Somebody can be made staff by an admin and added to a cohort by whoever runs it. The first admin of a deployment is still a hand-edited row, necessarily, because there is nobody to grant it — `npm run grant:admin` is that base case as a tool.

What is left divides into two kinds of thing: measurement, and features that add real surface area. The review of code that already works has happened — what it left open is [its own section](#what-the-review-pass-left-open) — which is why the features in the list below can be read as work rather than as work plus a cleanup nobody scheduled.

The sequence is most immediate first, and it cuts across the categories the rest of this file is grouped into. A feature's own section says what is known and what is still undecided about it; several are a heading and a paragraph because the thinking has not been done yet, and saying so is more useful than inventing detail. The ordering principle is: the cheap things, then measurement, then the features that add real surface area. Measurement first because a real cohort produces figures rather than estimates.

1. **[Token management](#token-management)** — what a report costs and where the cost actually is. The disclosure half is already built: [nothing a student commits that git was told to ignore reaches the model](ARCHITECTURE.md#what-a-student-commits-and-what-reaches-the-model). Better after a real cohort has run, which gives measurements rather than estimates.
2. **[Reading the changed files without leaving the review](#reading-the-changed-files-without-leaving-the-review)** — the diff beside the report instead of in another tab. High on this list because it is the only item that makes the hour an instructor already spends grading a shorter hour, and because the data is already fetched and discarded.
3. **[Notes a student keeps on their own work](#notes-a-student-keeps-on-their-own-work)** — the assignment panel's third tab, and a screen listing them. High for how little it is: one table, no new dependency, and it is the half of [the dashboard](ARCHITECTURE.md#what-is-due-across-every-cohort) that is about what a student took from the work rather than about what is left of it.
4. **[Working a pile by what it is, not only by what it needs](#working-a-pile-by-what-it-is-not-only-by-what-it-needs)** — grading every resubmission at a sitting. A second axis over triage rather than a new bucket, for a reason worth knowing before building it.
5. **[The GCF's remaining edges](#the-gcf-and-what-is-left-of-it)** — the feature is built and in use; what is left is a naming convention it depends on, a target that is a constant, and nothing yet reading a fellow's trend across a term. Here rather than higher because none of the three stops anybody using it, and the third wants a cohort's worth of practice before it can be judged.
6. **[Salesforce synchronization](#salesforce-synchronization)** — the consultants have answered the administrator half and named what needs a Salesforce developer instead, so what blocks this now is that developer and three decisions that are ours to make. Note that it manages assignment records as well as submission records, so it depends on assignment authoring rather than merely following it.
7. **[Targeted assignments, and excusing a student](#targeted-assignments-and-excusing-a-student)** — half of which is settled, since [a group](ARCHITECTURE.md#groups-and-grading-a-portion-of-a-cohort) is the way to name a subset of students.
8. **[AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments)** — which begins with [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), since none of the four fixed section types fits a resume or a reflection.
9. **[An evaluation of one student's growth across a term](#an-evaluation-of-one-students-growth-across-a-term)** — last of the grading-side features, and not because it is least wanted. It reads a term of released feedback, so it has nothing to read until a term has been graded, and it is the one feature here whose output is about a person rather than a piece of work.
10. **[A chat scoped to a student's own course context](#a-chat-scoped-to-a-students-own-course-context)** — last, and behind the item above it for a reason that is not sequencing: the two contradict each other on whether a synthesis across a term may reach a student unedited, and that has to be settled before either is built. It is also the one item here that needs a graded term before it can be *judged*, not merely before it can be run.

[Triggering and orchestration](#triggering-and-orchestration) is deliberately not in that list, and is now half done: an instructor can grade a screen's worth of outstanding work with one press, which was the part that affected a working day. What is left — grading without being asked, and a batch that survives a closed tab — is a convenience rather than a blocker. It stays written down because the decision will eventually be needed and the reasoning is already done.

[Scaling](#scaling-what-a-hundred-students-costs-and-where-it-breaks) is not on the list and is not meant to be. It is a set of questions to hold rather than work to schedule, and most of what would answer them is measurement that [token management](#token-management) produces anyway.

---

## Measurement, and the state of what is built

Figures a real cohort produces, and the parts of the working system a review deliberately left alone. None of it adds surface area, and all of it changes what the rest of this file should say.

### Outstanding verification

Everything in the README's [what is verified](ARCHITECTURE.md#what-is-verified-and-how) section has been checked against real repositories. These are the gaps in it.

1. **A Python assignment on `python-pytest`**, for results shaped identically to the Jest ones. No Python template exists in `assignment-templates/` yet.
2. **`allowStudentDependencies: true`** against an assignment that genuinely asks students to add a dependency to the repository's **root** `package.json`. No current assignment does — `swe-1-3-node-modules` looked like the candidate and turned out not to be, since its dependency lives in a nested package. Note that the default presets install with `--ignore-scripts`, so a dependency needing an install script to fetch a platform binary needs an override.

### Token management

Three concerns come down to what ends up in a prompt: what it costs, how much of the context window it consumes, and what it discloses. **The third is closed** — a filter withholds committed dependency trees, environment files, credentials, and build output, described in [what a student commits and what reaches the model](ARCHITECTURE.md#what-a-student-commits-and-what-reaches-the-model). What is left is measurement.

**Where the cost actually is, measured rather than assumed.** This is answered and recorded in [what a report costs](ARCHITECTURE.md#what-a-report-costs), and `npm run cost` re-derives it from the token counts every draft already stores, so it does not go stale. Output is 70 to 84 percent of the bill, because thinking is billed as output. What is not measured is the breakdown *within* input — the answer keys against the student's files against the rubric and agent rules — which is what would say whether [moving the answer keys into the cacheable prefix](#deferred-the-grading-pipeline) is worth more than the 6 percent currently estimated.

**Effort is the only lever that moves cost much, and it is now a real choice.** Grading at `medium` rather than `high` costs 35 percent less on an algorithm section and 42 percent less on a frontend one, against the 7 to 14 percent the earlier figures suggested. It is left at `high` because the saving is worth about $80 per cohort-year and a worse grade is not worth $80. That is a decision to revisit only if the volume changes by an order of magnitude.

**Model tier is settled, and it was never a cost question.** Across a curriculum of 78 assignments a cohort's grading costs roughly $205 a year on `claude-sonnet-5` against $302 on `claude-opus-5` — a hundred dollars, less than an hour of instructor time a month. Calibration decided it instead, and decided it against the more expensive tier: `claude-opus-5` agrees with an instructor's completion decision on 10 of 20 runs against Sonnet's 19 of 20, and it ranks two held-out submissions the wrong way round. Two constraints learned from Groq still apply to any future candidate: the model must guarantee schema-conformant structured output, and its context and rate limits have to fit a frontend prompt, which is the largest at roughly 8,700 tokens of uncached input. A model that cannot do both is not a cheaper option, it is a different failure.

**What calibration found is a rubric problem, not a model problem, and it is the next piece of work.** Both tiers award the technical criterion one point more than an instructor does, identically, on a submission where both correctly raise a terminology flag — so the flag is raised and no point is deducted for it. On a submission the instructor scored just below the completion threshold, every run of both models marked it complete, at high confidence and passing the cross-check, so nothing held it for review. **A wrongly-complete grade is appealed by nobody**, which makes this the most consequential open item in grading quality. Two candidate fixes, and they are not exclusive: tighten the technical bands so the distance between "answers all parts" and "answers most parts" is checkable rather than a matter of adjective, and add a cross-check finding for a report that raises a criterion's flag while awarding full marks on that criterion — the shape `FULL_CREDIT_DESPITE_FAILURES` already has for tests.

### What the review pass left open

The pass ran, and [what it produced is in the README](ARCHITECTURE.md#one-way-to-ask-each-question) — one authorization mechanism, named shapes at the boundaries, a shared registry for section types, and a Jest suite carrying the pure logic that used to live inside the check scripts. Three things it deliberately did not settle are below, plus one it settled by deciding not to act.

**`sections` as a JSON column, and whether `rubricId` should be a foreign key.** The pass narrowed this to a typed boundary — `readSections` in `lib/assignments/spec.ts` is the one place the column is narrowed, and the authoring schema validates every field on the way in — but it did not change the storage, because doing so is a migration and a real decision rather than a tidy.

What the column buys is that a section's shape can change without a migration, and it has: `grading`, `evidence`, and `testNamePattern` were each added to sections that already existed, and the backfill for `grading` was one `UPDATE`. Instructor-authored rubrics will do it again.

What it costs is exactly one thing, and it is worth being precise: **a `rubricId` inside the JSON is a string that nothing enforces points at a real `Rubric` row.** Deleting a rubric leaves every section that named it pointing at nothing, and the database will not say so. Today that is survivable because no interface deletes a rubric — `prisma/seed.ts` is their only author — so the dangling case is reachable only by hand. It stops being survivable the moment instructors can author and delete their own.

A real column would mean a `Section` table with `assignmentId`, `position`, and a `rubricId` foreign key, and the honest cost is not the migration. It is that a section's *variable* fields — the ones that differ by grading mode and by type — go back to being either nullable columns nobody can require, or a JSON column beside the foreign key, which is the current design with an extra join. The middle option is worth pricing before either: keep the column and add a `RESTRICT` on rubric deletion in application code, which closes the only failure this actually has. That is the decision to make, and it should be made when rubric authoring is designed rather than before.

**Prisma usage, beyond what the pass touched.** Consolidating authorization removed a second round trip at nine call sites and `trpc/selects.ts` gave the repeated selects one definition, but "selects that fetch more than a screen needs, and any place a list view issues a query per row" was not audited systematically. It is a measurement job — the log the development client already prints is most of the tooling — and it wants a cohort's worth of real rows to be worth doing.

**Whether Jest runs in CI on push.** Worth it for the unit half, which needs nothing and takes under a second. Pointless for the check scripts, which need credentials, a database, and the `marcy-lms` organization. The question is only whether a push should block on the fast half.

**`components/instructor/grading-review.tsx`** is split, in the change that put a pull request's diff beside the grade — see [reading the changed files](#built-reading-the-changed-files-without-leaving-the-review). `lib/status.ts` was checked and is deliberately left whole: it is large because it is the single source of presentation truth for a submission's status, drawn on the student's list, the instructor's triage, and the gradebook, and splitting it would create exactly the drift it exists to prevent. That one does not need revisiting.

Two lessons from writing the `verify:` scripts carried into the Jest suite, because both are silent failures rather than loud ones. **A script that selects its fixtures by a proxy for the property it needs will eventually select the wrong one** — "an instructor who is not the one this script acts as" is not "an instructor who does not teach this course", and the wrong one passes by luck rather than failing. And **a check that could not run must not report a pass**: a skip is reported and exits non-zero, because a run that checked nothing is not a run that succeeded.

### Scaling: what a hundred students costs, and where it breaks

**Questions to hold rather than work to schedule.** Nothing here is a known problem — the largest thing this has run against is one cohort — and most of what would answer it is measurement [token management](#token-management) produces anyway. It is written down because the answers change what [triggering and orchestration](#triggering-and-orchestration) should be, and that decision is already waiting.

**What is already measured**, from [what a report costs](ARCHITECTURE.md#what-a-report-costs) and the sandbox durations in `test_runs.duration_ms`: a report is $0.06 to $0.12 at `high` effort, output is 70 to 84 percent of it because thinking is billed as output, a sandbox run is 30 to 40 seconds, and a frontend section's model call alone has been measured at up to 166 seconds. So a hundred students on one frontend assignment is on the order of $10 and, if run one after another, about five hours of wall clock. Neither figure is alarming; both are worth knowing before a batch button exists.

**Concurrency is the question triggering and orchestration already frames.** Its requirement 4 — that a batch must not be bound by one function invocation's limit — is answered by fanning out one invocation per submission, though the margin is narrower than it looks: a frontend section's model call of 166 seconds plus a 30-to-40-second sandbox run is about three and a half minutes against a 300-second limit. What a hundred students changes is not that arithmetic but what happens when a hundred of those invocations run at once, which is where every vendor limit below actually bites.

**Anthropic.** Rate limits are per organization and counted in requests and tokens per minute, so the ceiling on a batch is not the money, it is how many reports can be in flight before requests start being refused. Two things follow: whatever runs the batch needs to handle a rate-limit response by waiting rather than by failing a submission, and [prompt caching's five-minute window](ARCHITECTURE.md#what-a-report-costs) means a burst is meaningfully cheaper than the same work spread across an evening — which argues for the grading-session model rather than against it. Worth separating from developer tooling: the grading spend is the Anthropic API, and Claude Code is a different line item that scales with how much is built rather than with how many students there are.

**E2B.** Concurrent sandbox count is the limit that matters, not total minutes, and a sandbox bills until its own timeout expires — which is why `sandbox.kill()` is in a `finally` block. A hundred concurrent runs is the first time a leak would be expensive rather than merely untidy. The other thing a hundred students changes is that 6 to 17 seconds of dependency installation per run stops being a detail: [building custom templates with dependencies already present](ARCHITECTURE.md#the-sandbox-run) is the largest speed improvement available and it gets more valuable linearly.

**Supabase.** The application connects through the pooled `DATABASE_URL` and migrations use `DIRECT_URL`, which is the arrangement that survives many concurrent functions — a serverless fan-out against a direct connection is how a connection pool gets exhausted. Two other limits to know: the storage bucket for uploaded submissions grows without bound, since a re-upload writes a new object and [the previous one is deliberately left in place](ARCHITECTURE.md#handing-in-a-file), and a hundred students' resumes at up to 25MB is a real number. Nothing prunes it today.

**Vercel.** The 300-second function limit is the one already reasoned about. Beyond it: a fan-out of a hundred invocations is a hundred invocations' worth of Active CPU billing, and the webhook path is unaffected because it does one database write.

**The one that is not a vendor limit.** A hundred students produce a hundred drafts an instructor has to read, and no amount of concurrency helps with that. Triage, [working a pile by what it is](#working-a-pile-by-what-it-is-not-only-by-what-it-needs), and [student groups](ARCHITECTURE.md#groups-and-grading-a-portion-of-a-cohort) are the parts of this application that actually address a cohort of a hundred, which is worth noticing given how cheap they are.

---

## The instructor's grading hour

What an instructor does while grading: what is on screen while a report is read, how a pile of outstanding work is ordered, and the one output here that is about a student rather than about a submission.

### Built: reading the changed files without leaving the review

The column beside the grade holds the diff of a pull request, file by file, syntax highlighted. `getPullRequestDiff` in [lib/github/prs.ts](lib/github/prs.ts) keeps the `patch` the `files` endpoint was already returning and `getPullRequestFileChanges` was already discarding, so the diff costs no request the grading pipeline was not making anyway. [lib/diff/patch.ts](lib/diff/patch.ts) parses it in the browser, and shiki colours it there too, one grammar loaded per language actually present.

Three things this left open when it was designed, and what was decided:

- **One scrolling column of every changed file, and no file tree.** A tree is navigation for a problem that does not exist at three files, and measurement bore that out: across every pull request in the development database a submission changed between one and five files. That figure is also what sets how many open on arrival.
- **`promptExclusionReason` is a label and a sort key, never a filter.** A committed lockfile sorts last, is named, and stays closed; a committed `.env` is highlighted as shell and reads in full, because the instructor is the person who tells the student to rotate the key. Nothing is withheld.
- **The pull request base is a real limit, and the card says so.** A change committed straight to the student's own default branch before they branched sits in the base and does not appear. Students are taught to undo that, which means it happens, so the panel's description states it rather than leaving a card called "changed files" quietly incomplete.

Whole-file contents at a commit is still not built, and is still the obvious next question of a pull request — which is why the router is named `pullRequests` rather than `diffs`. `fetchChangedFiles` in [lib/grade/generate-report.ts](lib/grade/generate-report.ts) is the mechanism, and one request per file remains the wrong default for a browser.

**`components/instructor/grading-review.tsx` is split.** It was 2,589 lines when the diff went in; `GradingReview` now holds the queries, the choice of what goes beside the grade, and the composition, and the rest is under [components/instructor/review/](components/instructor/review/) — `shared.tsx` for the two contexts and the shapes everything reads, then one file each for the header, the work panels, a round in its various states, the editor, one section, and the history. The split was done after the diff rather than before it, so where the seams fell was decided by what the file actually contained.

### Working a pile by what it is, not only by what it needs

"Grade all the resubmissions at one sitting" is a real way to work, and triage cannot express it — **for a reason worth knowing before building anything.** `triageBucket` is a vocabulary of *what action is outstanding*: no report yet, to grade by hand, draft ready, held for review, failed, never delivered. It is deliberately not a vocabulary of what a submission *is*. A resubmission with no report and a first submission with no report are both `needs_report`, because the action is identical, and that is what makes the buckets exhaustive and the counts trustworthy.

So this is a **second axis over the same pile**, not a seventh bucket. Adding `resubmission` to the enum would break the property every count on three screens rests on — that the buckets partition the outstanding work — because a submission would then belong to two.

What the axis is made of is already on the row: `submission.status` distinguishes `SUBMITTED` from `RESUBMITTED`, `isLate` is computed at submission, and "revised since grading" is `headSha !== gradedHeadSha` and needs no query. So the filter is presentation over data that exists, which is what makes this small.

Two things it needs beyond a filter control:

- **It has to work across assignments**, which is the whole point — triage is already cohort-wide, so this belongs there rather than on one assignment's queue, and the queue's own filter should probably learn the same axis for consistency.
- **A way to work the filtered set in order.** Grading twenty resubmissions means opening one, approving it, and wanting the next one without going back to a list. The review surface has no next-and-previous today, and a filter that hands somebody twenty items and no way to walk them is half the feature. This is the part [student groups](ARCHITECTURE.md#groups-and-grading-a-portion-of-a-cohort) does not supply: a group narrows the four screens that already exist and needs nothing new to move between submissions, where working one pile of twenty at a sitting does.

### An evaluation of one student's growth across a term

**Every report is about one submission, and nobody has read them together.** A student finishes a term with a dozen approved drafts, each one a careful account of a single piece of work at a single moment. The question an instructor actually has at the end — is this person getting better, at what, and what should they work on next — is answered by all of them at once and by none of them individually. That is a real gap and it is the thing the accumulated feedback is uniquely able to answer.

The material exists and is already assembled. `feedbackRounds` in [components/student/assignment-panel.tsx](components/student/assignment-panel.tsx) is the shape: every approved draft's sections, oldest first, one round per grading, with a fallback to `submission.feedbackMarkdown` for work graded by hand or graded before drafts existed. Read across a student's submissions rather than within one, that is the input.

**This is a different kind of AI feature from grading, and the difference is the whole risk.** A grading report is checked: [the cross-check](ARCHITECTURE.md#what-the-cross-check-may-and-may-not-assert) compares its arithmetic against itself and its claims against a real test run, and it is a *draft* an instructor approves before anybody sees it. A growth evaluation has no deterministic facts to be checked against. There is no test suite for "improving at asking for help", nothing to contradict a confident sentence about a person, and the subject is a person rather than a piece of work. So:

- **It is a draft an instructor edits, with no automatic path to a student.** Non-negotiable, and stronger than for grading — the approval step there prevents an unfair score, and here it prevents an unfair characterisation.
- **Who reads it is the first thing to decide, and it changes the feature.** Written for the instructor it is a preparation note before a one-to-one. Written for the student it is a report card, and every sentence has to survive being read by the person it describes. Those are not the same document and building the first while intending the second is how it goes wrong.
- **What it may cite is the second.** Scores are a fact and the reports are the instructor's own released words, so quoting them back is fair. Inferring effort, attitude, or circumstance from a pattern of late submissions is not, and the prompt has to forbid it explicitly rather than hope.

What this touches:

- **A new output schema, and the provider interface does not currently accommodate one.** `gradingReportSchema` is scores and rubric items against a point value, and none of it applies to a paragraph about a person. The catch is that [lib/grade/provider.ts](lib/grade/provider.ts) abstracts the *vendor*, not the output shape: `ReportResponse.output` is typed `GradingReport`, and the Claude implementation names `gradingReportSchema` directly. So this is not "a schema and a prompt" — it is making `ReportGenerator` generic over what it returns, and touching both providers. Worth knowing before it is scoped as small, and worth doing properly, since [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion) will want the same seam.
- **Cost, and it is a different shape.** A term of one student's feedback is a large input for a single call, and it is per student rather than per section — so a cohort of twenty-five is twenty-five long prompts with nothing shareable between them, since each one *is* a different student. Nothing here caches the way [an assignment's queue does](ARCHITECTURE.md#generating-every-pending-report-at-a-sitting).
- **Which course, and whether a student has more than one.** `submissions.listForStudent` already returns the other cohorts a student is in, because somebody repeating a module has two sets of work. A growth evaluation that silently covered one of them would be answering a narrower question than it appeared to.
- **It needs a term to have happened.** With three graded assignments there is no growth to describe, and a confident paragraph saying otherwise is worse than no feature. This is the item on this list most improved by waiting for real data, which is also what makes it a natural companion to [token management](#token-management).

### Deferred: the grading hour

- **Bulk grading** beyond the basic gradebook table, and a single action that generates reports for every submission still waiting on one.
- **Rendering a Jupyter notebook in the review screen.** `previewKindOf` answers `pdf` or `image` and everything else downloads. A notebook is the most-read of the uploaded types and the one where the download-and-open-elsewhere loop that [embedding a PDF exists to remove](ARCHITECTURE.md#handing-in-a-file) costs the most. Rendering one is a real dependency and its own decision, which is why a check records that not previewing it is deliberate.
- **A per-student record that accumulates over time and informs grading.** Requires deciding what is tracked and deserves its own design discussion.
- **A grading assistant mode** that identifies patterns across a student's assignments relative to a rubric. Depends on the previous item existing first.

---

## What a student sees and does

The student's side of the application, beyond the course page and the [cross-cohort dashboard](ARCHITECTURE.md#what-is-due-across-every-cohort) that exist today.

### Notes a student keeps on their own work

**The third tab of the assignment panel, which is why the panel has tabs before it has three of them.** A student reading feedback has nowhere in this application to write down what they took from it, so what happens is nothing, or it happens in a document this application will never see beside the work it is about. The whole value is proximity: the note sits with the assignment and the report rather than in a second system that has to be kept in sync with the first.

One note per student per assignment — `@@unique([studentId, assignmentId])` — attached to the assignment rather than to a submission or a grading round, so a resubmission does not orphan it and a second round of feedback finds the same note. Overwritten in place, with no version history.

**Markdown in a `<Textarea>` with a live preview, not a rich text editor.** That is settled, and for three reasons worth keeping written down. It adds no dependency, where an editor means ProseMirror plus a second rendering path with its own sanitiser beside [components/markdown.tsx](components/markdown.tsx), which deliberately enables no raw HTML. It stores what every other prose column in this database stores, so a note is readable by anything that reads feedback. And the rubric grades markdown usage — `MARKDOWN` is one of the writing flags — so a student writing notes in it is practising the thing they are marked on rather than being protected from it. [components/instructor/resource-dialog.tsx](components/instructor/resource-dialog.tsx) is the shape to copy.

Saved on blur rather than behind a button, with a confirmation that fades. A note nobody pressed Save on is the failure mode, and it is silent.

`/notes` is the second screen: every note the student has, grouped by course and then by module, each entry showing the first hundred characters and linking to `/courses/[courseId]?assignment=[id]`. **A navigation aid and not an authoring surface** — no creating a note from there, no folders, no search in the first version. The panel is where a note is written, because that is where the work is.

What to know before building it:

- **The new table gets its own privilege statements**, copied from an existing migration, even though [the project-wide default](ARCHITECTURE.md#request-path) already closes it on creation. A student's private notes are the worst table in this schema to leave readable from browser JavaScript, and the block travelling with the table is what a reader finds.
- **The note editor wants to appear before grading, not only after.** A student takes notes while working, and an assignment that is `ACCEPTED` or handed in has as much to write about as one that has come back. `NOT_STARTED` is the one state where the tab is not worth offering.
- **`/notes` is a cross-course read**, so it is the second procedure with no course in its input after `assignments.listMine`, and it wants that one's scoping rules: the notes themselves are the student's own, but which of them to *show* is a question about enrollments.

### A chat scoped to a student's own course context

Blocked, and not on a technical dependency: **the capability worth having is patterns across a term of feedback, and there is nothing to read until a term has been graded.** Building it against three assignments would be building it against the one case where it has nothing true to say.

What it may see: approved `feedbackMarkdown`, the READMEs of assignments the student has accepted, their own submission statuses, and the [five core competencies](reference-material/competencies.md). What it may not, enforced by what is passed rather than by asking the prompt nicely: rubric scoring bands, answer keys, any other student's anything, and any judgment of work that has not been handed in. That last one is the load the guardrail carries — a chat that will tell a student whether their code passes before they submit it is a grading service, and every incentive in the program points the wrong way from there.

The writing-support case is the one with a real design in it. A student pastes their own text; the model responds with observations and questions and never a rewrite. "This sentence is unclear — what do you mean by 'it works differently'?" is the behaviour, and "here is a clearer version" is the failure. One question at a time rather than a list of every issue, which is the difference between a tutor and an editor.

**This conflicts with [an evaluation of one student's growth across a term](#an-evaluation-of-one-students-growth-across-a-term), and the conflict has to be resolved before either is built.** That section states, as non-negotiable, that a synthesis across a term is a draft an instructor edits with no automatic path to a student — because there are no deterministic facts to check it against and the subject is a person rather than a piece of work. A chat that answers "what patterns are in my feedback" *is* that synthesis, reaching the student directly and unedited. Both cannot be built as written. Which one is right is a decision about the program rather than about this codebase, and the honest options are: the synthesis stays instructor-mediated and the chat declines the question; the chat answers it but only by quoting released feedback verbatim with links, inferring nothing; or the rule changes deliberately and is rewritten in both places.

Cheaper things worth noticing before the chat is the answer. "Explain what my instructor meant by this" is a per-report question with the report already on screen. "What should I do next" is what `/dashboard` answers today with no model at all. The chat earns its place on the questions neither of those can reach, and scoping it to those is what keeps it from being a worse version of a screen that already exists.

### Deferred: what a student sees

- **Nothing.** What used to be here was students seeing their groups, and it has been answered rather than built: a fellow sees [their own team](ARCHITECTURE.md#teams-and-work-handed-in-by-several-students) and who is on it, because a team hands work in together, and a grading group stays invisible because it exists only to split the marking. Those turned out to be two mechanisms rather than one decision to make per group.

---

## Authoring assignments and handing them out

What an instructor decides when an assignment is created: who it is for, what it is graded against, and how it comes back.

### Targeted assignments, and excusing a student

A new capability rather than a screen. Today an assignment implicitly applies to every active enrollment in its course — a submission row appears when a student accepts, and the gradebook treats a missing row as not started. Neither "this assignment is only for these students" nor "this student is excused from this one" can be expressed.

**Half of the data-model decision is made.** Naming a subset of students was the missing piece and [a group](ARCHITECTURE.md#groups-and-grading-a-portion-of-a-cohort) is it — a named set of students inside one cohort, carrying no instructor relation and no permission, which is exactly the shape targeting wants. So a targeted assignment is an assignment pointing at a group, with All Students — no group — the default it already behaves as.

What is still open is **excusing**, which is the other direction and needs its own row: a per-student exclusion against one assignment. The distinction matters for the gradebook, because an excused student must read as excused rather than as missing work, or it is worthless.

Three readers have to learn about both, and they are the same three a group filter already touches: the gradebook, which must draw a cell that is neither a grade nor a gap; triage and the per-assignment counts, which must not count work nobody was asked to do; and the student's own course page, which must not offer an Accept for something they were not given.

### AI grading for non-coding assignments

Short response is already graded and calibrated against an instructor's own marking, so this means the work that has no repository: a Google Doc, an uploaded PDF, a presentation. Creating, handing in, and hand-grading all of those is built, and an uploaded file has somewhere to be read *from*. What is not built is reading a Google Doc's contents or an uploaded file's, and generating a report from it — which needs Drive access, and which needs rubrics that describe the work.

The pipeline's inputs change shape here, which is the size of it: there is no pull request diff, no changed-file list, and no test evidence, so "the student's work" has to be fetched from Drive or from storage instead of read out of a diff.

#### Instructor-authored rubrics are a prerequisite, not a companion

Confirmed rather than assumed: this feature requires them. The taxonomy is fixed at the four sections that exist in `rubric.md`, and a resume, a reflection, or a presentation matches none of them — so there is no version of this feature that ships against the current four. It is the first thing built when this item comes up.

What that touches, so the size is not a surprise:

- **`Rubric` rows are real database rows already**, with a `RubricScaleType`, so storing an authored one is not the hard part.
- **`SECTION_TYPE_REGISTRY` in `lib/section-types.ts` is the hard part.** Each of the four section types maps to a heading in `rubric.md` and a sample report file, both read from the grading-guides repository. An instructor-authored rubric has neither, so the rubric text and the sample have to come from the database instead — which means the asset loader stops being "read the file at this path" and becomes "read the file, or read the row." The registry is where a type is added and is deliberately one entry per type, so the shape of the work is turning that entry from a literal into something that can also be a row.
- **The prompt is built from those assets**, so an authored rubric has to produce the same three things the file-backed ones do: a scale with a written description per band, a heading's worth of criteria, and an example of a good report. The third is the one instructors will not think to provide and the model most needs — worth deciding whether an authored rubric can borrow the closest existing sample rather than requiring a new one.
- **Whole numbers and the flags vocabulary** are properties of the rubric, not of the pipeline. An authored scale still has to be bands with descriptions, or the "no 1.5, put the hesitation in `instructorNotes`" rule has nothing to anchor to.

This is also what makes the section types no longer a closed set, which the classifier currently assumes — `classifySections` matches file paths against the types in the registry. An authored rubric attached to a Google Drive assignment has no file paths to classify, so the two land together: classification only runs for kinds where "which files did the student change" is a meaningful question.

### Deferred: authoring and handing out

- **A manifest in the assignment repository.** A file in each template — `assignment.json` rather than a block in `package.json`, since `package.json` is a protected path the sandbox merges under its own rules and Python and SQL assignments have none — declaring section types, point values, and answer keys. It would let the seed's one remaining assignment definition go, make the repository the author of what an assignment *is* rather than an instructor retyping it, and support a drift check when a cohort's copy no longer matches the curriculum. Deferred because the recurring cost it removes is already covered by `duplicate`, and because designing it after a real cohort has been set up beats designing it against a guess. Any version of it must read from the template and never a student's copy, and be read server-side rather than trusted from the browser.
- **A catalogue for `GOOGLE_DRIVE` assignments.** An instructor types the title and pastes the template link, so nothing forces internal organization and "what Drive assignments exist" has no single answer to check a new one against. The shape most likely to work, not yet designed in detail: a shared Drive folder per module that an instructor picks a document from rather than pasting an arbitrary link. That is one authentication story with [reading a student's document for grading](#ai-grading-for-non-coding-assignments), which is the argument for doing them together rather than now. `FILE_UPLOAD` likely needs no catalogue at all: an instructor is describing a submission format rather than selecting among curriculum content.

---

## The grading pipeline

What happens between a student's commit and a draft report: what starts a run, and where the rubrics, answer keys, and samples the prompt is built from are read from.

### Triggering and orchestration

Half of this is built and half is open, and the open half is smaller than it was. An instructor can now grade a screen's worth of outstanding work with one press; what nothing does yet is grade without being asked, or keep going once the tab is closed.

#### The grading session is built; automatic grading is the part still open

**Grading is not automatic, and the alternative to it now exists.** The original design had the webhook start a run on every `opened`, `reopened`, and `synchronize`, and that was reconsidered before being built, because each run costs real money and most would be wasted: a student who opens a pull request, closes it, opens another, and pushes six more commits generates a report per event, none of the intermediate ones read by anybody. At roughly $0.10 a report and a cohort of twenty-five, a week of ordinary student behavior is a meaningful bill for drafts nobody looks at.

So instead an instructor sits down, presses one button, and the application grades every submission whose current commit has no report — [generating every pending report at a sitting](ARCHITECTURE.md#generating-every-pending-report-at-a-sitting), on an assignment's queue and on a student's record. One report per submission per state of the code, generated when somebody is about to read it. Cost tracks the work an instructor does rather than the commits a student makes, and there is nothing to prune.

The five requirements that shaped it, and where each landed:

1. **The intent to grade is recorded durably before work begins.** Met by the `GENERATING` draft row, which already existed and is already a triage bucket.
2. **Work that fails partway through can be retried without repeating what succeeded.** Met: the batch covers `needs_report`, so a second press finds only what is still outstanding, and the failures are offered back as a retry of themselves.
3. **The same submission is never graded twice concurrently.** This was the one that was *not* met and had to be built — the draft was created unconditionally, so two instructors on one queue graded everything twice. Now claimed in a single `INSERT … WHERE NOT EXISTS`.
4. **A batch is not bound by one invocation's time limit.** Met by fanning out one invocation per submission: a frontend section's model call has been measured at up to 166 seconds and a sandbox run adds 30 to 40, so the worst measured case is about three and a half minutes against a 300-second limit.
5. **Progress is readable from PostgreSQL while the batch runs.** Met by the same `GENERATING` rows, which is why a second tab sees a batch in flight rather than offering to start it again.

**What is left is durability across a closed tab.** The fan-out is driven from the browser, so closing it stops what has not started — fine for a student's four assignments, a real limit for a whole cohort. That is the remaining argument for a job table, and it is a smaller one than it was: four of the five requirements are already satisfied by rows that exist, so what a durable design would add is the ability to walk away, not correctness.

#### If it does become automatic

The designs below were written for the automatic version and are kept because the durability question above is the same one.

The webhook starts a run on `opened`, `reopened`, and `synchronize`, and marks any existing draft `SUPERSEDED` on `synchronize`. Everything before this phase is callable as a plain function taking a submission id, so this phase adds a caller and changes nothing else.

This is where the asynchronous job design is chosen. It is deliberately not decided yet, because nothing built so far needs it: the webhook's work is one database update, and test execution and report generation keep a human waiting for the slow part on purpose.

#### The problem this must solve

GitHub waits roughly 10 seconds for a webhook to return a response. If the response takes longer, GitHub marks the delivery as failed and sends the event again, which would cause the same pull request to be graded repeatedly and receive duplicate comments. Grading takes minutes: fetching files, installing dependencies, running the suite, and calling a language model.

So the webhook must respond immediately and the work must happen afterward. Doing the work without recording the intent first is not acceptable, because if the process stops partway through, that submission is never graded and no record exists showing that it should have been.

Requirements:

1. The webhook responds to GitHub within a few seconds.
2. The intent to grade is recorded durably before any work begins, so it survives a restart or a deployment.
3. Work that fails partway through can be retried without repeating what already succeeded.
4. The same submission is never graded twice concurrently.
5. Total elapsed grading time may exceed the time limit of a single Vercel function invocation.
6. Grading status is readable from PostgreSQL, because the instructor interface displays it.

#### Candidate design A: job table with a worker process

What the predecessor application does. The webhook inserts a row into `grading_jobs` with status `queued`. A separate always-running Node process loops: claim a queued row, grade it, mark it complete, repeat.

The claim query uses `SELECT ... FOR UPDATE SKIP LOCKED`, meaning: return one queued row, lock it so no other worker can take it, and if a row is already locked, skip past it rather than waiting. That satisfies requirement 4 even with several workers running.

Requirement 5 is satisfied because the worker runs continuously with no invocation limit. The cost is that same property: a worker needs a host that runs continuously, and Vercel does not provide one, because Vercel runs functions that start when a request arrives and stop when it returns. This means a second host such as Fly.io or Railway.

#### Candidate design B: Vercel Workflow

The webhook calls `start(gradeSubmissionWorkflow, [...])`, which returns immediately. The grading program is one function calling several smaller functions, each marked `"use step"`. Vercel runs each step as its own invocation and records the step's result to storage before continuing.

Because each step is a separate invocation, total elapsed time is not limited by any single invocation's limit, satisfying requirement 5 with no continuously running host. Recorded step results satisfy requirement 2 and per-step retry satisfies requirement 3.

Under this design `grading_jobs` is not needed. `grading_drafts.status` already carries the values the instructor interface reads, and would gain a `workflowRunId` column.

#### E2B does not remove the need to choose

E2B runs student code on E2B's own infrastructure, which removes the requirement for a host that can run Docker. It does not remove requirement 5: the code still waits for the sandbox result and then for the language model, so total elapsed time can still exceed a single invocation's limit.

Test execution measures the first half of that time for real. Once a few dozen runs are recorded, `test_runs.duration_ms` answers the question this decision actually turns on: whether test execution alone already approaches the limit, or whether it is the model call that pushes the total past it.

#### Comparison

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

#### What to know about Workflow before choosing Design B

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

### Where rubrics, answer keys, and sample reports live

**Not decided, and deliberately not being implemented.** Written down because it changes the shape of `lib/grade/assets.ts`, and knowing it is coming affects how much is invested there in the meantime.

The idea: move **rubrics** out of the grading-guides repository into a shared Google Drive folder, so that a non-technical instructor can write and upload one without touching git. Answer keys for technical assignments stay in GitHub, where they belong next to the code; answer keys for non-technical assignments live in Drive. Sample feedback reports possibly move too. The grading-guides repository simplifies to a collection of answer keys, and `agent-rules.md` moves into this application's own file structure.

**The strongest part of this is `agent-rules.md` moving into the repository.** It is not reference material, it is prompt code: it sets tone, formatting, the two-beat summary, the half-credit nesting rule, and the prohibition on flag text reaching a student. A change to it changes every grade the application produces. That belongs in a pull request with a diff and a deploy, not in a documents folder — and `modelMetadata` already records a prompt version, which would then be a version of something in this repository.

**The strongest argument for Drive is the one that motivated it**: a rubric written by an instructor who does not use git is a rubric that never gets written otherwise. That is the whole reason instructor-authored rubrics matter, so this is not a minor convenience.

Three things to work out before it is worth doing, each of which is a real cost rather than a detail:

- **Reproducibility is currently a commit SHA.** Assets are read at a resolved commit, cached under `sha:path` with no expiry — safe because content at a commit cannot change — and that SHA is stamped into `modelMetadata` so any report traces back to the exact rubric that produced it. Drive has no equivalent single identifier for a set of files. It does have a revision id per file, so the property is recoverable, but the shape changes: one SHA becomes a set of per-file revision ids, and every place that treats the asset commit as one value has to stop doing that.
- **Sample reports argue against moving.** They steer the model's output format as directly as `agent-rules.md` does, so the same reasoning that says agent rules belong in the repository says samples do too. This is the one part of the idea that cuts against itself, and worth resolving deliberately rather than by whichever is more convenient to move.
- **It is a second Drive integration, and that is an argument for timing rather than against.** Reading a student's Google Doc submission needs Drive access anyway. Doing both at once — assets from Drive, submissions from Drive — costs one authentication story instead of two, which suggests this belongs with [AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments) rather than as its own project.

Also unresolved, and cheap to note now: an instructor uploading a rubric to a folder is not the same as an instructor *authoring* one in the application. The first is a file whose structure nothing validates; the second is rows with bands and descriptions the prompt can be built from. A rubric the model has to be handed as an opaque document is a weaker input than one with a scale it can be told to score against, so "instructors upload rubrics to Drive" and "instructors author rubrics in the application" are different features that happen to serve the same person.

### Deferred: the grading pipeline

- **SQL sandbox execution.** The design is settled: boot an ephemeral PostgreSQL, run `setup.sql`, and compare each numbered query's result set — rows, columns, and order — against `queries-solution.sql` programmatically, which makes SQL correctness fully deterministic with no model judgment involved. It needs an E2B template with PostgreSQL installed, and is the largest gap in what can be graded deterministically.
- **Frontend execution scoring.** Matches today's manual process, which is a README checklist and a code-reading judgment. Lint and build only, to catch hard errors.
- **The GitBook resource link index.** Pre-build a heading-to-URL index for `marcy-curriculum-docs` per module — the URL scheme is fixed at `.../{module}/{lesson}#{subheading}` — and pass candidate links in context for the model to select from rather than construct. Until this exists, prompts omit a recommended resources section entirely rather than risk invented URLs.
- **Answer keys in the cacheable prefix.** They are identical for every student of a given assignment but sit in the user content, so they are billed at full input price on every run. Moving them into the system block would give each assignment its own cache entry. Worth roughly 6 percent of the cost of a report, which is why it waits behind the `effort` question.

Assignment types with no `rubric.md` section yet, such as some mod-5 and mod-8 assignments, route to `needs_manual_review` rather than expanding the rubric now.

---

## Running a cohort: enrollment and attendance

Getting people into a course, recording who arrived, and the one assessment a cohort sits outside this application. The built versions are described in [getting students into a course](ARCHITECTURE.md#getting-students-into-a-course) and the attendance screen; everything below is what they do not do yet.

### The GCF, and what is left of it

Built and in use: a fellow's CodeSignal results are imported from the export, recorded by hand where one arrives outside it, read on the gradebook's fifth tab, and read by the fellow themselves at `/gcf`. The design decisions are settled and worth not relitigating — `Proctoring Status` is the discriminator between the real assessment and a mock, an attempt is identified by a fellow, a kind, and a day, and the assessment's *name* decides only what an import offers rather than being stored.

**It deliberately takes no part in the completion roll-up.** A course is complete when its units are, and a unit when its published assignments are; the GCF is an external benchmark with no assignment behind it, so folding it in would make every course uncompletable for anybody who has not sat the test — which is most of a cohort for most of a term.

Three things are left, none of them scheduled:

- **The `[Mock]` prefix is a naming convention, not a fact.** Nothing in CodeSignal's export separates a mock GCF from a `[TIP Practice]` class exercise except the assessment's name: proctoring status groups all 261 unproctored rows of a term together, a `Max Score` of 1200 catches 46 exercises as well as every mock, and the `mockgcf` label was applied to one of the two mock tests and not the other. So the import lists the assessments with counts and ticks the ones named `[Mock]`, which is a default an instructor overrides rather than a rule compiled in. The version that would need no convention is a label discipline in CodeSignal itself, which is a decision about how the assessments are set up rather than code here.
- **The target is program-wide and hard-coded** — 389 proctored, 600 on a mock's 1200 — in `GCF_TARGET` in `lib/gcf.ts`. That is right while it is a Marcy standard. It becomes wrong the day two cohorts are held to different bars, and the change then is a column rather than a constant.
- **Nothing reads the trend.** Best and latest sit side by side on both screens, which is enough to see that somebody has stopped improving; a fellow sitting four mocks over a term has a shape that neither figure shows. Worth a sparkline before it is worth anything cleverer, and worth neither until a full cohort has practised through one.

### Deferred: running a cohort

- **Matching by name.** An import resolves a CodeSignal address against a remembered mapping and then the account's own email, and anything left is assigned by hand once. Falling back to the test-taker's full name would resolve more of them automatically and is deliberately not done: it fails silently on a nickname or a changed surname, and a silent mismatch writes one fellow's assessment score onto another's record. The manual step is slower and cannot be wrong.
- **An early-intervention dashboard.** `lastActivityAt`, `isLate`, and `status` already support it, and attendance now supplies the other half of the signal — the drift list on the attendance screen is a first version of it scoped to one cohort's mornings. What is left is joining the two, so that a fellow who has stopped handing work in *and* stopped arriving surfaces once rather than on two screens.
- **Term dates, and a meeting pattern on a course.** The one thing that would let a morning nobody took attendance on be noticed. A session exists because somebody started one, so a forgotten Tuesday is indistinguishable from a Tuesday the cohort did not meet — and no warning can tell them apart without knowing which days are school days, which is why none is shown. `startsOn`, `endsOn`, and the weekdays a cohort meets would make the absent session detectable and the denominator "days we should have met" rather than "days somebody opened". Deferred because every version of it is a settings screen that has to be kept true, and being wrong about it is worse than being silent.
- **A second check-in later in the day**, and per-fellow modality — whether somebody dialled in on a day the cohort was in the building. Both are one column and neither is asked for yet; `@@unique([courseId, date])` is what a second session per day would have to become `[courseId, date, slot]`.
- **Adding a student to a cohort directly, without the link.** It needs a way to find a person by email across the whole application, which is a search over `Profile` that nothing else needs and that exposes who else uses the system. The link and [the roster](ARCHITECTURE.md#getting-students-into-a-course) together cover the case that actually happens at the start of term: the instructor already writes down who is expected, and adding somebody mid-term is one more line in that box.

---

## Salesforce synchronization

The whole of what this application owes a system of record outside itself.

**The consultants have replied, and what they answered is in [its own section](#what-came-back-from-idlewild).** Enough is now known to stop guessing about the object and the environment; what remains is a Salesforce developer for the integration's shape, and three decisions that only Marcy can make. The field mapping is still not written down here because it is a reading exercise against a real org rather than something to invent.

**What already exists here.** `submissions` carries three dormant columns — `salesforceSyncStatus` (`PENDING`, `SYNCED`, `FAILED`), `salesforceRecordId`, and `salesforceSyncedAt` — and approving a grade sets the status to `PENDING`. Nothing reads them. They exist so that a synchronization job can query `WHERE salesforce_sync_status = 'PENDING'` without needing a migration at that point.

**What is already settled.** Salesforce tracks grades **per assignment**, on assignment submission objects. That confirms the grain the dormant columns assume: one Salesforce record per submission, keyed from a column on `submissions`, rather than a rollup computed per module or per course. Nothing needs to move.

It also widens the feature past what those columns cover. Managing assignment *and* assignment submission objects means an authored assignment has a counterpart record in Salesforce, which is a second thing to create, key, and keep in step — and `assignments` has no Salesforce columns at all today. Two consequences worth carrying into the conversation:

- **The ordering is forced.** A submission record presumably cannot exist without its assignment record, so authoring an assignment has to create the Salesforce side before any grade for it can sync. That makes this feature depend on assignment authoring rather than merely following it.
- **`assignments` and `courses` both need the same three columns** `submissions` already has. Correct assumption: only `submissions` has them, because it was the only table whose sync was being thought about when they were added. A course is presumably a cohort or program record on their end and an assignment hangs off it, so all three levels need to hold their Salesforce id and sync state. One small migration once the objects' shapes are known — deliberately not written until then, on the same reasoning that left the field mapping un-guessed.

### What came back from Idlewild

They answered the questions a System Administrator can answer, sorted the rest into two piles, and gave a recommendation on the whole approach.

**Their recommendation is not to build this now.** The stated reasons are internal capacity to maintain a custom integration over the long term, the team's inexperience with the Salesforce platform specifically, and an October target for building, testing, and integrating. Their suggested first step if it goes ahead anyway is to bring in a Salesforce developer in at least an advisory capacity, before the build rather than during it. Their own scope explicitly excludes code review, testing, external connection practices, and monitoring API versions over time — so the parts of this that are code are ours regardless.

**Answered, and they remove work:**

- **The object exists and is called Assignment Submission.** Its complete field list, with types and API names, is at Setup → Object Manager → Assignment Submission → Fields & Relationships, and shows every field regardless of page layout or profile visibility. So the field mapping stops being a guess and becomes a reading exercise.
- **Sandboxes are not a constraint.** Marcy can create up to 30 developer sandboxes — three are in use — plus one partial copy, and a System Administrator can make one at any time. Develop against a developer sandbox with invented data rather than the partial copy, which would put real student information in a looser environment.
- **The API ceiling is 127,000 calls per 24 hours**, visible at Setup → System Overview, and more can be bought. At one write per approved grade this is not a limit worth designing around.
- **Validation rules, flows, and dependencies are discoverable rather than mysterious.** They are in Setup, per object; the "Where is this used?" button on a field answers what reads it. Salesforce has a documented order of operations for how validations and automations fire, which they recommend reading before designing the write.
- **A dedicated integration user with a restricted profile is the right shape**, which is what was already assumed. It likely needs a paid licence, and its permissions should be set at both object and field level.

**Still needs a Salesforce developer**, and these are the ones that decide the integration's shape: which API endpoints exist for these objects, what the reliable student identifier is, whether REST or sObject Collections or Bulk fits one write per grade, and who creates the Connected App and issues the certificate for the JWT bearer flow.

**Ours to decide, and nobody else can:** whether the sync also runs updates rather than only first writes, whether it is one-way or two-way, and — the one that changes the most code — whether a grade corrected here may overwrite Salesforce, or whether Salesforce becomes the system of record once written.

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

**API access.** I need server-to-server access with no human in the loop. Sandboxes, the request ceiling, and the integration user are [already settled](#what-came-back-from-idlewild); what is left is for a Salesforce developer:

- Which API should I use — REST, sObject Collections, or Bulk? Volume is small: one write per approved grade, so roughly 25 per assignment per cohort.
- Can we set up a Connected App with the OAuth JWT bearer flow, and who creates it and issues the certificate?
- What exactly goes in the integration user's permission set, at object and field level, for a user that only writes a handful of fields on one object?

**Re-syncing without creating duplicates.** A grade can be corrected after it has been sent, and a student can resubmit and be graded again:

- Can you add an External Id field to that object — unique, holding our submission's UUID — so I can upsert against it? Without one I have to store the record Id and hope it does not change, and any retry risks a duplicate row.
- On a resubmission, do you want the existing record updated, or a second record so the history is visible? Our side keeps every round of feedback, so either is possible.
- If a grade is corrected here after it has synced, may I overwrite what is in Salesforce, or is Salesforce the system of record once written?

**What else fires when I write.** This is the part I cannot see and am most likely to break:

- Which validation rules, triggers, flows, and required-field rules actually exist on that object? They are discoverable in Setup, so this is a lookup rather than a question — but it has to be done before the first write, alongside Salesforce's documented order of operations for how they fire.
- Does anything downstream read those fields — reports, dashboards, a program-completion calculation, anything that emails a student or a funder?
- Could someone edit a grade directly in Salesforce? If so, we need to agree which side wins.

### What may need to be built on the Salesforce end

Worth flagging in the same conversation, since some of it is their work rather than mine: a unique External Id field for idempotent upserts; the object or the fields themselves if per-assignment grades are not currently modelled; a Connected App and a least-privilege integration user; agreed picklist values; sandbox access; and confirmation that no existing automation reacts badly to an integration writing these fields.

### The shape of the work here, once those are answered

A job that reads `PENDING` submissions, writes them, and records `SYNCED` with the record Id or `FAILED` with the reason. Deliberately not part of the approval transaction: approving already posts a pull request comment best-effort for the same reason, because a grade must not fail to be recorded because a third party is unavailable. That makes the sync retryable and makes a failed sync visible as a state rather than a lost write, which is the same shape as the undelivered-comment triage bucket.

**Each write gets an audit event, and the log is already there for it.** [`audit_events`](ARCHITECTURE.md#data-model) is append-only and records `GRADE_APPROVED` today, which is the act a Salesforce record mirrors — so what is missing is one more action for the write itself, carrying the payload sent and the result. That record is what makes "may I overwrite what is in Salesforce" answerable afterwards instead of theoretical: without it, a corrected grade and the question of which side wrote last are reconstructed from mutable rows.

**The student identifier should be stored, not matched on.** If the integration resolves a student by email at write time, it needs read access on Contact and it breaks when an address changes. Storing the Salesforce record Id against the profile once, at enrollment, means the running integration writes to an id it already holds — no lookup by personal information, and a narrower permission set for the integration user. That is worth proposing rather than asking about.

### Deferred: Salesforce

- **Attendance in Salesforce.** `submissions` carries the three dormant columns; `attendance_sessions` and `attendance_records` carry none, deliberately. Adding them before there is a syncer would mean shipping a `PENDING` flag on roughly 1,800 rows a term with nothing to move them. It is the same one-migration change described above, and it wants doing at the same time as the assignment and course columns rather than before them.

---

## Settled decisions and standing limits

Decisions that are made, and limits that are known and deliberate. None of it is scheduled work; it is written down so that a reader does not mistake any of it for an oversight.

- **Which GitHub organization — settled.** `marcy-lms`, an organization created for this, rather than `The-Marcy-Lab-School-Assignments`. That org holds the GitHub Classroom era's templates and is not used at all. It is the only organization: student repositories, the templates they are generated from, and everything the `verify:` scripts create all live in it.

  **What matters about a template is its provenance, not the organization's name.** Classroom wrote `.github/workflows/classroom.yml` into the assignment templates it managed, and every repository generated from one inherits it. The 27 templates in `marcy-lms` are confirmed clean — no workflows at all — and a template created fresh carries nothing. A template forked, transferred, or imported from the Classroom-era org brings the workflow with it. So the rule to hold when adding a template is where it came from.

  An organization's name is not free to change once repositories exist in it. A GitHub rename leaves `submissions.repo_full_name` naming the old one, and the webhook matches that column exactly — so every pull request arrives as an unknown repository and no submission is recorded. `npm run rename:org` exists for that, and `scripts/rename-github-org.ts` says what it covers.
- **`package.json` merge policy for a legitimate dependency collision.** The template wins on a version collision, which is correct when the assignment specifies a version deliberately. Revisit if an assignment ever wants students to choose one.
- **Uploaded objects are never pruned.** A re-upload writes a new object and the previous one is left in place deliberately, so a bucket grows with every resubmission. Nothing collects them, and nothing needs to yet.
