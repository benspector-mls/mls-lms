# The Salesforce feed

A read-only HTTP interface that lets Make.com pull records out of this application and write them into Salesforce. Make holds the Salesforce credentials and performs every write; this application never speaks to Salesforce and stores no Salesforce identifier.

## What this is for

Marcy keeps its system of record in Salesforce, where a fellow is a Contact, a term is a Program, and the fact of a fellow being in a term is a Program Enrollment. Those three exist in Salesforce before a program begins in this application. Everything that happens *during* a program — the courses a fellow takes, the assignments set, the work handed in and graded, the mornings attended, the assessments sat, the coaching conversations held — happens here, and Salesforce needs a record of each.

Make.com sits between the two systems. On a schedule it calls this application, receives the records that have changed since it last asked, and upserts each one into Salesforce. Because Make owns the Salesforce half, this application needs no Connected App, no certificate, no JWT bearer flow, and no knowledge of the Salesforce object model beyond the names in this document.

## The Salesforce objects, and what each one is here

| Salesforce | This application | Exists first in |
|---|---|---|
| Contact | `profiles` | Salesforce |
| Program | `programs` | Salesforce |
| Program Enrollment | `enrollments` | Salesforce |
| Class | `courses`, plus one Attendance class per program | this application |
| Class Registration | a course and an enrollment — no table | this application |
| Assignment | `assignments` | this application |
| Assignment Submission | an assignment and an enrollment, with the `submissions` row when one exists | this application |
| Session | `attendance_sessions` | this application |
| Attendance | `attendance_records` | this application |
| Artifact | `gcf_attempts` | this application |
| Coaching Conversation | `coaching_sessions` — a later addition | this application |

The tree in Salesforce: a Program holds Classes; a Class holds Class Registrations, Assignments, and Sessions; an Assignment holds Assignment Submissions, each linked to a Class Registration; a Session holds Attendances; a Program Enrollment holds Artifacts and Coaching Conversations, and an Artifact also names its Contact directly.

## One rule for linking

Every record this integration touches carries its identifier from this application in an External Id field on the Salesforce object, and every parent reference resolves through that field. The identifier is the row's UUID where there is a row, and a composite key where there is not.

**Objects this application creates** are upserted by that identifier and name their parents by the parents' identifiers. Salesforce's REST API accepts a parent given as `Parent__r: { LMS_Id__c: "<identifier>" }` in an upsert body, and resolves it server-side. Make never holds a Salesforce Id, and this application never stores one.

**Objects that exist in Salesforce first** — Contact, Program, Program Enrollment — are stamped once with this application's identifier by a setup scenario in Make, described under [What Make does](#what-make-does). After that, every ongoing write goes by identifier and no record is ever matched on a name or an email address again.

**Requirement on the Salesforce side.** Every object in the table above needs one text field marked External Id and Unique, holding this application's identifier — including Contact, Program, and Program Enrollment. That is the whole of the Salesforce configuration, and the integration cannot work without it: a retried Make execution would otherwise create duplicate records, and a child could not find its parent.

**Why identifiers travel outward rather than Salesforce Ids travelling inward.** The alternative is this application storing the Salesforce Id of each Contact, Program, and Program Enrollment: three new columns, a write endpoint for Make to fill them through, and a token that can then write as well as read. Stamping needs none of that. What it gives up is a roster badge saying "not linked to Salesforce" — an unmatched fellow surfaces as failed writes in Make's log instead. That is the right trade until unmatched fellows prove common.

## Finding what has changed

Each source table carries an `updatedAt` column marked `@updatedAt`, which Prisma writes on every update without any call site asking it to. That column is the change-detection mechanism, and no synchronization columns are added anywhere. A `PENDING` flag would have to be reset by every write path — an instructor overriding an attendance status, a note added to an excused absence, an import merging into a hand-entered score — and the path that forgets produces a change that silently never reaches Salesforce. `updatedAt` already carries that obligation and cannot forget it.

Make stores the position it reached and sends it back on the next call as two query parameters: `since`, an ISO 8601 instant, and `after`, the identifier of the last record it saw at exactly that instant. Every collection is ordered by `(updatedAt, identifier)` ascending and returns records strictly after that position. For a collection read straight from one table:

```ts
where: since
  ? { OR: [{ updatedAt: { gt: since } }, { updatedAt: since, id: { gt: after } }] }
  : {},
orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
take: limit + 1,
```

The `after` tiebreaker matters because a bulk update writes an identical `updatedAt` to many rows at once, and a cursor holding only a timestamp would either skip the rest of that group or return it forever.

**Two collections have no table of their own** — Class Registrations, and the Assignment Submissions for work nobody has started — and they are computed from small tables instead. Their `updatedAt` is the later of their two parents', and the walk over them happens in memory: the source tables run to hundreds of rows, so loading them and sorting the computed pairs costs less than a query that could express the join. The section on each says exactly how.

`submissions` carries three columns this design does not read: `salesforce_sync_status`, `salesforce_record_id`, and `salesforce_synced_at`. Nothing needs them, because an upsert against an External Id makes a resend harmless and therefore makes a record of what has already been sent unnecessary. They stay in place; removing them is a separate migration with no bearing on this work, and it wants the schema deployed before the `DROP` for the same reason the legacy submission columns did.

**Make should overlap its window.** Request `since = lastSeen - 5 minutes` rather than exactly `lastSeen`, so a row whose transaction commits just after a query ran is picked up by the next one. The upsert makes the overlap free.

## The endpoints

One route file serves every collection:

```
app/api/integrations/salesforce/[collection]/route.ts
lib/integrations/salesforce/feed.ts
```

`GET /api/integrations/salesforce/{collection}?since=&after=&limit=`

The route handler checks the token, parses the cursor, looks the collection up in a table, runs its query, and writes the envelope. Each entry in that table holds a function producing ordered records after a cursor and nothing else. Authorization, cursor parsing, paging, the envelope, and error shapes are written once in `feed.ts`. Adding Coaching Conversations later is one more entry.

`limit` defaults to 200 and is capped at 500. An unknown collection is a 404. `since` may be sent alone; `after` sent without `since` is a 400, because a tiebreaker with nothing to break the tie against is a caller mistake rather than a position.

### The envelope

```json
{
  "records": [ … ],
  "hasMore": true,
  "cursor": { "since": "2026-09-22T14:02:11.482Z", "after": "b3f1…" }
}
```

`cursor` is the position to send on the next call, and it is null when `hasMore` is false. Returning it explicitly rather than making Make read the last element of the array saves a module in every scenario on every run. `hasMore` is computed by requesting one record more than `limit` and discarding it.

Every record carries `externalId` — the value to upsert on — and names each parent by the parent's `externalId`. All timestamps are ISO 8601 in UTC. Civil dates — `attendance_sessions.date` and `gcf_attempts.taken_on` — are emitted as `YYYY-MM-DD` strings through `schoolDayFromColumn` in `lib/school-time.ts`, which reads the UTC parts of the value Prisma returned and takes the first ten characters. It is reused rather than rewritten because the reasoning about why UTC rather than local is the valuable part of it, and it lives in the same layer as the feed.

### The collections, in the order Make must run them

| Collection | Source | Parents named | Identifier |
|---|---|---|---|
| `programs` | `programs` | — | `programs.id` |
| `enrollments` | `enrollments` | program | `enrollments.id` |
| `classes` | `courses`, plus one per program | program | `courses.id`, or `attendance:<programId>` |
| `registrations` | courses × enrollments | class, program enrollment | `<courseId>:<enrollmentId>` |
| `assignments` | `assignments` where distributed | class | `assignments.id` |
| `sessions` | `attendance_sessions` | the program's Attendance class | `attendance_sessions.id` |
| `attendance` | `attendance_records` | session, program enrollment | `attendance_records.id` |
| `submissions` | assignments × registrations, with the row when there is one | assignment, class registration | `<assignmentId>:<enrollmentId>` |
| `gcf-attempts` | `gcf_attempts` | program enrollment, contact | `gcf_attempts.id` |

The order is the dependency order: a child upsert fails in Salesforce when its parent is not there yet.

### Records: programs and enrollments

These two exist so that the setup scenario can stamp the Salesforce records that exist first. Both are tiny and change rarely.

```
programs
  externalId      programs.id
  name            programs.name
  term            programs.term
  discipline      SOFTWARE_ENGINEERING | DATA_ANALYTICS
  updatedAt

enrollments
  externalId      enrollments.id
  programId       the program's externalId
  studentId       profiles.id — what the Contact is stamped with
  studentEmail    profiles.email
  studentName     profiles.display_name
  status          ACTIVE | REMOVED
  updatedAt
```

`studentEmail` appears here and nowhere else in the feed. It is what the setup scenario matches a Program Enrollment on, once. Every other collection names a fellow only through an identifier: `enrollmentId` where the Salesforce parent is a Program Enrollment, `contactId` where it is the Contact. The Contact is stamped with `studentId` rather than the enrollment's identifier because a fellow who repeats a term has two enrollments and one Contact.

### Records: classes

One per published course, and one Attendance class per program.

```
externalId      courses.id, or attendance:<programId>
programId       the program's externalId
name            courses.name, or "Attendance"
archived        courses.archived_at is not null, or false
updatedAt       courses.updated_at, or programs.updated_at
```

Unpublished courses are not sent: a course is published when a fellow can see it, and Salesforce should not hold a class the roster cannot.

**The Attendance class.** In Salesforce a Session belongs to a Class, and Marcy's practice is one class per program that exists only to hold the sessions. Nothing in this application corresponds to it, so the `classes` collection emits it: one record per program with a deterministic identifier, and the `sessions` collection names that identifier as its parent. The alternative was somebody creating the class by hand each term and pasting its Id somewhere, which is a step that gets forgotten the first September nobody remembers it.

### Records: registrations

One per active or removed enrollment in a program, per published course in that program. No table holds this pair, because the rule in this application is that being on a program's roster makes somebody a student of every course of the program (`lib/assignments/scope.ts`).

```
externalId          <courseId>:<enrollmentId>
classId             the course's externalId
enrollmentId        the enrollment's externalId
enrollmentStatus    ACTIVE | REMOVED
updatedAt           the later of courses.updated_at and enrollments.updated_at
```

**Removed fellows keep their registrations.** Removing somebody from a roster does not unmake the classes they sat in, and their Assignment Submissions still name these registrations. `enrollmentStatus` travels so a report on the current roster can exclude them.

**How the cursor works over a pair.** The collection loads every published course and every enrollment — a few hundred rows between them — forms the pairs, gives each the later of its two timestamps, sorts by `(updatedAt, externalId)`, and returns the page after the cursor. A change to either side moves the pair past any cursor that has already passed it.

### Records: assignments

One per distributed assignment. An undistributed one is a draft that no fellow has seen.

```
externalId      assignments.id
classId         the course's externalId
title           assignments.title
type            assignment | project | assessment
pointValue      1 for a TASK, assignments.point_value otherwise
dueAt           assignments.due_at, may be null
updatedAt
```

`type` comes from the category of the unit the assignment sits in, `CourseUnitCategory`: `MODULE` is an assignment, `PROJECT` a project, `ASSESSMENT` an assessment. That is the distinction Salesforce draws, and it is a property of where the work sits in the curriculum rather than of how it is handed in — `AssignmentKind`, which says how work is handed in, is deliberately not sent.

`pointValue` is written as the sentence above rather than through `assignmentPointValue` in `lib/assignments/spec.ts`, which computes the same answer from the assignment's sections. The feed does not hold the sections and does not need them: a task is worth one point by rule, and every other kind keeps its total in the column.

### Records: sessions

One per program day.

```
externalId      attendance_sessions.id
classId         attendance:<programId>
date            attendance_sessions.date as YYYY-MM-DD
startedAt       attendance_sessions.started_at, may be null
endedAt         attendance_sessions.ended_at, may be null
updatedAt
```

### Records: attendance

One per fellow per program day, the child of a Session.

```
externalId          attendance_records.id
sessionId           the session's externalId
enrollmentId        the enrollment's externalId
status              PRESENT | LATE | ABSENT | EXCUSED
source              SELF_CHECK_IN | INSTRUCTOR | FINALIZED
checkedInAt         attendance_records.checked_in_at, may be null
note                attendance_records.note, may be null
updatedAt
```

**`EXCUSED` still counts as missed.** The note explains the absence rather than cancelling it. Whoever builds the attendance report in Salesforce needs to know this, because the other reading produces a different attendance rate from the one this application shows, and a figure quoted to a funder should not depend on which system it was read from.

### Records: submissions

One per distributed assignment per registration in its class — **whether or not the fellow has started**. Salesforce has always held an Assignment Submission for every fellow on every assignment, and reports there read a missing row as an error rather than as "not started". This collection keeps that grid complete.

```
externalId          <assignmentId>:<enrollmentId>
assignmentId        the assignment's externalId
registrationId      <courseId>:<enrollmentId>, the class registration
status              notStarted | inProgress | submitted | graded
submittedAt         submissions.submitted_at, may be null
score               submissions.final_score, null until graded
scorePossible       submissions.final_score_possible, null until graded
isComplete          submissions.is_complete, null until graded
lateness            onTime | extended | late, null until handed in
gradedAt            submissions.graded_at, null until graded
feedbackMarkdown    submissions.feedback_markdown, null until graded
updatedAt
```

**The identifier is the pair, not the row.** A `submissions` row is created when a fellow first accepts or hands in (`lib/assignments/accept.ts`), so a fellow who has not started has no row and no UUID. What this application does consider unique is the pair of assignment and student — `submissions` has one row per `(assignment_id, student_id)` — and the pair exists from the moment the assignment is distributed. Keying on it means the record Salesforce holds for a fellow who has not started is the same record that later carries their grade, with no re-keying when the row appears.

**How the grid is built.** The collection loads every distributed assignment and every active enrollment, forms the pairs where the enrollment's program is the assignment's course's program, and overlays the `submissions` rows on top by `(assignmentId, studentId)`. A pair with a row takes the row's status, grade fields, and `updatedAt`. A pair without one is `notStarted` with every grade field null, and its `updatedAt` is the later of the assignment's and the enrollment's — so a newly distributed assignment produces a page of new records, and a fellow joining late produces one record per assignment already out.

**Only active enrollments are synthesised.** A removed fellow's real rows are sent — the work they did happened — but no `notStarted` records are invented for assignments distributed after they left.

**Team work is one record per member.** Every member of a team keeps their own `submissions` row carrying the team's grade, so the pair `(assignment, enrollment)` is unique for each of them and the grid needs no special case.

**Status is collapsed to four values.** This application's `SubmissionStatus` has eight, several of which describe the grading pipeline rather than the work: `DRAFT_READY`, `GRADING_FAILED`, and `NEEDS_MANUAL_REVIEW` all mean "handed in, not yet graded" to anyone outside it. The mapping: `NOT_STARTED` → `notStarted`; `ACCEPTED` → `inProgress`; `SUBMITTED`, `RESUBMITTED`, `DRAFT_READY`, `GRADING_FAILED`, `NEEDS_MANUAL_REVIEW` → `submitted`; `GRADED` → `graded`. Make maps those four onto the picklist's exact spelling.

A grade is present only once released: `status = GRADED` with `gradedAt` set, which is exactly what `sharedAfterGrade` in `lib/submissions/team.ts` writes. Work graded but not yet released lives in `grading_drafts` and never appears here.

`lateness` comes from `lateness()` in `lib/submissions/hand-in.ts`, which compares the hand-in instant against the deadline and then against any agreed extension, returning one of three words. It is reused because it is the single definition every screen already draws from, and a second spelling would let the feed disagree with the gradebook about the same piece of work.

### Records: GCF attempts

One per attempt, both kinds, as an Artifact under a Program Enrollment that also names the fellow's Contact. The Contact is the person and never changes; the Program Enrollment is the choice described below.

```
externalId          gcf_attempts.id
enrollmentId        the fellow's most recent enrollment's externalId
contactId           profiles.id, the fellow's Contact
kind                PROCTORED | MOCK
score               gcf_attempts.score
scorePossible       gcf_attempts.score_possible, null on every PROCTORED row
takenOn             gcf_attempts.taken_on as YYYY-MM-DD
integrityFlagged    gcf_attempts.integrity_flagged
resultUrl           gcf_attempts.result_url, may be null
updatedAt
```

**Which enrollment.** An attempt belongs to a person and carries no program, because CodeSignal has no notion of a cohort; an Artifact belongs to a Program Enrollment. The collection names the fellow's most recently created enrollment. For nearly everyone that is their only one. For a fellow who repeats a term, every attempt — including those sat during the earlier term — moves under the new enrollment, which is a known simplification chosen over a date-based rule that has no answer for a program with no dates set.

**The two kinds are different quantities and must never be averaged together.** A proctored attempt reports a scaled score in the 200–600 band, calibrated across correctness, speed, and question weight, with no maximum — the figure shared with employers. A mock reports raw test-case correctness at 300 points per task, so a real export carries maxima of 300, 900, 1200, and 1800. Both arrive in `score`, and `kind` separates them. Two consequences for Salesforce, both to settle before the first run: the Artifact's Max Score field must be nullable, or every proctored row fails validation; and `kind` must be a field reports can filter and group by, because a report that averages Score across both kinds produces a meaningless number.

### Test students are excluded from every collection

Every query filters on `profiles.test_student_number IS NULL`. Test students exist so staff can see the application as a fellow sees it; their enrollments, registrations, grades, attendance, and assessment results are fabrications and must never reach a system of record. Screens that draw a whole roster already filter on this column, and the feed does the same — including in `enrollments`, so a test student is never stamped onto a Contact.

## Authentication

A single bearer token, sent as `Authorization: Bearer <token>`, held in the `SALESFORCE_FEED_TOKEN` environment variable. The comparison runs over the SHA-256 digests of both sides with `crypto.timingSafeEqual`, because that function throws when the buffers differ in length and hashing first makes them equal in length regardless of what was sent.

A missing or wrong token is a 401 with a one-line plain-text body that does not say which part was wrong. Nobody on the other end would read a helpful message, and a message explaining the failure helps somebody probe the endpoint. The calendar feed answers the same way for the same reason.

One token: there is one caller with one purpose. When Coaching Conversations are added they are worth a second token, because a note a fellow cannot read is more sensitive than a grade they can, and a separate token is what lets Make read grades without being able to read notes.

**No OAuth 2.0 and no basic authentication.** OAuth would mean this application runs an authorization server for a single machine client; basic authentication would mean inventing a username and password for a caller that is not a person. A shared secret in a header is what the GitHub webhook and the calendar feed already use here.

`lib/supabase/proxy.ts` excludes `/api` from the sign-in redirect, so a request with no session cookie reaches the route handler instead of an HTML login page. That exclusion exists for the GitHub webhook and needs no change.

**No rate limit.** Each request runs one or two queries over small tables and returns at most 500 records. `lib/audit/rate-limit.ts` guards the operations that spend money at Anthropic and E2B; this spends a query.

## No schema change

The design adds no column and no table. Every identifier it needs is a primary key or a pair of them, every timestamp it needs is already maintained, and every Salesforce Id lives in Salesforce.

## What Make does

Two scenarios.

**Setup, run once per program and again whenever the roster changes.** Read `programs`; for each, find the Salesforce Program by name and term and write the program's `externalId` into its External Id field. Read `enrollments`; for each, find the Program Enrollment whose Program carries that `programId` and whose Contact has that `studentEmail`, and write the enrollment's `externalId` into the Program Enrollment's External Id field and the `studentId` into the Contact's. A fellow with no match goes to an error branch that produces a list for somebody to resolve by hand — a fellow whose Salesforce email differs from the one they sign in with, most likely. This is the only place in the integration that matches on a name or an address.

**Sync, on a schedule.** Walk the collections in the order listed, each from its own stored cursor, upserting every record by `externalId` and naming parents by theirs. The cursor for a collection advances only after the whole page has been written; a page with a failed record stops the run, leaves the cursor where it was, and lands in Make's incomplete executions for retry — where the upsert makes replaying the page harmless. The failure to expect is a parent not yet written, which the ordering prevents within a run and the retry heals across runs.

Whether Make's native Salesforce "Upsert a Record" module accepts a parent named by External Id is not confirmed. Make's Salesforce "Make an API Call" module sends the REST request that does, so the scenario uses whichever of the two works against the sandbox.

## Cost of the first run

Make bills per operation, and the first poll of each collection walks the entire history. Get the counts before that run — a read against the deployment database:

```sql
select 'programs' as t, count(*) from programs
union all select 'enrollments', count(*) from enrollments
union all select 'courses', count(*) from courses where published_at is not null
union all select 'registrations', count(*) from courses c join enrollments e on e.program_id = c.program_id where c.published_at is not null
union all select 'assignments', count(*) from assignments where distributed_at is not null
union all select 'sessions', count(*) from attendance_sessions
union all select 'attendance', count(*) from attendance_records
union all select 'submissions (grid)', count(*) from assignments a join courses c on c.id = a.course_id join enrollments e on e.program_id = c.program_id where a.distributed_at is not null and e.status = 'ACTIVE'
union all select 'gcf', count(*) from gcf_attempts;
```

The submissions grid and attendance are the two to watch — the grid is every distributed assignment times every active fellow, and attendance runs to roughly 1,800 rows per term. If the total exceeds the plan's monthly operation allowance, run the backfill one collection at a time across billing periods. The cursor makes that possible without code changes. Note what `since` selects on: when a record last changed, not which program it belongs to.

## Testing

Unit tests, no database:

- The cursor predicate over a table: a position at an exact timestamp returns the rows after it and not the row at it; an absent `since` returns everything; `after` without `since` is rejected.
- The in-memory walk over a computed collection: every pair appears exactly once across pages; a pair whose parent changes moves past a cursor that had passed it.
- The registrations pairing: one per course per enrollment within a program, none across programs, removed enrollments included.
- The submissions grid: a pair with a row takes the row's fields; a pair without one is `notStarted` with null grade fields; a removed enrollment yields its real rows and no synthesised ones; each team member yields their own record.
- The status collapse, all eight inputs.
- Each row mapper with every nullable column null, and the civil-date fields as `YYYY-MM-DD` strings.
- The GCF enrollment choice with one enrollment and with two.
- The token comparison: right token, wrong token of equal length, wrong token of different length without throwing.

Integration tests against the test database, through `npm run test:integration`, one per collection: walking the whole collection through the cursor at a small page size returns every record exactly once; a row updated mid-walk is returned again; test students appear nowhere; unreleased grades carry null grade fields.

## Deploying it

**Before the code deploys.** Add `SALESFORCE_FEED_TOKEN` to the Vercel project for the deployment environment. Without it the route rejects every request — the safe direction to fail, but not an obvious one to diagnose.

**Nothing else runs before or after.** There is no migration and no storage change.

**Can the previous release survive this?** Yes. The change is one new route at a path nothing else serves. No route is removed, no procedure changes shape, no column is touched, and a browser tab loaded before the deploy is unaffected.

**Is rollback still available?** Yes, and it is a code rollback with nothing left behind.

**What to check once it is live.**

- `curl` each collection with the token and confirm a 200 with a `records` array; without the token and with a wrong one, confirm a 401.
- Follow `cursor` on the largest collection to the end and confirm `hasMore` reaches false.
- Confirm no record in any collection carries a test student.
- Run the setup scenario against the sandbox and review the unmatched list before the sync scenario runs at all.
- Run each sync collection once with `limit=5` before letting the backfill go.

**When not to ship this.** The code is safe at any hour — it adds a route nothing else calls and touches no fellow's path through the application. Make's first run is the part to time: a backfill of several thousand records consumes a large share of a monthly operation allowance in one go.

## Deferred: storing Salesforce Ids here

The sync never needs a Salesforce Id on this side, and none is stored. What a stored Id would buy is a roster badge saying whether a fellow has reached Salesforce, and a link from a grade or an attendance record to the Salesforce record it became, because a Salesforce Id is a URL.

If either is wanted, it is an addition rather than a change: a nullable `salesforce_id` column on the row-backed tables that want it, and a write endpoint Make posts each new record's Id back through after an upsert. The External Id stays the mechanism — the upsert remains idempotent and parents still resolve by identifier — and the stored Id is read only by the screen drawing the badge or the link. It is deferred because the two collections with no row, Class Registrations and unstarted Assignment Submissions, have nowhere to hold an Id, and because nothing about the first version needs it.

## What is still open on the Salesforce side

None of these blocks the work described above, and all of them block the integration actually working:

- An External Id field, unique, on every object in the table at the top — ten objects now, including Contact, Program, and Program Enrollment, and Coaching Conversation when it is added.
- The exact picklist spellings for Assignment Submission status and for Assignment type.
- Whether the Artifact object's Max Score field is nullable, and whether `kind` is reportable on it.
- Which fields, if any, are required on Class, Class Registration, Session, and Attendance that this application has no value for.
- Whether any existing Flow or validation rule on those objects reacts badly to an integration writing them — discoverable in Setup, per object, before the first write.
