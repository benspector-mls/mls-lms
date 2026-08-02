import { Suspense } from 'react';

import { ListSkeleton } from '@/components/list-states';
import { TriageOverview } from '@/components/instructor/triage-overview';
import { getQueryClient, trpc } from '@/trpc/server';

/**
 * The instructor's landing screen.
 *
 * `cacheComponents` is enabled, so the read happens in an async child behind Suspense
 * rather than in the page itself.
 */
export default function InstructorPage() {
  return (
    <Suspense fallback={<TriageFallback />}>
      <Triage />
    </Suspense>
  );
}

function TriageFallback() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <ListSkeleton rows={6} />
    </div>
  );
}

async function Triage() {
  const queryClient = getQueryClient();

  const [profile, triage] = await Promise.all([
    queryClient.fetchQuery(trpc.me.queryOptions()),
    queryClient.fetchQuery(trpc.submissions.triage.queryOptions({})),
  ]);

  /*
    Read once, here, and passed down. Every "3 hr ago" on the screen is then measured
    from the same instant, and reading the clock inside a component cannot make two of
    them disagree. Safe in this position because the render is already dynamic — the
    awaits above see to that — where a cached one would refuse.
  */
  return (
    <TriageOverview
      triage={triage}
      instructorName={profile?.displayName ?? null}
      now={new Date()}
    />
  );
}
