/**
 * Compares a generated report against one an instructor wrote by hand.
 *
 *   npm run calibrate            # every pair
 *   npm run calibrate -- 2       # one pair
 *
 * This is Phase 3 verification item 7, and it measures the only thing the automatic
 * checks cannot. `tests/lib/grade/` proves a report is internally consistent — that its
 * arithmetic adds up and that it does not contradict a test run. It cannot prove the
 * score is the one a Marcy instructor would have given, because nothing in the
 * pipeline knows what that is. These pairs do.
 *
 * The samples live in the grading toolkit as `sample-short-response-submission-N.md`
 * and `sample-short-response-report-N.md`. Pair 1 is the exemplar embedded in the
 * prompt, so grading it measures little; it is included because a model that cannot
 * reproduce the report it was shown is worth knowing about. **Pair 2 is the real
 * test** — it is deliberately kept out of the prompt, and it stops being a test the
 * moment anything puts it back in.
 *
 * Needs --conditions=react-server, as the modules it reaches import "server-only".
 */
import { config as loadEnv } from "dotenv";

import { money, priceUsage, type PricedUsage, type Usage } from "../lib/grade/pricing";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const ANSWER_KEY_REPO = "The-Marcy-Lab-School/swe-assignment-grading-guides";

/**
 * Every calibration pair, with the reference solutions its report was marked against.
 *
 * **The answer key belongs to the pair rather than to this script**, because the pairs are drawn
 * from different assignments: pairs 1 to 3 from `swe-checkpoint-summative-1-4` and pair 4 from
 * `swe-6-1-sql-basics-sr`. Production grades a section against the key its own assignment names,
 * so one key shared across every pair would measure a configuration nobody runs. Adding a pair
 * means adding a row here, and a pair with no row is refused rather than graded keyless.
 *
 * Named here rather than read from a database row because this script grades files out of the
 * toolkit and never loads an assignment.
 *
 * Pair 1 is the exemplar embedded in the prompt, so grading it measures little beyond whether the
 * pipeline is steady. **Pairs 2, 3, and 4 are held out.** Pair 4 is the one that tests the rubric
 * most honestly: pairs 2 and 3 share their four questions with the exemplar, and the model has
 * been observed anchoring to the exemplar's scores, while pair 4 is five different questions on a
 * different topic.
 */
const CALIBRATION_PAIRS: Record<string, { answerKeyDir: string }> = {
  "1": {
    answerKeyDir: "answer-keys/mod-4-dom/swe-checkpoint-summative-1-4/short-response-solution",
  },
  "2": {
    answerKeyDir: "answer-keys/mod-4-dom/swe-checkpoint-summative-1-4/short-response-solution",
  },
  "3": {
    answerKeyDir: "answer-keys/mod-4-dom/swe-checkpoint-summative-1-4/short-response-solution",
  },
  "4": { answerKeyDir: "answer-keys/mod-6-databases/swe-6-1-sql-basics-sr" },
  /*
    Pair 5 shares pair 4's assignment, questions, and key on purpose. Resemblance between two
    held-out pairs is harmless — only pair 1 is in the prompt, so only resemblance to *it* can
    be answered from memory — and holding the questions constant makes writing quality the
    variable rather than topic difficulty.

    It is the sample that exercises the writing band: strong technical work with an unclosed
    backtick and a missing word, which is the first submission on record to fail the markdown
    axis and the first to sit above the completion threshold on this assignment.
  */
  "5": { answerKeyDir: "answer-keys/mod-6-databases/swe-6-1-sql-basics-sr" },
};

/** What an instructor's hand-written report says, pulled out of its markdown. */
type ExpectedScores = {
  total: { earned: number; possible: number } | null;
  technical: { earned: number; possible: number } | null;
  writing: { earned: number; possible: number } | null;
  questions: { label: string; earned: number; possible: number }[];
  /**
   * Null once reports stopped carrying flag text. Sample reports are student-facing
   * templates and an internal label in one teaches the model to write internal labels
   * into student-facing text, so the flag now lives only in the structured field —
   * which means a report can no longer tell us what it should have been.
   */
  mechanicalErrorsFlag: boolean | null;
};

function parseExpected(markdown: string): ExpectedScores {
  const pair = (pattern: RegExp) => {
    const match = markdown.match(pattern);
    return match ? { earned: Number(match[1]), possible: Number(match[2]) } : null;
  };

  const questions: ExpectedScores["questions"] = [];
  // Matches "**Question 3: Flexbox vs. CSS Grid:** 2/3".
  const questionPattern = /\*\*Question (\d+):([^*]*)\*\*\s*([\d.]+)\s*\/\s*(\d+)/g;
  for (const match of markdown.matchAll(questionPattern)) {
    questions.push({
      label: `Q${match[1]}${match[2].trim().replace(/:$/, "") ? ` ${match[2].trim().replace(/:$/, "")}` : ""}`,
      earned: Number(match[3]),
      possible: Number(match[4]),
    });
  }

  return {
    total: pair(/Score:\s*([\d.]+)\s*\/\s*(\d+)/),
    technical: pair(/Technical score:\s*([\d.]+)\s*\/\s*(\d+)/i),
    writing: pair(/Writing score:\s*([\d.]+)\s*\/\s*(\d+)/i),
    questions,
    mechanicalErrorsFlag: /FLAG:\s*MECHANICAL\s+ERRORS/i.test(markdown) ? true : null,
  };
}

function formatPair(value: { earned: number; possible: number } | null): string {
  return value ? `${value.earned}/${value.possible}` : "—";
}

/** Sums the rubric items a generated report assigned to one criterion. */
function sumCriterion(
  items: { criterion: string; scoreEarned: number; scorePossible: number }[],
  predicate: (criterion: string) => boolean,
): { earned: number; possible: number } | null {
  const matching = items.filter((item) => predicate(item.criterion.toLowerCase()));
  if (matching.length === 0) return null;
  return {
    earned: matching.reduce((sum, item) => sum + item.scoreEarned, 0),
    possible: matching.reduce((sum, item) => sum + item.scorePossible, 0),
  };
}

async function main() {
  const { loadGradingAssets, readToolkitFile } = await import("../lib/grade/assets");
  const { buildSystemPrompt, buildUserPrompt } = await import("../lib/grade/prompts");
  const { getReportGenerator } = await import("../lib/grade/provider");
  const { crossCheck } = await import("../lib/grade/cross-check");

  // Read from the repository over the API, the same way grading reads its rubric — there
  // is no local-clone mode any more.
  const only = process.argv[2];
  const requested = only ? [only] : Object.keys(CALIBRATION_PAIRS);
  const pairs = requested.map((n) => {
    const configured = CALIBRATION_PAIRS[n];
    if (!configured) {
      console.error(
        `Calibration pair ${JSON.stringify(n)} has no entry in CALIBRATION_PAIRS, so there is no ` +
          `answer key to grade it against. Add one in scripts/calibrate.ts — the pairs on record ` +
          `are ${Object.keys(CALIBRATION_PAIRS).join(", ")}.`,
      );
      process.exit(1);
    }
    return {
      n,
      answerKeyDir: configured.answerKeyDir,
      submissionFile: `sample-short-response-submission-${n}.md`,
      reportFile: `sample-short-response-report-${n}.md`,
    };
  });

  const generator = await getReportGenerator();
  console.log(`Provider  ${generator.name}\n`);

  let mismatches = 0;
  /*
    Priced per pair as well as summed, because the two questions calibration answers are
    "does it agree" and "what did agreeing cost", and only the first was ever reported. A
    tier comparison without a price is half an answer, and the price cannot be recovered
    afterwards: this harness writes no draft, so `npm run cost` has no row to read.

    The model identifier comes from the response rather than from the provider name, so a
    run pointed at a tier by environment variable is priced as the tier that answered.
  */
  const priced: { pair: string; model: string; usage: Usage; cost: PricedUsage }[] = [];

  for (const pair of pairs) {
    const [submission, expectedMarkdown] = await Promise.all([
      readToolkitFile(pair.submissionFile),
      readToolkitFile(pair.reportFile),
    ]);
    if (submission === null || expectedMarkdown === null) {
      console.error(
        `Calibration pair ${pair.n} is missing from grading-toolkit/ — expected ` +
          `${pair.submissionFile} and ${pair.reportFile}.`,
      );
      process.exit(1);
    }
    const expected = parseExpected(expectedMarkdown);

    /*
      Graded with the answer key, because that is what production does and a calibration
      that omits it measures a configuration nobody runs.

      This was once deliberately null, on the reasoning that a short response is graded
      against the rubric and the questions alone. That is not what an instructor does: the
      key carries a per-question "Look for" list naming the terminology and points each
      answer has to reach, and the hand-written reports these samples are compared against
      were marked against it. Withholding it asked the model to infer a standard that was
      written down.

      Each pair names its own directory, and for the checkpoint pairs that is the short response
      solution specifically rather than the assignment's whole answer key folder — that folder
      also holds the frontend solution, and sending five JavaScript and CSS files into a short
      response prompt is noise the section cannot use and is billed for on every run.
    */
    const assets = await loadGradingAssets({
      sectionType: "short_response",
      answerKeyRepo: ANSWER_KEY_REPO,
      answerKeyDir: pair.answerKeyDir,
    });

    const response = await generator.generate({
      system: buildSystemPrompt({ sectionType: "short_response", assets }),
      user: buildUserPrompt({
        assets,
        context: {
          studentGithubUsername: "sample-student",
          assignmentTitle: `short response calibration sample ${pair.n}`,
          pointValue: expected.total?.possible ?? 15,
          // The sample file carries the questions as well as the answers, so it is
          // self-contained and there is no separate README to supply.
          readme: null,
          studentFiles: [{ path: "short-response.md", content: submission }],
          testResults: null,
          tamperedPaths: [],
          headBranch: null,
        },
      }),
    });

    const actual = response.output;
    const items = actual.rubricItems;

    // The provider reports the two cache counts as optional, because a provider that does
    // not cache omits them rather than reporting zero. Zero is the right reading for
    // pricing either way, and normalizing here keeps the arithmetic free of that question.
    const usage: Usage = {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      cachedPromptTokens: response.usage.cachedPromptTokens ?? 0,
      cacheWriteTokens: response.usage.cacheWriteTokens ?? 0,
    };
    const cost = priceUsage(usage, response.modelId);
    if (cost) priced.push({ pair: pair.n, model: response.modelId, usage, cost });

    // The same cross-check the pipeline runs. Without it this harness would report a
    // score the real system would have refused to show anyone, and compare it against
    // an instructor's as though the two were alternatives. They are not: a report that
    // fails the cross-check never reaches a student at all.
    const check = crossCheck(actual, {
      tests: null,
      tamperedPaths: [],
      // The same maximum the prompt was given, so a report scored out of a different one is
      // reported here rather than silently compared against the instructor's on another scale.
      pointValue: expected.total?.possible ?? 15,
    });
    const actualTechnical = sumCriterion(items, (c) => c.includes("technical"));
    const actualWriting = sumCriterion(items, (c) => c.includes("writing"));
    const actualFlag = actual.flags.includes("MECHANICAL");

    const totalDelta = expected.total ? actual.scoreEarned - expected.total.earned : null;

    console.log(`${"═".repeat(74)}`);
    console.log(
      `Pair ${pair.n}${pair.n === "1" ? "  (exemplar — shown to the model)" : "  (held out)"}`,
    );
    console.log(`${"═".repeat(74)}`);
    console.log(`                  instructor      model`);
    console.log(
      `  total           ${formatPair(expected.total).padEnd(15)} ${actual.scoreEarned}/${actual.scorePossible}` +
        (totalDelta === null ? "" : `   (${totalDelta >= 0 ? "+" : ""}${totalDelta})`),
    );
    console.log(
      `  technical       ${formatPair(expected.technical).padEnd(15)} ${formatPair(actualTechnical)}`,
    );
    console.log(
      `  writing         ${formatPair(expected.writing).padEnd(15)} ${formatPair(actualWriting)}`,
    );
    // The instructor column is "—" whenever the sample report carries no flag text,
    // which is now always: flags moved out of student-facing reports entirely, so a
    // report can no longer say what its flags should have been.
    console.log(
      `  MECHANICAL      ${(expected.mechanicalErrorsFlag === null ? "—" : String(expected.mechanicalErrorsFlag)).padEnd(15)} ${actualFlag}`,
    );
    console.log(
      `  flags raised    ${"".padEnd(15)} ${actual.flags.length > 0 ? actual.flags.join(", ") : "none"}`,
    );
    console.log(`  confidence      ${"".padEnd(15)} ${actual.confidence}`);
    console.log(
      `  cross-check     ${"".padEnd(15)} ` +
        (check.needsManualReview
          ? `WOULD BE HELD: ${check.findings.map((f) => f.code).join(", ")}`
          : "passes"),
    );
    // Both bases, for the reason given on `normalizedTotal`: within one run the first pair
    // on an assignment writes the cache and the rest read it, so the billed figures alone
    // would say more about pair order than about the tier.
    console.log(
      `  cost            ${"".padEnd(15)} ` +
        (cost
          ? `${money(cost.total)} billed, ${money(cost.normalizedTotal)} on a hit  ` +
            `(${usage.completionTokens} out, ` +
            `${usage.cacheWriteTokens > 0 ? "cache written" : "cache read"})`
          : `unpriced — ${response.modelId} has no entry in RATES`),
    );

    // Reported separately from the score comparison, and first, because it changes
    // what the comparison means. A held report is not a wrong grade — it is one the
    // instructor was going to have to look at regardless.
    if (check.needsManualReview) {
      for (const finding of check.findings) console.log(`      ${finding.detail}`);
      mismatches++;
    }

    if (expected.questions.length > 0) {
      console.log(`\n  per question:`);
      for (const question of expected.questions) {
        // Matched on the leading question number, because the model writes its own
        // labels and they will not be character-identical to the instructor's.
        const number = question.label.match(/^Q(\d+)/)?.[1];
        const match = items.find((item) => new RegExp(`\\b${number}\\b`).test(item.label));
        const actualText = match ? `${match.scoreEarned}/${match.scorePossible}` : "not found";
        const agrees = match && match.scoreEarned === question.earned;
        console.log(
          `    ${agrees ? " " : "≠"} ${question.label.padEnd(38)} ` +
            `${`${question.earned}/${question.possible}`.padEnd(8)} ${actualText}`,
        );
        if (!agrees) mismatches++;
      }
    }

    if (totalDelta !== null && totalDelta !== 0) mismatches++;
    if (expected.mechanicalErrorsFlag !== null && expected.mechanicalErrorsFlag !== actualFlag) {
      mismatches++;
    }

    // Printed in full because the per-question rows above are matched by question
    // number against labels the model wrote itself, and a mismatch there would be
    // indistinguishable from agreement without seeing the underlying items.
    console.log(`\n  rubric items the model returned:`);
    for (const item of items) {
      console.log(
        `    ${`${item.scoreEarned}/${item.scorePossible}`.padEnd(8)} ` +
          `${item.label}  [${item.criterion}]`,
      );
    }

    if (actual.instructorNotes.length > 0) {
      console.log(`\n  notes to the instructor:`);
      for (const note of actual.instructorNotes) console.log(`    - ${note}`);
    }

    console.log(`\n${"─".repeat(74)}\n${actual.reportMarkdown}\n`);
  }

  if (priced.length > 0) {
    const sum = (pick: (p: (typeof priced)[number]) => number) =>
      priced.reduce((running, p) => running + pick(p), 0);
    const billed = sum((p) => p.cost.total);
    const onHit = sum((p) => p.cost.normalizedTotal);
    console.log(`${"═".repeat(74)}`);
    console.log(
      `Cost      ${priced.length} report${priced.length === 1 ? "" : "s"} on ${priced[0].model}  ` +
        `${money(billed)} billed, ${money(onHit)} on a hit  ` +
        `(${money(onHit / priced.length)} a report)`,
    );
    console.log(
      `          ${sum((p) => p.usage.completionTokens).toLocaleString()} output tokens, ` +
        `${Math.round((sum((p) => p.cost.outputCost) / billed) * 100)}% of the bill`,
    );
  }

  // Deliberately not an exit code. A one-point difference on a subjective writing
  // score is not a failure, and treating it as one would invite tuning the prompt
  // until the number matched rather than reading the reports. A person decides.
  console.log(`${"═".repeat(74)}`);
  console.log(
    mismatches === 0
      ? "Every compared figure agreed."
      : `${mismatches} figure(s) differ. Read both reports above before changing anything.`,
  );
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
