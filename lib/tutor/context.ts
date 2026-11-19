import "server-only";

import { redact, type RedactionNames } from "@/lib/coaching/redact";
import { keywordsIn, SEARCH_CONFIG } from "@/lib/lessons/search";
import { getConfiguredInstallationId } from "@/lib/github/app-client";
import { fetchRepoFile } from "@/lib/github/files";
import type { Tx } from "@/lib/prisma";

/**
 * What the Tutor is told about the course, read from the database and from GitHub: the
 * curriculum's outline, the sections that match an assignment question, and an assignment's
 * README. See `lib/tutor/ask.ts` for what is done with it.
 */

/** How many sections an assignment question retrieves: about 5,000 tokens of lesson text. */
export const RETRIEVED_SECTIONS = 8;

/**
 * The most sections Claude is given for one question: the question's own matches, then the
 * sections the previous answer was based on, until this many. See `carrySections`.
 */
export const SECTIONS_WITH_CARRIED = 12;

/**
 * The curriculum's modules and lessons, one title to a line with the lessons indented under their
 * module, so Claude can name the lesson that covers a question. About 600 tokens for 58 lessons.
 */
export async function curriculumOutline(db: Tx, curriculumId: string): Promise<string> {
  const lessons = await db.lesson.findMany({
    where: { curriculumId, removedAt: null },
    orderBy: { position: "asc" },
    select: { slug: true, title: true, moduleSlug: true },
  });
  return lessons
    .map((lesson) =>
      lesson.slug === lesson.moduleSlug ? `- ${lesson.title}` : `  - ${lesson.title}`,
    )
    .join("\n");
}

export type RetrievedSection = {
  slug: string;
  title: string;
  moduleTitle: string;
  heading: string;
  anchor: string;
  text: string;
  code: string;
};

/**
 * The sections of the curriculum that best match a question.
 *
 * **The question is read with English rules, and any of its words is enough.** English rules
 * drop a question's common words — "do", "is", "if", "for" — so they match nothing, and the words
 * that remain, stemmed, match a section's heading, code or prose wherever they appear. Requiring
 * every word, as search does, would make a full sentence match almost nothing. The code words
 * among the dropped ones — `for`, `if`, `where`, listed in `KEYWORDS_ENGLISH_DROPS` — are looked
 * for in a section's code as well, so "what is `for`?" finds the loops. A question with no
 * searchable words retrieves nothing.
 */
export async function retrieveSections(
  db: Tx,
  curriculumId: string,
  question: string,
): Promise<RetrievedSection[]> {
  // Letters only, from `keywordsIn`, so joining them with `|` is a valid query.
  const keywords = keywordsIn(question);
  return db.$queryRaw<RetrievedSection[]>`
    select l.slug, l.title, l.module_title as "moduleTitle", s.heading, s.anchor, s.text, s.code
    from lesson_sections s
    join lessons l on l.id = s.lesson_id
    cross join (
      select case
               when words.q is null then code.q
               when code.q is null then words.q
               else words.q || code.q
             end as any_word
      from (
        select replace(nullif(plainto_tsquery('english', ${question})::text, ''), '&', '|')::tsquery as q
      ) words,
      (
        select case
                 when ${keywords.length} > 0
                   then to_tsquery(${SEARCH_CONFIG}::regconfig, ${keywords.join(" | ")})
               end as q
      ) code
    ) q
    where l.curriculum_id = ${curriculumId}::uuid
      and l.removed_at is null
      and q.any_word is not null
      and s.search @@ q.any_word
    order by ts_rank(s.search, q.any_word) desc, l.position, s.position
    limit ${RETRIEVED_SECTIONS}`;
}

/** How a stored answer names a section it was based on: its lesson's slug and its anchor. */
export type SectionReference = { slug: string; anchor: string };

/**
 * The sections a previous answer was based on, read back by lesson slug and anchor, in the order
 * they were listed. A section since removed with its lesson is left out.
 */
export async function sectionsByReference(
  db: Tx,
  curriculumId: string,
  references: SectionReference[],
): Promise<RetrievedSection[]> {
  if (references.length === 0) return [];
  const rows = await db.lessonSection.findMany({
    where: {
      lesson: { curriculumId, removedAt: null },
      OR: references.map((reference) => ({
        anchor: reference.anchor,
        lesson: { slug: reference.slug },
      })),
    },
    select: {
      heading: true,
      anchor: true,
      text: true,
      code: true,
      lesson: { select: { slug: true, title: true, moduleTitle: true } },
    },
  });
  const byKey = new Map(rows.map((row) => [`${row.lesson.slug}#${row.anchor}`, row]));
  const sections: RetrievedSection[] = [];
  for (const reference of references) {
    const row = byKey.get(`${reference.slug}#${reference.anchor}`);
    if (!row) continue;
    sections.push({
      slug: row.lesson.slug,
      title: row.lesson.title,
      moduleTitle: row.lesson.moduleTitle,
      heading: row.heading,
      anchor: row.anchor,
      text: row.text,
      code: row.code,
    });
  }
  return sections;
}

/**
 * The question's own matches, then the sections the previous answer was based on, without
 * repeats, up to `SECTIONS_WITH_CARRIED`.
 *
 * **Why the previous answer's sections come along.** The sections are chosen afresh for every
 * question from its words, and a follow-up such as "I don't know" or "why?" has none that
 * match the topic, so Claude would be answering it with the topic's sections gone and only its
 * own earlier words to go on. Carried forward, the sections that answered the last question are
 * there for the next. The question's own matches go first, so a question that changes the
 * subject is answered from the new subject's sections, with the old ones behind them.
 */
export function carrySections(
  found: RetrievedSection[],
  carried: RetrievedSection[],
): RetrievedSection[] {
  const seen = new Set<string>();
  const sections: RetrievedSection[] = [];
  for (const section of [...found, ...carried]) {
    const key = `${section.slug}#${section.anchor}`;
    if (seen.has(key) || sections.length >= SECTIONS_WITH_CARRIED) continue;
    seen.add(key);
    sections.push(section);
  }
  return sections;
}

/** The retrieved sections written out for Claude, each under the lesson and heading it is from. */
export function formatSections(sections: RetrievedSection[]): string {
  return sections
    .map((section) => {
      const lines = [`### ${section.moduleTitle} › ${section.title} › ${section.heading}`];
      if (section.text !== "") lines.push(section.text);
      if (section.code !== "") lines.push("```", section.code, "```");
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * The template's README for a repository assignment, read from GitHub at the template's ref, or
 * null when there is no template or no README. One request per question; the hourly limit on
 * asking keeps that small.
 */
export async function assignmentReadme(assignment: {
  templateRepo: string | null;
  templateRef: string | null;
}): Promise<string | null> {
  if (!assignment.templateRepo) return null;
  const [owner, repo] = assignment.templateRepo.split("/");
  if (!owner || !repo) return null;
  try {
    return await fetchRepoFile(getConfiguredInstallationId(), {
      owner,
      repo,
      ref: assignment.templateRef ?? "HEAD",
      path: "README.md",
    });
  } catch (err) {
    // No GitHub App configured, as in a development copy: the question is answered without it.
    console.error("The Tutor could not read the assignment's README:", err);
    return null;
  }
}

/** An assignment as the Tutor reads it: its title, its instructions, and its README. */
export function assignmentMaterial(
  assignment: { title: string; submissionInstructions: string | null },
  readme: string | null,
): string {
  const parts = [`# ${assignment.title}`];
  if (assignment.submissionInstructions) {
    parts.push("## Instructions", assignment.submissionInstructions);
  }
  if (readme) parts.push("## README", readme);
  if (parts.length === 1) parts.push("The assignment has no written instructions.");
  return parts.join("\n\n");
}

/** Texts are joined on this to be replaced in one pass, then split again. */
const TURN_BREAK = "\n␞\n";

/**
 * The asker's whole name, GitHub login and email replaced across every turn of a conversation at
 * once, and nothing else. The turns are text the fellow typed themselves: "legal", "court" and
 * "death" there are as likely to be about code as about their life, so the sensitive terms a
 * coaching record hides are left as written, and a part of a name alone — Will asking "Will this
 * loop run?" — is left too, because hiding it would change the question. `restore` puts the name
 * back into Claude's answer.
 */
export function redactTurns(
  turns: string[],
  names: RedactionNames,
): { turns: string[]; restore: (text: string) => string } {
  // The separator's symbol is taken out of the turns first, so a pasted one cannot split a turn.
  const cleaned = turns.map((turn) => turn.replaceAll("\u241e", ""));
  const redaction = redact(cleaned.join(TURN_BREAK), names, { terms: [], nameParts: false });
  return { turns: redaction.text.split(TURN_BREAK), restore: redaction.restore };
}
