"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button, buttonVariants } from "@/components/ui/button";
import { copyUrlFromTemplate } from "@/lib/assignments/spec";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * Taking what an assignment hands out: a repository generated from a template, or a copy of a
 * Drive document.
 *
 * Labelled for the act rather than for the bookkeeping. Both kinds copy a template, so "Copy the
 * template" is true of both, and how the copy is carried out is the part that differs and the
 * part a student does not need in a label. It said "Accept" before, which named the status this
 * writes and not the thing the student came to do.
 *
 * **A link for a Drive assignment and a button for a repository, which is not a stylistic
 * choice.** A repository does not exist until the mutation has returned, so there is nothing to
 * link to and the control has to be a button. A Drive copy is the opposite: the address is
 * Google's copy prompt, built by substitution from the template's own URL, so it is known before
 * anything is pressed. Making that control a real anchor is what gets the new tab past a pop-up
 * blocker — `window.open` called from this mutation's callback runs outside the click's user
 * gesture, which Safari refuses and Chrome permits only while its transient activation lasts,
 * whereas a click on an `href` is a navigation the student made and is never blocked. The two
 * render identically, so the difference is invisible on the screen and only in the mechanism.
 *
 * **A repository still opens in a new tab, by opening the tab before its address exists.** The
 * click opens an empty tab while it is still inside the user gesture, and the mutation's result
 * points that tab at the repository once GitHub has made it. A browser that blocks even that
 * leaves `window.open` returning null, and the student uses the "Your repository" link the
 * refresh puts in place of this button, which is what the toast tells them to click.
 *
 * The mutation still records the accept, fired from the same click. It is deliberately not
 * waited on: the student is already on their way to Google, and a status this writes afterwards
 * is bookkeeping rather than something they are waiting to see. If it fails they keep the copy
 * and the assignment still reads "Not started", which the copy control being permanent for this
 * kind makes recoverable — pressing it again both copies and records.
 */
export function AcceptAssignmentButton({
  assignmentId,
  kind,
  templateDriveUrl,
  disabled = false,
}: {
  assignmentId: string;
  /** From the enum rather than spelled out, so a kind added later cannot be silently omitted. */
  kind: AssignmentKind;
  /**
   * The Drive file this hands out copies of, for the one kind that has one.
   *
   * Null is a misconfigured Drive assignment rather than an impossible state, since the column is
   * nullable. The control falls back to a button there, and `acceptDriveAssignment` answers the
   * press by refusing with a message naming the missing template — which is a better screen than
   * a link built from nothing.
   */
  templateDriveUrl?: string | null;
  /**
   * Greys the control and refuses the press, whichever branch would have drawn it. The
   * instructor's read-only preview of the student panel is the caller: the Drive branch below is
   * a real anchor, which the disabled fieldset wrapping that preview cannot reach, so the refusal
   * has to be made here.
   */
  disabled?: boolean;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  /*
    The tab a repository will open in, held from the click until the mutation settles. A ref and
    not state, because nothing renders from it. Settled in the hook-level `onSettled` rather than
    in callbacks passed to `mutate`, since React Query skips the latter once the component has
    unmounted, and the refresh after success replaces this button with the repository link.
  */
  const repoTab = React.useRef<Window | null>(null);

  const openRepoTab = () => {
    const tab = window.open("", "_blank");
    if (!tab) return;
    // GitHub's page has no business reaching back into this one through `window.opener`.
    tab.opener = null;
    tab.document.title = "Creating your repository…";
    tab.document.body.textContent = "Creating your repository…";
    repoTab.current = tab;
  };

  const accept = useMutation(
    trpc.assignments.accept.mutationOptions(
      settled({
        onSuccess: () => {
          /*
            Accepting a repository assignment invites the student to their new repository as a
            collaborator, and GitHub expires an invitation nobody has accepted after 7 days. A
            student who never opens it is left with a repository they cannot push to, which
            reads as the accept having failed rather than as an invitation having lapsed.

            Said in a toast rather than printed under the button, because the refresh below
            replaces the copy control with the accepted row — a message rendered here would
            appear for an instant and then leave with the button that held it. A toast is
            outside this component, so it stays up long enough to be read and acted on.
          */
          if (kind === "REPO") {
            toast.warning(
              'Click "Your repository" to accept the GitHub invitation to your new repository. ' +
                "GitHub will also email you the invitation. You have 7 days to accept it before " +
                "it expires — after that, your instructor has to invite you again.",
              { duration: 15_000 },
            );
          }

          // `useServerMutation` re-renders the server component after this, so the row picks up
          // its new status, and a repository assignment picks up the link to the one it made.
        },
        onSettled: (result) => {
          const tab = repoTab.current;
          repoTab.current = null;
          if (!tab) return;
          // A failed accept, or a row with no address, closes the tab rather than leaving it blank.
          const repoUrl = result?.submission.repoUrl;
          if (repoUrl) tab.location.href = repoUrl;
          else tab.close();
        },
      }),
    ),
  );

  const copyUrl =
    kind === "GOOGLE_DRIVE" && templateDriveUrl ? copyUrlFromTemplate(templateDriveUrl) : null;

  return (
    <>
      {copyUrl && !disabled ? (
        /*
          `data-slot` and `buttonVariants` rather than a copied class list, so this is the same
          button as the branch below down to the focus ring: the size variants are keyed on that
          attribute, and a hand-written approximation would drift the first time either changes.
        */
        <a
          href={copyUrl}
          target="_blank"
          rel="noreferrer"
          data-slot="button"
          className={cn(buttonVariants({ size: "sm" }))}
          onClick={() => accept.mutate({ assignmentId })}
        >
          Copy the template
        </a>
      ) : (
        <Button
          size="sm"
          onClick={() => {
            if (kind === "REPO") openRepoTab();
            accept.mutate({ assignmentId });
          }}
          disabled={disabled || accept.isPending}
        >
          {accept.isPending
            ? kind === "REPO"
              ? "Creating repository…"
              : "Copying…"
            : "Copy the template"}
        </Button>
      )}

      {/*
        Full width so the message wraps under the row rather than stretching it. Failures
        here are things the student can act on — an unlinked GitHub account, most often —
        so the text has to be readable, not truncated into a row.
      */}
      {accept.error && (
        <p className="w-full text-sm text-destructive" role="alert">
          {accept.error.message}
        </p>
      )}
    </>
  );
}
