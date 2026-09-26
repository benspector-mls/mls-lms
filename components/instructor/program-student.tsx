import Link from "next/link";
import { Archive, ArrowRight, CircleCheck, EyeOff, GitBranch, UserMinus } from "lucide-react";

import { FellowGoals } from "@/components/instructor/fellow-goals";
import { ArrivalAveragesPanel } from "@/components/arrival-averages";
import { HelpTip } from "@/components/help-tip";
import {
  ATTENDANCE_DRIFT_REASON_LABEL,
  attendanceDriftReason,
  DRIFT_RULE,
  recentAttendanceSentence,
} from "@/lib/attendance/summary";
import { InstructorNotes } from "@/components/instructor/instructor-notes";
import { ProgramStudentPicker } from "@/components/instructor/program-student-picker";
import { RenameStudent } from "@/components/instructor/rename-student";
import { StartCoachingSession } from "@/components/instructor/start-coaching-session";
import {
  ASSIGNMENT_DRIFT_RULE,
  DRIFT_REASON_LABEL,
  driftReasons,
  recentWorkSentence,
} from "@/lib/gradebook/summary";
import { coachingSessionHref, studentHref } from "@/lib/links";
import { formatDate } from "@/lib/status";
import { TestStudentBadge } from "@/components/test-student-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { displayNameOf, initials } from "@/lib/people";
import { formatSchoolDay } from "@/lib/school-time";
import { formatPercent } from "@/lib/status";
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
 * **Two tabs under one identity card.** Performance is the trends, then attendance, the courses,
 * and the GCF; Coaching is the goals, the sessions, and the notes. The two answer different
 * questions — how is this fellow doing, and what have we agreed with them — and a single column of
 * seven sections made the second half something a reader scrolled past on the way to nothing. The card sits above
 * both because "who is this" is asked from either tab.
 *
 * **Their GCF results name no program.** A result is sat at CodeSignal on a fellow's own
 * schedule and carries no program, so somebody repeating a year has one history rather than two
 * halves of it — the same reason `/gcf` is addressed outside every scope.
 *
 * A server component. The tab strip and the two writing surfaces — the notes dialog and the button
 * that starts a session — are client islands inside it; every figure is still computed on the
 * server, because `Tabs` renders server-rendered children through.
 */

type Data = RouterOutputs["programs"]["student"];
type Coaching = RouterOutputs["coaching"]["forStudent"];
type Fellows = RouterOutputs["enrollments"]["listForProgram"];

export function ProgramStudent({
  data,
  coaching,
  fellows,
}: {
  data: Data;
  coaching: Coaching;
  fellows: Fellows;
}) {
  const name = displayNameOf(data.student, "Unnamed");
  const removed = data.enrollmentStatus !== "ACTIVE";
  /*
    The courses with anything to have a trend about. The same guard the course rows below use for
    their figures: none of nothing is not a figure.
  */
  const coursesWithWork = data.courses.filter((course) => course.completedAssignments.possible > 0);
  const attendanceReason = attendanceDriftReason(data.recentAttendance);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-4">
        <Avatar className="size-12">
          <AvatarFallback className="bg-primary/10 font-medium text-primary">
            {initials(data.student.displayName ?? data.student.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{name}</h2>
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
          <p className="text-sm text-muted-foreground">{data.student.email ?? "—"}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
              <span className="text-amber-600 dark:text-amber-500">
                No GitHub account linked yet
              </span>
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
        <ProgramStudentPicker
          programId={data.program.id}
          studentId={data.student.id}
          studentName={name}
          fellows={fellows}
          className="w-full sm:w-56"
        />
      </section>

      {/*
        Two tabs over one fetch, the roster's shape. What a reader came for splits cleanly in
        two — how the fellow is doing, and what has been agreed with them — and the identity
        card stays above both because it answers "who is this" for either question.

        Both tabs' data is already in hand: the page fetches it in one round trip, so the tab is
        which half is drawn rather than which half is loaded, and there is no spinner between a
        click and a list.
      */}
      <Tabs defaultValue="performance">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="coaching">Coaching</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="mt-4 flex flex-col gap-6">
          {/*
            The last few weeks, first, where every section below is the term. The attendance block
            is the raw figure and the course rows are the totals; both hide the fellow who was fine
            in September and has slipped this fortnight, and this is the section that shows them,
            which is why it is read before either.

            It holds every recent-window reading the record has: the last few mornings by the
            attendance screen's drift rule; when they arrive, which is the detail per-course
            attendance used to carry and answers "are they turning up on time" where the rate
            answers only whether they turn up; and the work, per course, by the rule the
            gradebook's own list applies.
          */}
          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              Trends
              <HelpTip>
                The last few weeks rather than the term. Somebody at 88 percent who has slipped this
                fortnight is the person to talk to today, and a term-long figure hides them behind
                the good weeks.
              </HelpTip>
            </h2>
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Attendance
                  <HelpTip>
                    Flagged after missing {DRIFT_RULE.missedAtLeast} or more of the last{" "}
                    {DRIFT_RULE.missedOf} mornings, or arriving late {DRIFT_RULE.lateAtLeast} or
                    more times in the last {DRIFT_RULE.lateOf}. The same rule as the attendance
                    screen&apos;s own list. Only mornings they checked in count towards when they
                    arrive, so an absence neither raises nor lowers those averages.
                  </HelpTip>
                </h3>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {attendanceReason !== null && (
                    <span className="font-medium text-destructive">
                      {ATTENDANCE_DRIFT_REASON_LABEL[attendanceReason]}
                    </span>
                  )}
                  <span>{recentAttendanceSentence(data.recentAttendance)}</span>
                </p>
                <ArrivalAveragesPanel
                  averages={data.arrivals}
                  emptyNote="They have not checked in enough times yet for an average."
                />
              </div>
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Work
                  <HelpTip>
                    A course is flagged after {ASSIGNMENT_DRIFT_RULE.slippedAtLeast} or more of the
                    last {ASSIGNMENT_DRIFT_RULE.dueOf} assignments due were missed or handed in
                    late, or {ASSIGNMENT_DRIFT_RULE.incompleteAtLeast} or more of their last{" "}
                    {ASSIGNMENT_DRIFT_RULE.gradedOf} graded fell short. The same rule as the
                    gradebook&apos;s own list.
                  </HelpTip>
                </h3>
                {coursesWithWork.length === 0 ? (
                  <p className="text-sm">No course has released work yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {coursesWithWork.map((course) => {
                      const reasons = driftReasons(course.recent);
                      return (
                        <li key={course.id} className="flex flex-col gap-0.5 text-sm">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{course.name}</span>
                            {reasons.map((reason) => (
                              <span key={reason} className="font-medium text-destructive">
                                {DRIFT_REASON_LABEL[reason]}
                              </span>
                            ))}
                          </span>
                          <span>{recentWorkSentence(course.recent)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Attendance</h2>
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
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
                {data.summary.excused > 0 &&
                  " — an excused morning still counts as one they missed."}
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium">Courses · {data.courses.length}</h2>
              <p className="text-xs text-muted-foreground">
                Every course of {data.program.term}. Click on a course row to view this their work
                in that course.
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
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-muted/50"
                    >
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
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium">General Coding Framework · {data.gcf.length}</h2>
              <p className="text-xs text-muted-foreground">
                Every sitting, whichever program they were in at the time. A result carries no
                program — it is sat at CodeSignal on their own schedule — so somebody repeating a
                year has one history here rather than two halves of it.
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
        </TabsContent>

        {/*
          Goals and coaching sessions are agreed with the fellow; notes are not, and each
          section's caption says which.
        */}
        <TabsContent value="coaching" className="mt-4 flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium">Goals · {coaching.goals.length}</h2>
              <p className="text-xs text-muted-foreground">
                {name}&apos;s own, usually agreed in a coaching session and theirs to change any
                time — including where they say they stand. Read-only here: if an assessment looks
                off, that is a conversation rather than an edit.
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

          <section className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium">
                Coaching sessions · {coaching.sessions.length}
              </h2>
              <p className="text-xs text-muted-foreground">
                The check-in answers are staff-only; completing a session shares a dated snapshot of
                the figures above with {name}.
              </p>
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
                        {formatDate(session.endedAt ?? session.createdAt)}
                      </span>
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

          <section className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium">Notes · {coaching.notes.length}</h2>
              <p className="text-xs text-muted-foreground">
                Staff observations — never shown to fellows. A fellow may still ask to read their
                record, so write what happened and what was decided.
              </p>
            </div>
            <InstructorNotes
              programId={data.program.id}
              studentId={data.student.id}
              notes={coaching.notes}
            />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
