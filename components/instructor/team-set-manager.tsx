"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  panelSurface,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayNameOf } from "@/lib/people";
import { assignTeams, planDistribution, type DistributionGroup } from "@/lib/teams/distribute";
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
 * **A set is a partition**, so an open set is drawn the way the cohort manager draws a program: a
 * card per team with its members inside, and no name appears twice. The first card is **No team**,
 * always present, because the fellow on no team of the set an assignment is handed in by gets no
 * work to accept at all, and a card that is always there names them at the top rather than leaving
 * them to be noticed by their absence from the others.
 *
 * **The team cards sit under cohort headings**, and a team's heading is read from who is on it: the
 * cohort most of its members are in. There is no column for it, deliberately — a team is whatever
 * its members make it, and a team that gains a guest from another cohort keeps its heading while
 * the guest is labelled. A team with nobody on it is under Empty teams, since nothing about it says
 * which cohort it is for.
 *
 * **A set is made empty and its teams are made next**, by the Create teams panel: either a number
 * of empty teams to fill by hand, or **Distribute evenly** — teams of about a size, and, when the
 * program has cohorts, kept within them. The arithmetic is `lib/teams/distribute.ts`, run here in
 * the browser so the panel can say what it is about to make before it makes it; the server only
 * ever hears "add this many teams" and then "here is everybody's placement".
 *
 * **Every change is written when it is made.** Moving one fellow sends that one placement, and
 * Distribute evenly sends the whole roster; `setPlacements` takes a placement of any size, so the
 * two are the same act at different sizes. The card a fellow is drawn in comes from a local map
 * that the move updates before the request returns, and a refusal puts the map back to what the
 * server last said.
 */

type TeamSets = RouterOutputs["teamSets"]["listForCourse"];
type TeamSet = TeamSets["sets"][number];
type Team = TeamSet["teams"][number];
/**
 * Every active fellow of the program, which placement needs and this component does not fetch.
 *
 * Read from the cohorts router because it is already the list of active enrollments with their
 * students and the cohort each is in. The cohort is what lets the cards sit under cohort headings
 * and lets Distribute evenly keep a cohort's fellows together.
 */
type Roster = RouterOutputs["cohorts"]["membershipsForProgram"];
type Fellow = Roster[number];
type Cohort = RouterOutputs["cohorts"]["listForProgram"]["cohorts"][number];

/**
 * What to call somebody, in the order the rest of this application prefers.
 *
 * The same chain `membershipsForProgram` sorts by, taken from the same function so the two cannot
 * drift: a list sorted on one name and printed under another reads as unsorted.
 */
function labelFor(entry: Fellow): string {
  return displayNameOf(entry.student, "Unnamed");
}

/**
 * The roster in cohort order: each cohort's fellows under its name, then the fellows in none.
 *
 * What Distribute evenly divides when asked to keep cohorts together. A group with nobody in it
 * is dropped, since a plan gives it no team anyway. The roster arrives sorted by name, so each
 * group is alphabetical without sorting again.
 */
function byCohort(roster: Roster, cohorts: Cohort[]): DistributionGroup<Fellow>[] {
  const groups: DistributionGroup<Fellow>[] = [
    ...cohorts.map((cohort) => ({
      label: cohort.name,
      fellows: roster.filter((entry) => entry.cohortId === cohort.id),
    })),
    {
      label: "No cohort",
      fellows: roster.filter(
        (entry) => entry.cohortId === null || !cohorts.some((c) => c.id === entry.cohortId),
      ),
    },
  ];
  return groups.filter((group) => group.fellows.length > 0);
}

/** One run of team cards under one heading, or under none when the program has no cohorts. */
type Section = {
  key: string;
  /** Null when the program has no cohorts and the teams are simply listed. */
  label: string | null;
  /** The cohort the heading names; null for No cohort, undefined for Empty teams and for no heading. */
  cohortId: string | null | undefined;
  teams: Team[];
};

/**
 * Which heading each team goes under, read from who is on it.
 *
 * The cohort holding most of a team's members, with a tie going to the earlier cohort in the
 * picker's order, so the answer is the same on every render. A fellow in no cohort counts for the
 * No cohort heading. A team with nobody on it goes under Empty teams. With no cohorts at all there
 * is one section with no heading, because a heading over everything names a division that does
 * not exist.
 */
function sectionsFor(
  teams: Team[],
  membersOf: Map<string | null, Fellow[]>,
  cohorts: Cohort[],
): Section[] {
  if (cohorts.length === 0) {
    return [{ key: "all", label: null, cohortId: undefined, teams }];
  }

  const order: (string | null)[] = [...cohorts.map((cohort) => cohort.id), null];
  const buckets = new Map<string | null | undefined, Team[]>();
  for (const key of order) buckets.set(key, []);
  buckets.set(undefined, []);

  for (const team of teams) {
    const members = membersOf.get(team.id) ?? [];
    if (members.length === 0) {
      buckets.get(undefined)!.push(team);
      continue;
    }
    const counts = new Map<string | null, number>();
    for (const member of members) {
      const key = order.includes(member.cohortId) ? member.cohortId : null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = -1;
    for (const key of order) {
      const count = counts.get(key) ?? 0;
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    }
    buckets.get(best)!.push(team);
  }

  const sections: Section[] = [
    ...cohorts.map((cohort) => ({
      key: cohort.id,
      label: `${cohort.name} teams`,
      cohortId: cohort.id as string | null | undefined,
      teams: buckets.get(cohort.id) ?? [],
    })),
    { key: "none", label: "No cohort teams", cohortId: null, teams: buckets.get(null) ?? [] },
    {
      key: "empty",
      label: "Empty teams",
      cohortId: undefined,
      teams: buckets.get(undefined) ?? [],
    },
  ];
  return sections.filter((section) => section.teams.length > 0);
}

export function TeamSetManager({
  courseId,
  data,
  roster,
  cohorts,
}: {
  courseId: string;
  data: TeamSets;
  roster: Roster;
  cohorts: Cohort[];
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const router = useRouter();

  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const create = useMutation(
    trpc.teamSets.create.mutationOptions(
      settled({
        onSuccess: (set) => {
          toast.success(`Created "${set.name}". Now make its teams.`);
          setNewName("");
          setCreating(false);
        },
      }),
    ),
  );

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
              if (!newName.trim()) return;
              create.mutate({ courseId, name: newName });
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
            <Button size="sm" type="submit" disabled={create.isPending || !newName.trim()}>
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
              cohorts={cohorts}
              activeCount={data.activeCount}
              onChanged={() => router.refresh()}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** One set: its teams as cards under cohort headings, and the things that can be done to it. */
function TeamSetRow({
  set,
  roster,
  cohorts,
  activeCount,
  onChanged,
}: {
  set: TeamSet;
  roster: Roster;
  cohorts: Cohort[];
  activeCount: number;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  // Open from the start when there is nothing in it yet, because the next thing to do is inside.
  const [open, setOpen] = React.useState(set.teams.length === 0);
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(set.name);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);
  const [makingTeams, setMakingTeams] = React.useState(false);

  /*
    Where everybody is, as the server last answered. Held here as well as on the server because a
    move is written immediately: the card a name is drawn in changes on the click, and the round
    trip only confirms it.
  */
  const fromServer = React.useCallback(() => {
    const current = new Map<string, string | null>();
    for (const entry of roster) current.set(entry.enrollmentId, null);
    for (const team of set.teams) {
      for (const member of team.members) current.set(member.enrollmentId, team.id);
    }
    return current;
  }, [roster, set.teams]);

  const [placement, setPlacement] = React.useState<Map<string, string | null>>(fromServer);

  // Follow the server's answer whenever it changes underneath — after a move of our own, and
  // after a team is removed and its members come back to No team.
  React.useEffect(() => {
    setPlacement(fromServer());
  }, [fromServer]);

  const place = useMutation(
    trpc.teamSets.setPlacements.mutationOptions(
      settled({
        onError: (error) => {
          toast.error(error.message);
          setPlacement(fromServer());
        },
      }),
    ),
  );

  function moveFellow(entry: Fellow, teamId: string | null, teamName: string) {
    const next = new Map(placement);
    next.set(entry.enrollmentId, teamId);
    setPlacement(next);
    place.mutate(
      { teamSetId: set.id, placements: [{ enrollmentId: entry.enrollmentId, teamId }] },
      { onSuccess: () => toast.success(`Moved ${labelFor(entry)} to ${teamName}.`) },
    );
  }

  const rename = useMutation(
    trpc.teamSets.rename.mutationOptions(
      settled({
        onSuccess: (updated) => {
          toast.success(`Renamed to "${updated.name}".`);
          setRenaming(false);
        },
      }),
    ),
  );

  const remove = useMutation(
    trpc.teamSets.remove.mutationOptions(
      settled({
        onSuccess: (removed) => {
          toast.success(
            `Removed "${removed.name}". Its ${removed.memberCount} ` +
              `${removed.memberCount === 1 ? "member stays" : "members stay"} on the roster.`,
          );
        },
      }),
    ),
  );

  /*
    Who is on each card, from the local placement rather than from the server's member lists, so
    that a count and the names under it are one claim rather than two that can disagree while a
    move is in flight. A placement naming a team that has just been removed falls into No team,
    which is where the server has put that fellow too.
  */
  const membersOf = React.useMemo(() => {
    const groups = new Map<string | null, Fellow[]>();
    groups.set(null, []);
    for (const team of set.teams) groups.set(team.id, []);
    for (const entry of roster) {
      const teamId = placement.get(entry.enrollmentId) ?? null;
      (groups.get(teamId) ?? groups.get(null)!).push(entry);
    }
    return groups;
  }, [set.teams, roster, placement]);

  const sections = React.useMemo(
    () => sectionsFor(set.teams, membersOf, cohorts),
    [set.teams, membersOf, cohorts],
  );

  const cohortName = React.useCallback(
    (entry: Fellow) => cohorts.find((cohort) => cohort.id === entry.cohortId)?.name ?? "No cohort",
    [cohorts],
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={makingTeams}
              onClick={() => setMakingTeams(true)}
            >
              <Plus data-icon="inline-start" />
              Create teams
            </Button>
          </div>

          {makingTeams && (
            <CreateTeamsPanel
              set={set}
              roster={roster}
              cohorts={cohorts}
              onDone={() => {
                setMakingTeams(false);
                onChanged();
              }}
              onCancel={() => setMakingTeams(false)}
            />
          )}

          {roster.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nobody has joined this program yet.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <TeamCard
                team={null}
                fellows={membersOf.get(null) ?? []}
                sections={sections}
                cohortLabel={cohorts.length > 0 ? cohortName : () => null}
                busy={place.isPending}
                onMove={moveFellow}
              />

              {sections.map((section) => (
                <React.Fragment key={section.key}>
                  {section.label && (
                    <h4 className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </h4>
                  )}
                  {section.teams.map((team) => (
                    <TeamCard
                      key={team.id}
                      team={team}
                      fellows={membersOf.get(team.id) ?? []}
                      sections={sections}
                      /*
                        A guest is labelled: somebody on a Cohort A team who is not in Cohort A
                        is the one fact about the card an instructor working one cohort would
                        otherwise have to remember.
                      */
                      cohortLabel={
                        section.cohortId === undefined
                          ? () => null
                          : (entry) =>
                              entry.cohortId === section.cohortId ? null : cohortName(entry)
                      }
                      busy={place.isPending}
                      onMove={moveFellow}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * One team and everybody on it, or — when `team` is null — everybody on no team of this set.
 *
 * The No team card carries no rename and no remove because there is nothing to rename or remove:
 * it is not a row, it is the fellows with no membership in this set. It is always drawn, including
 * empty, because an instructor reading a set is asking whether anybody is unplaced and an absent
 * card would answer that question by saying nothing.
 */
function TeamCard({
  team,
  fellows,
  sections,
  cohortLabel,
  busy,
  onMove,
}: {
  team: Team | null;
  fellows: Fellow[];
  sections: Section[];
  /** What to print after a fellow's name about their cohort, or null for nothing. */
  cohortLabel: (entry: Fellow) => string | null;
  busy: boolean;
  onMove: (entry: Fellow, teamId: string | null, teamName: string) => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(team?.name ?? "");
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  const rename = useMutation(
    trpc.teamSets.renameTeam.mutationOptions(
      settled({
        onSuccess: (updated) => {
          toast.success(`Renamed to "${updated.name}".`);
          setRenaming(false);
        },
      }),
    ),
  );

  const remove = useMutation(
    trpc.teamSets.removeTeam.mutationOptions(
      settled({
        onSuccess: (removed) => {
          toast.success(
            `Removed "${removed.name}". Its ${removed.memberCount} ` +
              `${removed.memberCount === 1 ? "member is" : "members are"} now on no team of this set.`,
          );
        },
      }),
    ),
  );

  const title = team?.name ?? "No team";

  return (
    <section className={cn(panelSurface, "overflow-hidden")}>
      <div className="flex flex-wrap items-center gap-2 bg-muted px-3 py-2">
        {renaming && team ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
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
        ) : (
          <>
            <UsersRound aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h3>
            <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {fellows.length} {fellows.length === 1 ? "fellow" : "fellows"}
            </span>
            {team && (
              <>
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
          </>
        )}
      </div>

      {confirmingRemove && team && (
        <div className="flex flex-col gap-2 border-b border-border p-3">
          {/*
            Says what it costs rather than asking "are you sure". The one consequence worth naming
            is the refusal: a team that has handed work in cannot go, because its submissions name
            it and one of them may carry a grade that has gone out.
          */}
          <span className="text-xs text-muted-foreground">
            Removing &ldquo;{team.name}&rdquo; puts its {fellows.length}{" "}
            {fellows.length === 1 ? "fellow" : "fellows"} on no team. Nobody leaves the roster and
            no grade moves. A team that has already handed work in is refused — move its members
            instead.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate({ teamId: team.id });
                setConfirmingRemove(false);
              }}
            >
              Remove the team
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {fellows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {team ? "Nobody is on this team yet." : "Everybody is on a team."}
        </p>
      ) : (
        <ul className="flex flex-col p-1">
          {fellows.map((entry) => {
            const label = cohortLabel(entry);
            return (
              <li
                key={entry.enrollmentId}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 truncate">
                  {labelFor(entry)}
                  {label && <span className="ml-1.5 text-xs text-muted-foreground">· {label}</span>}
                </span>
                <MoveTo entry={entry} team={team} sections={sections} busy={busy} onMove={onMove} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Where else one fellow could go.
 *
 * Every team of the set but the one they are on, under the same headings the cards use so a long
 * menu reads the way the screen does, and No team last. Naming the card the fellow is standing in
 * would be an item that does nothing, since a set is a partition.
 */
function MoveTo({
  entry,
  team,
  sections,
  busy,
  onMove,
}: {
  entry: Fellow;
  team: Team | null;
  sections: Section[];
  busy: boolean;
  onMove: (entry: Fellow, teamId: string | null, teamName: string) => void;
}) {
  const elsewhere = sections
    .map((section) => ({ ...section, teams: section.teams.filter((t) => t.id !== team?.id) }))
    .filter((section) => section.teams.length > 0);

  if (elsewhere.length === 0 && team === null) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="ghost" className="shrink-0" disabled={busy}>
            <ArrowRightLeft data-icon="inline-start" />
            Move to
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {elsewhere.map((section) => (
          <DropdownMenuGroup key={section.key}>
            {section.label && <DropdownMenuLabel>{section.label}</DropdownMenuLabel>}
            {section.teams.map((other) => (
              <DropdownMenuItem key={other.id} onClick={() => onMove(entry, other.id, other.name)}>
                {other.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        {team && elsewhere.length > 0 && <DropdownMenuSeparator />}
        {team && (
          <DropdownMenuItem onClick={() => onMove(entry, null, "No team")}>
            No team
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** How the panel makes teams: a number of empty ones, or filled ones of about a size. */
type CreateMode = "count" | "distribute";

/**
 * Making a set's teams: a number of empty teams, or Distribute evenly.
 *
 * **Distribute evenly does its arithmetic here and writes twice.** It works out how many teams
 * the roster makes at the size asked — per cohort if the box is ticked — shows that before
 * anything is pressed, and then adds only the teams the set does not already have and sends the
 * whole placement. Existing teams are used first, in order, so pressing it again on a set with
 * the right number of teams makes nothing and simply re-deals everybody; a press that needs
 * fewer teams than there are leaves the surplus empty and says so, and the Remove on each team
 * takes them away. Nothing here removes a team, because a team that has handed work in cannot be
 * removed and a shuffle is not the place to find that out.
 *
 * The deal is random, so a second press gives a different arrangement. That is the point of
 * pressing it twice.
 */
function CreateTeamsPanel({
  set,
  roster,
  cohorts,
  onDone,
  onCancel,
}: {
  set: TeamSet;
  roster: Roster;
  cohorts: Cohort[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const trpc = useTRPC();

  const [mode, setMode] = React.useState<CreateMode>(roster.length > 0 ? "distribute" : "count");
  const [countText, setCountText] = React.useState("4");
  const [sizeText, setSizeText] = React.useState("3");
  const [keepCohorts, setKeepCohorts] = React.useState(cohorts.length > 0);
  const [busy, setBusy] = React.useState(false);

  const count = Number.parseInt(countText, 10);
  const countIsUsable = Number.isInteger(count) && count >= 1 && count <= 60;

  /*
    At least two: "teams of one" is not team work, and one is what a typo in this field most
    often produces. The plan then never makes a team of one either — see `teamCountFor`.
  */
  const size = Number.parseInt(sizeText, 10);
  const sizeIsUsable = Number.isInteger(size) && size >= 2 && size <= 60;

  const plan = React.useMemo(() => {
    const groups =
      keepCohorts && cohorts.length > 0
        ? byCohort(roster, cohorts)
        : [{ label: "Everybody", fellows: roster }];
    return planDistribution(groups, sizeIsUsable ? size : 1);
  }, [roster, cohorts, keepCohorts, size, sizeIsUsable]);

  const shortfall = Math.max(0, plan.teamCount - set.teams.length);
  const surplus = Math.max(0, set.teams.length - plan.teamCount);

  const addTeams = useMutation(trpc.teamSets.addTeam.mutationOptions());
  const place = useMutation(trpc.teamSets.setPlacements.mutationOptions());

  async function createEmpty() {
    if (!countIsUsable) return;
    setBusy(true);
    try {
      const made = await addTeams.mutateAsync({ teamSetId: set.id, count });
      toast.success(
        `Added ${made.length} ${made.length === 1 ? "team" : "teams"}. Nobody is on one yet.`,
      );
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function distribute() {
    if (!sizeIsUsable || plan.teamCount === 0) return;
    setBusy(true);
    try {
      const made =
        shortfall > 0 ? await addTeams.mutateAsync({ teamSetId: set.id, count: shortfall }) : [];
      const teamIds = [...set.teams.map((team) => team.id), ...made.map((team) => team.id)];

      const assignments = assignTeams(plan, teamIds);
      await place.mutateAsync({
        teamSetId: set.id,
        placements: assignments.map((assignment) => ({
          enrollmentId: assignment.fellow.enrollmentId,
          teamId: assignment.teamId,
        })),
      });

      toast.success(
        `Placed ${plan.fellowCount} ${plan.fellowCount === 1 ? "fellow" : "fellows"} on ` +
          `${plan.teamCount} ${plan.teamCount === 1 ? "team" : "teams"}.` +
          (surplus > 0
            ? ` ${surplus} ${surplus === 1 ? "team is" : "teams are"} now empty — remove ` +
              `${surplus === 1 ? "it" : "them"} if you do not need ${surplus === 1 ? "it" : "them"}.`
            : ""),
      );
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
      // Teams added before a refused placement are real; show them rather than a stale list.
      if (shortfall > 0) onDone();
    } finally {
      setBusy(false);
    }
  }

  /** "Cohort A 5 · Cohort B 3 · No cohort 1" — or nothing, when there is one group. */
  const perGroup =
    plan.groups.length > 1
      ? plan.groups.map((group) => `${group.label} ${group.teamCount}`).join(" · ")
      : null;

  return (
    <div className={cn(panelSurface, "flex flex-col gap-3 p-3")}>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          type="button"
          variant={mode === "distribute" ? "secondary" : "ghost"}
          disabled={roster.length === 0}
          onClick={() => setMode("distribute")}
        >
          <Shuffle data-icon="inline-start" />
          Distribute evenly
        </Button>
        <Button
          size="sm"
          type="button"
          variant={mode === "count" ? "secondary" : "ghost"}
          onClick={() => setMode("count")}
        >
          A number of empty teams
        </Button>
      </div>

      {mode === "count" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createEmpty();
          }}
        >
          <div className="flex w-32 flex-col gap-1.5">
            <Label htmlFor={`team-count-${set.id}`}>How many teams?</Label>
            <Input
              autoFocus
              id={`team-count-${set.id}`}
              type="number"
              min={1}
              max={60}
              value={countText}
              onChange={(event) => setCountText(event.target.value)}
            />
          </div>
          <Button size="sm" type="submit" disabled={busy || !countIsUsable}>
            {busy
              ? "Adding…"
              : `Add ${countIsUsable ? count : ""} ${count === 1 ? "team" : "teams"}`}
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <span className="basis-full text-xs text-muted-foreground">
            Empty teams, added after the {set.teams.length} already here. Move fellows onto them
            from the cards below.
          </span>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void distribute();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-36 flex-col gap-1.5">
              <Label htmlFor={`team-size-${set.id}`}>Fellows per team</Label>
              <Input
                autoFocus
                id={`team-size-${set.id}`}
                type="number"
                min={2}
                max={60}
                value={sizeText}
                onChange={(event) => setSizeText(event.target.value)}
              />
            </div>
            {cohorts.length > 0 && (
              <Label className="flex h-8 cursor-pointer items-center gap-2 font-normal">
                <Checkbox
                  checked={keepCohorts}
                  onCheckedChange={(checked) => setKeepCohorts(checked === true)}
                />
                Keep cohorts together
              </Label>
            )}
          </div>

          {/*
            What pressing the button will do, before it is pressed. The per-cohort line is the
            one an instructor working one cohort is reading for.
          */}
          <p className="text-xs text-muted-foreground">
            {!sizeIsUsable ? (
              "Teams need at least two fellows."
            ) : (
              <>
                {plan.fellowCount} {plan.fellowCount === 1 ? "fellow" : "fellows"} in teams of{" "}
                {size}: <span className="font-medium text-foreground">{plan.teamCount}</span>{" "}
                {plan.teamCount === 1 ? "team" : "teams"}
                {perGroup && ` (${perGroup})`}. Never a team of one — a leftover fellow joins an
                existing team.
                {set.teams.length > 0 && shortfall > 0 && (
                  <>
                    {" "}
                    Uses the {set.teams.length} {set.teams.length === 1 ? "team" : "teams"} already
                    here first and adds {shortfall}.
                  </>
                )}
                {set.teams.length > 0 && shortfall === 0 && surplus === 0 && (
                  <> Re-deals everybody across the teams already here.</>
                )}
                {surplus > 0 && (
                  <>
                    {" "}
                    Uses the first {plan.teamCount} of the {set.teams.length} teams already here and
                    leaves {surplus} empty.
                  </>
                )}
              </>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="submit"
              disabled={busy || !sizeIsUsable || plan.teamCount === 0}
            >
              {busy
                ? "Placing…"
                : set.placedCount > 0
                  ? "Reshuffle everybody"
                  : "Make the teams and place everybody"}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
