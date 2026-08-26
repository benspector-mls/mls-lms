"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ChevronDown, Pencil, Plus, Shuffle, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Making a course's team sets, naming the teams in one, and placing fellows on them.
 *
 * **On its own screen beside the course's curriculum**, which is where a set belongs: it divides
 * the program's fellows for one course's projects, and it is the course that owns it. A
 * **cohort** is the other division and lives on the program — it splits the marking between
 * instructors, fellows never see it, and it changes nothing about the work. A **team** hands in one
 * piece of work, receives one grade, and its members can see each other.
 *
 * **A set is a partition.** A fellow is on at most one team of any one set, so placement is one
 * select per fellow. A set per project is the shape this is for: the same roster divided
 * differently for each, with an earlier project's divisions sitting harmlessly in their own set
 * rather than crowding a picker.
 *
 * Placements are staged and saved together, as a cohort's are, and for the same reason:
 * `setPlacements` takes the whole placement at once, so it is idempotent and cannot be left half
 * applied — and "distribute evenly" is then the same act as changing one select.
 */

type TeamSets = RouterOutputs["teamSets"]["listForCourse"];
type TeamSet = TeamSets["sets"][number];
/**
 * Every active fellow of the program, which placement needs and this component does not fetch.
 *
 * Read from the cohorts router because it is already the list of active enrollments with their
 * students. Only `enrollmentId` and `student` are used here; which cohort somebody is in is the
 * program's business and not this screen's.
 */
type Roster = RouterOutputs["cohorts"]["membershipsForProgram"];

/** What to call somebody, in the order the rest of this application prefers. */
function labelFor(student: Roster[number]["student"]): string {
  return student.displayName ?? student.githubUsername ?? student.email ?? "Unnamed";
}

/** The value a select uses for "on no team of this set". Not a team id, so it cannot collide. */
const UNPLACED = "unplaced";

export function TeamSetManager({
  courseId,
  data,
  roster,
}: {
  courseId: string;
  data: TeamSets;
  roster: Roster;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const router = useRouter();

  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newCount, setNewCount] = React.useState("4");

  const create = useMutation(
    trpc.teamSets.create.mutationOptions(
      settled({
        onSuccess: (set) => {
          toast.success(
            `Created "${set.name}" with ${set._count.teams} ` +
              `${set._count.teams === 1 ? "team" : "teams"}. Nobody is on one yet.`,
          );
          setNewName("");
          setNewCount("4");
          setCreating(false);
        },
      }),
    ),
  );

  const count = Number.parseInt(newCount, 10);
  const countIsUsable = Number.isInteger(count) && count >= 1 && count <= 60;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="size-4 text-muted-foreground" />
              Team Sets
            </CardTitle>
            <CardDescription className="mt-1">
              Reusable teams for this course&apos;s team assignments. Each team hands in one piece
              of work and receives one grade, and every member of a team can see who else is on it.
              A set holds one division of the roster — make one per project, and point that
              project&apos;s assignments at it. A fellow is on at most one team of any set.
            </CardDescription>
          </div>
          {!creating && (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus data-icon="inline-start" />
              New team set
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        {creating && (
          <form
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newName.trim() || !countIsUsable) return;
              create.mutate({ courseId, name: newName, teamCount: count });
            }}
          >
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor="team-set-name">What is this set for?</Label>
              <Input
                autoFocus
                id="team-set-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Unit 3 project teams"
                maxLength={120}
              />
            </div>
            {/*
              Asked here rather than teams being added one at a time. A set with no teams divides
              nothing, so it would be a half-made thing every screen then had to describe.
            */}
            <div className="flex w-32 flex-col gap-1.5">
              <Label htmlFor="team-set-count">How many teams?</Label>
              <Input
                id="team-set-count"
                type="number"
                min={1}
                max={60}
                value={newCount}
                onChange={(event) => setNewCount(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              type="submit"
              disabled={create.isPending || !newName.trim() || !countIsUsable}
            >
              Create
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setNewCount("4");
              }}
            >
              Cancel
            </Button>
          </form>
        )}

        {data.sets.length === 0 && !creating ? (
          <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
            No team sets yet. Every assignment is handed in by one student until there are.
          </p>
        ) : (
          data.sets.map((set) => (
            <TeamSetRow
              key={set.id}
              set={set}
              roster={roster}
              activeCount={data.activeCount}
              onChanged={() => router.refresh()}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** One set: its teams, who is on each, and the things that can be done to it. */
function TeamSetRow({
  set,
  roster,
  activeCount,
  onChanged,
}: {
  set: TeamSet;
  roster: Roster;
  activeCount: number;
  onChanged: () => void;
}) {
  const trpc = useTRPC();

  const [open, setOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(set.name);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  /*
    Where everybody is now, as the server last answered. Staged rather than written per select,
    because `setPlacements` takes the whole placement — so the screen holds a draft and sends it
    when an instructor is done rather than firing a request per change.
  */
  const placedNow = React.useCallback(() => {
    const current = new Map<string, string | null>();
    for (const entry of roster) current.set(entry.enrollmentId, null);
    for (const team of set.teams) {
      for (const member of team.members) current.set(member.enrollmentId, team.id);
    }
    return current;
  }, [roster, set.teams]);

  const [draft, setDraft] = React.useState<Map<string, string | null>>(placedNow);

  // Reset when the server's answer changes underneath, so an instructor who saves and reopens
  // sees what was saved rather than whatever the selects happened to be left on.
  React.useEffect(() => {
    setDraft(placedNow());
  }, [placedNow]);

  const onError = (error: { message: string }) => toast.error(error.message);

  const rename = useMutation(
    trpc.teamSets.rename.mutationOptions({
      onError,
      onSuccess: (updated) => {
        toast.success(`Renamed to "${updated.name}".`);
        setRenaming(false);
        onChanged();
      },
    }),
  );

  const remove = useMutation(
    trpc.teamSets.remove.mutationOptions({
      onError,
      onSuccess: (removed) => {
        toast.success(
          `Removed "${removed.name}". Its ${removed.memberCount} ` +
            `${removed.memberCount === 1 ? "member stays" : "members stay"} on the roster.`,
        );
        onChanged();
      },
    }),
  );

  const addTeam = useMutation(
    trpc.teamSets.addTeam.mutationOptions({
      onError,
      onSuccess: (team) => {
        toast.success(`Added "${team.name}".`);
        onChanged();
      },
    }),
  );

  const save = useMutation(
    trpc.teamSets.setPlacements.mutationOptions({
      onError,
      onSuccess: () => {
        toast.success(`Saved who is on each team of "${set.name}".`);
        onChanged();
      },
    }),
  );

  const saved = placedNow();
  const dirty = [...draft].some(([enrollmentId, teamId]) => saved.get(enrollmentId) !== teamId);

  const draftCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const teamId of draft.values()) {
      if (teamId) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
    }
    return counts;
  }, [draft]);

  const draftUnplaced = [...draft.values()].filter((teamId) => teamId === null).length;

  /** Deals every fellow round-robin into the teams, in roster order so it is repeatable. */
  function distributeEvenly() {
    if (set.teams.length === 0) return;
    setDraft(() => {
      const next = new Map<string, string | null>();
      roster.forEach((entry, index) => {
        next.set(entry.enrollmentId, set.teams[index % set.teams.length].id);
      });
      return next;
    });
  }

  function clearPlacements() {
    setDraft(new Map(roster.map((entry) => [entry.enrollmentId, null])));
  }

  const teamItems = React.useMemo(
    () => ({
      [UNPLACED]: "— no team —",
      ...Object.fromEntries(set.teams.map((team) => [team.id, team.name])),
    }),
    [set.teams],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        {renaming ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              rename.mutate({ teamSetId: set.id, name });
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
                setName(set.name);
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
              {set.name}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {set.teams.length} {set.teams.length === 1 ? "team" : "teams"}
              </span>
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {set.placedCount} of {activeCount} placed
              </span>
              {/*
                The number that costs somebody a submission if it goes unnoticed: a fellow on no
                team of the set an assignment is handed in by gets no work to accept at all.
              */}
              {set.unplacedCount > 0 && (
                <span className="text-xs font-normal tabular-nums text-amber-600 dark:text-amber-500">
                  {set.unplacedCount} unplaced
                </span>
              )}
              {set.assignmentCount > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  used by {set.assignmentCount}{" "}
                  {set.assignmentCount === 1 ? "assignment" : "assignments"}
                </span>
              )}
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

      {confirmingRemove && (
        <div className="mx-3 mb-2 flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
          <span className="text-xs text-muted-foreground">
            Removing &ldquo;{set.name}&rdquo; dissolves its {set.teams.length}{" "}
            {set.teams.length === 1 ? "team" : "teams"}. Nobody leaves the roster and nothing
            anybody submitted changes. An assignment handed in through this set is refused, because
            its submissions name these teams.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate({ teamSetId: set.id });
                setConfirmingRemove(false);
              }}
            >
              Remove the set
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      <CollapsibleContent>
        <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
          {/* The teams themselves: what they are called, and how many the draft puts on each. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Teams
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={addTeam.isPending}
                onClick={() => addTeam.mutate({ teamSetId: set.id })}
              >
                <Plus data-icon="inline-start" />
                Add a team
              </Button>
            </div>
            <ul className="flex flex-col">
              {set.teams.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  draftCount={draftCounts.get(team.id) ?? 0}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          </div>

          {/* Who is on which. A select, because a set is a partition. */}
          {roster.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nobody has joined this program yet.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Who is on each
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={set.teams.length === 0}
                    onClick={distributeEvenly}
                  >
                    <Shuffle data-icon="inline-start" />
                    Distribute evenly
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearPlacements}>
                    Clear
                  </Button>
                </div>
              </div>

              <ul className="flex flex-col">
                {roster.map((entry) => (
                  <li
                    key={entry.enrollmentId}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <span className="flex-1 truncate">{labelFor(entry.student)}</span>
                    <Select
                      value={draft.get(entry.enrollmentId) ?? UNPLACED}
                      items={teamItems}
                      onValueChange={(next) => {
                        if (!next) return;
                        setDraft((current) => {
                          const copy = new Map(current);
                          copy.set(entry.enrollmentId, next === UNPLACED ? null : String(next));
                          return copy;
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 w-44 min-w-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNPLACED}>— no team —</SelectItem>
                        {set.teams.map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-2 border-t border-border pt-2">
                <Button
                  size="sm"
                  disabled={!dirty || save.isPending}
                  onClick={() =>
                    save.mutate({
                      teamSetId: set.id,
                      placements: [...draft].map(([enrollmentId, teamId]) => ({
                        enrollmentId,
                        teamId,
                      })),
                    })
                  }
                >
                  {save.isPending ? "Saving…" : "Save teams"}
                </Button>
                {dirty && (
                  <Button size="sm" variant="ghost" onClick={() => setDraft(placedNow())}>
                    Discard
                  </Button>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {draftUnplaced === 0
                    ? "everybody placed"
                    : `${draftUnplaced} on no team${dirty ? " (unsaved)" : ""}`}
                </span>
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One team inside a set: rename it, remove it, and see how many the draft puts on it. */
function TeamRow({
  team,
  draftCount,
  onChanged,
}: {
  team: TeamSet["teams"][number];
  draftCount: number;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(team.name);

  const onError = (error: { message: string }) => toast.error(error.message);

  const rename = useMutation(
    trpc.teamSets.renameTeam.mutationOptions({
      onError,
      onSuccess: (updated) => {
        toast.success(`Renamed to "${updated.name}".`);
        setRenaming(false);
        onChanged();
      },
    }),
  );

  const remove = useMutation(
    trpc.teamSets.removeTeam.mutationOptions({
      onError,
      onSuccess: (removed) => {
        toast.success(
          `Removed "${removed.name}". Its ${removed.memberCount} ` +
            `${removed.memberCount === 1 ? "member is" : "members are"} now on no team of this set.`,
        );
        onChanged();
      },
    }),
  );

  if (renaming) {
    return (
      <li>
        <form
          className="flex items-center gap-2 px-2 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            rename.mutate({ teamId: team.id, name });
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
              setName(team.name);
            }}
          >
            Cancel
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
      <span className="flex-1 truncate font-medium">{team.name}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {draftCount} {draftCount === 1 ? "member" : "members"}
      </span>
      {/*
        The saved members, named. A team is the smallest thing on this screen somebody could get
        wrong without noticing, and a count alone would not show it.
      */}
      {team.members.length > 0 && (
        <span className="hidden max-w-64 shrink-0 truncate text-xs text-muted-foreground sm:inline">
          {team.members.map((member) => labelFor(member.student)).join(", ")}
        </span>
      )}
      <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
        <Pencil data-icon="inline-start" />
        Rename
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ teamId: team.id })}
      >
        <Trash2 data-icon="inline-start" />
        Remove
      </Button>
    </li>
  );
}
