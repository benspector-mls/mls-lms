"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { studentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * Which fellow's record this is, switchable to another on the same course's roster.
 *
 * A record reached by a link that could name anybody — the gradebook, a search, a colleague's
 * message — otherwise had no way to the next name on the roster but a trip back to it. This is
 * the same move `StudentHeader`'s course switcher already offers sideways, between courses one
 * fellow is in; this one moves the other way, between fellows in the one course open now.
 */
export function StudentPicker({
  courseId,
  studentId,
  studentName,
  className,
}: {
  courseId: string;
  /** The fellow this record is currently open on. */
  studentId: string;
  /** Known already from the page this screen was built for, so the trigger never renders blank
   * while the fuller roster is still in flight. */
  studentName: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const roster = useQuery(trpc.enrollments.listForCourse.queryOptions({ courseId }));

  function choose(id: string | null) {
    if (!id || id === studentId) return;
    router.push(studentHref(courseId, id));
  }

  return (
    <Select
      value={studentId}
      onValueChange={choose}
      items={{
        [studentId]: studentName,
        ...Object.fromEntries(
          (roster.data ?? []).map((student) => [
            student.id,
            displayNameOf(student, "Unknown student"),
          ]),
        ),
      }}
    >
      <SelectTrigger className={cn("w-full min-w-0", className)} aria-label="Switch student">
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {(roster.data ?? []).map((student) => (
            <SelectItem key={student.id} value={student.id}>
              {displayNameOf(student, "Unknown student")}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
