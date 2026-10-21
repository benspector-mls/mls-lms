import Link from "next/link";
import { Archive, ArrowRight, CircleCheck, EyeOff, GitBranch, UserMinus } from "lucide-react";

import { CoachingTopics } from "@/components/coaching-topics";
import { HelpTip } from "@/components/help-tip";
import type { OutlineSection } from "@/components/outlined-page";
import { CoachingDownload } from "@/components/instructor/coaching-download";
import { ExcuseDays } from "@/components/instructor/excuse-days";
import { FellowGoals } from "@/components/instructor/fellow-goals";
import { InstructorNotes } from "@/components/instructor/instructor-notes";
import { PreparationSummary } from "@/components/instructor/preparation-summary";
import { ProgramStudentPicker } from "@/components/instructor/program-student-picker";
import { RecordTabs } from "@/components/instructor/record-tabs";
import { RenameStudent } from "@/components/instructor/rename-student";
import { AttendanceCalendar } from "@/components/student/attendance-calendar";
import { StartCoachingSession } from "@/components/instructor/start-coaching-session";
import { AttendanceTrend, CourseTrend, WorkRuleHelp } from "@/components/instructor/trends";
import { ViewAsButton } from "@/components/instructor/view-as-button";
import { TEMPERATURE_MAX, temperatureTone } from "@/lib/coaching";
import { coachingCsv } from "@/lib/coaching/csv";
import { coachingSessionHref, studentHref } from "@/lib/links";
import { attendanceProvenance } from "@/lib/status";
import { TestStudentBadge } from "@/components/test-student-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { displayNameOf, initials } from "@/lib/people";
import { formatSchoolDay, type SchoolDay } from "@/lib/school-time";
import { formatPercent, TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * One fellow, across the whole program.
 *
 * **About the person rather than about their work**, which is what makes it a different screen from
 * the per-course record reached from the gradebook. That one is their submissions in one course,
 * opened to grade them; this is who they are, how the mornings have gone, when they arrive, which
 * cohort they are in, where they stand in each course of the year, their GCF history, and what has
 * been agreed with them in coaching.
 *
 * Splitting the two is what lets grading stay per course while the roster lives above every course.
 * It is what the roster's rows point at, and every course row here is a way into the other screen.
 *
 * **Two tabs under one header**, which names the fellow once and carries their details. Performance is one section per area — attendance,
 * coursework, the GCF — each opening with its last few weeks; Coaching is the preparation summary,
 * then the topics, the goals, the sessions, and the notes. The two answer different
 * questions — how is this fellow doing, and what have we agreed with them — and a single column of
 * seven sections made the second half something a reader scrolled past on the way to nothing. The card sits above
 * both because "who is this" is asked from either tab.
 *
 * **Their GCF results name no program.** A result is sat at CodeSignal on a fellow's own
 * schedule and carries no program, so somebody repeating a year has one history rather than two
 * halves of it — the same reason `/gcf` is addressed outside every scope.
 *
 * **Each area once, with its recent weeks at the top.** A reading that spans every area — the
 * Trends card — sends a reader across attendance, work and understanding and then across the same
 * areas again below it. So the record draws each recent reading inside its own area: attendance's
 * last few mornings above the term's figures, and each course's last few weeks beneath that course's
 * row. The coaching form keeps the whole Trends card, because there it is the one place the
 * conversation starts from.
 *
 * A server component. The tabs with their outline, and the writing surfaces — the notes dialog, the
 * summary and the button that starts a session — are client islands inside it; every figure is
 * still computed on the server, because `RecordTabs` renders server-rendered children through.
 */

/** Each tab's sections, for the "On this page" outline. Every id is on a `<section>` below. */
const SECTIONS: Record<"performance" | "coaching", OutlineSection[]> = {
  performance: [
    { id: "attendance", label: "Attendance" },
    { id: "coursework", label: "Coursework" },
    { id: "gcf", label: "GCF" },
  ],
  coaching: [
    { id: "summary", label: "Summary" },
    { id: "topics", label: "Discussion topics" },
    { id: "goals", label: "Goals" },
    { id: "sessions", label: "Sessions" },
    { id: "notes", label: "Notes" },
  ],
};

type Data = RouterOutputs["programs"]["student"];
type Coaching = RouterOutputs["coaching"]["forStudent"];
type Summaries = RouterOutputs["coachingSummaries"]["forStudent"];
type Fellows = RouterOutputs["enrollments"]["listForProgram"];

export function ProgramStudent({
  data,
  coaching,
  summaries,
  fellows,
  today,
}: {
  data: Data;
  coaching: Coaching;
  summaries: Summaries;
  fellows: Fellows;
  /** Read once by the page and handed down, so the server and the browser agree which square is today. */
  today: SchoolDay;
}) {
  const name = displayNameOf(data.student, "Unnamed");
  const removed = data.enrollmentStatus !== "ACTIVE";

  /*
    The fellow's own calendar, drawn for their instructor. The sentence in each square's tooltip is
    composed here, as the fellow's record composes it, because turning a source and a timestamp into
    words needs the school's timezone and the calendar itself is a client component.
  */
  const calendarDays = data.days.map((day) => ({
    day: day.day,
    status: day.status,
    open: day.open,
    upcoming: day.upcoming,
    detail: day.status ? attendanceProvenance(day) : null,
    note: day.note,
  }));

  /*
    The page's title and the fellow's details as one block: the name once, as the page heading,
    with everything else about them on the line beneath. No card around it, because it is the
    page's header rather than a section of it, and the tabs below are what the page is for.
  */
  const identity = (
    <header className="flex flex-wrap items-start gap-3">
      <Avatar className="size-10">
        <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
          {initials(data.student.displayName ?? data.student.email)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
          {/*
              Beside the name rather than among the actions on the right, because it is about the
              name and not about the record: the picker over there moves to another fellow, and a
              rename sitting next to it would read as something done to the program.
            */}
          <RenameStudent
            programId={data.program.id}
            studentId={data.student.id}
            displayName={data.student.displayName}
          />
          {data.student.testStudentNumber !== null && <TestStudentBadge />}
          {/*
              Said here rather than only implied by a lower rate. Removal is a status rather than a
              deleted row, so this page still renders in full — and a reader acting on it needs to
              know they are reading somebody who has left.
            */}
          {removed && (
            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
              <UserMinus className="size-3" />
              No longer enrolled
            </Badge>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            {data.program.name} · {data.program.term}
          </span>
          <span>{data.student.email ?? "No email"}</span>
          {data.student.githubUsername ? (
            <span className="inline-flex items-center gap-1.5">
              <GitBranch className="size-3.5" />
              {data.student.githubUsername}
            </span>
          ) : (
            /*
                Worth naming rather than leaving blank. Every repository this fellow accepts is named
                after their GitHub login, so without one nothing can be handed to them — and this is
                the screen somebody opens when a fellow says they cannot accept an assignment.
              */
            <span className="text-amber-600 dark:text-amber-500">No GitHub account linked yet</span>
          )}
          <span>joined {formatSchoolDay(data.enrolledFrom)}</span>
          {/*
              Which cohort, in words either way. A blank would read as missing data where "no cohort"
              is a fact — and one nobody has acted on is exactly what somebody comes here to find.
            */}
          <span>{data.cohort ? data.cohort.name : "In no cohort"}</span>
        </p>
      </div>

      {/*
          The way to the next name. A record is opened from the roster, the gradebook, or a link
          somebody sent, and reading a term's fellows one after another otherwise means going back
          to the roster between every one.
        */}
      <div className="flex w-full items-center gap-2 sm:w-auto">
        {/*
            The same entry into a fellow's view the roster row offers, so somebody reading a record
            does not have to go back to the roster to see what the fellow sees. Hidden for a removed
            fellow, as it is on the roster.
          */}
        {!removed && <ViewAsButton studentId={data.student.id} programId={data.program.id} />}
        <ProgramStudentPicker
          programId={data.program.id}
          studentId={data.student.id}
          studentName={name}
          fellows={fellows}
          className="min-w-0 flex-1 sm:w-56 sm:flex-none"
        />
      </div>
    </header>
  );

  /*
    Two tabs over one fetch, the roster's shape. What a reader came for splits cleanly in two —
    how the fellow is doing, and what has been agreed with them — and the header stays above both
    because it answers "who is this" for either question.

    Both tabs' data is already in hand: the page fetches it in one round trip, so the tab is which
    half is drawn rather than which half is loaded, and there is no spinner between a click and a
    list.
  */
  return (
    <RecordTabs
      header={identity}
      sections={SECTIONS}
      performance={
        <>
          <section id="attendance" className="flex scroll-mt-(--outline-offset) flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">Attendance</h2>
              {/*
                Hidden where nothing could be written: a removed fellow is not expected at any
                morning, and a finished program's attendance is closed.
              */}
              {!removed && data.program.archivedAt === null && (
                <ExcuseDays
                  programId={data.program.id}
                  enrollmentId={data.enrollmentId}
                  name={name}
                />
              )}
            </div>
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
              {/*
                The last few mornings first, where the figures beneath are the term. A term's rate
                hides the fellow who was fine in September and has slipped this fortnight, and this
                is the reading that shows them.
              */}
              <AttendanceTrend
                title="Last few weeks"
                recentAttendance={data.recentAttendance}
                arrivals={data.arrivals}
              />
              <h3 className="border-t border-border pt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Since they joined
              </h3>
              <p className="text-sm">
                {data.summary.rate === null ? (
                  <>Nothing has been counted yet.</>
                ) : (
                  <>
                    Here for{" "}
                    <span className="font-semibold">
                      {data.summary.present + data.summary.late} of {data.summary.eligible}
                    </span>{" "}
                    mornings since they joined.{" "}
                    <span className="font-semibold">{formatPercent(data.summary.rate)}</span>
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                Present {data.summary.present} · Late {data.summary.late} · Excused{" "}
                {data.summary.excused} · Absent {data.summary.absent + data.summary.unrecorded}
                {data.summary.excused > 0 && ". An excused morning still counts as missed."}
              </p>
            </div>

            {/*
              The term as the fellow sees it, square for square. The figures above answer how much
              of the term they have been here for; the calendar answers which mornings, which is the
              question an instructor has before a conversation about attendance — a run of red
              Mondays and a scattering of absences are the same rate and different conversations. It
              is the fellow's own calendar, drawn from the same days, so the two of them can look at
              the same square and read the same thing in it.
            */}
            {data.days.length > 0 && (
              <AttendanceCalendar
                days={calendarDays}
                enrolledFrom={data.enrolledFrom}
                today={today}
              />
            )}
          </section>

          <section id="coursework" className="flex scroll-mt-(--outline-offset) flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="flex items-center gap-1.5 text-lg font-semibold">
                Coursework · {data.courses.length}
                <HelpTip>
                  <WorkRuleHelp />
                </HelpTip>
              </h2>
              <p className="text-xs text-muted-foreground">
                Each course&apos;s term figures, with its last few weeks beneath.
              </p>
            </div>

            {data.courses.length === 0 ? (
              <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
                This program has no courses yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                {data.courses.map((course) => (
                  <li key={course.id}>
                    <Link
                      href={studentHref(course.id, data.student.id)}
                      className="flex flex-col gap-1 px-3 py-2.5 text-sm hover:bg-muted/50"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate font-medium",
                            course.archivedAt !== null && "text-muted-foreground",
                          )}
                        >
                          {course.name}
                        </span>

                        {/*
                      The course-wide three from the gradebook's Overview, so the record answers "how
                      is this course going" without opening it. Absent entirely while the course has
                      no released work — none of nothing is not a figure. Late carries weight but no
                      colour and missing is red, the gradebook's own reading.
                    */}
                        {course.completedAssignments.possible > 0 && (
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {course.completedAssignments.complete}/
                            {course.completedAssignments.possible} assignments
                            {" · "}
                            <span
                              className={cn(course.missing > 0 && "font-medium text-destructive")}
                            >
                              {course.missing} missing
                            </span>
                            {" · "}
                            <span className={cn(course.late > 0 && "font-medium text-foreground")}>
                              {course.late} late
                            </span>
                          </span>
                        )}

                        {/*
                      Publication is said on the row because it changes what this fellow could possibly
                      have done. A verdict of "not finished" against a course they cannot see yet is
                      not a fact about them.
                    */}
                        {course.archivedAt !== null ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                            <Archive className="size-3" />
                            Archived
                          </span>
                        ) : course.publishedAt === null ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                            <EyeOff className="size-3" />
                            Not published
                          </span>
                        ) : null}

                        {course.verdict === "complete" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            <CircleCheck className="size-3" />
                            Complete
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {course.verdict === "incomplete" ? "Fell short" : "Not finished"}
                          </span>
                        )}

                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </div>

                      {/*
                        The course's last few weeks under its totals, so everything about one
                        course is read in one place and each course name is scanned once.
                      */}
                      <CourseTrend course={course} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section id="gcf" className="flex scroll-mt-(--outline-offset) flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold">
                General Coding Framework · {data.gcf.length}
              </h2>
              <p className="text-xs text-muted-foreground">
                Every sitting, including those from other programs.
              </p>
            </div>

            {data.gcf.length === 0 ? (
              <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
                They have not sat the GCF yet, real or mock.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                {data.gcf.map((attempt) => (
                  <li
                    key={attempt.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {attempt.kind === "PROCTORED" ? "Proctored" : "Mock"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {/*
                      The two kinds are never compared, so a proctored score is shown bare — it is a
                      calibrated index from 200 to 600 — and a mock is shown over its own possible,
                      which is however many tasks that one had.
                    */}
                      {attempt.scorePossible === null
                        ? attempt.score
                        : `${attempt.score} / ${attempt.scorePossible}`}
                    </span>
                    {attempt.integrityFlagged && (
                      <Badge variant="outline" className="shrink-0 font-normal text-destructive">
                        Integrity flag
                      </Badge>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatSchoolDay(attempt.takenOn.toISOString().slice(0, 10))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      }
      coaching={
        <>
          {/*
            First, because it is what a coach reads to prepare: Claude's reading of the whole
            record, figures and writing together, with the questions to ask. It is written for the
            conversation, so it sits on the tab where the conversation is started.
          */}
          <PreparationSummary
            id="summary"
            programId={data.program.id}
            studentId={data.student.id}
            name={name}
            summaries={summaries}
          />

          {/*
          Topics, goals and coaching sessions are shared with the fellow; notes are not, and each
          section's caption says which. The topics come next because they are what to read before
          the next conversation.
        */}
          <section id="topics" className="flex scroll-mt-(--outline-offset) flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold">
                Fellow discussion topics · {coaching.topics.length}
              </h2>
              <p className="text-xs text-muted-foreground">
                Added by {name} from their Goals page. Only they can change this list.
              </p>
            </div>
            <CoachingTopics
              topics={coaching.topics}
              programId={data.program.id}
              editable={false}
              empty="They have not added anything yet."
            />
          </section>

          <section id="goals" className="flex scroll-mt-(--outline-offset) flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold">Goals · {coaching.goals.length}</h2>
              <p className="text-xs text-muted-foreground">
                Only {name} can edit a goal. Open one to write to them under it.
              </p>
            </div>

            {/*
              A client island on an otherwise server-rendered record, for the reason the fellow's
              own goals page is a client component: the rows open. Reading "what are they working
              on" wants the list, and the plan behind one goal is a paragraph read on purpose.
            */}
            <FellowGoals
              goals={coaching.goals}
              programId={data.program.id}
              empty="They have not set any goals yet."
            />
          </section>

          <section id="sessions" className="flex scroll-mt-(--outline-offset) flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="text-lg font-semibold">
                  Coaching sessions · {coaching.sessions.length}
                </h2>
                <p className="text-xs text-muted-foreground">
                  The check-in answers are staff-only; completing a session shares a dated snapshot
                  of the figures above with {name}.
                </p>
              </div>
              {/*
                Offered only when there is a session to put in it: a download beside an empty list
                hands over a file of column headings, the rule the gradebook and attendance follow.
              */}
              {coaching.sessions.length > 0 && (
                <CoachingDownload
                  csv={coachingCsv({
                    person: data.student,
                    program: data.program,
                    sessions: coaching.sessions,
                  })}
                  fellow={name}
                  term={data.program.term}
                />
              )}
            </div>

            {coaching.sessions.length > 0 && (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                {coaching.sessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      href={coachingSessionHref(data.program.id, data.student.id, session.id)}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-muted/50"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {formatSchoolDay(session.heldOn)}
                      </span>
                      {/*
                        The number alone, coloured by band, and nothing when it was never asked:
                        an empty square would read as a score of nothing. The label is for a
                        screen reader, which would otherwise announce a bare number.
                      */}
                      {session.temperature !== null && (
                        <span
                          aria-label={`Temperature ${session.temperature} of ${TEMPERATURE_MAX}`}
                          className={cn(
                            "inline-flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-medium tabular-nums",
                            TONE_CLASSES[temperatureTone(session.temperature)],
                          )}
                        >
                          {session.temperature}
                        </span>
                      )}
                      {session.endedAt === null && (
                        <Badge
                          variant="outline"
                          className="font-normal text-amber-600 dark:text-amber-500"
                        >
                          In progress
                        </Badge>
                      )}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {session.author
                          ? displayNameOf(session.author, "somebody")
                          : "A former instructor"}
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <StartCoachingSession programId={data.program.id} studentId={data.student.id} />
          </section>

          <section id="notes" className="flex scroll-mt-(--outline-offset) flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold">Notes · {coaching.notes.length}</h2>
              <p className="text-xs text-muted-foreground">
                Never shown to fellows, though a fellow may ask to read their record.
              </p>
            </div>
            <InstructorNotes
              programId={data.program.id}
              studentId={data.student.id}
              notes={coaching.notes}
            />
          </section>
        </>
      }
    />
  );
}
