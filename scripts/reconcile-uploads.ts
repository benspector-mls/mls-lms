/**
 * Finds objects in the submission bucket that nothing points at, and removes them when told to.
 *
 *   npm run reconcile:uploads              # says what it would remove, and removes nothing
 *   npm run reconcile:uploads -- --delete  # removes it
 *   npm run reconcile:uploads:deployment   # the same, against the deployment's project
 *
 * **Why unreferenced objects happen at all.** Handing in a file is two calls with the browser's
 * upload between them: `beginUpload` signs an address, the browser sends the file straight to the
 * bucket, `recordUpload` writes down the attachment. A connection that drops in the middle leaves
 * bytes stored and no row naming them. A file a student takes back off their submission after it
 * has been graded leaves one too, deliberately. Neither is a failure anybody sees; both
 * accumulate.
 *
 * **The rule is not "delete what no row names", and getting that wrong would destroy evidence.**
 * A submission that has been graded deliberately keeps every file taken off it, because the
 * feedback was written *about* a file and a released grade whose subject has been deleted is a
 * judgment nobody can check — see `discardRemovedUpload`, which is where that rule is stated.
 * Those kept files are named by no row, and a sweep that deleted everything unreferenced would
 * delete exactly them. So this leaves the folder of a graded submission alone entirely.
 *
 * The cost of that caution is the honest one: on a graded submission, an object left behind by a
 * dropped connection cannot be told apart from a file a grade describes, so it stays. That is a
 * bounded leak of at most one file per interrupted upload, and it is the right side to err on.
 *
 * **Nothing younger than a day is touched**, however it looks. A signed upload address expires
 * after two hours, so nothing older than that can still be waiting for its `recordUpload` — a day
 * is that bound with room to spare, and it means a student uploading while this runs is in no
 * danger from it.
 *
 * **Goal update attachments live in the same bucket**, under the update's id, and this reads both
 * tables before judging anything. The rule itself is `judgeStoredObjects` in
 * `lib/uploads/reconcile.ts`, where it has a test. **Do not run an older checkout of this script
 * once fellows have attached files to their goals**: a version that knows only the submissions
 * table would judge every one of those files "no submission row" and remove it.
 */
import { config as loadEnv } from "dotenv";

import { formatBytes } from "../lib/uploads/file-types";
import { judgeStoredObjects } from "../lib/uploads/reconcile";
import { listStoredUploads, removeSubmissionUploads } from "../lib/uploads/storage";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/** A folder name is a submission's or a goal update's id, and anything else in the bucket was not put there by us. */
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
    The rows for every folder that could be a submission or a goal update, one query per table.

    Filtered to UUID-shaped names first, because both id columns are `uuid` and Postgres refuses a
    comparison against a string that is not one — a single stray folder would otherwise fail the
    whole run rather than being reported as the stray it is.
  */
  const folders = [...new Set(objects.map((object) => object.path.split("/")[0]))].filter((name) =>
    UUID.test(name),
  );

  const [submissions, updates] = await Promise.all([
    db.submission.findMany({
      where: { id: { in: folders } },
      select: {
        id: true,
        gradedAt: true,
        // Every path this submission still names. A submission holds any number of attachments,
        // so "the file it points at" is a set rather than a column.
        artifacts: { where: { uploadPath: { not: null } }, select: { uploadPath: true } },
      },
    }),
    db.goalUpdate.findMany({
      where: { id: { in: folders } },
      select: { id: true, attachments: { select: { uploadPath: true } } },
    }),
  ]);

  const judged = judgeStoredObjects(
    objects,
    {
      submissions: new Map(
        submissions.map((row) => [row.id, { graded: row.gradedAt !== null }] as const),
      ),
      updates: new Set(updates.map((row) => row.id)),
      attached: new Set([
        ...submissions.flatMap((row) =>
          row.artifacts.flatMap((artifact) => (artifact.uploadPath ? [artifact.uploadPath] : [])),
        ),
        ...updates.flatMap((row) => row.attachments.map((attachment) => attachment.uploadPath)),
      ]),
    },
    now,
  );
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
