import { redact, type RedactionNames } from "@/lib/coaching/redact";
import { generateCoachingSummary, type CoachingSummaryInput } from "@/lib/coaching/summary";

/**
 * What Themes hides from Anthropic. Three properties are held here: no name of the fellow, a
 * classmate or a member of staff survives redaction, and no listed sensitive term does; each
 * placeholder stands for one word throughout a prompt; and `restore` puts every placeholder in
 * Claude's answer back. The last block checks that `generateCoachingSummary` sends only the
 * redacted prompt and returns the restored answer.
 */

const mockParse = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { parse: mockParse } })),
}));

const names: RedactionNames = {
  fellow: {
    displayName: "Maria Lopez",
    email: "maria.lopez@example.com",
    githubUsername: "mlopez-dev",
  },
  others: [
    { displayName: "José Chen", email: "jose@example.com", githubUsername: null },
    // Shares the fellow's first name, which stays the fellow's.
    { displayName: "Maria Okafor", email: null, githubUsername: "mokafor" },
    { displayName: "Dana O'Brien", email: null, githubUsername: null },
  ],
};

const nobody: RedactionNames = {
  fellow: { displayName: null, email: null, githubUsername: null },
  others: [],
};

describe("redact: names", () => {
  it("replaces every form of the fellow's name with 'the fellow'", () => {
    const { text } = redact(
      "Maria Lopez said Maria's tests pass; maria pushed as mlopez-dev from maria.lopez@example.com. Lopez agreed.",
      names,
    );
    expect(text).toBe(
      "the fellow said the fellow's tests pass; the fellow pushed as the fellow from the fellow. the fellow agreed.",
    );
  });

  it("gives everyone else a numbered placeholder, the same one each time", () => {
    const { text } = redact(
      "José paired with Okafor; José Chen met Dana O'Brien, and josé left.",
      names,
    );
    expect(text).toBe("person_1 paired with person_2; person_3 met person_4, and person_1 left.");
  });

  it("keeps a first name the fellow shares with a classmate as the fellow's", () => {
    expect(redact("Maria Okafor and Maria", names).text).toBe("person_1 and the fellow");
  });

  it("leaves a name that is only part of a longer word", () => {
    expect(redact("Marianne asked about Lopezville.", names).text).toBe(
      "Marianne asked about Lopezville.",
    );
  });

  it("hides nothing when there are no names to hide", () => {
    expect(redact("Maria Lopez", nobody).text).toBe("Maria Lopez");
  });
});

describe("redact: sensitive terms", () => {
  it("numbers each distinct term in the order it first appears", () => {
    const { text } = redact(
      "A court date about immigration. The Court moved it; immigration lawyers called.",
      nobody,
    );
    expect(text).toBe(
      "A personal_matter_1 date about personal_matter_2. The personal_matter_1 moved it; personal_matter_2 personal_matter_3 called.",
    );
  });

  it("matches a phrase, and leaves a term that is only part of a longer word", () => {
    expect(redact("Her green card arrived; the courtyard was quiet.", nobody).text).toBe(
      "Her personal_matter_1 arrived; the courtyard was quiet.",
    );
  });
});

describe("redact: restore", () => {
  it("puts back each placeholder as it was first written, however Claude spells it", () => {
    const { restore } = redact("José mentioned an Eviction notice.", names);
    expect(restore("Ask person_1 about the Personal Matter 1 notice.")).toBe(
      "Ask José about the Eviction notice.",
    );
  });

  it("leaves a placeholder it never issued alone", () => {
    const { restore } = redact("Nothing here.", names);
    expect(restore("person_7 and personal_matter_2")).toBe("person_7 and personal_matter_2");
  });
});

const input: CoachingSummaryInput = {
  previous: null,
  standing: null,
  writing: null,
  sessions: {
    items: [
      {
        heldOn: "2026-10-02",
        answers: [
          { prompt: "What has been on your mind lately?", answer: "Maria's immigration hearing." },
        ],
      },
    ],
    skipped: 0,
  },
  notes: [{ on: "2026-10-03", edited: false, body: "José Chen said Maria Lopez missed court." }],
  feedback: null,
  focus: null,
};

describe("generateCoachingSummary", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("sends only the redacted prompt, and restores Claude's answer", async () => {
    mockParse.mockResolvedValueOnce({
      stop_reason: "end_turn",
      model: "claude-sonnet-5",
      usage: { input_tokens: 10, output_tokens: 10 },
      parsed_output: {
        themes: [
          {
            status: "new",
            title: "personal_matter_1",
            callout: "Session 2026-10-02: the fellow raised personal_matter_1.",
            question: "Ask whether person_1 knows about the personal_matter_2 date.",
            evidence: ["Note, 2026-10-03: person_1 mentioned personal_matter_2."],
            reasoning: "Two records.",
          },
        ],
      },
    });

    const result = await generateCoachingSummary(input, names);

    const sent = mockParse.mock.calls[0][0].messages[0].content as string;
    for (const hidden of ["Maria", "Lopez", "José", "Chen", "immigration", "court"]) {
      expect(sent).not.toContain(hidden);
    }
    expect(sent).toContain("the fellow's personal_matter_1 hearing");
    expect(sent).toContain("person_1 said the fellow missed personal_matter_2");

    expect(result.summary.themes[0]).toEqual({
      status: "new",
      title: "immigration",
      callout: "Session 2026-10-02: the fellow raised immigration.",
      question: "Ask whether José Chen knows about the court date.",
      evidence: ["Note, 2026-10-03: José Chen mentioned court."],
      reasoning: "Two records.",
    });
  });
});
