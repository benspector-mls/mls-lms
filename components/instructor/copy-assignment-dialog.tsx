"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/trpc/client";

/**
 * Copying an assignment into another cohort, or beside itself in this one.
 *
 * **The procedure could always do this and nothing could ask it to.** `duplicate` has taken a
 * `targetCourseId` since it was written — course creation copies a whole term through it — while
 * the menu that called it hardcoded the current course. So the case it exists for, carrying an
 * assignment from last term's cohort into this one, was reachable only by writing the call.
 *
 * **The module is the part that needs a person.** Copying across courses matches the module by
 * name, which is the only thing two courses can agree about; it is exactly right when two cohorts
 * of the same program share a module sequence, and it fails on every assignment when they have
 * diverged. This asks, defaulting to the name match where one exists, so the ordinary case is one
 * click and the diverged case is a choice rather than a refusal.
 *
 * Nothing about the copy is a surprise: it arrives unpublished, with no due date and no
 * submissions, carrying both repositories, the answer key folder, the runner, the sections, and
 * the point values. The dialog says so, because "duplicate" does not.
 */
export function CopyAssignmentDialog({
  assignmentId,
  title,
  moduleName,
  courseId,
  open,
  onOpenChange,
}: {
  assignmentId: string;
  title: string;
  /** The source's module, which is what the name match on the other side looks for. */
  moduleName: string;
  /** The course it is being copied *from*, which is also the default target. */
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [targetCourseId, setTargetCourseId] = React.useState(courseId);
  const [targetModuleId, setTargetModuleId] = React.useState<string | null>(null);

  const courses = useQuery({ ...trpc.courses.listMine.queryOptions(), enabled: open });

  /*
    The target's modules, which is also the only reason this is a query rather than a prop.

    `courses.get` rather than `modules.listForCourse`: this needs names and ids, and that one
    carries every assignment in every module with it.
  */
  const target = useQuery({
    ...trpc.courses.get.queryOptions({ courseId: targetCourseId }),
    enabled: open,
  });

  /*
    Courses that can actually receive it: taught by this caller, and not archived.

    Archived ones are in the list now — that is the point of them being reachable — and a
    finished term quietly gaining an assignment is a change nobody would ever see. The procedure
    refuses it too; this only decides what to offer.
  */
  const targets = (courses.data ?? []).filter(
    (course) => course.teaches && course.archivedAt == null,
  );

  const modules = target.data?.modules ?? [];
  const nameMatch = modules.find((module) => module.name === moduleName) ?? null;

  /*
    The name match, preselected whenever the target changes.

    Held as state rather than derived, because the whole point of the select is that somebody can
    disagree with it — and reset on a change of course, since a module id from the previous
    target is not a choice about this one.
  */
  React.useEffect(() => {
    setTargetModuleId(nameMatch?.id ?? null);
  }, [nameMatch?.id, targetCourseId]);

  const copy = useMutation(
    trpc.assignments.duplicate.mutationOptions(
      settled({
        onSuccess: (result) => {
          const into = targets.find((course) => course.id === targetCourseId);
          toast.success(
            into && into.id !== courseId
              ? `Copied ${result.assignment.title} into ${into.name} · ${into.cohortTerm}. It is not visible to students yet.`
              : `Copied ${result.assignment.title}. It is not visible to students yet.`,
          );
          if (result.warnings.length > 0) {
            toast.warning(result.warnings.map((warning) => warning.message).join(" · "), {
              duration: 12_000,
            });
          }
          onOpenChange(false);
        },
      }),
    ),
  );

  const sameCourse = targetCourseId === courseId;
  const ready = targetModuleId !== null && !target.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setTargetCourseId(courseId);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy {title}</DialogTitle>
          <DialogDescription>
            The copy arrives unpublished, with no due date and no submissions. Everything the
            assignment is comes across — both repositories, the answer key folder, the runner, the
            sections, and the point values.
          </DialogDescription>
        </DialogHeader>

        {courses.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          /*
            `min-w-0` all the way down, and not decoration.

            `DialogContent` is a grid and `SelectTrigger` is `w-fit whitespace-nowrap`, so a grid
            item's default `min-width: auto` lets a long cohort label — a program name, a term,
            and a marker — grow the trigger past the dialog's own `max-w-sm` and drag the panel
            out with it. The footer's negative margins are measured against a width the content
            no longer has, so it reads as a strip offset from everything above it.
          */
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="copy-target-course">Into which cohort</Label>
              <Select
                value={targetCourseId}
                onValueChange={(value) => {
                  if (value) setTargetCourseId(value);
                }}
                /*
                  The name and the term, and not which one is current. The trigger is one line
                  that truncates, so a marker on the end is the first thing to be cut — it is
                  said below the select instead, where there is room for it to be a sentence.
                */
                items={Object.fromEntries(
                  targets.map((course) => [course.id, `${course.name} · ${course.cohortTerm}`]),
                )}
              >
                <SelectTrigger id="copy-target-course" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{course.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {course.cohortTerm}
                          {course.id === courseId ? " · this one" : ""}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/*
                Said here rather than discovered in a toast. Copying beside the original needs a
                repository name of its own, which the procedure derives — the important half is
                that it happens at all, since two assignments in one course cannot share one.
              */}
              {sameCourse && (
                <p className="text-xs text-muted-foreground">
                  This is the cohort it is already in, so the copy gets a repository name of its own
                  ending in <span className="font-mono whitespace-nowrap">-copy</span>. Copying into
                  another cohort keeps the name, because that cohort&apos;s short name already tells
                  the repositories apart.
                </p>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="copy-target-module">Into which module</Label>
              {target.isPending ? (
                <Skeleton className="h-9 w-full" />
              ) : modules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  That cohort has no modules yet, so there is nowhere for the copy to go. Create one
                  there first.
                </p>
              ) : (
                <Select
                  value={targetModuleId}
                  onValueChange={(value) => setTargetModuleId(value)}
                  items={Object.fromEntries(modules.map((module) => [module.id, module.name]))}
                >
                  <SelectTrigger id="copy-target-module" className="w-full min-w-0">
                    <SelectValue placeholder="Choose a module" />
                  </SelectTrigger>
                  <SelectContent>
                    {modules.map((module) => (
                      <SelectItem key={module.id} value={module.id}>
                        {module.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {/*
                Which of the two things just happened, said either way. A silent name match and a
                silent fallback to the first module look identical on screen, and one of them is
                a decision somebody should be making.
              */}
              {modules.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {nameMatch
                    ? `${moduleName} exists there, so that is where it goes unless you say otherwise.`
                    : `That cohort has no module called ${moduleName}, so pick where this belongs.`}
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={copy.isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            disabled={!ready || copy.isPending}
            onClick={() =>
              copy.mutate({
                assignmentId,
                targetCourseId,
                targetModuleId: targetModuleId ?? undefined,
              })
            }
          >
            {copy.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Copy data-icon="inline-start" />
            )}
            Copy assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
