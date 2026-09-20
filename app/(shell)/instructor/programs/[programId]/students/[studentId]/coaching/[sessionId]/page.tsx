import Link from "next/link";
import { Suspense } from "react";

import { CoachingSessionForm } from "@/components/instructor/coaching-session-form";
import { PageFallback } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { programStudentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatDate } from "@/lib/status";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * One coaching session with one fellow.
 *
 * Its own route rather than a dialog on the record, because a coaching conversation is half an
 * hour of writing and the form carries the strip of figures both people are looking at — a
 * surface, not a popup. It lives under the fellow's record because that is what it is about, and
 * like the record it deliberately lights no sidebar item.
 *
 * `cacheComponents` is enabled, so `params` is passed down rather than awaited here.
 */
export default function CoachingSessionPage({
  params,
}: {
  params: Promise<{ programId: string; studentId: string; sessionId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback rows={8} width="4xl" />}>
      <Session params={params} />
    </Suspense>
  );
}

async function Session({
  params,
}: {
  params: Promise<{ programId: string; studentId: string; sessionId: string }>;
}) {
  const { programId, studentId, sessionId } = await params;
  const data = await getQueryClient().fetchQuery(
    trpc.coaching.session.queryOptions({ programId, sessionId }),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={`Coaching · ${displayNameOf(data.student, "Fellow")}`}
        description={
          data.endedAt === null
            ? `In progress · started ${formatDate(data.createdAt)}`
            : `Completed ${formatDate(data.endedAt)}`
        }
        eyebrow="Coaching session"
      />
      <Link
        href={programStudentHref(programId, studentId)}
        className="-mt-4 text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        ← Back to their record
      </Link>
      <CoachingSessionForm programId={programId} data={data} />
    </div>
  );
}
