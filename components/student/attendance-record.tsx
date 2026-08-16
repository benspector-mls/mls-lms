import { CalendarCheck } from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { AttendanceCalendar } from "@/components/student/attendance-calendar";
import { formatSchoolDay, formatSchoolTime, type SchoolDay } from "@/lib/school-time";
import { attendanceSourceLabel, formatPercent } from "@/lib/status";
import type { RouterOutputs } from "@/trpc/types";

/**
 * A fellow's own attendance, in one cohort.
 *
 * **Two things, in this order: how much of the term you have been here for, and the term itself.**
 * The figure leads because it is the question somebody opens this to ask, and the calendar carries
 * the rest.
 *
 * **A list of missed days used to sit between them, and it went because it said twice what the
 * calendar says once.** Red and amber squares are the missed days; the list repeated them as rows.
 * What it had that they did not was the note and who recorded the mark, so those moved into the
 * square's tooltip rather than being lost — see `AttendanceCalendar`.
 *
 * **It says out loud that an excused absence still counts as missed.** A fellow who sees Excused
 * beside a rate that did not move deserves to be told why by the screen rather than by working it
 * out, and it is the kind of rule people are owed in plain words before it matters to them.
 *
 * A server component, which is what lets it compose the provenance sentence: turning a source and
 * a timestamp into words needs the school's timezone, and the calendar below is a client component.
 */

type Record = RouterOutputs["attendance"]["myHistory"];

export function StudentAttendanceRecord({ data, today }: { data: Record; today: SchoolDay }) {
  const { summary } = data;

  if (data.days.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheck />}
        title="No sessions yet"
        description="Once your instructor takes attendance, your record appears here."
      />
    );
  }

  const calendarDays = data.days.map((day) => ({
    day: day.day,
    status: day.status,
    open: day.state === "open",
    detail: day.state === "open" ? null : provenance(day),
    note: day.note,
  }));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm">
          {summary.rate === null ? (
            <>Nothing has been counted yet.</>
          ) : (
            <>
              You have been here for{" "}
              <span className="font-semibold">
                {summary.present + summary.late} of {summary.eligible}
              </span>{" "}
              sessions since you joined on {formatSchoolDay(data.enrolledFrom)}.{" "}
              <span className="font-semibold">{formatPercent(summary.rate)}</span>
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Present {summary.present} · Late {summary.late} · Excused {summary.excused} · Absent{" "}
          {summary.absent + summary.unrecorded}
          {summary.excused > 0 && " — an excused session still counts as one you missed."}
        </p>
      </section>

      <AttendanceCalendar days={calendarDays} enrolledFrom={data.enrolledFrom} today={today} />
    </div>
  );
}

/**
 * Where one day's mark came from, in words.
 *
 * "checked in at 9:02" and "marked by Ben Spector" are different claims about the same status, and
 * the difference is the one a fellow asks about when they disagree with a row.
 */
function provenance(day: Record["days"][number]): string {
  const source = attendanceSourceLabel(day.source ?? "FINALIZED", day.recordedByName);
  return day.checkedInAt ? `${source} at ${formatSchoolTime(day.checkedInAt)}` : source;
}
