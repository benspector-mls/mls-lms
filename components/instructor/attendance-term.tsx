import Link from "next/link";
import { CalendarRange } from "lucide-react";

import { AttendanceGrid, LETTER_CLASS } from "@/components/instructor/attendance-grid";
import { EmptyState } from "@/components/list-states";
import type { ArrivalAverages } from "@/lib/attendance/arrival";
import {
  driftList,
  DRIFT_RULE,
  programRate,
  type FellowSummary,
  type SummarySession,
} from "@/lib/attendance/summary";
import { programStudentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatPercent } from "@/lib/status";

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
 * The grid is `AttendanceGrid`, which opens on the last two weeks and brings the earlier dates in
 * on request; removed fellows get a second one below with their own explanation.
 *
 * A server component with no `"use client"`; the grid is a client island for the one piece of
 * state its arrow holds.
 */

type Term = {
  sessions: SummarySession[];
  active: FellowSummary[];
  removed: FellowSummary[];
  openDays: string[];
  /** One fellow's arrival averages, by enrollment id. See `lib/attendance/arrival.ts`. */
  arrivals: Record<string, ArrivalAverages>;
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
        <AttendanceGrid
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
          <AttendanceGrid
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
