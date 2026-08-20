# Screenshots for the deck

Drop a PNG into this folder under the exact filename below and it appears on that slide. Until a file exists, the slide shows a dashed placeholder naming what belongs there, so the deck is presentable with none of them in place and improves one screenshot at a time.

Capture at a **16:9 window, around 1600×900**, in light mode. Each slot is roughly half a slide wide, so anything narrower reads small on a projector. Use the test cohort rather than a real one — every one of these ends up in front of the room.

| File                            | Slide | What to capture                                                                                  |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `05-accept.png`                 | 5     | A student's assignment panel with the **Accept** button visible                                  |
| `06-roster.png`                 | 6     | The roster — expected students, the join link, and the groups panel in one frame                 |
| `07-authoring.png`              | 7     | The new-assignment form, scrolled to the template and answer-key fields with their checks passing. **Include the Due date and Due time pair** |
| `08-module-resources.png`       | 8     | One course unit expanded, showing its assignments with readings and a video beneath them. A **project** is the better subject than a module, because its list reads "Deliverables" and its counts sit on the sub-headings |
| `09-report-review.png`          | 9     | A draft report in the review pane. **The report itself must be the top card**, with the rubric rows and the test evidence below it — that ordering is the point of the slide |
| `10-triage.png`                 | 10    | Triage, with several piles carrying non-zero counts. **Six piles, not seven** |
| `10-student-record.png`         | 10    | One student's record across the cohort, including assignments never started                      |
| `10-gradebook.png`              | 10    | The gradebook grid, wide enough to show the coloured cells and both totals. A unit's Overall cell should read as a fraction such as "3 / 5" |
| `11-student-dashboard.png`      | 11    | The student dashboard with every list populated, including **Feedback to read** and weekly attendance |
| `12-attendance-code.png`        | 12    | **Two windows in one frame:** the instructor's attendance screen with the session code and its Copy button, and the board beside it with some fellows checked in and some not |
| `12b-gcf.png`                   | 12b   | The gradebook's **GCF** tab, with both kinds visible and one student selected so their attempts show |
| `13-view-as.png`                | 13    | A test student's course page with the amber **View as** banner across the top                    |

Two of these need a cohort in a particular state, so build it before you start capturing: triage is only convincing with work sitting in several different piles at once, and the student dashboard needs something overdue, something coming up, and something graded. The practice cohort from session 4 covers both. The GCF tab needs one CodeSignal export imported, with at least one fellow holding both a mock and a proctored attempt.

**`12-attendance-code.png` is the awkward one**, because the feature is two screens and a photograph of one of them says nothing. Start a session and capture the instructor's screen — the code beside its Copy button — next to the board with the check-ins part-way through. A board reading "18 of 27" is the whole point; an empty one and a complete one both look like a still image of nothing happening. Do not photograph a projector, and do not build the frame around a projected code: the code is now copied into the chat far more often than it is projected, so a screen capture of the two windows is both the honest picture and the one that reads better at the back of a room.

## What is stale, and why

Every file in this folder was captured on 16 August. Since then the interface has changed under nearly all of them, so **treat the whole set as needing recapture** rather than picking through it. Named reasons, so a recapture can be checked rather than guessed at:

- `10-triage.png` — the **held for review** pile no longer exists. A screenshot showing seven piles contradicts the slide beside it.
- `09-report-review.png` — the report moved to the top of the pane, the rubric rows into a card of their own, and the test evidence below that. The header lost a row.
- `08-module-resources.png` — modules, projects, and assessments became one thing, the course unit, and the counts moved from the unit's header row onto the sub-headings they count.
- `10-gradebook.png` — a unit's Overall cell now reads "3 / 5" rather than "Complete" or "Incomplete", the legend labels were simplified, and there is a fifth tab.
- `07-authoring.png` — the form now carries a Due time beside the Due date.
- `12-attendance-code.png` — one code now lasts the whole session and sits beside a Copy button, rather than rotating on a projected screen.
- `11-student-dashboard.png` — the dashboard answers the week as well as the work, and check-in sits beside a fellow's attendance calendar.
- `05-accept.gif` — the student assignment panel changed with the same work.
- `06-roster.png` — **the only one with no known change**, so it is the one to leave alone unless something looks wrong.

`12b-gcf.png` has never existed; the GCF slide is new and shows its placeholder until the file lands.

`12-attendance-student.png` sits in this folder and no slide references it. Either it belongs on slide 11 or 12 and the deck should ask for it, or it should go.
