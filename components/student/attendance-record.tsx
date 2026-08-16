import { CalendarCheck } from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { AttendanceStatusBadge } from "@/components/status-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { countsAsAttended } from "@/lib/attendance/summary";
import { formatSchoolDay } from "@/lib/school-time";
import { attendanceSourceLabel, formatPercent } from "@/lib/status";
import type { RouterOutputs } from "@/trpc/types";

/**
 * A fellow's own attendance, in one cohort.
 *
 * **Two questions, in this order: am I in trouble, and which days do I owe an explanation for.**
 * So the figure leads, the missed days come next as their own short list, and the full record is
 * collapsed beneath — sixty rows of "present" is not what anybody opened this to read.
 *
 * **It says out loud that an excused absence still counts as missed.** A fellow who sees Excused
 * beside a rate that did not move deserves to be told why by the screen rather than by working it
 * out, and it is the kind of rule people are owed in plain words before it matters to them.
 *
 * A server component. Every row is text.
 */

type Record = RouterOutputs["attendance"]["myHistory"];

export function StudentAttendanceRecord({ data }: { data: Record }) {
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

  const missed = data.days.filter(
    (day) => day.state !== "open" && (day.status === null || !countsAsAttended(day.status)),
  );
  const rest = data.days.filter((day) => !missed.includes(day));

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

      {missed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Days you missed · {missed.length}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {missed.map((day) => (
              <Row key={day.id} day={day} />
            ))}
          </ul>
        </section>
      )}

      <Collapsible>
        <CollapsibleTrigger className="self-start text-sm text-muted-foreground underline-offset-4 hover:underline">
          Every session · {data.days.length}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rest.map((day) => (
              <Row key={day.id} day={day} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function Row({ day }: { day: Record["days"][number] }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <span className="font-medium">{formatSchoolDay(day.day)}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {day.note && <span className="max-w-60 truncate">{day.note}</span>}
        <span>
          {day.state === "open"
            ? "Check-in is open"
            : attendanceSourceLabel(day.source ?? "FINALIZED", day.recordedByName)}
        </span>
        {day.status ? (
          <AttendanceStatusBadge status={day.status} />
        ) : day.state !== "open" ? (
          <AttendanceStatusBadge status="ABSENT" />
        ) : null}
      </span>
    </li>
  );
}
