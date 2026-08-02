'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';

/**
 * Accepting an assignment creates a GitHub repository, so it is a mutation
 * triggered by the student rather than something that happens while a page
 * renders. That is why this is a client component: it needs an onClick handler.
 */
export function AcceptAssignmentButton({ assignmentId }: { assignmentId: string }) {
  const trpc = useTRPC();
  const router = useRouter();

  const accept = useMutation(
    trpc.assignments.accept.mutationOptions({
      onSuccess: () => {
        // Re-render the server component so the new repository link appears.
        router.refresh();
      },
    }),
  );

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() => accept.mutate({ assignmentId })}
        disabled={accept.isPending}
        size="sm"
      >
        {accept.isPending ? 'Creating repository…' : 'Accept assignment'}
      </Button>

      {accept.error && (
        <p className="text-sm text-red-500" role="alert">
          {accept.error.message}
        </p>
      )}
    </div>
  );
}
