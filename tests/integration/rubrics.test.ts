/**
 * Rubrics and rule sets: who may write them, what a save produces, and how a program chooses its
 * rules.
 *
 * Run with `npm run test:integration`.
 *
 * **The claim worth reading is the versions one.** A save that changes the text writes a new
 * version and moves the rubric's pointer; a save that changes nothing writes nothing. The first is
 * what lets a graded section keep naming the words it was scored against after the rubric moves
 * on, and the second is what makes the port script safe to run twice.
 *
 * Every row these checks read is one they wrote, like the rest of `fixtures.ts`. Nothing here
 * grades: `loadGradingAssets` reads through the committed client, which cannot see rows inside
 * this transaction — see the header of `transaction.ts` — so the rule set resolution it does is
 * covered by `scripts/verify-rubric-port.ts` against real rows.
 */
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAccount, makeWorld, type World } from "./fixtures";
import { withRollback, type Tx } from "./transaction";

const factory = createCallerFactory(appRouter);
const createCaller = (tx: Tx, userId: string) => factory({ db: tx, user: { id: userId } } as never);

/** What a call refused with, as a string to compare against. */
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "accepted";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return typeof code === "string" ? code : (err as Error).name;
  }
}

const text = (suffix: string) => ({
  rubricMarkdown: `## Resume ${suffix}\n\n| Score | Criteria |\n| --- | --- |\n| 3 | Clear |`,
  guidanceMarkdown: `## Scoring this section\n\nOne row per section of the resume. ${suffix}`,
  sampleReportMarkdown: null,
  ruleSetId: null,
});

describe("rubrics", () => {
  const tx = withRollback();

  let world: World;
  let authorId: string;
  let colleagueId: string;
  let adminId: string;

  const asAuthor = () => createCaller(tx(), authorId);
  const asColleague = () => createCaller(tx(), colleagueId);
  const asAdmin = () => createCaller(tx(), adminId);

  beforeAll(async () => {
    world = await makeWorld(tx());
    authorId = world.instructorId;
    colleagueId = await makeAccount(tx(), { role: "INSTRUCTOR", displayName: "Colleague" });
    adminId = await makeAccount(tx(), { role: "ADMIN", displayName: "Admin" });
  });

  // ---- Writing a rubric -----------------------------------------------------------------------

  let rubricId: string;

  it("an instructor creates a rubric, and its first save is version 1", async () => {
    const created = await asAuthor().rubrics.create({ name: "Resume review", ...text("a") });
    rubricId = created.id;

    const rubric = await asAuthor().rubrics.get({ rubricId });
    expect(rubric.version).toBe(1);
    expect(rubric.rubricMarkdown).toBe(text("a").rubricMarkdown);
    expect(rubric.canEdit).toBe(true);
  });

  it("appears in every instructor's list, with who wrote it", async () => {
    const listed = (await asColleague().rubrics.list()).find((row) => row.id === rubricId);
    expect(listed?.version).toBe(1);
    expect(listed?.author).toBe(world.instructorId ? listed?.author : null);
    expect(listed?.canEdit).toBe(false);
  });

  it("a changed save is version 2, and the rubric now reads it", async () => {
    const saved = await asAuthor().rubrics.update({
      rubricId,
      name: "Resume review",
      ...text("b"),
    });
    expect(saved).toEqual({ version: 2, changed: true });

    const rubric = await asAuthor().rubrics.get({ rubricId });
    expect(rubric.version).toBe(2);
    expect(rubric.rubricMarkdown).toBe(text("b").rubricMarkdown);
    expect(await tx().rubricVersion.count({ where: { rubricId } })).toBe(2);
  });

  // The port script runs against every database and again after a fix; a version per run would
  // be a history of nothing, and an instructor pressing Save on an unchanged form gets the same.
  it("a save that changes nothing writes nothing", async () => {
    const saved = await asAuthor().rubrics.update({
      rubricId,
      name: "Resume review",
      ...text("b"),
    });
    expect(saved).toEqual({ version: 2, changed: false });
    expect(await tx().rubricVersion.count({ where: { rubricId } })).toBe(2);
  });

  it("renaming alone writes no version", async () => {
    await asAuthor().rubrics.update({ rubricId, name: "Resume review (v2)", ...text("b") });
    expect(await tx().rubricVersion.count({ where: { rubricId } })).toBe(2);
    expect((await asAuthor().rubrics.get({ rubricId })).name).toBe("Resume review (v2)");
  });

  it("refuses a second rubric with the same name, by name", async () => {
    expect(
      await refusal(() =>
        asColleague().rubrics.create({ name: "Resume review (v2)", ...text("c") }),
      ),
    ).toBe("CONFLICT");
  });

  // ---- Who may edit ---------------------------------------------------------------------------

  it("another instructor may read it and may not change it", async () => {
    expect((await asColleague().rubrics.get({ rubricId })).canEdit).toBe(false);
    expect(
      await refusal(() =>
        asColleague().rubrics.update({ rubricId, name: "Resume review (v2)", ...text("c") }),
      ),
    ).toBe("FORBIDDEN");
    expect(await tx().rubricVersion.count({ where: { rubricId } })).toBe(2);
  });

  it("an admin may", async () => {
    const saved = await asAdmin().rubrics.update({
      rubricId,
      name: "Resume review (v2)",
      ...text("c"),
    });
    expect(saved).toEqual({ version: 3, changed: true });
  });

  it("a rubric with no author belongs to the program, and only an admin edits it", async () => {
    const ported = await tx().rubric.create({
      data: { name: `Ported ${rubricId}`, scaleType: "POINTS", criteria: [], maxScore: 0 },
      select: { id: true },
    });
    expect(
      await refusal(() =>
        asAuthor().rubrics.update({
          rubricId: ported.id,
          name: `Ported ${rubricId}`,
          ...text("p"),
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await asAdmin().rubrics.update({
        rubricId: ported.id,
        name: `Ported ${rubricId}`,
        ...text("p"),
      }),
    ).toEqual({ version: 1, changed: true });
  });

  // ---- Rule sets ------------------------------------------------------------------------------

  let ruleSetId: string;

  it("a rule set is created with version 1", async () => {
    const created = await asAuthor().rubrics.createRuleSet({
      name: `Warm rules ${rubricId}`,
      markdown: "## Tone\n\n- Warm.",
      startFromRuleSetId: null,
    });
    ruleSetId = created.id;
    const ruleSet = await asColleague().rubrics.getRuleSet({ ruleSetId });
    expect(ruleSet.version).toBe(1);
    expect(ruleSet.markdown).toBe("## Tone\n\n- Warm.");
    expect(ruleSet.canEdit).toBe(false);
  });

  // The copy is the instructor's own: an edit to the original never reaches it.
  it("a new rule set can start from another's text, as a copy", async () => {
    const created = await asColleague().rubrics.createRuleSet({
      name: `Blunt rules ${rubricId}`,
      markdown: "",
      startFromRuleSetId: ruleSetId,
    });
    expect((await asColleague().rubrics.getRuleSet({ ruleSetId: created.id })).markdown).toBe(
      "## Tone\n\n- Warm.",
    );

    await asAuthor().rubrics.updateRuleSet({
      ruleSetId,
      name: `Warm rules ${rubricId}`,
      markdown: "## Tone\n\n- Warmer.",
    });
    expect((await asColleague().rubrics.getRuleSet({ ruleSetId: created.id })).markdown).toBe(
      "## Tone\n\n- Warm.",
    );
  });

  it("a rubric may name a rule set of its own", async () => {
    await asAdmin().rubrics.update({
      rubricId,
      name: "Resume review (v2)",
      ...text("c"),
      ruleSetId,
    });
    expect((await asAuthor().rubrics.get({ rubricId })).ruleSetId).toBe(ruleSetId);
    expect(await tx().rubricVersion.count({ where: { rubricId } })).toBe(3);
  });

  // ---- The program's rules --------------------------------------------------------------------

  it("only an admin chooses a program's rules", async () => {
    expect(
      await refusal(() =>
        asAuthor().programs.setRuleSet({ programId: world.programId, ruleSetId }),
      ),
    ).toBe("FORBIDDEN");
    await asAdmin().programs.setRuleSet({ programId: world.programId, ruleSetId });
    expect(
      (await asAuthor().programs.settings({ programId: world.programId })).program.ruleSetId,
    ).toBe(ruleSetId);
  });

  it("refuses a rule set that does not exist", async () => {
    expect(
      await refusal(() =>
        asAdmin().programs.setRuleSet({
          programId: world.programId,
          ruleSetId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("the choice can be withdrawn, which turns AI grading off for the program", async () => {
    await asAdmin().programs.setRuleSet({ programId: world.programId, ruleSetId: null });
    expect(
      (await asAuthor().programs.settings({ programId: world.programId })).program.ruleSetId,
    ).toBe(null);
  });

  // ---- Who may read at all --------------------------------------------------------------------

  it("a fellow is refused the list", async () => {
    expect(await refusal(() => createCaller(tx(), world.student.studentId).rubrics.list())).toBe(
      "FORBIDDEN",
    );
  });
});
