/**
 * Running a list of slow things a few at a time.
 *
 * **Its own module, and pure, because the interesting properties are the ones nobody notices
 * being wrong.** A pool that quietly runs everything at once still finishes, and still returns
 * the right answers — it just spends twenty sandboxes and twenty cache misses doing it. A pool
 * that loses an item's place still returns a list of the right length. Neither failure shows up
 * in the interface, so both are checked here instead.
 *
 * No dependency. `p-limit` is four lines of this and a package to keep current, and this file
 * has no imports at all, which is what lets it be tested with no environment.
 */

/**
 * What became of one item.
 *
 * `skipped` is a real outcome rather than an absence: a batch that was stopped has to be able to
 * say which items never started, so the retry offers those and not the ones that failed on
 * purpose. Collapsing it into `failed` would make "you stopped me" read as "this cannot be
 * graded".
 */
export type PoolResult<T> =
  { status: "done"; value: T } | { status: "failed"; error: unknown } | { status: "skipped" };

/**
 * Runs `worker` over `items`, at most `width` at a time.
 *
 * **Never rejects.** One item that throws is recorded against that item and the rest carry on,
 * which is the whole reason this exists rather than `Promise.all` — a batch of twenty reports
 * where the third has no answer keys should produce nineteen reports and one named failure, not
 * one error and nineteen abandoned subjects.
 *
 * Results come back **in input order**, not completion order, so a caller can line them up
 * against what it asked for without threading identity through the worker.
 *
 * `shouldStop` is consulted before each item starts, never mid-item. There is no way to abort a
 * request that is already in flight, and pretending otherwise would report an item as skipped
 * while its work went on to land — so stopping means "start nothing further", and the caller's
 * copy says so.
 */
export async function runPool<I, O>(
  items: readonly I[],
  width: number,
  worker: (item: I, index: number) => Promise<O>,
  options: { shouldStop?: () => boolean } = {},
): Promise<PoolResult<O>[]> {
  const results: PoolResult<O>[] = items.map(() => ({ status: "skipped" }));
  if (items.length === 0) return results;

  /*
    Clamped at both ends. Below one there would be no lane to do any work and the call would
    return with everything skipped, which reads as success; above the item count the extra lanes
    only find an exhausted cursor. A caller reading a width out of an environment variable can
    produce either, and neither deserves an error.
  */
  const lanes = Math.max(1, Math.min(Math.floor(width) || 1, items.length));

  /*
    One shared cursor rather than slicing the list into `lanes` chunks up front.

    Chunking is the obvious implementation and it is slower in exactly the case this is for: the
    items are reports, they take between thirty seconds and two minutes each, and a chunk that
    happens to hold the slow ones leaves its lane working while the others idle. Pulling from a
    cursor means a lane that finishes early takes the next item instead.

    `cursor++` is safe without a lock because there is no `await` between reading it and
    incrementing it, so no other lane can run in between.
  */
  let cursor = 0;

  async function lane(): Promise<void> {
    for (;;) {
      if (options.shouldStop?.()) return;

      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;

      try {
        results[index] = { status: "done", value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { status: "failed", error };
      }
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return results;
}
