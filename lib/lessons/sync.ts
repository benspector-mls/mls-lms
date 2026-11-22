import "server-only";

import { runPool } from "../concurrency";
import { inTransaction, type Tx } from "../prisma";
import { curriculumRepo, headSha, LessonSyncError, listTree, readText } from "./repo";
import {
  extractSections,
  inlineGitbookTags,
  lessonImagePaths,
  unknownGitbookTags,
  withoutFrontMatter,
} from "./outline";
import { lessonSlug, parseSummary } from "./summary";

/** Something in the curriculum an author should fix, named by the file it is in. */
export type SyncProblem = { path: string; message: string };

export type SyncResult = {
  /** The commit every listed lesson now comes from. */
  commitSha: string;
  /** How many lessons `SUMMARY.md` lists and the LMS now shows. */
  lessons: number;
  /** How many of them had new contents and were read again. */
  changed: number;
  /** How many lessons were dropped from `SUMMARY.md` by this run. */
  removed: number;
  problems: SyncProblem[];
};

/** How many files are fetched from GitHub at once when several lessons changed. */
const FETCH_WIDTH = 6;

/**
 * Copies one curriculum at the head of its branch into the `lessons` and `lesson_sections` tables,
 * touching no other curriculum's rows.
 *
 * Run every 15 minutes for every curriculum by the cron in `app/api/cron/lessons/route.ts`, and by
 * an admin's "Sync now" on Admin → Lessons after an edit that should not wait for the next run.
 *
 * **Every run reads the summary and the file tree, and only the lessons that changed.** A run with
 * no new commits makes about four requests to GitHub: the branch's latest commit, `SUMMARY.md`,
 * and the file tree, plus one more when the curriculum names no branch and the default branch has
 * to be looked up. A lesson whose file has the same hash as the stored row keeps its body; it is
 * written only when the summary now says something different about it — its title, its place, its
 * module — or when the commit has moved. So a run with no edits costs those requests and one read
 * of the table, and the checks for problems below still run on every lesson.
 * Changed files are fetched a few at a time, so a commit that touches every lesson does not wait
 * on fifty requests one after another.
 *
 * **Each changed lesson is written in its own transaction**, the row and its sections together. A
 * run that fails partway leaves the lessons before the failure at the new commit and the rest at
 * the old one. Every row names the commit its body came from, and the page loads its images from
 * that same commit, so a lesson is never shown with pictures from a different version of itself.
 *
 * A lesson that drops out of the summary is marked `removedAt` and kept; see the `Lesson` model.
 */
export async function syncCurriculum(
  db: Tx,
  curriculum: { id: string; name: string; repo: string; ref: string | null },
): Promise<SyncResult> {
  const source = await curriculumRepo(curriculum);
  const sha = await headSha(source);
  const [summaryText, tree] = await Promise.all([
    readText(source, sha, "SUMMARY.md"),
    listTree(source, sha),
  ]);

  /*
    Refused rather than read as an empty course. An empty list here would mark every lesson
    removed, and fellows would find the Lessons page empty because one request failed.
  */
  const entries = summaryText === null ? [] : parseSummary(summaryText);
  if (entries.length === 0) {
    throw new LessonSyncError(
      `SUMMARY.md in ${source.fullName} at ${sha.slice(0, 7)} could not be read or links no pages, ` +
        "so nothing was changed.",
    );
  }

  const storedRows = await db.lesson.findMany({
    where: { curriculumId: curriculum.id },
    select: {
      slug: true,
      path: true,
      title: true,
      partTitle: true,
      moduleSlug: true,
      moduleTitle: true,
      position: true,
      blobSha: true,
      commitSha: true,
      body: true,
      removedAt: true,
    },
  });
  type StoredLesson = (typeof storedRows)[number];
  const stored = new Map(storedRows.map((lesson) => [lesson.slug, lesson]));

  const problems: SyncProblem[] = [];

  // Each listed page with a file, once, with what the summary now says about it.
  const pages: {
    slug: string;
    blobSha: string;
    current: StoredLesson | undefined;
    fromSummary: {
      path: string;
      title: string;
      partTitle: string | null;
      moduleSlug: string;
      moduleTitle: string;
      position: number;
    };
  }[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const slug = lessonSlug(entry.path);
    if (seen.has(slug)) {
      problems.push({
        path: entry.path,
        message:
          "Has the same address in the LMS as a page listed before it in SUMMARY.md, so only " +
          "the first is shown. Rename one of the files.",
      });
      continue;
    }
    seen.add(slug);

    const blobSha = tree.get(entry.path);
    if (blobSha === undefined) {
      problems.push({
        path: entry.path,
        message: "SUMMARY.md links this page, but the repository has no file at that path.",
      });
      continue;
    }

    pages.push({
      slug,
      blobSha,
      current: stored.get(slug),
      fromSummary: {
        path: entry.path,
        title: entry.title,
        partTitle: entry.partTitle,
        moduleSlug: lessonSlug(entry.modulePath),
        moduleTitle: entry.moduleTitle,
        position: entry.position,
      },
    });
  }

  const changedPages = pages.filter((page) => page.current?.blobSha !== page.blobSha);
  const fetched = await runPool(changedPages, FETCH_WIDTH, (page) =>
    readText(source, sha, page.fromSummary.path),
  );
  const files = new Map(
    changedPages.map((page, index) => {
      const result = fetched[index];
      return [page.slug, result.status === "done" ? result.value : null];
    }),
  );

  const now = new Date();
  const listed = new Set<string>();
  // Unchanged lessons that need only the new commit, moved together in one write below.
  const commitOnly: string[] = [];
  let changed = 0;

  for (const { slug, blobSha, current, fromSummary } of pages) {
    let body: string;

    if (current && current.blobSha === blobSha) {
      const summaryChanged =
        current.removedAt !== null ||
        (Object.keys(fromSummary) as (keyof typeof fromSummary)[]).some(
          (field) => current[field] !== fromSummary[field],
        );
      if (summaryChanged) {
        await db.lesson.update({
          where: { curriculumId_slug: { curriculumId: curriculum.id, slug } },
          data: { ...fromSummary, commitSha: sha, syncedAt: now, removedAt: null },
        });
      } else if (current.commitSha !== sha) {
        commitOnly.push(slug);
      }
      body = current.body;
    } else {
      const file = files.get(slug) ?? null;
      if (file === null) {
        problems.push({
          path: fromSummary.path,
          message:
            "This page could not be read from GitHub, so the LMS still shows its last copy, if it " +
            "has one. Files over 200 KB are refused.",
        });
        // A page that is still listed is not removed because one read of it failed.
        if (current) listed.add(slug);
        continue;
      }

      const text = withoutFrontMatter(file);
      const row = { ...fromSummary, body: text, blobSha, commitSha: sha, syncedAt: now };
      await inTransaction(db, async (tx) => {
        /*
          One writer per lesson at a time. The scheduled run and an admin's Sync now can copy the same
          curriculum at once, and two transactions each deleting the sections the other has not
          committed yet would each add their own, leaving every section twice. The lock is held to
          the end of this transaction; the second writer then deletes what the first wrote.
        */
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`lesson:${curriculum.id}:${slug}`}))`;
        const lesson = await tx.lesson.upsert({
          where: { curriculumId_slug: { curriculumId: curriculum.id, slug } },
          create: { curriculumId: curriculum.id, slug, ...row },
          update: { ...row, removedAt: null },
          select: { id: true },
        });
        await tx.lessonSection.deleteMany({ where: { lessonId: lesson.id } });
        await tx.lessonSection.createMany({
          data: extractSections(text).map((section) => ({ lessonId: lesson.id, ...section })),
        });
      });
      changed += 1;
      body = text;
    }

    listed.add(slug);
    problems.push(...lessonProblems(fromSummary.path, body, tree));
  }

  if (commitOnly.length > 0) {
    await db.lesson.updateMany({
      where: { curriculumId: curriculum.id, slug: { in: commitOnly } },
      data: { commitSha: sha, syncedAt: now },
    });
  }

  const removed = await db.lesson.updateMany({
    where: { curriculumId: curriculum.id, slug: { notIn: [...listed] }, removedAt: null },
    data: { removedAt: now },
  });

  return { commitSha: sha, lessons: listed.size, changed, removed: removed.count, problems };
}

/** What an author should fix in one lesson: images the repository lacks, and blocks the page cannot draw. */
function lessonProblems(path: string, body: string, tree: Map<string, string>): SyncProblem[] {
  const problems: SyncProblem[] = [];

  for (const image of lessonImagePaths(path, body)) {
    if (!tree.has(image)) {
      problems.push({ path, message: `Shows the image ${image}, which is not in the repository.` });
    }
  }
  for (const tag of unknownGitbookTags(body)) {
    problems.push({
      path,
      message: `Uses the GitBook block {% ${tag} %}, which the lesson page shows as plain text.`,
    });
  }
  for (const tag of inlineGitbookTags(body)) {
    problems.push({
      path,
      message:
        `Writes {% ${tag} %} on a line with other text, which the lesson page shows as plain ` +
        "text. Put each GitBook tag on a line of its own.",
    });
  }

  return problems;
}
