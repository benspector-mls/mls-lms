import { Suspense } from "react";
import Link from "next/link";

import { AttendanceDay } from "@/components/instructor/attendance-day";
import { AttendanceDownload } from "@/components/instructor/attendance-download";
import { AttendanceTerm } from "@/components/instructor/attendance-term";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attendanceCsv, attendanceCsvIsEmpty } from "@/lib/attendance/csv";
import { attendanceDayHref } from "@/lib/links";
import { formatSchoolDay } from "@/lib/school-time";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * Attendance: this morning, and the term behind it.
 *
 * **Two tabs, because the screen answers two questions asked at different times of day.** Taking
 * attendance happens once, in the first minutes of class, and wants one board and nothing else in
 * the way. Reading the record — who is drifting, what to send a funder — happens at a desk, later,
 * and wants the whole term at once. They were two addresses reached by a button, which put the
 * question an instructor asks every morning one click away from the one they ask once a month.
 *
 * **No group filter on either tab, and this is the second instructor screen without one.** The
 * roster has none because it is where groups are made; attendance has none for a sharper reason.
 * `resolveGroup` falls back to an instructor's *remembered* grading filter, so somebody who
 * narrowed the gradebook to their fifteen last Tuesday would open this at 9:00 and read "11 of 15"
 * — a number that is wrong about the room while looking entirely correct. Attendance is taken for
 * everybody present, so it reads everybody.
 *
 * Both payloads are fetched here regardless of which tab is open. They are two reads on a screen
 * whose whole content is a roster and a grid, and fetching the second only when it is opened would
 * put a spinner between a click and a table.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function AttendancePage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="full" />}>
      <Attendance params={params} />
    </Suspense>
  );
}

async function Attendance({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const queryClient = getQueryClient();

  const [grid, history] = await Promise.all([
    queryClient.fetchQuery(trpc.attendance.grid.queryOptions({ courseId })),
    queryClient.fetchQuery(trpc.attendance.history.queryOptions({ courseId })),
  ]);

  const sessions = history.sessions.map((session) => ({
    id: session.id,
    day: session.day,
    open: session.state === "open",
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
  // Newest first, and today is the other tab — so it is not repeated in the list.
  const past = [...history.sessions].reverse().filter((session) => session.day !== grid.day);

  return (
    <div className="mx-auto flex w-full flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Attendance" description={history.course.name} />

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="term">The whole term</TabsTrigger>
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
                Every fellow against every session the cohort has held.
              </p>
            </div>
            {attendanceCsvIsEmpty(csvData) ? null : (
              <AttendanceDownload
                csv={attendanceCsv(csvData)}
                cohortTerm={history.course.cohortTerm}
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
            courseId={courseId}
            data={{
              sessions,
              active: history.active,
              removed: history.removed,
              openDays: history.openSessions,
            }}
          />

          {past.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-medium">Earlier sessions · {past.length}</h2>
                <p className="text-xs text-muted-foreground">
                  The same days the grid above is columned by, as a list — any of them can still be
                  corrected. A change made now records today&apos;s date as when it was made, which
                  is the fact an audit asks about.
                </p>
              </div>

              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {past.map((session) => (
                  <li key={session.id}>
                    <Link
                      href={attendanceDayHref(courseId, session.day)}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                    >
                      <span className="font-medium">{formatSchoolDay(session.day)}</span>
                      <span className="text-xs text-muted-foreground">
                        {session.state === "open"
                          ? "Still open"
                          : session.state === "lapsed"
                            ? "Closed on its own"
                            : "Ended"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
