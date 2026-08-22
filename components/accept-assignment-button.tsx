"use client";

import { useMutation } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";
import { useTRPC } from "@/trpc/client";

/**
 * Accepting an assignment creates something, so it is a mutation the student triggers
 * rather than something that happens while a page renders. That is what makes this a
 * client component.
 *
 * Labelled "Accept" rather than "Accept on GitHub", because accepting is the step and how
 * it is carried out depends on the kind: a repository is generated from a template, and a
 * Google Drive assignment sends the student to Google's own prompt to take a copy. The
 * procedure returns `copyUrl` when there is somewhere to be sent, so this component does
 * not have to know which kind it is looking at.
 */
export function AcceptAssignmentButton({
  assignmentId,
  kind,
}: {
  assignmentId: string;
  /** From the enum rather than spelled out, so a kind added later cannot be silently omitted. */
  kind: AssignmentKind;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  /*
    Held so the link can be offered when the tab could not be opened. A pop-up blocker
    refusing `window.open` is ordinary and not an error: the copy prompt is where the
    student needs to go, so the fallback has to be a link they can click themselves rather
    than a message telling them it failed.
  */
  const [copyUrl, setCopyUrl] = React.useState<string | null>(null);

  const accept = useMutation(
    trpc.assignments.accept.mutationOptions(
      settled({
        onSuccess: (result) => {
          if (result.copyUrl) {
            setCopyUrl(result.copyUrl);
            const opened = window.open(result.copyUrl, "_blank", "noopener,noreferrer");
            if (opened) opened.focus();
          }

          /*
            Accepting a repository assignment invites the student to their new repository as a
            collaborator, and GitHub expires an invitation nobody has accepted after 7 days. A
            student who never opens it is left with a repository they cannot push to, which
            reads as the accept having failed rather than as an invitation having lapsed.

            Said in a toast rather than printed under the button, because the refresh below
            replaces the Accept control with the accepted row — a message rendered here would
            appear for an instant and then leave with the button that held it. A toast is
            outside this component, so it stays up long enough to be read and acted on.
          */
          if (kind === "REPO") {
            toast.warning(
              "GitHub has emailed you an invitation to your new repository. You have 7 days to " +
                "accept it before the invitation expires — after that, your instructor has to " +
                "invite you again. You can also accept it by opening the repository on GitHub.",
              { duration: 15_000 },
            );
          }

          // `useServerMutation` re-renders the server component after this, so the row picks
          // up its new status and its repository or document link.
        },
      }),
    ),
  );

  return (
    <>
      <Button size="sm" onClick={() => accept.mutate({ assignmentId })} disabled={accept.isPending}>
        {accept.isPending
          ? kind === "GOOGLE_DRIVE"
            ? "Opening Google Drive…"
            : "Creating repository…"
          : "Accept"}
      </Button>

      {copyUrl && (
        <a
          href={copyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Open your copy of the document
          <ExternalLink className="size-3.5" />
        </a>
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
