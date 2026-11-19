import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { LessonTextSizeMenu } from "@/components/lesson/lesson-text-size";
import { LessonsButton, LessonSearchBox, LessonTree } from "@/components/lesson/lesson-tree";
import { buttonVariants } from "@/components/ui/button";
import { courseLessonsHref, instructorLessonsHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import { getQueryClient, trpc } from "@/trpc/server";

/** Which side of the application a course's lessons are read from, which decides their address. */
export type LessonsSide = "fellow" | "instructor";

export function lessonsBaseFor(side: LessonsSide, courseId: string): string {
  return side === "fellow" ? courseLessonsHref(courseId) : instructorLessonsHref(courseId);
}

/**
 * A course's lessons layout: the lesson tree in a column on the left, and the lesson beside it.
 *
 * **A layout rather than part of each page**, so the tree is not drawn again when a reader moves
 * from one lesson to the next, and the modules they opened stay open.
 *
 * **The tree's column appears when the lessons' column is at least 72rem wide**, which leaves room
 * for the tree and a lesson beside it. On a narrower page the Lessons button in the bar above the
 * lessons opens the same tree from the left. The container is named `lessons` so that
 * button's width rule measures this column rather than the lesson's own outlined container.
 *
 * Shared by the fellow's and the instructor's routes, which differ only in the address the lessons
 * live at.
 */
export function LessonsFrame({
  params,
  side,
  children,
}: {
  params: Promise<{ courseId: string }>;
  side: LessonsSide;
  children: React.ReactNode;
}) {
  return (
    /*
      `--outline-chrome` grows by the bar's 3.5rem here, so the lessons' stuck headings, jumps and
      the floating On this page button all sit below the bar rather than beneath it.
    */
    <div className="@container/lessons w-full [--outline-chrome:calc(7rem_+_var(--view-as-banner,0px))]">
      <div className="sticky top-[calc(3.5rem_+_var(--view-as-banner,0px))] z-30 grid h-14 grid-cols-[1fr_minmax(0,28rem)_1fr] items-center gap-3 border-b border-border bg-background px-4 md:px-6">
        <Suspense fallback={null}>
          <BarContents params={params} side={side} />
        </Suspense>
      </div>
      <div className="flex">
        <Suspense fallback={null}>
          <TreeColumn params={params} side={side} />
        </Suspense>
        {/* At least a screen tall, so the Magnify row below rests at the bottom of a short page. */}
        <div className="flex min-h-[calc(100svh_-_var(--outline-chrome))] min-w-0 flex-1 flex-col">
          {children}
          {/*
            Room under the lesson for the Magnify button, which is drawn upward from the row below
            and would otherwise cover the end of the lesson — the Next card — at the foot of the
            page, where nothing scrolls out from under it.
          */}
          <div aria-hidden className="mt-auto h-14 shrink-0" />
          {/* Magnify, floating at the bottom right at every width; see `LessonTextSizeMenu`. */}
          <div className="pointer-events-none sticky bottom-4 z-20 h-0">
            <div className="pointer-events-auto absolute right-4 bottom-0 md:right-6">
              {/* The menu reads the path to stay off the Tutor's page, which a prerender needs a boundary for. */}
              <Suspense fallback={null}>
                <LessonTextSizeMenu />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The course's lessons for the layout's two readers, the bar and the tree's column, or null when
 * the course refuses the reader — not published yet, or not theirs. The page beside them asks the
 * same question and answers a refusal with a "not found" page, rather than the error screen a
 * layout's failure would show. One request serves both readers, because the query client is
 * shared across the render.
 */
async function lessonsOf(params: Promise<{ courseId: string }>, side: LessonsSide) {
  const { courseId } = await params;
  const tree = await getQueryClient()
    .fetchQuery(trpc.lessons.tree.queryOptions({ courseId }))
    .catch(() => null);
  return tree ? { lessons: tree.lessons, lessonsBase: lessonsBaseFor(side, courseId) } : null;
}

/**
 * The bar above the lessons, as GitBook has one: the Lessons button on the left on a page too
 * narrow for the tree's column, Ask the Tutor in the middle, and the search box on the right at
 * every width, so a search or a question can be started from anywhere in the lessons.
 */
async function BarContents({
  params,
  side,
}: {
  params: Promise<{ courseId: string }>;
  side: LessonsSide;
}) {
  const course = await lessonsOf(params, side);
  if (!course) return null;

  return (
    <>
      <div>
        {course.lessons.length > 0 && (
          <LessonsButton
            lessons={course.lessons}
            lessonsBase={course.lessonsBase}
            className="@min-[72rem]/lessons:hidden"
          />
        )}
      </div>
      <div className="w-full max-w-md justify-self-center">
        <LessonSearchBox lessonsBase={course.lessonsBase} />
      </div>
      <Link
        href={`${course.lessonsBase}/tutor`}
        aria-label="Ask the Tutor"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2 justify-self-end")}
      >
        <GraduationCap aria-hidden />
        <span className="hidden @min-[40rem]/lessons:inline">Ask the Tutor</span>
      </Link>
    </>
  );
}

async function TreeColumn({
  params,
  side,
}: {
  params: Promise<{ courseId: string }>;
  side: LessonsSide;
}) {
  const course = await lessonsOf(params, side);
  if (!course) return null;

  return (
    <aside className="sticky top-(--outline-chrome) hidden max-h-[calc(100svh_-_var(--outline-chrome))] w-64 shrink-0 self-start overflow-y-auto border-r border-border px-3 py-6 @min-[72rem]/lessons:block">
      <LessonTree lessons={course.lessons} lessonsBase={course.lessonsBase} />
    </aside>
  );
}
