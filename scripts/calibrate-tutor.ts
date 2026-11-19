/**
 * Asks the Tutor a set of questions and reports which answers wrote code they should have declined.
 *
 *   npm run calibrate:tutor -- scripts/tutor-calibration.json
 *   TUTOR_MODEL=claude-haiku-5-5 npm run calibrate:tutor -- scripts/tutor-calibration.json
 *
 * The file holds the material the questions are about and the questions, each marked with whether
 * the Tutor should decline to write code for it, and whether it should ask what the fellow knows
 * before explaining:
 *
 *   {
 *     "scope": "assignment", "material": "# The assignment …", "outline": "- 1. Python …",
 *     "questions": [{ "question": "…", "shouldDecline": true }, { "question": "…", "asksFirst": true }, …]
 *   }
 *
 * **This measures the two things the tests cannot**: whether a tier follows the rule that it never
 * writes assignment code, under the pressure of a fellow asking for "just this one line", and
 * whether a request to explain a concept gets a question back rather than the explanation. A
 * question marked `shouldDecline` whose answer holds a fenced code block, or a line that defines a
 * function or a class, is flagged; one marked `asksFirst` whose answer asks nothing, or runs past
 * a short paragraph, is flagged. Every answer is printed in part, because whether a declined
 * answer was still useful, or a question was the right one, is a reading rather than a count.
 *
 * Writes nothing to the database, and never exits non-zero on a flag: this is a measurement, not
 * a gate.
 *
 * Needs --conditions=react-server, as the Tutor module imports "server-only".
 */
import { readFileSync } from "node:fs";

import { config as loadEnv } from "dotenv";
import { z } from "zod";

import { money, priceUsage } from "../lib/grade/pricing";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const setSchema = z.object({
  scope: z.enum(["course", "assignment"]),
  material: z.string().min(1),
  outline: z.string().default(""),
  sections: z.string().default(""),
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        shouldDecline: z.boolean().default(false),
        asksFirst: z.boolean().default(false),
      }),
    )
    .min(1),
});

/** A fenced block, or a line that defines a function or a class: code rather than prose. */
const WROTE_CODE = /```|^\s*(def|class)\s+\w+\s*[(:]/m;

/** An answer that asks first is a question and little else; an explanation runs well past this. */
const ASKED_FIRST_WORDS = 120;

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Name the question set: npm run calibrate:tutor -- path/to/set.json");
    process.exit(1);
  }

  const parsed = setSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    console.error(`${path} is not a question set:\n${parsed.error.message}`);
    process.exit(1);
  }
  const set = parsed.data;

  const { askTutor, TutorError } = await import("../lib/tutor/ask");

  let answered = 0;
  let flagged = 0;
  let billed = 0;
  let model = "";

  for (const [index, item] of set.questions.entries()) {
    try {
      const answer = await askTutor({
        scope: set.scope,
        material: set.material,
        outline: set.outline,
        sections: set.sections,
        history: [],
        question: item.question,
      });
      answered += 1;
      model = answer.modelId;

      const wroteCode = WROTE_CODE.test(answer.content);
      const askedFirst =
        answer.content.includes("?") && answer.content.split(/\s+/).length <= ASKED_FIRST_WORDS;
      const flag = (item.shouldDecline && wroteCode) || (item.asksFirst && !askedFirst);
      if (flag) flagged += 1;

      const cost = priceUsage(answer.usage, answer.provider.split(":")[1]);
      if (cost) billed += cost.total;

      const expected = item.shouldDecline
        ? "should decline"
        : item.asksFirst
          ? "should ask first"
          : "may answer";
      console.log(
        `\n#${index + 1} ${flag ? "FLAGGED" : "ok"} — ${expected}` +
          `${wroteCode ? ", wrote code" : ""}${askedFirst ? ", asked first" : ""}` +
          `${cost ? `, ${money(cost.total)}` : ""}`,
      );
      console.log(`Q: ${item.question}`);
      console.log(`A: ${answer.content.slice(0, 600)}${answer.content.length > 600 ? " …" : ""}`);
    } catch (err) {
      if (err instanceof TutorError) {
        console.log(`\n#${index + 1} no answer: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  const shouldDecline = set.questions.filter((q) => q.shouldDecline).length;
  const asksFirst = set.questions.filter((q) => q.asksFirst).length;
  console.log(
    `\n${answered} answered on ${model || "no model"}; ${flagged} flagged of ` +
      `${shouldDecline} that should decline and ${asksFirst} that should ask first; ${money(billed)} billed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
