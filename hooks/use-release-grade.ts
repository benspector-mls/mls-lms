"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useTRPC, useTRPCClient } from "@/trpc/client";

/**
 * Releasing a grade without making the instructor wait on it.
 *
 * Approval is slow for reasons the instructor cannot help with — it saves the last edits, writes
 * the grade, and then posts a comment to GitHub, whose latency is the largest and least
 * predictable part. So the click hands the work to this hook and the screen moves on to the next
 * student immediately; success and failure arrive as toasts.
 *
 * **Owned above the review pane, deliberately.** The pane is keyed on the submission and unmounts
 * the moment the queue advances, so a mutation living inside it would lose its handlers mid-
 * flight. This hook lives in the screen that owns the queue and calls the procedure through the
 * raw client, the way `useBatchGenerate` does, so the request and its toasts outlive the pane.
 *
 * **And deliberately not through `useServerMutation`.** Its unfiltered `invalidateQueries()` plus
 * `router.refresh()` would re-fetch everything the pane holds — including the GitHub-backed diff —
 * for a submission that is no longer even on screen. This settles with one scoped invalidation of
 * the released submission's own draft query, so a later revisit reads fresh, and one
 * `router.refresh()` so the server-rendered queue list moves the row to Graded.
 */

export type ReleaseArgs = {
  submissionId: string;
  /** Who the toasts should say received it: the team's name, or the student's. */
  label: string;
  /**
   * Saves whatever the editor still holds and answers with the id of the draft to approve.
   * Rejecting aborts the release: approval reads the stored draft rather than anything the
   * browser sends, so releasing over an unflushed edit would release something other than what
   * was on the screen.
   */
  flush: () => Promise<string>;
};

export function useReleaseGrade({
  reopen,
}: {
  /** Reopens a submission, for the failure toasts' "Open" action. */
  reopen?: (submissionId: string) => void;
} = {}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  /** In flight right now, so the queue's rows can say so and the button does not offer a second release. */
  const [inFlight, setInFlight] = React.useState<ReadonlySet<string>>(new Set());

  // A ref rather than a dependency, so a caller passing a fresh closure each render does not
  // remake `release` and everything holding it.
  const reopenRef = React.useRef(reopen);
  reopenRef.current = reopen;

  const release = React.useCallback(
    async ({ submissionId, label, flush }: ReleaseArgs) => {
      setInFlight((previous) => new Set(previous).add(submissionId));

      const openAction = reopenRef.current
        ? { label: "Open", onClick: () => reopenRef.current?.(submissionId) }
        : undefined;

      try {
        let draftId: string;
        try {
          draftId = await flush();
        } catch (error) {
          // Nothing was released. The queue has already moved on, so the news has to carry a way
          // back to the submission it is about.
          toast.error(
            `Nothing was released to ${label} — the last edits could not be saved. ${
              error instanceof Error ? error.message : ""
            }`.trim(),
            { action: openAction, duration: 10000 },
          );
          return;
        }

        try {
          const result = await client.gradingDrafts.approve.mutate({ draftId });

          // Named outcomes, because "the comment did not post" is a warning on a repository
          // assignment and a falsehood on one that never had a pull request.
          if (result.delivery === "failed") {
            toast.warning(
              `Grade recorded for ${label}, but the comment did not post: ${result.commentError}`,
              {
                duration: 10000,
                action: {
                  label: "Post the comment",
                  onClick: () => {
                    void client.gradingDrafts.retryComment
                      .mutate({ submissionId })
                      .then(() => toast.success("Comment posted to the pull request."))
                      .catch((error: unknown) =>
                        toast.error(error instanceof Error ? error.message : String(error)),
                      );
                  },
                },
              },
            );
          } else {
            toast.success(
              result.team
                ? `Released ${result.finalScore}/${result.finalScorePossible} to ${result.team.name} — ${result.team.memberCount} ${result.team.memberCount === 1 ? "fellow" : "fellows"}.`
                : `Released ${result.finalScore}/${result.finalScorePossible} to ${label}.`,
            );
          }
        } catch (error) {
          toast.error(
            `${label} was not released: ${error instanceof Error ? error.message : String(error)}`,
            { action: openAction, duration: 10000 },
          );
        }
      } finally {
        setInFlight((previous) => {
          const next = new Set(previous);
          next.delete(submissionId);
          return next;
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.gradingDrafts.listForSubmission.queryKey({ submissionId }),
        });
        router.refresh();
      }
    },
    [client, queryClient, router, trpc],
  );

  return { inFlight, release };
}

export type ReleaseGrade = ReturnType<typeof useReleaseGrade>["release"];
