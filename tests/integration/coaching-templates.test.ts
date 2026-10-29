/**
 * The coaching forms: who may write them, what writing one does and does not do, and how a
 * session relates to the form it was started with.
 *
 * Run with `npm run test:integration`.
 *
 * **The claim worth reading is the last one.** Deleting a form must never reach a session — that
 * is the promise the whole design rests on, and it is asserted here by starting a session from a
 * form, deleting the form, and reading the session's layout back equal to what it copied.
 *
 * Every row these checks read is one they wrote, like the rest of `fixtures.ts` — so this suite
 * says nothing about the seeded default form, which admins are expected to have edited.
 */
import {
  FIXTURE_LAYOUT,
  makeAccount,
  makeCoachingTemplate,
  makeWorld,
  type World,
} from "./fixtures";
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

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

describe("who may write a coaching form", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;
  let templateId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    adminId = await makeAccount(tx(), { role: "ADMIN" });
    templateId = (await makeCoachingTemplate(tx())).id;
  });

  it("an instructor and a fellow are refused every procedure, reads included", async () => {
    for (const userId of [world.instructorId, world.student.studentId]) {
      const caller = createCaller(tx(), userId);
      const calls = [
        () => caller.coachingTemplates.all(),
        () => caller.coachingTemplates.get({ id: templateId }),
        () => caller.coachingTemplates.create({ name: "Mine" }),
        () =>
          caller.coachingTemplates.save({
            id: templateId,
            name: "Mine",
            layout: FIXTURE_LAYOUT,
            updatedAt: new Date(),
          }),
        () => caller.coachingTemplates.duplicate({ id: templateId }),
        () => caller.coachingTemplates.setDefault({ id: templateId }),
        () => caller.coachingTemplates.remove({ id: templateId }),
      ];
      for (const call of calls) {
        expect(await refusal(call)).toBe("FORBIDDEN");
      }
    }
  });

  it("an admin reads the list and the form", async () => {
    const admin = createCaller(tx(), adminId);
    const all = await admin.coachingTemplates.all();
    expect(all.some((row) => row.id === templateId)).toBe(true);

    const form = await admin.coachingTemplates.get({ id: templateId });
    expect(form.layout).toEqual(FIXTURE_LAYOUT);
  });

  /* The list an instructor chooses from, read through the record rather than the admin router. */
  it("an instructor reads the forms on the fellow's record, default first", async () => {
    const def = await makeCoachingTemplate(tx(), { name: "Aaa, but the default" });
    await createCaller(tx(), adminId).coachingTemplates.setDefault({ id: def.id });

    const record = await createCaller(tx(), world.instructorId).coaching.forStudent({
      programId: world.programId,
      studentId: world.student.studentId,
    });
    expect(record.templates[0]).toMatchObject({ id: def.id, isDefault: true });
    expect(record.templates.some((row) => row.id === templateId)).toBe(true);
  });
});

describe("writing a coaching form", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;

  const asAdmin = () => createCaller(tx(), adminId);

  beforeAll(async () => {
    world = await makeWorld(tx());
    adminId = await makeAccount(tx(), { role: "ADMIN" });
  });

  it("creates a form with one empty section, not the default", async () => {
    const created = await asAdmin().coachingTemplates.create({ name: "Mid-term" });
    const form = await asAdmin().coachingTemplates.get({ id: created.id });

    expect(form.name).toBe("Mid-term");
    expect(form.isDefault).toBe(false);
    expect(form.layout?.sections).toHaveLength(1);
    expect(form.layout?.sections[0]?.items).toEqual([]);
  });

  it("saves the whole layout, and refuses one the schema does not accept", async () => {
    const created = await asAdmin().coachingTemplates.create({ name: "Edited" });
    const before = await asAdmin().coachingTemplates.get({ id: created.id });

    expect(
      await refusal(() =>
        asAdmin().coachingTemplates.save({
          id: created.id,
          name: "Edited",
          updatedAt: before.updatedAt,
          layout: {
            version: 1,
            sections: [
              {
                id: "s",
                title: "S",
                items: [
                  { id: "a", kind: "TEMPERATURE", prompt: "One" },
                  { id: "b", kind: "TEMPERATURE", prompt: "Two" },
                ],
              },
            ],
          },
        }),
      ),
    ).toBe("BAD_REQUEST");

    const saved = await asAdmin().coachingTemplates.save({
      id: created.id,
      name: "Edited and renamed",
      updatedAt: before.updatedAt,
      layout: FIXTURE_LAYOUT,
    });
    expect(saved.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());

    const after = await asAdmin().coachingTemplates.get({ id: created.id });
    expect(after.name).toBe("Edited and renamed");
    expect(after.layout).toEqual(FIXTURE_LAYOUT);
  });

  /*
    Two admins with the same form open: the second save carries an `updatedAt` the row has moved
    past, and is refused rather than silently overwriting the first.
  */
  it("refuses a save made against a version of the form that has since changed", async () => {
    const created = await asAdmin().coachingTemplates.create({ name: "Contended" });
    const loaded = await asAdmin().coachingTemplates.get({ id: created.id });

    // A moment later than the row, which is what another admin's save would leave behind.
    await tx().coachingTemplate.update({
      where: { id: created.id },
      data: { updatedAt: new Date(loaded.updatedAt.getTime() + 1000) },
    });

    expect(
      await refusal(() =>
        asAdmin().coachingTemplates.save({
          id: created.id,
          name: "Contended",
          updatedAt: loaded.updatedAt,
          layout: FIXTURE_LAYOUT,
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("duplicates a form under a new name, with the same layout and never the default", async () => {
    const original = await makeCoachingTemplate(tx(), { name: "Original", isDefault: true });
    const copy = await asAdmin().coachingTemplates.duplicate({ id: original.id });
    const form = await asAdmin().coachingTemplates.get({ id: copy.id });

    expect(copy.id).not.toBe(original.id);
    expect(form.name).toBe("Original (copy)");
    expect(form.isDefault).toBe(false);
    expect(form.layout).toEqual(FIXTURE_LAYOUT);
  });

  it("makes one form the default and clears every other", async () => {
    const first = await makeCoachingTemplate(tx(), { name: "First" });
    const second = await makeCoachingTemplate(tx(), { name: "Second" });

    await asAdmin().coachingTemplates.setDefault({ id: first.id });
    await asAdmin().coachingTemplates.setDefault({ id: second.id });

    const all = await asAdmin().coachingTemplates.all();
    const ours = all.filter((row) => row.id === first.id || row.id === second.id);
    expect(ours.map((row) => [row.name, row.isDefault])).toEqual([
      ["Second", true],
      ["First", false],
    ]);
    expect(all.filter((row) => row.isDefault)).toHaveLength(1);
  });

  it("refuses a form that does not exist", async () => {
    expect(
      await refusal(() =>
        asAdmin().coachingTemplates.get({ id: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).toBe("NOT_FOUND");
  });

  /* The promise the whole design rests on: a session holds its own copy, so the form may go. */
  it("deleting a form leaves a session started from it reading exactly as it was", async () => {
    const template = await makeCoachingTemplate(tx(), { name: "Doomed" });
    const instructor = createCaller(tx(), world.instructorId);
    const started = await instructor.coaching.startSession({
      programId: world.programId,
      studentId: world.student.studentId,
      templateId: template.id,
    });
    await instructor.coaching.saveSession({
      programId: world.programId,
      sessionId: started.id,
      temperature: 6,
      answers: [{ promptId: "win", answer: "Survived." }],
    });

    await asAdmin().coachingTemplates.remove({ id: template.id });
    expect(await refusal(() => asAdmin().coachingTemplates.get({ id: template.id }))).toBe(
      "NOT_FOUND",
    );

    const session = await instructor.coaching.session({
      programId: world.programId,
      sessionId: started.id,
    });
    expect(session.layout).toEqual(FIXTURE_LAYOUT);
    expect(session.answers).toEqual([
      { promptId: "win", prompt: "One win this week", answer: "Survived." },
    ]);
  });
});
