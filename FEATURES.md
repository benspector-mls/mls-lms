# What you can do

This application hands out coursework, collects it, and gets feedback back to students. It replaces GitHub Classroom for The Marcy Lab School's fullstack program, and it adds one thing Classroom never did: it drafts a grading report for the instructor to edit and approve, so the same feedback is written once instead of typed into three systems.

There are three kinds of account. **Students** hand in work and read the feedback on it. **Instructors** run one or more cohorts: they write the assignments, decide who is in the cohort, and grade. **Admins** are instructors who can also decide who else is staff.

This file says what each of them can do. Why the application is built the way it is, is in [ARCHITECTURE.md](ARCHITECTURE.md). How to run it is in [README.md](README.md). What is not built yet is at the [end of this file](#what-it-does-not-do), with the detail in [ROADMAP.md](ROADMAP.md).

Two words that mean something particular here, used throughout:

- A **cohort** is one running of a course — "Software Engineering Fellowship (Fall 2026)". Next year's is a different cohort with its own students, its own assignments, and its own records.
- A **module** is a named part of a course that assignments and readings sit under. An instructor creates them and puts them in order; nothing derives them automatically.

---

## Signing in, and your account

**Everybody signs in with GitHub.** There is no password, no signup form, and no password reset, because there is no password to reset. Students need a GitHub account for the coursework anyway.

**Signing in does not put you in a course.** It creates your account and nothing else. Students join a cohort with a link their instructor sends; instructors are given access by an admin.

Your **Profile**, reached from your name at the bottom of the sidebar, has one thing you can change: **the name everybody sees**. It starts as whatever GitHub had for you, or as the front half of your email address, which is why it is worth correcting — that string is what your instructor reads down the roster, the gradebook, and every piece of work they grade.

Everything else on that screen is read-only and says where it comes from: your email is the one GitHub authenticated, your GitHub username is recorded when you sign in, and your role is an admin's decision. The screen also lists what the application stores about you and, in as many words, what it does not: no date of birth, no address, no phone number, no government identifier, no payment detail.

The one other thing that screen does is hand out the address of your own **calendar feed**, so your due dates appear in a calendar you already keep — see [your due dates in your own calendar](#your-due-dates-in-your-own-calendar).

Beyond those two there are no settings. No notification preferences, no email change, no way to delete your own account. The light and dark toggle in the header is the only other control, and it is not remembered between devices.

---

## What an admin can do

An admin can do everything [an instructor can do](#what-an-instructor-can-do), in **every** cohort, without being added to it. That is the main thing to understand about the role, and it is the recovery path when an instructor leaves mid-term: an admin can reach their cohorts, hand them to somebody else, and keep the term running.

Five things are an admin's alone.

### Deciding who is staff

**Admin → Staff** lists everybody who is an instructor or an admin, with the cohorts they teach.

**Instructor invitations** are how somebody becomes staff. Generate a link, copy it, and send it however you already talk to that person — the application sends no email. Opening it and signing in makes them an instructor. An invitation is **single use and expires after seven days**, because it grants access to authoring and to every student's grades in every cohort, so a forwarded one costs a great deal.

A **used invitation cannot be revoked**, and it stays on the list on purpose. It has stopped being a way in and become the record of how somebody got access, which is the question worth being able to answer months later. Taking their access away is a role change, not a tidied list. An unused invitation can be revoked at any time.

### Granting and revoking admin

The same screen promotes an instructor to admin and demotes them back. Two rules:

- **You can only move somebody between instructor and admin.** A student cannot be promoted directly; they have to go through an invitation, so there is always a record of how they became staff.
- **The last admin cannot be revoked.** There is no way to create the first admin from inside the application, so an application with no admins has no way back except somebody editing the database.

### Test students, and checking a course as a student meets it

**An admin cannot accept an assignment.** Accepting creates a repository named after the accepting account, and an admin's is not a student's. This is why test students exist rather than being a convenience.

On any cohort's **Roster** an admin can **add a test student** — a real, working student account that belongs to the cohort and can accept, hand in, and be graded like anybody else. Use one to walk your own course before students meet it: accept the assignments, read your own instructions from the other side, and find out whether they make sense.

### Viewing as a test student

**View as** on the roster puts you inside the application as that test student — their dashboard, their courses, their assignments. An amber banner across the top says whose eyes you are looking through and is how you come back out.

Two things to expect while you are in that view. Your admin powers are **refused**, because to the application you are a student for the length of the session. And the Profile screen is now the test student's, so saving a name there renames them rather than you; the screen says so.

### Reaching every cohort

An admin passes every check a cohort makes about who teaches it. So you can open any cohort's triage, gradebook, roster, and settings, archive it, delete it, transfer who owns it, and remove an instructor from it, without anybody adding you first.

---

## What an instructor can do

### Getting access, and getting into a cohort

An admin sends you an **instructor invitation**; opening it and signing in makes you an instructor. That gives you the role, not any particular cohort.

To teach a cohort somebody else set up, they send you its **co-teaching link** from the cohort's Settings. Opening it and pressing the button adds you. That link admits an existing instructor to one cohort — it never makes anybody staff, so sending it to a student does not promote them, and they are told an admin has to invite them first.

Every instructor on a cohort has the same reach: author, grade, and read every student's work. The person who created it additionally **owns** it, which means archiving it, deciding who else teaches it, and deleting it. An owner can only be removed by themselves or by an admin.

### Creating a cohort

**New cohort** asks for a name, a term, and a **short name** — a few characters that go at the front of every repository the cohort generates, so `swe-f26-swe-1-4-loops-jsmith` sits beside next spring's `swe-s27-…`. One is suggested from the name and term; edit it if you would rather read something else across forty repository names.

**The short name is settled when the cohort is created and cannot be changed afterwards**, because the repositories are already named after it and renaming here would not rename theirs. That is why creating a cohort has a review step. Settings shows it, an example repository name built from it, and how many repositories already carry it.

**You can copy a previous term.** Choose an existing cohort you teach and its modules and assignments are copied across, **unpublished and with the dates cleared**, so you set the new term's due dates rather than inheriting last year's.

### Modules, and the order the course is taught in

**Modules** is where you create, rename, reorder, and remove them. Each one opens to show what is inside it, so you can see whether a module is in the right place and whether it has anything in it.

The assignments listed there are not clickable, deliberately — that screen shows the shape of the course, and assignments are worked on from the Assignments screen.

A module cannot be removed while an assignment is still in it. Move or remove the assignments first.

**Within a module, assignments are ordered by due date**, earliest first, and cannot be dragged into another order. Work with no due date sorts last. Modules are the only thing in a course you order by hand.

### Writing an assignment

**Assignments → New assignment.** Every assignment belongs to a module and has a title, a point value, a due date, and a **completion threshold** — the share of the points that counts as complete, 75 percent by default, matching the program's Complete/Incomplete policy.

**Four kinds, and the kind cannot be changed once the assignment exists**, because changing it would change what its existing submissions are.

**Handed in by** is the other choice that cannot be taken back. Leave it on **Each student, on their own** for ordinary work, or pick a **team set** and the assignment becomes one piece of work per team, with one grade shared by everybody on it. Any kind can be team work — a repository, a document, a file, a link. The readout under the picker says how many teams the set holds and how many fellows are on none of them, because a fellow on no team has nothing to accept.

It is editable up to the moment you publish and fixed afterwards. Turning it on later would mean deciding whose work survives among students who had already handed in separately; turning it off would leave everybody but one member holding a grade whose feedback belonged to somebody else's submission. Neither is a decision this form should make quietly, so it makes neither.

| Kind             | How it reaches the student                                                                                | How they hand it back                                              | How it is graded                        |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| **Repository**   | You name a template repository; pressing Accept generates a copy for that student                         | A pull request                                                     | A drafted report you review, or by hand |
| **Google Drive** | You paste a link to a Doc, Sheet, or Slides file; pressing Accept opens Google's own "make a copy" prompt | A link to their copy                                               | By hand                                 |
| **File upload**  | Nothing is handed out; the assignment is the instructions                                                 | A file, into private storage                                       | By hand                                 |
| **Link**         | Nothing is handed out                                                                                     | A link to work made anywhere — Canva, Loom, Figma, a deployed site | By hand                                 |

For a **code** assignment you name two repositories, pasted as ordinary browser addresses:

- The **template**, which every student's repository is generated from. It has to have GitHub's template flag set — the form checks, because otherwise the failure lands on the first student who presses Accept. Private is fine if it is in an organization this deployment covers.
- The **answer keys**, which are reference solutions the grading model reads. **This repository must be private**, and a public one is refused rather than warned about. You name a *folder* inside it and every file under that folder is used; the form lists exactly which files it resolved to, and names anything it skipped. Pasting the address of the folder you already have open in GitHub fills both fields at once.

For a **file upload** assignment you tick which file types you will accept — PDF, images, Word and plain text, spreadsheets, Jupyter notebooks. The size limit is 25MB and is the same everywhere.

Every kind takes **submission instructions**, written in Markdown, which the student reads in the assignment panel. For a link assignment this is where you say where to start: a sentence linking to the Canva template your students copy reads better than a bare URL with no explanation of what to do with it.

**An assignment is a draft until you publish it.** Students cannot see an unpublished one at all — a module that is full to you reads as empty to them. Publish and unpublish are on the Assignments list.

**Copy to…** on an assignment's menu carries it into another cohort you teach, matching the module by name where it can and telling you which happened. An archived cohort takes no copies.

### Readings, notes, and videos

**Resources** are the things in a module that are not work: a link, a note written in Markdown that opens in place, or a YouTube or Vimeo video that plays without leaving the page. They are never graded and have no publish step — students see one as soon as you add it.

### The roster

Three panels, and the first two work together.

**Expected students** is the list of who you are expecting, written before any of them has an account. Paste one per line — GitHub username, email, or both — and the screen shows what it understood before anything is saved.

**The join link** is one reusable link for the whole cohort. Copy it and send it however you already talk to your students; the application sends nothing. **Both things are needed to get in:** the link is unguessable, so nobody finds the cohort by accident, and the expected list is what stops somebody who was *forwarded* the link from joining. Staff are exempt from the list.

If a link goes astray, **regenerate** it. Everybody already in stays in, and the old link stops working.

**Removing a student** takes them out of your lists and stops them handing anything else in. **It does not take their work back** — they keep reading the feedback they were given, and their graded work moves to a "Removed students" table at the bottom of the gradebook rather than vanishing from it. **Restore** puts them back.

**Groups** name a subset of the cohort. Create one, put students in it, and the group picker narrows triage, the gradebook, the assignments list, and a queue to just those students. If you and a co-teacher split a cohort, set your grading group once and your screens default to your half.

**Team sets** are the other thing on this screen, and they are not groups. A group is a filter you pick and students never see; a **team** hands in one piece of work and receives one grade, and everybody on it can see who else is on it. Make a set — "Unit 3 project teams" — say how many teams it holds, and place each fellow on one. **Distribute evenly** deals the roster round-robin if you have no particular arrangement in mind. Make one set per project: the same cohort divided differently for each, with last term's arrangements sitting in their own set rather than cluttering anything.

The collapsed row tells you what you need before publishing: how many teams, how many fellows are placed, and — in amber — **how many are on no team**. Somebody on no team of the set an assignment is handed in by has nothing to accept at all, and this is the last screen that can say so before they notice it themselves.

A set an assignment is handed in through cannot be removed, and neither can a team that has handed work in: their submissions name them and carry released grades. Move the members instead.

### Attendance

**One press at the start of class, and one code to give out.** Press **Start check-in** and a four-digit code appears on the attendance screen with a **Copy** button beside it. Give it out however costs you least: read it aloud, paste it into the Zoom chat, put it on your first slide, or press **Project the code** for a full-screen page to put on a projector or share into Zoom. Fellows type it on their dashboard or on that course's attendance screen, already signed in as themselves.

**The code does not change, and that is what makes a late arrival somebody else's problem rather than yours.** It works until check-in closes, so a fellow who sits down at twenty past reads it out of the chat or asks the person next to them. You never have to stop the lesson to put a code back on screen, and you never have to give the shared screen over to it in the first place.

If a code reaches somebody who is not in class, press **Has this code got out?** and replace it. The old code stops working immediately, and you give the new one out the same way you gave out the first.

Two things prove two different facts, and separating them is the point: the code proves somebody was in the room or on the call at that moment, and being signed in proves who they are. It replaces a Google Form where one short code did both jobs and a picklist meant anybody could submit as anybody.

**The board fills in live** while the session runs — who has checked in, who has not, and four counts across the top. Beside it, every fellow has four buttons: Present, Late, Absent, Excused. Phones die and people are in the bathroom, so correcting a row is one click, and the screen says in words whether a mark came from the fellow or from you.

**Arriving in the first five minutes is on time**, and a cohort can set its own number on the course settings screen. It applies to sessions started from then on and never rewrites a morning already recorded.

**A session ends when you press End, or ninety minutes after it started, whichever comes first.** Extend buys another thirty minutes as often as you need. The backstop exists so a session nobody closed does not leave a working code alive until the next class. Ending it writes down who was absent; **Reopen** puts it back and clears exactly those absences, keeping every check-in and every decision you made.

**Started one by mistake?** Delete it, as long as nobody has checked in — a session on the wrong date would otherwise mark the whole cohort absent for a day they were never expected.

**The whole term** is the second tab: a short list of who is drifting, with the rule printed beside it, above a grid of every fellow against every session. Clicking a date in the grid opens that session to correct it. The drift list is recent rather than cumulative, because somebody at 88 percent who has missed this week is the person to call today. It downloads as a CSV with one row per fellow per session, and a column saying whether each mark came from the fellow or from staff.

**An excused absence still counts as a missed session.** The note explains it; it does not undo it. One denominator, one rate, and nothing for anybody to interpret before quoting it.

**No group filter here, unlike every other instructor screen.** Attendance is taken for everybody in the room, and a remembered filter would have the morning board reading "11 of 15" — a number that is wrong about the room while looking entirely correct.

### Triage: what is waiting on you

**Triage** is the first screen of a cohort and answers one question — what do I do next. Work is sorted into piles by what it needs:

- **No report yet** — handed in, nothing generated. The button here generates one.
- **To grade by hand** — handed in, and nothing about it can be graded automatically. The button here opens an empty draft for you to write.
- **Drafts ready to review** — a report is waiting for you to read, edit, and approve.
- **Held for review** — the pipeline could not produce a confident draft and says why.
- **Grading failed** — the run errored. Try again, or grade it by hand.
- **Approved, never delivered** — you approved a grade but the comment never reached GitHub. Retry sends it.

Triage is one cohort at a time, on purpose: what you should do next depends on which cohort you are teaching this hour.

### Grading

Open an assignment to get its **queue**: every student down one side, the work and the review pane on the other. Tabs for All, To do, and Graded. From a student's name anywhere you get the other axis — **one student's whole record in this cohort**, every assignment including the ones they never started.

**Running the tests.** For a code assignment, **Run tests** executes *your* tests, from the template repository, against the student's code, in a sandbox with no network access and no credentials in it. Students never have write access to the template, so the tests cannot be edited by the person being graded. The result is a pass rate and every failure's name and message. **A run that errored or timed out is never turned into a score of zero** — the screen says which happened.

**Generating a report.** **Generate report** gives the model the rubric, your answer keys, the student's code, and the verified test results, and it writes one report per gradable section. **It is always a draft.** Nothing is posted and nothing counts as graded until you approve it.

Test results are an *input* to the rubric rather than the score. Anything the report claims about tests, lint, or SQL output is checked against what actually ran, and a report whose claims do not match is held for review rather than shown to you as though it were fine.

**Doing a screen's worth at once.** A due date passes and a cohort's work arrives together, so the queue and a student's record each have one button that generates a report for everything currently outstanding on that screen. It covers exactly what is showing — narrow the list to one student and it offers that student's.

**Editing.** Every section's score and prose is editable in place. Your edit is kept alongside the model's original rather than over it, so you can put it back. Students only ever see your version.

**Approving.** One press does everything: records the grade, decides complete or incomplete against the threshold, posts the feedback as a comment on the student's pull request, and shows it to the student. **There is no separate publish step** — feedback appears the moment you approve, and appears even if the GitHub comment fails to send.

Three things are refused rather than warned about, because each one would produce a wrong grade: approving the same draft twice, approving a draft that describes a commit the student has since pushed past, and approving a report whose text states a different score than the one recorded.

**Grading by hand** is the same screen with an empty draft, and the form is already on it: one card per section of the assignment, with an empty score box and an empty feedback box. Filling in either one opens the draft and carries what you wrote onto it — a score the moment you leave its box, a feedback box the moment you open it — so the total, **Discard this feedback** and **Approve and release** appear in the header as soon as there is a grade to release. Everything after that is identical. A section left with no score or no feedback is refused rather than released as a zero. Opening a submission and leaving it alone opens no draft, a score typed and cleared out again opens none either, and nothing can open a second draft over the one you have started.

**A resubmission is graded fresh**, and its feedback is a new comment rather than an edit of the first, so the two read in order are the record of what the student changed.

### The gradebook

Every student against every assignment. Cells that have a score show it; cells that do not carry one of three marks — nothing accepted, accepted but not handed in, or handed in and waiting on you — with a legend above the grid. An amber dot means it needs you.

Both edges are totalled: a **Completed** row under each assignment title says how many students met its threshold, and a **Completed assignments** column says how many each student has finished. Removed students are in their own table underneath and count towards neither.

**Download CSV** gives you the grid as a spreadsheet.

### Ending a term

**Archive** a cohort when it finishes. It stays fully readable to everybody who was in it, and stays in their course list labelled as archived, but nothing new can be handed in, joined, or copied into it.

**Transfer ownership** hands the cohort to another instructor who already teaches it.

**Delete** is permanent, is the owner's alone, and is reachable only on a cohort that is already archived. The confirmation says what would go and asks you to type the cohort's short name. Student repositories on GitHub are not touched.

---

## What a student can do

### Joining your course

Your instructor sends you a link. Open it, sign in with GitHub, and press **Join this course**. It never joins you automatically.

If it refuses, the message says which of these happened:

| What it says                                           | What to do                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The link does not work                                 | It has been replaced. Ask your instructor for the current one.                                                                                                            |
| Your account is not on the list of expected students   | It names the account you are signed in as. If you usually use a different GitHub account, sign out and try again with that one. Otherwise ask your instructor to add you. |
| Somebody else used the place reserved for your account | Ask your instructor to check the list of expected students.                                                                                                               |
| The cohort has finished                                | It is archived and not taking new students.                                                                                                                               |
| You are no longer enrolled                             | Everything you handed in and were given feedback on is still yours to read. Ask your instructor if that is wrong.                                                         |

### Your dashboard

Signing in lands you here, and it is the one screen that spans every course you are in. **Nothing on it can be dismissed** — handing the work in is what clears a deadline, handing it in again is what clears a second attempt, and marking feedback read is what clears a report.

At the top, **your week**: one row for each cohort, with this week's mornings as squares and your attendance for the term beside them. Green is present, green with a corner mark is late, amber is excused, red is absent, and a dashed outline is a day that cohort did not meet. On a morning your instructor has started a session, the row also carries the box to type the code into.

Then the work, in five lists:

- **Overdue**, first, because burying a missed deadline under a week of upcoming work is how it stays missed.
- **Needs another attempt** — work that came back below the completion threshold, the one you have been sitting on longest at the top. Reading the feedback does not clear this; handing the work in again does.
- **Coming up**, soonest first, with both the date and how far off it is.
- **Feedback to read** — work that passed and whose feedback you have not marked read, newest first. This is the only place the application tells you something new has arrived.
- **Started, not handed in**, quieter than the rest, because work you have taken up is work you already know about.

**Coming up looks a week ahead**, not further. Everything else your instructor has handed out is on the course page, and on a quiet week the dashboard tells you how much of it is waiting rather than telling you that you are finished.

Graded work never appears as a deadline, including work that came back below the threshold. Resubmitting is a second go at work you already handed in, and calling it overdue would say you missed a deadline you met.

**Checking in** is on your dashboard, in your week's row for that course, and on the course's own **Attendance** screen. Either works and both want the same thing: the four-digit code your instructor gave out for today. The code does not change during the session, so if you arrive late you can get it from the chat or from the person next to you rather than asking your instructor to stop. Neither screen says anything at all on a day nobody has started a session.

Once you are in, it says so for the rest of the day. If it says **Late** and you were here on time, tell your instructor — they can change it. If check-in has closed and you missed it, the Attendance screen says that too, and the answer is the same: tell your instructor, because they are the only ones who can record it.

**Your full attendance record** is on that Attendance screen: in the sidebar, under whichever course you are reading — the course you are in expands to show Coursework and Attendance. It says how many sessions you have been to since you joined and shows the whole term as a **calendar you can page through month by month**, in the same colours as the week on your dashboard. Grey is a session where nothing was recorded for you. An excused absence still counts as missed, which the screen says rather than leaving you to work it out.

### Your due dates in your own calendar

Your **Profile** has an address you can add to Google Calendar, Apple Calendar, or Outlook once. From then on your calendar fetches it by itself, and **every deadline from every cohort you are in appears there** — including assignments published after you subscribed, and deadlines your instructor moves.

Press **Create my calendar link** and you get an address. **Copy** puts it on your clipboard, which is what you need for Apple Calendar and Outlook; **Add to Google Calendar** opens Google with it already filled in. Each deadline arrives as a half-hour block ending when the work is due, and the exact minute is in the title: *Due at 11:59 PM: swe-1-5-arrays*, with the cohort's name and a link back to the assignment inside it.

**It carries titles and due dates and nothing else.** No grades, no feedback, and nothing about what you have or have not handed in. That is deliberate, because the address is the only thing protecting it: anyone holding it can read your deadlines. Treat it as private, do not paste it into a calendar the whole cohort can see, and if it goes somewhere you did not intend, **Replace this address** on the same screen makes the old one stop working immediately. You will need to add the new address to your calendar afterwards.

**Subscribe to the address — do not import a file.** Every calendar application offers both, a click apart, and the wrong one looks like it worked: importing copies today's deadlines in once and never updates again. In Google Calendar the right one is **Other calendars → From URL**; in Apple Calendar it is **File → New Calendar Subscription**. The **Add to Google Calendar** button on your Profile takes the correct path for you, and opening the address in a browser does not — a browser offers you the file, which is the import route.

It arrives called **Marcy Lab School — due dates**, and you can rename it in your own calendar without breaking anything.

**A calendar checks for changes about once a day.** So a deadline that moves tonight may not show in yours until tomorrow, and this application is always the thing that is right about a due date. If something looks wrong in your calendar, your dashboard is the answer.

**Google gives you no way to make it check now**, and nothing this application sends can hurry it — the feed asks to be re-read every twelve hours and Google decides for itself. If you need a change immediately, remove the calendar and add the same address again, which fetches it there and then; a subscription holds nothing of its own, so you lose nothing by doing that. **Apple Calendar and Outlook let you choose the interval**, down to a few minutes, which is worth knowing if you want your calendar to keep up rather than catch up.

### Your course

Your sidebar lists every cohort you are in. Archived ones and ones you have been removed from stay there, labelled, and sort after the current ones.

A course page opens with a **progress bar** and a count — "7 of 9 complete". The bar has five parts, in the order work moves: not accepted, accepted and in progress, handed in and waiting, graded and incomplete, graded and complete. The colours repeat nothing the text does not also say, and **green means one thing: you met the completion threshold**. A graded assignment is blue until it is green.

Once an assignment is complete it stays counted, even if you hand in improved work afterwards. Asking for another look never takes a completion away.

Below that are the **modules**, in the order your instructor set. Every module shows, including ones with nothing in them yet, so you can see the shape of the course ahead of you. Assignments your instructor has not published yet are not there.

**Resources** sit under the assignments in each module — a reading, a note that opens in place, or a video that plays without leaving the page. None of them is graded.

### Working on an assignment

Pressing any row opens a panel over the list, with the instructions, what you have handed in, and your feedback. It has an address you can bookmark or send to somebody.

**Accepting.** Only two kinds have an Accept button. A **code** assignment generates your own repository. A **Google Drive** assignment opens Google's own prompt to take your own copy. **File and link assignments hand out nothing**, so there is no Accept — the first thing you do is hand in.

Accepting needs your GitHub account to be connected. If it is not, the course page says so.

**Handing in a code assignment.** Work on the **`draft`** branch, then open a pull request into **`main`** and add your instructor as a reviewer. **That pull request is the hand-in — there is no submit button.** Pushing more commits to an open pull request does not hand in again; it just updates what your instructor will read.

**Working as a team.** Some assignments are handed in by a team, and the panel says so at the top: your team's name and who else is on it. There is **one piece of work between you and one grade shared by all of you**, so the panel shows who handed in what is standing — and **anybody on the team can replace it**, which is worth agreeing on before two of you do. A code assignment gives the team one repository, named after the team, that every member can push to.

The grade and the feedback arrive on everybody's own page at the same moment, and reading it is still your own: marking your feedback read does not mark it read for your teammates. If your instructor is part-way through reading your team's work, nobody can replace it until they are done — the panel says so rather than letting somebody try.

**Handing in everything else.** A Drive or link assignment takes a link; a file assignment takes a file. The form tells you which of four things you are doing:

- **Submitting** — you have not handed anything in yet.
- **Changing what you handed in** — your work is waiting and nobody has started reading it. This replaces what is there and keeps your place in your instructor's queue. Use it if you pasted the wrong link or uploaded the wrong file.
- **Handing in again** — you have been graded and are submitting revised work.
- **Locked** — your instructor is reading it right now. The panel says so where the box was. This is not an error, and when their feedback arrives you can hand in revised work.

**What the status means.** There are five words an assignment can carry, and between them they say whose move it is:

| Status          | What it means                                                                  |
| --------------- | ------------------------------------------------------------------------------ |
| **Not started** | Nothing has been handed in. If it is a code or Drive assignment, Accept first. |
| **Accepted**    | You have your repository or your copy. Nothing has been handed in yet.         |
| **Submitted**   | Your work is with your instructor.                                             |
| **Resubmitted** | You have asked for another look at revised work.                               |
| **Graded**      | Your feedback is ready to read.                                                |

**Submitted covers four different things happening on your instructor's side, on purpose.** None of them is something you can act on, and being told that a grading run failed would invite a question you cannot answer. If something has gone wrong there, your instructor sees it and it is theirs to fix.

**Graded is blue rather than green.** Green is reserved for one thing — meeting the completion threshold — so the score beside the status is what tells you whether you passed, in green or red, with an icon as well as a colour.

### Your feedback

When your instructor approves your grade, the feedback appears immediately — there is no separate release step — and, for a code assignment, is also posted as a comment on your pull request, which GitHub emails you about.

The **Feedback** tab shows every round, oldest first, each with its score and its report broken down by section. A resubmission is graded fresh rather than as an edit, so you keep both and can read what changed.

**Mark as read** clears the row from **Feedback to read**. It does nothing else — it does not tell your instructor anything you need to worry about, it does not gate resubmitting, and nothing waits on it.

**It does not clear work that came back incomplete.** That stays under **Needs another attempt** until you hand it in again, because reading why something fell short is not the same as having fixed it.

### Asking for another look

For a **code** assignment, push your improved work to the same pull request. The panel then says you have pushed changes since your feedback, with an **Ask for another review** button. **Pushing is not asking** — the button is what tells your instructor you are ready, and until you press it they see a student still working. If your pull request was closed and you reopen it, that counts as asking.

Before you have pushed anything, the panel on work that came back incomplete says so and tells you that pushing is the next step. The button appears once there is a commit to review.

For every other kind, hand in again.

### If you leave a cohort, or it finishes

**Neither takes your work back.** A cohort you have been removed from, and one that has been archived, both stay in your course list, labelled, and everything you handed in and every piece of feedback you were given stays readable. What you cannot do is hand anything new in.

---

## What it does not do

Said plainly, because an hour spent looking for one of these is an hour wasted.

**There are no notifications of any kind.** No email, no push, no in-app inbox. The only message that ever leaves the application is GitHub's own email about the comment posted on your pull request. Inside the application, the **Feedback to read** list on a student's dashboard is the whole of it — which is why that list exists and why nothing on it can be dismissed.

**The application sends no email at all.** Every link — the join link, the co-teaching link, an instructor invitation — is one somebody copies and sends themselves. This is deliberate: the application holds no email credentials.

Also absent today:

- **Attendance knows nothing about a calendar.** There are no term dates and no timetable, so a session exists because somebody started one. Nothing notices a morning nobody opened, and nothing can — without knowing which days are school days, a warning would fire on Saturdays and over winter break, and a warning wrong twice a week is one people stop seeing. What this buys is that snow days, field trips and a schedule that changes in March need no maintenance at all.
- **The code does not stop a fellow texting it to somebody at home.** Nothing does; that is collusion rather than authentication, and every technical answer is worse than the problem. A code that changed every thirty seconds did not stop it either — it only narrowed the window, at the cost of holding the shared screen hostage for the first five minutes of every class. What the application does instead is keep the record answerable: every check-in stores the minute it happened, so a fellow marked in at 10:25 for a class that started at 9:00 reads as exactly that, and you can ask. If a code has got out, replace it.
- **Attendance is per course, not per program.** A fellow taking three courses checks into three sessions, which is three rows on the dashboard and three codes to type.
- **There is no weekly attendance percentage.** The week is shown as days, and the figure beside it is for the term. A weekly rate would divide by "mornings somebody remembered to start a session", so a forgotten Tuesday would read as a perfect week — a number that confident should not be one nobody can check.

- **No running average or grade summary for a student.** Scores are per assignment. Instructors read down a student's record; students read their own progress bar.
- **No notes.** Neither a student's own notes on their work nor a private note an instructor keeps on a student.
- **No settings beyond your display name.**
- **No way to withdraw yourself from a cohort.** Ask your instructor.
- **No comment thread on a submission.** Feedback goes one way; the conversation happens on the pull request or in person.
- **No summary of one student across a term.** For a mentor meeting, read down their record.
- **Nothing grades itself when a student pushes.** An instructor presses the button; one press covers a screen's worth.
- **No instructor-authored rubrics.** There are four fixed section types, all of them for code, which is why a coding assignment gets a drafted report and a resume does not.
- **The code is read on GitHub, in another tab.** There is no diff beside the report yet.
- **Nothing is sent to Salesforce or the school's LMS.** Grades are still re-entered by hand there.

What is planned, and in what order, is in [ROADMAP.md](ROADMAP.md).
