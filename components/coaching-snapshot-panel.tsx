import { formatPercent } from "@/lib/status";
import type { CoachingSnapshot } from "@/lib/coaching";
import { cn } from "@/lib/utils";

/**
 * One `CoachingSnapshot`, rendered — the single component behind every surface that shows one.
 *
 * The session form's strip renders the figures that completing will record, and the fellow's
 * coaching history renders the ones a past session did record: one JSON shape, one renderer, so
 * the preview and the record cannot read differently. `compact` is the strip's density.
 *
 * Verdict words and figure tinting follow the student record's own reading: late carries weight
 * but no colour, missing is red, and a course with no released work shows no figures because none
 * of nothing is not a figure.
 */
export function CoachingSnapshotPanel({
  snapshot,
  compact = false,
}: {
  snapshot: CoachingSnapshot;
  compact?: boolean;
}) {
  const attendance = snapshot.attendance;
  const missed = attendance.absent + attendance.unrecorded;

  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-3")}>
      <p className={cn("text-sm", compact && "text-xs")}>
        <span className="font-semibold">
          Here for {attendance.present + attendance.late} of {attendance.eligible} mornings
        </span>
        {attendance.rate !== null && (
          <span className="text-muted-foreground"> · {formatPercent(attendance.rate)}</span>
        )}
        <span className="text-muted-foreground">
          {" "}
          · Present {attendance.present} · Late {attendance.late} · Excused {attendance.excused} ·
          Absent {missed}
        </span>
      </p>

      <ul className={cn("flex flex-col", compact ? "gap-0.5" : "gap-1.5")}>
        {snapshot.courses.map((course) => (
          <li
            key={course.courseId}
            className={cn(
              "flex flex-wrap items-baseline gap-x-3 gap-y-0.5",
              compact ? "text-xs" : "text-sm",
            )}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{course.name}</span>
            {course.completedAssignments.possible > 0 ? (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {course.completedAssignments.complete}/{course.completedAssignments.possible}{" "}
                assignments
                {" · "}
                <span className={cn(course.missing > 0 && "font-medium text-destructive")}>
                  {course.missing} missing
                </span>
                {" · "}
                <span className={cn(course.late > 0 && "font-medium text-foreground")}>
                  {course.late} late
                </span>
              </span>
            ) : (
              <span className="shrink-0 text-muted-foreground">No released work yet</span>
            )}
            <span
              className={cn(
                "shrink-0 text-xs",
                course.verdict === "complete"
                  ? "font-medium text-emerald-700 dark:text-emerald-300"
                  : "text-muted-foreground",
              )}
            >
              {course.verdict === "complete"
                ? "Complete"
                : course.verdict === "incomplete"
                  ? "Fell short"
                  : "Not finished"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
