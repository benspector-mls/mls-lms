"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { NotebookPen } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gradingQueueHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * Which assignment the grading queue beside this is open on, switchable to another in the course.
 *
 * Grouped by module, in curriculum order — the same shape `courseUnits.listForCourse` already
 * computes for the Curriculum screen's own tree, read here rather than recomputed: a unit, the
 * work in it, in the order an instructor put it in.
 *
 * The assignment is a segment of the address, not a query parameter, so choosing one is a
 * navigation rather than a filter — `gradingQueueHref` builds the same path a breadcrumb or a
 * triage link would.
 */
export function AssignmentPicker({
  courseId,
  assignmentId,
  assignmentTitle,
  className,
}: {
  courseId: string;
  /** The assignment this queue is currently open on. */
  assignmentId: string;
  /** Known already from the page this queue was built for, so the trigger never renders blank
   * while the fuller list is still in flight. */
  assignmentTitle: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();

  const units = useQuery(trpc.courseUnits.listForCourse.queryOptions({ courseId }));

  function choose(id: string | null) {
    if (!id || id === assignmentId) return;

    /*
      The cohort filter follows; the open submission does not. `?submission=` and `?fellow=` name
      a row on the assignment being left, and carrying either across would open this screen on
      whatever id happens to collide, or on nothing at all.
    */
    const params = new URLSearchParams(searchParams.toString());
    params.delete("submission");
    params.delete("fellow");
    const query = params.toString();

    const href = gradingQueueHref(courseId, id);
    router.push(query ? `${href}?${query}` : href);
  }

  return (
    <Select
      value={assignmentId}
      onValueChange={choose}
      items={{
        [assignmentId]: assignmentTitle,
        ...Object.fromEntries(
          (units.data ?? []).flatMap((unit) =>
            unit.assignments.map((assignment) => [assignment.id, assignment.title]),
          ),
        ),
      }}
    >
      <SelectTrigger className={cn("w-full min-w-0", className)} aria-label="Switch assignment">
        <NotebookPen className="size-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(units.data ?? []).map((unit) =>
          unit.assignments.length > 0 ? (
            <SelectGroup key={unit.id}>
              <SelectLabel>{unit.name}</SelectLabel>
              {unit.assignments.map((assignment) => (
                <SelectItem key={assignment.id} value={assignment.id}>
                  {assignment.title}
                  {/* Said rather than hidden — an instructor is entitled to open their own draft. */}
                  {assignment.distributedAt === null && (
                    <span className="ml-1.5 text-xs text-muted-foreground">Draft</span>
                  )}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null,
        )}
      </SelectContent>
    </Select>
  );
}
