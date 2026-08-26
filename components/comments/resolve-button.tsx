"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useTRPC } from "@/trpc/client";

/**
 * Taking a question off the list without answering it.
 *
 * Some questions need no answer — one already handled in person, or one the fellow worked out
 * while waiting. Replying to those would mean writing "no need" into somebody's record.
 *
 * One component for the triage row and the review pane, so the wording and what happens cannot
 * differ between the two places an instructor meets the same question.
 *
 * Through `useServerMutation`, unlike the rest of the conversation: the triage screen is
 * server-rendered, so only `router.refresh()` takes the row off it.
 */
export function ResolveQuestionButton({
  submissionId,
  resolved,
  size = "sm",
}: {
  submissionId: string;
  resolved: boolean;
  size?: "sm" | "icon";
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const resolve = useMutation(
    trpc.submissionComments.resolve.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            result.resolvedAt ? "Marked as resolved." : "Back on your list of questions to answer.",
          );
        },
      }),
    ),
  );

  const label = resolved ? "Reopen" : "Mark resolved";

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      disabled={resolve.isPending}
      aria-label={size === "icon" ? label : undefined}
      onClick={() => resolve.mutate({ submissionId, resolved: !resolved })}
    >
      {resolve.isPending ? (
        <Loader2
          data-icon={size === "icon" ? undefined : "inline-start"}
          className="animate-spin"
        />
      ) : resolved ? (
        <RotateCcw data-icon={size === "icon" ? undefined : "inline-start"} />
      ) : (
        <Check data-icon={size === "icon" ? undefined : "inline-start"} />
      )}
      {size === "icon" ? null : label}
    </Button>
  );
}
