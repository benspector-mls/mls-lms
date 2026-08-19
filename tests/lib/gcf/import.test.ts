import {
  assessmentChoices,
  attemptKey,
  dedupeRows,
  parseGcfExport,
  selectRows,
} from "@/lib/gcf/import";

/**
 * The export's real shape, with invented people.
 *
 * **Every column and every quirk is copied from an actual `csvReport-*.csv`**, because those
 * quirks are what the reader exists to handle: a proctored row fills `Assessment Score` and
 * leaves `Score` and `Max Score` empty, an unproctored row does the reverse, `Max Score` is not a
 * constant, and the only thing separating a mock GCF from a class exercise is its name. Inventing
 * the names and addresses keeps a term's worth of real fellows out of the repository; inventing
 * the *shape* would have made the test agree with the reader about something neither had checked.
 */
const HEADER = [
  "Assessment ID",
  "Session ID",
  "Assessment Result URL",
  "Assessment Name",
  "Assessment Sender Name",
  "Status",
  "Proctoring Status",
  "Test-Taker Email",
  "Test-Taker Full Name",
  "Test-Taker First Name",
  "Test-Taker Last Name",
  "Questions Attempted",
  "Questions Solved",
  "Total Questions",
  "Time Open",
  "Duration",
  "Score",
  "Max Score",
  "Assessment Score",
  "Invite Date",
  "Start Date",
  "Finish Date",
  "Expiration Date",
  "Integrity Flagged",
  "Similarity",
  "Total Paste Count",
  "Description Copy Present",
  "Typing Linearity",
  "Languages Used",
  "Labels",
].join(",");

type RowSpec = {
  sessionId: string;
  name: string;
  proctored?: boolean;
  email: string;
  fullName?: string;
  score?: string;
  maxScore?: string;
  assessmentScore?: string;
  finish?: string;
  start?: string;
  flagged?: string;
};

function row(spec: RowSpec): string {
  const fields = new Array(30).fill("");
  fields[0] = "asmt-1";
  fields[1] = spec.sessionId;
  fields[2] = `https://app.codesignal.com/result/${spec.sessionId}`;
  fields[3] = spec.name;
  fields[5] = "over";
  fields[6] = spec.proctored ? "Proctoring verified" : "Not proctored";
  fields[7] = spec.email;
  fields[8] = spec.fullName ?? "Ada Lovelace";
  fields[16] = spec.score ?? "";
  fields[17] = spec.maxScore ?? "";
  fields[18] = spec.assessmentScore ?? "";
  fields[20] = spec.start ?? "2026-08-12T15:31:21.333Z";
  fields[21] = spec.finish ?? "2026-08-12T17:20:48.324Z";
  fields[23] = spec.flagged ?? "no";
  return fields.map((f) => `"${f}"`).join(",");
}

function file(...rows: string[]): string {
  return [HEADER, ...rows].join("\r\n") + "\r\n";
}

const PROCTORED = row({
  sessionId: "s-proc",
  name: "General Coding Assessment",
  proctored: true,
  email: "Ada@Example.com",
  assessmentScore: "512",
});

const MOCK = row({
  sessionId: "s-mock",
  name: "[Mock] AI Residency GCF Test 02: 4 tasks",
  email: "ada@example.com",
  score: "840",
  maxScore: "1200",
  finish: "2026-06-01T12:00:00.000Z",
});

const EXERCISE = row({
  sessionId: "s-tip",
  name: "[TIP Practice] AI Residency group 2 10: 4 task 1 (python)",
  email: "ada@example.com",
  score: "600",
  maxScore: "900",
  finish: "2026-05-01T12:00:00.000Z",
});

describe("reading the export", () => {
  it("reads every record, whatever assessment it was", () => {
    const reading = parseGcfExport(file(PROCTORED, MOCK, EXERCISE));
    expect(reading.total).toBe(3);
    expect(reading.rows).toHaveLength(3);
    expect(reading.problems).toEqual([]);
  });

  /*
    The discriminator, and the only one. It says which assessment an attempt was in words, which is
    readable in the file by eye — where a number has to be interpreted before it says anything.
  */
  it("takes the kind from Proctoring Status", () => {
    const reading = parseGcfExport(file(PROCTORED, MOCK));
    expect(reading.rows.map((r) => r.kind)).toEqual(["PROCTORED", "MOCK"]);
  });

  it("reads a proctored score from Assessment Score, with no maximum", () => {
    const [attempt] = parseGcfExport(file(PROCTORED)).rows;
    expect(attempt).toMatchObject({ kind: "PROCTORED", score: 512, scorePossible: null });
  });

  /*
    Not a constant: a mock is 300 points a task over one, three, four, or six of them, so a real
    export carries 300, 900, 1200, and 1800 in the same column. This is why the scale is stored on
    the row rather than derived from the kind.
  */
  it("reads a mock score against whatever maximum that mock had", () => {
    const reading = parseGcfExport(
      file(
        MOCK,
        row({
          sessionId: "s-mock-2",
          name: "[Mock] short one",
          email: "ada@example.com",
          score: "240",
          maxScore: "300",
          finish: "2026-07-01T12:00:00.000Z",
        }),
      ),
    );
    expect(reading.rows.map((r) => r.scorePossible)).toEqual([1200, 300]);
  });

  it("lowercases the email, because that is how it is matched", () => {
    expect(parseGcfExport(file(PROCTORED)).rows[0]!.email).toBe("ada@example.com");
  });

  it("keeps the session id for traceability and the result URL for a link", () => {
    const [attempt] = parseGcfExport(file(PROCTORED)).rows;
    expect(attempt!.externalId).toBe("s-proc");
    expect(attempt!.resultUrl).toContain("codesignal.com");
  });

  it("reads the integrity flag", () => {
    const flagged = row({
      ...{ sessionId: "s-f", name: "[Mock] x", email: "a@b.com" },
      score: "1",
      maxScore: "300",
      flagged: "yes",
    });
    expect(parseGcfExport(file(flagged)).rows[0]!.integrityFlagged).toBe(true);
    expect(parseGcfExport(file(MOCK)).rows[0]!.integrityFlagged).toBe(false);
  });

  describe("the day it was sat", () => {
    it("comes from the finish date", () => {
      expect(parseGcfExport(file(MOCK)).rows[0]!.takenOn).toBe("2026-06-01");
    });

    it("falls back to the start date where there is no finish", () => {
      const unfinished = row({
        sessionId: "s-x",
        name: "[Mock] x",
        email: "a@b.com",
        score: "1",
        maxScore: "300",
        finish: "",
        start: "2026-04-04T09:00:00.000Z",
      });
      expect(parseGcfExport(file(unfinished)).rows[0]!.takenOn).toBe("2026-04-04");
    });

    /*
      Read off the front of the string rather than through `Date`. CodeSignal reports UTC, and any
      local-time formatting would put an attempt finished at 00:30 UTC on the previous evening in
      New York — moving the day that identifies the attempt, and with it the key an import merges
      on.
    */
    it("is the UTC day, not the reader's", () => {
      const justAfterMidnight = row({
        sessionId: "s-late",
        name: "[Mock] x",
        email: "a@b.com",
        score: "1",
        maxScore: "300",
        finish: "2026-06-02T00:30:00.000Z",
      });
      expect(parseGcfExport(file(justAfterMidnight)).rows[0]!.takenOn).toBe("2026-06-02");
    });
  });
});

describe("a row that cannot be read", () => {
  /*
    A problem rather than an exception, throughout. An import of seventy-four rows must not lose
    seventy-three of them to one bad line — and the reader has to be able to say which line, or
    nobody can go and look at it.
  */
  it("does not lose the rows around it", () => {
    const broken = row({
      sessionId: "s-bad",
      name: "[Mock] x",
      email: "",
      score: "1",
      maxScore: "300",
    });
    const reading = parseGcfExport(file(PROCTORED, broken, MOCK));

    expect(reading.rows).toHaveLength(2);
    expect(reading.problems).toHaveLength(1);
    expect(reading.total).toBe(3);
  });

  it("names the line as a spreadsheet numbers it", () => {
    const broken = row({
      sessionId: "s-bad",
      name: "[Mock] x",
      email: "",
      score: "1",
      maxScore: "300",
    });
    // Header is line 1, PROCTORED is line 2, so the broken row is line 3.
    expect(parseGcfExport(file(PROCTORED, broken)).problems[0]!.line).toBe(3);
  });

  it("reports a proctored row with no Assessment Score rather than storing a zero", () => {
    const empty = row({
      sessionId: "s-e",
      name: "General Coding Assessment",
      proctored: true,
      email: "a@b.com",
    });
    const reading = parseGcfExport(file(empty));
    expect(reading.rows).toHaveLength(0);
    expect(reading.problems[0]!.reason).toContain("Assessment Score");
  });

  it("reports a mock row with no maximum", () => {
    const noMax = row({ sessionId: "s-n", name: "[Mock] x", email: "a@b.com", score: "800" });
    expect(parseGcfExport(file(noMax)).problems[0]!.reason).toContain("Max Score");
  });

  it("reports a row with no readable date", () => {
    const undated = row({
      sessionId: "s-u",
      name: "[Mock] x",
      email: "a@b.com",
      score: "1",
      maxScore: "300",
      finish: "",
      start: "",
    });
    expect(parseGcfExport(file(undated)).problems[0]!.reason).toContain("date");
  });
});

describe("choosing which assessments are the GCF", () => {
  /*
    The one thing the file cannot decide for itself. In a real export the unproctored rows are 61
    mock GCFs and 200 class exercises, and nothing but the name tells them apart — Proctoring
    Status groups all 261 together, a Max Score of 1200 catches 46 exercises as well as every
    mock, and the `mockgcf` label is on 36 of the 61.
  */
  it("groups by assessment and counts each", () => {
    const { rows } = parseGcfExport(file(PROCTORED, MOCK, MOCK, EXERCISE, EXERCISE, EXERCISE));
    const choices = assessmentChoices(rows);

    expect(choices.map((c) => [c.name, c.count])).toEqual([
      ["General Coding Assessment", 1],
      ["[TIP Practice] AI Residency group 2 10: 4 task 1 (python)", 3],
      ["[Mock] AI Residency GCF Test 02: 4 tasks", 2],
    ]);
  });

  it("ticks proctored and [Mock], and leaves a class exercise unticked", () => {
    const { rows } = parseGcfExport(file(PROCTORED, MOCK, EXERCISE));
    const ticked = Object.fromEntries(
      assessmentChoices(rows).map((c) => [c.name, c.selectedByDefault]),
    );

    expect(ticked["General Coding Assessment"]).toBe(true);
    expect(ticked["[Mock] AI Residency GCF Test 02: 4 tasks"]).toBe(true);
    expect(ticked["[TIP Practice] AI Residency group 2 10: 4 task 1 (python)"]).toBe(false);
  });

  /*
    The prefix is a naming convention rather than a fact about the data, which is why it is a
    default rather than a rule. A mock named some other way appears in the list unticked — which
    is visible, and correctable — where a compiled-in rule would drop it and say nothing.
  */
  it("offers a mock named some other way rather than hiding it", () => {
    const oddly = row({
      sessionId: "s-odd",
      name: "GCF Rehearsal — November",
      email: "a@b.com",
      score: "700",
      maxScore: "1200",
    });
    const choices = assessmentChoices(parseGcfExport(file(oddly)).rows);

    expect(choices.map((c) => c.name)).toContain("GCF Rehearsal — November");
    expect(choices[0]!.selectedByDefault).toBe(false);
  });

  it("keeps only the rows whose assessment was ticked", () => {
    const { rows } = parseGcfExport(file(PROCTORED, MOCK, EXERCISE));
    const kept = selectRows(rows, [
      "General Coding Assessment",
      "[Mock] AI Residency GCF Test 02: 4 tasks",
    ]);

    expect(kept).toHaveLength(2);
    expect(kept.every((r) => !r.assessmentName.startsWith("[TIP"))).toBe(true);
  });
});

describe("what identifies an attempt", () => {
  it("is the fellow, the kind, and the day", () => {
    const key = attemptKey({ email: "a@b.com", kind: "MOCK", takenOn: "2026-06-01" });
    expect(key).toBe("a@b.com:MOCK:2026-06-01");
  });

  /*
    Two kinds on one day are two attempts, and the same kind on two days likewise. Only all three
    together identify one — which is what lets an import fill in a score an instructor typed by
    hand for that day rather than putting a second record beside it.
  */
  it("tells apart two kinds on one day, and one kind on two days", () => {
    const a = attemptKey({ email: "a@b.com", kind: "MOCK", takenOn: "2026-06-01" });
    const b = attemptKey({ email: "a@b.com", kind: "PROCTORED", takenOn: "2026-06-01" });
    const c = attemptKey({ email: "a@b.com", kind: "MOCK", takenOn: "2026-06-02" });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("leaves distinct attempts alone", () => {
    const { rows } = parseGcfExport(file(PROCTORED, MOCK, EXERCISE));
    expect(dedupeRows(rows)).toMatchObject({ collapsed: 0 });
  });

  /*
    Should not arise — a real export produces 74 distinct triples from its 74 GCF rows — but the
    database enforces the same uniqueness, so a duplicate that reached the write would fail an
    import half way rather than showing up in the preview where somebody could see it.
  */
  it("collapses two rows describing one attempt", () => {
    const { rows } = parseGcfExport(file(MOCK, MOCK));
    const deduped = dedupeRows(rows);
    expect(deduped.rows).toHaveLength(1);
    expect(deduped.collapsed).toBe(1);
  });
});
