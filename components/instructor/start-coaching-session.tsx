"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { coachingSessionHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";

/**
 * The one interactive thing on the record page's coaching section: make a draft, go to its form.
 * A draft is staff-only scratch until completing it, so there is nothing to confirm here.
 */
export function StartCoachingSession({
  programId,
  studentId,
}: {
  programId: string;
  studentId: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const settled = useServerMutation();

  const start = useMutation(
    trpc.coaching.startSession.mutationOptions(
      settled({
        onSuccess: (session) => {
          router.push(coachingSessionHref(programId, studentId, session.id));
        },
      }),
    ),
  );

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      disabled={start.isPending}
      onClick={() => start.mutate({ programId, studentId })}
      data-icon="inline-start"
    >
      {start.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
      Start coaching session
    </Button>
  );
}
