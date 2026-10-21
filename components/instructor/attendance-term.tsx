import { CalendarRange } from "lucide-react";

import { AttendanceGrid, LETTER_CLASS } from "@/components/instructor/attendance-grid";
import { EmptyState } from "@/components/list-states";
import type { ArrivalAverages } from "@/lib/attendance/arrival";
import type { FellowSummary, SummarySession } from "@/lib/attendance/summary";

/**
 * The whole term: every fellow against every session, and when each of them usually arrives.
 *
 * **The grid is the record, and the Performance screen is where an instructor reads who needs
 * support.** Twenty-five fellows against sixty sessions is fifteen hundred letters, and nobody reads
 * fifteen hundred letters looking for three people. Performance applies the attendance drift rule
 * beside the fellow's work, so a fellow who is slipping is named on one screen for everything rather
 * than on one screen per kind of problem. This tab is for checking that answer against the mornings
 * themselves, correcting a morning, and exporting the term.
 *
 * **When people arrive is a column of the grid rather than a list.** One check-in a day would
 * otherwise hide who arrives late — a fellow marked present at 10:47 every Monday has a perfect
 * record and a problem. A list of it was a row per
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
        description="Upcoming days are under Schedule."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
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
              Not counted in the figures above. Days after they left show as not enrolled.
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
