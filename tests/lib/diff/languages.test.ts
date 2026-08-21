import { DIFF_LANGUAGES, languageForPath, type DiffLanguage } from "@/lib/diff/languages";

/**
 * Which grammar a changed file is read with.
 *
 * The interesting assertion is the second one below: every member of the union has to be
 * reachable from some path. A language in the union that no file can produce is a grammar sitting
 * in an instructor's browser bundle that nothing will ever load, and nothing else in the
 * application would notice.
 */
describe("languageForPath", () => {
  it.each([
    ["src/app/page.tsx", "tsx"],
    ["lib/status.ts", "typescript"],
    ["scripts/tool.mts", "typescript"],
    ["scripts/tool.cts", "typescript"],
    ["src/index.js", "javascript"],
    ["src/index.mjs", "javascript"],
    ["src/index.cjs", "javascript"],
    ["src/App.jsx", "jsx"],
    ["package.json", "json"],
    ["tsconfig.jsonc", "json"],
    ["app/globals.css", "css"],
    ["styles/main.scss", "css"],
    ["styles/main.less", "css"],
    ["public/index.html", "html"],
    ["public/index.htm", "html"],
    ["views/card.hbs", "html"],
    ["README.md", "markdown"],
    ["docs/guide.markdown", "markdown"],
    ["docs/guide.mdx", "markdown"],
    ["prisma/seed.sql", "sql"],
    ["bin/setup.sh", "shellscript"],
    ["bin/setup.bash", "shellscript"],
    ["bin/setup.zsh", "shellscript"],
    ["scripts/tool.py", "python"],
  ])("reads %s as %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  it("covers every language in the union", () => {
    // Each of these is the cheapest path that reaches its grammar. A member with no row here is a
    // grammar the bundle carries and nothing can ask for.
    const reachable = new Set<DiffLanguage>(
      [
        "a.ts",
        "a.tsx",
        "a.js",
        "a.jsx",
        "a.json",
        "a.css",
        "a.html",
        "a.md",
        "a.sql",
        "a.sh",
        "a.py",
      ]
        .map(languageForPath)
        .filter((language): language is DiffLanguage => language !== null),
    );
    expect([...reachable].sort()).toEqual([...DIFF_LANGUAGES].sort());
  });

  describe("a committed environment file", () => {
    // Read rather than hidden: the instructor is the person who tells the student to rotate it.
    it.each([".env", ".env.local", ".env.production", "apps/web/.env.test"])(
      "reads %s as shell",
      (path) => {
        expect(languageForPath(path)).toBe("shellscript");
      },
    );
  });

  describe("what has no grammar, which is not a failure", () => {
    it.each([
      [".gitignore"],
      ["Dockerfile"],
      ["Makefile"],
      ["LICENSE"],
      [".github/workflows/ci.yml"],
      ["config.yaml"],
      ["logo.png"],
      ["src/"],
      [""],
    ])("reads %s as plain monospace", (path) => {
      expect(languageForPath(path)).toBeNull();
    });
  });

  it("ignores case in the extension", () => {
    expect(languageForPath("README.MD")).toBe("markdown");
    expect(languageForPath("src/App.TSX")).toBe("tsx");
  });

  it("takes the file's extension rather than a directory's", () => {
    expect(languageForPath("src/v1.2/index.ts")).toBe("typescript");
    // A directory with a dot and a file with none: nothing to read it as.
    expect(languageForPath("src/v1.2/Dockerfile")).toBeNull();
  });
});
