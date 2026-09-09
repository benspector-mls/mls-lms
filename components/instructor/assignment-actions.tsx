"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { BookCheck, BookDashed, Copy, Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { editAssignmentHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

import { CopyAssignmentDialog } from "./copy-assignment-dialog";
import { RemoveAssignmentDialog } from "./remove-assignment-dialog";

/**
 * What can be done to one assignment: preview it as a student, edit it, publish or unpublish it,
 * copy it, remove it.
 *
 * **Five buttons where there is room for them, and one menu where there is not.** A menu prices
 * every action at two presses and hides what can be done until it is opened, which is the wrong
 * trade on a wide screen; five icon buttons after a title and a due date is the wrong trade on a
 * phone, where they wrap onto a line of their own and crowd out the assignment. So the row draws
 * both and lets the viewport choose, at the same 768px the rest of the application calls mobile.
 *
 * **Chosen in CSS rather than by measuring the window.** `useIsMobile` reports false until an
 * effect has run, so a phone would draw five buttons for a frame and then swap them for a menu —
 * a flash and a reflow on every row of the screen. `hidden md:flex` against `md:hidden` has
 * neither, and the half that is not showing is `display: none`, so it is out of the accessibility
 * tree too and a screen reader is never offered both.
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
  onPreview,
  unitName,
}: {
  courseId: string;
  assignment: ActionableAssignment;
  /** Opens the read-only student preview of this assignment, in the panel `Curriculum` holds. */
  onPreview: () => void;
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
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Preview ${assignment.title}`}
                onClick={onPreview}
              >
                <Eye />
              </Button>
            }
          />
          <TooltipContent>Preview this assignment</TooltipContent>
        </Tooltip>

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
      </div>

      {/*
        The same five actions, in the shape a narrow row has space for. The dialogs and the two
        mutations below are shared with the buttons above rather than duplicated — only the
        controls are drawn twice, and never both at once.
      */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`Actions for ${assignment.title}`}
              className="shrink-0 md:hidden"
            >
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onPreview}>
            <Eye data-icon="inline-start" />
            Preview as a student
          </DropdownMenuItem>
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
              <BookDashed data-icon="inline-start" />
              Unpublish
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => publish.mutate({ assignmentId: assignment.id })}>
              <BookCheck data-icon="inline-start" />
              Publish
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setCopying(true)}>
            <Copy data-icon="inline-start" />
            Copy to…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
