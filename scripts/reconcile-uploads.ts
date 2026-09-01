/**
 * Finds objects in the submission bucket that nothing points at, and removes them when told to.
 *
 *   npm run reconcile:uploads              # says what it would remove, and removes nothing
 *   npm run reconcile:uploads -- --delete  # removes it
 *   npm run reconcile:uploads:deployment   # the same, against the deployment's project
 *
 * **Why unreferenced objects happen at all.** Handing in a file is two calls with the browser's
 * upload between them: `beginUpload` signs an address, the browser sends the file straight to the
 * bucket, `recordUpload` writes the path onto the submission. A connection that drops in the
 * middle leaves bytes stored and no row naming them. Replacing a file leaves one too — the path
 * carries a generated segment, so a second upload writes a *new* object rather than overwriting
 * the one an instructor may be part-way through reading. Neither is a failure anybody sees; both
 * accumulate.
 *
 * **The rule is not "delete what no column names", and getting that wrong would destroy evidence.**
 * A submission that has been graded deliberately keeps every file it replaces, because the feedback
 * was written *about* a file and a released grade whose subject has been deleted is a judgment
 * nobody can check — see `discardReplacedUpload`, which is where that rule is stated. Those kept
 * files are named by no column, and a sweep that deleted everything unreferenced would delete
 * exactly them. So this leaves the folder of a graded submission alone entirely.
 *
 * The cost of that caution is the honest one: on a graded submission, an object left behind by a
 * dropped connection cannot be told apart from a file a grade describes, so it stays. That is a
 * bounded leak of at most one file per interrupted upload, and it is the right side to err on.
 *
 * **Nothing younger than a day is touched**, however it looks. A signed upload address expires
 * after two hours, so nothing older than that can still be waiting for its `recordUpload` — a day
 * is that bound with room to spare, and it means a student uploading while this runs is in no
 * danger from it.
 */
import { config as loadEnv } from "dotenv";

import { listStoredUploads, removeSubmissionUploads } from "../lib/uploads/storage";
import { formatBytes } from "../lib/uploads/file-types";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/** Long enough that nothing in flight can be caught by it. See the note above. */
const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;

/** The folder name is a submission id, and anything else in the bucket was not put there by us. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const deleting = process.argv.includes("--delete");

  const { db } = await import("../lib/prisma");

  const objects = await listStoredUploads();

  if (objects.length === 0) {
    console.log("The bucket is empty.");
    await db.$disconnect();
    return;
  }

  const now = Date.now();

  /*
    The rows for every folder that could be a submission, read in one query.

    Filtered to UUID-shaped names first, because the column is `uuid` and Postgres refuses a
    comparison against a string that is not one — a single stray folder would otherwise fail the
    whole run rather than being reported as the stray it is.
  */
  const folders = [...new Set(objects.map((object) => object.path.split("/")[0]))];
  const rows = await db.submission.findMany({
    where: { id: { in: folders.filter((folder) => UUID.test(folder)) } },
    select: { id: true, uploadPath: true, gradedAt: true },
  });
  const bySubmission = new Map(rows.map((row) => [row.id, row]));

  /** Why one object is being kept or removed, in the words the summary prints. */
  const verdictFor = (object: (typeof objects)[number]) => {
    const row = bySubmission.get(object.path.split("/")[0]);

    /*
      What the object *is* comes before how old it is, so the summary says something worth
      reading. Both orders keep the same files — a submission's current file is not removable at
      any age — but asking about the age first would report every file handed in today as "less
      than a day old", which tells nobody whether the rule is working.
    */
    if (row?.uploadPath === object.path) return { keep: true, reason: "handed in" };
    if (row?.gradedAt) return { keep: true, reason: "a grade was written on this work" };

    // Not knowing how old something is, is not the same as it being old. An object the API
    // reports no timestamp for is left alone and said out loud, rather than quietly swept up.
    if (object.createdAt === null) {
      return { keep: true, reason: "no creation time to judge its age by" };
    }

    if (now - object.createdAt.getTime() < MINIMUM_AGE_MS) {
      return { keep: true, reason: "less than a day old" };
    }

    if (!row) return { keep: false, reason: "no submission row" };

    return { keep: false, reason: "replaced or never recorded" };
  };

  const judged = objects.map((object) => ({ ...object, ...verdictFor(object) }));
  const orphans = judged.filter((object) => !object.keep);
  const kept = judged.filter((object) => object.keep);

  const bytes = (list: typeof judged) => list.reduce((total, one) => total + one.sizeBytes, 0);

  console.log(
    `${objects.length} object(s) in the bucket, ${formatBytes(bytes(judged))} in total.\n`,
  );

  // Named rather than counted, and grouped by why. A count says how much would go; the reasons
  // are what tells somebody reading this whether the rule is doing what they think it is.
  const byReason = (list: typeof judged) => {
    const groups = new Map<string, typeof judged>();
    for (const object of list) {
      groups.set(object.reason, [...(groups.get(object.reason) ?? []), object]);
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length);
  };

  console.log(`Keeping ${kept.length}:`);
  for (const [reason, group] of byReason(kept)) {
    console.log(`  ${group.length} — ${reason} (${formatBytes(bytes(group))})`);
  }

  if (orphans.length === 0) {
    console.log("\nNothing to remove.");
    await db.$disconnect();
    return;
  }

  console.log(`\n${deleting ? "Removing" : "Would remove"} ${orphans.length}:`);
  for (const [reason, group] of byReason(orphans)) {
    console.log(`\n  ${reason} — ${group.length}, ${formatBytes(bytes(group))}`);
    for (const object of group) {
      const age = object.createdAt
        ? `${Math.floor((now - object.createdAt.getTime()) / (24 * 60 * 60 * 1000))}d`
        : "unknown age";
      console.log(`    ${object.path}  ${formatBytes(object.sizeBytes)}  ${age}`);
    }
  }

  if (!deleting) {
    console.log(
      `\n${formatBytes(bytes(orphans))} would be freed. Nothing has been removed — run with ` +
        `-- --delete to remove it.`,
    );
    await db.$disconnect();
    return;
  }

  const { removed, leftBehind } = await removeSubmissionUploads(orphans.map((one) => one.path));

  console.log(`\nRemoved ${removed}, freeing about ${formatBytes(bytes(orphans))}.`);

  // Reported rather than thrown, for the reason `removeSubmissionUploads` gives: the rows that
  // pointed at these are gone, so naming them here is the only way anybody could find them again.
  if (leftBehind.length > 0) {
    console.log(`\n${leftBehind.length} would not go:`);
    for (const path of leftBehind) console.log(`  ${path}`);
    process.exitCode = 1;
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
