/**
 * The competency list: who may write it, who may read it, and what editing it does to the goals
 * already built on it.
 *
 * Run with `npm run test:integration`.
 *
 * **The two claims worth reading are the last two groups.** Editing the list must never reach a
 * goal — that is the promise the whole design rests on, and it is asserted here by deleting the
 * entry a goal names and reading the goal back word for word. And a fellow must be offered their
 * own fellowship's list and no other, which matters because the list is application-wide: another
 * discipline's entries are real rows with real ids, so the filter is the only thing between them
 * and a goal.
 *
 * Every row these checks read is one they wrote, like the rest of `fixtures.ts` — so this suite
 * says nothing about the school's seeded list, which admins are expected to have edited.
 */
import { createCallerFactory } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

import { makeAccount, makeProgram, makeWorld, type World } from "./fixtures";
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

/** A competency group holding one competency with one indicator, offered to whoever is named. */
async function makeGroup(
  tx: Tx,
  options: {
    name: string;
    competency: string;
    disciplines: ("SOFTWARE_ENGINEERING" | "DATA_ANALYTICS")[];
    position: number;
  },
) {
  const group = await tx.competencyGroup.create({
    data: {
      name: options.name,
      position: options.position,
      competencies: {
        create: [
          {
            name: options.competency,
            blurb: "",
            disciplines: options.disciplines,
            position: 0,
            entries: {
              create: [
                { kind: "INDICATOR", text: `${options.competency}: does the thing.`, position: 0 },
              ],
            },
          },
        ],
      },
    },
    select: {
      id: true,
      competencies: { select: { id: true, entries: { select: { id: true } } } },
    },
  });

  const competency = group.competencies[0]!;
  return { groupId: group.id, competencyId: competency.id, entryId: competency.entries[0]!.id };
}

/*
  ---- Who may write it ---------------------------------------------------------------------------

  Authoring is `adminProcedure`, which admits nobody else. An instructor of a program reads the
  list their fellows pick from and writes none of it: deciding what the school says a fellow is
  developing is not a smaller version of teaching them.
*/
describe("who may write the list", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;
  let group: Awaited<ReturnType<typeof makeGroup>>;

  const asAdmin = () => createCaller(tx(), adminId);
  const asInstructor = () => createCaller(tx(), world.instructorId);
  const asFellow = () => createCaller(tx(), world.student.studentId);

  beforeAll(async () => {
    world = await makeWorld(tx());
    adminId = await makeAccount(tx(), { role: "ADMIN" });
    group = await makeGroup(tx(), {
      name: "Durable Skills",
      competency: "Growth Mindset",
      disciplines: ["SOFTWARE_ENGINEERING", "DATA_ANALYTICS"],
      position: 0,
    });
  });

  it("an instructor of a program is refused every write", async () => {
    const instructor = asInstructor();

    expect(
      await refusal(() => instructor.competencies.saveGroup({ groupId: null, name: "No" })),
    ).toBe("FORBIDDEN");
    expect(
      await refusal(() =>
        instructor.competencies.saveCompetency({
          competencyId: null,
          groupId: group.groupId,
          name: "No",
          blurb: "",
          disciplines: ["SOFTWARE_ENGINEERING"],
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await refusal(() =>
        instructor.competencies.saveEntry({
          entryId: null,
          competencyId: group.competencyId,
          kind: "INDICATOR",
          text: "No",
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await refusal(() => instructor.competencies.removeEntry({ entryId: group.entryId })),
    ).toBe("FORBIDDEN");
    expect(
      await refusal(() =>
        instructor.competencies.reorder({ of: "groups", within: null, ids: [group.groupId] }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("an instructor cannot read the whole list either — only what a program is offered", async () => {
    expect(await refusal(() => asInstructor().competencies.all())).toBe("FORBIDDEN");
  });

  it("a fellow is refused both", async () => {
    expect(await refusal(() => asFellow().competencies.all())).toBe("FORBIDDEN");
    expect(
      await refusal(() => asFellow().competencies.saveGroup({ groupId: null, name: "No" })),
    ).toBe("FORBIDDEN");
  });

  it("an admin writes, and reads the whole list back", async () => {
    const added = await asAdmin().competencies.saveGroup({ groupId: null, name: "Leadership" });

    const all = await asAdmin().competencies.all();
    expect(all.map((group) => group.id)).toContain(added.id);
  });

  it("a fellow of the program reads the list they pick from", async () => {
    const found = await asFellow().competencies.forProgram({ programId: world.programId });

    expect(found.discipline).toBe("SOFTWARE_ENGINEERING");
    expect(found.groups.map((row) => row.id)).toContain(group.groupId);
  });

  it("somebody outside the program is refused it", async () => {
    const stranger = await makeAccount(tx());

    expect(
      await refusal(() =>
        createCaller(tx(), stranger).competencies.forProgram({ programId: world.programId }),
      ),
    ).toBe("FORBIDDEN");
  });
});

/*
  ---- What each fellowship is offered -------------------------------------------------------------

  One list, two fellowships. What separates them is a column on the competency rather than a second
  copy of the list, so the shared sections are written once and the technical ones reach one
  fellowship each.
*/
describe("the list a program is offered", () => {
  const tx = withRollback();

  let sweProgramId: string;
  let dataProgramId: string;
  let fellowOfData: string;
  let fellowOfSwe: string;
  let shared: Awaited<ReturnType<typeof makeGroup>>;
  let sweOnly: Awaited<ReturnType<typeof makeGroup>>;
  let dataOnly: Awaited<ReturnType<typeof makeGroup>>;

  beforeAll(async () => {
    const swe = await makeWorld(tx());
    sweProgramId = swe.programId;
    fellowOfSwe = swe.student.studentId;

    const data = await makeProgram(tx(), { discipline: "DATA_ANALYTICS" });
    dataProgramId = data.id;
    fellowOfData = await makeAccount(tx());
    await tx().enrollment.create({
      data: { programId: data.id, studentId: fellowOfData, status: "ACTIVE" },
    });

    shared = await makeGroup(tx(), {
      name: "Durable Skills",
      competency: "Growth Mindset",
      disciplines: ["SOFTWARE_ENGINEERING", "DATA_ANALYTICS"],
      position: 0,
    });
    sweOnly = await makeGroup(tx(), {
      name: "Software Engineering",
      competency: "Debugging",
      disciplines: ["SOFTWARE_ENGINEERING"],
      position: 1,
    });
    dataOnly = await makeGroup(tx(), {
      name: "Data Analytics",
      competency: "Statistical Reasoning",
      disciplines: ["DATA_ANALYTICS"],
      position: 2,
    });
  });

  it("a software engineering fellow gets the shared section and their own", async () => {
    const found = await createCaller(tx(), fellowOfSwe).competencies.forProgram({
      programId: sweProgramId,
    });
    const ids = found.groups.map((row) => row.id);

    expect(ids).toContain(shared.groupId);
    expect(ids).toContain(sweOnly.groupId);
    expect(ids).not.toContain(dataOnly.groupId);
  });

  it("a data analytics fellow gets the shared section and theirs", async () => {
    const found = await createCaller(tx(), fellowOfData).competencies.forProgram({
      programId: dataProgramId,
    });
    const ids = found.groups.map((row) => row.id);

    expect(found.discipline).toBe("DATA_ANALYTICS");
    expect(ids).toContain(shared.groupId);
    expect(ids).toContain(dataOnly.groupId);
    expect(ids).not.toContain(sweOnly.groupId);
  });

  /*
    A group the filter empties is dropped rather than shown with nothing under it, which is the
    one thing a three-level list must never do — and the state a newly added group sits in until
    somebody writes its first competency.
  */
  it("a competency group left empty by the filter is not returned at all", async () => {
    const empty = await tx().competencyGroup.create({
      data: { name: "Nothing Yet", position: 9 },
      select: { id: true },
    });

    const found = await createCaller(tx(), fellowOfSwe).competencies.forProgram({
      programId: sweProgramId,
    });

    expect(found.groups.map((row) => row.id)).not.toContain(empty.id);
  });
});

/*
  ---- Sections, competencies, entries -------------------------------------------------------------
*/
describe("writing the list", () => {
  const tx = withRollback();

  let adminId: string;
  const asAdmin = () => createCaller(tx(), adminId);

  beforeAll(async () => {
    adminId = await makeAccount(tx(), { role: "ADMIN" });
  });

  it("a competency group holding a competency refuses to be deleted, and says how many", async () => {
    const group = await makeGroup(tx(), {
      name: "Durable Skills",
      competency: "Growth Mindset",
      disciplines: ["SOFTWARE_ENGINEERING"],
      position: 0,
    });

    expect(
      await refusal(() => asAdmin().competencies.removeGroup({ groupId: group.groupId })),
    ).toBe("PRECONDITION_FAILED");

    await asAdmin().competencies.removeCompetency({ competencyId: group.competencyId });
    await asAdmin().competencies.removeGroup({ groupId: group.groupId });

    expect(await tx().competencyGroup.findUnique({ where: { id: group.groupId } })).toBeNull();
  });

  it("a competency moved to another group lands at the end of it", async () => {
    const first = await makeGroup(tx(), {
      name: "First",
      competency: "Moving",
      disciplines: ["SOFTWARE_ENGINEERING"],
      position: 0,
    });
    const second = await makeGroup(tx(), {
      name: "Second",
      competency: "Sitting",
      disciplines: ["SOFTWARE_ENGINEERING"],
      position: 1,
    });

    await asAdmin().competencies.saveCompetency({
      competencyId: first.competencyId,
      groupId: second.groupId,
      name: "Moving",
      blurb: "",
      disciplines: ["SOFTWARE_ENGINEERING"],
    });

    const landed = await tx().competency.findMany({
      where: { groupId: second.groupId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    expect(landed.map((row) => row.id)).toEqual([second.competencyId, first.competencyId]);
    expect(landed.map((row) => row.position)).toEqual([0, 1]);
  });

  it("an order that is not exactly one competency's entries is refused", async () => {
    const group = await makeGroup(tx(), {
      name: "Ordering",
      competency: "Growth Mindset",
      disciplines: ["SOFTWARE_ENGINEERING"],
      position: 0,
    });

    const second = await asAdmin().competencies.saveEntry({
      entryId: null,
      competencyId: group.competencyId,
      kind: "PITFALL",
      text: "Avoiding the thing.",
    });

    expect(
      await refusal(() =>
        asAdmin().competencies.reorder({
          of: "entries",
          within: group.competencyId,
          ids: [group.entryId],
        }),
      ),
    ).toBe("BAD_REQUEST");

    expect(
      await refusal(() =>
        asAdmin().competencies.reorder({
          of: "entries",
          within: group.competencyId,
          ids: [second.id, second.id],
        }),
      ),
    ).toBe("BAD_REQUEST");

    await asAdmin().competencies.reorder({
      of: "entries",
      within: group.competencyId,
      ids: [second.id, group.entryId],
    });

    const ordered = await tx().competencyEntry.findMany({
      where: { competencyId: group.competencyId },
      orderBy: { position: "asc" },
      select: { id: true },
    });

    expect(ordered.map((row) => row.id)).toEqual([second.id, group.entryId]);
  });

  /*
    The groups are the one sequence with nothing above them, so `writeOrder` runs without its
    scope predicate for this call — which is worth asserting, because a predicate that silently
    matched nothing would leave the order unwritten and look like success.
  */
  it("the groups themselves reorder, though nothing scopes them", async () => {
    const first = await asAdmin().competencies.saveGroup({ groupId: null, name: "Alpha" });
    const second = await asAdmin().competencies.saveGroup({ groupId: null, name: "Beta" });

    const before = await tx().competencyGroup.findMany({
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const flipped = before
      .map((row) => row.id)
      .filter((id) => id !== first.id && id !== second.id)
      .concat([second.id, first.id]);

    await asAdmin().competencies.reorder({ of: "groups", within: null, ids: flipped });

    const after = await tx().competencyGroup.findMany({
      orderBy: { position: "asc" },
      select: { id: true },
    });

    expect(after.map((row) => row.id)).toEqual(flipped);
  });
});

/*
  ---- What editing the list does to a goal --------------------------------------------------------

  Nothing, which is the promise the whole design rests on: a goal copies its entry's wording when
  it is set and never reads it back, so the list can be rewritten by an admin who has never met the
  fellow whose goal it is.
*/
describe("editing the list leaves goals alone", () => {
  const tx = withRollback();

  let world: World;
  let adminId: string;
  let group: Awaited<ReturnType<typeof makeGroup>>;
  let goalId: string;

  beforeAll(async () => {
    world = await makeWorld(tx());
    adminId = await makeAccount(tx(), { role: "ADMIN" });
    group = await makeGroup(tx(), {
      name: "Durable Skills",
      competency: "Growth Mindset",
      disciplines: ["SOFTWARE_ENGINEERING"],
      position: 0,
    });

    const goal = await createCaller(tx(), world.student.studentId).coaching.setGoal({
      programId: world.programId,
      title: "Ask for help within half an hour of being stuck.",
      entryId: group.entryId,
      successCriteria: "Asks in the channel within half an hour.",
      objectives: "One question a week.",
      actionPlan: "Review them at the next session.",
      marker: "DEVELOPING",
    });
    goalId = goal.id;
  });

  it("rewording an entry leaves the goal reading as it was set", async () => {
    await createCaller(tx(), adminId).competencies.saveEntry({
      entryId: group.entryId,
      competencyId: group.competencyId,
      kind: "INDICATOR",
      text: "Something else entirely.",
    });

    const mine = await createCaller(tx(), world.student.studentId).coaching.myGoals({
      programId: world.programId,
    });

    expect(mine.goals.find((row) => row.id === goalId)).toMatchObject({
      entryText: "Growth Mindset: does the thing.",
      competencyName: "Growth Mindset",
      entryKind: "INDICATOR",
    });
  });

  it("deleting the whole competency leaves the goal standing, word for word", async () => {
    await createCaller(tx(), adminId).competencies.removeCompetency({
      competencyId: group.competencyId,
    });

    expect(await tx().competencyEntry.findUnique({ where: { id: group.entryId } })).toBeNull();

    const mine = await createCaller(tx(), world.student.studentId).coaching.myGoals({
      programId: world.programId,
    });

    expect(mine.goals.find((row) => row.id === goalId)).toMatchObject({
      entryId: group.entryId,
      entryText: "Growth Mindset: does the thing.",
      competencyName: "Growth Mindset",
    });
  });

  /*
    And the fellow goes on owning it: a goal whose entry has been deleted is still theirs to
    rewrite and to drop, because nothing about editing it reaches the list.
  */
  it("the fellow still edits a goal whose entry is gone", async () => {
    const changed = await createCaller(tx(), world.student.studentId).coaching.updateGoal({
      programId: world.programId,
      goalId,
      marker: "PROFICIENT",
    });

    expect(changed.marker).toBe("PROFICIENT");
    expect(changed.entryText).toBe("Growth Mindset: does the thing.");
  });
});
