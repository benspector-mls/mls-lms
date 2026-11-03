import { testDisplay, testMatches, testsInFile } from "@/lib/assignments/test-names";

/**
 * Reading a suite's tests from its files, and deciding which run results are a section's own.
 */

describe("reading a Jest file", () => {
  it("reads each title under the describe blocks above it, joined the way the run reports them", () => {
    const file = `
describe('From Scratch', () => {
  // it('commented out', () => {});
  describe("is even", () => {
    it('returns true for evens', () => { expect(isEven(2)).toBe(true); });
    test(\`returns false for odds\`, () => {});
  });
  it.skip('loop5to10 - logs 5 to 10', () => {
    const text = "it('not a test', () => {})";
  });
});
it('top level', () => {});
`;
    expect(testsInFile("tests/from-scratch.spec.js", file)).toEqual([
      {
        path: "tests/from-scratch.spec.js",
        suite: "From Scratch › is even",
        name: "returns true for evens",
      },
      {
        path: "tests/from-scratch.spec.js",
        suite: "From Scratch › is even",
        name: "returns false for odds",
      },
      {
        path: "tests/from-scratch.spec.js",
        suite: "From Scratch",
        name: "loop5to10 - logs 5 to 10",
      },
      { path: "tests/from-scratch.spec.js", suite: null, name: "top level" },
    ]);
  });

  it("stores no suite under a describe named by an expression, since the file does not say it", () => {
    const file = `
const testSuiteName = 'From Scratch';
describe(testSuiteName, () => {
  it('loop0UpTo10 - it logs from 0 to 10', () => {});
  describe('nested', () => {
    it('inner', () => {});
  });
});
`;
    expect(testsInFile("tests/a.spec.js", file).map((test) => [test.suite, test.name])).toEqual([
      [null, "loop0UpTo10 - it logs from 0 to 10"],
      [null, "inner"],
    ]);
  });

  it("resolves escapes in a title and skips a template title with a placeholder", () => {
    const file = `
describe('A', () => {
  it('it\\'s even', () => {});
  it(\`returns \${n}\`, () => {});
  it("says \\"hi\\"", () => {});
});
`;
    expect(testsInFile("t.js", file).map((test) => test.name)).toEqual(["it's even", 'says "hi"']);
  });

  it("closes a describe at the brace that opened it, not at a brace inside a test", () => {
    const file = `
describe('A', () => {
  it('one', () => { if (x) { y(); } });
});
describe('B', () => {
  it('two', () => {});
});
`;
    expect(testsInFile("t.js", file).map((test) => test.suite)).toEqual(["A", "B"]);
  });
});

describe("reading a pytest file", () => {
  it("reads each test function under its file, and under its class where it has one", () => {
    const file = `
import pytest

def test_calculate_area():
    assert True

class TestEven:
    def test_is_even(self):
        assert True

    async def test_is_evenly_spaced(self):
        pass

def test_after_class():
    pass
`;
    expect(testsInFile("tests/test_from_scratch.py", file)).toEqual([
      {
        path: "tests/test_from_scratch.py",
        suite: "tests/test_from_scratch.py",
        name: "test_calculate_area",
      },
      {
        path: "tests/test_from_scratch.py",
        suite: "tests/test_from_scratch.py::TestEven",
        name: "test_is_even",
      },
      {
        path: "tests/test_from_scratch.py",
        suite: "tests/test_from_scratch.py::TestEven",
        name: "test_is_evenly_spaced",
      },
      {
        path: "tests/test_from_scratch.py",
        suite: "tests/test_from_scratch.py",
        name: "test_after_class",
      },
    ]);
  });
});

describe("matching a run's test to a chosen one", () => {
  it("matches by name alone when no suite was stored", () => {
    expect(
      testMatches({ suite: null, name: "returns true" }, { suite: "A", name: "returns true" }),
    ).toBe(true);
    expect(
      testMatches({ suite: null, name: "returns true" }, { suite: "A", name: "returns truer" }),
    ).toBe(false);
  });

  it("matches by suite and name when a suite was stored, so two like titles stay apart", () => {
    const chosen = { suite: "From Scratch › is even", name: "returns true" };
    expect(testMatches(chosen, { suite: "From Scratch › is even", name: "returns true" })).toBe(
      true,
    );
    expect(testMatches(chosen, { suite: "From Scratch › is odd", name: "returns true" })).toBe(
      false,
    );
  });

  it("counts every parameter case of a chosen pytest function, and allows a longer path root", () => {
    const chosen = { suite: "tests/test_sum.py", name: "test_sum" };
    expect(testMatches(chosen, { suite: "tests/test_sum.py", name: "test_sum[3]" })).toBe(true);
    expect(testMatches(chosen, { suite: "repo/tests/test_sum.py", name: "test_sum" })).toBe(true);
    expect(testMatches(chosen, { suite: "tests/test_sum.py", name: "test_summary" })).toBe(false);
  });

  it("displays a test as its suite and name", () => {
    expect(testDisplay({ suite: "is even", name: "returns true" })).toBe("is even: returns true");
    expect(testDisplay({ suite: null, name: "top level" })).toBe("top level");
  });
});
