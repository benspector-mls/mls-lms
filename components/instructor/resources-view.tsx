"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Library, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ResourceDialog } from "@/components/instructor/resource-dialog";
import { EmptyState } from "@/components/list-states";
import { ResourceKindBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Everything in the cohort that is not work, grouped by module.
 *
 * Its own screen beside Assignments, for the same reason that one exists: the thing being
 * authored gets a screen, and the module accordion is where the result is read. A resource has
 * no due date, no points, and no state, so there is nothing here to sort by, filter on, or
 * search through — which is why this is a grouped list rather than the sortable table next door.
 *
 * **Every module is shown, including empty ones.** A module with no resources is a fact worth
 * seeing on the screen that manages them, and it is where the Add button for that module lives.
 * The alternative shows only modules that already have something, which makes adding the first
 * one to a module require going somewhere else first.
 *
 * The rows are interactive here and deliberately not on the Modules screen, which shows the
 * course's shape rather than being where its contents are worked on — the same split as
 * assignments.
 */

type Modules = RouterOutputs["modules"]["listForCourse"];
type Resource = RouterOutputs["resources"]["listForCourse"][number];

export function CourseResources({
  modules,
  resources,
}: {
  /*
    No `courseId`. Every write here names a module, and a module is what the procedures reach the
    course through — so passing one would be a second source for a fact the row already carries,
    and the kind that goes stale silently if a resource is ever moved.
  */
  modules: Modules;
  resources: Resource[];
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Resource | null>(null);
  const [addingTo, setAddingTo] = React.useState<string | undefined>(undefined);
  const [removing, setRemoving] = React.useState<Resource | null>(null);

  const remove = useMutation(
    trpc.resources.remove.mutationOptions({
      onError: (error) => toast.error(error.message),
      onSuccess: (row) => {
        toast.success(`Removed "${row.title}".`);
        setRemoving(null);
        router.refresh();
      },
    }),
  );

  function openNew(moduleId?: string) {
    setEditing(null);
    setAddingTo(moduleId);
    setDialogOpen(true);
  }

  function openEdit(resource: Resource) {
    setEditing(resource);
    setAddingTo(undefined);
    setDialogOpen(true);
  }

  /*
    Grouped from the flat list the procedure returns rather than fetched per module. The order
    within each group is already right — the procedure sorts by title — so this only has to keep
    the modules in their own order and not disturb what is inside them.
  */
  const byModule = new Map<string, Resource[]>(modules.map((row) => [row.id, []]));
  for (const resource of resources) {
    byModule.get(resource.moduleId)?.push(resource);
  }

  if (modules.length === 0) {
    return (
      <EmptyState
        icon={<Library />}
        title="This cohort has no modules yet"
        description="Every resource belongs to a module, so add one on the Modules screen first."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {modules.map((row) => {
        const rows = byModule.get(row.id) ?? [];

        return (
          <section key={row.id} className="overflow-hidden rounded-lg border border-border">
            <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-3 py-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{row.name}</h2>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {rows.length === 0
                  ? "Nothing yet"
                  : `${rows.length} ${rows.length === 1 ? "resource" : "resources"}`}
              </span>
              <Button variant="ghost" size="sm" onClick={() => openNew(row.id)}>
                <Plus data-icon="inline-start" />
                Add
              </Button>
            </div>

            {rows.length === 0 ? (
              <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
                No readings, notes, or videos in this module yet.
              </p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {rows.map((resource) => (
                  <li
                    key={resource.id}
                    className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{resource.title}</span>
                        <ResourceKindBadge kind={resource.kind} />
                      </div>
                      {/*
                        The URL rather than the description, because this is the screen where a
                        wrong link is found. What it says is on the course page; whether it points
                        at the right thing is only answerable here.
                      */}
                      {resource.url && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {resource.url}
                        </p>
                      )}
                    </div>

                    <Button variant="ghost" size="sm" onClick={() => openEdit(resource)}>
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRemoving(resource)}
                    >
                      <Trash2 data-icon="inline-start" />
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <ResourceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        modules={modules}
        resource={editing}
        defaultModuleId={addingTo}
      />

      {/*
        A plain confirmation, not the typed-title one removing an assignment needs. That one
        destroys submissions and released grades and cannot be undone; this destroys a title and
        a URL. A typed confirmation on something that costs a minute to re-add would teach
        instructors to type past the ones that matter.
      */}
      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this resource?</DialogTitle>
            <DialogDescription>
              &ldquo;{removing?.title}&rdquo; comes off the course page for everyone in the cohort.
              Nothing else changes — a resource has no submissions and no grades.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate({ resourceId: removing.id })}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
