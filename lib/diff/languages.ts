import { extensionOf } from "@/lib/uploads/file-types";

/**
 * The languages a diff is highlighted in, and nothing more.
 *
 * **A closed union rather than the six hundred a highlighter ships with**, for the reason
 * `UPLOAD_FILE_TYPES` is a closed list: every member is a grammar that costs bytes in an
 * instructor's browser, and the curriculum this application serves is a PERN stack. Eleven
 * grammars come to roughly 126 kilobytes gzipped between them, and a typical submission loads
 * two of them.
 *
 * The grammar loaders in `components/code-highlighter.ts` are keyed by this union with
 * `satisfies`, so adding a member here without a way to load it fails to compile rather than
 * failing to colour.
 */
export type DiffLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "json"
  | "css"
  | "html"
  | "markdown"
  | "sql"
  | "shellscript"
  | "python";

/**
 * Extension to grammar, lowercased.
 *
 * `.scss` and `.less` are read as CSS, which is imperfect — neither language's nesting is CSS —
 * and better than the alternative, which is a student's stylesheet in one colour. `.mdx` is read
 * as Markdown for the same reason.
 */
const BY_EXTENSION: Record<string, DiffLanguage> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".json": "json",
  ".jsonc": "json",
  ".css": "css",
  ".scss": "css",
  ".less": "css",
  ".html": "html",
  ".htm": "html",
  ".hbs": "html",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".sql": "sql",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".py": "python",
};

/**
 * Which grammar a changed file's diff should be read with, or null for plain monospace.
 *
 * **Null is not a failure and never becomes an error state.** It is the right answer for a
 * `.gitignore`, a `Dockerfile`, a `.yml`, and a lockfile — files that are perfectly readable as
 * monospace with the added and removed lines tinted. Nothing downstream treats it as a problem.
 *
 * `.env` and its variants are read as shell, which is what they are. They are highlighted rather
 * than hidden on purpose: a committed `.env` is a teaching moment, and the instructor is the
 * person who tells the student to rotate the key.
 */
export function languageForPath(path: string): DiffLanguage | null {
  const basename = (path.split("/").pop() ?? "").toLowerCase();

  // Before the extension check, because `.env.local`'s last dotted segment is `.local`.
  if (basename === ".env" || basename.startsWith(".env.")) return "shellscript";

  // The same string function the upload rules use, rather than a second idea of what an
  // extension is: the last dotted segment, lowercased, so `src/v1.2/index.ts` is TypeScript.
  const extension = extensionOf(basename);
  return extension ? (BY_EXTENSION[extension] ?? null) : null;
}

/** Every language reachable from a path, which is what the grammar loaders have to cover. */
export const DIFF_LANGUAGES = Object.freeze([
  ...new Set(Object.values(BY_EXTENSION)),
]) as readonly DiffLanguage[];
