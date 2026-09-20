# The Salesforce feed

A read-only HTTP interface that lets Make.com pull three kinds of record out of this application and write them into Salesforce. Make holds the Salesforce credentials and performs every write; this application never speaks to Salesforce and holds no Salesforce secret beyond one identifier per fellow.

## What this is for

Marcy keeps its system of record in Salesforce. Three kinds of thing happen in this application that Salesforce needs to know about: a grade is released on a piece of work, a fellow is marked present or absent on a program day, and a fellow sits the General Coding Framework. Today each of those reaches Salesforce by somebody typing it in, or not at all.

Make.com sits between the two systems. On a schedule it calls this application, receives the records that have changed since it last asked, and upserts each one into Salesforce against an external identifier. Because Make owns the Salesforce half, this application needs no Connected App, no certificate, no JWT bearer flow, and no knowledge of the Salesforce object model. What it needs is one authenticated endpoint that can answer "what has changed since this moment" for each of the three collections.

Coaching notes are a fourth collection that will be added the same way once the first three are running. The design below is shaped so that adding it is one entry in a table.

## How a record reaches Salesforce

Every record this application serves is identified by the primary key of the row it came from, which is a UUID. Salesforce holds that UUID in an External Id field on the target object, and Make upserts against it rather than inserting. That single decision is what makes the rest of the design small: sending the same record twice is harmless, so this application does not have to track what Salesforce has already seen, and Make does not have to acknowledge anything.

**Requirement on the Salesforce side.** Each of the three target objects needs a text field marked External Id and Unique, holding this application's UUID. Without it, a retried Make execution creates duplicate records. This is the one piece of Salesforce configuration the integration cannot work without.

## Finding what has changed

Each of the three tables carries an `updatedAt` column marked `@updatedAt`, which Prisma writes on every update without any call site asking it to. That column is the whole of the change-detection mechanism.

Make stores the position it reached and sends it back on the next call as two query parameters: `since`, an ISO 8601 instant, and `after`, the UUID of the last row it saw at exactly that instant. The endpoint returns rows ordered by `(updatedAt, id)` ascending, starting immediately after that position:

```ts
where: since
  ? {
      OR: [
        { updatedAt: { gt: since } },
        { updatedAt: since, id: { gt: after } },
      ],
    }
  : {},
orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
take: limit + 1,
```

The `after` tiebreaker matters because a bulk update writes an identical `updatedAt` to many rows at once, and a cursor holding only a timestamp would either skip the rest of that group or return it forever.

**No synchronization columns are added to any table.** A `PENDING` flag would have to be reset by every write path in attendance and in the GCF — an instructor overriding a status, a note added to an excused absence, an import merging into a hand-entered score — and the path that forgets produces a change that silently never reaches Salesforce. The `updatedAt` column already carries that obligation and cannot forget it.

`submissions` carries three columns this design does not read: `salesforce_sync_status`, `salesforce_record_id`, and `salesforce_synced_at`. Nothing needs them, because an upsert against an External Id makes a resend harmless and therefore makes a record of what has already been sent unnecessary. They stay in place; removing them is a separate migration with no bearing on this work, and it wants the schema deployed before the `DROP` for the same reason the legacy submission columns did.

**Make should overlap its window.** Configure the scenario to request `since = lastSeen - 5 minutes` rather than exactly `lastSeen`. A row whose transaction commits just after a query ran would otherwise be stepped over. The upsert makes the overlap free.

## The endpoints

One route file serves all three collections:

```
app/api/integrations/salesforce/[collection]/route.ts
lib/integrations/salesforce/feed.ts
```

`GET /api/integrations/salesforce/{collection}?since=&after=&limit=`

| Collection | Source | Rows served |
|---|---|---|
| `graded-submissions` | `submissions` | `status = GRADED` and `gradedAt` is not null |
| `attendance` | `attendance_records` | every record |
| `gcf-attempts` | `gcf_attempts` | every attempt, both kinds |

`limit` defaults to 200 and is capped at 500. An unknown collection is a 404. `since` may be sent alone, which starts the walk at the beginning of that timestamp; `after` sent without `since` is a 400, because a tiebreaker with nothing to break the tie against is a caller mistake rather than a position.

The route handler checks the token, parses the cursor, looks the collection up in a table, runs its query, and writes the envelope. Each entry in that table holds two things and nothing else: a Prisma query and a function turning one row into one flat record. Everything else — authorization, cursor parsing, paging, the envelope, error shapes — is written once in `feed.ts` and shared. Three separate route files would have meant three copies of each of those, free to drift apart.

### The envelope

```json
{
  "records": [ … ],
  "hasMore": true,
  "cursor": { "since": "2026-09-20T14:02:11.482Z", "after": "b3f1…" }
}
```

`cursor` is the position to send on the next call, and it is null when `hasMore` is false. Returning it explicitly rather than making Make read the last element of the array saves a module in each of the three scenarios, on every run.

`hasMore` is computed by requesting one row more than `limit` and discarding it, which answers the question without a second count query.

All timestamps are ISO 8601 in UTC. Civil dates — `attendance_sessions.date` and `gcf_attempts.taken_on`, the only two `@db.Date` columns in the schema — are emitted as plain `YYYY-MM-DD` strings through `schoolDayFromColumn` in `lib/school-time.ts`. That function reads the UTC parts of the value Prisma returned and takes the first ten characters; it is reused rather than rewritten because the reasoning about why UTC rather than local is the valuable part of it, and because it lives in the same layer as the feed with no boundary to cross.

### Records: graded submissions

One record per row, which means one per fellow including each member's mirror of a team grade. That is the grain the Salesforce Assignment Submission object expects — a grade belongs to a person, not to a team.

```
submissionId          submissions.id — the External Id
salesforceContactId   profiles.salesforce_contact_id, may be null
studentEmail          profiles.email
studentName           profiles.display_name
assignmentId          assignments.id
assignmentTitle       assignments.title
courseName            courses.name
programName           programs.name
score                 submissions.final_score
scorePossible         submissions.final_score_possible
isComplete            submissions.is_complete
lateness              "onTime" | "extended" | "late"
gradedAt              submissions.graded_at
feedbackMarkdown      submissions.feedback_markdown
updatedAt             submissions.updated_at
```

`lateness` is computed rather than stored. It comes from `lateness()` in `lib/submissions/hand-in.ts`, which compares the hand-in instant against the deadline and then against any agreed extension, returning one of three words. That function is reused rather than restated because it is the single definition every screen in the application already draws from, and a second spelling of the rule would let the feed disagree with the gradebook about the same piece of work.

Work that has been graded but not released lives in `grading_drafts` and never appears here. A released grade is exactly what `sharedAfterGrade` writes: `status = GRADED` with `gradedAt` set.

### Records: attendance

One record per row, which is one fellow on one program day.

```
attendanceRecordId    attendance_records.id — the External Id
salesforceContactId   profiles.salesforce_contact_id, may be null
studentEmail          profiles.email
studentName           profiles.display_name
programName           programs.name
programTerm           programs.term
date                  attendance_sessions.date as YYYY-MM-DD
status                PRESENT | LATE | ABSENT | EXCUSED
source                SELF_CHECK_IN | INSTRUCTOR | FINALIZED
checkedInAt           attendance_records.checked_in_at, may be null
note                  attendance_records.note, may be null
enrollmentStatus      ACTIVE | REMOVED
updatedAt             attendance_records.updated_at
```

**Records belonging to a removed enrollment are included.** Removing somebody from a roster does not unmake the mornings they attended, and Salesforce should hold what happened. `enrollmentStatus` travels with each record so that a report on the current roster can exclude them without this application having to guess which reports want that.

**`EXCUSED` still counts as missed.** The note explains the absence rather than cancelling it. Whoever builds the attendance report in Salesforce needs to know this, because the alternative reading produces a different attendance rate from the one this application shows, and a figure quoted to a funder should not depend on which system it was read from.

### Records: GCF attempts

One record per attempt, both kinds.

```
gcfAttemptId          gcf_attempts.id — the External Id
salesforceContactId   profiles.salesforce_contact_id, may be null
studentEmail          profiles.email
studentName           profiles.display_name
kind                  PROCTORED | MOCK
score                 gcf_attempts.score
scorePossible         gcf_attempts.score_possible, null on every PROCTORED row
takenOn               gcf_attempts.taken_on as YYYY-MM-DD
integrityFlagged      gcf_attempts.integrity_flagged
resultUrl             gcf_attempts.result_url, may be null
updatedAt             gcf_attempts.updated_at
```

**The two kinds are different quantities and must never be averaged together.** A proctored attempt reports a scaled score in the 200–600 band, calibrated across correctness, speed, and question weight, with no maximum — it is the figure shared with employers. A mock attempt reports raw test-case correctness at 300 points per task, so a real export carries maxima of 300, 900, 1200, and 1800 in the same column. Both arrive in the same `score` field, and `kind` is what separates them.

Two consequences for the Salesforce side, and both need settling before the first run:

- The Max Score field on the Artifact object **must be nullable**, because `scorePossible` is null on every proctored attempt. If it is required, every proctored row fails validation on write.
- `kind` must be a field that reports can filter and group by. A report that averages the Score field across both kinds produces a meaningless number, and it is the kind of number that ends up in front of an employer or a funder.

### Test students are excluded from all three feeds

Every query filters on `profiles.test_student_number IS NULL`. Test students exist so that staff can see the application as a fellow sees it; their grades, their attendance, and their assessment results are fabrications and must never reach a system of record. Screens that draw a whole roster already filter on this column themselves, and the feeds do the same.

## Authentication

A single bearer token, sent as `Authorization: Bearer <token>`, held in the `SALESFORCE_FEED_TOKEN` environment variable. The comparison runs over the SHA-256 digests of both sides with `crypto.timingSafeEqual`, because that function throws when the two buffers differ in length and hashing first makes them equal in length regardless of what was sent.

A missing or wrong token is a 401 with a one-line plain-text body that does not say which part was wrong. There is nobody on the other end of this who would read a helpful message, and a message explaining the failure is a message that helps somebody probe the endpoint. The calendar feed answers the same way for the same reason.

One token rather than three: there is one caller with one purpose, and three tokens would be three environment variables to rotate together. When coaching notes are added, they are worth their own token — a note a fellow cannot read is more sensitive than a grade they can, and a separate token is what would let Make read grades without being able to read notes.

**No OAuth 2.0 and no basic authentication.** OAuth would mean this application runs an authorization server for a single machine client. Basic authentication would mean inventing a username and password for a caller that is not a person. A shared secret in a header is the shape the GitHub webhook and the calendar feed already use here.

`lib/supabase/proxy.ts` excludes `/api` from the sign-in redirect, so a request arriving with no session cookie reaches the route handler instead of being answered with an HTML login page. That exclusion already exists for the GitHub webhook's sake and needs no change.

**No rate limit.** The endpoint runs one indexed query and returns at most 500 rows. `lib/audit/rate-limit.ts` guards the operations that spend money at Anthropic and E2B; this one spends a query.

## Identity: one new column

```prisma
/// The Contact this fellow is in Salesforce, stored once rather than matched on.
salesforceContactId String? @map("salesforce_contact_id")
```

On `Profile`, nullable.

All three feeds resolve to a `Profile`, and without this column each record would carry only an email address for Make to match against a Contact. Matching on email breaks whenever an address changes, needs read access on Contact for the integration user, and fails silently — a record that matches nothing is written nowhere, and nobody finds out. Storing the Contact Id once means Make writes to an identifier it already holds.

The column is nullable because it is filled in over time, and the feeds send it as null until it is. A record arriving at Make with a null `salesforceContactId` is one the scenario should route to an error branch rather than attempt to write, so that unmatched fellows are visible rather than skipped.

**This is the only schema change in the whole design.**

## Cost of the first run

Make bills per operation, and the first poll of each collection walks the entire history. Get the real counts before that run:

```sql
select 'submissions' as t, count(*) from submissions where status = 'GRADED' and graded_at is not null
union all select 'attendance', count(*) from attendance_records
union all select 'gcf', count(*) from gcf_attempts;
```

Attendance is the one to watch: it runs to roughly 1,800 rows per term, against 74 GCF attempts per term. If the total exceeds the plan's monthly operation allowance, run the backfill one collection at a time across two billing periods, or start the attendance cursor at a recent date and walk the older records through in a later period. Note what that cursor selects on: `since` filters by when a row last changed, not by which program it belongs to, so a recent start date excludes old records only until somebody edits one. The cursor makes either possible without code changes.

## Testing

Unit tests, no database:

- The cursor predicate: a position at an exact timestamp returns the rows after it and not the row at it; an absent `since` returns everything from the beginning; an `after` with no `since` is rejected.
- Each of the three row mappers: a fully populated row, and a row with every nullable column null.
- The submissions mapper returns each of the three lateness verdicts for the hand-in, deadline, and extension combinations that produce them. `lateness` itself is already covered where it lives.
- The token comparison accepts the right token, rejects a wrong one of the same length, and rejects one of a different length without throwing.

Integration tests against the test database, one per collection, through `npm run test:integration`:

- Walking the whole table through the cursor returns every row exactly once, at a page size small enough to force several pages.
- A row updated while the walk is in progress is returned again rather than skipped, because its `updatedAt` moves past the cursor.
- Test students appear nowhere in any feed.
- Unreleased grades appear nowhere in `graded-submissions`.
- A civil date is returned as the same `YYYY-MM-DD` string that was written, with the process running in a zone west of UTC.

## Deploying it

**Before the code deploys.** Apply the migration to the deployment database:

```
npm run db:deploy:deployment
```

A committed migration is not an applied one. The migration is authored with `prisma migrate diff` following the recipe at the bottom of `prisma.config.ts` — never `prisma migrate dev`, which offers to reset the database. It adds one nullable column to an existing table, so it needs no privilege block and no row level security statement; those are for new tables.

**Also before the code deploys.** Add `SALESFORCE_FEED_TOKEN` to the Vercel project. Without it the route rejects every request, which is the safe direction to fail but not an obvious one to diagnose.

**Can the previous release survive this?** Yes. Everything here is additive: one new route at a path nothing else serves, and one nullable column the running code does not read. No route is removed, no procedure changes shape, and a browser tab loaded before the deploy is unaffected. The two halves can go in either order and do not need splitting across releases.

**Is rollback still available?** Yes. Rolling the code back leaves a nullable column nobody reads, which costs nothing and can stay there until the code returns.

**`ALTER TABLE ADD COLUMN` on `profiles` is instant.** Adding a nullable column with no default does not rewrite the table on any Postgres version this runs on, so it takes no meaningful lock. That matters because `profiles` is read on nearly every authenticated request through `profileProcedure`.

**What to check once it is live.**

- `curl` each of the three collections with the token and confirm a 200 with a `records` array.
- `curl` one of them without the token and confirm a 401, and with a wrong token and confirm a 401.
- Confirm that following `cursor` to the end terminates and that `hasMore` eventually reads false.
- Confirm no record in any response carries a test student's name.
- In Make, run each scenario once with a small `limit` before letting the full backfill go.

**When not to ship this.** The code is safe at any hour — it adds a route nothing else calls. Make's first run is the part to time: a backfill of several thousand attendance records consumes a large share of a monthly operation allowance in one go, and it should not be started on a day when another scenario needs those operations. Nothing here touches the fellow's path through the application, so due dates are not a constraint for the deploy itself.

## What is still open on the Salesforce side

None of these blocks the work described above, and all of them block the integration actually working:

- An External Id field, unique, on each of the three target objects.
- Whether the Artifact object's Max Score field is nullable.
- Whether `kind` is reportable on the Artifact object.
- Which Salesforce object attendance records map to. The Assignment Submission object is confirmed for grades and the Artifact object is confirmed for the GCF; attendance has no named target yet.
- Getting the Contact Id for each fellow, to populate `profiles.salesforce_contact_id` before Make's first run.
