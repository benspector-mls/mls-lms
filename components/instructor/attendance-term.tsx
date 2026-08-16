import Link from "next/link";
import { CalendarRange } from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { TestStudentBadge } from "@/components/test-student-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cohortRate,
  driftList,
  DRIFT_RULE,
  type FellowSummary,
  type SummarySession,
} from "@/lib/attendance/summary";
import { attendanceDayHref, studentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatSchoolDay, formatSchoolDayShort } from "@/lib/school-time";
import { formatPercent } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/lib/generated/prisma/enums";

/**
 * The whole term: who is slipping, and everything behind that answer.
 *
 * **The drift list is the actual answer and the grid is the evidence.** Twenty-five fellows against
 * sixty sessions is fifteen hundred letters, and nobody reads fifteen hundred letters looking for
 * three people. So the short list comes first, with the rule printed beside it so nobody has to
 * wonder what qualified somebody — and the grid sits below for the reader who wants to check.
 *
 * The grid copies `gradebook.tsx` exactly: an `overflow-x-auto` wrapper, a sticky name column,
 * summary columns before the day columns, and removed fellows in a second table below with their
 * own explanation. One thing it does not copy is pinning a second column — see the note there
 * about why the summary columns scroll.
 *
 * A server component with no `"use client"`. Every cell is static and every link is a link.
 */

type Term = {
  sessions: SummarySession[];
  active: FellowSummary[];
  removed: FellowSummary[];
  openDays: string[];
};

const LETTER: Record<AttendanceStatus, string> = {
  PRESENT: "P",
  LATE: "L",
  ABSENT: "A",
  EXCUSED: "E",
};

const LETTER_CLASS: Record<AttendanceStatus, string> = {
  PRESENT: "text-emerald-700 dark:text-emerald-300",
  LATE: "text-amber-700 dark:text-amber-300",
  ABSENT: "text-destructive",
  EXCUSED: "text-muted-foreground",
};

export function AttendanceTerm({ courseId, data }: { courseId: string; data: Term }) {
  if (data.sessions.length === 0) {
    return (
      <EmptyState
        icon={<CalendarRange />}
        title="No sessions yet"
        description="Once you have started a check-in, this is where the term's record builds up."
      />
    );
  }

  const drifting = driftList(data.active, data.sessions);
  const rate = cohortRate(data.active);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">Needs a conversation · {drifting.length}</h2>
          {/*
            The rule, in words, on the screen. A list somebody is expected to act on has to say
            what put a person on it, or the reader is deciding whether to trust an unexplained
            judgement rather than deciding what to do about a fellow.
          */}
          <p className="text-xs text-muted-foreground">
            Missed {DRIFT_RULE.missedAtLeast} or more of the last {DRIFT_RULE.missedOf} sessions, or
            arrived late {DRIFT_RULE.lateAtLeast} times in the last {DRIFT_RULE.lateOf}. Recent
            rather than cumulative, because somebody at 88 percent who has missed this whole week is
            the person to call today.
          </p>
        </div>

        {drifting.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nobody is drifting by that rule.
            {rate !== null && ` The cohort is at ${formatPercent(rate)}.`}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {drifting.map((entry) => (
              <li
                key={entry.summary.fellow.enrollmentId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <Link
                  href={studentHref(courseId, entry.summary.fellow.studentId)}
                  className="font-medium hover:underline"
                >
                  {displayNameOf(entry.summary.fellow, "Unnamed")}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {entry.reason === "missing"
                    ? `${entry.missedRecently} of the last ${DRIFT_RULE.missedOf} missed`
                    : `${entry.lateRecently} lates in the last ${DRIFT_RULE.lateOf}`}
                  {entry.summary.rate !== null && ` · ${formatPercent(entry.summary.rate)} overall`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">Every session</h2>
          <p className="text-xs text-muted-foreground">
            <Legend />
          </p>
        </div>
        <Grid courseId={courseId} sessions={data.sessions} fellows={data.active} />
      </section>

      {data.removed.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium">No longer in the cohort · {data.removed.length}</h2>
            <p className="text-xs text-muted-foreground">
              Kept because they were here for the sessions above, and counted in none of the figures
              on this screen. Days after they left read as not enrolled rather than as absences.
            </p>
          </div>
          <Grid courseId={courseId} sessions={data.sessions} fellows={data.removed} />
        </section>
      )}
    </div>
  );
}

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        <strong className={LETTER_CLASS.PRESENT}>P</strong> present
      </span>
      <span>
        <strong className={LETTER_CLASS.LATE}>L</strong> late
      </span>
      <span>
        <strong className={LETTER_CLASS.EXCUSED}>E</strong> excused, and still counted as missed
      </span>
      <span>
        <strong className={LETTER_CLASS.ABSENT}>A</strong> absent
      </span>
      <span>
        <span className="text-muted-foreground">·</span> not enrolled yet
      </span>
    </span>
  );
}

function Grid({
  courseId,
  sessions,
  fellows,
}: {
  courseId: string;
  sessions: SummarySession[];
  fellows: FellowSummary[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {/*
              Only the name column is pinned. Pinning the summary columns too would leave a phone
              with nothing but frozen columns and no grid — the same note `gradebook.tsx` makes.
            */}
            <TableHead className="sticky left-0 z-10 bg-card">Fellow</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">P</TableHead>
            <TableHead className="text-right">L</TableHead>
            <TableHead className="text-right">E</TableHead>
            <TableHead className="text-right">A</TableHead>
            {sessions.map((session) => (
              <TableHead key={session.id} className="text-center whitespace-nowrap">
                <Link
                  href={attendanceDayHref(courseId, session.day)}
                  className="hover:underline"
                  title={formatSchoolDay(session.day)}
                >
                  {formatSchoolDayShort(session.day)}
                </Link>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {fellows.map((summary) => (
            <TableRow key={summary.fellow.enrollmentId}>
              <TableCell className="sticky left-0 z-10 bg-card">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={studentHref(courseId, summary.fellow.studentId)}
                    className="truncate font-medium hover:underline"
                  >
                    {displayNameOf(summary.fellow, "Unnamed")}
                  </Link>
                  {summary.fellow.testStudentNumber !== null && <TestStudentBadge />}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {/*
                  A test student has a dash rather than a figure. They are excluded from every
                  count on this screen, and a percentage beside a badge saying "not real" would
                  invite somebody to read it as one of the cohort's numbers.
                */}
                {summary.fellow.testStudentNumber !== null || summary.rate === null
                  ? "—"
                  : formatPercent(summary.rate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{summary.present}</TableCell>
              <TableCell className="text-right tabular-nums">{summary.late}</TableCell>
              <TableCell className="text-right tabular-nums">{summary.excused}</TableCell>
              <TableCell className="text-right tabular-nums">
                {summary.absent + summary.unrecorded}
              </TableCell>
              {summary.cells.map((status, index) => (
                <TableCell key={sessions[index].id} className="text-center">
                  {status === null ? (
                    <span className="text-muted-foreground">·</span>
                  ) : (
                    <span className={cn("font-medium", LETTER_CLASS[status])}>
                      {LETTER[status]}
                    </span>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
