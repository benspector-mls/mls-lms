import {
  assignTeams,
  dealIntoTeams,
  planDistribution,
  shuffle,
  teamCountFor,
} from "@/lib/teams/distribute";

/**
 * Dividing a roster into teams of about one size.
 *
 * The one rule worth holding is **never a team of one**. Every other outcome — a team one bigger
 * than asked, a team one smaller — is a project three people can do; a team of one is somebody
 * doing group work alone, which is the case an instructor opens this screen to prevent.
 */

describe("teamCountFor", () => {
  it("divides exactly when it can", () => {
    expect(teamCountFor(15, 3)).toBe(5);
    expect(teamCountFor(18, 2)).toBe(9);
  });

  it("folds a remainder of one into an existing team rather than making a team of one", () => {
    // 19 in twos: eight teams of 2 and one of 3, never nine of 2 and one of 1.
    expect(teamCountFor(19, 2)).toBe(9);
    // 16 in threes: 4, 3, 3, 3, 3.
    expect(teamCountFor(16, 3)).toBe(5);
    // 4 in threes: one team of 4.
    expect(teamCountFor(4, 3)).toBe(1);
  });

  it("makes an extra, smaller team when the remainder is at least two", () => {
    // 5 in threes is a 3 and a 2, which is better than one team of 5.
    expect(teamCountFor(5, 3)).toBe(2);
    // 17 in threes: five of 3 and one of 2.
    expect(teamCountFor(17, 3)).toBe(6);
  });

  it("makes one small team of a group smaller than the size", () => {
    expect(teamCountFor(2, 3)).toBe(1);
  });

  it("makes one team of one for a group of one, since there is nothing else to do", () => {
    expect(teamCountFor(1, 3)).toBe(1);
  });

  it("makes no team of nobody", () => {
    expect(teamCountFor(0, 3)).toBe(0);
  });
});

describe("dealIntoTeams", () => {
  it("deals round-robin, so sizes differ by at most one and no team is empty", () => {
    const fellows = Array.from({ length: 19 }, (_, index) => `f${index + 1}`);
    const teams = dealIntoTeams(fellows, 9);

    expect(teams).toHaveLength(9);
    expect(teams.map((team) => team.length)).toEqual([3, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(teams.flat().sort()).toEqual([...fellows].sort());
  });

  it("keeps the order it was given, which is what makes the shuffle the only randomness", () => {
    expect(dealIntoTeams(["a", "b", "c", "d", "e"], 2)).toEqual([
      ["a", "c", "e"],
      ["b", "d"],
    ]);
  });

  it("deals nobody into no teams", () => {
    expect(dealIntoTeams([], 0)).toEqual([]);
  });
});

describe("shuffle", () => {
  it("returns every item exactly once", () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    expect([...shuffle(items)].sort((a, b) => a - b)).toEqual(items);
  });

  it("leaves the input alone", () => {
    const items = [1, 2, 3, 4, 5];
    shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it("is driven by the random source it is given, so a test can fix the outcome", () => {
    // Always 0: every pick takes the first remaining item, which walks the list backwards.
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
  });
});

describe("planDistribution", () => {
  it("counts teams per group and adds them up", () => {
    const plan = planDistribution(
      [
        { label: "Cohort A", fellows: Array.from({ length: 15 }, (_, i) => `a${i}`) },
        { label: "Cohort B", fellows: Array.from({ length: 9 }, (_, i) => `b${i}`) },
        { label: "No cohort", fellows: ["n1", "n2"] },
      ],
      3,
    );

    expect(plan.groups.map((group) => [group.label, group.teamCount])).toEqual([
      ["Cohort A", 5],
      ["Cohort B", 3],
      ["No cohort", 1],
    ]);
    expect(plan.teamCount).toBe(9);
    expect(plan.fellowCount).toBe(26);
  });

  it("drops a group with nobody in it, so it neither gets a team nor appears in the summary", () => {
    const plan = planDistribution(
      [
        { label: "Cohort A", fellows: ["a1", "a2"] },
        { label: "No cohort", fellows: [] },
      ],
      2,
    );

    expect(plan.groups.map((group) => group.label)).toEqual(["Cohort A"]);
    expect(plan.teamCount).toBe(1);
  });
});

describe("assignTeams", () => {
  const plan = planDistribution(
    [
      { label: "Cohort A", fellows: ["a1", "a2", "a3", "a4", "a5"] },
      { label: "Cohort B", fellows: ["b1", "b2"] },
    ],
    3,
  );

  it("gives each group its own run of teams, in the order the teams were given", () => {
    const placements = assignTeams(plan, ["t1", "t2", "t3"], () => 0);

    const teamOf = new Map(placements.map((placement) => [placement.fellow, placement.teamId]));
    expect(new Set(["a1", "a2", "a3", "a4", "a5"].map((f) => teamOf.get(f)))).toEqual(
      new Set(["t1", "t2"]),
    );
    expect(new Set(["b1", "b2"].map((f) => teamOf.get(f)))).toEqual(new Set(["t3"]));
  });

  it("places everybody exactly once", () => {
    const placements = assignTeams(plan, ["t1", "t2", "t3"]);
    expect(placements.map((placement) => placement.fellow).sort()).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
      "b1",
      "b2",
    ]);
  });

  it("uses only as many teams as the plan needs, leaving the rest untouched", () => {
    const placements = assignTeams(plan, ["t1", "t2", "t3", "t4", "t5"]);
    expect(new Set(placements.map((placement) => placement.teamId))).toEqual(
      new Set(["t1", "t2", "t3"]),
    );
  });

  it("refuses fewer teams than the plan needs", () => {
    expect(() => assignTeams(plan, ["t1", "t2"])).toThrow(/3 teams/);
  });
});
