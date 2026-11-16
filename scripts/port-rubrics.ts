/**
 * Writes the four toolkit rubrics and the grading rules into the database, from the grading-guides
 * repository at one commit.
 *
 *   npm run port:rubrics -- --commit <sha> --dry-run   # print what would be written
 *   npm run port:rubrics -- --commit <sha>             # write it
 *
 * The rows it writes are the ones the seed made — matched by name, so every `rubricId` already
 * stored in an assignment's sections keeps resolving — plus one rule set, which it sets as the
 * default of every program that has none. Safe to run again: a version is created only when the
 * text differs from the current one, so a second run against the same commit writes nothing.
 *
 * How the files are divided is `lib/rubrics/port.ts`. Needs --conditions=react-server, as the
 * modules it reaches import "server-only".
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main() {
  const commit = argument("--commit");
  const dryRun = process.argv.includes("--dry-run");

  if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) {
    console.error(
      "Name the commit of the grading-guides repository to read the toolkit at:\n" +
        "  npm run port:rubrics -- --commit <sha> [--dry-run]",
    );
    process.exit(1);
  }

  const { db } = await import("../lib/prisma");
  const { readToolkitFile } = await import("../lib/grade/assets");
  const { SECTION_TYPES } = await import("../lib/section-types");
  const { PORTED_RULE_SET_NAME, TOOLKIT_RUBRICS, portedRubricText, splitAgentRules } =
    await import("../lib/rubrics/port");
  const { createRuleSet, publishRubricVersion, publishRuleSetVersion } =
    await import("../lib/rubrics/versions");

  const read = async (name: string) => {
    const content = await readToolkitFile(name, { ref: commit });
    if (content === null) {
      console.error(`grading-toolkit/${name} is not in the repository at ${commit}.`);
      process.exit(1);
    }
    return content;
  };

  const [agentRules, rubricFile] = await Promise.all([read("agent-rules.md"), read("rubric.md")]);
  const split = splitAgentRules(agentRules);

  const rubrics = await Promise.all(
    SECTION_TYPES.map(async (type) => ({
      type,
      name: TOOLKIT_RUBRICS[type].rubricName,
      text: portedRubricText(type, {
        rubric: rubricFile,
        sample: TOOLKIT_RUBRICS[type].sampleFile
          ? await read(TOOLKIT_RUBRICS[type].sampleFile)
          : null,
        scoring: split.scoring[type],
      }),
    })),
  );

  console.log(`Toolkit at ${commit.slice(0, 7)}\n`);
  console.log(`Rule set "${PORTED_RULE_SET_NAME}": ${split.ruleSet.length} characters`);
  for (const rubric of rubrics) {
    console.log(
      `Rubric ${rubric.name}: rubric ${rubric.text.rubricMarkdown.length}, guidance ` +
        `${rubric.text.guidanceMarkdown.length}, sample ${rubric.text.sampleReportMarkdown?.length ?? "none"}`,
    );
  }

  if (dryRun) {
    const rule = "─".repeat(74);
    console.log(`\n${rule}\n# RULE SET\n${rule}\n${split.ruleSet}`);
    for (const rubric of rubrics) {
      console.log(`\n${rule}\n# ${rubric.name}: rubric\n${rule}\n${rubric.text.rubricMarkdown}`);
      console.log(
        `\n${rule}\n# ${rubric.name}: guidance\n${rule}\n${rubric.text.guidanceMarkdown}`,
      );
    }
    console.log("\nDry run: nothing written.");
    await db.$disconnect();
    return;
  }

  // ---- The rule set, then the programs that have none ---------------------------------------
  const existingRuleSet = await db.ruleSet.findUnique({
    where: { name: PORTED_RULE_SET_NAME },
    select: { id: true },
  });
  let ruleSetId: string;
  if (existingRuleSet) {
    ruleSetId = existingRuleSet.id;
    const version = await publishRuleSetVersion(db, {
      ruleSetId,
      name: PORTED_RULE_SET_NAME,
      markdown: split.ruleSet,
    });
    console.log(
      `\nRule set: ${version.created ? `version ${version.number} written` : "unchanged"}`,
    );
  } else {
    const created = await createRuleSet(db, {
      name: PORTED_RULE_SET_NAME,
      markdown: split.ruleSet,
      createdById: null,
    });
    ruleSetId = created.ruleSetId;
    console.log("\nRule set: created, version 1 written");
  }

  const programs = await db.program.updateMany({
    where: { ruleSetId: null },
    data: { ruleSetId },
  });
  console.log(`Programs given it as their default: ${programs.count}`);

  // ---- The four rubrics, by name --------------------------------------------------------------
  for (const rubric of rubrics) {
    const row = await db.rubric.findUnique({ where: { name: rubric.name }, select: { id: true } });
    if (!row) {
      console.error(
        `No rubric named ${rubric.name}. The seed makes the four rows; run \`npm run db:seed\` ` +
          `first, or check the name in lib/rubrics/port.ts.`,
      );
      process.exit(1);
    }
    const version = await publishRubricVersion(db, {
      rubricId: row.id,
      name: rubric.name,
      ...rubric.text,
      // The program's rule set, which is the one just written.
      ruleSetId: null,
    });
    console.log(
      `Rubric ${rubric.name}: ${version.created ? `version ${version.number} written` : "unchanged"}`,
    );
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
