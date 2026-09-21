# Attendance on a schedule

A program can say when it meets: a first day, a last day, which weekdays, and what time class starts. Saving that makes one session for every meeting day that has not happened yet, and each session carries its clock from the moment it is made: check-in opens two hours before class, lateness is measured from the class start, and the code stops working eight hours after it. Nobody presses Start. Instructors remove the days the program will not meet, one at a time or as a stretch, and one printable page lists the coming days and their codes so that the people who open the building can hand out today's code without an instructor present.

## What this is for

Today a session's clock begins when an instructor presses Start check-in. Lateness is measured from that press, and the code is refused until it happens. Two facts about how the building runs make that the wrong moment. Fellows often arrive well before class and cannot sign in until an instructor opens the day, so the people who are most reliably early are the ones who wait. And the instructor is not always in the building when the code needs to be at the front desk, so on those mornings nobody can open the day at all.

Both problems come from one fact, which is that a person's press is what a session measures from. This design replaces the press with a schedule the program declares once. A program meets nearly every weekday for nine months, so the schedule is stated as a range and the exceptions are removed, rather than the other way round. Everything else in attendance, including the four-digit code, the arrival records, the overrides, and the sweep that writes absences, is unchanged.

## The schedule

`Program` gains four columns that are set together or not at all:

| Column | Type | Meaning |
| --- | --- | --- |
| `attendanceStartsOn` | `Date`, nullable | The first day the program meets. |
| `attendanceEndsOn` | `Date`, nullable | The last day the program meets. |
| `attendanceWeekdays` | `Int[]`, empty when unset | Which weekdays it meets, Sunday 0 through Saturday 6. |
| `attendanceStartsAt` | text, nullable | What time class starts, in Brooklyn, written `"09:30"`. |

A `CHECK` constraint asserts that the three nullable columns are null together and that the weekday list is empty exactly when they are null, so a program either has a whole schedule or none. A second `CHECK` asserts the `HH:MM` shape and that every weekday is between 0 and 6. The end day must not be before the start day.

A program with no schedule behaves exactly as today, with the Start check-in button and the prepared phase as they are. The two date columns cross the wire as `"YYYY-MM-DD"` strings, by the rule `lib/school-time.ts` states for every school day.

The weekday numbering is what `getUTCDay` returns for a school day parsed at UTC midnight, which is how the pure schedule module decides which weekday a `"YYYY-MM-DD"` string falls on without asking a timezone question.

**A day is a meeting day** when the program has a schedule, the day lies between the first and last day inclusive, and its weekday is in the list. That predicate, and the list of meeting days between two dates, live in a new pure module `lib/attendance/schedule.ts`, tested against fixed dates.

## Saving a schedule makes and removes days

The Attendance screen's Schedule tab holds the block: "Class meets", with two date inputs, seven weekday checkboxes with Monday to Friday preselected, and a time input. It sits there rather than on the program's settings screen because the rule and the exceptions to it are one job — see the Screens section. All four save together through a new `programs.setAttendanceSchedule` procedure, which also accepts null to clear the schedule.

**The save changes exactly the days whose meeting status changed.** With the old schedule and the new one both in hand, the procedure, in one transaction:

1. **Makes** a session for every day from today through the new last day that is a meeting day under the new schedule, was not one under the old, and has no session yet. Today is included so that a schedule saved on a Monday morning covers that morning.
2. **Removes** every session dated after today whose day was a meeting day under the old schedule and is not one under the new, unless a fellow has checked themselves into it, which a day after today cannot have had. Today is excluded because today's session may hold check-ins; removing today is a deliberate act on the day screen.
3. **Rewrites the clock** of every session dated after today to the new start time on its day, with the backstop eight hours later and the lateness rule copied again. Today's session is not rewritten, because it may already hold check-ins measured against the old time; an instructor who needs today moved edits it on the day screen, which recomputes statuses as it does now.

A day an instructor removed as a holiday is a meeting day under both the old schedule and the new, so step 1 never brings it back. Extending the last day makes only the new stretch. Adding Fridays makes only the Fridays. Moving the start time from 9:30 to 10:00 in March rewrites every remaining day and creates nothing, and the codes already printed stay right, because a code depends only on the session's secret and id.

The first save, with no old schedule, makes every meeting day from today onward. Days already past are not invented backwards: they either happened by hand or did not happen.

A second procedure, `programs.attendanceSchedulePreview`, answers the same question without writing: given the four inputs it returns the days it would make, the days it would remove, and the days it would keep because somebody has already checked in. The block calls it as the inputs change and shows "Saving makes 148 days and removes 0" above the button. A query rather than a flag on the mutation, so a keystroke can never write anything; both call one `resolveScheduleChange`, which is what stops the sentence above the button being computed by different arithmetic from the button.

`programs.setAttendanceLateAfter` also rewrites `lateAfterMinutes` on every session dated after today, so a change to the lateness rule reaches the days already made. Days already begun keep what they ran under, which is the rule `AttendanceSession.lateAfterMinutes` already states.

## What a scheduled day is

A session made from a schedule is written with `startedAt` set to its day at the start time, computed with `instantAtSchoolClock`, and `endsAt` eight hours after it. `startedById` stays null, which now means the schedule opened the day rather than a person. The meaning of `startedAt` in the schema comment changes from "when check-in opened" to "when the day starts, which is what lateness is measured from; written by a press of Start, or in advance from the program's schedule."

Under a schedule the pending phase does not occur: every session the program makes has a clock. `attendance.prepare` accepts an optional `day`, today or later, and for a program with a schedule writes the scheduled clock for that day whatever its weekday, which is how a Saturday make-up day or a removed day is made again. For a program without a schedule it still makes today's pending session and nothing else. `attendance.start` keeps its shape; for a program with a schedule it writes the scheduled start for the day rather than the current instant, so an instructor pressing it at 9:40 on a day that had been removed gets a session that measures lateness from 9:30, and a past day written up after the fact gets that day's clock, already lapsed, ready for statuses to be set.

The rule that a check-in before `startedAt` counts as present already exists in `statusForCheckIn`, and is now the normal case rather than a correction case.

`sweepStale` keeps its rule of selecting sessions dated before today, so days made ahead are never finalized or deleted by it.

**What closes a day's books changes, and it has to.** Today the absences a lapsed session left implicit are written by `sweepStale`, which runs from `prepare` and from `start`. Under a schedule nobody presses either, so nothing would ever write them: the grid is a pure read and writes nothing. The figures would still be right, because `summarize` counts a settled session with no record as missed, but the rows would never exist, and a fellow's own calendar would say "nothing was recorded for you" about a day they missed rather than saying they were absent.

So `checkIn` sweeps as well, in its own transaction before anything else it does. The first fellow to check in on Tuesday closes Monday's books. That fits the rule the feature already runs on, which is that the next person through does the work, and it is the one write that happens reliably on every day the program meets. It costs the first check-in of the morning one indexed query returning no rows on every subsequent call that day. A day nobody attends at all is swept by the next day that somebody does. `setAttendanceSchedule` and `removeDays` sweep too, being the other moments an instructor touches the program's days.

## When a code is accepted

`lib/attendance/window.ts` gains one constant, `OPENS_BEFORE_START_MINUTES = 120`, and one rule: a session accepts check-ins only from two hours before `startedAt`. `isAcceptingCheckIns` adds that comparison to the ones it has. A session an instructor started by hand passes it trivially, because its start is the moment of the press.

`SessionState` gains `"scheduled"`, meaning the session has a start but the moment two hours before it has not arrived. `sessionStateOf` returns it after `pending` and before the ended and lapsed checks. It is a distinct state rather than a reuse of `pending` because the two word differently on every screen: a pending session has no time to print, and a scheduled one has three.

The per-session attempt ceiling in `checkIn` counts failed codes since the session's start. It changes to count from the moment the window opens, so early guesses are bounded the same way late ones are.

A fellow who types the code before the window opens is refused before the attempt ceilings and without a failure event, on the branch that today refuses a pending session, and the message names the time: "Check-in for the program opens at 7:30 AM." A fellow who types it during the window is marked present or late by the existing rule.

The code can be read by an instructor as soon as the session exists, which is today's behaviour for a prepared session. Holding a code is not enough on its own to check in from home before 7:30 AM on its day, and is not enough on any other day at all, because `checkIn` looks up today's session by date and nothing else. A photographed sheet of the coming codes is worth exactly one early check-in per day, recorded with its minute, which is the same class of problem as a code texted home and is answered the same way: the arrival time is on the record, and a code that has got out is replaced.

## Removing days

**One day** is removed on the day screen with the delete that exists, whose guard is unchanged: refused once anybody has checked themselves in, allowed otherwise. The absences the sweep writes do not count against it, so a holiday nobody removed in time, which opened at 7:30, took no check-ins, and was finalized with everyone absent by the next morning's first check-in, is removed afterwards and takes the absences with it. That column of red on the term grid is how a forgotten holiday announces itself, and a snow day is the same story.

**A stretch of days** is removed through a new `attendance.removeDays` procedure, an instructor `programProcedure` taking `from` and `to`. It deletes every session of the program dated from today onward within that range that has no self check-in, writes one `ATTENDANCE_SESSIONS_REMOVED` event naming the whole stretch, and returns the days removed and the days kept because somebody had checked in. One event rather than one per session, because a fortnight of winter break would otherwise bury every other event of that afternoon; `ATTENDANCE_SESSION_DELETED` stays the value for removing a single day, where a session id is the subject and worth having. The Schedule tab offers it in the calendar's own heading as **Remove days**, with two date inputs, and reports both lists. Choosing a first day carries the last day with it until somebody chooses one, so removing a single day costs one field; once the last day has been chosen the first stops dragging it, or correcting the start of a range would throw away the end.

A day removed by mistake is made again on its day screen, which calls prepare with that day.

## Days that have not happened yet, on every screen

This is the part of the design that the two-week version mostly avoided and this one cannot: rows now exist for days months ahead, and three places decide whether a session counts by asking whether it is open.

**The rate and the drift list.** `summarize` skips a session for a fellow with no record in it only while the session's `open` flag is true; a session that is neither open nor recorded counts as missed. A scheduled day must not. The flag is computed in three places, in `history`, `myWeek`, and `myHistory`, and each broadens it to "not yet settled": open, pending, or scheduled. The field keeps its name, and its doc comment on `SummarySession` says what it now means. A fellow excused ahead of time on a scheduled day counts from the moment the excusal is set, which is what an open session already does with a record.

**Which sessions the term grid loads.** `history` returns only sessions dated today or earlier, so the instructor's term grid and the export it feeds show the days that have happened and today, and nothing ahead. A new `attendance.upcoming` procedure, an instructor `programProcedure`, returns the program's sessions dated today or later with their day, start, window bounds, state, and code. The Schedule tab's calendar reads it for the days ahead and merges them with `history`'s days behind, which is the one place wanting both halves; the printable page reads it for a three-week window from a chosen start date.

**Cells.** `CellKind` gains `"upcoming"`: a hollow square in the muted tone with the label "Class meets this day", drawn for a session whose day is after today and for today's session while its state is scheduled. `kindOf` decides it from a flag on the entry rather than from a clock, so the cell modules stay free of `now`. Dashed remains the day the program did not meet.

**The student's week and calendar.** `myWeek` and `myHistory` already load every session with a start, which now includes the days ahead. The week's coming squares render as upcoming; the check-in box keys off today's session being open, as it does now, and before the window opens the row says "Check-in opens at 7:30 AM" in the place the box will go. `attendance.today` continues to return sessions whose `startedAt` is set, which now includes a scheduled one.

**The export.** It reads `history`, so it carries no day ahead of today.

## What instructors can do to a scheduled day

`teachableAttendanceSession` today refuses every act on a pending session, because a pending session holding records would be destroyed by the sweep. A scheduled session is never deleted by the sweep, so records on it are safe, and the refusals narrow:

- **Setting a status** is allowed on a scheduled day. An instructor can excuse a fellow for a day that has not come.
- **Ending** a day whose window has not opened is refused in words, because it would write every fellow absent for a morning none of them could attend yet.
- **Editing the start**, **extending**, **replacing the code**, and **deleting** work as they do today. Editing a day's start writes the new instant, and the two-hour window follows it.

## The screens

**Program settings** gains the "Class meets" block described above, with the make-and-remove sentence above its button, and a note that a change to the start time applies to every day that has not begun.

**The Attendance screen gains a third tab, Schedule**, holding everything about which days exist: the "Class meets" rule, the lateness rule beneath it, and then a calendar of the program's days, one month at a time with arrows to page through it, built on the `monthGrid` and `monthRange` helpers the fellow's own calendar already uses. Three squares and no fourth: a day **held**, whose books are closed, filled; a day **scheduled**, which is every day ahead and today until it lapses, hollow; and a blank square where the program does not meet. Today keeps a ring. Every day with a session links to that day's screen, which is where a status is corrected and where a single day is removed. **Remove days** and **Print the coming codes** sit above it.

The calendar is what an instructor reads to ask "did we meet, will we meet, is this day a mistake", and a holiday in the middle of a working week is a hole they can see. It carries no numbers: how many turned up is reported once, at the head of each column of the grid below, and a figure at the size of a calendar cell would be the same fact in two places with one of them illegible.

The tab sits last of the three because it is the least visited: taking attendance happens every morning and reading the record happens weekly, while this is opened at the start of a term and on the days it snows.

**The rule and its exceptions had been on two screens**, which is the split this tab closes. Declaring that the program meets weekdays until June was a settings act and cancelling Thursday was an attendance act, so maintaining one calendar meant two screens — and cancelling tomorrow's class meant a detour past the button that deletes the program. The program's settings screen keeps one sentence saying where they went.

**The grid gains a rate per day.** A row of figures at the top of its body, one per column, saying how much of the roster turned up that day — computed by `dailyRates` from the same summaries each fellow's row draws its letters from, so the heading and the letters beneath it cannot disagree. Its three rules are `summarize`'s: late counts as attendance, a fellow counts only from the day they enrolled, and test students are in no figure. A day with nothing settled prints a dash. The grid also scrolls vertically now with its date row frozen, while the rate row scrolls away with the fellows — what is held at the top is what each column *is*, and a reading of the rows belongs with those rows, which is the arrangement `gradebook-grid.tsx` uses for its Completed row.

A program without a schedule sees the calendar too: its held days are the mornings somebody started, and it simply has nothing scheduled ahead.

**The day screen** for a program with a schedule loses the distinction between Prepare and Start. Its empty state, which under a schedule means the day was removed or is outside the dates, offers one button, "Make a session for this day", which calls prepare with the day. A scheduled day's card says "Check-in opens at 7:30 AM, class starts at 9:30 AM, the code stops working at 5:30 PM", and once the window is open it shows the roster and the code card as an open session does. Programs without a schedule keep the Prepare and Start buttons unchanged.

**The projector page** shows the code for a scheduled session as it does for a pending one, with the line beneath it saying when check-in opens. Today its branches are pending, open, and everything else as closed, so the scheduled state has to be named there or the code disappears from the screen while the room fills.

**The printable page** is a new route, `app/present/attendance/[programId]/codes/page.tsx`, beside the projector page and under the same instructor-only loader. It takes the first day of the sheet as a `from` search parameter, defaulting to today, and lists every day from `upcoming` between that day and twenty days later — a window rather than a count, so a stretch broken by a holiday prints shorter rather than silently reaching further than the header claims. Two columns of day and code, read down the left and then the right, at a size that fits one page: the hours a code works are the same on every row and are stated once in the paragraph above, where they were a column repeating one sentence fifteen times. That paragraph also says to give out today's code only, and that a code the instructor replaces or a day they remove makes that row wrong. The date picker is a plain GET form carrying `print:hidden`, so it is on the screen and not on the paper, and the address records exactly which sheet was printed.

## Procedures, in one place

| Procedure | Change |
| --- | --- |
| `programs.attendanceSchedulePreview` | New. Counts what saving would do, and writes nothing. |
| `programs.setAttendanceSchedule` | New. Saves the four columns or clears them; makes, removes, and rewrites days as described. |
| `programs.setAttendanceLateAfter` | Also rewrites `lateAfterMinutes` on days after today. |
| `attendance.prepare` | Optional `day`, today or later. Writes the scheduled clock under a schedule. |
| `attendance.start` | Writes the scheduled start for the day under a schedule. |
| `attendance.checkIn` | Refuses before the window in words; ceiling counts from the window opening; sweeps earlier days first. |
| `attendance.history` | Sessions dated today or earlier only. |
| `attendance.upcoming` | New. Sessions dated today or later, with codes. The third reader of `codeSecret`, named in the column's comment. |
| `attendance.removeDays` | New. Deletes the days in a range from today onward that hold no self check-in. |
| `attendance.endSession` | Refused before the window opens. |
| `attendance.setStatus` | Allowed on a scheduled day. |
| `attendance.myWeek`, `myHistory` | The `open` flag means not yet settled; cells carry the upcoming flag. |

## What does not change

- The code, how it is derived, and how it is replaced.
- The eight-hour backstop, Extend, End, and reopening.
- How absences are written and when.
- The arrival averages, which now include early arrivals because early arrivals are now recorded. That is the truth about when people arrive, and the averages were always meant to report it.

Two sentences in the documentation stop being true and are rewritten rather than annotated. The "Attendance knows nothing about a calendar" entry in FEATURES.md becomes a description of the schedule, its exceptions, and the cost of a forgotten holiday. The roadmap's "Term dates, and a meeting pattern on a program" entry is removed, and its remaining half, noticing a morning nobody opened, is now the column of red on the grid rather than a warning.

## Testing

Unit tests in `tests/lib/attendance/schedule.test.ts` cover the meeting-day predicate at the range edges and across weekdays, the list of meeting days between two dates, and the make-and-remove diff between two schedules: a first save, an extended end, an added weekday, a moved start time that changes no membership, and a removed holiday that neither side touches.

Unit tests in `tests/lib/attendance/window.test.ts` cover the new state and the lower bound at its edges: one second before the window opens is scheduled, the opening instant is open, a hand-started session is open at its own start, and the backstop and ended rules are unchanged.

Unit tests in `tests/lib/attendance/summary.test.ts` and `cells.test.ts` cover a not-yet-settled session counting for nobody without a record and for a fellow with one, and the upcoming cell.

Integration tests in `tests/integration/attendance.test.ts` cover the router: a check-in finalizes an earlier day nobody ended, and writes nothing on a second call; saving a schedule makes one session per meeting day from today with the scheduled clock; saving it again makes nothing; extending the end makes only the new days; removing a weekday deletes only those days after today; a removed holiday survives a re-save; the start time change rewrites only days after today; a check-in at 8:00 AM on a 9:30 day is present with its arrival recorded; a check-in at 7:00 AM is refused without a failure event; Thursday's code on Tuesday is refused as no session; the sweep leaves days ahead standing; ending a day before its window is refused; `removeDays` skips a day with a self check-in and says so; `history` returns nothing ahead of today and `upcoming` returns nothing behind it; `upcoming` returns the same code `codeFor` derives; and a fellow's rate is unchanged by a month of days ahead.

## Deploying it

The migration adds four columns to `programs` with their two `CHECK` constraints, all nullable or defaulting to empty, and nothing else. The previous release ignores columns it does not select, so the migration can run before the code deploys, and a rollback of the code leaves harmless columns behind. Apply it to the deployment database with `npm run db:deploy:deployment` before or at the deploy, not after, because the new code selects the columns.

Every changed procedure keeps its old inputs valid: prepare's `day` is optional, start's inputs are unchanged, and the new procedures are additions. A browser tab loaded before the deploy keeps working. The one visible difference for an old tab is none, because no program has a schedule until an instructor saves one.

Nothing changes for any program until its schedule is saved, so shipping on a school morning is safe. Saving a program's schedule is the moment its behaviour changes, and it is best done the evening before a meeting day. The first morning after that is what to watch: that the day opened at 7:30 AM without anybody pressing anything, that early arrivals read as present, that the term grid shows nothing ahead of today, that every fellow's rate is what it was the day before, and that the day was finalized by the following morning's first check-in. The first holiday after that is the second thing to watch: remove it ahead of time, and confirm the student's week shows a dashed square rather than a red one.
