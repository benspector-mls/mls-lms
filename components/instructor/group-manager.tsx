"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ChevronDown, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Making groups, naming them, and choosing who is in each.
 *
 * On the roster because that is where the cohort is, and because grouping is something done to a
 * roster rather than to a pile of work. Everywhere else a group appears it is a filter to pick,
 * not a thing to edit.
 *
 * A group is a set of students and nothing else — it has no instructor and grants nothing — so
 * there is no permission here to think about beyond teaching the course, which every procedure
 * checks. Splitting a cohort between co-teachers is what these are usually for; a project team is
 * the same shape, and so is the audience of an assignment given to part of a cohort.
 */

type Groups = RouterOutputs["groups"]["listForCourse"];
type Memberships = RouterOutputs["groups"]["membershipsForCourse"];

export function GroupManager({
  courseId,
  data,
  memberships,
}: {
  courseId: string;
  data: Groups;
  memberships: Memberships;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const settled = {
    onSuccess: () => router.refresh(),
    onError: (error: { message: string }) => toast.error(error.message),
  };

  const create = useMutation(
    trpc.groups.create.mutationOptions({
      ...settled,
      onSuccess: (group) => {
        toast.success(`Created "${group.name}".`);
        setNewName("");
        setCreating(false);
        router.refresh();
      },
    }),
  );

  const busy = create.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-muted-foreground" />
              Groups
            </CardTitle>
            <CardDescription className="mt-1">
              A named set of this cohort&apos;s students. Pick one from the filter on triage, an
              assignment&apos;s queue, the gradebook, or the assignments list to work only their
              submissions — which is how a cohort is split between two instructors without either of
              them grading the same work twice. A student can be in more than one.
            </CardDescription>
          </div>
          {!creating && (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus data-icon="inline-start" />
              New group
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        {creating && (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newName.trim()) return;
              create.mutate({ courseId, name: newName });
            }}
          >
            <Input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Squad 1"
              maxLength={120}
            />
            <Button size="sm" type="submit" disabled={busy || !newName.trim()}>
              Create
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
          </form>
        )}

        {data.groups.length === 0 && !creating ? (
          <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
            No groups yet. Everything counts the whole cohort until there are.
          </p>
        ) : (
          data.groups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              memberships={memberships}
              onChanged={() => router.refresh()}
            />
          ))
        )}

        {/*
          Said here rather than only in the picker, because this is the screen where it can be
          acted on. Somebody who joined by the link mid-term is in nothing until an instructor
          puts them somewhere, and this is the sentence that makes that visible before it costs
          anybody a missed submission.
        */}
        {data.ungroupedCount > 0 && data.groups.length > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">
            {data.ungroupedCount} {data.ungroupedCount === 1 ? "student is" : "students are"} in no
            group. They are still in every unfiltered count, and in nobody&apos;s group filter.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** One group: its name, its members, and the two things that can be done to it. */
function GroupRow({
  group,
  memberships,
  onChanged,
}: {
  group: Groups["groups"][number];
  memberships: Memberships;
  onChanged: () => void;
}) {
  const trpc = useTRPC();

  const [open, setOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(group.name);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  /*
    The ticked set, staged rather than written per click. `setMembers` takes the whole membership
    at once — idempotent, and impossible to leave half applied — so the screen holds a draft and
    sends it when an instructor is done, rather than firing a request per checkbox.
  */
  const membersOf = React.useCallback(
    () =>
      new Set(
        memberships
          .filter((entry) => entry.groupIds.includes(group.id))
          .map((entry) => entry.enrollmentId),
      ),
    [memberships, group.id],
  );

  const [draft, setDraft] = React.useState<Set<string>>(membersOf);

  // Reset when the server's answer changes underneath, so an instructor who saves and reopens
  // sees what was saved rather than the state they happened to leave the checkboxes in.
  React.useEffect(() => {
    setDraft(membersOf());
  }, [membersOf]);

  const onError = (error: { message: string }) => toast.error(error.message);

  const rename = useMutation(
    trpc.groups.rename.mutationOptions({
      onError,
      onSuccess: (updated) => {
        toast.success(`Renamed to "${updated.name}".`);
        setRenaming(false);
        onChanged();
      },
    }),
  );

  const remove = useMutation(
    trpc.groups.remove.mutationOptions({
      onError,
      onSuccess: (removed) => {
        /*
          Naming the count rather than only the group, because that is the fact somebody might not
          have had in mind. Nothing about the students changes — the group was a set, and
          dissolving it leaves every one of them exactly where they were.
        */
        toast.success(
          `Removed "${removed.name}". Its ${removed.memberCount} ` +
            `${removed.memberCount === 1 ? "student stays" : "students stay"} in the cohort.`,
        );
        onChanged();
      },
    }),
  );

  const save = useMutation(
    trpc.groups.setMembers.mutationOptions({
      onError,
      onSuccess: (result) => {
        toast.success(
          `"${group.name}" now holds ${result.memberCount} ` +
            `${result.memberCount === 1 ? "student" : "students"}.`,
        );
        onChanged();
      },
    }),
  );

  const saved = membersOf();
  const dirty =
    draft.size !== saved.size || [...draft].some((enrollmentId) => !saved.has(enrollmentId));

  function toggle(enrollmentId: string) {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(enrollmentId)) next.delete(enrollmentId);
      else next.add(enrollmentId);
      return next;
    });
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        {renaming ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              rename.mutate({ groupId: group.id, name });
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              className="h-8"
            />
            <Button size="sm" type="submit" disabled={rename.isPending || !name.trim()}>
              Save
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                setRenaming(false);
                setName(group.name);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left text-sm font-medium">
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
              {group.name}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {group.memberCount}
              </span>
            </CollapsibleTrigger>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
              <Pencil data-icon="inline-start" />
              Rename
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmingRemove(true)}
            >
              <Trash2 data-icon="inline-start" />
              Remove
            </Button>
          </>
        )}
      </div>

      {/*
        A confirmation rather than a typed name, unlike removing an assignment. That one destroys
        submissions and released grades and cannot be undone; this dissolves a set and touches
        nothing a student did, so the cost of a mistake is retyping a name and ticking a list.
      */}
      {confirmingRemove && (
        <div className="mx-3 mb-2 flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
          <span className="text-xs text-muted-foreground">
            Removing &ldquo;{group.name}&rdquo; dissolves the group. Nobody leaves the cohort and
            nothing they submitted changes; anybody filtered to it goes back to all students.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate({ groupId: group.id });
                setConfirmingRemove(false);
              }}
            >
              Remove the group
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      <CollapsibleContent>
        <div className="border-t border-border px-3 py-2">
          {memberships.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nobody has joined this cohort yet.
            </p>
          ) : (
            <>
              <ul className="flex flex-col">
                {memberships.map((entry) => {
                  const label =
                    entry.student.displayName ??
                    entry.student.githubUsername ??
                    entry.student.email ??
                    "Unnamed";

                  return (
                    <li key={entry.enrollmentId}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                        <Checkbox
                          checked={draft.has(entry.enrollmentId)}
                          onCheckedChange={() => toggle(entry.enrollmentId)}
                        />
                        <span className="truncate">{label}</span>
                        {/*
                          How many other groups this student is already in. A cohort split in two
                          usually wants each student in exactly one, and this is what makes a
                          double-assignment visible while it is being made rather than afterwards.
                        */}
                        {entry.groupIds.filter((id) => id !== group.id).length > 0 && (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            also in {entry.groupIds.filter((id) => id !== group.id).length}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center gap-2 border-t border-border pt-2">
                <Button
                  size="sm"
                  disabled={!dirty || save.isPending}
                  onClick={() => save.mutate({ groupId: group.id, enrollmentIds: [...draft] })}
                >
                  {save.isPending ? "Saving…" : "Save members"}
                </Button>
                {dirty && (
                  <Button size="sm" variant="ghost" onClick={() => setDraft(membersOf())}>
                    Discard
                  </Button>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {draft.size} selected
                </span>
              </div>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
