"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { Archive, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTRPC } from "@/trpc/client";

/**
 * Which programs one instructor is on, set by an admin.
 *
 * **The third way somebody comes to instruct a program, and the one for the cases the other two
 * cannot reach.** An instructor invitation makes somebody staff and puts them on nothing; the
 * instructor link is how they join a program they were *sent* one for. Neither helps with the two
 * situations an admin actually meets: somebody who redeemed an invitation months ago and was never
 * added to anything, and somebody who has left the school and has to come off every program at once.
 *
 * **A dialog per person rather than a grid of everybody against everything.** The grid on a
 * program's own settings screen is bounded — that program's instructors against that program's
 * courses — where this one grows in both directions as the years accumulate, and a checkbox grid
 * twelve columns wide is a control nobody reads before pressing.
 *
 * **The whole list is sent, not a diff**, matching every other placement in this application: it is
 * idempotent and cannot be left half applied. The draft is held here until Save, so an admin fixing
 * three rows makes one decision rather than three.
 *
 * It grants no role. The procedure refuses an account that is not already staff, which is what stops
 * this being a second path to staff access — the invitation exists so that granting it is deliberate
 * and leaves a record.
 */
export function StaffProgramsDialog({
  person,
  programs,
  open,
  onOpenChange,
}: {
  person: { id: string; name: string; programIds: string[] };
  /** Every program in the deployment. An admin belongs to none of them and sees all. */
  programs: { id: string; name: string; term: string; archivedAt: Date | null }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [draft, setDraft] = React.useState<Set<string>>(() => new Set(person.programIds));

  /*
    Reset when the dialog opens, so somebody who closed it without saving and opened it again sees
    what is actually stored rather than the ticks they abandoned.
  */
  React.useEffect(() => {
    if (open) setDraft(new Set(person.programIds));
  }, [open, person.programIds]);

  const setPrograms = useMutation(
    trpc.staff.setPrograms.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            result.programs === 0
              ? `${result.personName} is on no program.`
              : `${result.personName} instructs ${result.programs} ` +
                  `${result.programs === 1 ? "program" : "programs"}.`,
          );

          /*
            Ownership moving is a second message rather than a clause on the first, because it is a
            different fact and not one anybody would guess: an owner who is removed hands the
            program to the longest-serving instructor left.
          */
          for (const moved of result.inherited) {
            toast.warning(`${moved.newOwner} owns ${moved.program} now.`, { duration: 12_000 });
          }

          onOpenChange(false);
        },
      }),
    ),
  );

  /*
    Archived programs last, and labelled. They belong in the list — correcting the record of
    who ran a year that is over is exactly what this control is for, and the procedure allows it
    where the instructor link does not — but they are not what somebody is usually here to change.
  */
  const ordered = [
    ...programs.filter((program) => program.archivedAt == null),
    ...programs.filter((program) => program.archivedAt != null),
  ];

  const held = new Set(person.programIds);
  const changed = draft.size !== held.size || [...draft].some((programId) => !held.has(programId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Which programs does {person.name} instruct?</DialogTitle>
          <DialogDescription>
            An instructor of a program can author in every course of it, read every fellow&apos;s
            work, approve grades, and take attendance. Being on this list is the whole of that —
            which courses their name appears on is decided separately, on the program&apos;s own
            settings screen.
          </DialogDescription>
        </DialogHeader>

        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There are no programs yet. Somebody has to start one before anybody can be put on it.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1">
            {ordered.map((program) => {
              const on = draft.has(program.id);
              return (
                <li key={program.id}>
                  <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <Checkbox
                      checked={on}
                      className="mt-0.5"
                      disabled={setPrograms.isPending}
                      onCheckedChange={(next) =>
                        setDraft((current) => {
                          const copy = new Set(current);
                          if (next === true) copy.add(program.id);
                          else copy.delete(program.id);
                          return copy;
                        })
                      }
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{program.name}</span>
                      <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {program.term}
                        {program.archivedAt != null && (
                          <>
                            <Archive className="size-3" />
                            Archived
                          </>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {/*
          The two refusals worth knowing before pressing Save rather than after. Both are enforced by
          the procedure — this only decides whether somebody meets them by surprise.
        */}
        <p className="text-xs text-muted-foreground">
          Taking somebody off a program also takes their name off its courses. A program cannot be
          left with no instructors, and removing whoever owns one hands it to the longest-serving
          instructor left.
        </p>

        <DialogFooter>
          <Button
            disabled={!changed || setPrograms.isPending}
            onClick={() => setPrograms.mutate({ profileId: person.id, programIds: [...draft] })}
          >
            {setPrograms.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Save
          </Button>
          <DialogClose
            render={
              <Button variant="outline" disabled={setPrograms.isPending}>
                Cancel
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
