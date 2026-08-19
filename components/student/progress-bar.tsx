"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  completeCount,
  progressSegments,
  segmentTooltip,
  type ProgressAssignment,
} from "@/lib/student/progress";
import { cn } from "@/lib/utils";

/**
 * Where a course stands, in one line.
 *
 * **The bar is decoration and the text below it is the content.** The bar is `aria-hidden`, the
 * count and the legend are real text, and nothing is said in colour alone — which is what makes
 * this readable on a phone, where there is no hover, and to a screen reader, where there is no
 * bar. The tooltips are a convenience for a mouse and carry nothing the legend does not.
 *
 * The colours are the tone system's, and `lib/student/progress.ts` owns the mapping. Two things
 * follow from putting it there rather than here: the bar cannot come to disagree with the status
 * badges directly beneath it, and the count beside the bar is the same function as the green
 * segment rather than a second reading of what "complete" means.
 */
export function CourseProgressBar({
  assignments,
  label,
  nouns = { one: "assignment", many: "assignments" },
}: {
  assignments: readonly ProgressAssignment[];
  /** What this bar is about, where a course shows more than one. */
  label?: string;
  /** What the work is called, so a project's bar does not call its deliverables assignments. */
  nouns?: { one: string; many: string };
}) {
  const segments = progressSegments(assignments);
  const complete = completeCount(assignments);

  if (segments.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      {/*
        `flex` with a grow per segment rather than percentage widths, so the segments always fill
        the bar exactly. Rounding five percentages to two decimal places leaves a hairline of
        background at the end, which reads as a sixth state.
      */}
      <div
        aria-hidden="true"
        className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted"
      >
        {segments.map((segment) => (
          <Tooltip key={segment.state}>
            <TooltipTrigger
              render={
                <div
                  className={cn(
                    "h-full first:rounded-l-full last:rounded-r-full",
                    segment.className,
                  )}
                  style={{ flexGrow: segment.count }}
                />
              }
            />
            <TooltipContent>{segmentTooltip(segment, nouns)}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {/*
          The count first and in the foreground colour, because it is the one number a student is
          looking for and the rest of the line is the breakdown behind it.
        */}
        <span className="font-medium text-foreground">
          {complete} of {assignments.length} {nouns.many} complete
        </span>

        {/*
          The legend, which is what makes the bar honest without a pointer. Only the segments that
          exist appear, so a course nobody has been graded in does not list two graded states at
          zero and imply the student is failing something.
        */}
        {segments.map((segment) => (
          <span key={segment.state} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              className={cn("size-2 shrink-0 rounded-full", segment.dotClassName)}
            />
            {segment.count} {segment.label.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
