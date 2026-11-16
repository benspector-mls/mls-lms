import "server-only";

import { db } from "../prisma";
import type { GradingDraft } from "../generated/prisma/client";
import { generateDocumentReportForSubmission } from "./generate-document-report";
import { generateReportForSubmission, ReportGenerationError } from "./generate-report";

/**
 * A report for one submission, by whichever path its assignment's kind calls for.
 *
 * A repository assignment is graded from its pull request; every other kind is graded from the
 * links and files the fellow handed in. The two generators share nothing a caller needs to know
 * about, so this is the one name the review screen, the batch and the script call.
 */
export async function generateReportFor(submissionId: string): Promise<GradingDraft> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: { assignment: { select: { kind: true } } },
  });
  if (!submission) throw new ReportGenerationError(`No submission ${submissionId}.`);

  return submission.assignment.kind === "REPO"
    ? generateReportForSubmission(submissionId)
    : generateDocumentReportForSubmission(submissionId);
}
