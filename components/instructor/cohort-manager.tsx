"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Pencil, Plus, Shuffle, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Naming a program's cohorts, and placing every fellow in one.
 *
 * A **cohort** splits the marking between instructors: it is a filter, fellows never see it, and it
 * changes nothing about the work. That is what makes it different from a **team**, which hands in
 * one piece of work, receives one grade, and whose members can see each other. Teams belong to a
 * course and are managed beside its curriculum; cohorts belong to the matriculation, because
 * dividing a roster between co-teachers was never a per-course fact.
 *
 * **A cohort is a partition**, held as `Enrollment.cohortId`: a fellow is in at most one, so
 * placement is one select per fellow rather than the checkbox grid a many-to-many membership would
 * need. Every fellow appearing exactly once is also what makes "who has nobody grading them"
 * readable — it is the fellows whose select reads "no cohort".
 *
 * Placements are staged in the browser and saved together, the way team placements are and for the
 * same reason: `setPlacements` takes the whole placement at once, so it is idempotent, it cannot be
 * left half applied, and "distribute evenly" is then the same act as changing one select.
 *
 * **It is a tab on the roster rather than a screen of its own**, because it is a thing done *to* the
 * roster: the placement is one control the size of the roster, so it cannot sit under the tables,
 * and "who has nobody grading them" is asked while reading them. A tab separates the two without
 * making either somewhere you have to go.
 */

type Cohorts = RouterOutputs["cohorts"]["listForProgram"];
type Memberships = RouterOutputs["cohorts"]["membershipsForProgram"];

/** What to call somebody, in the order the rest of this application prefers. */
function labelFor(student: Memberships[number]["student"]): string {
  return student.displayName ?? student.githubUsername ?? student.email ?? "Unnamed";
}

/** The value a select uses for "in no cohort". Not a cohort id, so it cannot collide. */
const UNASSIGNED_VALUE = "unassigned";

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
  const router = useRouter();

  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");

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

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersRound className="size-4 text-muted-foreground" />
                Cohorts
              </CardTitle>
              <CardDescription className="mt-1">
                How this matriculation&apos;s roster is divided among its instructors. Choosing one
                narrows grading triage, an assignment&apos;s queue, the gradebook, and the
                curriculum list — in every course of the matriculation at once. A cohort grants
                nothing and withholds nothing: anybody who instructs this program can still grade
                anybody&apos;s work, which is what lets a colleague cover.
              </CardDescription>
            </div>
            {!creating && (
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <Plus data-icon="inline-start" />
                New cohort
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

          {data.cohorts.length === 0 && !creating ? (
            <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
              No cohorts yet. Every screen shows the whole roster until there are.
            </p>
          ) : (
            <ul className="flex flex-col">
              {data.cohorts.map((cohort) => (
                <CohortRow key={cohort.id} cohort={cohort} onChanged={() => router.refresh()} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/*
        The placement, in its own card below the list rather than inside each cohort's row.

        **One list of fellows, not one per cohort**, which is the whole shape of a partition: every
        fellow appears exactly once, so it is impossible to place somebody twice and impossible to
        lose track of somebody nobody has placed. A card per cohort would have made "who is in no
        cohort" a question answered by reading four lists and noticing an absence.
      */}
      <CohortPlacements programId={programId} data={data} memberships={memberships} />
    </div>
  );
}

/** One cohort: what it is called, how many are in it, and the things that can be done to it. */
function CohortRow({
  cohort,
  onChanged,
}: {
  cohort: Cohorts["cohorts"][number];
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(cohort.name);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  const onError = (error: { message: string }) => toast.error(error.message);

  const rename = useMutation(
    trpc.cohorts.rename.mutationOptions({
      onError,
      onSuccess: (updated) => {
        toast.success(`Renamed to "${updated.name}".`);
        setRenaming(false);
        onChanged();
      },
    }),
  );

  const remove = useMutation(
    trpc.cohorts.remove.mutationOptions({
      onError,
      onSuccess: (removed) => {
        toast.success(
          `Removed "${removed.name}". Its ${removed.memberCount} ` +
            `${removed.memberCount === 1 ? "fellow is" : "fellows are"} now in no cohort.`,
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
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1 truncate font-medium">{cohort.name}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {cohort.memberCount} {cohort.memberCount === 1 ? "fellow" : "fellows"}
        </span>
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
      </div>

      {confirmingRemove && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
          {/*
            Says what it costs rather than asking "are you sure". Removing a cohort is genuinely
            cheap — nobody leaves the roster and no grade changes — and the one consequence worth
            naming is that any instructor filtered to it goes back to reading the whole roster.
          */}
          <span className="text-xs text-muted-foreground">
            Removing &ldquo;{cohort.name}&rdquo; puts its {cohort.memberCount}{" "}
            {cohort.memberCount === 1 ? "fellow" : "fellows"} in no cohort. Nobody leaves the roster,
            nothing anybody submitted changes, and no grade moves. Any instructor filtered to it goes
            back to seeing every fellow.
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
    </li>
  );
}

/** Who is in each cohort: a select per fellow, staged and saved together. */
function CohortPlacements({
  programId,
  data,
  memberships,
}: {
  programId: string;
  data: Cohorts;
  memberships: Memberships;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  /*
    Where everybody is now, as the server last answered. Staged rather than written per select,
    because `setPlacements` takes the whole placement — so the screen holds a draft and sends it
    when an instructor is done rather than firing a request per change.
  */
  const placedNow = React.useCallback(() => {
    const current = new Map<string, string | null>();
    for (const entry of memberships) current.set(entry.enrollmentId, entry.cohortId);
    return current;
  }, [memberships]);

  const [draft, setDraft] = React.useState<Map<string, string | null>>(placedNow);

  // Reset when the server's answer changes underneath, so an instructor who saves and reopens
  // sees what was saved rather than whatever the selects happened to be left on.
  React.useEffect(() => {
    setDraft(placedNow());
  }, [placedNow]);

  const save = useMutation(
    trpc.cohorts.setPlacements.mutationOptions({
      onError: (error) => toast.error(error.message),
      onSuccess: (result) => {
        toast.success(
          `Placed ${result.placed} ${result.placed === 1 ? "fellow" : "fellows"} across ` +
            `${result.cohorts} ${result.cohorts === 1 ? "cohort" : "cohorts"}.`,
        );
        router.refresh();
      },
    }),
  );

  const saved = placedNow();
  const dirty = [...draft].some(([enrollmentId, cohortId]) => saved.get(enrollmentId) !== cohortId);

  const draftCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const cohortId of draft.values()) {
      if (cohortId) counts.set(cohortId, (counts.get(cohortId) ?? 0) + 1);
    }
    return counts;
  }, [draft]);

  const draftUnassigned = [...draft.values()].filter((cohortId) => cohortId === null).length;

  /** Deals every fellow round-robin into the cohorts, in roster order so it is repeatable. */
  function distributeEvenly() {
    if (data.cohorts.length === 0) return;
    setDraft(() => {
      const next = new Map<string, string | null>();
      memberships.forEach((entry, index) => {
        next.set(entry.enrollmentId, data.cohorts[index % data.cohorts.length].id);
      });
      return next;
    });
  }

  function clearPlacements() {
    setDraft(new Map(memberships.map((entry) => [entry.enrollmentId, null])));
  }

  const cohortItems = React.useMemo(
    () => ({
      [UNASSIGNED_VALUE]: "— no cohort —",
      ...Object.fromEntries(data.cohorts.map((cohort) => [cohort.id, cohort.name])),
    }),
    [data.cohorts],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Who is in each</CardTitle>
            <CardDescription className="mt-1">
              Every active fellow, once. Removed fellows are not here — they keep whichever cohort
              they were in, so restoring somebody returns them to it, but placing somebody who has
              left would put them in a pile that never clears.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={data.cohorts.length === 0}
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
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        {memberships.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nobody has joined this matriculation yet.
          </p>
        ) : (
          <>
            {/* The draft's counts, so an uneven split is visible before it is saved. */}
            {data.cohorts.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2 text-xs tabular-nums text-muted-foreground">
                {data.cohorts.map((cohort) => (
                  <span key={cohort.id}>
                    {cohort.name} · {draftCounts.get(cohort.id) ?? 0}
                  </span>
                ))}
              </div>
            )}

            <ul className="flex flex-col">
              {memberships.map((entry) => (
                <li
                  key={entry.enrollmentId}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <span className="flex-1 truncate">{labelFor(entry.student)}</span>
                  <Select
                    value={draft.get(entry.enrollmentId) ?? UNASSIGNED_VALUE}
                    items={cohortItems}
                    onValueChange={(next) => {
                      if (!next) return;
                      setDraft((current) => {
                        const copy = new Map(current);
                        copy.set(
                          entry.enrollmentId,
                          next === UNASSIGNED_VALUE ? null : String(next),
                        );
                        return copy;
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 w-44 min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED_VALUE}>— no cohort —</SelectItem>
                      {data.cohorts.map((cohort) => (
                        <SelectItem key={cohort.id} value={cohort.id}>
                          {cohort.name}
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
                    programId,
                    placements: [...draft].map(([enrollmentId, cohortId]) => ({
                      enrollmentId,
                      cohortId,
                    })),
                  })
                }
              >
                {save.isPending ? "Saving…" : "Save cohorts"}
              </Button>
              {dirty && (
                <Button size="sm" variant="ghost" onClick={() => setDraft(placedNow())}>
                  Discard
                </Button>
              )}
              {/*
                The number worth watching. A fellow in no cohort is not broken — it is what the
                No cohort filter finds — but somebody who joined by the link in October and was
                never placed is invisible to every instructor working a cohort, and this is the
                one place that says so.
              */}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {draftUnassigned === 0
                  ? "everybody placed"
                  : `${draftUnassigned} in no cohort${dirty ? " (unsaved)" : ""}`}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
