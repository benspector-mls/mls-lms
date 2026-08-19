import {
  bestOf,
  GCF_KIND_META,
  GCF_KINDS,
  GCF_TARGET,
  gcfScoreLabel,
  latestOf,
  ofKind,
  PROCTORED_SCALE,
  reachedTarget,
  recentOf,
  scaleLabel,
  sharedMaximum,
  sortByTakenOn,
  standingFor,
  targetLabel,
  type GcfKind,
} from "@/lib/gcf";

function attempt(
  kind: GcfKind,
  score: number,
  takenOn: string,
  scorePossible: number | null = kind === "MOCK" ? 1200 : null,
) {
  return { kind, score, scorePossible, takenOn };
}

describe("the two kinds", () => {
  it("names every kind the enum has", () => {
    for (const kind of GCF_KINDS) {
      expect(GCF_KIND_META[kind].label).toBeTruthy();
      expect(GCF_TARGET[kind]).toBeGreaterThan(0);
    }
  });

  it("puts the real one first, because that is the one that counts", () => {
    expect(GCF_KINDS[0]).toBe("PROCTORED");
  });
});

describe("writing a score down", () => {
  /*
    The proctored maximum is supplied at display time, not stored. The export reports none — a
    proctored row's `scorePossible` is genuinely null, which is the honest record of what
    CodeSignal said — so the 600 comes from `PROCTORED_SCALE` here and the row keeps saying what
    arrived.
  */
  it("gives a proctored score the scale it sits on, without storing it", () => {
    const proctored = attempt("PROCTORED", 512, "2026-05-01");
    expect(proctored.scorePossible).toBeNull();
    expect(gcfScoreLabel(proctored)).toBe("512/600");
  });

  it("gives a mock its own maximum, which is not a constant", () => {
    expect(gcfScoreLabel(attempt("MOCK", 840, "2026-05-01", 1200))).toBe("840/1200");
    expect(gcfScoreLabel(attempt("MOCK", 240, "2026-05-01", 300))).toBe("240/300");
  });

  /*
    A stored maximum wins over the assumed one. If CodeSignal ever reports a proctored maximum,
    the row's own value is what the label reads — the constant is a fallback, not an override.
  */
  it("prefers a stored maximum to the assumed one", () => {
    expect(gcfScoreLabel(attempt("PROCTORED", 512, "2026-05-01", 800))).toBe("512/800");
  });

  /*
    Bare, because the heading above a column of scores names the scale once. `389/600` beneath
    "Proctored GCF (out of 600)" would be the same denominator a third time on one screen.
  */
  it("writes the target bare, since its heading carries the scale", () => {
    expect(targetLabel("PROCTORED")).toBe("389");
    expect(targetLabel("MOCK")).toBe("600");
  });

  /*
    The reason every screen showing a proctored score also says where the scale starts. 200 is the
    floor rather than zero, so the denominator alone understates the bottom of the range — and a
    percentage computed from this label would be wrong in the same direction, which is why there is
    no percentage anywhere in this module.
  */
  it("keeps the floor of the proctored scale, which the denominator does not say", () => {
    expect(PROCTORED_SCALE.min).toBe(200);
    expect(gcfScoreLabel(attempt("PROCTORED", PROCTORED_SCALE.min, "2026-05-01"))).toBe("200/600");
  });
});

describe("the scale a heading names", () => {
  /*
    What lets a column heading carry the scale so the cells beneath it do not have to. "Proctored
    GCF (out of 600)" said once beats `/600` repeated down forty rows.
  */
  it("is the proctored band, whatever the rows say", () => {
    expect(sharedMaximum([], "PROCTORED")).toBe(600);
    expect(scaleLabel([attempt("PROCTORED", 512, "2026-05-01")], "PROCTORED")).toBe("out of 600");
  });

  it("is a mock's own maximum where every one of them agrees", () => {
    const mocks = [
      attempt("MOCK", 840, "2026-05-01", 1200),
      attempt("MOCK", 600, "2026-06-01", 1200),
    ];
    expect(scaleLabel(mocks, "MOCK")).toBe("out of 1200");
  });

  /*
    The case that makes this worth computing rather than assuming. A mock is 300 points a task, so
    a cohort holding a four-task and a three-task mock has no single maximum — and a heading
    reading "out of 1200" above a 240/300 would be flatly wrong.
  */
  it("is nothing where the mocks were of different lengths", () => {
    const mixed = [
      attempt("MOCK", 840, "2026-05-01", 1200),
      attempt("MOCK", 240, "2026-06-01", 300),
    ];
    expect(sharedMaximum(mixed, "MOCK")).toBeNull();
    expect(scaleLabel(mixed, "MOCK")).toBeNull();
  });

  it("is nothing where there are no mocks to measure", () => {
    expect(scaleLabel([], "MOCK")).toBeNull();
  });

  it("ignores the other kind entirely, since the scales are unrelated", () => {
    const both = [
      attempt("MOCK", 840, "2026-05-01", 1200),
      attempt("PROCTORED", 512, "2026-06-01"),
    ];
    expect(scaleLabel(both, "MOCK")).toBe("out of 1200");
  });
});

describe("reaching the bar", () => {
  it("counts the target itself as reached", () => {
    expect(reachedTarget(attempt("PROCTORED", 389, "2026-05-01"))).toBe(true);
    expect(reachedTarget(attempt("PROCTORED", 388, "2026-05-01"))).toBe(false);
    expect(reachedTarget(attempt("MOCK", 600, "2026-05-01"))).toBe(true);
    expect(reachedTarget(attempt("MOCK", 599, "2026-05-01"))).toBe(false);
  });

  // The two scales are different quantities, not a big one and a small one.
  it("measures each kind against its own target", () => {
    expect(reachedTarget(attempt("MOCK", 400, "2026-05-01"))).toBe(false);
    expect(reachedTarget(attempt("PROCTORED", 400, "2026-05-01"))).toBe(true);
  });
});

describe("best and latest", () => {
  const attempts = [
    attempt("MOCK", 480, "2026-01-10"),
    attempt("MOCK", 900, "2026-02-10"),
    attempt("MOCK", 720, "2026-03-10"),
    attempt("PROCTORED", 512, "2026-04-01"),
  ];

  it("separates the kinds, since their scales are not comparable", () => {
    expect(ofKind(attempts, "MOCK")).toHaveLength(3);
    expect(ofKind(attempts, "PROCTORED")).toHaveLength(1);
  });

  it("finds the highest of a kind", () => {
    expect(bestOf(attempts, "MOCK")?.score).toBe(900);
  });

  it("finds the most recent of a kind, which is not the highest", () => {
    expect(latestOf(attempts, "MOCK")?.score).toBe(720);
  });

  /*
    Best and latest are shown side by side precisely so two different dates say something: the
    peak is behind them. That reading only works if "best" names the first time somebody reached
    their high point rather than the last time they matched it.
  */
  it("breaks a tie on best toward the earlier date", () => {
    const tied = [attempt("MOCK", 900, "2026-03-10"), attempt("MOCK", 900, "2026-01-10")];
    expect(bestOf(tied, "MOCK")?.takenOn).toBe("2026-01-10");
  });

  it("breaks a tie on latest toward the higher score", () => {
    const tied = [attempt("MOCK", 600, "2026-03-10"), attempt("MOCK", 900, "2026-03-10")];
    expect(latestOf(tied, "MOCK")?.score).toBe(900);
  });

  it("has no best and no latest where the kind has no attempts", () => {
    expect(bestOf(attempts, "PROCTORED" as GcfKind)).not.toBeNull();
    expect(bestOf([], "MOCK")).toBeNull();
    expect(latestOf([], "PROCTORED")).toBeNull();
  });
});

describe("a fellow's standing", () => {
  it("counts only the attempts of that kind", () => {
    const standing = standingFor(
      [
        attempt("MOCK", 480, "2026-01-10"),
        attempt("MOCK", 900, "2026-02-10"),
        attempt("PROCTORED", 512, "2026-04-01"),
      ],
      "MOCK",
    );

    expect(standing.attempts).toBe(2);
    expect(standing.best?.score).toBe(900);
    expect(standing.latest?.score).toBe(900);
  });

  /*
    The rule worth stating out loud: practising after you have cleared the bar must not be able to
    take the bar away. A fellow who scored 420 in March and 380 in May has reached 389, and any
    other reading makes another attempt a risk rather than a rehearsal.
  */
  it("reads reached off the best, so a later weaker attempt does not take it away", () => {
    const standing = standingFor(
      [attempt("PROCTORED", 420, "2026-03-01"), attempt("PROCTORED", 380, "2026-05-01")],
      "PROCTORED",
    );

    expect(standing.latest?.score).toBe(380);
    expect(standing.reached).toBe(true);
  });

  it("is empty rather than absent for somebody who has attempted none", () => {
    const standing = standingFor([], "PROCTORED");
    expect(standing).toEqual({
      attempts: 0,
      best: null,
      latest: null,
      recent: [],
      reached: false,
    });
  });
});

describe("the last few results", () => {
  const attempts = [
    attempt("MOCK", 300, "2026-01-10"),
    attempt("MOCK", 480, "2026-02-10"),
    attempt("MOCK", 900, "2026-03-10"),
    attempt("MOCK", 720, "2026-04-10"),
    attempt("PROCTORED", 512, "2026-05-01"),
  ];

  it("gives the most recent three, newest first", () => {
    expect(recentOf(attempts, "MOCK").map((a) => a.score)).toEqual([720, 900, 480]);
  });

  it("does not mix the kinds, whose scales are not comparable", () => {
    expect(recentOf(attempts, "PROCTORED").map((a) => a.score)).toEqual([512]);
  });

  /*
    Fewer than three is a real answer rather than a shortfall. Padding it, or refusing to show
    anything until there are three, would both misrepresent a fellow who has attempted it twice.
  */
  it("gives two when there are only two", () => {
    const two = [attempt("MOCK", 300, "2026-01-10"), attempt("MOCK", 480, "2026-02-10")];
    expect(recentOf(two, "MOCK").map((a) => a.score)).toEqual([480, 300]);
  });

  it("gives one when there is only one", () => {
    expect(recentOf([attempt("MOCK", 300, "2026-01-10")], "MOCK")).toHaveLength(1);
  });

  /*
    Empty rather than a placeholder, so the caller can tell "has not attempted this" from a low
    score — which is the pair the gradebook's cell most needs to keep apart.
  */
  it("is empty for somebody who has not attempted it", () => {
    expect(recentOf([], "MOCK")).toEqual([]);
    expect(recentOf(attempts, "MOCK", 0)).toEqual([]);
  });

  it("honours a different count where one is asked for", () => {
    expect(recentOf(attempts, "MOCK", 2).map((a) => a.score)).toEqual([720, 900]);
  });

  it("is the same list the standing carries, so a screen cannot read two answers", () => {
    expect(standingFor(attempts, "MOCK").recent).toEqual(recentOf(attempts, "MOCK"));
  });
});

describe("the order attempts are listed in", () => {
  it("puts the most recent first, since that is where a fellow stands now", () => {
    const sorted = sortByTakenOn([
      attempt("MOCK", 480, "2026-01-10"),
      attempt("MOCK", 900, "2026-03-10"),
      attempt("MOCK", 720, "2026-02-10"),
    ]);

    expect(sorted.map((a) => a.takenOn)).toEqual(["2026-03-10", "2026-02-10", "2026-01-10"]);
  });

  it("breaks a tie on score, so the order is total", () => {
    const sorted = sortByTakenOn([
      attempt("MOCK", 480, "2026-01-10"),
      attempt("MOCK", 900, "2026-01-10"),
    ]);
    expect(sorted.map((a) => a.score)).toEqual([900, 480]);
  });

  it("does not sort the array it was given", () => {
    const original = [attempt("MOCK", 480, "2026-01-10"), attempt("MOCK", 900, "2026-03-10")];
    const copy = [...original];
    sortByTakenOn(original);
    expect(original).toEqual(copy);
  });
});
