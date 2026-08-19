"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AssignmentKindBadge, ResourceKindBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/list-states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { CATEGORY_META, UNIT_CATEGORIES, partCount } from "@/lib/course-units";
import type { CourseUnitCategory } from "@/lib/generated/prisma/enums";
import { gradingQueueHref, newAssignmentHref } from "@/lib/links";
import { formatDueDateShort } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

import { AssignmentActions } from "./assignment-actions";
import { ResourceDialog } from "./resource-dialog";
import { ResourceActions } from "./resource-actions";

/**
 * The whole of a course's curriculum on one screen: its modules, projects, and assessments, and
 * the assignments and resources inside each.
 *
 * **This replaces three screens** — Modules, Coursework, and Resources — and the reason is the
 * reason the three collapsed into one model. A module, a project, and an assessment are the same
 * kind of thing, so an instructor asking "what is in Mod 4" and "what is in the capstone" was
 * being sent to different places to find out. Everything that belongs to a unit is now inside
 * that unit, and everything is created from inside the unit it goes in — so the form never has
 * to ask which one, because the button was already there.
 *
 * **No grading figures at all**, deliberately. The screen this replaced carried a graded count
 * and a "to grade" count per assignment, and reproducing what Triage already says is most of what
 * made it too busy to read. Triage is the screen for what needs grading.
 *
 * Drafts are shown and marked rather than hidden. A truer mirror would omit what a student
 * cannot see, and then a unit that is full to the instructor and empty to the cohort reads as
 * simply empty — which is the confusion this screen exists to remove.
 */

type Unit = RouterOutputs["courseUnits"]["listForCourse"][number];

export function Curriculum({ courseId }: { courseId: string }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const units = useQuery(trpc.courseUnits.listForCourse.queryOptions({ courseId }));

  const [adding, setAdding] = React.useState<CourseUnitCategory | null>(null);
  const [newName, setNewName] = React.useState("");
  const [renaming, setRenaming] = React.useState<string | null>(null);

  const create = useMutation(
    trpc.courseUnits.create.mutationOptions(
      settled({
        onSuccess: (row) => {
          toast.success(`Created "${row.name}".`);
          setAdding(null);
          setNewName("");
        },
      }),
    ),
  );

  const update = useMutation(
    trpc.courseUnits.update.mutationOptions(settled({ onSuccess: () => setRenaming(null) })),
  );
  const reorder = useMutation(trpc.courseUnits.reorder.mutationOptions(settled()));
  const remove = useMutation(
    trpc.courseUnits.remove.mutationOptions(
      settled({ onSuccess: (row) => toast.success(`Removed "${row.name}".`) }),
    ),
  );

  const busy = create.isPending || update.isPending || reorder.isPending || remove.isPending;

  if (units.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const rows = units.data ?? [];

  /** Sends the whole order with one pair swapped — see `courseUnits.reorder`. */
  function move(index: number, direction: -1 | 1) {
    const next = [...rows];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate({ courseId, courseUnitIds: next.map((row) => row.id) });
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        Three buttons rather than one with a category picker. The category cannot be changed
        afterwards, so it is not a setting on a form — it is which of three things you are
        making, and saying so at the point of the click is the clearest that gets.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {UNIT_CATEGORIES.map((category) => (
          <Button
            key={category}
            type="button"
            size="sm"
            variant={category === "MODULE" ? "default" : "outline"}
            disabled={busy}
            onClick={() => {
              setAdding(category);
              setNewName("");
            }}
          >
            <Plus data-icon="inline-start" />
            New {CATEGORY_META[category].noun}
          </Button>
        ))}
      </div>

      {adding && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim()) return;
            create.mutate({ courseId, category: adding, name: newName.trim(), overview: null });
          }}
        >
          <Input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={adding === "MODULE" ? "Mod 8 - Capstone" : "Mod 4 Project"}
            aria-label={`New ${CATEGORY_META[adding].noun} name`}
            className="min-w-48 flex-1"
          />
          <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
            {create.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Add {CATEGORY_META[adding].noun}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(null)}>
            Cancel
          </Button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="Nothing in this course yet"
          description="Add a module, a project, or an assessment. Assignments and resources go inside one."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((unit, index) => (
            <UnitSection
              key={unit.id}
              courseId={courseId}
              unit={unit}
              busy={busy}
              isFirst={index === 0}
              isLast={index === rows.length - 1}
              onMove={(direction) => move(index, direction)}
              renaming={renaming === unit.id}
              onRename={() => setRenaming(unit.id)}
              onCancelRename={() => setRenaming(null)}
              onSaveName={(name) =>
                update.mutate({ courseUnitId: unit.id, name, overview: unit.overview })
              }
              onRemove={() => remove.mutate({ courseUnitId: unit.id })}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Order is the order your students meet the course, and it is one sequence — a project sits
        between the modules it falls between. Assignments inside a unit are listed by due date;
        resources are listed alphabetically beneath them.
      </p>
    </div>
  );
}

function UnitSection({
  courseId,
  unit,
  busy,
  isFirst,
  isLast,
  onMove,
  renaming,
  onRename,
  onCancelRename,
  onSaveName,
  onRemove,
}: {
  courseId: string;
  unit: Unit;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  renaming: boolean;
  onRename: () => void;
  onCancelRename: () => void;
  onSaveName: (name: string) => void;
  onRemove: () => void;
}) {
  const meta = CATEGORY_META[unit.category];
  const drafts = unit.assignments.filter((a) => a.distributedAt === null).length;
  const [open, setOpen] = React.useState(unit.assignments.length > 0 || unit.resources.length > 0);
  const [name, setName] = React.useState(unit.name);
  const [addingResource, setAddingResource] = React.useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <section className="overflow-hidden rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-2 py-2">
          {/*
            Up and down rather than drag-and-drop: no new dependency, it works from the keyboard,
            and a dozen units is not a list that needs dragging. Each move sends the whole new
            order, so the server rewrites every position from a list nobody has to interpret.
          */}
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              aria-label={`Move ${unit.name} up`}
              disabled={isFirst || busy}
              onClick={() => onMove(-1)}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move ${unit.name} down`}
              disabled={isLast || busy}
              onClick={() => onMove(1)}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </div>

          {renaming ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) onSaveName(name.trim());
              }}
            >
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8"
              />
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onCancelRename}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <h2 className="min-w-0 flex-1">
                <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left">
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
                  />
                  {/*
                    The category on every unit, including a module. Labelling only two of the
                    three would make "no badge" the way a module is recognised, which is a rule a
                    reader has to be told rather than one they can see.
                  */}
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {meta.noun}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{unit.name}</span>
                  <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                    {unitSummary(unit, drafts)}
                  </span>
                </CollapsibleTrigger>
              </h2>

              <Button type="button" size="sm" variant="ghost" onClick={onRename} disabled={busy}>
                <Pencil data-icon="inline-start" />
                Rename
              </Button>

              {/*
                Absent rather than disabled while the unit holds work. The procedure refuses it
                and so does the foreign key; offering a button that cannot succeed asks the
                reader to discover the rule by breaking it.
              */}
              {unit._count.assignments === 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={onRemove}
                  disabled={busy}
                >
                  <Trash2 data-icon="inline-start" />
                  Remove
                </Button>
              )}
            </>
          )}
        </div>

        <CollapsibleContent>
          {/*
            The two ways to put something in this unit, inside the unit. Neither asks which unit
            it goes in, because the button was already in one — which is the whole point of the
            screen and the reason the assignment form's module selector disappears when it is
            opened from here.
          */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 bg-muted/40">
            <Link
              href={newAssignmentHref(courseId, unit.id)}
              className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
            >
              <Plus data-icon="inline-start" />
              Add {meta.partNoun}
            </Link>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAddingResource(true)}>
              <FileText data-icon="inline-start" />
              Add resource
            </Button>

            {unit.assignments.length === 0 && unit.resources.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Nothing in this {meta.noun} yet.
              </span>
            )}
          </div>
          {unit.assignments.length > 0 && (
            <section className="border-t border-border">
              {/*
                Named, the way the resources beneath are. Without a heading the two lists ran into
                each other and only the second said what it was, so the first read as "the unit's
                contents" and the second as an afterthought — when they are two kinds of thing
                that happen to live in the same place.

                The word follows the category, so a project's list reads "Deliverables" and an
                assessment's "Parts". That is the vocabulary every other screen uses for the work
                inside a unit, and it comes from one place rather than being chosen here.
              */}
              <h3 className="px-3 pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {CATEGORY_META[unit.category].partPluralNoun}
              </h3>
              <ul className="divide-y divide-border">
                {unit.assignments.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Link
                        href={gradingQueueHref(courseId, assignment.id)}
                        className="truncate font-medium hover:underline"
                      >
                        {assignment.title}
                      </Link>
                      <AssignmentKindBadge kind={assignment.kind} />
                      {assignment.distributedAt === null && <Badge variant="outline">Draft</Badge>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {assignment.pointValue} pts
                    </span>
                    {/*
                      The time as well as the date, because the instructor set one and it decides
                      which submissions are recorded as late. Wide enough for "Oct 9, 11:59 PM"
                      without wrapping, so the column edge is read straight down the list.
                    */}
                    <span className="w-36 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground">
                      {assignment.dueAt ? formatDueDateShort(assignment.dueAt) : "No due date"}
                    </span>
                    <AssignmentActions courseId={courseId} assignment={assignment} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {unit.resources.length > 0 && (
            <section className="border-t border-border">
              {/*
                Beneath the assignments, under a heading of their own, and never interleaved with
                them. That is what makes the ordering question go away rather than needing an
                answer: assignments sort by due date and resources alphabetically, and two
                sequences cannot be merged into one without inventing a rule for comparing a
                deadline to a title.
              */}
              <h3 className="px-3 pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Resources
              </h3>
              <ul className="divide-y divide-border">
                {unit.resources.map((resource) => (
                  <li
                    key={resource.id}
                    className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{resource.title}</span>
                    <ResourceKindBadge kind={resource.kind} />
                    <ResourceActions
                      courseId={courseId}
                      resourceId={resource.id}
                      title={resource.title}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </CollapsibleContent>
      </section>

      <ResourceDialog
        open={addingResource}
        onOpenChange={setAddingResource}
        courseId={courseId}
        defaultCourseUnitId={unit.id}
        resource={null}
      />
    </Collapsible>
  );
}

/** "6 assignments · 2 drafts · 3 resources", in the words of the category. */
function unitSummary(unit: Unit, drafts: number): string {
  const parts: string[] = [];
  if (unit.assignments.length > 0) parts.push(partCount(unit.category, unit.assignments.length));
  if (drafts > 0) parts.push(`${drafts} draft${drafts === 1 ? "" : "s"}`);
  if (unit.resources.length > 0) {
    parts.push(`${unit.resources.length} resource${unit.resources.length === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Nothing yet";
}
