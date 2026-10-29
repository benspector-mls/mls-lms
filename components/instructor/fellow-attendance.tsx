import type { CalendarDay } from "@/components/student/attendance-calendar";
import type { AttendanceStatus, AttendanceSource } from "@/lib/generated/prisma/enums";
import type { SchoolDay } from "@/lib/school-time";
import { attendanceProvenance, formatPercent } from "@/lib/status";

/** One day as `attendanceStandingFor` returns it, before the calendar's sentence is composed. */
export type AttendanceDayRow = {
  day: SchoolDay;
  status: AttendanceStatus | null;
  open: boolean;
  upcoming: boolean;
  source: AttendanceSource | null;
  checkedInAt: Date | null;
  note: string | null;
  recordedByName: string | null;
};

/**
 * The fellow's own calendar, drawn for their instructor: each square's tooltip sentence is
 * composed here, as the fellow's record composes it, because turning a source and a timestamp
 * into words needs the school's timezone and the calendar itself is a client component. The
 * record's Performance tab and the coaching form's attendance panel both call this, so the two
 * draw the same square the same way.
 */
export function calendarDaysOf(days: readonly AttendanceDayRow[]): CalendarDay[] {
  return days.map((day) => ({
    day: day.day,
    status: day.status,
    open: day.open,
    upcoming: day.upcoming,
    detail: day.status ? attendanceProvenance(day) : null,
    note: day.note,
  }));
}

/** The term's attendance in two lines: the rate, and the count of each status. */
export function AttendanceFigures({
  summary,
}: {
  summary: {
    eligible: number;
    present: number;
    late: number;
    excused: number;
    absent: number;
    unrecorded: number;
    rate: number | null;
  };
}) {
  return (
    <>
      <p className="text-sm">
        {summary.rate === null ? (
          <>Nothing has been counted yet.</>
        ) : (
          <>
            Here for{" "}
            <span className="font-semibold">
              {summary.present + summary.late} of {summary.eligible}
            </span>{" "}
            mornings since they joined.{" "}
            <span className="font-semibold">{formatPercent(summary.rate)}</span>
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        Present {summary.present} · Late {summary.late} · Excused {summary.excused} · Absent{" "}
        {summary.absent + summary.unrecorded}
        {summary.excused > 0 && ". An excused morning still counts as missed."}
      </p>
    </>
  );
}
