"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { Copy, Eye, EyeOff, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { editAssignmentHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";

import { CopyAssignmentDialog } from "./copy-assignment-dialog";
import { RemoveAssignmentDialog } from "./remove-assignment-dialog";

/**
 * What can be done to one assignment: edit it, publish or hide it, copy it, remove it.
 *
 * Its own file because the Curriculum screen draws it on every assignment row inside every unit,
 * and it used to be a private function of the flat table that screen replaced. Nothing about it
 * changed in the move — the copy dialog and the typed-confirmation remove dialog are the same
 * two it always opened.
 *
 * **The row it sits on carries no grading figures**, which is what the flat table used to put
 * beside it. Triage is the screen for what needs grading, and this menu is about the assignment
 * rather than about the work handed in against it — so it needs no submission count to render,
 * and the destructive item says "with student work" only where the removal dialog will.
 */

/** The parts of an assignment this reads, structural so any payload carrying them satisfies it. */
export type ActionableAssignment = {
  id: string;
  title: string;
  distributedAt: Date | string | null;
};

export function AssignmentActions({
  courseId,
  assignment,
  unitName,
}: {
  courseId: string;
  assignment: ActionableAssignment;
  /**
   * The unit this belongs to, which the copy dialog shows so a reader knows what it is copying
   * out of. Optional because the caller usually *is* that unit's section and has it to hand;
   * where it is absent the dialog simply does not name it.
   */
  unitName?: string;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [removing, setRemoving] = React.useState(false);
  const [copying, setCopying] = React.useState(false);

  const published = assignment.distributedAt !== null;

  const publish = useMutation(
    trpc.assignments.publish.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success(`${assignment.title} is now visible to students.`);
        },
      }),
    ),
  );
  const unpublish = useMutation(
    trpc.assignments.unpublish.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success(`${assignment.title} is hidden from students. Their work is untouched.`);
        },
      }),
    ),
  );
  const busy = publish.isPending || unpublish.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={busy}
              aria-label={`Actions for ${assignment.title}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={
              <Link href={editAssignmentHref(courseId, assignment.id)}>
                <Pencil data-icon="inline-start" />
                Edit
              </Link>
            }
          />
          {published ? (
            <DropdownMenuItem onClick={() => unpublish.mutate({ assignmentId: assignment.id })}>
              <EyeOff data-icon="inline-start" />
              Hide from students
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => publish.mutate({ assignmentId: assignment.id })}>
              <Eye data-icon="inline-start" />
              Publish
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setCopying(true)}>
            <Copy data-icon="inline-start" />
            Copy to…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/*
            The dialog behind this is the one that counts submissions and requires the title to be
            typed. Naming the consequence here as well would need a count this row deliberately
            does not fetch, and the dialog states it before anything can happen.
          */}
          <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>
            <Trash2 data-icon="inline-start" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CopyAssignmentDialog
        assignmentId={assignment.id}
        title={assignment.title}
        unitName={unitName}
        courseId={courseId}
        open={copying}
        onOpenChange={setCopying}
      />

      <RemoveAssignmentDialog
        assignmentId={assignment.id}
        title={assignment.title}
        open={removing}
        onOpenChange={setRemoving}
      />
    </>
  );
}
