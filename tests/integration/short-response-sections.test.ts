/**
 * A short response is its questions and one writing section, and releasing a round records them
 * all as one grade.
 *
 * Run with `npm run test:integration`.
 *
 * The pipeline writes one section per declared question and one for the writing score, each
 * carrying its declared key (`tests/lib/grade/cross-check.test.ts` covers what it refuses). What
 * this adds is the other end: a round holding those sections is approved as one grade whose score
 * is their sum, whose completion is judged against that sum, and whose feedback is one document
 * composed from the round's summary and every section in declared order, under the headings the
 * assignment declares. Nothing here reaches GitHub or a model.
 */
import { approveDraft } from "@/lib/grade/approve";

import { makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
import { withRollback } from "./transaction";

const rubricId = "6f1d2c2e-1111-4c4c-8a8a-aaaaaaaaaaaa";

describe("approving a short response graded as keyed sections", () => {
  const tx = withRollback();

  let world: World;
  let submissionId: string;
  let draftId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    const assignment = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      pointValue: 9,
      sections: [
        { grading: "ai", key: "q1", label: "Question 1: let and const", type: "short_response", pointValue: 3, rubricId },
        { grading: "ai", key: "q2", label: "Question 2: hoisting", type: "short_response", pointValue: 3, rubricId },
        { grading: "ai", key: "writing", label: "Writing Quality", type: "short_response_writing", pointValue: 3, rubricId },
      ],
    });
    const submission = await makeSubmission(tx(), {
      assignmentId: assignment.id,
      studentId: world.student.studentId,
      status: "SUBMITTED",
    });
    submissionId = submission.id;

    const draft = await tx().gradingDraft.create({
      data: {
        submissionId: submission.id,
        status: "READY",
        summaryMarkdown: "Clear answers, one concept short.",
        flags: ["UNDERSTANDING", "MECHANICAL"],
        confidence: "HIGH",
        sections: {
          create: [
            // Stored writing first on purpose: the release reads them in the declared order.
            {
              sectionKey: "writing",
              label: "Writing Quality",
              sectionType: "short_response_writing",
              reportMarkdown: "- Proofreading Note: two run-on sentences.",
              scoreEarned: 2,
              scorePossible: 3,
            },
            {
              sectionKey: "q1",
              label: "Question 1: let and const",
              sectionType: "short_response",
              reportMarkdown: "- Praise: both scopes named.",
              scoreEarned: 3,
              scorePossible: 3,
            },
            {
              sectionKey: "q2",
              label: "Question 2: hoisting",
              sectionType: "short_response",
              reportMarkdown: "- Accuracy: the temporal dead zone is not named.",
              scoreEarned: 2,
              scorePossible: 3,
              modelReasoning: "One missing concept.",
            },
          ],
        },
      },
      select: { id: true },
    });
    draftId = draft.id;
  });

  it("records the sections' sum as the grade, judges completion against it, and composes one document", async () => {
    await approveDraft({ draftId, approvedByProfileId: world.instructorId, client: tx() });

    const submission = await tx().submission.findUniqueOrThrow({
      where: { id: submissionId },
      select: {
        finalScore: true,
        finalScorePossible: true,
        isComplete: true,
        feedbackMarkdown: true,
      },
    });
    expect([submission.finalScore, submission.finalScorePossible]).toEqual([7, 9]);
    expect(submission.isComplete).toBe(true);
    expect(submission.feedbackMarkdown).toBe(
      [
        "# Short Response Score Report: 7/9 = 78%",
        "",
        "Clear answers, one concept short.",
        "",
        "---",
        "",
        "## Question 1: let and const: 3/3",
        "",
        "- Praise: both scopes named.",
        "",
        "## Question 2: hoisting: 2/3",
        "",
        "- Accuracy: the temporal dead zone is not named.",
        "",
        "## Writing Quality: 2/3",
        "",
        "- Proofreading Note: two run-on sentences.",
      ].join("\n"),
    );
  });
});
