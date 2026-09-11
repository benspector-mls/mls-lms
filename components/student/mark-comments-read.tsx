"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useTRPC } from "@/trpc/client";

/**
 * Clearing one conversation off the dashboard without opening it.
 *
 * **A button here where the thread itself uses an effect**, and the difference is what pressing it
 * does. Inside the panel, arriving at the conversation *is* reading it and the write only clears a
 * number; on this screen the same write takes a row off a list, and a list that emptied itself
 * because a student scrolled past it would be a screen that decides what they have seen.
 *
 * A client island under a server component, in the manner of `AttendanceStrip`: the dashboard's rows
 * are links and cost no JavaScript, and this is the one thing on them that does.
 *
 * `markRead` rather than a mutation of its own. It names the message being read as far as — carried
 * here as `upTo` from the same payload that drew the row — so anything the instructor writes between
 * the screen rendering and this being pressed is genuinely later and stays unread.
 */
export function MarkCommentsRead({
  threadId,
  upTo,
  title,
}: {
  /** The row the conversation hangs off, already resolved through a team's mirror by `listMine`. */
  threadId: string;
  /** The newest message on it when this screen was drawn. */
  upTo: string;
  /** Named in the label, because a list of these buttons is otherwise five identical controls. */
  title: string;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const mark = useMutation(trpc.submissionComments.markRead.mutationOptions(settled()));

  return (
    <Button
      size="sm"
      variant="ghost"
      className="shrink-0 text-muted-foreground"
      disabled={mark.isPending}
      onClick={() => mark.mutate({ submissionId: threadId, upTo })}
    >
      <CheckCheck data-icon="inline-start" />
      {mark.isPending ? "Marking…" : "Mark as read"}
      <span className="sr-only"> the comments on {title}</span>
    </Button>
  );
}
