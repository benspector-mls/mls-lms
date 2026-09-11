"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";

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
 * **A tick and no words**, which is `ResolveQuestionButton` on the triage row and for the same
 * reason: the rows are read on a phone, and a labelled button there takes the width the message
 * itself needs. The label is still said, to a screen reader, and it names the assignment — a column
 * of identical ticks is otherwise five controls that all announce the same thing.
 *
 * `markRead` rather than a mutation of its own. It names the message being read as far as — carried
 * here as `upTo` from the same payload that drew the row — so anything written between the screen
 * rendering and this being pressed is genuinely later and stays unread.
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
  /** The assignment this conversation is about, for the label nobody sees. */
  title: string;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const mark = useMutation(trpc.submissionComments.markRead.mutationOptions(settled()));

  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="shrink-0"
      disabled={mark.isPending}
      aria-label={`Mark the comments on ${title} as read`}
      onClick={() => mark.mutate({ submissionId: threadId, upTo })}
    >
      {mark.isPending ? <Loader2 className="animate-spin" /> : <Check />}
    </Button>
  );
}
