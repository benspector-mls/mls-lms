import { Suspense } from "react";

import { AttendanceCalendar } from "@/components/instructor/attendance-calendar";
import { AttendanceDay } from "@/components/instructor/attendance-day";
import { ProgramLateness } from "@/components/instructor/program-lateness";
import { ProgramSchedule } from "@/components/instructor/program-schedule";
import { AttendanceDownload } from "@/components/instructor/attendance-download";
import { AttendanceTerm } from "@/components/instructor/attendance-term";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attendanceCsv, attendanceCsvIsEmpty } from "@/lib/attendance/csv";
import { formatSchoolDay } from "@/lib/school-time";
import { getQueryClient, trpc } from "@/trpc/server";
import { stateIsUnsettled } from "@/lib/attendance/window";

/**
 * Attendance: this morning, and the term behind it.
 *
 * **Two tabs, because the screen answers two questions asked at different times of day.** Taking
 * attendance happens once, in the first minutes of class, and wants one board and nothing else in
 * the way. Reading the record — who is drifting, what to send a funder — happens at a desk, later,
 * and wants the whole term at once. They were two addresses reached by a button, which put the
 * question an instructor asks every morning one click away from the one they ask once a month.
 *
 * **No cohort filter on either tab.** The roster has none because it is where cohorts are made;
 * attendance has none for a sharper reason. `resolveCohort` falls back to an
 * instructor's *remembered* grading filter, so somebody who narrowed the gradebook to their fifteen
 * last Tuesday would open this at 9:00 and read "11 of 15" — a number that is wrong about the room
 * while looking entirely correct. Attendance is taken for everybody present, so it reads everybody.
 *
 * Both payloads are fetched here regardless of which tab is open. They are two reads on a screen
 * whose whole content is a roster and a grid, and fetching the second only when it is opened would
 * put a spinner between a click and a table.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function AttendancePage({ params }: { params: Promise<{ programId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="full" />}>
      <Attendance params={params} />
    </Suspense>
  );
}

async function Attendance({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const queryClient = getQueryClient();

  const [grid, history] = await Promise.all([
    queryClient.fetchQuery(trpc.attendance.grid.queryOptions({ programId })),
    queryClient.fetchQuery(trpc.attendance.history.queryOptions({ programId })),
  ]);

  /*
    A session whose check-in has not opened is reported the same way an open one is — nothing about
    it is settled. It is the stronger case, in fact: an open morning might yet be missed, while a
    prepared one could not have been attended by anybody. Collapsing the two here is what stops the
    export printing ABSENT against every fellow for a day whose code was made and never used, which
    would be a wrong number in the file a funder reads.
  */
  const sessions = history.sessions.map((session) => ({
    id: session.id,
    day: session.day,
    unsettled: stateIsUnsettled(session.state),
  }));

  /*
    Active first, then removed, matching the screen — and each carries its enrollment as a column,
    because a column survives being sorted and a section heading does not.
  */
  const csvData = {
    sessions,
    fellows: [
      ...history.active.map((summary) => ({
        enrollmentId: summary.fellow.enrollmentId,
        person: summary.fellow,
        enrollment: "Active",
        enrolledFrom: summary.fellow.enrolledFrom,
      })),
      ...history.removed.map((summary) => ({
        enrollmentId: summary.fellow.enrollmentId,
        person: summary.fellow,
        enrollment: "Removed",
        enrolledFrom: summary.fellow.enrolledFrom,
      })),
    ],
    records: history.records,
  };

  const days = sessions.map((session) => session.day);

  /*
    The days behind and including today, for the calendar. It fetches the days ahead itself, from
    `upcoming` — `history` deliberately carries nothing past today, and the calendar is the one
    place on this screen that wants both halves.
  */
  const throughToday = history.sessions.map((session) => ({ day: session.day, state: session.state }));

  return (
    <div className="mx-auto flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Attendance" description={history.program.name} />

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="term">The whole term</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
        </TabsList>

        {/*
          Constrained where the board is and full width where the grid is. A roster of
          twenty-five names stretched across a wide monitor is harder to read down, and a term of
          sixty sessions squeezed into the same column is scrolled sideways for no reason.
        */}
        <TabsContent value="today" className="mt-4">
          <div className="flex w-full max-w-5xl flex-col gap-6">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium">{formatSchoolDay(grid.day)}</h2>
            </div>
            <AttendanceDay data={grid} />
          </div>
        </TabsContent>

        <TabsContent value="term" className="mt-4 flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-sm font-medium">
                {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
              </h2>
              <p className="text-xs text-muted-foreground">
                Every fellow against every day the program has held.
              </p>
            </div>
            {attendanceCsvIsEmpty(csvData) ? null : (
              <AttendanceDownload
                csv={attendanceCsv(csvData)}
                term={history.program.term}
                from={days[0] ?? null}
                to={days[days.length - 1] ?? null}
              />
            )}
          </div>

          {history.openSessions.length > 0 && (
            <p className="rounded-lg border border-amber-500/40 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              {history.openSessions.length}{" "}
              {history.openSessions.length === 1 ? "session is" : "sessions are"} still open, so
              nobody is counted absent for {history.openSessions.length === 1 ? "it" : "them"} yet.
              They are left out of every rate on this tab until somebody ends them.
            </p>
          )}

          <AttendanceTerm
            programId={programId}
            data={{
              sessions,
              active: history.active,
              removed: history.removed,
              openDays: history.openSessions,
              arrivals: history.arrivals,
            }}
          />
        </TabsContent>

        {/*
          When the program meets, and the days that rule produced.

          **The rule and its exceptions on one screen**, which is the whole reason this tab exists.
          The rule was on the program's settings screen and the exceptions were under the term
          grid, so maintaining the calendar meant two screens — and cancelling tomorrow's class
          meant a detour past the button that deletes the program.

          Last of the three because it is the least visited. Taking attendance happens every
          morning and reading the record happens weekly; this is opened at the start of a term and
          on the days it snows.
        */}
        <TabsContent value="schedule" className="mt-4">
          <div className="flex w-full max-w-5xl flex-col gap-6">
            <ProgramSchedule program={grid.program} />
            <ProgramLateness program={grid.program} />
            <AttendanceCalendar
              programId={programId}
              throughToday={throughToday}
              today={grid.day}
              hasSchedule={grid.program.hasSchedule}
              startsAt={grid.program.attendanceStartsAt}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
