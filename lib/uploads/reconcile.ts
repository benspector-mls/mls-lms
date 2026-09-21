/**
 * The one rule that decides whether a stored object is removed, kept apart from the script that
 * applies it so that it can be tested without a bucket or a database.
 *
 * **The rule is not "delete what no row names", and getting that wrong would destroy evidence.**
 * A submission that has been graded deliberately keeps every file taken off it, because the
 * feedback was written *about* a file and a released grade whose subject has been deleted is a
 * judgment nobody can check — see `discardRemovedUpload`. Those kept files are named by no row,
 * and a sweep that deleted everything unreferenced would delete exactly them. So the folder of a
 * graded submission is left alone entirely.
 *
 * **Two tables name objects in the bucket, and the rule knows both.** A folder is a submission's id
 * or a goal update's id, and an object is kept if either table names its path. An update has no
 * graded-work exception: nobody writes anything *about* the files a fellow attaches to their own
 * progress notes, so nothing is evidence for a judgment and a file taken off an update simply goes.
 *
 * **Nothing younger than a day is touched**, however it looks. A signed upload address expires
 * after two hours, so nothing older than that can still be waiting for its recording call — a day
 * is that bound with room to spare, and it means somebody uploading while the sweep runs is in no
 * danger from it. An object with no timestamp is treated as too young to touch, which is the safe
 * reading of not knowing how old something is.
 */

/** Long enough that nothing in flight can be caught by it. See the note above. */
export const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;

export type StoredObjectRecord = { path: string; sizeBytes: number; createdAt: Date | null };

/** Why one object is being kept or removed, in the words the summary prints. */
export type Verdict = { keep: boolean; reason: string };

export type KnownRows = {
  /** Submission folders in the bucket, by id, and whether a grade has been written on that work. */
  submissions: ReadonlyMap<string, { graded: boolean }>;
  /** Goal update folders in the bucket, by id. */
  updates: ReadonlySet<string>;
  /** Every path some row names, from either table. */
  attached: ReadonlySet<string>;
};

export function judgeStoredObjects<T extends StoredObjectRecord>(
  objects: readonly T[],
  known: KnownRows,
  now: number,
): (T & Verdict)[] {
  const verdictFor = (object: T): Verdict => {
    const folder = object.path.split("/")[0] ?? "";
    const submission = known.submissions.get(folder);

    /*
      What the object *is* comes before how old it is, so the summary says something worth
      reading. Both orders keep the same files — a file a row names is not removable at any age —
      but asking about the age first would report every file uploaded today as "less than a day
      old", which tells nobody whether the rule is working.
    */
    if (known.attached.has(object.path)) return { keep: true, reason: "attached to a row" };
    if (submission?.graded) return { keep: true, reason: "a grade was written on this work" };

    if (object.createdAt === null) {
      return { keep: true, reason: "no creation time to judge its age by" };
    }

    if (now - object.createdAt.getTime() < MINIMUM_AGE_MS) {
      return { keep: true, reason: "less than a day old" };
    }

    if (submission) return { keep: false, reason: "taken off the submission or never recorded" };
    if (known.updates.has(folder)) {
      return { keep: false, reason: "taken off the goal update or never recorded" };
    }

    return { keep: false, reason: "no row names this folder" };
  };

  return objects.map((object) => ({ ...object, ...verdictFor(object) }));
}
