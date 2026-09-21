"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import * as React from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH } from "@/lib/people";
import { useTRPC } from "@/trpc/client";

/**
 * Correcting what a fellow is called, from the record that names them.
 *
 * **Here because this is where a wrong name is noticed.** The column is filled at signup from a
 * GitHub login or from the local part of an address, so a roster routinely opens with `bspector`
 * and `amina.k` on it, and the fellows who never fix it are the ones who never see the Profile
 * screen. Typos and lower-cased names are the rest of it. All of them are found by whoever is
 * teaching the fellow, reading this page.
 *
 * **A dialog rather than an always-editable heading.** A name is read on this card far more often
 * than it is changed, and a field that looks like a field invites a stray keystroke into somebody
 * else's identity. The pencil is the deliberate act, and the dialog is where the sentence about
 * how far the change reaches can be said before it is made rather than after.
 *
 * A client island inside a server component, which is how the other two writing surfaces on this
 * page work — `InstructorNotes` and `StartCoachingSession`. `useServerMutation` is what puts the
 * new name on the card behind the dialog: this page is server-rendered, so nothing moves without
 * `router.refresh()`, and the picker beside it is a client query that needs invalidating.
 */
export function RenameStudent({
  programId,
  studentId,
  displayName,
}: {
  programId: string;
  studentId: string;
  /**
   * The name as stored, which is **not** the name the card shows.
   *
   * The card falls back to a GitHub login and then to an address, and the field is prefilled from
   * the column instead — so a fellow who has set nothing opens an empty box. Prefilling with the
   * fallback would mean one press of Save promoted an email address into a real name, which is
   * the one outcome this screen exists to undo.
   */
  displayName: string | null;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(displayName ?? "");

  const rename = useMutation(
    trpc.programs.renameStudent.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`They are ${result.displayName} everywhere in this application now.`);
          setOpen(false);
        },
        // Beside the field rather than in a toast: a refusal about what you typed should stay on
        // screen while you fix it.
        onError: shownInPlace,
      }),
    ),
  );

  /*
    Opened from the stored name every time, and with any previous refusal cleared. Without both,
    an instructor who cancelled a half-typed name would find it waiting for them next time, under
    a message about a name they are no longer trying to save.
  */
  const openDialog = () => {
    setValue(displayName ?? "");
    rename.reset();
    setOpen(true);
  };

  const trimmed = value.trim();
  const canSave =
    trimmed.length >= DISPLAY_NAME_MIN_LENGTH &&
    trimmed.length <= DISPLAY_NAME_MAX_LENGTH &&
    !rename.isPending;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={openDialog}
        aria-label="Edit this fellow's name"
      >
        <Pencil aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {/*
            A real form, so the return key saves — the one interaction everybody tries first on a
            box with a single field in it.
          */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) rename.mutate({ programId, studentId, displayName: trimmed });
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit name</DialogTitle>
              <DialogDescription>
                This is the one thing on this page that is not about this program. A fellow has one
                name, so it changes what they are called in every course, every gradebook and on
                their own Profile screen — and it replaces a name they may have chosen themselves.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5 py-4">
              <Label htmlFor="fellow-display-name">Display name</Label>
              <Input
                id="fellow-display-name"
                value={value}
                autoComplete="off"
                /*
                  The ceiling stops the typing rather than refusing the save, the same way the
                  fellow's own Profile field does. A limit discovered by being turned away, after a
                  name has been typed out in full, is a limit that should have been a `maxLength`.
                */
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                disabled={rename.isPending}
                onChange={(event) => setValue(event.target.value)}
              />

              {rename.error ? (
                <p className="text-xs text-destructive">{rename.error.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {/*
                    The count appears as the ceiling is approached rather than sitting there from
                    the first keystroke — information at the moment it is worth having, and quiet
                    the rest of the time.
                  */}
                  {trimmed.length > DISPLAY_NAME_MAX_LENGTH - 10
                    ? `${trimmed.length} of ${DISPLAY_NAME_MAX_LENGTH} characters.`
                    : `Between ${DISPLAY_NAME_MIN_LENGTH} and ${DISPLAY_NAME_MAX_LENGTH} characters.`}
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={rename.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {rename.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
