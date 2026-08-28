/**
 * What the reports on record cost, from the token counts each one stored.
 *
 *   npm run cost                  # every draft that recorded usage
 *   npm run cost -- sonnet        # only drafts whose model matches a substring
 *
 * The pipeline records four token counts per draft in `model_metadata.usage` and no
 * dollar figure, because a price is a fact about Anthropic's rate card rather than about
 * a grading run, and a number baked into a row would be wrong the day the rate card
 * changes. This script is the other half: it applies the current rates to the counts
 * that are already stored, so the cost table can be re-derived at any time from runs
 * that have already happened rather than from runs commissioned to measure cost.
 *
 * Two things it deliberately does not report. Wall clock is not stored on a draft — the
 * grade script prints it per run — and the sandbox test run is a separate vendor and a
 * separate line item, recorded in `test_runs.duration_ms`.
 *
 * Needs --conditions=react-server, as the modules it reaches import "server-only".
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

import { money, priceUsage, type Usage } from "../lib/grade/pricing";

type Priced = {
  when: Date;
  model: string;
  effort: string;
  sections: string[];
  usage: Usage;
  /** Dollars, split so the output share can be read off rather than recomputed. */
  inputCost: number;
  outputCost: number;
  total: number;
  /**
   * What the same run would have cost had its cacheable prefix been read rather than
   * written — the basis the cost table in ARCHITECTURE.md uses, and the honest one for a
   * cohort graded in one sitting, where the first submission pays the write and the rest
   * read it. Reported beside the billed figure rather than instead of it, because the
   * gap between the two *is* the value of grading in a burst.
   */
  normalizedTotal: number;
};

/**
 * `model_metadata.provider` is written as `claude:<model>:<effort>` by the provider, and
 * two drafts of the same submission graded at different effort levels are not
 * comparable — so the effort half is part of the grouping key, not decoration.
 */
function splitProvider(provider: string): { model: string; effort: string } | null {
  const parts = provider.split(":");
  if (parts.length !== 3) return null;
  return { model: parts[1], effort: parts[2] };
}

const pct = (part: number, whole: number) =>
  whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function main() {
  const { db } = await import("../lib/prisma");

  const filter = process.argv[2];

  const drafts = await db.gradingDraft.findMany({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, modelMetadata: true },
  });

  const priced: Priced[] = [];
  let withoutUsage = 0;
  const unpriced = new Set<string>();

  for (const draft of drafts) {
    const meta = draft.modelMetadata as {
      provider?: string;
      usage?: Partial<Usage>;
      sectionsGraded?: string[];
    } | null;

    // A draft that failed before its first model call, or one written before usage was
    // recorded, has nothing to price. Counted rather than listed, because the count is
    // the only interesting thing about them.
    if (!meta?.provider || !meta.usage) {
      withoutUsage += 1;
      continue;
    }

    const split = splitProvider(meta.provider);
    if (!split) {
      withoutUsage += 1;
      continue;
    }
    if (filter && !split.model.includes(filter)) continue;

    const usage: Usage = {
      promptTokens: meta.usage.promptTokens ?? 0,
      cachedPromptTokens: meta.usage.cachedPromptTokens ?? 0,
      cacheWriteTokens: meta.usage.cacheWriteTokens ?? 0,
      completionTokens: meta.usage.completionTokens ?? 0,
    };

    const cost = priceUsage(usage, split.model);
    if (!cost) {
      unpriced.add(split.model);
      continue;
    }

    priced.push({
      when: draft.createdAt,
      model: split.model,
      effort: split.effort,
      sections: meta.sectionsGraded ?? [],
      usage,
      inputCost: cost.inputCost,
      outputCost: cost.outputCost,
      total: cost.inputCost + cost.outputCost,
      normalizedTotal: cost.normalizedTotal,
    });
  }

  if (priced.length === 0) {
    console.log(
      filter
        ? `No drafts recorded usage for a model matching "${filter}".`
        : "No drafts have recorded usage yet.",
    );
    await db.$disconnect();
    process.exit(0);
  }

  console.log("Every priced run. `billed` is what the run cost; `on a hit` is what it");
  console.log("would have cost reading its cacheable prefix rather than writing it.\n");
  console.log(
    [
      "date",
      "model",
      "effort",
      "sections",
      "uncached",
      "cached",
      "written",
      "output",
      "billed",
      "on a hit",
      "out%",
    ]
      .map((h, i) => (i < 4 ? h.padEnd([12, 18, 7, 24][i]) : h.padStart(9)))
      .join(" "),
  );

  for (const run of priced) {
    console.log(
      [
        run.when.toISOString().slice(0, 10).padEnd(12),
        run.model.padEnd(18),
        run.effort.padEnd(7),
        (run.sections.join(",") || "—").padEnd(24),
        String(run.usage.promptTokens).padStart(9),
        String(run.usage.cachedPromptTokens).padStart(9),
        String(run.usage.cacheWriteTokens).padStart(9),
        String(run.usage.completionTokens).padStart(9),
        money(run.total).padStart(9),
        money(run.normalizedTotal).padStart(9),
        pct(run.outputCost, run.total).padStart(9),
      ].join(" "),
    );
  }

  // Grouped by everything that makes two runs comparable: the model, the effort level,
  // and which sections were graded. A range rather than a single figure, because the
  // recorded runs vary by several times over on output tokens and one run is not a
  // measurement.
  const groups = new Map<string, Priced[]>();
  for (const run of priced) {
    const key = `${run.model} | ${run.effort} | ${run.sections.join(",") || "—"}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  console.log("\nBy model, effort, and sections\n");
  for (const [key, runs] of [...groups.entries()].sort()) {
    const totals = runs.map((r) => r.total);
    const normalized = runs.map((r) => r.normalizedTotal);
    const outputShare =
      runs.reduce((sum, r) => sum + r.outputCost, 0) / runs.reduce((sum, r) => sum + r.total, 0);
    const cacheHits = runs.filter((r) => r.usage.cachedPromptTokens > 0).length;

    console.log(key);
    console.log(
      `  ${runs.length} run${runs.length === 1 ? "" : "s"}` +
        ` (${cacheHits} on a cache hit, ${runs.length - cacheHits} writing the cache)`,
    );
    console.log(
      `  billed    ${money(Math.min(...totals))} to ${money(Math.max(...totals))}` +
        `  median ${money(median(totals))}`,
    );
    console.log(
      `  on a hit  ${money(Math.min(...normalized))} to ${money(Math.max(...normalized))}` +
        `  median ${money(median(normalized))}`,
    );
    console.log(`  output    ${Math.round(outputShare * 100)}% of the billed cost`);
    console.log(
      `  a cohort of 25 on cache hits, at the median: $${(median(normalized) * 25).toFixed(2)}`,
    );
    console.log();
  }

  if (withoutUsage > 0) {
    console.log(
      `${withoutUsage} draft${withoutUsage === 1 ? "" : "s"} recorded no usage to price.`,
    );
  }
  for (const model of unpriced) {
    console.log(`No rate on record for "${model}" — add it to RATES in scripts/cost.ts.`);
  }

  await db.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
