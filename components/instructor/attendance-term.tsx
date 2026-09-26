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
  stickyColumn,
  stickyColumnContent,
  stickyHeader,
  stickyHeaderContainer,
} from "@/components/ui/table";
import { arrivalSentence, type ArrivalAverages } from "@/lib/attendance/arrival";
import {
  dailyRates,
  driftList,
  DRIFT_RULE,
  programRate,
  type FellowSummary,
  type SummarySession,
} from "@/lib/attendance/summary";
import { attendanceDayHref, programStudentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatClockMinutes, formatSchoolDay, formatSchoolDayShort } from "@/lib/school-time";
import { formatPercent } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/lib/generated/prisma/enums";

/**
 * The whole term: who is slipping, when people arrive, and everything behind both answers.
 *
 * **The drift list is the actual answer and the grid is the evidence.** Twenty-five fellows against
 * sixty sessions is fifteen hundred letters, and nobody reads fifteen hundred letters looking for
 * three people. So the short list comes first, with the rule printed beside it so nobody has to
 * wonder what qualified somebody — and the grid sits below for the reader who wants to check.
 *
 * **When people arrive is a column of the grid rather than a list.** Drift is about who is missing;
 * arrival is about who is late, which one check-in a day would otherwise have hidden — a fellow
 * marked present at 10:47 every Monday has a perfect record and a problem. A list of it was a row per
 * fellow for a roster that mostly arrives on time, so the average sits beside the rate, where a
 * reader scanning down a column sees the one late figure among the nine o'clocks. The weekday detail
 * is on the fellow's own record, and the hover on the cell says it in a sentence.
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
  /** One fellow's arrival averages, by enrollment id. See `lib/attendance/arrival.ts`. */
  arrivals: Record<string, ArrivalAverages>;
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

export function AttendanceTerm({ programId, data }: { programId: string; data: Term }) {
  /*
    Nothing has been held yet. It points at Schedule rather than saying only that the tab is empty:
    a program whose term starts next Monday has done nothing wrong, and the days it will hold are
    already made and visible one tab away.
  */
  if (data.sessions.length === 0) {
    return (
      <EmptyState
        icon={<CalendarRange />}
        title="No sessions yet"
        description="Once a day has been held, this is where the term's record builds up. The days still to come are under Schedule."
      />
    );
  }

  const drifting = driftList(data.active, data.sessions);
  const rate = programRate(data.active);

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
            {rate !== null && ` The roster is at ${formatPercent(rate)}.`}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {drifting.map((entry) => (
              <li
                key={entry.summary.fellow.enrollmentId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <Link
                  href={programStudentHref(programId, entry.summary.fellow.studentId)}
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
        <Grid
          programId={programId}
          sessions={data.sessions}
          fellows={data.active}
          arrivals={data.arrivals}
        />
      </section>

      {data.removed.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium">No longer on the roster · {data.removed.length}</h2>
            <p className="text-xs text-muted-foreground">
              Kept because they were here for the sessions above, and counted in none of the figures
              on this screen. Days after they left read as not enrolled rather than as absences.
            </p>
          </div>
          <Grid
            programId={programId}
            sessions={data.sessions}
            fellows={data.removed}
            arrivals={data.arrivals}
          />
        </section>
      )}
    </div>
  );
}

/**
 * When this fellow usually checks in, as one clock time, with the weekday sentence on hover.
 *
 * A dash until there are enough check-ins for an average — `MIN_ARRIVALS` of them — for the reason
 * `arrival.ts` gives: a mean over one morning is a number somebody would quote. The sentence in the
 * title is `arrivalSentence`, the same words the fellow's record prints, so the two cannot differ.
 */
function ArrivesCell({ averages }: { averages: ArrivalAverages | undefined }) {
  const minutes = averages?.overall.minutes ?? null;
  const sentence = averages ? arrivalSentence(averages) : null;

  return (
    <TableCell className="text-right tabular-nums whitespace-nowrap" title={sentence ?? undefined}>
      {minutes === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        formatClockMinutes(minutes)
      )}
    </TableCell>
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
  programId,
  sessions,
  fellows,
  arrivals,
}: {
  programId: string;
  sessions: SummarySession[];
  fellows: FellowSummary[];
  arrivals: Record<string, ArrivalAverages>;
}) {
  // One figure per column, from the same summaries the letters below come from. See `dailyRates`.
  const rates = dailyRates(sessions, fellows);

  /*
    The border's `overflow-hidden` is not a scroller: the container inside `Table` scrolls both
    axes, and this div's overflow only clips the opaque frozen cells to the rounded corner. The
    same arrangement `gradebook-grid.tsx` uses, and the note there explains it at length.
  */
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table containerClassName={stickyHeaderContainer}>
        <TableHeader className={stickyHeader}>
          <TableRow>
            {/*
              Only the name column is pinned. Pinning the summary columns too would leave a phone
              with nothing but frozen columns and no grid — the same note `gradebook.tsx` makes.
            */}
            <TableHead className={stickyColumn}>Fellow</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Arrives</TableHead>
            <TableHead className="text-right">P</TableHead>
            <TableHead className="text-right">L</TableHead>
            <TableHead className="text-right">E</TableHead>
            <TableHead className="text-right">A</TableHead>
            {sessions.map((session) => (
              <TableHead key={session.id} className="text-center whitespace-nowrap">
                <Link
                  href={attendanceDayHref(programId, session.day)}
                  className="hover:underline"
                  title={formatSchoolDay(session.day)}
                >
                  {formatSchoolDayShort(session.day)}
                </Link>
              </TableHead>
            ))}
          </TableRow>
          {/*
            How much of the roster turned up each day, directly under the date and above the
            fellows.

            **In the header group, so it stays put with the dates.** Reading down a column of
            letters is reading one morning, and the figure that says how that morning went as a
            whole is the thing to keep in view while doing it — a rate that scrolled away with the
            rows was gone by the time the reader reached the fellow they were looking for. The
            cells stay `<th>`s, so each one says what its column is about rather than naming a
            fellow, and the row takes no hover.
          */}
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(stickyColumn, "text-xs font-normal text-muted-foreground")}>
              Attendance rate
            </TableHead>
            <TableHead />
            <TableHead />
            <TableHead />
            <TableHead />
            <TableHead />
            <TableHead />
            {rates.map((rate, index) => (
              <TableHead
                key={sessions[index].id}
                className="text-center text-xs font-medium tabular-nums text-muted-foreground"
              >
                {/*
                  A dash where a fellow's own rate would show one: a day still running or still to
                  come has settled nothing, and a figure over a moving denominator is worse than
                  no figure.
                */}
                {rate === null ? "—" : formatPercent(rate)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {fellows.map((summary) => (
            <TableRow key={summary.fellow.enrollmentId}>
              <TableCell className={stickyColumn}>
                <div className={stickyColumnContent}>
                  {summary.fellow.testStudentNumber !== null && <TestStudentBadge />}
                  <Link
                    href={programStudentHref(programId, summary.fellow.studentId)}
                    className="font-medium hover:underline"
                  >
                    {displayNameOf(summary.fellow, "Unnamed")}
                  </Link>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {/*
                  A test student has a dash rather than a figure. They are excluded from every
                  count on this screen, and a percentage beside a badge saying "not real" would
                  invite somebody to read it as one of the roster's numbers.
                */}
                {summary.fellow.testStudentNumber !== null || summary.rate === null
                  ? "—"
                  : formatPercent(summary.rate)}
              </TableCell>
              <ArrivesCell averages={arrivals[summary.fellow.enrollmentId]} />
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
