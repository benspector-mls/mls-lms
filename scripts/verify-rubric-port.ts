/**
 * Shows what the port changed in the system prompt of each of the four rubrics.
 *
 *   npm run verify:rubric-port -- --commit <sha>
 *
 * Builds each rubric's system prompt twice — from the toolkit files at the commit the rows were
 * ported from, the way the pipeline built it before the port, and from the rows as they are now —
 * and prints the lines that differ. Three differences are the port working as designed, and the
 * script names them rather than counting them: a rubric's own scoring section from
 * `agent-rules.md` moves later in the prompt, into its guidance; the scoring sections of the
 * *other* rubrics leave its prompt, because they were never about it; and the branch rule is gone,
 * because the pipeline says it in code. Any other line in the diff is a change to grading.
 *
 * Needs --conditions=react-server, as the modules it reaches import "server-only".
 */
import { config as loadEnv } from "dotenv";

import type { GradingAssets } from "../lib/grade/assets";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main() {
  const commit = argument("--commit");
  if (!commit) {
    console.error("Name the commit the rows were ported from: --commit <sha>");
    process.exit(1);
  }

  const { db } = await import("../lib/prisma");
  const { readToolkitFile } = await import("../lib/grade/assets");
  const { buildSystemPrompt } = await import("../lib/grade/prompts");
  const { SECTION_TYPES } = await import("../lib/section-types");
  const { GUIDANCE, TOOLKIT_RUBRICS, extractRubricSection, splitAgentRules } =
    await import("../lib/rubrics/port");

  const read = async (name: string) => {
    const content = await readToolkitFile(name, { ref: commit });
    if (content === null) throw new Error(`grading-toolkit/${name} is not at ${commit}.`);
    return content;
  };
  const [agentRules, rubricFile] = await Promise.all([read("agent-rules.md"), read("rubric.md")]);

  // A program with a rule set, which is what grading resolves through.
  const program = await db.program.findFirst({
    where: { ruleSetId: { not: null } },
    select: { id: true, ruleSet: { select: { currentVersion: { select: { markdown: true } } } } },
  });
  if (!program?.ruleSet?.currentVersion) {
    throw new Error("No program has a rule set yet. Run `npm run port:rubrics` first.");
  }

  // What the port is expected to take out of every prompt: the branch rule, and the scoring
  // sections of the other rubrics. A rubric's own scoring section is in both prompts.
  const split = splitAgentRules(agentRules);
  const branchRule = agentRules
    .split("\n")
    .filter((line) => line.startsWith("- Whenever a student's submission branch isn't named"));

  let differing = 0;
  for (const type of SECTION_TYPES) {
    const toolkit = TOOLKIT_RUBRICS[type];
    const expectedGone = new Set([
      ...branchRule,
      ...SECTION_TYPES.filter((other) => other !== type).flatMap((other) =>
        (split.scoring[other] ?? "").split("\n"),
      ),
    ]);
    const rubric = await db.rubric.findUnique({
      where: { name: toolkit.rubricName },
      select: {
        currentVersion: {
          select: {
            rubricMarkdown: true,
            guidanceMarkdown: true,
            sampleReportMarkdown: true,
          },
        },
      },
    });
    if (!rubric?.currentVersion) throw new Error(`${toolkit.rubricName} has no version yet.`);

    const unused = { answerKeys: [], excludedAnswerKeys: [], answerKeyCommitSha: null };
    const before: GradingAssets = {
      agentRules,
      rubricSection: extractRubricSection(rubricFile, toolkit.heading),
      guidance: GUIDANCE[type],
      sampleReport: toolkit.sampleFile ? await read(toolkit.sampleFile) : null,
      rubricVersionId: "",
      ruleSetVersionId: "",
      ...unused,
    };
    const after: GradingAssets = {
      agentRules: program.ruleSet.currentVersion.markdown,
      rubricSection: rubric.currentVersion.rubricMarkdown,
      guidance: rubric.currentVersion.guidanceMarkdown,
      sampleReport: rubric.currentVersion.sampleReportMarkdown,
      rubricVersionId: "",
      ruleSetVersionId: "",
      ...unused,
    };

    const oldLines = buildSystemPrompt({ assets: before }).split("\n");
    const newLines = buildSystemPrompt({ assets: after }).split("\n");
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const removed = oldLines.filter((line) => !newSet.has(line) && !expectedGone.has(line));
    const added = newLines.filter((line) => !oldSet.has(line));
    const expectedRemoved = oldLines.filter((line) => !newSet.has(line) && expectedGone.has(line));

    console.log(`${"═".repeat(74)}\n${toolkit.rubricName}\n${"═".repeat(74)}`);
    if (removed.length === 0 && added.length === 0) {
      console.log(
        oldLines.join("\n") === newLines.join("\n")
          ? "identical"
          : `as designed: ${expectedRemoved.length} line(s) of other rubrics' scoring rules and ` +
              `the branch rule are gone, and the rest is the same text with the scoring section ` +
              `moved into the guidance`,
      );
      continue;
    }
    differing += 1;
    for (const line of removed) console.log(`- ${line}`);
    for (const line of added) console.log(`+ ${line}`);
  }

  console.log(`${"═".repeat(74)}`);
  console.log(
    differing === 0
      ? "Every prompt holds the lines it held before, less the branch rule and the other " +
          "rubrics' scoring rules."
      : `${differing} prompt(s) gained or lost lines. Read them before grading anything.`,
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
