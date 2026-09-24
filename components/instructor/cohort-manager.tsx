"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { ArrowRightLeft, Eraser, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import { panelSurface } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayNameOf } from "@/lib/people";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Naming a program's cohorts, and placing every fellow in one.
 *
 * A **cohort** splits the marking between instructors: it is a filter, fellows never see it, and it
 * changes nothing about the work. That is what makes it different from a **team**, which hands in
 * one piece of work, receives one grade, and whose members can see each other. Teams belong to a
 * course and are managed beside its curriculum; cohorts belong to the program, because
 * dividing a roster between co-teachers was never a per-course fact.
 *
 * **A cohort is a partition**, held as `Enrollment.cohortId`: a fellow is in at most one, so the
 * screen can show each cohort as a card with its members inside and know that no name appears
 * twice. The first card is No Cohort, which is the reason the partition is drawn this way — the
 * fellow nobody has placed is the one an instructor opens this tab to find, and a card that is
 * always present names them at the top instead of leaving them to be noticed by their absence from
 * four other lists.
 *
 * **Every change is written when it is made.** Moving one fellow sends that one placement and
 * Reset sends the whole roster; `setPlacements` takes a placement of any size and applies it in one
 * statement per target cohort, so the two are the same act at different sizes. The card a fellow is
 * drawn in comes from a local map that the move updates before the request returns, so the count
 * and the list move together on the click; a refusal puts the map back to what the server last
 * said.
 *
 * **It is a tab on the roster rather than a screen of its own**, because it is a thing done *to* the
 * roster: the placement is one control the size of the roster, so it cannot sit under the tables,
 * and "who has nobody grading them" is asked while reading them. A tab separates the two without
 * making either somewhere you have to go.
 */

type Cohorts = RouterOutputs["cohorts"]["listForProgram"];
type Cohort = Cohorts["cohorts"][number];
type Memberships = RouterOutputs["cohorts"]["membershipsForProgram"];
type Fellow = Memberships[number];

/** One placement to send: where one fellow goes, with null meaning no cohort. */
type Placement = { enrollmentId: string; cohortId: string | null };

/**
 * What to call somebody, in the order the rest of this application prefers.
 *
 * The same chain `membershipsForProgram` sorts by, taken from the same function so the two cannot
 * drift: a list sorted on one name and printed under another reads as unsorted.
 */
function labelFor(entry: Fellow): string {
  return displayNameOf(entry.student, "Unnamed");
}

export function CohortManager({
  programId,
  data,
  memberships,
}: {
  programId: string;
  data: Cohorts;
  memberships: Memberships;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [confirmingReset, setConfirmingReset] = React.useState(false);

  /*
    Where everybody is, as the server last answered. Held here as well as on the server because a
    move is written immediately: the card a name is drawn in changes on the click, and the round
    trip only confirms it.
  */
  const fromServer = React.useCallback(() => {
    const current = new Map<string, string | null>();
    for (const entry of memberships) current.set(entry.enrollmentId, entry.cohortId);
    return current;
  }, [memberships]);

  const [placement, setPlacement] = React.useState<Map<string, string | null>>(fromServer);

  // Follow the server's answer whenever it changes underneath — after a save of our own, and after
  // a cohort is removed and its fellows come back unplaced.
  React.useEffect(() => {
    setPlacement(fromServer());
  }, [fromServer]);

  const place = useMutation(
    trpc.cohorts.setPlacements.mutationOptions(
      settled({
        onError: (error) => {
          toast.error(error.message);
          setPlacement(fromServer());
        },
      }),
    ),
  );

  const create = useMutation(
    trpc.cohorts.create.mutationOptions(
      settled({
        onSuccess: (cohort) => {
          toast.success(`Created "${cohort.name}". Nobody is in it yet.`);
          setNewName("");
          setCreating(false);
        },
      }),
    ),
  );

  /**
   * Writes a placement and shows it at once.
   *
   * `next` is the whole picture the screen should now draw; `payload` is only the part that
   * changed, which for one fellow moving is one entry. Sending the whole roster for a single move
   * would be the same result at the cost of an update statement per cohort.
   */
  function send(next: Map<string, string | null>, payload: Placement[], message: string) {
    setPlacement(next);
    place.mutate({ programId, placements: payload }, { onSuccess: () => toast.success(message) });
  }

  function moveFellow(entry: Fellow, cohortId: string | null, cohortName: string) {
    const next = new Map(placement);
    next.set(entry.enrollmentId, cohortId);
    send(
      next,
      [{ enrollmentId: entry.enrollmentId, cohortId }],
      `Moved ${labelFor(entry)} to ${cohortName}.`,
    );
  }

  function resetPlacements() {
    setConfirmingReset(false);
    if (memberships.length === 0) return;
    const next = new Map<string, string | null>(
      memberships.map((entry) => [entry.enrollmentId, null]),
    );
    send(
      next,
      memberships.map((entry) => ({ enrollmentId: entry.enrollmentId, cohortId: null })),
      "Every fellow is now in no cohort. The cohorts themselves are still here.",
    );
  }

  /*
    Who is in each card, from the local placement rather than from `memberCount`, so that a count
    and the names under it are one claim rather than two that can disagree while a move is in
    flight. `memberships` arrives sorted by the name each row prints, so every card is in
    alphabetical order without sorting again. A placement naming a cohort that has just been
    removed falls into No Cohort, which is where the server has put that fellow too.
  */
  const byCohort = React.useMemo(() => {
    const groups = new Map<string | null, Fellow[]>();
    groups.set(null, []);
    for (const cohort of data.cohorts) groups.set(cohort.id, []);
    for (const entry of memberships) {
      const cohortId = placement.get(entry.enrollmentId) ?? null;
      (groups.get(cohortId) ?? groups.get(null)!).push(entry);
    }
    return groups;
  }, [data.cohorts, memberships, placement]);

  const placedCount = memberships.length - (byCohort.get(null)?.length ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        How this program&apos;s roster is divided among its instructors. Choosing a cohort narrows
        grading triage, an assignment&apos;s queue, the gradebook, and the curriculum list — in
        every course of the program at once. A cohort grants nothing and withholds nothing: anybody
        who instructs this program can still grade anybody&apos;s work, which is what lets a
        colleague cover.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setCreating(true)} disabled={creating}>
          <Plus data-icon="inline-start" />
          New cohort
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={placedCount === 0 || place.isPending}
          onClick={() => setConfirmingReset(true)}
        >
          <Eraser data-icon="inline-start" />
          Reset
        </Button>
      </div>

      {creating && (
        <form
          className={cn(panelSurface, "flex flex-wrap items-end gap-2 p-3")}
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim()) return;
            create.mutate({ programId, name: newName });
          }}
        >
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="cohort-name">What is this cohort called?</Label>
            <Input
              autoFocus
              id="cohort-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Cohort A"
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

      {/*
        Reset undoes an arrangement an instructor may have made one fellow at a time, and nothing
        undoes it back now that a change is written when it is made. So it says what it is about to
        take away before it takes it.
      */}
      {confirmingReset && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          <span className="min-w-48 flex-1 text-xs text-muted-foreground">
            Resetting takes all {placedCount} placed {placedCount === 1 ? "fellow" : "fellows"} out
            of their cohorts and puts them in No cohort. The cohorts themselves stay, and nobody
            leaves the roster.
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={resetPlacements}>
              Reset every placement
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingReset(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {memberships.length === 0 && data.cohorts.length === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          Nobody has joined this program yet, and there are no cohorts. Every screen shows the whole
          roster until both exist.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <CohortCard
            cohort={null}
            fellows={byCohort.get(null) ?? []}
            cohorts={data.cohorts}
            busy={place.isPending}
            onMove={moveFellow}
          />
          {data.cohorts.map((cohort) => (
            <CohortCard
              key={cohort.id}
              cohort={cohort}
              fellows={byCohort.get(cohort.id) ?? []}
              cohorts={data.cohorts}
              busy={place.isPending}
              onMove={moveFellow}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One cohort and everybody in it, or — when `cohort` is null — everybody in none.
 *
 * The No cohort card carries no rename and no remove because there is nothing to rename or remove:
 * it is not a row, it is the fellows whose `cohortId` is null. It is always drawn, including empty,
 * because an instructor reading this tab is asking whether anybody is unplaced and an absent card
 * would answer that question by saying nothing.
 */
function CohortCard({
  cohort,
  fellows,
  cohorts,
  busy,
  onMove,
}: {
  cohort: Cohort | null;
  fellows: Fellow[];
  cohorts: Cohort[];
  busy: boolean;
  onMove: (entry: Fellow, cohortId: string | null, cohortName: string) => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(cohort?.name ?? "");
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  const rename = useMutation(
    trpc.cohorts.rename.mutationOptions(
      settled({
        onSuccess: (updated) => {
          toast.success(`Renamed to "${updated.name}".`);
          setRenaming(false);
        },
      }),
    ),
  );

  const remove = useMutation(
    trpc.cohorts.remove.mutationOptions(
      settled({
        onSuccess: (removed) => {
          toast.success(
            `Removed "${removed.name}". Its ${removed.memberCount} ` +
              `${removed.memberCount === 1 ? "fellow is" : "fellows are"} now in no cohort.`,
          );
        },
      }),
    ),
  );

  const title = cohort?.name ?? "No cohort";

  return (
    <section className={cn(panelSurface, "overflow-hidden")}>
      <div className="flex flex-wrap items-center gap-2 bg-muted px-3 py-2">
        {renaming && cohort ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              rename.mutate({ cohortId: cohort.id, name });
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
                setName(cohort.name);
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
            {cohort && (
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

      {confirmingRemove && cohort && (
        <div className="flex flex-col gap-2 border-b border-border p-3">
          {/*
            Says what it costs rather than asking "are you sure". Removing a cohort is genuinely
            cheap — nobody leaves the roster and no grade changes — and the one consequence worth
            naming is that any instructor filtered to it goes back to reading the whole roster.
          */}
          <span className="text-xs text-muted-foreground">
            Removing &ldquo;{cohort.name}&rdquo; puts its {fellows.length}{" "}
            {fellows.length === 1 ? "fellow" : "fellows"} in No cohort. Nobody leaves the roster,
            nothing anybody submitted changes, and no grade moves. Any instructor filtered to it
            goes back to seeing every fellow.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate({ cohortId: cohort.id });
                setConfirmingRemove(false);
              }}
            >
              Remove the cohort
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {fellows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {cohort ? "Nobody is in this cohort yet." : "Everybody is in a cohort."}
        </p>
      ) : (
        <ul className="flex flex-col p-1">
          {fellows.map((entry) => (
            <li
              key={entry.enrollmentId}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
            >
              <span className="min-w-0 flex-1 truncate">{labelFor(entry)}</span>
              <MoveTo entry={entry} cohort={cohort} cohorts={cohorts} busy={busy} onMove={onMove} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Where else one fellow could go.
 *
 * Only the cohorts they are not already in, No cohort included, because a partition has no second
 * place to be: naming the card the fellow is standing in would be an item that does nothing.
 */
function MoveTo({
  entry,
  cohort,
  cohorts,
  busy,
  onMove,
}: {
  entry: Fellow;
  cohort: Cohort | null;
  cohorts: Cohort[];
  busy: boolean;
  onMove: (entry: Fellow, cohortId: string | null, cohortName: string) => void;
}) {
  const elsewhere = cohorts.filter((other) => other.id !== cohort?.id);

  if (elsewhere.length === 0 && cohort === null) return null;

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
        {elsewhere.map((other) => (
          <DropdownMenuItem key={other.id} onClick={() => onMove(entry, other.id, other.name)}>
            {other.name}
          </DropdownMenuItem>
        ))}
        {cohort && elsewhere.length > 0 && <DropdownMenuSeparator />}
        {cohort && (
          <DropdownMenuItem onClick={() => onMove(entry, null, "No cohort")}>
            No cohort
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
