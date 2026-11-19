"use client";

import { ChevronRight, ListTree, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { LessonTitle } from "@/components/lesson/lesson-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isPlainClick } from "@/components/outlined-page";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MAX_SEARCH_LENGTH } from "@/lib/lessons/search";
import { slugFromSegments } from "@/lib/lessons/summary";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

type TreeLesson = NonNullable<RouterOutputs["lessons"]["tree"]>["lessons"][number];

type Module = { slug: string; title: string; page: TreeLesson | null; chapters: TreeLesson[] };
type Part = { title: string | null; modules: Module[] };

/**
 * The lessons as `SUMMARY.md` groups them: parts, each holding its modules in order, each module
 * holding its chapters. A module's own page is the link on its row rather than a chapter under it.
 */
export function groupLessons(lessons: TreeLesson[]): Part[] {
  const parts: Part[] = [];

  for (const lesson of lessons) {
    let part = parts.at(-1);
    if (!part || part.title !== lesson.partTitle) {
      part = { title: lesson.partTitle, modules: [] };
      parts.push(part);
    }

    let group = part.modules.at(-1);
    if (!group || group.slug !== lesson.moduleSlug) {
      group = { slug: lesson.moduleSlug, title: lesson.moduleTitle, page: null, chapters: [] };
      part.modules.push(group);
    }

    if (lesson.slug === lesson.moduleSlug) group.page = lesson;
    else group.chapters.push(lesson);
  }

  return parts;
}

/**
 * The slug of the lesson the address names. The lessons' bare address shows the first lesson, so
 * it names that one.
 */
function currentSlug(pathname: string, lessonsBase: string, first: string | null): string | null {
  if (!pathname.startsWith(`${lessonsBase}/`)) return pathname === lessonsBase ? first : null;
  return slugFromSegments(pathname.slice(lessonsBase.length + 1).split("/"));
}

/**
 * Every lesson of the course's curriculum, as GitBook's left-hand navigation draws it: part
 * headings, a row per module that links to the module's page, and a chevron that opens the
 * module's chapters beneath it.
 *
 * **The module being read opens by itself**, on arrival and whenever a link leads into another
 * module, and the modules a reader opened stay open, because the tree is in the course's lessons
 * layout and is not drawn again between lessons.
 */
export function LessonTree({
  lessons,
  lessonsBase,
  onChoose,
}: {
  lessons: TreeLesson[];
  /** Where this course's lessons are addressed on this side of the application. */
  lessonsBase: string;
  /**
   * Given, the panel takes over the moves the tree makes — a lesson chosen — so it can close first
   * and move the page after. Its scroll lock, released as it closes, would
   * otherwise put back the old scroll position on top of the new page.
   */
  onChoose?: (href: string) => void;
}) {
  const pathname = usePathname();
  // Search results are shown at the bare address too, and no lesson is current among them.
  const query = useSearchParams().get("q")?.trim() ?? "";
  const searching = pathname === lessonsBase && query !== "";
  const slug = searching ? null : currentSlug(pathname, lessonsBase, lessons[0]?.slug ?? null);
  const parts = React.useMemo(() => groupLessons(lessons), [lessons]);
  const currentModule = lessons.find((lesson) => lesson.slug === slug)?.moduleSlug ?? null;

  const [open, setOpen] = React.useState<Set<string>>(
    () => new Set(currentModule ? [currentModule] : []),
  );
  React.useEffect(() => {
    if (currentModule) setOpen((previous) => new Set(previous).add(currentModule));
  }, [currentModule]);

  const toggle = (moduleSlug: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(moduleSlug)) next.delete(moduleSlug);
      else next.add(moduleSlug);
      return next;
    });

  return (
    <nav aria-label="Lessons" className="flex flex-col gap-5 text-sm">
      {parts.map((part, partIndex) => (
        <div key={part.title ?? `part-${partIndex}`} className="flex flex-col gap-0.5">
          {part.title && (
            <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-foreground uppercase">
              {part.title}
            </p>
          )}
          {part.modules.map((group) => {
            const expanded = open.has(group.slug);
            const isCurrent = group.slug === slug;
            const hasChapters = group.chapters.length > 0;

            return (
              <div key={group.slug}>
                <div
                  className={cn(
                    "flex items-start rounded-md",
                    isCurrent ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  {group.page ? (
                    <Link
                      href={`${lessonsBase}/${group.page.slug}`}
                      onClick={chosen(onChoose)}
                      aria-current={isCurrent ? "page" : undefined}
                      className={cn(
                        "min-w-0 flex-1 px-2 py-1.5",
                        isCurrent ? "font-medium text-primary" : "text-muted-foreground",
                      )}
                    >
                      <LessonTitle title={group.title} />
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 px-2 py-1.5 text-muted-foreground">
                      <LessonTitle title={group.title} />
                    </span>
                  )}
                  {hasChapters && (
                    <button
                      type="button"
                      onClick={() => toggle(group.slug)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Hide" : "Show"} the chapters of ${group.title}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn("size-4 transition-transform", expanded && "rotate-90")}
                      />
                    </button>
                  )}
                </div>
                {hasChapters && expanded && (
                  <ul className="my-1 ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                    {group.chapters.map((chapter) => {
                      const isChapter = chapter.slug === slug;
                      return (
                        <li key={chapter.slug}>
                          <Link
                            href={`${lessonsBase}/${chapter.slug}`}
                            onClick={chosen(onChoose)}
                            aria-current={isChapter ? "page" : undefined}
                            className={cn(
                              "block rounded-md px-2 py-1.5",
                              isChapter
                                ? "bg-muted font-medium text-primary"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                          >
                            <LessonTitle title={chapter.title} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** A link's click, handed to `onChoose` in place of the link's own navigation when there is one. */
function chosen(onChoose?: (href: string) => void) {
  if (!onChoose) return undefined;
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    // A click meant for a new tab or window is the browser's to keep.
    if (!isPlainClick(event)) return;
    event.preventDefault();
    onChoose(event.currentTarget.getAttribute("href") ?? "");
  };
}

/**
 * The search box in the bar above the lessons. Searching opens the results at the lessons' own
 * address with `?q=`, so a search can be shared or returned to with the back button.
 */
export function LessonSearchBox({ lessonsBase }: { lessonsBase: string }) {
  const router = useRouter();
  const current = useSearchParams().get("q") ?? "";
  const [query, setQuery] = React.useState(current);

  // A search made from the other copy of the tree, or a back button, changes the address.
  React.useEffect(() => setQuery(current), [current]);

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        const words = query.trim();
        if (words === "") return;
        router.push(`${lessonsBase}?q=${encodeURIComponent(words)}`);
      }}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Search lessons"
        placeholder="Search lessons"
        value={query}
        maxLength={MAX_SEARCH_LENGTH}
        onChange={(event) => setQuery(event.target.value)}
        className="pl-8"
      />
    </form>
  );
}

/**
 * The lesson tree on a page too narrow for its column: a **Lessons** button at the left of the bar
 * above the lessons, and the panel it opens from the left — the side the tree sits on when there is
 * room. In the lessons layout, not the page, so the lesson list reaches the browser once rather
 * than with every lesson. The panel's tree is drawn afresh each time it opens, with the current
 * lesson's module open.
 */
export function LessonsButton({
  lessons,
  lessonsBase,
  className,
}: {
  lessons: TreeLesson[];
  lessonsBase: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const pending = React.useRef<string | null>(null);

  return (
    <div className={className}>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => {
          if (isOpen || pending.current === null) return;
          const href = pending.current;
          pending.current = null;
          router.push(href);
        }}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          data-icon="inline-start"
        >
          <ListTree aria-hidden />
          Lessons
        </Button>
        <SheetContent side="left" className="gap-0 p-0">
          <SheetTitle className="px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Lessons
          </SheetTitle>
          <div className="min-h-0 overflow-y-auto px-2 pb-4">
            <LessonTree
              lessons={lessons}
              lessonsBase={lessonsBase}
              onChoose={(href) => {
                pending.current = href;
                setOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
