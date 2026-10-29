"use client";

import { CoachingTopics } from "@/components/coaching-topics";
import { FellowGoals } from "@/components/instructor/fellow-goals";
import { AttendanceFigures, calendarDaysOf } from "@/components/instructor/fellow-attendance";
import { GcfHistory } from "@/components/instructor/gcf-history";
import { AttendanceCalendar } from "@/components/student/attendance-calendar";
import { Badge } from "@/components/ui/badge";
import type { LayoutPanel } from "@/lib/coaching";
import type { SchoolDay } from "@/lib/school-time";
import type { RouterOutputs } from "@/trpc/types";

type SessionData = RouterOutputs["coaching"]["session"];

/**
 * One data panel of a coaching form: a part of the fellow's record drawn where the form's layout
 * places it, under the heading and caption the admin gave it.
 *
 * **A panel records nothing.** Every one draws what the record already holds, through the same
 * component the record draws it with, so the form and the record cannot disagree. Discussion
 * topics are drawn on a draft only: a completed session is the record of one conversation, and the
 * fellow's current list is not part of it.
 */
export function DataPanel({
  item,
  data,
  programId,
  completed,
  today,
}: {
  item: LayoutPanel;
  data: SessionData;
  programId: string;
  completed: boolean;
  /** Read once by the page and handed down, so the server and the browser agree which square is today. */
  today: SchoolDay;
}) {
  if (item.kind === "TOPICS" && completed) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">
            {item.heading}
            {item.kind === "TOPICS" && ` · ${data.topics.length}`}
            {item.kind === "GOALS" && ` · ${data.goals.length}`}
            {item.kind === "GCF" && ` · ${data.gcf.length}`}
          </h3>
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {item.kind === "TOPICS" || item.kind === "GOALS" ? "Theirs" : "Staff only"}
          </Badge>
        </div>
        {item.caption && <p className="text-xs text-muted-foreground">{item.caption}</p>}
      </div>
      <Panel item={item} data={data} programId={programId} today={today} />
    </section>
  );
}

function Panel({
  item,
  data,
  programId,
  today,
}: {
  item: LayoutPanel;
  data: SessionData;
  programId: string;
  today: SchoolDay;
}) {
  switch (item.kind) {
    case "TOPICS":
      return (
        <CoachingTopics
          topics={data.topics}
          programId={programId}
          editable={false}
          empty="They have not added anything for this session."
        />
      );
    case "GOALS":
      return (
        <FellowGoals
          goals={data.goals}
          programId={programId}
          empty="They have not set any goals yet."
        />
      );
    case "GCF":
      return <GcfHistory attempts={data.gcf} />;
    case "ATTENDANCE_CALENDAR":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-4">
            <AttendanceFigures summary={data.figures.attendance} />
          </div>
          {data.days.length > 0 && (
            <AttendanceCalendar
              days={calendarDaysOf(data.days)}
              enrolledFrom={data.enrolledFrom}
              today={today}
            />
          )}
        </div>
      );
  }
}
