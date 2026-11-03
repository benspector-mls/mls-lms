import {
  namedAfter,
  proposeSections,
  type TemplateContents,
} from "@/lib/assignments/propose-sections";

/**
 * What a template implies about an assignment's sections.
 *
 * The three shapes the program's templates take: a short response file with a heading per
 * question, a coding README with a heading per exercise and a test named after each function,
 * and a frontend README with a checklist. Each case holds the reading that decides a section,
 * because a proposal that read a heading wrongly would be adopted as-is by an instructor who
 * trusts it.
 */

function keys() {
  let n = 0;
  return () => `k${++n}`;
}

const empty: TemplateContents = { shortResponse: null, readme: null, tests: [], hasRunner: false };

const shortResponse = `# Short Responses

Aim to write a response with the following qualities:

- [ ] Addresses all parts of the prompt

## Question 1

### Prompt 1

Explain what a **function** is, using these terms: parameter, argument, return.

### Response 1

Your response here...

\`\`\`python
# Your example here
\`\`\`

## Question 2

### Prompt 2

Compare a \`for\` loop with a \`while\` loop.

### Response 2

Your response here...
`;

describe("a short response", () => {
  it("proposes one section per question, worth 3, with its prompt, and one writing section", () => {
    const { sections, notes } = proposeSections({ ...empty, shortResponse }, keys());
    expect(sections.map((s) => [s.key, s.label, s.pointValue, s.type])).toEqual([
      ["k1", "Question 1", 3, "short_response"],
      ["k2", "Question 2", 3, "short_response"],
      ["k3", "Writing Quality", 3, "short_response_writing"],
    ]);
    expect(sections[0]!.text).toContain("Explain what a **function** is");
    expect(sections[0]!.text).not.toContain("Your response here");
    expect(sections[1]!.text).toContain("Compare a `for` loop");
    // The checklist at the top of the file is advice, not sections.
    expect(sections.some((s) => s.label.startsWith("Addresses"))).toBe(false);
    expect(notes).toEqual([]);
  });

  it("says so when the file has no question headings", () => {
    const { sections, notes } = proposeSections(
      { ...empty, shortResponse: "# Short Responses\n\nWrite here." },
      keys(),
    );
    expect(sections).toEqual([]);
    expect(notes[0]).toMatch(/no `## Question N` headings/);
  });
});

const readme = `# Data Types

- [Setup](#setup)

## Setup

\`\`\`sh
# not a heading: ## inside a fence
\`\`\`

## From Scratch

### Question 1: \`calculate_area\`

Write a function \`calculate_area\` that returns the area.

### Question 2: \`is_even\`

Return True for even numbers.

## Modify

### Question 3: \`return\` vs \`print\`

Make each function return its result.

## Debug

### Question 4: Fix our mess of a function

Read the tests.
`;

const pytest = `from from_scratch import calculate_area, is_even


def test_calculate_area():
    assert calculate_area(5, 3) == 15


def test_is_even():
    assert is_even(2) is True

def test_is_evenly_spaced():
    assert True
`;

describe("a coding assignment", () => {
  it("proposes one section per exercise under its README heading, with a test pattern per function", () => {
    const { sections, notes } = proposeSections(
      {
        ...empty,
        readme,
        tests: [{ path: "tests/test_from_scratch.py", content: pytest }],
        hasRunner: true,
      },
      keys(),
    );
    expect(sections.map((s) => [s.label, s.heading, s.pointValue, s.type])).toEqual([
      ["Question 1: calculate_area", "From Scratch", 3, "coding_algorithm"],
      ["Question 2: is_even", "From Scratch", 3, "coding_algorithm"],
      ["Question 3: return vs print", "Modify", 3, "coding_algorithm"],
      ["Question 4: Fix our mess of a function", "Debug", 3, "coding_algorithm"],
    ]);
    expect(sections[0]!.tests).toEqual([
      { suite: "tests/test_from_scratch.py", name: "test_calculate_area" },
    ]);
    expect(sections[1]!.tests).toEqual([
      { suite: "tests/test_from_scratch.py", name: "test_is_even" },
    ]);
    expect(sections[0]!.text).toContain("returns the area");
    // No function in the heading, or no test named after it: left for the instructor, and said.
    expect(sections[2]!.tests).toBeUndefined();
    expect(sections[3]!.tests).toBeUndefined();
    expect(notes).toEqual([
      "Question 3: return vs print: no test is named after `return`, so none was chosen.",
      "Question 4: Fix our mess of a function: the heading names no function, so no test was chosen.",
    ]);
  });

  it("reads a function named after the colon without backticks, whatever its case in the test", () => {
    const bare = `## From Scratch Questions

### Question 1: loop0UpTo10

### Question 2: fizzBuzz

### Question 3: return vs print
`;
    const jest = `describe('From Scratch', () => {
  it('loop0UpTo10 - it logs from 0 to 10', () => {});
  it('fizzbuzz - it logs fizz, buzz, fizzbuzz, or the number', () => {});
});`;
    const { sections, notes } = proposeSections(
      {
        ...empty,
        readme: bare,
        tests: [{ path: "tests/from-scratch.spec.js", content: jest }],
        hasRunner: true,
      },
      keys(),
    );
    expect(sections.map((s) => s.tests)).toEqual([
      [{ suite: "From Scratch", name: "loop0UpTo10 - it logs from 0 to 10" }],
      [{ suite: "From Scratch", name: "fizzbuzz - it logs fizz, buzz, fizzbuzz, or the number" }],
      undefined,
    ]);
    expect(notes).toEqual([
      "Question 3: return vs print: the heading names no function, so no test was chosen.",
    ]);
  });

  it("sets no test pattern when the assignment runs no suite", () => {
    const { sections, notes } = proposeSections(
      { ...empty, readme, tests: [{ path: "tests/test_from_scratch.py", content: pytest }] },
      keys(),
    );
    expect(sections.every((s) => s.tests === undefined)).toBe(true);
    expect(notes).toEqual([]);
  });

  it("names a test that two exercises' patterns both match", () => {
    const twice = `## Exercises

### Question 1: \`greet\`

### Question 2: \`greet_all\`
`;
    const tests = `def test_greet():\n    pass\n\ndef test_greet_all():\n    pass\n`;
    const { notes } = proposeSections(
      { ...empty, readme: twice, tests: [{ path: "t.py", content: tests }], hasRunner: true },
      keys(),
    );
    expect(notes).toEqual([
      'The test "t.py: test_greet_all" is named after both Question 1: greet and Question 2: greet_all; choose for one of them.',
    ]);
  });
});

describe("a frontend checklist", () => {
  it("proposes one section per checklist item under its heading, worth 1", () => {
    const checklist = `# Fetch Practice

## Section 1: Setup

- [ ] The page loads without errors

## Section 2: Fetch Helpers

- [ ] \`fetchData\` returns the parsed body
- [x] Errors are caught
`;
    const { sections } = proposeSections({ ...empty, readme: checklist }, keys());
    expect(sections.map((s) => [s.label, s.heading, s.pointValue, s.type])).toEqual([
      ["The page loads without errors", "Section 1: Setup", 1, "coding_frontend"],
      ["fetchData returns the parsed body", "Section 2: Fetch Helpers", 1, "coding_frontend"],
      ["Errors are caught", "Section 2: Fetch Helpers", 1, "coding_frontend"],
    ]);
  });
});

describe("naming a test after a function", () => {
  it("bounds the name so a prefix of a longer name does not match, in suite or name, any case", () => {
    const named = (suite: string | null, name: string) => namedAfter("is_even", { suite, name });
    expect(named("tests/t.py", "test_is_even")).toBe(true);
    expect(named(null, "isEven - logs")).toBe(true);
    expect(named("tests/t.py", "test_is_evenly_spaced")).toBe(false);
    expect(named("is_even", "returns true")).toBe(true);
    expect(namedAfter("isEven", { suite: "From Scratch", name: "isEven - logs the evens" })).toBe(
      true,
    );
    expect(namedAfter("fizzBuzz", { suite: null, name: "fizzbuzz - counts" })).toBe(true);
    // One function, two spellings: a README in snake case over a suite in camel case, or the reverse.
    expect(namedAfter("is_even", { suite: null, name: "isEven - logs the evens" })).toBe(true);
    expect(namedAfter("isEven", { suite: "tests/t.py", name: "test_is_even" })).toBe(true);
    expect(namedAfter("is_even", { suite: null, name: "isEvenly - logs" })).toBe(false);
  });
});

describe("nothing to propose", () => {
  it("says so", () => {
    const { sections, notes } = proposeSections(empty, keys());
    expect(sections).toEqual([]);
    expect(notes).toHaveLength(1);
  });
});
