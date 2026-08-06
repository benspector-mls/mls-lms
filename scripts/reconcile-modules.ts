/**
 * Moves assignments out of the modules the migration derived from old tags, and into the
 * course's real ones.
 *
 * Run once, with `npx tsx --conditions=react-server scripts/reconcile-modules.ts`. It is
 * idempotent — a second run finds nothing to do — and safe to delete afterwards.
 *
 * **Why this exists rather than being part of the migration.** The migration that created
 * `modules` could only name them after the tags it found, because SQL cannot know that
 * `mod-3-async-and-apis` is what this program calls "Mod 4 - Interactive & Data-Driven User
 * Interfaces" — two of the old tags were simply wrong, pointing at answer-key directories that
 * never existed. That mapping is a curriculum judgment, so it is written here where it can be
 * read and argued with rather than buried in a migration nobody re-reads.
 *
 * **Why not the seed.** The seed describes what a working local database looks like. A one-time
 * fixup for rows that predate a schema change is not that, and leaving it there would mean
 * carrying it forever for a case that can only happen once.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

/**
 * Which real module each derived module's assignments belong in.
 *
 * The keys are the old tags, which are now the derived modules' names. Two of them are the
 * interesting ones: `mod-3-async-and-apis` and `mod-4-react` pointed at answer-key directories
 * that do not exist, which is why they could not simply be renamed.
 */
const MOVE_TO: Record<string, string> = {
  "mod-1-js-fundamentals": "Mod 1 - JavaScript Fundamentals",
  "mod-2-oop": "Mod 2 - Object-Oriented Programming",
  "mod-2-review": "Mod 2 - Object-Oriented Programming",
  "mod-3-html-css": "Mod 3 - HTML & CSS",
  // Consuming a third-party API belongs with data-driven interfaces rather than with HTML and
  // CSS, which is what the tag's number would have suggested. Confirmed rather than guessed.
  "mod-3-async-and-apis": "Mod 4 - Interactive & Data-Driven User Interfaces",
  "mod-4-dom": "Mod 4 - Interactive & Data-Driven User Interfaces",
  "mod-4-react": "Mod 7 - React",
  "mod-5-servers": "Mod 5 - Server-Side Development",
  "mod-5-backend": "Mod 5 - Server-Side Development",
  "mod-6-databases": "Mod 6 - Databases",
  "mod-7-react": "Mod 7 - React",
};

/** A module the migration derived, rather than one an instructor named. */
function isDerived(name: string): boolean {
  return /^mod-\d/.test(name);
}

async function main() {
  const { db } = await import("../lib/prisma");

  const courses = await db.course.findMany({
    select: {
      id: true,
      name: true,
      cohortTerm: true,
      modules: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, _count: { select: { assignments: true } } },
      },
    },
  });

  let moved = 0;
  let removed = 0;
  let stuck = 0;

  for (const course of courses) {
    const derived = course.modules.filter((row) => isDerived(row.name));
    if (derived.length === 0) continue;

    console.log(`\n${course.name} — ${course.cohortTerm}`);
    const byName = new Map(course.modules.map((row) => [row.name, row.id]));

    for (const source of derived) {
      const targetName = MOVE_TO[source.name];
      const targetId = targetName ? byName.get(targetName) : undefined;

      /*
        Reported and skipped rather than guessed at. A derived module with nowhere to go is
        either a tag this script has not been told about or a real module the course is
        missing, and both want a person — moving its assignments somewhere arbitrary would be
        a wrong answer that looks like a right one.
      */
      if (!targetId) {
        stuck++;
        console.log(
          `  SKIP  ${source.name} (${source._count.assignments} assignments) — ` +
          (targetName
            ? `this course has no module called "${targetName}"`
            : `no mapping in MOVE_TO`),
        );
        continue;
      }

      if (source._count.assignments > 0) {
        const { count } = await db.assignment.updateMany({
          where: { moduleId: source.id },
          data: { moduleId: targetId },
        });
        moved += count;
        console.log(`  move  ${count} from ${source.name} -> ${targetName}`);
      }

      // Safe now: everything that referenced it has been moved, and the foreign key is
      // RESTRICT, so if anything still did this would fail rather than cascade.
      await db.module.delete({ where: { id: source.id } });
      removed++;
      console.log(`  drop  ${source.name}`);
    }
  }

  console.log(
    `\n${moved} assignments moved, ${removed} derived modules removed` +
    (stuck > 0 ? `, ${stuck} left alone — see the SKIP lines above` : ""),
  );

  if (stuck > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
