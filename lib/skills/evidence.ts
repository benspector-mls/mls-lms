import "server-only";

import type { Tx } from "../prisma";
import type { SkillEvidence } from "../skills";

/**
 * Reading the evidence the Skills tabs are computed from: every approved section of every
 * released assignment of a program, for the fellows asked about.
 *
 * **The latest approved round of each submission**, because that is the grade `approveDraft`
 * wrote into `finalScore`; an earlier round of a resubmission is history, not standing. **The
 * instructor's rows where they edited and the model's where they did not**, by the same `??`
 * rule `effectiveSection` is written around, so a score corrected in the review screen is the
 * score read here. **A section carries its own skill**: the round section stores the skill its
 * declared section was tagged with when the round was created, and re-tagging offers to rewrite
 * it, so a section counts toward what it was graded as evidence of even after the declaration
 * changes or loses the key.
 *
 * **A team's draft reaches every member.** A mirror row holds no drafts of its own — approval
 * copies the grade onto each mirror and the drafts hang off the team row — so a mirror's
 * evidence is read from the row its `teamSubmissionId` names and recorded under the mirror's own
 * student.
 *
 * Three reads for a whole roster, then joined in memory, in the manner of `programs.performance`:
 * one query per fellow would be the same arithmetic at a round trip each.
 */
export async function loadSkillEvidence(
  db: Tx,
  params: { programId: string; studentIds: readonly string[] },
): Promise<SkillEvidence[]> {
  if (params.studentIds.length === 0) return [];

  const assignments = await db.assignment.findMany({
    where: {
      course: { programId: params.programId, publishedAt: { not: null } },
      distributedAt: { not: null },
      dueAt: { not: null },
    },
    select: { id: true, title: true, courseId: true, dueAt: true },
  });
  if (assignments.length === 0) return [];
  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));

  const submissions = await db.submission.findMany({
    where: {
      assignmentId: { in: assignments.map((assignment) => assignment.id) },
      studentId: { in: [...params.studentIds] },
    },
    select: { id: true, assignmentId: true, studentId: true, teamSubmissionId: true },
  });
  if (submissions.length === 0) return [];

  // The rows that hold drafts: a submission's own, or its team's.
  const holders = [...new Set(submissions.map((s) => s.teamSubmissionId ?? s.id))];
  // When each submission was last approved, then those rounds alone: earlier rounds of a
  // resubmission are history, and their sections never leave the database.
  const latest = await db.gradingDraft.groupBy({
    by: ["submissionId"],
    where: { submissionId: { in: holders }, approvedAt: { not: null } },
    _max: { approvedAt: true },
  });
  const latestAt = latest.flatMap((row) =>
    row._max.approvedAt
      ? [{ submissionId: row.submissionId, approvedAt: row._max.approvedAt }]
      : [],
  );
  if (latestAt.length === 0) return [];
  const drafts = await db.gradingDraft.findMany({
    where: { OR: latestAt },
    orderBy: { approvedAt: "desc" },
    select: {
      submissionId: true,
      flags: true,
      sections: {
        select: {
          skillId: true,
          sectionType: true,
          scoreEarned: true,
          editedScoreEarned: true,
          scorePossible: true,
          flags: true,
        },
      },
    },
  });
  // One per submission even if two rounds were approved in the same instant.
  const latestByHolder = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    if (!latestByHolder.has(draft.submissionId)) latestByHolder.set(draft.submissionId, draft);
  }

  const evidence: SkillEvidence[] = [];
  for (const submission of submissions) {
    const draft = latestByHolder.get(submission.teamSubmissionId ?? submission.id);
    const assignment = assignmentById.get(submission.assignmentId);
    if (!draft || !assignment || assignment.dueAt === null) continue;

    for (const section of draft.sections) {
      evidence.push({
        studentId: submission.studentId,
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        courseId: assignment.courseId,
        // The mirror's own row for a teammate, which is the row the fellow's page lists.
        submissionId: submission.id,
        dueAt: assignment.dueAt,
        sectionType: section.sectionType,
        scoreEarned: section.editedScoreEarned ?? section.scoreEarned,
        scorePossible: section.scorePossible,
        // The round's flags, and the section's own on a round written before flags were the
        // round's.
        flags: [...draft.flags, ...section.flags],
        skillId: section.skillId,
      });
    }
  }
  return evidence;
}
