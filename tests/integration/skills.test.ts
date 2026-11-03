/**
 * Skills: who may write the taxonomies, and what the Skills tabs read from real rows.
 *
 * Run with `npm run test:integration`.
 *
 * The arithmetic is `tests/lib/skills.test.ts`, which runs on every save. What this adds is that
 * the procedures feed it the right rows: the latest approved round of each submission and not an
 * earlier one, a section counting under the skill its assignment names and an untagged one under
 * nothing, a test student left out, the cohort picker narrowing the roster, and the taxonomy read
 * for the program's discipline.
 *
 * The seeded skills are the migration's rows, read by canonical id within the Software
 * Engineering taxonomy, because that is what every database holds.
 */
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAccount, makeAssignment, makeSubmission, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) =>
  factory({ db: tx, user: { id: userId }, viewingAs: null } as never);

/** A number no real deployment will reach, and different from the other suites'. */
const FAKE_NUMBER = 999_004;

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

/** The seeded Software Engineering skills the fixtures tag, by canonical id. */
async function seededSkills(tx: Tx, canonicalIds: string[]): Promise<Map<string, string>> {
  const rows = await tx.skill.findMany({
    where: {
      canonicalId: { in: canonicalIds },
      taxonomy: { discipline: "SOFTWARE_ENGINEERING" },
    },
    select: { id: true, canonicalId: true },
  });
  return new Map(rows.map((row) => [row.canonicalId, row.id]));
}

/** An approved hand-graded draft on a submission, with the given sections, approved at the given instant. */
async function approve(
  tx: Tx,
  params: {
    submissionId: string;
    approvedById: string;
    approvedAt: Date;
    sections: {
      sectionType: string;
      /** What the section was graded as evidence of, as the round stores it. */
      skillId?: string;
      scoreEarned: number;
      scorePossible: number;
      editedScoreEarned?: number;
    }[];
  },
) {
  return tx.gradingDraft.create({
    data: {
      submissionId: params.submissionId,
      status: "APPROVED",
      approvedAt: params.approvedAt,
      approvedById: params.approvedById,
      sections: {
        create: params.sections.map((section) => ({
          sectionKey: section.sectionType.toLowerCase().replace(/_/g, "-"),
          sectionType: section.sectionType,
          skillId: section.skillId ?? null,
          rubricItems: [],
          summaryMarkdown: null,
          reportMarkdown: "Graded by hand.",
          scoreEarned: section.scoreEarned,
          scorePossible: section.scorePossible,
          editedScoreEarned: section.editedScoreEarned ?? null,
          flags: [],
        })),
      },
    },
    select: { id: true },
  });
}

describe("what the Skills tabs read", () => {
  const tx = withRollback();

  let world: World;
  let cohortId: string;
  const ids = { fellow: "", other: "", test: "" };
  const skillIds = { reflection: "", writing: "", python: "" };
  let reflectionId = "";

  const asInstructor = () => createCaller(tx(), world.instructorId);

  beforeAll(async () => {
    world = await makeWorld(tx(), { students: 3 });
    const [fellow, other, test] = world.students;
    ids.fellow = fellow!.studentId;
    ids.other = other!.studentId;
    ids.test = test!.studentId;
    await tx().profile.update({
      where: { id: ids.test },
      data: { testStudentNumber: FAKE_NUMBER },
    });

    const cohort = await tx().cohort.create({
      data: { programId: world.programId, name: "Integration Skills Cohort" },
      select: { id: true },
    });
    cohortId = cohort.id;
    await tx().enrollment.update({ where: { id: fellow!.id }, data: { cohortId } });

    const seeded = await seededSkills(tx(), [
      "self-reflection",
      "technical-writing",
      "python-programming",
    ]);
    skillIds.reflection = seeded.get("self-reflection")!;
    skillIds.writing = seeded.get("technical-writing")!;
    skillIds.python = seeded.get("python-programming")!;

    // A hand-graded reflection: two tagged sections and one that is evidence of nothing.
    const reflection = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Reflection",
      pointValue: 20,
      dueAt: new Date("2026-09-10T23:00:00Z"),
      sections: [
        {
          grading: "manual",
          key: "reflection",
          label: "Reflection",
          pointValue: 10,
          skillId: skillIds.reflection,
        },
        {
          grading: "manual",
          key: "writing",
          label: "Writing",
          pointValue: 5,
          skillId: skillIds.writing,
        },
        { grading: "manual", key: "effort", label: "Effort", pointValue: 5 },
      ],
    });
    reflectionId = reflection.id;
    // A hand-graded exercise approved twice: the earlier round must not be read.
    const exercise = await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Exercise",
      pointValue: 3,
      dueAt: new Date("2026-09-14T23:00:00Z"),
      sections: [
        {
          grading: "manual",
          key: "is-even",
          label: "is_even",
          pointValue: 3,
          skillId: skillIds.python,
        },
      ],
    });

    for (const studentId of [ids.fellow, ids.other, ids.test]) {
      const submission = await makeSubmission(tx(), {
        assignmentId: reflection.id,
        studentId,
        status: "GRADED",
      });
      await approve(tx(), {
        submissionId: submission.id,
        approvedById: world.instructorId,
        approvedAt: new Date("2026-09-11T12:00:00Z"),
        sections: [
          {
            sectionType: "Reflection",
            skillId: skillIds.reflection,
            scoreEarned: 0,
            scorePossible: 10,
            editedScoreEarned: 8,
          },
          { sectionType: "Writing", skillId: skillIds.writing, scoreEarned: 4, scorePossible: 5 },
          { sectionType: "Effort", scoreEarned: 5, scorePossible: 5 },
        ],
      });
    }

    const exerciseSubmission = await makeSubmission(tx(), {
      assignmentId: exercise.id,
      studentId: ids.fellow,
      status: "GRADED",
    });
    await approve(tx(), {
      submissionId: exerciseSubmission.id,
      approvedById: world.instructorId,
      approvedAt: new Date("2026-09-15T12:00:00Z"),
      sections: [
        { sectionType: "is_even", skillId: skillIds.python, scoreEarned: 1, scorePossible: 3 },
      ],
    });
    await approve(tx(), {
      submissionId: exerciseSubmission.id,
      approvedById: world.instructorId,
      approvedAt: new Date("2026-09-18T12:00:00Z"),
      sections: [
        { sectionType: "is_even", skillId: skillIds.python, scoreEarned: 3, scorePossible: 3 },
      ],
    });
  });

  it("counts each section under the skill its assignment names, the edited score, and the latest round", async () => {
    const data = await asInstructor().programs.skills({
      programId: world.programId,
      cohort: "all",
    });
    const fellow = data.fellows.find((row) => row.student.id === ids.fellow)!;

    // The instructor's edited score, not the zero the draft was opened with.
    expect(fellow.figures[skillIds.reflection]).toMatchObject({
      earned: 8,
      possible: 10,
      sections: 1,
    });
    expect(fellow.figures[skillIds.writing]).toMatchObject({ earned: 4, possible: 5, sections: 1 });
    // The second round, not the first.
    expect(fellow.figures[skillIds.python]).toMatchObject({ earned: 3, possible: 3, sections: 1 });
    // The untagged section is nowhere.
    const counted = Object.values(fellow.figures).reduce((sum, figure) => sum + figure.sections, 0);
    expect(counted).toBe(3);
  });

  it("reads the program's discipline's taxonomy, groups in order", async () => {
    const data = await asInstructor().programs.skills({
      programId: world.programId,
      cohort: "all",
    });
    expect(data.groups[0]!.name).toBe("Technical Reasoning");
    expect(data.groups.map((group) => group.name)).toContain("Leadership and Development");
    const all = data.groups.flatMap((group) => group.skills);
    expect(all.some((skill) => skill.id === skillIds.python)).toBe(true);
    // The other discipline's taxonomy is not here, even where a name repeats.
    expect(all.every((skill) => skill.canonicalId !== "data-mining")).toBe(true);
  });

  it("leaves a test student out and honors the cohort picker", async () => {
    const all = await asInstructor().programs.skills({ programId: world.programId, cohort: "all" });
    expect(all.fellows.map((row) => row.student.id).sort()).toEqual([ids.fellow, ids.other].sort());

    const narrowed = await asInstructor().programs.skills({
      programId: world.programId,
      cohort: cohortId,
    });
    expect(narrowed.fellows.map((row) => row.student.id)).toEqual([ids.fellow]);
  });

  it("gives one fellow the same figures and a history in due-date order", async () => {
    const data = await asInstructor().programs.studentSkills({
      programId: world.programId,
      studentId: ids.fellow,
    });
    expect(data.figures[skillIds.reflection]).toMatchObject({ earned: 8, possible: 10 });
    expect(data.history.map((line) => [line.assignmentTitle, line.skillId, line.earned])).toEqual([
      ["Integration Reflection", skillIds.reflection, 8],
      ["Integration Reflection", skillIds.writing, 4],
      ["Integration Exercise", skillIds.python, 3],
    ]);
  });

  it("refuses a fellow who is not on the roster", async () => {
    expect(
      await refusal(() =>
        asInstructor().programs.studentSkills({
          programId: world.programId,
          studentId: world.instructorId,
        }),
      ),
    ).toBe("NOT_FOUND");
  });
  /*
    A round section's skill is what its score was evidence of when it was graded, and re-tagging
    the declaration asks whether that reading should follow. The impact names each changed
    section with how many graded sections carry its key, and the save carries the answer.
  */
  it("re-tagging a section reports its graded rounds, and rewrites them only when asked", async () => {
    const loaded = (await asInstructor().assignments.getDraft({
      assignmentId: reflectionId,
    })) as Record<string, unknown>;
    const retagged = (loaded.sections as Record<string, unknown>[]).map((section) =>
      section.label === "Reflection" ? { ...section, skillId: skillIds.python } : section,
    );
    const draft = {
      kind: loaded.kind,
      title: loaded.title,
      courseUnitId: loaded.courseUnitId,
      answerKeyRepo: loaded.answerKeyRepo,
      answerKeyDir: loaded.answerKeyDir,
      completionThreshold: loaded.completionThreshold,
      dueAt: loaded.dueAt,
      templateRepo: loaded.templateRepo,
      assignmentRepoName: loaded.assignmentRepoName,
      githubOrg: loaded.githubOrg,
      templateRef: loaded.templateRef,
      runnerPreset: loaded.runnerPreset,
      runnerConfig: loaded.runnerConfig,
      templateDriveUrl: loaded.templateDriveUrl,
      studentMayMarkDone: loaded.studentMayMarkDone,
      handInMethods: loaded.handInMethods,
      acceptedFileTypes: loaded.acceptedFileTypes,
      submissionInstructions: loaded.submissionInstructions,
      sections: retagged,
    };

    const impact = await asInstructor().assignments.retagImpact({
      assignmentId: reflectionId,
      sections: retagged,
    });
    expect(impact).toHaveLength(1);
    expect(impact[0]).toMatchObject({ label: "Reflection" });
    expect(impact[0]!.gradedSections).toBeGreaterThan(0);
    const graded = impact[0]!.gradedSections;
    const underPython = () =>
      tx().gradingDraftSection.count({
        where: {
          sectionKey: "reflection",
          skillId: skillIds.python,
          gradingDraft: { submission: { assignmentId: reflectionId } },
        },
      });

    // Kept as graded: the declaration changes, the rounds do not.
    await asInstructor().assignments.update({
      assignmentId: reflectionId,
      draft,
      retagRounds: false,
    });
    expect(await underPython()).toBe(0);

    // Applied: every round section under the key follows the new tag, and so do the figures.
    const again = await asInstructor().assignments.retagImpact({
      assignmentId: reflectionId,
      sections: retagged,
    });
    expect(again).toEqual([]);
    const back = retagged.map((section) =>
      section.label === "Reflection" ? { ...section, skillId: skillIds.reflection } : section,
    );
    await asInstructor().assignments.update({
      assignmentId: reflectionId,
      draft: { ...draft, sections: back },
      retagRounds: true,
    });
    expect(
      await tx().gradingDraftSection.count({
        where: {
          sectionKey: "reflection",
          skillId: skillIds.reflection,
          gradingDraft: { submission: { assignmentId: reflectionId } },
        },
      }),
    ).toBe(graded);
  });
});

describe("who may write the taxonomies", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;
  let taxonomyId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    adminId = await makeAccount(tx(), { role: "ADMIN" });
    const taxonomy = await tx().skillTaxonomy.findUniqueOrThrow({
      where: { discipline: "SOFTWARE_ENGINEERING" },
      select: { id: true },
    });
    taxonomyId = taxonomy.id;
  });

  it("an instructor is refused every write, and the read", async () => {
    const instructor = createCaller(tx(), world.instructorId);
    expect(await refusal(() => instructor.skills.all())).toBe("FORBIDDEN");
    expect(await refusal(() => instructor.skills.addGroup({ taxonomyId, name: "No" }))).toBe(
      "FORBIDDEN",
    );
  });

  it("an admin adds a group at the end, renames it, fills it, and empties it before deleting it", async () => {
    const admin = createCaller(tx(), adminId);
    const swe = () => admin.skills.all().then((all) => all.find((t) => t.id === taxonomyId)!);

    const before = await swe();
    const group = await admin.skills.addGroup({ taxonomyId, name: "Integration Group" });
    const after = await swe();
    expect(after.groups.length).toBe(before.groups.length + 1);
    expect(after.groups[after.groups.length - 1]!.id).toBe(group.id);

    await admin.skills.renameGroup({ groupId: group.id, name: "Integration Group Renamed" });
    expect((await swe()).groups.find((g) => g.id === group.id)!.name).toBe(
      "Integration Group Renamed",
    );

    const skill = await admin.skills.addSkill({
      groupId: group.id,
      canonicalId: "integration-debugging",
      name: "Integration Debugging",
      definition: "Finding the cause.",
    });
    expect((await swe()).groups.find((g) => g.id === group.id)!.skills).toEqual([
      expect.objectContaining({ id: skill.id, canonicalId: "integration-debugging" }),
    ]);

    await admin.skills.saveSkill({
      skillId: skill.id,
      canonicalId: "integration-debugging-code",
      name: "Integration Debugging Code",
      definition: "",
    });
    const saved = (await swe()).groups.find((g) => g.id === group.id)!.skills[0]!;
    expect(saved).toMatchObject({
      name: "Integration Debugging Code",
      canonicalId: "integration-debugging-code",
      definition: "",
    });

    // Full, so refused; then emptied, so allowed.
    expect(await refusal(() => admin.skills.removeGroup({ groupId: group.id }))).toBe(
      "PRECONDITION_FAILED",
    );
    await admin.skills.removeSkill({ skillId: skill.id });
    await admin.skills.removeGroup({ groupId: group.id });
    expect((await swe()).groups.some((g) => g.id === group.id)).toBe(false);
  });

  it("refuses a canonical id already in the taxonomy, and a malformed one", async () => {
    const admin = createCaller(tx(), adminId);
    const group = (await admin.skills.all()).find((t) => t.id === taxonomyId)!.groups[0]!;
    expect(
      await refusal(() =>
        admin.skills.addSkill({
          groupId: group.id,
          canonicalId: "python-programming",
          name: "Python again",
          definition: "",
        }),
      ),
    ).toBe("CONFLICT");
    expect(
      await refusal(() =>
        admin.skills.addSkill({
          groupId: group.id,
          canonicalId: "Python Programming",
          name: "Python again",
          definition: "",
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  // Deleting it would drop every section tagged with it from the tabs without anybody deciding to.
  it("refuses to delete a skill an assignment's section names", async () => {
    const admin = createCaller(tx(), adminId);
    const seeded = await seededSkills(tx(), ["reading-a-traceback"]);
    const skillId = seeded.get("reading-a-traceback")!;
    await makeAssignment(tx(), {
      courseId: world.courseId,
      courseUnitId: world.unitId,
      title: "Integration Tagged",
      pointValue: 3,
      sections: [
        { grading: "manual", key: "traceback", label: "Traceback", pointValue: 3, skillId },
      ],
    });
    expect(await refusal(() => admin.skills.removeSkill({ skillId }))).toBe("PRECONDITION_FAILED");
  });
});
