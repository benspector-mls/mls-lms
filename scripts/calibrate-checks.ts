/**
 * Compares the review of checks for understanding against the levels an instructor gave.
 *
 *   npm run calibrate:checks -- path/to/set.json
 *   CHECK_REVIEW_MODEL=claude-sonnet-5 npm run calibrate:checks -- path/to/set.json
 *
 * The file holds one check and a list of answers, each labelled with the level an instructor gave
 * it:
 *
 *   {
 *     "objective": "…", "question": "…", "factsExample": "…", "exemplar": "…",
 *     "answers": [{ "answer": "…", "level": "RELATIONAL" }, …]
 *   }
 *
 * `level` is one of BLOCKED, UNISTRUCTURAL, MULTISTRUCTURAL, RELATIONAL, EXTENDED_ABSTRACT.
 *
 * **This measures the one thing the tests cannot**: whether the review agrees with an instructor.
 * The tests prove the prompt is stable and the reply is read correctly; nothing in the pipeline
 * knows what level a Marcy instructor would have given. The labelled answers do. The natural source
 * of them is the attempts page: every level an instructor sets there by hand is a labelled answer.
 *
 * Two agreements are reported. The exact level is the strict one. The category — Blocked,
 * Understands facts, Making connections — is the one a fellow reads, so a disagreement inside a
 * category costs a fellow nothing, and a disagreement across one is the kind that matters.
 *
 * Writes nothing to the database, and never exits non-zero on a disagreement: this is a
 * measurement, not a gate.
 *
 * Needs --conditions=react-server, as the review module imports "server-only".
 */
import { readFileSync } from "node:fs";

import { config as loadEnv } from "dotenv";
import { z } from "zod";

import { CATEGORY_LABEL, CHECK_LEVELS, levelCategory } from "../lib/checks/levels";
import { money, priceUsage } from "../lib/grade/pricing";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const setSchema = z.object({
  objective: z.string().min(1),
  question: z.string().min(1),
  factsExample: z.string().min(1),
  exemplar: z.string().min(1),
  answers: z.array(z.object({ answer: z.string().min(1), level: z.enum(CHECK_LEVELS) })).min(1),
});

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Name the labelled set: npm run calibrate:checks -- path/to/set.json");
    process.exit(1);
  }

  const parsed = setSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    console.error(`${path} is not a labelled set:\n${parsed.error.message}`);
    process.exit(1);
  }
  const set = parsed.data;

  const { reviewCheckAnswer, CheckReviewError } = await import("../lib/checks/review");

  let exact = 0;
  let sameCategory = 0;
  let reviewed = 0;
  let billed = 0;
  let onHit = 0;
  let model = "";

  console.log(
    ["#", "expected", "review", "category"].map((h, i) => h.padEnd([4, 20, 20, 10][i])).join(""),
  );

  for (const [index, item] of set.answers.entries()) {
    try {
      const review = await reviewCheckAnswer({
        objective: set.objective,
        question: set.question,
        factsExample: set.factsExample,
        exemplar: set.exemplar,
        answer: item.answer,
      });
      reviewed += 1;
      model = review.modelId;
      if (review.level === item.level) exact += 1;
      const agrees = levelCategory(review.level) === levelCategory(item.level);
      if (agrees) sameCategory += 1;

      const cost = priceUsage(review.usage, review.provider.split(":")[1] ?? review.modelId);
      if (cost) {
        billed += cost.total;
        onHit += cost.normalizedTotal;
      }

      console.log(
        [
          String(index + 1).padEnd(4),
          item.level.padEnd(20),
          review.level.padEnd(20),
          (agrees ? "agrees" : "differs").padEnd(10),
        ].join(""),
      );
      console.log(`    ${review.explanation}\n`);
    } catch (err) {
      if (!(err instanceof CheckReviewError)) throw err;
      console.log(
        `${String(index + 1).padEnd(4)}${item.level.padEnd(20)}review failed: ${err.message}\n`,
      );
    }
  }

  console.log("═".repeat(54));
  console.log(`model            ${model || "—"}`);
  console.log(`exact level      ${exact} of ${reviewed}`);
  console.log(
    `same category    ${sameCategory} of ${reviewed}  (${Object.values(CATEGORY_LABEL).join(" / ")})`,
  );
  console.log(`cost             ${money(billed)} billed, ${money(onHit)} on a cache hit`);
  if (reviewed < set.answers.length) {
    console.log(`not reviewed     ${set.answers.length - reviewed} (see the failures above)`);
  }
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
