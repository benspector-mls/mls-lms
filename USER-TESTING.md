# User testing with instructors

Tasks for a moderated session with a real Marcy instructor. What the application does, role by role, is in [FEATURES.md](FEATURES.md); why it is built that way is in [ARCHITECTURE.md](ARCHITECTURE.md); what is not built yet is in [ROADMAP.md](ROADMAP.md).

**Do not give a participant `FEATURES.md` before a session.** Where somebody expects a thing to be is the finding, and a participant who has read the manual can no longer produce it. Hand it over afterwards, to somebody who is going on to teach with the application.

Each task is written as a goal rather than as steps, because the thing being measured is whether an instructor can find the screen and understand what it says. Reading the steps out loud tests nothing. Under each task is what to watch for — the specific confusion that task exists to detect.

- [How to run a session](#how-to-run-a-session)
- [Setup before a session](#setup-before-a-session)
- [Say this out loud first](#say-this-out-loud-first)
- [Session 1: joining, and setting up a cohort](#session-1-joining-and-setting-up-a-cohort)
- [Session 2: authoring assignments](#session-2-authoring-assignments)
- [Session 3: rehearsing as a student](#session-3-rehearsing-as-a-student)
- [Session 4: grading](#session-4-grading)
- [Session 5: when things go wrong, and the end of a term](#session-5-when-things-go-wrong-and-the-end-of-a-term)
- [Session 6: the student's side](#session-6-the-students-side)
- [If you only get one hour](#if-you-only-get-one-hour)
- [Exit interview](#exit-interview)
- [Recording what you find](#recording-what-you-find)

---

## How to run a session

**One instructor at a time, sharing their screen, thinking aloud.** Two people in a session means one of them watches the other work, and the quiet one is the one who would have gone somewhere different.

**Do not help for the first sixty seconds of being stuck.** A person who is lost says where they expected the thing to be, and that sentence is the finding. Then give the smallest hint that unblocks them, and write down that you had to.

**Write down the words they use.** The most common finding in a session like this is a vocabulary mismatch, and it is invisible unless you are listening for it: cohort against class against section, publish against hand out against distribute, triage against my grading pile, module against unit against week. If an instructor says "where do I post the assignment", the screen saying "Publish" is the problem.

**Every task has a real artefact behind it.** Ask them to bring an assignment they actually teach — its template repository, its answer keys, its rubric — rather than inventing one during the session. An instructor authoring a fake assignment authors it carelessly, and careless authoring does not find the traps in the form.

**Never test against the production GitHub organization.** Repositories get generated for real during these sessions. Use `marcy-lms-test` and a cohort created for the session.

**Use test students rather than real student work.** Grades and feedback are about real people; a session is not a reason to move that data. The one exception is an instructor grading their *own* past cohort's work, which they already have access to.

---

## Setup before a session

Sessions 1 through 3 an instructor can do from an empty cohort. **Session 4 cannot be prepared during the session** — producing a submission in each state takes longer than grading it does, and the point of the session is the grading. So it needs a fixture cohort built beforehand.

Before any session:

- [ ] A deployment they can reach, on the test GitHub organization.
- [ ] An unredeemed instructor invitation link, sent to them for task 1. Send it the way you would really send it.
- [ ] Their GitHub account known to you, so you can confirm what the roster ought to say.
- [ ] For sessions 3 and 5, admin on their account — those tasks are marked **(admin)**.
- [ ] **For session 7, a second screen and a phone**, both signed in — the instructor's laptop plus whatever a class would actually look at, and a phone signed in as a test student. That session is about a room of people reading a code off a wall, and one browser tab cannot rehearse it.

For session 4, a cohort with at least one submission in every one of these states, so that no bucket is tested by talking about it:

- [ ] `needs_report` — a repository assignment with an open pull request and no report.
- [ ] `needs_manual_grade` — a file upload handed in, and a Google Drive link handed in.
- [ ] `draft_ready` — a generated report nobody has read.
- [ ] `needs_manual_review` — a report the cross-check gated. Easiest to produce by grading a submission whose tests error.
- [ ] `grading_failed` — a run that failed before producing a report.
- [ ] `comment_not_posted` — an approval whose pull request comment did not send.
- [ ] A graded submission with newer code pushed after grading, and the student's readiness pressed, so there is a resubmission to work.
- [ ] A removed student with graded work still in the cohort.
- [ ] Enough students that the gradebook has to scroll sideways — twenty-five is the real number, and a five-student gradebook hides everything about it.
- [ ] Two groups, with the instructor's own group set, so the group filter has something to narrow to.

Build that once and copy the cohort for each session, rather than rebuilding it per instructor.

---

## Say this out loud first

Told at the start, so they do not spend the session reporting things you already know are absent:

- Grading is started by a person. Nothing grades itself when a student pushes.
- The application sends no email. Every link is one you copy and send yourself.
- Nothing notifies a student — not about a new assignment, a deadline, or a grade coming back. The only message that leaves the application is GitHub's own email about the comment on their pull request.
- Nothing reaches Salesforce or Google Classroom yet.
- The student's code is read on GitHub, in another tab. There is no diff on the review screen.
- Rubrics are fixed at four kinds and instructors cannot yet write their own, which is why only coding work gets an AI report.
- There is no end-of-term summary of one student across a whole course.

And: "if anything is confusing, that is the thing I am here to find out. It is not a test of you."

---

## Session 1: joining, and setting up a cohort

About forty-five minutes.

1. **Here is a link I sent you. Get yourself into the application.**
   Watch for: whether they expect a password and are surprised by GitHub, whether they know what they are agreeing to by signing in with GitHub, and whether they can say where they have landed once they are in. An instructor who signs in and then asks "so what is this" has read no heading on the way.

2. **Your name is showing wrong on the roster. Fix it.**
   Watch for: whether they find the account menu at the foot of the sidebar. Every account arrives named from its email or GitHub profile, so a roster of `bspector`, `jrivera23` is what an instructor first sees — do they even notice it is wrong, or accept it? On the same screen, do they read the card listing what the application stores about them, and does anything on it worry them?

3. **Set up the cohort you will teach next term.**
   Watch for: the short name review step, which is the one decision in the application that can never be changed. Do they read it, or press past it? Do they understand `swe-f26` will be in the name of every repository their students get, and does the suggestion match what they would have chosen? Ask them afterwards what they think would happen if it were wrong.

4. **Instead of building it from nothing, start it from last term's cohort.**
   Watch for: what they expect to come along. Assignments and modules do; students, groups, and grades do not. An instructor who expects the roster to copy has a mental model worth knowing about.

5. **Get your students into it. Show me what you would actually send them.**
   Watch for: whether they look for a field to type email addresses into, and how long they look before giving up. Do they understand the link is one link for the whole cohort, reusable, and that anyone holding it gets in? Ask what they would do if it were forwarded to somebody outside the program.

6. **Your co-teacher is taking half this cohort. Give them access.**
   Watch for: whether they reach for the student join link. Two links on two screens is the design; a co-teacher accidentally enrolled as a student is the failure it exists to prevent. Also ask what they think their co-teacher will be able to do — every instructor grades everything, and only the owner archives the cohort or changes who teaches it.

7. **Lay out the term: the modules, in the order you teach them.**
   Watch for: whether the Modules screen is where they look, whether the reorder controls read as controls, and whether they try to reorder the assignments inside a module. Assignments order themselves by due date and cannot be dragged, deliberately — does that read as broken?

8. **You and your co-teacher are splitting the cohort fifteen and fifteen. Say that in the application.**
   Watch for: whether they find groups on the roster. Do they expect a group to control who is *allowed* to grade whom? It does not — it narrows four screens and nothing else. That gap between expectation and behaviour is worth measuring, because it is a design decision rather than an oversight.

---

## Session 2: authoring assignments

About an hour, and the densest form in the application. Have them bring two real assignments.

9. **Hand out `swe-1-4-loops` — the real one, with your real template and answer keys — to this cohort.**
   Watch for: everything about the two repository fields. Do they paste a browser address, a clone URL, or type `owner/repo`? When they paste the address of the answer-key *folder* they already have open, do they notice it filled both fields at once? Do they browse for the folder or expect to type a path? Do they read the list of resolved files, and would they have caught a wrong folder from that list? Then: do they understand the sections mapping — that the assignment says which file is graded against which rubric — or is it the part they guess at? Does the runner preset mean anything to them? Do they know what a completion threshold of 75 percent is doing?

10. **Now hand out three assignments that are not repositories: the resume upload, the reflection document, and the Canva design.**
    Watch for: whether they can tell which kind is which from the labels. A Google Drive assignment hands out a copy prompt; a file upload and an external URL hand out nothing at all, so the submission instructions are the only thing the student reads — do they write any? For the upload, do they pick file types deliberately, or accept whatever is checked? Ask what they think happens if a student uploads the wrong kind of file.

11. **Publish one of those and leave one unfinished. Then tell me which ones your students can see right now.**
    Watch for: whether "draft" is the word they would use, and whether they are confident about the answer. A module that is full to an instructor and empty to the cohort is the confusion this tests.

12. **Carry an assignment from last term's cohort into this one.**
    Watch for: whether they find Copy to. The module has to be chosen because a module belongs to one course — does the dialog's default read as a decision made for them or as a decision they are making? Does the message telling them which of the two happened get read?

13. **Add this week's reading, a note about the lecture, and the recording.**
    Watch for: whether they look for these under assignments. Do they try to paste embed HTML for the video rather than the address of the page? Do they ask where the publish control is — there is none, resources are visible as soon as they exist — and does that surprise them?

14. **You created that one by mistake. Get rid of it.**
    Watch for: whether the typed confirmation reads as an obstacle or as a sentence they read. Ask afterwards what they think happened to the student repositories — they still exist, on purpose.

---

## Session 3: rehearsing as a student

**(admin)** About thirty minutes. This is the session most likely to produce changes to your assignments rather than to the application, which is the point of it.

15. **Before your students meet this cohort, check it yourself as one of them.**
    Watch for: whether they find View as on the roster, and whether they understand what a test student is. Do they read the amber banner? Once they are looking through it: is the course page what they expected their students to see?

16. **As the test student, accept the repository assignment and do the work.**
    Watch for: whether they can find the repository afterwards, and whether they understand that *they* are the account that pushes on the test student's behalf. This is where an instructor discovers whether their own instructions make sense from the other side. Note every sentence they say aloud starting with "oh, a student would not know".

17. **Hand in the resume, the document, and the Canva link as that student too.**
    Watch for: the difference between an assignment where handing in is uploading a file and one where it is pasting a link. Is it obvious which is being asked for?

18. **Come back to being yourself.**
    Watch for: whether they find the way out, and whether landing back on the roster they left from is what they expected.

---

## Session 4: grading

About seventy-five minutes, on the prepared fixture cohort. This is the session that decides whether the application is worth adopting, so protect the time for it.

19. **It is Monday morning. Work out what needs doing in this cohort and tell me what you would start with.**
    Watch for: whether triage's piles are legible without explanation. Read the bucket names back to them and ask what each one means before they open it. Does the outstanding count match the number they would have quoted?

20. **Grade one submitted coding assignment.**
    Watch for: how long they are willing to wait for a report, and whether anything on screen tells them it is working. Then, on the report: do they read the test results as the grade? They are one input to the rubric and not the score — if an instructor reads a pass rate of 9/13 and expects 9/13 as the score, say so in the notes. Do they read the flags and the confidence, or scroll past them to the number?

21. **You disagree with what the model wrote about the second section. Fix it and release the grade.**
    Watch for: whether editing in place is discoverable. Do they realize the model's original wording is kept rather than overwritten? Then leave a score in the text that disagrees with the recorded score and watch the refusal — does the message tell them what to change? Afterwards, ask them where they think that feedback has gone: the pull request comment, the gradebook, and the student's own screen all move at once.

22. **Grade the resume by hand.**
    Watch for: whether they expect an AI report on it and are disappointed. Is the embedded document readable enough to grade from, or do they download it anyway? Try to approve with an empty score and confirm the refusal is understood rather than merely obeyed.

23. **Twelve students handed that assignment in overnight. Grade all of them.**
    Watch for: whether they find the one press that covers the whole outstanding pile, and whether they trust it. Ask what they think happens if they close the tab — what is in flight finishes and nothing further starts, and knowing that changes whether they walk away.

24. **This one is held for review. Sort it out.**
    Watch for: whether the stated reason tells them what to do next, or only that something is wrong.

25. **This one failed. Sort it out.**
    Watch for: whether they read a failure as the student scoring zero. That is the confusion the screen is written to prevent, so it is worth checking that the writing works.

26. **This student was graded but never got the comment on their pull request.**
    Watch for: whether they find the retry, and whether they understand the grade is already recorded and the student can already read the feedback.

27. **This student revised their work after you graded it, and says they are ready. Grade the revision.**
    Watch for: whether they understand the earlier report is history rather than something they have overwritten, and whether a second comment beside the first reads as right or as duplication.

28. **Only grade your own fifteen students.**
    Watch for: whether they find the group filter, whether it sticks as they move between screens, and whether they notice the headings naming the group. Then ask whether the counts they are looking at are about their fifteen or the whole cohort — if they cannot say, the labelling has failed.

29. **Amina's mentor meeting is this afternoon. How is she doing?**
    Watch for: which screen they go to, and what they cannot answer from it. There is no summary of a student across a term — this task exists to measure how much they want one and what they would want it to say. Write down the sentences they wish the screen said.

30. **While you are grading that report, read the code it is about.**
    Watch for: how many tabs they end up with, and whether they lose the screen holding the score. This is the one outstanding item that shortens the hour they already spend grading, so the observation here is a priority decision rather than a bug.

31. **Who in this cohort is failing, and who has not handed something in?**
    Watch for: whether the gradebook answers it, whether they can read a scrolling table of fifty columns, and whether they trust the colours. Green on a score means the work met the threshold; green in a gradebook cell means 90 percent or better. Ask what green means to them.

---

## Session 5: when things go wrong, and the end of a term

About thirty minutes.

32. **A student has left the program. Take them off your list.**
    Watch for: whether they expect it to be destructive. Then ask two questions: is their work still in your grading pile — it is not — and can that student still read the feedback you gave them — they can. Whether an instructor finds that pair obvious or surprising is the finding.

33. **They came back.**
    Watch for: whether restoring is where they look for it, and whether they expect the work to come back with them.

34. **The join link reached somebody outside the program.**
    Watch for: whether they find regeneration, and whether they understand it does nothing about whoever already got in.

35. **The term is over. Take last term's cohort off your screen, then read a grade in it a week later.**
    Watch for: whether archiving reads as reversible, whether they can find the cohort again, and whether they expect to be able to change anything in it.

36. **You are leaving the program. Hand this cohort to your co-teacher.**
    Watch for: whether ownership was a thing they knew existed, and whether they can say what it gave them.

37. **(admin) A new instructor starts on Monday and needs access. And they will be running hiring for the next cohort, so they need to be able to invite people themselves.**
    Watch for: whether the two mechanisms read as two things — becoming staff at all, and being able to make others staff. Then have them try to remove the last admin and confirm the refusal is understood.

---

## Session 6: the student's side

Worth twenty minutes with an instructor looking through a test student, and worth far more with two or three real students if you can get them.

38. **You are a student on Sunday night. What is due, and what have you not done?**
    Watch for: whether the course page answers it, and whether empty modules ahead of them read as reassuring or as broken.

39. **You got a grade back. Read your feedback and say whether you know what to do next.**
    Watch for: whether the feedback is findable at all, and whether the status vocabulary means anything. A student sees "Submitted" for four different instructor-side states, on purpose — does the narrower vocabulary leave them wondering, or is it enough?

40. **You have improved your work. Get it looked at again.**
    Watch for: whether the readiness button is discoverable, and whether they understand that pushing code is not the same as asking for re-review.

---

## Session 7: taking attendance

**Bring a second screen and a phone.** This is the one feature that cannot be tested on a single laptop: it is a code on a projector or in a shared Zoom window, read by somebody looking at a phone. Testing it in one browser tab tells you almost nothing, because the whole question is whether a room of people can act on it in ninety seconds. Twenty-five minutes with an instructor, and worth repeating once with real fellows in a real first meeting.

Run it at whatever time of day you are actually sitting down, not at 9am. Nothing in the feature cares what time it is, and waiting until morning is how this session never happens.

41. **It is the start of class. Take attendance.**
    Watch for: how long it takes them to find it, and whether they hesitate before pressing Start. Say nothing about the second window — see whether they find "Show the code" on their own, and what they do with it once it opens. An instructor who does not discover that window will read the code aloud, which works and is not what it is for.

42. **Put the code where a class would see it.** Ask them to share it into Zoom, or drag it to the projector.
    Watch for: whether the window is the right shape for what they actually do. This is the task most likely to find something I got wrong, because I have never seen it on a projector. Is the code big enough from the back? Does the countdown mean anything to them, or is it decoration?

43. **Now be a fellow.** On the phone, signed in as the test student, check in. **Say nothing about where it is.**
    Watch for: this is the task the whole session exists for. The box is in that course's row of the week strip on the dashboard they land on, and again on the course's own Attendance screen — so the question is whether the row reads as somewhere to type at all on a phone, where it has wrapped. Time it. If they scroll past their own week looking for something that announces itself more loudly, write down what they expected to see, and whether the squares beside the box were read as decoration.

    Then ask them what the squares say about their week, before you explain them. If they cannot tell a dashed outline from a red one at arm's length, the colours are doing work the shapes should be.

44. **Let the code change while you are typing it, on purpose.** Type three digits, wait for the rollover, finish, and submit.
    Watch for: it should still be accepted. If it is refused, that is a bug and I want the exact seconds. Then type a genuinely wrong code and read the refusal aloud — does it send them back to the screen, or does it leave them wondering whether they are in the right course?

45. **Somebody's phone is dead. Mark them in by hand.**
    Watch for: whether they find the four buttons, and whether the row afterwards makes clear that *they* marked it rather than the fellow. That distinction is the whole compliance argument and it is written in words, not colour — ask them to read the row back to you and see whether they notice.

46. **End the session, then discover you ended it too early.** End it, then put it back.
    Watch for: whether they expect Reopen to lose the check-ins already recorded. It does not, and their hesitation before pressing it is the thing to note. Ask what they thought would happen.

47. **A fellow arrives forty minutes late, after check-in has closed.** Work out what to do about them.
    Watch for: there is no request flow — the fellow's screen tells them to speak to their instructor, and the instructor marks them in. Is that acceptable, or do they expect the fellow to be able to file something? This is a design decision I would revisit if two instructors push on it.

48. **Look at your own record as the fellow.** Open the calendar and page back a month.
    Watch for: whether the colours need explaining. The legend is there, but read their face before they read it — green for present, amber for excused, red for absent, grey for a session nobody recorded. Ask what the corner mark on a green square means before telling them; if "late" is not the first guess, that mark needs to be something else. Then ask whether a calendar or the old list would serve them better, and note that they cannot see the list to compare.

49. **It is the end of the month and somebody needs an attendance report.** Get one.
    Watch for: whether they find the second tab, whether the drift list reads as useful or as an accusation, and whether the CSV is the shape their reporting actually needs. Ask specifically: **does an excused absence counting as a missed session match how the school counts it?** If it does not, say so now — it is one function and one sentence, and it is quoted to funders.

---

## If you only get one hour

The subset that finds the most, in order: tasks 41 through 44 (take attendance, get the code onto a screen, find check-in and use it from a phone), 9 (author a real repository assignment), 19 through 21 (triage, generate a report, edit and approve), 23 (grade a pile at once), 29 (how is this student doing), 30 (read the code while grading), and 31 (the gradebook).

Attendance leads despite being the newest thing here, and for the reason the rest of the list is ordered: everything on it is something an instructor does weekly, and attendance is the only one they do **daily**, in front of the whole cohort, where a failure is twenty-five people watching. Setting up a cohort is something they do twice a year and can be tested later.

---

## Exit interview

Ask these after the tasks, in this order, and let them answer badly before prompting.

1. Today, grading one assignment means cloning, running tests, commenting on the pull request, and typing the grade into two other systems. Which parts of that did this replace, and which parts did it not?
2. Where did you feel you were guessing?
3. Was there a moment you thought you had broken something?
4. What did you expect to be able to do and could not find?
5. Would you trust a grade this generated in front of a student who challenged it? What would you need to be able to show them?
6. Which single thing would you fix first?
7. If this were the system next term, what would worry you in week one?

Question 5 is the one to ask carefully and not lead. An instructor who would not defend a generated grade in a conversation with a student will not use the feature, whatever they say about liking it.

---

## Recording what you find

One note per observation, each carrying the task number, what they were trying to do, what they did instead, and whether you had to help. A note that says "confusing" is not usable later; a note that says "on task 9, looked for the answer keys under Settings for forty seconds, said 'this is a course-level thing surely'" is a decision about where a field goes.

Sort them afterwards into three piles, because they lead to different work:

- **Wrong words.** The screen says something true in language nobody uses. Cheapest to fix and the most common.
- **Wrong place.** They looked somewhere reasonable and the thing was not there.
- **Wrong model.** They believed something about how it works that is not so — a group granting grading permission, a failed run meaning a zero, an archived cohort being gone. These are the ones worth arguing about, because sometimes the instructor is right and the design is wrong.

Anything that turns out to be a missing feature belongs in [ROADMAP.md](ROADMAP.md) with the session note that produced it, rather than in this file. This file is the script; what the script found is not.
