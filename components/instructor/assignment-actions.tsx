"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { BookCheck, BookDashed, Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { editAssignmentHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

import { CopyAssignmentDialog } from "./copy-assignment-dialog";
import { RemoveAssignmentDialog } from "./remove-assignment-dialog";

/**
 * What can be done to one assignment: edit it, publish or unpublish it, copy it, remove it.
 *
 * Four buttons on the row rather than a three-dots menu, each named by its tooltip and its
 * label for a screen reader. A menu prices every action at two presses and hides what can be
 * done until it is opened; these say it at a glance, and the two presses that duplicate or
 * destroy anything still open their dialogs before anything happens.
 *
 * Its own file because the Curriculum screen draws it on every assignment row inside every
 * unit. The copy dialog and the typed-confirmation remove dialog are the same two it has
 * always opened.
 *
 * **The row it sits on carries no grading figures.** Triage is the screen for what needs
 * grading, and these buttons are about the assignment rather than about the work handed in
 * against it — so they need no submission count to render, and the destructive one says
 * "with student work" only where the removal dialog will.
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
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={editAssignmentHref(courseId, assignment.id)}
              aria-label={`Edit ${assignment.title}`}
              className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
            >
              <Pencil />
            </Link>
          }
        />
        <TooltipContent>Edit this assignment</TooltipContent>
      </Tooltip>

      {/*
        One button that toggles, rather than two of which one is always absent. The icon shows the
        state — a checked book on a published assignment, a dashed one on a draft — so the row can
        be read at a glance, and the tooltip and label name the press that changes it.
      */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={
                published ? `Unpublish ${assignment.title}` : `Publish ${assignment.title}`
              }
              onClick={() =>
                published
                  ? unpublish.mutate({ assignmentId: assignment.id })
                  : publish.mutate({ assignmentId: assignment.id })
              }
            >
              {published ? <BookCheck /> : <BookDashed />}
            </Button>
          }
        />
        <TooltipContent>
          {published ? "Unpublish this assignment" : "Publish this assignment"}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Copy ${assignment.title} to another course`}
              onClick={() => setCopying(true)}
            >
              <Copy />
            </Button>
          }
        />
        <TooltipContent>Copy to another course</TooltipContent>
      </Tooltip>

      {/*
        The dialog behind this is the one that counts submissions and requires the title to be
        typed. Naming the consequence here as well would need a count this row deliberately
        does not fetch, and the dialog states it before anything can happen.
      */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label={`Remove ${assignment.title}`}
              onClick={() => setRemoving(true)}
            >
              <Trash2 />
            </Button>
          }
        />
        <TooltipContent>Remove this assignment</TooltipContent>
      </Tooltip>

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
