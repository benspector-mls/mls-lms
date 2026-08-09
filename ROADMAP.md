# mls-lms roadmap

How the built system works is in [README.md](README.md). This file is only what is left to do.

- [The order of work](#the-order-of-work)
- [Outstanding verification](#outstanding-verification)
- [Token management](#token-management)
- [What the review pass left open](#what-the-review-pass-left-open)
- [Working a pile by what it is, not only by what it needs](#working-a-pile-by-what-it-is-not-only-by-what-it-needs)
- [Salesforce synchronization](#salesforce-synchronization)
  - [Questions I need answered](#questions-i-need-answered)
  - [What may need to be built on the Salesforce end](#what-may-need-to-be-built-on-the-salesforce-end)
  - [The shape of the work here, once those are answered](#the-shape-of-the-work-here-once-those-are-answered)
- [Seeing a course as a student sees it](#seeing-a-course-as-a-student-sees-it)
- [Targeted assignments, and excusing a student](#targeted-assignments-and-excusing-a-student)
- [AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments)
  - [Instructor-authored rubrics are a prerequisite, not a companion](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion)
- [Triggering and orchestration](#triggering-and-orchestration)
  - [Whether grading should be automatic at all](#whether-grading-should-be-automatic-at-all)
  - [If it does become automatic](#if-it-does-become-automatic)
  - [The problem this must solve](#the-problem-this-must-solve)
  - [Candidate design A: job table with a worker process](#candidate-design-a-job-table-with-a-worker-process)
  - [Candidate design B: Vercel Workflow](#candidate-design-b-vercel-workflow)
  - [E2B does not remove the need to choose](#e2b-does-not-remove-the-need-to-choose)
  - [Comparison](#comparison)
  - [What to know about Workflow before choosing Design B](#what-to-know-about-workflow-before-choosing-design-b)
- [Where rubrics, answer keys, and sample reports live](#where-rubrics-answer-keys-and-sample-reports-live)
- [Scaling: what a hundred students costs, and where it breaks](#scaling-what-a-hundred-students-costs-and-where-it-breaks)
- [Deferred, with the schema left open](#deferred-with-the-schema-left-open)
- [Open items](#open-items)

---

## The order of work

**Nothing about running a cohort needs the database any more.** A course can be created, copied from a previous one, filled from a join link, co-taught, split into groups, retired, found again afterwards, and finally deleted. Assignments of all four kinds can be authored, published, handed out, handed in, graded by the pipeline or by hand, and released, and readings, notes, and videos sit under a module beside its work. Somebody can be made staff by an admin and added to a cohort by whoever runs it. The first admin of a deployment is still a hand-edited row, necessarily, because there is nobody to grant it — `npm run grant:admin` is that base case as a tool.

What is left divides into two kinds of thing: measurement, and features that add real surface area. The review of code that already works has happened — what it left open is [its own section](#what-the-review-pass-left-open) — which is why the features below can be read as work rather than as work plus a cleanup nobody scheduled.

The sequence is most immediate first. A feature's own section says what is known and what is still undecided about it; several are a heading and a paragraph because the thinking has not been done yet, and saying so is more useful than inventing detail. The ordering principle is: the cheap things, then measurement, then the features that add real surface area. Measurement first because a real cohort produces figures rather than estimates.

1. **[Token management](#token-management)** — what a report costs and where the cost actually is. The disclosure half is already built: [nothing a student commits that git was told to ignore reaches the model](README.md#what-a-student-commits-and-what-reaches-the-model). Better after a real cohort has run, which gives measurements rather than estimates.
2. **[Working a pile by what it is, not only by what it needs](#working-a-pile-by-what-it-is-not-only-by-what-it-needs)** — grading every resubmission at a sitting. A second axis over triage rather than a new bucket, for a reason worth knowing before building it.
3. **[Salesforce synchronization](#salesforce-synchronization)** — blocked on a conversation with the consultants who built our Salesforce implementation. The questions that conversation has to answer are written out below. Note that it manages assignment records as well as submission records, so it depends on assignment authoring rather than merely following it.
4. **[Seeing a course as a student sees it](#seeing-a-course-as-a-student-sees-it)** — a test enrollment an instructor can look through. Its design is the one part of this area still open.
5. **[Targeted assignments, and excusing a student](#targeted-assignments-and-excusing-a-student)** — half of which is settled, since [a group](README.md#groups-and-grading-a-portion-of-a-cohort) is the way to name a subset of students.
6. **[AI grading for non-coding assignments](#ai-grading-for-non-coding-assignments)** — which begins with [instructor-authored rubrics](#instructor-authored-rubrics-are-a-prerequisite-not-a-companion), since none of the four fixed section types fits a resume or a reflection.

[Triggering and orchestration](#triggering-and-orchestration) is deliberately not in that list. Generating a report is an instructor action per submission today, which works, and the batch version is a convenience rather than a blocker. It stays written down because the decision will eventually be needed and the reasoning is already done.

[Scaling](#scaling-what-a-hundred-students-costs-and-where-it-breaks) is not on the list and is not meant to be. It is a set of questions to hold rather than work to schedule, and most of what would answer them is measurement that [token management](#token-management) produces anyway.

---

## Outstanding verification

Everything in the README's [what is verified](README.md#what-is-verified-and-how) section has been checked against real repositories. These are the gaps in it.

1. **A Python assignment on `python-pytest`**, for results shaped identically to the Jest ones. No Python template exists in `assignment-templates/` yet.
2. **`allowStudentDependencies: true`** against an assignment that genuinely asks students to add a dependency to the repository's **root** `package.json`. No current assignment does — `swe-1-3-node-modules` looked like the candidate and turned out not to be, since its dependency lives in a nested package. Note that the default presets install with `--ignore-scripts`, so a dependency needing an install script to fetch a platform binary needs an override.

---

## Token management

Three concerns come down to what ends up in a prompt: what it costs, how much of the context window it consumes, and what it discloses. **The third is closed** — a filter withholds committed dependency trees, environment files, credentials, and build output, described in [what a student commits and what reaches the model](README.md#what-a-student-commits-and-what-reaches-the-model). What is left is measurement.

**Where the cost actually is, measured rather than assumed.** Some of this is already answered and recorded in [what a report costs](README.md#what-a-report-costs): output is roughly 60 percent of the bill, because thinking is billed as output, and the frontend prompt's uncached input is the next largest share. What is not measured is the breakdown *within* input — the answer keys against the student's files against the rubric and agent rules — which is what would say whether [moving the answer keys into the cacheable prefix](#deferred-with-the-schema-left-open) is worth more than the 6 percent currently estimated.

**The cost table wants re-measuring on the model in use.** Its four rows were taken on `claude-opus-5` and the default is `claude-sonnet-5`, so the dollar figures are the more expensive tier's. The proportions are what the table is actually for and they hold either way — output dominates because thinking is billed as output — but "a cohort of 25 costs roughly $2.20" is a number somebody will quote, so it should be the number the deployment would actually produce. Four runs of `npm run grade` at each effort level is the whole of it.

**Changing model tier is a calibration question, not a cost question.** The model is a constant with an `ANTHROPIC_MODEL` override and the provider interface already exists, so trying another is an environment variable and adding a vendor is a file in `lib/grade/providers/` — the work is not the integration. The work is proving the other model still agrees with an instructor, and `npm run calibrate` against the held-out pair is the only tool that answers it. **Calibration on the current default has now been run, and what it produced is a caveat rather than a number**: three runs of the same submission against the same prompt returned 12/15 twice and 13/15 once, so [a single run is not a measurement](README.md#what-is-verified-and-how). Any comparison of tiers therefore has to run each candidate several times, and the thing being compared is a range. The exemplar pair reproduced exactly on every run, which is what says the pipeline itself is steady. Two constraints learned from Groq apply to any candidate: the model must guarantee schema-conformant structured output, and its context and rate limits have to fit a frontend prompt, which is the largest at roughly 12,000 tokens of uncached input. A model that cannot do both is not a cheaper option, it is a different failure.

---

## What the review pass left open

The pass ran, and [what it produced is in the README](README.md#one-way-to-ask-each-question) — one authorization mechanism, named shapes at the boundaries, a shared registry for section types, and a Jest suite carrying the pure logic that used to live inside the check scripts. Three things it deliberately did not settle are below, plus one it settled by deciding not to act.

**`sections` as a JSON column, and whether `rubricId` should be a foreign key.** The pass narrowed this to a typed boundary — `readSections` in `lib/assignments/spec.ts` is the one place the column is narrowed, and the authoring schema validates every field on the way in — but it did not change the storage, because doing so is a migration and a real decision rather than a tidy.

What the column buys is that a section's shape can change without a migration, and it has: `grading`, `evidence`, and `testNamePattern` were each added to sections that already existed, and the backfill for `grading` was one `UPDATE`. Instructor-authored rubrics will do it again.

What it costs is exactly one thing, and it is worth being precise: **a `rubricId` inside the JSON is a string that nothing enforces points at a real `Rubric` row.** Deleting a rubric leaves every section that named it pointing at nothing, and the database will not say so. Today that is survivable because no interface deletes a rubric — `prisma/seed.ts` is their only author — so the dangling case is reachable only by hand. It stops being survivable the moment instructors can author and delete their own.

A real column would mean a `Section` table with `assignmentId`, `position`, and a `rubricId` foreign key, and the honest cost is not the migration. It is that a section's *variable* fields — the ones that differ by grading mode and by type — go back to being either nullable columns nobody can require, or a JSON column beside the foreign key, which is the current design with an extra join. The middle option is worth pricing before either: keep the column and add a `RESTRICT` on rubric deletion in application code, which closes the only failure this actually has. That is the decision to make, and it should be made when rubric authoring is designed rather than before.

**Prisma usage, beyond what the pass touched.** Consolidating authorization removed a second round trip at nine call sites and `trpc/selects.ts` gave the repeated selects one definition, but "selects that fetch more than a screen needs, and any place a list view issues a query per row" was not audited systematically. It is a measurement job — the log the development client already prints is most of the tooling — and it wants a cohort's worth of real rows to be worth doing.

**Whether Jest runs in CI on push.** Worth it for the unit half, which needs nothing and takes under a second. Pointless for the check scripts, which need credentials, a database, and the `marcy-lms-test` organization. The question is only whether a push should block on the fast half.

**`components/instructor/grading-review.tsx`** is still the one genuine split candidate, and is still not split. `lib/status.ts` was checked and is deliberately left whole: it is large because it is the single source of presentation truth for a submission's status, drawn on the student's list, the instructor's triage, and the gradebook, and splitting it would create exactly the drift it exists to prevent. That one does not need revisiting.

Two lessons from writing the `verify:` scripts carried into the Jest suite, because both are silent failures rather than loud ones. **A script that selects its fixtures by a proxy for the property it needs will eventually select the wrong one** — "an instructor who is not the one this script acts as" is not "an instructor who does not teach this course", and the wrong one passes by luck rather than failing. And **a check that could not run must not report a pass**: a skip is reported and exits non-zero, because a run that checked nothing is not a run that succeeded.

---

## Working a pile by what it is, not only by what it needs

"Grade all the resubmissions at one sitting" is a real way to work, and triage cannot express it — **for a reason worth knowing before building anything.** `triageBucket` is a vocabulary of *what action is outstanding*: no report yet, to grade by hand, draft ready, held for review, failed, never delivered. It is deliberately not a vocabulary of what a submission *is*. A resubmission with no report and a first submission with no report are both `needs_report`, because the action is identical, and that is what makes the buckets exhaustive and the counts trustworthy.

So this is a **second axis over the same pile**, not a seventh bucket. Adding `resubmission` to the enum would break the property every count on three screens rests on — that the buckets partition the outstanding work — because a submission would then belong to two.

What the axis is made of is already on the row: `submission.status` distinguishes `SUBMITTED` from `RESUBMITTED`, `isLate` is computed at submission, and "revised since grading" is `headSha !== gradedHeadSha` and needs no query. So the filter is presentation over data that exists, which is what makes this small.

Two things it needs beyond a filter control:

- **It has to work across assignments**, which is the whole point — triage is already cohort-wide, so this belongs there rather than on one assignment's queue, and the queue's own filter should probably learn the same axis for consistency.
- **A way to work the filtered set in order.** Grading twenty resubmissions means opening one, approving it, and wanting the next one without going back to a list. The review surface has no next-and-previous today, and a filter that hands somebody twenty items and no way to walk them is half the feature. This is the part [student groups](README.md#groups-and-grading-a-portion-of-a-cohort) does not supply: a group narrows the four screens that already exist and needs nothing new to move between submissions, where working one pile of twenty at a sitting does.

---

## Salesforce synchronization

**Blocked on a conversation with the consultants who built our Salesforce implementation.** Everything below the questions is guesswork until that happens, which is why the field mapping was never guessed at.

**What already exists here.** `submissions` carries three dormant columns — `salesforceSyncStatus` (`PENDING`, `SYNCED`, `FAILED`), `salesforceRecordId`, and `salesforceSyncedAt` — and approving a grade sets the status to `PENDING`. Nothing reads them. They exist so that a synchronization job can query `WHERE salesforce_sync_status = 'PENDING'` without needing a migration at that point.

**What is already settled.** Salesforce tracks grades **per assignment**, on assignment submission objects. That confirms the grain the dormant columns assume: one Salesforce record per submission, keyed from a column on `submissions`, rather than a rollup computed per module or per course. Nothing needs to move.

It also widens the feature past what those columns cover. Managing assignment *and* assignment submission objects means an authored assignment has a counterpart record in Salesforce, which is a second thing to create, key, and keep in step — and `assignments` has no Salesforce columns at all today. Two consequences worth carrying into the conversation:

- **The ordering is forced.** A submission record presumably cannot exist without its assignment record, so authoring an assignment has to create the Salesforce side before any grade for it can sync. That makes this feature depend on assignment authoring rather than merely following it.
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

## Seeing a course as a student sees it

An instructor should be able to look at what they have published the way a student meets it — the assignment list, the accept button, the submission instructions, the feedback screen. It is the cheapest way to catch an assignment whose instructions make no sense or whose kind hands out the wrong thing, and there is currently no way to do it.

The cheap and common half is already covered for free by [the Modules screen](README.md#interface), which shows the course's shape the way a student meets it — an assignment filed under the wrong module, or a module that is empty when it should not be. What that screen deliberately does not have is anything to press.

Doing it properly needs a **test enrollment**: a student-shaped identity the instructor can look through, enrolled in every course automatically, whose submissions are real rows so accepting and submitting behave normally. What that has to settle:

- **Whose rows are they.** One test profile per instructor, per course, or one for the whole application. Per instructor is the least surprising — two instructors previewing the same course would otherwise fight over one submission — and the most rows.
- **It must not appear anywhere a real student does.** The gradebook, the roster, triage, the queue, and every count on a course card. That is a filter in more places than it sounds, and each one missed reports a test row as a student who has not started. A flag on `Enrollment` or `Profile` is the mechanism; finding all the readers is the work.
- **Whether it can be graded.** Almost certainly not: an approved grade on a test row would reach the Salesforce sync as a real one. Refusing at approval is the safer end.
- **How an instructor switches into it**, and how obvious it is that they are in it. A preview that looks like the real thing is a way to grade the wrong person.

This is the only part of the enrollment area whose design is unresolved — the four questions above — and there is a version that costs nothing meanwhile, which is joining your own course with a second GitHub account.

---

## Targeted assignments, and excusing a student

A new capability rather than a screen. Today an assignment implicitly applies to every active enrollment in its course — a submission row appears when a student accepts, and the gradebook treats a missing row as not started. Neither "this assignment is only for these students" nor "this student is excused from this one" can be expressed.

**Half of the data-model decision is made.** Naming a subset of students was the missing piece and [a group](README.md#groups-and-grading-a-portion-of-a-cohort) is it — a named set of students inside one cohort, carrying no instructor relation and no permission, which is exactly the shape targeting wants. So a targeted assignment is an assignment pointing at a group, with All Students — no group — the default it already behaves as.

What is still open is **excusing**, which is the other direction and needs its own row: a per-student exclusion against one assignment. The distinction matters for the gradebook, because an excused student must read as excused rather than as missing work, or it is worthless.

Three readers have to learn about both, and they are the same three a group filter already touches: the gradebook, which must draw a cell that is neither a grade nor a gap; triage and the per-assignment counts, which must not count work nobody was asked to do; and the student's own course page, which must not offer an Accept for something they were not given.

---

## AI grading for non-coding assignments

Short response is already graded and calibrated against an instructor's own marking, so this means the work that has no repository: a Google Doc, an uploaded PDF, a presentation. Creating, handing in, and hand-grading all of those is built, and an uploaded file has somewhere to be read *from*. What is not built is reading a Google Doc's contents or an uploaded file's, and generating a report from it — which needs Drive access, and which needs rubrics that describe the work.

The pipeline's inputs change shape here, which is the size of it: there is no pull request diff, no changed-file list, and no test evidence, so "the student's work" has to be fetched from Drive or from storage instead of read out of a diff.

### Instructor-authored rubrics are a prerequisite, not a companion

Confirmed rather than assumed: this feature requires them. The taxonomy is fixed at the four sections that exist in `rubric.md`, and a resume, a reflection, or a presentation matches none of them — so there is no version of this feature that ships against the current four. It is the first thing built when this item comes up.

What that touches, so the size is not a surprise:

- **`Rubric` rows are real database rows already**, with a `RubricScaleType`, so storing an authored one is not the hard part.
- **`SECTION_TYPE_REGISTRY` in `lib/section-types.ts` is the hard part.** Each of the four section types maps to a heading in `rubric.md` and a sample report file, both read from the grading-guides repository. An instructor-authored rubric has neither, so the rubric text and the sample have to come from the database instead — which means the asset loader stops being "read the file at this path" and becomes "read the file, or read the row." The registry is where a type is added and is deliberately one entry per type, so the shape of the work is turning that entry from a literal into something that can also be a row.
- **The prompt is built from those assets**, so an authored rubric has to produce the same three things the file-backed ones do: a scale with a written description per band, a heading's worth of criteria, and an example of a good report. The third is the one instructors will not think to provide and the model most needs — worth deciding whether an authored rubric can borrow the closest existing sample rather than requiring a new one.
- **Whole numbers and the flags vocabulary** are properties of the rubric, not of the pipeline. An authored scale still has to be bands with descriptions, or the "no 1.5, put the hesitation in `instructorNotes`" rule has nothing to anchor to.

This is also what makes the section types no longer a closed set, which the classifier currently assumes — `classifySections` matches file paths against the types in the registry. An authored rubric attached to a Google Drive assignment has no file paths to classify, so the two land together: classification only runs for kinds where "which files did the student change" is a meaningful question.

---

## Triggering and orchestration

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

## Where rubrics, answer keys, and sample reports live

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

**Questions to hold rather than work to schedule.** Nothing here is a known problem — the largest thing this has run against is one cohort — and most of what would answer it is measurement [token management](#token-management) produces anyway. It is written down because the answers change what [triggering and orchestration](#triggering-and-orchestration) should be, and that decision is already waiting.

**What is already measured**, from [what a report costs](README.md#what-a-report-costs) and the sandbox durations in `test_runs.duration_ms`: a report is roughly $0.09 to $0.15 at `high` effort, output is about 60 percent of it because thinking is billed as output, a sandbox run is 30 to 40 seconds, and a single submission end to end is about two minutes at the worst measured case. So a hundred students on one frontend assignment is on the order of $15 and, if run one after another, over three hours of wall clock. Neither figure is alarming; both are worth knowing before a batch button exists.

**Concurrency is the question triggering and orchestration already frames.** Its requirement 4 — that a batch must not be bound by one function invocation's limit — is answered by fanning out one invocation per submission, because two minutes sits comfortably inside 300 seconds. What a hundred students changes is not that arithmetic but what happens when a hundred of those invocations run at once, which is where every vendor limit below actually bites.

**Anthropic.** Rate limits are per organization and counted in requests and tokens per minute, so the ceiling on a batch is not the money, it is how many reports can be in flight before requests start being refused. Two things follow: whatever runs the batch needs to handle a rate-limit response by waiting rather than by failing a submission, and [prompt caching's five-minute window](README.md#what-a-report-costs) means a burst is meaningfully cheaper than the same work spread across an evening — which argues for the grading-session model rather than against it. Worth separating from developer tooling: the grading spend is the Anthropic API, and Claude Code is a different line item that scales with how much is built rather than with how many students there are.

**E2B.** Concurrent sandbox count is the limit that matters, not total minutes, and a sandbox bills until its own timeout expires — which is why `sandbox.kill()` is in a `finally` block. A hundred concurrent runs is the first time a leak would be expensive rather than merely untidy. The other thing a hundred students changes is that 6 to 17 seconds of dependency installation per run stops being a detail: [building custom templates with dependencies already present](README.md#the-sandbox-run) is the largest speed improvement available and it gets more valuable linearly.

**Supabase.** The application connects through the pooled `DATABASE_URL` and migrations use `DIRECT_URL`, which is the arrangement that survives many concurrent functions — a serverless fan-out against a direct connection is how a connection pool gets exhausted. Two other limits to know: the storage bucket for uploaded submissions grows without bound, since a re-upload writes a new object and [the previous one is deliberately left in place](README.md#handing-in-a-file), and a hundred students' resumes at up to 25MB is a real number. Nothing prunes it today.

**Vercel.** The 300-second function limit is the one already reasoned about. Beyond it: a fan-out of a hundred invocations is a hundred invocations' worth of Active CPU billing, and the webhook path is unaffected because it does one database write.

**The one that is not a vendor limit.** A hundred students produce a hundred drafts an instructor has to read, and no amount of concurrency helps with that. Triage, [working a pile by what it is](#working-a-pile-by-what-it-is-not-only-by-what-it-needs), and [student groups](README.md#groups-and-grading-a-portion-of-a-cohort) are the parts of this application that actually address a cohort of a hundred, which is worth noticing given how cheap they are.

---

## Deferred, with the schema left open

- **SQL sandbox execution.** The design is settled: boot an ephemeral PostgreSQL, run `setup.sql`, and compare each numbered query's result set — rows, columns, and order — against `queries-solution.sql` programmatically, which makes SQL correctness fully deterministic with no model judgment involved. It needs an E2B template with PostgreSQL installed, and is the largest gap in what can be graded deterministically.
- **Frontend execution scoring.** Matches today's manual process, which is a README checklist and a code-reading judgment. Lint and build only, to catch hard errors.
- **The GitBook resource link index.** Pre-build a heading-to-URL index for `marcy-curriculum-docs` per module — the URL scheme is fixed at `.../{module}/{lesson}#{subheading}` — and pass candidate links in context for the model to select from rather than construct. Until this exists, prompts omit a recommended resources section entirely rather than risk invented URLs.
- **Answer keys in the cacheable prefix.** They are identical for every student of a given assignment but sit in the user content, so they are billed at full input price on every run. Moving them into the system block would give each assignment its own cache entry. Worth roughly 6 percent of the cost of a report, which is why it waits behind the `effort` question.
- **One submission on behalf of a group.** A submission belongs to a student today: `studentId` is non-null, its pair with the assignment is unique, the repository is created against one GitHub login, and approving writes the grade onto that one row. The version that keeps all of those is one student's submission being the real one, with approval copying the grade and the feedback onto their groupmates' rows. Each student then still has their own record, which is what the gradebook, the student's own feedback page, and [Salesforce](#salesforce-synchronization) all want anyway. `CourseGroup` is the table it wants, and it carries no instructor relation for this reason.
- **Students seeing their groups and who else is in them.** Nothing about splitting the grading needs it, and it starts to matter only when students are working together — so it arrives with group assignments rather than before them. It would be the first student-visible read of anybody else in the cohort, which is why it wants deciding per group rather than for all of them: a project team is meant to be seen, and a group that exists only to split the marking is not.
- **Rendering a Jupyter notebook in the review screen.** `previewKindOf` answers `pdf` or `image` and everything else downloads. A notebook is the most-read of the uploaded types and the one where the download-and-open-elsewhere loop that [embedding a PDF exists to remove](README.md#handing-in-a-file) costs the most. Rendering one is a real dependency and its own decision, which is why a check records that not previewing it is deliberate.
- **A manifest in the assignment repository.** A file in each template — `assignment.json` rather than a block in `package.json`, since `package.json` is a protected path the sandbox merges under its own rules and Python and SQL assignments have none — declaring section types, point values, and answer keys. It would let the seed's one remaining assignment definition go, make the repository the author of what an assignment *is* rather than an instructor retyping it, and support a drift check when a cohort's copy no longer matches the curriculum. Deferred because the recurring cost it removes is already covered by `duplicate`, and because designing it after a real cohort has been set up beats designing it against a guess. Any version of it must read from the template and never a student's copy, and be read server-side rather than trusted from the browser.
- **A catalogue for `GOOGLE_DRIVE` assignments.** An instructor types the title and pastes the template link, so nothing forces internal organization and "what Drive assignments exist" has no single answer to check a new one against. The shape most likely to work, not yet designed in detail: a shared Drive folder per module that an instructor picks a document from rather than pasting an arbitrary link. That is one authentication story with [reading a student's document for grading](#ai-grading-for-non-coding-assignments), which is the argument for doing them together rather than now. `FILE_UPLOAD` likely needs no catalogue at all: an instructor is describing a submission format rather than selecting among curriculum content.
- **Bulk grading** beyond the basic gradebook table, and a single action that generates reports for every submission still waiting on one.
- **An early-intervention dashboard.** `lastActivityAt`, `isLate`, and `status` already support it.
- **A per-student record that accumulates over time and informs grading.** Requires deciding what is tracked and deserves its own design discussion.
- **A grading assistant mode** that identifies patterns across a student's assignments relative to a rubric. Depends on the previous item existing first.
- **Adding a student to a cohort directly, without the link.** It needs a way to find a person by email across the whole application, which is a search over `Profile` that nothing else needs and that exposes who else uses the system. The join link covers the case that actually happens at the start of term.

Assignment types with no `rubric.md` section yet, such as some mod-5 and mod-8 assignments, route to `needs_manual_review` rather than expanding the rubric now.

---

## Open items

- **Which GitHub organization — settled.** A **new organization**, created for this, rather than `The-Marcy-Lab-School-Assignments`. That org holds the GitHub Classroom era's templates and will not be used at all. Everything verified so far used `marcy-lms-test`, and moving to the new one is a matter of `SEED_GITHUB_ORG`, an App installation, and each assignment's `githubOrg`.

  **What matters about the new org is the templates' provenance, not its name.** Classroom wrote `.github/workflows/classroom.yml` into the assignment templates it managed, and every repository generated from one inherits it. A template created fresh, or copied from `marcy-lms-test` — confirmed clean, 27 templates and no workflows at all — carries nothing. A template forked, transferred, or imported from the Classroom-era org brings the workflow with it. So the rule to hold when populating the new org is where each template came from.
- **Project-wide Supabase default privileges.** Undecided, pending a conversation with your partner. Until it is decided, every new table needs its own `REVOKE` and row level security statements.
- **`package.json` merge policy for a legitimate dependency collision.** The template wins on a version collision, which is correct when the assignment specifies a version deliberately. Revisit if an assignment ever wants students to choose one.
- **Uploaded objects are never pruned.** A re-upload writes a new object and the previous one is left in place deliberately, so a bucket grows with every resubmission. Nothing collects them, and nothing needs to yet.
