/**
 * Generates a grading draft for one submission, from the terminal.
 *
 *   npm run grade                      # most recently active submission
 *   npm run grade -- <repo-full-name>
 *   npm run grade -- <submission-id>
 *
 * Calls the same function the tRPC mutation will call. Needs
 * --conditions=react-server, as the modules it reaches import "server-only".
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function main() {
  const { db } = await import("../lib/prisma");
  const { generateReportForSubmission } = await import("../lib/grade/generate-report");

  const target = process.argv[2];
  const isUuid = target && /^[0-9a-f-]{36}$/i.test(target);

  // A substring match rather than an exact one, because a submission repository is
  // named "<template>-<github-login>" and the interesting half to type is the
  // template.
  const submission = target
    ? await db.submission.findFirst({
        where: isUuid ? { id: target } : { repoFullName: { contains: target } },
        orderBy: { lastActivityAt: "desc" },
        select: { id: true, repoFullName: true, headSha: true },
      })
    : await db.submission.findFirst({
        where: { headSha: { not: null } },
        orderBy: { lastActivityAt: "desc" },
        select: { id: true, repoFullName: true, headSha: true },
      });

  if (!submission) {
    console.error(target ? `No submission matching "${target}".` : "No submission with a commit.");
    const available = await db.submission.findMany({
      orderBy: { lastActivityAt: "desc" },
      select: { repoFullName: true, headSha: true },
    });
    if (available.length > 0) {
      console.error("\nSubmissions on record:");
      for (const row of available) {
        console.error(`  ${row.repoFullName} @ ${row.headSha?.slice(0, 7) ?? "no commit"}`);
      }
    }
    process.exit(1);
  }

  console.log(`Submission  ${submission.repoFullName} @ ${submission.headSha?.slice(0, 7)}`);
  console.log(`Provider    ${process.env.GRADING_LLM_PROVIDER ?? "groq"}\n`);

  const startedAt = Date.now();
  const draft = await generateReportForSubmission(submission.id);
  const wall = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`── ${draft.status} in ${wall}s ${"─".repeat(30)}`);
  if (draft.modelMetadata) console.log(JSON.stringify(draft.modelMetadata, null, 2));
  if (draft.errorDetail) console.log(`\nReview reasons / error:\n${draft.errorDetail}`);

  const sections = await db.gradingDraftSection.findMany({
    where: { gradingDraftId: draft.id },
    select: {
      sectionType: true, scoreEarned: true, scorePossible: true,
      confidence: true, flags: true, reportMarkdown: true, instructorNotes: true,
    },
  });

  for (const section of sections) {
    console.log(`\n${"═".repeat(70)}`);
    console.log(`${section.sectionType}: ${section.scoreEarned}/${section.scorePossible}` +
      `  confidence=${section.confidence}  flags=[${section.flags.join(", ")}]`);
    console.log(`${"═".repeat(70)}`);
    // Printed above the report rather than below it, because these are the reasons the
    // score below might not be trustworthy.
    for (const note of section.instructorNotes) console.log(`  note: ${note}`);
    console.log();
    console.log(section.reportMarkdown ?? "(no report)");
  }

  await db.$disconnect();
  process.exit(draft.status === "FAILED" ? 1 : 0);
}

main().catch((err) => { console.error("\n", err); process.exit(1); });
