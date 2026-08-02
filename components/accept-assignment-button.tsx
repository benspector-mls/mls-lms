'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';

/**
 * Accepting an assignment creates a GitHub repository, so it is a mutation the student
 * triggers rather than something that happens while a page renders. That is what makes
 * this a client component.
 *
 * Labelled "Accept" rather than "Accept on GitHub", because accepting is the step and
 * GitHub is only how it is carried out today — a template document copied for the
 * student would be the same action.
 */
export function AcceptAssignmentButton({ assignmentId }: { assignmentId: string }) {
  const trpc = useTRPC();
  const router = useRouter();

  const accept = useMutation(
    trpc.assignments.accept.mutationOptions({
      // Re-renders the server component, so the row picks up its new status and
      // repository link.
      onSuccess: () => router.refresh(),
    }),
  );

  return (
    <>
      <Button
        size="sm"
        onClick={() => accept.mutate({ assignmentId })}
        disabled={accept.isPending}
      >
        {accept.isPending ? 'Creating repository…' : 'Accept'}
      </Button>

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
