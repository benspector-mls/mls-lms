import "server-only";

import { db } from "../prisma";
import { readSections } from "../assignments/spec";
import { parseDriveDocUrl } from "../drive/embed";
import type { GradingDraft } from "../generated/prisma/client";
import { getConfiguredInstallationId } from "../github/app-client";
import {
  fetchRepoFile,
  MAX_FETCHED_FILE_BYTES,
  readRepoSnapshot,
  RepoSnapshotError,
} from "../github/files";
import { exportPrivateDocMarkdown, exportPublicDoc, GoogleDocError } from "../google/docs";
import { readSubmissionUpload } from "../uploads/storage";
import { GradingAssetsError, loadGradingAssets } from "./assets";
import { crossCheck } from "./cross-check";
import { effectiveSection } from "./delivery";
import {
  isGithubUrl,
  parseGithubRepoUrl,
  partFromUpload,
  selectRepoFiles,
  withinTotal,
  type DocumentPart,
  type Refusal,
} from "./document-parts";
import { claimRun, ReportGenerationError } from "./generate-report";
import { buildDocumentUserPrompt, buildSystemPrompt, type PreviousReview } from "./prompts";
import { getReportGenerator, ProviderError, type Attachment } from "./provider";
import { composeReport, rowTotals } from "./report-text";
import { ReportValidationError } from "./schema";

/**
 * Generating a grading draft for a submission with no repository.
 *
 * **Its own function rather than a branch of `generateReportForSubmission`**, because the two
 * share a shape and almost no steps. That one runs tests, reads a pull request's changed files,
 * classifies them into sections and diffs against the previous review's commit. This one reads
 * the links and files the fellow attached — a Google Doc as markdown, a Slides deck or a PDF as
 * a document the model is handed, an image as an image, a public GitHub repository as its files
 * and commit history at the last commit before the hand-in — and grades the whole against the one
 * rubric the assignment's document section names. What they share is reached through the same
 * functions: the claim, the assets, the system prompt, the cross-check, the composed report.
 *
 * **A document that cannot be read is told to the instructor, not swallowed.** A Word file, a
 * Sheet, a link to Canva: each is recorded as refused by name, the model is told what it was not
 * shown, and the draft carries the list in `errorDetail`. A submission with nothing readable at
 * all fails, with each refusal named, because a report on nothing is a score on nothing.
 */

const SECTION_TYPE = "document";

export async function generateDocumentReportForSubmission(
  submissionId: string,
): Promise<GradingDraft> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      lastActivityAt: true,
      teamSubmissionId: true,
      student: { select: { githubUsername: true } },
      team: { select: { name: true } },
      mirrors: { select: { student: { select: { githubUsername: true } } } },
      artifacts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          url: true,
          createdAt: true,
          uploadPath: true,
          uploadFilename: true,
          uploadContentType: true,
        },
      },
      assignment: {
        select: {
          title: true,
          kind: true,
          sections: true,
          submissionInstructions: true,
          exemplarDocUrl: true,
          answerKeyDocUrl: true,
          course: { select: { programId: true } },
        },
      },
    },
  });

  if (!submission) throw new ReportGenerationError(`No submission ${submissionId}.`);

  if (submission.teamSubmissionId !== null) {
    throw new ReportGenerationError(
      `Submission ${submissionId} is one member's copy of their team's work, so it is not what ` +
        `gets graded. Generate the report on the team's own submission.`,
    );
  }
  if (submission.assignment.kind === "REPO") {
    throw new ReportGenerationError(
      `Submission ${submissionId} is a repository assignment, which is graded from its pull request.`,
    );
  }

  const sections = readSections(submission.assignment.sections);
  const section = sections.find(
    (candidate) => candidate.grading === "ai" && candidate.type === SECTION_TYPE,
  );
  if (!section) {
    throw new ReportGenerationError(
      `Every section of "${submission.assignment.title}" is graded by hand, so there is no ` +
        `report to generate. Score it in the review screen instead.`,
    );
  }
  const pointValue = section.pointValue;
  const rubricId = section.rubricId;
  if (typeof pointValue !== "number" || typeof rubricId !== "string") {
    throw new ReportGenerationError(
      `The section of "${submission.assignment.title}" the model grades names no point value ` +
        `or no rubric. Open the assignment and save it again.`,
    );
  }

  if (submission.artifacts.length === 0) {
    throw new ReportGenerationError(
      `Submission ${submissionId} has nothing handed in yet, so there is nothing to grade.`,
    );
  }

  // ---- What was handed in, as parts the prompt can carry ----------------------------------
  const parts: DocumentPart[] = [];
  const refused: Refusal[] = [];
  const repositories: RepositoryRead[] = [];

  for (const artifact of submission.artifacts) {
    if (artifact.kind === "LINK") {
      const label = artifact.url ?? `link ${artifact.id}`;

      const repoRef = artifact.url ? parseGithubRepoUrl(artifact.url) : null;
      if (repoRef) {
        // The same repository attached twice would be sent twice under identical labels.
        if (repositories.some((read) => read.repository === `${repoRef.owner}/${repoRef.repo}`)) {
          continue;
        }
        // The later of the two, because declaring work ready again moves `lastActivityAt` and
        // leaves the link as it was: a resubmission is graded at the commit the fellow resubmitted.
        const handedInAt =
          submission.lastActivityAt && submission.lastActivityAt > artifact.createdAt
            ? submission.lastActivityAt
            : artifact.createdAt;
        try {
          const read = await readRepository(repoRef, handedInAt);
          parts.push(...read.parts);
          refused.push(...read.refused);
          repositories.push(read.record);
        } catch (err) {
          if (err instanceof RepoSnapshotError) {
            refused.push({ label, reason: err.message });
          } else {
            // GitHub being unreachable or limiting requests says nothing about the fellow's work,
            // and grading without the repository would score its absence. Fail before a draft
            // exists so pressing Generate again is the whole fix.
            throw new ReportGenerationError(
              `GitHub could not be read for ${label}: ` +
                `${err instanceof Error ? err.message : String(err)}. Try again in a few minutes.`,
            );
          }
        }
        continue;
      }
      if (artifact.url && isGithubUrl(artifact.url)) {
        refused.push({
          label,
          reason:
            "a link to a page inside a GitHub repository; the link has to be the repository itself",
        });
        continue;
      }

      const ref = artifact.url ? parseDriveDocUrl(artifact.url) : null;
      if (!ref) {
        refused.push({ label, reason: "not a Google Doc, Slides deck or Drive file" });
        continue;
      }
      try {
        const exported = await exportPublicDoc(ref);
        parts.push(
          exported.kind === "text"
            ? { label, kind: "text", text: exported.text }
            : { label, kind: exported.kind, mediaType: exported.mediaType, data: exported.data },
        );
      } catch (err) {
        refused.push({
          label,
          reason: err instanceof GoogleDocError ? err.message : String(err),
        });
      }
      continue;
    }

    if (!artifact.uploadPath || !artifact.uploadFilename) {
      refused.push({ label: `file ${artifact.id}`, reason: "the upload has no stored object" });
      continue;
    }
    try {
      const part = partFromUpload({
        filename: artifact.uploadFilename,
        contentType: artifact.uploadContentType,
        bytes: await readSubmissionUpload(artifact.uploadPath),
      });
      if ("refused" in part) refused.push(part.refused);
      else parts.push(part);
    } catch (err) {
      refused.push({
        label: artifact.uploadFilename,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (parts.length === 0) {
    throw new ReportGenerationError(
      `Nothing the student handed in could be read: ` +
        refused.map((item) => `${item.label} (${item.reason})`).join("; ") +
        `. Grade this one by hand.`,
    );
  }
  if (!withinTotal(parts)) {
    throw new ReportGenerationError(
      "The files handed in are together larger than one request may carry. Grade this one by hand.",
    );
  }

  // ---- The review the student last received, if this is a resubmission ------------------
  //
  // A round counts as the previous review when it was released before the latest hand-in: the
  // student read it, then handed in again. A regeneration with no hand-in since the last release
  // is graded as a first submission, as the repository path does for a round at the same commit.
  const releasedRounds = await db.gradingDraft.findMany({
    where: { submissionId: submission.id, status: "APPROVED" },
    orderBy: { approvedAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      sections: {
        where: { sectionType: SECTION_TYPE },
        select: {
          sectionType: true,
          reportMarkdown: true,
          scoreEarned: true,
          scorePossible: true,
          editedReportMarkdown: true,
          editedScoreEarned: true,
        },
      },
    },
  });
  const latestRound = releasedRounds.at(-1);
  const previousRound =
    latestRound &&
    submission.lastActivityAt !== null &&
    latestRound.createdAt < submission.lastActivityAt
      ? { ...latestRound, number: releasedRounds.length }
      : null;

  const draft = await claimRun(db, submission.id, null);
  const reviewReasons: string[] = [];

  try {
    const assets = await loadGradingAssets({
      rubricId,
      programId: submission.assignment.course.programId,
      answerKeyRepo: null,
      answerKeyDir: null,
    });

    // ---- The two reference documents, each tolerated when it has gone away ----------------
    //
    // Both were readable when the assignment was saved; one unshared since is an instructor's
    // doing, told to them here rather than a failed run. The prompt already lowers confidence
    // when it has no reference.
    let exemplar: { text: string; sha: string } | null = null;
    let answerKey: { text: string; sha: string; revision: string | null } | null = null;

    if (submission.assignment.exemplarDocUrl) {
      const ref = parseDriveDocUrl(submission.assignment.exemplarDocUrl);
      try {
        const exported = ref ? await exportPublicDoc(ref) : null;
        if (exported?.kind === "text") {
          exemplar = { text: exported.text, sha: exported.contentSha256 };
        } else {
          reviewReasons.push(
            "The exemplar could not be read as text, so the model was not shown it.",
          );
        }
      } catch (err) {
        reviewReasons.push(
          `The exemplar could not be read, so the model was not shown it: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (submission.assignment.answerKeyDocUrl) {
      const ref = parseDriveDocUrl(submission.assignment.answerKeyDocUrl);
      try {
        if (!ref) throw new GoogleDocError("not a Google Doc link");
        const exported = await exportPrivateDocMarkdown(ref.fileId);
        answerKey = {
          text: exported.markdown,
          sha: exported.contentSha256,
          revision: exported.headRevisionId,
        };
      } catch (err) {
        reviewReasons.push(
          `The answer key could not be read, so the model graded without it: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const previousSection = previousRound?.sections[0];
    const previousReview: PreviousReview | null =
      previousRound && previousSection
        ? {
            number: previousRound.number,
            headSha: null,
            ...effectiveSection(previousSection),
            // No commits to compare, so no diff: the model judges what changed by reading the
            // previous review against the work above.
            changes: null,
          }
        : null;

    const attachments: Attachment[] = parts.flatMap((part) =>
      part.kind === "text"
        ? []
        : [{ label: part.label, mediaType: part.mediaType, data: part.data }],
    );

    const generator = await getReportGenerator();
    const response = await generator.generate({
      system: buildSystemPrompt({ assets }),
      user: buildDocumentUserPrompt({
        context: {
          addressees: [
            { githubUsername: submission.student.githubUsername },
            ...submission.mirrors.map((mirror) => ({
              githubUsername: mirror.student.githubUsername,
            })),
          ],
          teamName: submission.team?.name ?? null,
          assignmentTitle: submission.assignment.title,
          pointValue,
          instructions: submission.assignment.submissionInstructions,
          exemplar: exemplar?.text ?? null,
          answerKey: answerKey?.text ?? null,
          parts: parts.map((part) =>
            part.kind === "text"
              ? { label: part.label, kind: "text", text: part.text }
              : { label: part.label, kind: part.kind },
          ),
          refused,
          previousReview,
        },
      }),
      attachments,
    });

    const check = crossCheck(response.output, { tests: null, tamperedPaths: [], pointValue });
    const totals = rowTotals(response.output.rubricItems);

    await db.gradingDraftSection.create({
      data: {
        gradingDraftId: draft.id,
        sectionType: SECTION_TYPE,
        summaryMarkdown: response.output.summaryMarkdown,
        reportMarkdown: composeReport({
          sectionType: SECTION_TYPE,
          summaryMarkdown: response.output.summaryMarkdown,
          rows: response.output.rubricItems,
        }),
        scoreEarned: totals.earned,
        scorePossible: totals.possible,
        rubricItems: response.output.rubricItems,
        flags: [...response.output.flags, ...check.findings.map((finding) => finding.code)],
        instructorNotes: response.output.instructorNotes,
        confidence: response.output.confidence === "low" ? "LOW" : "HIGH",
        submissionProcessNote: response.output.submissionProcessNote,
        rubricVersionId: assets.rubricVersionId,
        ruleSetVersionId: assets.ruleSetVersionId,
      },
    });

    for (const finding of check.findings) {
      reviewReasons.push(`${SECTION_TYPE}: ${finding.detail}`);
    }
    if (refused.length > 0) {
      reviewReasons.push(
        `Not read by the model: ` +
          refused.map((item) => `${item.label} (${item.reason})`).join("; ") +
          ".",
      );
    }

    return await db.gradingDraft.update({
      where: { id: draft.id },
      data: {
        status: "READY",
        errorDetail: reviewReasons.length > 0 ? reviewReasons.join("\n") : null,
        modelMetadata: {
          provider: generator.name,
          promptVersion: PROMPT_VERSION,
          usage: {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            cachedPromptTokens: response.usage.cachedPromptTokens ?? 0,
            cacheWriteTokens: response.usage.cacheWriteTokens ?? 0,
          },
          sectionsGraded: [SECTION_TYPE],
          // What the model was shown, by content hash, so a report traces to the exact text of
          // a document that may have been edited since.
          exemplar: exemplar ? { contentSha256: exemplar.sha } : null,
          answerKeyDoc: answerKey
            ? { headRevisionId: answerKey.revision, contentSha256: answerKey.sha }
            : null,
          artifacts: [
            ...parts.map((part) => ({ label: part.label, read: true, kind: part.kind })),
            ...refused.map((item) => ({ label: item.label, read: false, reason: item.reason })),
          ],
          // The commit each repository was read at. The link alone cannot say, because the
          // repository has kept changing since.
          repositories,
          previousRound: previousRound ? { id: previousRound.id } : null,
        },
      },
    });
  } catch (err) {
    const detail =
      err instanceof ProviderError ||
      err instanceof ReportValidationError ||
      err instanceof GradingAssetsError ||
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);

    return await db.gradingDraft.update({
      where: { id: draft.id },
      data: { status: "FAILED", errorDetail: detail },
    });
  }
}

/** What `modelMetadata` records about one repository the model was shown. */
type RepositoryRead = { repository: string; branch: string; commitSha: string; filesSent: number };

/**
 * A repository a fellow handed in by link, as the parts a prompt can carry.
 *
 * One text part per file, labeled with its path, so the model reads `menu.py` as `menu.py`. Then
 * one more part holding the branch names and the commit list, because a rubric may score how the
 * work was made (small, frequent commits; a branch kept apart from the one that is always
 * working), and the files at one commit cannot show that.
 */
async function readRepository(
  ref: { owner: string; repo: string },
  handedInAt: Date,
): Promise<{ parts: DocumentPart[]; refused: Refusal[]; record: RepositoryRead }> {
  const installationId = getConfiguredInstallationId();
  const snapshot = await readRepoSnapshot(installationId, { ...ref, before: handedInAt });
  const name = `${ref.owner}/${ref.repo}`;

  const selection = selectRepoFiles(snapshot.files, MAX_FETCHED_FILE_BYTES);
  const refused: Refusal[] = selection.refused.map((item) => ({
    ...item,
    label: `${name}/${item.label}`,
  }));
  if (snapshot.truncated) {
    refused.push({ label: name, reason: "GitHub listed only part of the repository's files" });
  }

  // Ten at a time, because GitHub answers a burst of simultaneous requests by refusing them, and
  // a batch of submissions graded together would otherwise send hundreds at once.
  const contents: (string | null)[] = [];
  for (let start = 0; start < selection.kept.length; start += 10) {
    const batch = selection.kept.slice(start, start + 10);
    contents.push(
      ...(await Promise.all(
        batch.map((path) =>
          fetchRepoFile(installationId, { ...ref, ref: snapshot.commitSha, path }),
        ),
      )),
    );
  }
  // `fetchRepoFile` answers every failure with null. One missing file is a file; every file
  // missing is GitHub refusing the requests, and grading would score an empty repository.
  if (contents.length > 0 && contents.every((text) => text === null)) {
    throw new Error(`GitHub returned none of the ${contents.length} files it listed`);
  }

  const parts: DocumentPart[] = [];
  selection.kept.forEach((path, index) => {
    const text = contents[index];
    const label = `${name}/${path}`;
    if (text === null) {
      refused.push({ label, reason: "GitHub did not return the file" });
    } else if (text.includes("\u0000")) {
      // An image or other binary file decodes to text full of NUL characters, which the model
      // would read as noise rather than as the file.
      refused.push({ label, reason: "not a text file" });
    } else {
      parts.push({ label, kind: "text", text });
    }
  });

  const handedIn = handedInAt.toISOString().replace("T", " ").slice(0, 16);
  const commitLines = snapshot.commits.map(
    (commit) =>
      `- ${commit.date.replace("T", " ").slice(0, 16)} UTC ${commit.sha.slice(0, 7)} ${commit.message}`,
  );
  parts.push({
    label: `${name}: commit history and branches`,
    kind: "text",
    text: [
      `Branches in the repository now, which may include ones created after the hand-in: ` +
        `${snapshot.branches.join(", ")}.`,
      ``,
      `The files above are from commit ${snapshot.commitSha.slice(0, 7)}, the last commit on ` +
        `${snapshot.branch} before the work was handed in at ${handedIn} UTC.`,
      ``,
      `Commits on ${snapshot.branch} up to that commit, newest first` +
        (snapshot.commits.length === 100 ? " (the most recent 100 only)" : "") +
        `:`,
      ...commitLines,
    ].join("\n"),
  });

  return {
    parts,
    refused,
    record: {
      repository: name,
      branch: snapshot.branch,
      commitSha: snapshot.commitSha,
      filesSent: parts.length - 1,
    },
  };
}

/**
 * The document prompt's own version, recorded on every draft it writes. Separate from the
 * repository prompt's because the two change independently.
 */
// `document-2026-11-16.1` can carry a GitHub repository's files and its commit history.
const PROMPT_VERSION = "document-2026-11-16.1";
