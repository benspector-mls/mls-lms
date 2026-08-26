"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useTRPC } from "@/trpc/client";

import { ResourceDialog, type Resource } from "./resource-dialog";

/**
 * What can be done to one resource: edit it, or remove it.
 *
 * **Removal is a plain confirmation**, deliberately unlike an assignment's, which requires the
 * title to be typed. A resource is a title and a link: re-adding one costs a minute, and nothing
 * a student has done is lost with it. An assignment carries submissions, approved grades, and
 * feedback somebody has already read, which is what the stricter dialog is protecting.
 *
 * Takes the whole resource rather than an id, and fetches nothing. The row this sits beside is
 * rendered from the same object — the Curriculum screen shows each resource the way a student
 * meets it, so the body of a note and the id of a video are already here, and the edit form opens
 * on the click instead of after a round trip.
 */
export function ResourceActions({ courseId, resource }: { courseId: string; resource: Resource }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [editing, setEditing] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  const remove = useMutation(
    trpc.resources.remove.mutationOptions(
      settled({
        onSuccess: (row) => {
          toast.success(`Removed "${row.title}".`);
          setRemoving(false);
        },
      }),
    ),
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Actions for ${resource.title}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil data-icon="inline-start" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>
            <Trash2 data-icon="inline-start" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ResourceDialog
        open={editing}
        onOpenChange={setEditing}
        courseId={courseId}
        resource={resource}
      />

      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove &ldquo;{resource.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              It disappears from your students&apos; course page. Nothing they have handed in is
              affected — a resource is not work.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ resourceId: resource.id })}
            >
              {remove.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
