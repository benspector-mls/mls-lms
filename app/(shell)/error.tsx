"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { ErrorState } from "@/components/list-states";
import { useTRPC } from "@/trpc/client";

/**
 * The last stop for anything that throws inside a signed-in screen.
 *
 * `SessionBoundary` handles an expired session by sending the viewer to sign in and
 * deliberately rethrows everything else, so without this a failed query would reach
 * Next's default error page — no navigation, no way back, and no sign of which
 * application it belonged to. Retrying is offered because most of what lands here is a
 * request that failed once.
 *
 * **While somebody is looking through a student's account, it says so.** An instructor screen
 * reached from inside a view — by pressing Back out of it, most often — is asked for as the student,
 * and refuses. The banner above is still showing, and this names it as the reason rather than
 * reporting a fault, because in production the refusal's own message is redacted before it arrives.
 * Exiting from the banner reloads this screen as the person who signed in.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const trpc = useTRPC();
  const { data: viewingAs } = useQuery(trpc.viewingAs.queryOptions());

  useEffect(() => {
    // The digest is what ties this to the server log entry; in production the message
    // itself is redacted before it reaches the browser.
    console.error("Unhandled error in a signed-in screen:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
      {viewingAs ? (
        <ErrorState
          title="This screen is not available while viewing as a student"
          description={`You are viewing the application as ${viewingAs.student.name}, so this screen is being asked for as them. Press Exit student view above to see it as yourself.`}
        />
      ) : (
        <ErrorState
          title="Something went wrong"
          description={error.message || "This screen failed to load."}
          onRetry={reset}
        />
      )}
    </div>
  );
}
