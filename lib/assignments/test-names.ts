/**
 * The tests a template's suite declares, read from the files, and whether a test a run reports
 * is one a section chose.
 *
 * **A section names its tests, it does not describe them.** A coding section lists the tests
 * that count toward it as `{ suite, name }` pairs picked from the template's suite, in the terms
 * the run reports: for Jest the `it` title and the describe titles above it joined with ` › `,
 * for pytest the function and the file it is in. The section editor offers the list this module
 * reads; the proposal pre-selects from it; and at grading time `testMatches` decides which of
 * the run's tests are a section's own.
 *
 * **A suite the file does not state is stored as null.** `describe(testSuiteName, …)` names its
 * block with a variable, which a static read cannot resolve, so a test under it is stored with
 * no suite and matched by name alone. A test under literal describe blocks is matched by suite
 * and name, which is what tells two tests titled "returns true" under different blocks apart.
 *
 * Browser-safe and importing nothing, since the editor shows what this reads.
 */

/** One test as a section stores it: the suite the run reports it under, or null, and its name. */
export type DeclaredTest = { suite: string | null; name: string };

/** One test as the template declares it: where it was read from, beside what a section stores. */
export type TemplateTest = DeclaredTest & { path: string };

/** The tests one file declares, by the file's extension. */
export function testsInFile(path: string, content: string): TemplateTest[] {
  if (/\.py$/i.test(path)) return pytestTests(path, content);
  if (/\.(js|mjs|cjs|ts|jsx|tsx)$/i.test(path)) return jestTests(path, content);
  return [];
}

/**
 * Jest: every `it(` or `test(` whose title is a string literal, under the `describe(` blocks it
 * sits in. The read walks the file once, skipping strings and comments and counting braces, so a
 * describe's block is the braces that open after its call and close at the same depth.
 */
function jestTests(path: string, content: string): TemplateTest[] {
  const tests: TemplateTest[] = [];
  /** The open describe blocks: the title, or null for one named by an expression, at its depth. */
  const blocks: { title: string | null; depth: number }[] = [];
  /** A describe call seen whose block has not opened yet. */
  let opening: { title: string | null } | null = null;
  let depth = 0;
  let i = 0;

  while (i < content.length) {
    const ch = content[i]!;
    if (ch === "/" && content[i + 1] === "/") {
      const end = content.indexOf("\n", i);
      i = end === -1 ? content.length : end;
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      const end = content.indexOf("*/", i + 2);
      i = end === -1 ? content.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      i = endOfString(content, i);
      continue;
    }
    if (ch === "{") {
      depth += 1;
      if (opening) {
        blocks.push({ title: opening.title, depth });
        opening = null;
      }
      i += 1;
      continue;
    }
    if (ch === "}") {
      if (blocks[blocks.length - 1]?.depth === depth) blocks.pop();
      depth -= 1;
      i += 1;
      continue;
    }

    const call = /^(describe|context|it|test)(?:\.(?:only|skip|todo|concurrent|each))?\s*\(/.exec(
      content.slice(i, i + 40),
    );
    if (call && !/[\w$.]/.test(content[i - 1] ?? " ")) {
      const after = i + call[0].length;
      const literal = /^\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(content.slice(after, after + 1000));
      // As the run will report it: escapes resolved, and a template literal with a placeholder
      // is a title the file does not state, so it is treated like a variable.
      const title =
        literal === null || (literal[1] === "`" && literal[2]!.includes("${"))
          ? null
          : literal[2]!.replace(/\\(.)/g, "$1");
      if (call[1] === "describe" || call[1] === "context") {
        opening = { title };
      } else if (title !== null) {
        tests.push({ path, suite: suiteOf(blocks), name: title });
      }
      i = after;
      continue;
    }
    i += 1;
  }
  return tests;
}

/** The index just past a string that opens at `start`, or the end of its line for a broken one. */
function endOfString(content: string, start: number): number {
  const quote = content[start]!;
  let i = start + 1;
  while (i < content.length) {
    const ch = content[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === "\n" && quote !== "`") return i;
    i += 1;
  }
  return content.length;
}

/** The describe path the run will report, or null if any block's title is not in the file. */
function suiteOf(blocks: { title: string | null }[]): string | null {
  if (blocks.length === 0) return null;
  if (blocks.some((block) => block.title === null)) return null;
  return blocks.map((block) => block.title).join(" › ");
}

/**
 * pytest: every `def test_…(`, under the file it is in and the `class` it is indented inside,
 * which is the node id the run reports split at its last `::`.
 */
function pytestTests(path: string, content: string): TemplateTest[] {
  const tests: TemplateTest[] = [];
  let within: { name: string; indent: number } | null = null;
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (within && indent <= within.indent) within = null;
    const cls = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (cls) {
      within = { name: cls[1]!, indent };
      continue;
    }
    const def = /^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/.exec(line);
    if (def) {
      tests.push({ path, suite: within ? `${path}::${within.name}` : path, name: def[1]! });
    }
  }
  return tests;
}

/**
 * Whether a test the run reports is one a section chose.
 *
 * Names must agree, allowing pytest's parameter suffix, so a chosen `test_sum` counts every
 * `test_sum[…]` case. Suites must agree where the section stored one; a stored suite that is a
 * file path also matches a run suite that ends with it, since the run may report the path from
 * a different root.
 */
export function testMatches(chosen: DeclaredTest, run: { suite: string; name: string }): boolean {
  const sameName = run.name === chosen.name || run.name.startsWith(`${chosen.name}[`);
  if (!sameName) return false;
  if (chosen.suite === null) return true;
  return (
    run.suite === chosen.suite ||
    run.suite.endsWith(`/${chosen.suite}`) ||
    chosen.suite.endsWith(`/${run.suite}`)
  );
}

/** "is even: returns true", or the name alone for a test stored with no suite. */
export function testDisplay(test: DeclaredTest): string {
  return test.suite === null ? test.name : `${test.suite}: ${test.name}`;
}

/** One string per test, equal for two entries naming the same test, for sets and maps. */
export function testKey(test: DeclaredTest): string {
  return `${test.suite ?? ""}\u0000${test.name}`;
}
