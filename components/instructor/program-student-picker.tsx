"use client";

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
import { programStudentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

type Fellow = RouterOutputs["enrollments"]["listForProgram"][number];

/**
 * Which fellow's record this is, switchable to another on the same program's roster.
 *
 * The program-level twin of `StudentPicker`, which does this on the per-course record. Both exist
 * for the same reason: a record is reached by a link that could name anybody — the roster, the
 * gradebook, a colleague's message — and without this there is no way to the next name but a trip
 * back to the roster and a second click. Reading a term's fellows one after another is what an
 * instructor actually does on this screen.
 *
 * **Its roster arrives as a prop rather than from a query of its own**, which is the one way it
 * differs from its twin. The page is a server component and fetches the names beside everything
 * else it draws, so the list is complete in the first paint — where the per-course picker, a
 * client island inside a client screen, fetches its own and holds the current name separately so
 * its trigger does not sit blank while the roster is in flight.
 *
 * **The fellow on screen is put into the options whether or not they are on the list.** The list
 * is active fellows, so a removed fellow's record — still perfectly reachable, and still linked
 * from the roster's own removed table — would otherwise open with an empty trigger.
 */
export function ProgramStudentPicker({
  programId,
  studentId,
  studentName,
  fellows,
  className,
}: {
  programId: string;
  /** The fellow this record is currently open on. */
  studentId: string;
  studentName: string;
  /** Every active fellow of the program, already sorted by name. */
  fellows: Fellow[];
  className?: string;
}) {
  const router = useRouter();

  const listed = fellows.some((fellow) => fellow.id === studentId);

  function choose(id: string | null) {
    if (!id || id === studentId) return;
    router.push(programStudentHref(programId, id));
  }

  return (
    <Select
      value={studentId}
      onValueChange={choose}
      items={{
        [studentId]: studentName,
        ...Object.fromEntries(
          fellows.map((fellow) => [fellow.id, displayNameOf(fellow, "Unnamed")]),
        ),
      }}
    >
      <SelectTrigger size="sm" className={cn("min-w-0", className)} aria-label="Switch fellow">
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {!listed && <SelectItem value={studentId}>{studentName}</SelectItem>}
          {fellows.map((fellow) => (
            <SelectItem key={fellow.id} value={fellow.id}>
              {displayNameOf(fellow, "Unnamed")}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
