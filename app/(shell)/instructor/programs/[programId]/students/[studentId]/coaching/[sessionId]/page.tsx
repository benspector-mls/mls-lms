import Link from "next/link";
import { Suspense } from "react";

import { CoachingSessionForm } from "@/components/instructor/coaching-session-form";
import { PageFallback } from "@/components/list-states";
import { OutlinedPage, type OutlineSection } from "@/components/outlined-page";
import { PageHeader } from "@/components/page-header";
import { programStudentHref } from "@/lib/links";
import { displayNameOf } from "@/lib/people";
import { formatSchoolDay } from "@/lib/school-time";
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
 * **An outline beside it, as on the settings screens**, because the form is long and is read in
 * three parts in order — what to look at before the fellow arrives, the check-in, and their goals —
 * and a coach halfway through the conversation needs to get back to the figures without scrolling
 * past everything they have written since.
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

  /* The three parts of `CoachingSessionForm`, in its order. Every part is drawn on every session. */
  const sections: OutlineSection[] = [
    { id: "before", label: "Before the session" },
    { id: "check-in", label: "Fellow check-in" },
    { id: "goals", label: "Goal setting" },
  ];

  return (
    <OutlinedPage
      width="4xl"
      header={
        <div className="flex flex-col gap-2">
          <PageHeader
            title={`Coaching · ${displayNameOf(data.student, "Fellow")}`}
            description={
              data.endedAt === null
                ? `${formatSchoolDay(data.heldOn)} · in progress`
                : `${formatSchoolDay(data.heldOn)} · completed ${formatDate(data.endedAt)}`
            }
            eyebrow="Coaching session"
          />
          <Link
            href={programStudentHref(programId, studentId)}
            className="w-fit text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            ← Back to their record
          </Link>
        </div>
      }
      sections={sections}
    >
      <CoachingSessionForm programId={programId} data={data} />
    </OutlinedPage>
  );
}
