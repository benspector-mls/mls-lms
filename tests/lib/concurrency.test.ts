import { runPool, type PoolResult } from "@/lib/concurrency";

/**
 * The properties a pool has to have, none of which are visible from the interface.
 *
 * A pool that ignores its width still finishes and still returns the right answers — it just
 * spends twenty sandboxes doing it. So the width is measured rather than assumed, by having the
 * worker record how many of itself were running at once.
 */

/** A worker that reports the high-water mark of its own concurrency. */
function tracking<T>(work: (item: T, index: number) => Promise<unknown> = async () => undefined) {
  const state = { active: 0, peak: 0, started: [] as number[] };
  return {
    state,
    worker: async (item: T, index: number) => {
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      state.started.push(index);
      try {
        return await work(item, index);
      } finally {
        state.active -= 1;
      }
    },
  };
}

/** Yields to the event loop enough times that any pending microtask work has drained. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runPool", () => {
  it("returns a result per item, in input order", async () => {
    const results = await runPool([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(results).toEqual([
      { status: "done", value: 10 },
      { status: "done", value: 20 },
      { status: "done", value: 30 },
      { status: "done", value: 40 },
    ]);
  });

  // Completion order is not input order the moment the items differ in cost, which for reports
  // they always do. A caller lines results up against what it asked for by position.
  it("keeps input order even when later items finish first", async () => {
    const results = await runPool([30, 0, 20, 0], 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });
    expect(results.map((r) => (r.status === "done" ? r.value : null))).toEqual([0, 1, 2, 3]);
  });

  it("never runs more than `width` at a time", async () => {
    const { state, worker } = tracking(async () => settle());
    await runPool(Array.from({ length: 12 }, (_, i) => i), 3, worker);
    expect(state.peak).toBe(3);
  });

  it("runs everything even when width exceeds the item count", async () => {
    const { state, worker } = tracking(async () => settle());
    const results = await runPool([1, 2], 10, worker);
    expect(results).toHaveLength(2);
    expect(state.peak).toBe(2);
    expect(results.every((r) => r.status === "done")).toBe(true);
  });

  // A width read out of an environment variable can be anything. None of these deserve an error,
  // and a width of zero must not mean "do nothing and report success".
  it.each([0, -1, 0.5, NaN])("treats a width of %p as one lane rather than none", async (width) => {
    const results = await runPool([1, 2, 3], width, async (n) => n);
    expect(results).toEqual([
      { status: "done", value: 1 },
      { status: "done", value: 2 },
      { status: "done", value: 3 },
    ]);
  });

  it("returns immediately for an empty list", async () => {
    await expect(runPool([], 4, async () => "never")).resolves.toEqual([]);
  });

  // The reason this exists rather than Promise.all: a batch of twenty reports where the third
  // has no answer keys should produce nineteen reports and one named failure.
  it("isolates a failure and carries on", async () => {
    const results = await runPool([1, 2, 3, 4], 2, async (n) => {
      if (n === 3) throw new Error("no answer keys");
      return n;
    });

    expect(results[0]).toEqual({ status: "done", value: 1 });
    expect(results[2]).toMatchObject({ status: "failed" });
    expect((results[2] as Extract<PoolResult<number>, { status: "failed" }>).error).toMatchObject({
      message: "no answer keys",
    });
    expect(results[3]).toEqual({ status: "done", value: 4 });
  });

  it("does not reject, however many items throw", async () => {
    const results = await runPool([1, 2, 3], 2, async () => {
      throw new Error("every one");
    });
    expect(results.every((r) => r.status === "failed")).toBe(true);
  });

  describe("stopping", () => {
    it("starts nothing further once shouldStop turns true", async () => {
      let stop = false;
      const { state, worker } = tracking(async (_item: number, index: number) => {
        if (index === 1) stop = true;
        await settle();
      });

      const results = await runPool([0, 1, 2, 3, 4, 5], 2, worker, { shouldStop: () => stop });

      // The two in flight when the flag turned finish; nothing after them begins.
      expect(state.started.length).toBeLessThan(6);
      expect(results.some((r) => r.status === "skipped")).toBe(true);
    });

    // Skipped has to stay distinct from failed, or a retry would offer the wrong set: "you
    // stopped me" and "this cannot be graded" want opposite responses.
    it("reports untouched items as skipped rather than failed", async () => {
      const results = await runPool([1, 2, 3], 1, async (n) => n, { shouldStop: () => true });
      expect(results).toEqual([{ status: "skipped" }, { status: "skipped" }, { status: "skipped" }]);
    });

    it("does nothing at all when stopped before the first item", async () => {
      const { state, worker } = tracking();
      await runPool([1, 2, 3], 3, worker, { shouldStop: () => true });
      expect(state.started).toEqual([]);
    });
  });
});
