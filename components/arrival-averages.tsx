import { Clock } from "lucide-react";

import { arrivalSentence, MIN_ARRIVALS, type ArrivalAverages } from "@/lib/attendance/arrival";
import { formatClockMinutes } from "@/lib/school-time";
import { cn } from "@/lib/utils";

/**
 * When somebody arrives: overall, and by day of the week.
 *
 * **This is what replaced per-course attendance detail.** Attendance used to be taken once per
 * course, so three courses meeting on a Tuesday produced three records of one morning — and the only
 * thing that bought was noticing that somebody was reliably late to the nine o'clock. One check-in a
 * day loses that, and it is recovered here as the fact it actually was: not which course they were
 * late to, but which morning of the week they arrive late on.
 *
 * **The sentence and the table say the same thing at two grains, deliberately.** The sentence is the
 * finding — "on average they check in at 10:20, but on Mondays at 10:47" — and it is what somebody
 * reads. The table is the evidence, and it is what somebody checks before saying it to a fellow.
 * `arrivalSentence` composes the first so all three screens that show this cannot word it differently.
 *
 * **A weekday with fewer than three check-ins reports nothing rather than an average.** A mean over
 * one morning is a number somebody would quote, and quoting it would be wrong. The count is shown
 * beside every weekday whether or not it was enough, so a blank reads as "not yet" rather than as
 * "never late".
 *
 * A server component: every value is already computed and nothing here is interactive.
 */
export function ArrivalAveragesPanel({
  averages,
  /** Rendered instead of the panel when nobody has checked in enough times to say anything. */
  emptyNote = "Not enough check-ins yet to say when they arrive.",
  className,
}: {
  averages: ArrivalAverages;
  emptyNote?: string;
  className?: string;
}) {
  const sentence = arrivalSentence(averages);

  if (sentence === null) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {emptyNote} An average needs {MIN_ARRIVALS} of them.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="flex items-start gap-2 text-sm">
        <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>{sentence}</span>
      </p>

      <div className="overflow-x-auto">
        <div className="flex min-w-0 gap-1">
          {averages.byWeekday.map((entry) => (
            <div
              key={entry.weekday}
              className="flex min-w-16 flex-1 flex-col items-center gap-0.5 rounded-md border border-border px-2 py-1.5"
            >
              <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                {/* Three letters, because seven full weekday names do not fit a phone. */}
                {entry.label.slice(0, 3)}
              </span>
              <span className="text-sm font-medium tabular-nums whitespace-nowrap">
                {entry.average.minutes === null ? "—" : formatClockMinutes(entry.average.minutes)}
              </span>
              <span className="text-[0.65rem] tabular-nums text-muted-foreground">
                {entry.average.count === 0
                  ? "none"
                  : `${entry.average.count} ${entry.average.count === 1 ? "day" : "days"}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Only mornings they checked in are counted, so an absence neither raises nor lowers these.
        The day of the week comes from the session rather than from the moment they typed the code.
        A weekday with fewer than {MIN_ARRIVALS} check-ins shows no average.
      </p>
    </div>
  );
}
