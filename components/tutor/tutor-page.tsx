import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { lessonsBaseFor, type LessonsSide } from "@/components/lesson/lessons-frame";
import { PageHeader } from "@/components/page-header";
import { TutorChat } from "@/components/tutor/tutor-chat";
import { getQueryClient, trpc } from "@/trpc/server";

/**
 * The Tutor's page, reached from the bar above a course's lessons: the course's own conversation,
 * about its lessons as a whole. An assignment's conversation is on the assignment's panel instead.
 *
 * Inside the lessons layout, so the bar and the tree stay where the reader left them. The course
 * is asked for the same way the lessons are, so a course that refuses the reader — unpublished,
 * or not theirs — is a "not found" page here as it is there.
 */
export async function TutorPage({
  params,
  side,
}: {
  params: Promise<{ courseId: string }>;
  side: LessonsSide;
}) {
  const { courseId } = await params;
  await getQueryClient()
    .fetchQuery(trpc.lessons.tree.queryOptions({ courseId }))
    .catch((err: unknown) => {
      if (err instanceof TRPCError && err.code === "NOT_FOUND") notFound();
      throw err;
    });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 [--tutor-sticky-top:var(--outline-chrome)] md:p-6">
      <PageHeader
        title="Tutor"
        description="Ask about anything in this course's lessons. The Tutor answers from the lessons and names the ones to read; it does not write assignment code."
      />
      <TutorChat
        courseId={courseId}
        scope={{}}
        audience={side}
        lessonsBase={lessonsBaseFor(side, courseId)}
      />
    </div>
  );
}
