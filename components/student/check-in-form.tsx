"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * The four digits and the button, wherever check-in is offered.
 *
 * **Two screens ask for this code**: the strip at the top of the dashboard, and the card on the
 * course's own attendance screen. One component rather than two, because the details below are the
 * kind that get fixed on one screen and left wrong on the other.
 *
 * **No autofocus.** On a phone it throws the keyboard up and scrolls the page out from under
 * somebody who came to read their overdue list.
 *
 * **A wrong code is answered inline, never in a toast.** A toast about what you just typed
 * disappears while you are still typing the next attempt.
 *
 * **Both attendance reads are invalidated on success**, not whichever one the caller happens to be
 * built on. The strip and the card can be on screen at once — the dashboard and a course page in
 * two tabs — and a check-in that flipped one and left the other is the state this cannot be in.
 */
export function CheckInForm({
  courseId,
  courseName,
  compact,
}: {
  courseId: string;
  courseName: string;
  /** Narrower, for a row of a strip rather than a card of its own. */
  compact?: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [code, setCode] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);

  const checkIn = useMutation(
    trpc.attendance.checkIn.mutationOptions({
      onSuccess: () => {
        setCode("");
        setProblem(null);
        /*
          `useServerMutation` is the wrong tool here — no server component's data has changed, and
          the page around this does not need re-rendering. Invalidating the two reads is what flips
          the square and the card.
        */
        void queryClient.invalidateQueries({ queryKey: trpc.attendance.today.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.attendance.myWeek.queryKey() });
      },
      onError: (error) => setProblem(error.message),
    }),
  );

  return (
    <div className="flex flex-col gap-1">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          checkIn.mutate({ courseId, code });
        }}
      >
        <Input
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, "").slice(0, 4));
            setProblem(null);
          }}
          // Numeric on a phone, and no autofocus — see the note at the top of this file.
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Check-in code for ${courseName}`}
          placeholder="0000"
          className={cn(
            "text-center font-mono tabular-nums",
            compact ? "h-8 w-20 tracking-[0.2em]" : "w-28 text-lg tracking-[0.3em]",
          )}
        />
        <Button
          type="submit"
          size={compact ? "sm" : "default"}
          disabled={code.length !== 4 || checkIn.isPending}
        >
          Check in
        </Button>
      </form>

      {problem && <p className="text-xs text-destructive-foreground">{problem}</p>}
    </div>
  );
}
