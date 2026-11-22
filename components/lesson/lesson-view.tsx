import { TRPCError } from "@trpc/server";
import { BookOpen, ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LessonMarkdown } from "@/components/lesson/lesson-markdown";
import { LessonTitle } from "@/components/lesson/lesson-title";
import { lessonsBaseFor, type LessonsSide } from "@/components/lesson/lessons-frame";
import { EmptyState } from "@/components/list-states";
import { OutlinedPage } from "@/components/outlined-page";
import { PageHeader } from "@/components/page-header";
import { hasOnlyTitle, lessonHeadings } from "@/lib/lessons/outline";
import { MATCH_START, MAX_SEARCH_LENGTH, snippetParts } from "@/lib/lessons/search";
import { slugFromSegments } from "@/lib/lessons/summary";
import { courseSettingsHref } from "@/lib/links";
import { getQueryClient, trpc } from "@/trpc/server";
import type { RouterOutputs } from "@/trpc/types";

/** What a course's lessons show when its instructors have not chosen a curriculum. */
function NoLessons({
  courseId,
  side,
  chosen,
}: {
  courseId: string;
  side: LessonsSide;
  /** Whether a curriculum is chosen and has simply not been copied from GitHub yet. */
  chosen: boolean;
}) {
  if (chosen) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <EmptyState
          icon={<BookOpen />}
          title="The lessons have not been copied yet"
          description={
            side === "instructor"
              ? "An admin copies the curriculum from GitHub with Sync now on Admin → Lessons, and it is copied every 15 minutes."
              : "Check back soon."
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <EmptyState
        icon={<BookOpen />}
        title="This course has no lessons"
        description={
          side === "instructor"
            ? "Choose the curriculum its fellows read on the course's Settings screen."
            : undefined
        }
        action={
          side === "instructor" ? (
            <Link
              href={courseSettingsHref(courseId)}
              className="text-sm font-medium text-primary underline underline-offset-2"
            >
              Open Settings
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * The sections of the course's lessons that match a search, best first, each linking to the
 * heading its words sit under, with the matched words highlighted in its snippet.
 */
function SearchResults({
  q,
  results,
  more,
  lessonsBase,
}: {
  q: string;
  results: RouterOutputs["lessons"]["search"]["sections"];
  /** Whether more sections matched than are shown. */
  more: boolean;
  lessonsBase: string;
}) {
  let description: string;
  if (results.length === 0) {
    description = `No sections match "${q}".`;
  } else if (more) {
    description = `The ${results.length} best of the sections that match "${q}".`;
  } else if (results.length === 1) {
    description = `1 section matches "${q}".`;
  } else {
    description = `${results.length} sections match "${q}".`;
  }

  return (
    <OutlinedPage
      width="3xl"
      sections={[]}
      header={<PageHeader title="Search results" description={description} />}
    >
      {results.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="Nothing found"
          description="Try other words for the same idea, or the name of the code you are looking for."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((result) => (
            <li key={`${result.slug}#${result.anchor}`}>
              <Link
                href={`${lessonsBase}/${result.slug}${result.anchor ? `#${result.anchor}` : ""}`}
                className="flex flex-col gap-1 rounded-lg border border-border px-4 py-3 hover:bg-muted/40"
              >
                <span className="text-xs text-muted-foreground">
                  <LessonTitle title={result.moduleTitle} /> · <LessonTitle title={result.title} />
                </span>
                <span className="font-medium">
                  {result.heading ? <Marked text={result.headingMarked} /> : result.title}
                </span>
                {result.snippet && (
                  <span className="text-sm text-muted-foreground">
                    <Marked text={result.snippet} />
                  </span>
                )}
                {/*
                  The code around a match, when the match is in code: a `for` found in a loop
                  rather than in a sentence, which the prose snippet cannot show.
                */}
                {result.codeSnippet.includes(MATCH_START) && (
                  <code className="rounded-md bg-muted/60 px-2 py-1 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                    <Marked text={result.codeSnippet} />
                  </code>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </OutlinedPage>
  );
}

/** Text from a search with its matched words highlighted, every part drawn as text. */
function Marked({ text }: { text: string }) {
  return snippetParts(text).map((part, index) =>
    part.match ? (
      <mark key={index} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

/** A refusal of the course itself — unpublished, or somebody else's — as a "not found" page. */
function refusedAsNotFound(err: unknown): never {
  if (err instanceof TRPCError && err.code === "NOT_FOUND") notFound();
  throw err;
}

/**
 * One lesson of a course: the lesson itself with "On this page" beside it, and the previous and
 * next lessons at its foot. The Lessons and Magnify buttons are the layout's; see `LessonsFrame`.
 *
 * **The lessons' bare address shows the curriculum's first lesson**, or the results of a search
 * when it carries `?q=`. The first lesson is shown as GitBook opens on its first
 * page. It is drawn in place rather than redirected to, because a redirect issued from inside the
 * page's loading boundary can leave the reader at the bare address with nothing drawn, and the tree
 * treats the bare address as the first lesson so it is marked there too.
 *
 * **A module page holding only its title** shows a card for each of its chapters beneath the title,
 * as GitBook does, rather than a heading over an empty page.
 */
export async function LessonView({
  params,
  searchParams,
  side,
}: {
  /** No `slug` at the lessons' bare address. */
  params: Promise<{ courseId: string; slug?: string[] }>;
  /** The bare address's query, where `q` asks for search results instead of the first lesson. */
  searchParams?: Promise<{ q?: string | string[] }>;
  side: LessonsSide;
}) {
  const { courseId, slug: segments } = await params;
  const queryClient = getQueryClient();
  const lessonsBase = lessonsBaseFor(side, courseId);

  const asked = (await searchParams)?.q;
  const q = (Array.isArray(asked) ? asked[0] : asked)?.trim().slice(0, MAX_SEARCH_LENGTH) ?? "";
  const treeRead = queryClient
    .fetchQuery(trpc.lessons.tree.queryOptions({ courseId }))
    .catch(refusedAsNotFound);

  if (!segments && q !== "") {
    // A course with no curriculum says so, rather than that the words found nothing. The search
    // is read beside the tree rather than after it.
    const [tree, found] = await Promise.all([
      treeRead,
      queryClient
        .fetchQuery(trpc.lessons.search.queryOptions({ courseId, q }))
        .catch(refusedAsNotFound),
    ]);
    if (!tree) return <NoLessons courseId={courseId} side={side} chosen={false} />;
    return (
      <SearchResults q={q} results={found.sections} more={found.more} lessonsBase={lessonsBase} />
    );
  }

  let slug: string;
  if (segments) {
    slug = slugFromSegments(segments);
  } else {
    const tree = await treeRead;
    const first = tree?.lessons[0];
    if (!first) return <NoLessons courseId={courseId} side={side} chosen={tree !== null} />;
    slug = first.slug;
  }

  const [lesson, tree] = await Promise.all([
    queryClient
      .fetchQuery(trpc.lessons.get.queryOptions({ courseId, slug }))
      .catch(refusedAsNotFound),
    treeRead,
  ]);
  const lessons = tree?.lessons ?? [];

  const slugsByPath = Object.fromEntries(lessons.map((entry) => [entry.path, entry.slug]));
  const index = lessons.findIndex((entry) => entry.slug === lesson.slug);
  const previous = index > 0 ? lessons[index - 1] : null;
  const next = index !== -1 && index < lessons.length - 1 ? lessons[index + 1] : null;

  const chapters =
    lesson.slug === lesson.moduleSlug && hasOnlyTitle(lesson.body)
      ? lessons.filter((entry) => entry.moduleSlug === lesson.slug && entry.slug !== lesson.slug)
      : [];

  // Two levels: the `##` headings, and the `###` headings under each.
  const sections = lessonHeadings(lesson.body)
    .filter((heading) => heading.level === 2 || heading.level === 3)
    .map((heading) => ({
      id: heading.anchor,
      label: heading.text,
      level: heading.level === 2 ? (1 as const) : (2 as const),
    }));

  return (
    <OutlinedPage
      width="3xl"
      sections={sections}
      header={
        lesson.removedAt && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This lesson is no longer in the curriculum. It is shown as it was when it was removed.
          </p>
        )
      }
    >
      <article>
        <LessonMarkdown
          body={lesson.body}
          links={{
            lessonPath: lesson.path,
            repo: lesson.repo,
            commitSha: lesson.commitSha,
            lessonsBase,
            slugsByPath,
          }}
        />
      </article>

      {chapters.length > 0 && (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {chapters.map((chapter) => (
            <li key={chapter.slug}>
              <Link
                href={`${lessonsBase}/${chapter.slug}`}
                className="flex h-full items-center justify-between gap-3 rounded-lg border border-border px-4 py-4 hover:bg-muted/40"
              >
                <span>
                  <LessonTitle title={chapter.title} />
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(previous || next) && (
        <nav
          aria-label="Other lessons"
          className="mt-12 grid grid-cols-2 gap-3 border-t border-border pt-6 text-sm"
        >
          {previous ? (
            <Link
              href={`${lessonsBase}/${previous.slug}`}
              className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 hover:bg-muted/40"
            >
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ChevronLeft aria-hidden className="size-3" /> Previous
              </span>
              <span className="font-medium">
                <LessonTitle title={previous.title} />
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`${lessonsBase}/${next.slug}`}
              className="flex flex-col items-end gap-1 rounded-md border border-border px-3 py-2 text-right hover:bg-muted/40"
            >
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                Next <ChevronRight aria-hidden className="size-3" />
              </span>
              <span className="font-medium">
                <LessonTitle title={next.title} />
              </span>
            </Link>
          )}
        </nav>
      )}
    </OutlinedPage>
  );
}
