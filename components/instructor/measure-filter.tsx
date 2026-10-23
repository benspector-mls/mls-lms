"use client";

import { SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  chosenMeasures,
  MEASURE_LABEL,
  MEASURES,
  MEASURES_PARAM,
  type Measure,
} from "@/lib/programs/performance";

/** The coloured columns each measure covers, so a reader can tell Submissions from Completion. */
const COVERS: Record<Measure, string> = {
  attendance: "Attendance Rate, Recent Absence, Recent Tardiness",
  deadlines: "Deadlines Hit, and each course’s Recent Deadlines Hit",
  submissions: "Assignments Submitted",
  completion: "Graded … Completed, and each course’s Recently Completed",
};

/**
 * Which measures place a fellow in a group on the Performance grid.
 *
 * **It decides what is read, not what is drawn.** Every column stays on the grid. A column of a
 * measure left out is never coloured, and the groups, the worst-first order and the Performance
 * Summary read only the measures chosen, so an instructor can ask who needs support for attendance
 * and deadlines and get a Needs support group that holds nobody who is there for completion alone.
 *
 * **The choice lives in the query string**, as the course filter's does, so a narrowed grid can be
 * linked and survives a reload. It is forgotten between visits for the same reason the course
 * choice is: which measures to read is a question of the moment.
 *
 * **The last ticked measure cannot be unticked.** A grid reading no measure would file every
 * fellow under too early to say, which answers no question.
 */
export function MeasureFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chosen = chosenMeasures(searchParams.get(MEASURES_PARAM));
  const narrowed = chosen.size < MEASURES.length;

  // Every measure is written as no parameter at all, so the plain address stays the default.
  function choose(next: ReadonlySet<Measure>) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.size === MEASURES.length) params.delete(MEASURES_PARAM);
    else params.set(MEASURES_PARAM, MEASURES.filter((measure) => next.has(measure)).join(","));
    const query = params.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  }

  function toggle(measure: Measure, checked: boolean) {
    const next = new Set(chosen);
    if (checked) next.add(measure);
    else next.delete(measure);
    choose(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Choose which measures to read"
          >
            <SlidersHorizontal data-icon="inline-start" />
            {narrowed ? `${chosen.size} of ${MEASURES.length} measures` : "All measures"}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Which measures place a fellow in a group. Columns of a measure left out stay on the
            grid and are never coloured.
          </DropdownMenuLabel>
          {MEASURES.map((measure) => (
            <DropdownMenuCheckboxItem
              key={measure}
              checked={chosen.has(measure)}
              disabled={chosen.has(measure) && chosen.size === 1}
              onCheckedChange={(checked) => toggle(measure, checked)}
              // Kept open, since choosing measures is usually several presses in a row.
              closeOnClick={false}
            >
              <span className="flex min-w-0 flex-col">
                <span>{MEASURE_LABEL[measure]}</span>
                <span className="truncate text-xs text-muted-foreground">{COVERS[measure]}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {narrowed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => choose(new Set(MEASURES))}>
              Read every measure
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
