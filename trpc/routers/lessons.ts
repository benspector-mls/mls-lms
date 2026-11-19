import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertCourseMember } from "@/lib/courses/membership";
import {
  CODE_OPTIONS,
  HEADING_OPTIONS,
  HEADLINE_OPTIONS,
  keywordsIn,
  MAX_SEARCH_LENGTH,
  SEARCH_CONFIG,
  SEARCH_LIMIT,
} from "@/lib/lessons/search";
import type { Tx } from "@/lib/prisma";
import { createTRPCRouter, profileProcedure } from "../init";

/**
 * A course's lessons: the curriculum its instructors chose, as the sync last copied it.
 *
 * **Read through the course, by anybody who belongs to it.** `assertCourseMember` admits the
 * course's fellows once it is published, its program's instructors, and admins — the same people
 * who can open the course's coursework. A curriculum is public on GitHub, so nothing here is
 * secret; going through the course is what keeps a data analytics course's fellows on their own
 * curriculum and gives later phases a course to attach records to.
 */
export const lessonsRouter = createTRPCRouter({
  /**
   * The course's curriculum and every listed lesson in `SUMMARY.md` order, without bodies: what
   * the lesson tree and the previous and next links read. Null when the course has no curriculum.
   */
  tree: profileProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCourseMember(ctx, input.courseId);
      const curriculum = await curriculumOf(ctx.db, input.courseId);
      if (!curriculum) return null;

      const lessons = await ctx.db.lesson.findMany({
        where: { curriculumId: curriculum.id, removedAt: null },
        orderBy: { position: "asc" },
        select: {
          id: true,
          slug: true,
          path: true,
          title: true,
          partTitle: true,
          moduleSlug: true,
          moduleTitle: true,
        },
      });

      return { curriculum, lessons };
    }),

  /**
   * One lesson of the course's curriculum, with its markdown and what the page needs to turn its
   * paths into addresses.
   *
   * A removed lesson is still returned, so a link somebody saved keeps working; the page says the
   * lesson is no longer in the curriculum. A slug from another curriculum is NOT_FOUND, as though
   * it did not exist, because in this course it does not.
   */
  get: profileProcedure
    .input(z.object({ courseId: z.string().uuid(), slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertCourseMember(ctx, input.courseId);
      const curriculum = await curriculumOf(ctx.db, input.courseId);

      const lesson = curriculum
        ? await ctx.db.lesson.findUnique({
            where: { curriculumId_slug: { curriculumId: curriculum.id, slug: input.slug } },
            select: {
              id: true,
              slug: true,
              path: true,
              title: true,
              moduleSlug: true,
              moduleTitle: true,
              body: true,
              commitSha: true,
              removedAt: true,
            },
          })
        : null;
      if (!curriculum || !lesson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "There is no such lesson." });
      }

      // The page builds image and GitHub addresses from the repository's name.
      return { ...lesson, repo: curriculum.repo };
    }),

  /**
   * The sections of the course's curriculum that match the query, best first, each with a snippet
   * around the matched words.
   *
   * **Every word as a word.** `plainto_tsquery` gives no word a meaning of its own. The richer
   * `websearch_to_tsquery` reads `or` between two words as "either" and a leading `-` as "leave
   * out", so `and or not` — Python's operators — would lose `or`, and `list -1` would leave out
   * every section mentioning 1.
   *
   * **The query is read as the stored terms were.** Its words go through English rules, which stem
   * `loops` to `loop` and drop common words, and those words decide which sections match,
   * wherever they appear. The code words among them that English drops — `for`, `if`, `where`,
   * `this`, listed in `KEYWORDS_ENGLISH_DROPS` — rank a section higher, and are marked in its code
   * excerpt, when its code holds any of them: a question such as "what is a for loop" has to find
   * sections whatever `is` and `for` they hold. A query with no words English keeps — `for`, `and
   * or not`, "what does this do" — requires its listed words, all of them, in a section's code;
   * one with no listed words either — `for_each` aside, a rare case — requires every word in the
   * code. A sentence beginning "for example" and a heading such as "Code Fences for Blocks of
   * Code" never match.
   *
   * **Sections rather than lessons**, so a result can link to the heading its words sit under.
   * `SEARCH_LIMIT` at most, ranked by `ts_rank`, with `more` saying whether there were others. The
   * heading comes back with its matched words marked as well as the snippet, because a section
   * can match through its heading alone. Removed lessons are left out, and a course with no
   * curriculum finds nothing.
   */
  search: profileProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCourseMember(ctx, input.courseId);
      const curriculum = await curriculumOf(ctx.db, input.courseId);
      if (!curriculum) return { sections: [], more: false };

      // Letters only, from `keywordsIn`, so joining them with `&` and `|` is a valid query.
      const keywords = keywordsIn(input.q);

      // One more than is shown, which is how the page knows whether there were others.
      const rows = await ctx.db.$queryRaw<
        {
          slug: string;
          title: string;
          moduleTitle: string;
          heading: string;
          headingMarked: string;
          anchor: string;
          snippet: string;
          codeSnippet: string;
        }[]
      >`
        select l.slug, l.title, l.module_title as "moduleTitle", s.heading, s.anchor,
               ts_headline('english', s.heading, q.either, ${HEADING_OPTIONS}) as "headingMarked",
               ts_headline('english', s.text, q.either, ${HEADLINE_OPTIONS}) as snippet,
               ts_headline(${SEARCH_CONFIG}::regconfig, s.code, q.either, ${CODE_OPTIONS}) as "codeSnippet"
        from lesson_sections s
        join lessons l on l.id = s.lesson_id
        cross join (
          select decide, decide || keywords as either
          from (
            select case
                     when numnode(plainto_tsquery('english', ${input.q})) > 0
                       then plainto_tsquery('english', ${input.q})
                     when ${keywords.length} > 0
                       then to_tsquery(${SEARCH_CONFIG}::regconfig, ${keywords.join(" & ")})
                     else plainto_tsquery(${SEARCH_CONFIG}::regconfig, ${input.q})
                   end as decide,
                   to_tsquery(${SEARCH_CONFIG}::regconfig, ${keywords.join(" | ")}) as keywords
          ) halves
        ) q
        where l.curriculum_id = ${curriculum.id}::uuid
          and l.removed_at is null
          and s.search @@ q.decide
        order by ts_rank(s.search, q.either) desc, l.position, s.position
        limit ${SEARCH_LIMIT + 1}`;

      return { sections: rows.slice(0, SEARCH_LIMIT), more: rows.length > SEARCH_LIMIT };
    }),
});

/** The curriculum a course shows, or null when it shows none. */
async function curriculumOf(db: Tx, courseId: string) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { curriculum: { select: { id: true, name: true, repo: true } } },
  });
  return course?.curriculum ?? null;
}
