# What the `verify:` scripts reported before the refactor pass

Recorded 8 August 2026, against the development database and the `marcy-lms-test` organization, immediately before the shared harness was extracted. Every phase of the refactor is gated on reproducing these numbers rather than merely exiting zero — a script that silently stops checking something exits zero too.

| Script | `ok` | Needs |
| --- | --- | --- |
| `verify:sandbox` | 41 | nothing — **now `tests/lib/sandbox/sandbox-logic.test.ts`** |
| `verify:grade` | 101 | nothing — **now three suites under `tests/lib/grade/`** |
| `verify:modules` | 35 | the database |
| `verify:groups` | 46 | the database |
| `verify:resources` | 64 | the database |
| `verify:staff` | 50 | the database |
| `verify:approve` | 48 → **53** | the database |
| `verify:uploads` | 88 | the database, and the storage bucket |
| `verify:authoring` | 156 | the database, and GitHub |
| `verify:enrollment` | 200 → **209** | the database |
| `verify:app` | 16 | GitHub |
| `verify:assets` | 62 | GitHub |
| `verify:e2b` | 8 | a real E2B sandbox |
| `verify:test-student` | 42, or 56 with `--live`, or 64 with `--live --github` | the database; `--live` also Supabase; `--github` also GitHub |
| `verify:dashboard` | 27 | the database |
| `verify:attendance` | 59 | the database |
| `verify:calendar` | 28 | the database, and the application answering over HTTP |

**`verify:attendance` postdates this file** and is recorded here for the reason the file exists. Its 59 need a cohort with an instructor and **at least two active students**, which is a real requirement rather than a convenience: half the checks are about one fellow being unaffected by what another does, and with one student "the record count did not change" passes for the wrong reason. Short of two it reports a skip and exits non-zero rather than quietly measuring less.

**Two of its checks are about the database rather than about a procedure**, and they are the reason it is a script. One inserts a record naming this course and another cohort's enrollment, which the composite foreign key on `(enrollment_id, course_id)` refuses — the procedure refuses it in words, but the constraint is what makes a second write path added later inherit the guarantee. The other inserts a `FINALIZED` row claiming somebody was present, which a CHECK refuses: that row is written when a session ends, for the fellows nobody recorded, so a `FINALIZED` row saying PRESENT would be the application asserting attendance on the strength of no evidence at all. It is the one claim the table must never be able to make, because it is the claim a stipend is paid against.

**It backdates the session by two slots before deriving any code.** Otherwise whether the grace-window group runs at all depends on where in the minute the script happened to start — on a fast machine, never — and a check whose coverage varies with the clock is one that eventually stops covering anything.

**It found two real defects on its first run**, which is the argument for writing it. The first: `start` caught Prisma's P2002 and re-read the session, which cannot work inside a transaction — Postgres aborts the whole transaction on a failed statement, so the recovering read failed too, with a message about the transaction rather than about attendance. It uses `createMany` with `skipDuplicates` now, which compiles to `ON CONFLICT DO NOTHING` and never raises. The second: `checkIn` returned any existing record as "you are already checked in", including the absence written when the session ended — so a fellow who missed the morning entirely was told they were marked in. `FINALIZED` is excluded from that branch now and falls through to the refusal, which sends them to their instructor.

**`verify:dashboard` also postdates this file.** Its 27 assume a cohort with at least two active students and a fixture student holding at least one graded and one ungraded submission; short of any of those it reports a skip and therefore exits non-zero rather than quietly measuring less. Three of the 27 are the reason it is a script and not a suite — that one student's submissions do not reach another's dashboard, that no other student's submission is attached to the caller's rows, and that one student cannot mark another's feedback read — and none of them can be asked of a fixture, because what they check is a `where` clause against live rows that Prisma is not restricted by row level security from ignoring.

**It earned its place immediately.** Its check that the bar's green segment and the "5 of 9 complete" above it are the same number caught `progressStateOf` reading a submission's status before `isComplete`, which meant a student who passed an assignment and then asked for another look lost the completion: the segment moved to amber and the count went down by one. Every unit case still passed, because none of them had thought to combine `RESUBMITTED` with `isComplete: true` — the arrangement a real database had four of.

**`verify:test-student` postdates this file** and is recorded here rather than left out, because the reason the file exists applies to it from the start. Its three figures are three runs and not three moods: the 42 need only the database, `--live` adds the fourteen that create and delete a real Supabase account, and `--github` adds the eight that generate and delete a real repository. All three rose by five when leaving the view gained a destination — the course id travels in a cookie and is interpolated into a redirect path, so the shape check guarding it is asserted against the strings somebody would try — and by one more for the check below.

**Its last check is that the run left no test student behind**, and it is there because a run did. The gated groups make real accounts and real repositories and delete them again, and the way that fails is silent: every `ok` is still earned and printed, and what remains is an account holding a number, a submission, and a repository nobody is looking for. It was found by hand rather than by the script, which is the wrong way round. The check compares against the test students that existed when the run started rather than against zero, because a deployment may hold ones an admin is using and those are not the run's litter. A plain run also reports a skip, and therefore exits non-zero, on a deployment whose only instructor of the fixture course is also an admin — that is the group which checks `adminProcedure` was used rather than `instructorProcedure`, and approximating it with the admin is how it silently passed once already.

**`verify:calendar` postdates this file**, and it is the only script here that needs the application itself rather than only its dependencies: the whole point is to fetch the address a student would paste into Google Calendar, so it wants `npm run dev` in another terminal or a `--base=<url>` naming a deployment. Short of anything answering it reports a skip and exits non-zero rather than measuring the procedures alone and calling that a pass.

Its 28 need one active enrollment in a cohort that is still running, and a unit in that cohort to hang an assignment on. Nothing else — where the other scripts depend on the seeded data having the right shape, this one **makes the fixture it cannot count on**. The exclusion of unpublished work is the most consequential rule in the feature and no seeded row exercises it, so the script creates an unpublished assignment with a deadline in the student's own cohort, checks it is absent, publishes the same row, and checks it appears. A negative check on its own cannot tell "the rule works" from "that row was never going to be there", and the pair can.

**It writes twice and puts both back in a `finally`.** The assignment is deleted, and the fixture student's calendar token is restored to whatever it was, including null. Generating an address is the only way to reach the route, and doing it to a student who had already subscribed would silently break their subscription — so a run that fails halfway must not leave one behind. A test student is preferred as the fixture for the same reason, and is used when the cohort has one.

**One check is the reason the script exists**: that the feed holds one event per dated assignment `assignments.listMine` returns, and the same ones. Both readers call `distributedToStudent`, and this is what would fail if they ever came apart — a feed hiding an assignment the dashboard shows, or naming work in a cohort somebody has left, is a fault nobody notices until a deadline is missed.

**Its first run failed on two checks that were both wrong in the script.** One searched the raw body for a whole `URL:` line, which is about 118 octets and therefore folded across two physical lines by the very rule the unit tests assert — so a correct feed failed. The checks read an unfolded copy now, which is what a parser sees. The other asserted that the seeded data contained unpublished dated work, which it does not; that is the check the created fixture replaced.

`verify:resubmission` is not in the table because it takes a repository substring as an argument and refuses without one. It also has no fixed count: **it fails unless the repository it is pointed at holds a commit newer than the one it was graded on**, which is state a person stages by pushing and letting the webhook record it — the script says so in its own header, since item 4 is checked here rather than performed. A run reporting `FAIL the new commit was recorded  head X, graded X` is that missing fixture and not a regression. The way to tell them apart is to run the same command on the previous commit; a real regression fails there too.

`calibrate` is not a check script: it grades a sample and prints a comparison for a person to read.

**A number moves only when a script gains checks, and then it is written down here with both figures.** `verify:enrollment` went from 200 to 209 when the roster arrived: that somebody nobody expected is refused, that the screen says so before the button, that an instructor can write down who is expected, that the screen then offers the button, that pasting the same list twice adds nobody, that joining claims the entry, that a claimed entry cannot be removed, and — the two that hold the ordering in place — that a student already in the cohort is unaffected by having no entry, and that their screen still says they are in it. `verify:approve` went from 48 to 53 when batch generation added five: that a run can be claimed, that a second attempt on the same commit is refused, that another commit is separate work, that the no-commit case is claimed once too, and that an abandoned claim can be taken. The old figure stays beside the new one because the point of this file is that a count which changed for a reason looks exactly like one that changed by accident, unless somebody says which.

**The first two rows are history rather than instructions.** `verify:sandbox` and `verify:grade` needed nothing — no database, no repository, no model — which is exactly what makes them unit tests rather than scripts, so their 142 assertions are now Jest cases and both scripts are gone. Nothing was dropped in the move: the sandbox suite carries 41 assertions and the three grading suites carry the other 101, in 100 cases, the one difference being that `hasTestEvidence`'s pair of checks share a case. The rows stay in the table because they are what the counts below were compared against, and because the next reader should know where those numbers went.

**The README's figures are older than these.** It records 43 for groups and 61 for resources where they now report 46 and 64 — the scripts grew and the prose did not. That is the whole reason this file exists: the number to compare against is the one the script prints today, not the one somebody wrote down once.

## Re-running the set

The database-backed scripts are slow enough that `npm run` adds a wrapper it is easier to do without:

```sh
npx tsx --conditions=react-server scripts/verify-groups.ts
```

`--conditions=react-server` is required by anything reaching a module marked `server-only`, which is most of them.
