'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/components/list-states';

/**
 * The last stop for anything that throws inside a signed-in screen.
 *
 * `SessionBoundary` handles an expired session by sending the viewer to sign in and
 * deliberately rethrows everything else, so without this a failed query would reach
 * Next's default error page — no navigation, no way back, and no sign of which
 * application it belonged to. Retrying is offered because most of what lands here is a
 * request that failed once.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what ties this to the server log entry; in production the message
    // itself is redacted before it reaches the browser.
    console.error('Unhandled error in a signed-in screen:', error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
      <ErrorState
        title="Something went wrong"
        description={error.message || 'This screen failed to load.'}
        onRetry={reset}
      />
    </div>
  );
}
