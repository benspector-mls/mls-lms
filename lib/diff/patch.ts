/**
 * A unified diff, as the hunks and lines a diff viewer draws.
 *
 * **Written for GitHub's per-file `patch` and not for a diff file.** That distinction is the
 * whole design. The `patch` field on `GET /repos/{owner}/{repo}/pulls/{n}/files` begins at the
 * first `@@` — there is no `diff --git`, no `index`, and crucially no `--- a/x` / `+++ b/x` pair —
 * so a line reading `+++ b/README.md` inside one of these is **an added line whose text is
 * `++ b/README.md`**. A general-purpose parser that recognises file headers would silently
 * swallow it. Dispatch is therefore on the first character alone, and only while inside a hunk.
 *
 * Pure, and no `server-only`: the browser parses the patch it was sent. Sending parsed lines
 * instead would double or treble the payload — a line as JSON is about eighty bytes carrying
 * roughly twenty bytes of information — and the browser is where the work is wanted anyway, since
 * a file's card parses and highlights only once somebody expands it.
 *
 * Total, never throwing. Anything unrecognised goes to `unparsed` rather than aborting the parse,
 * so a shape GitHub adds later costs a missing line rather than an empty panel.
 */

export type DiffLineKind = "add" | "remove" | "context";

export type DiffLine = {
  kind: DiffLineKind;
  /** The line's number in the base file, or null on an added line. */
  oldLine: number | null;
  /** The line's number in the head file, or null on a removed line. */
  newLine: number | null;
  /**
   * The line's text with the leading `+`, `-`, or space removed.
   *
   * **A trailing carriage return is kept.** Stripping it would turn a Windows student's
   * line-ending commit — every line changed, every line looking identical — into a diff nobody
   * can explain, which is the one case where an invisible character is the entire content of the
   * change. The renderer shows it; the parser does not decide about it.
   *
   * The marker is removed rather than kept so that selecting a block of this and pasting it
   * produces code that compiles.
   */
  text: string;
  /** True when git followed this line with `\ No newline at end of file`. */
  noNewlineAtEof: boolean;
};

export type DiffHunk = {
  /** The `@@` line as git wrote it, minus any trailing carriage return. */
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** What git wrote after the closing `@@` — usually the enclosing function. Null when empty. */
  section: string | null;
  lines: DiffLine[];
};

export type ParsedPatch = {
  hunks: DiffHunk[];
  /**
   * Lines the parser did not recognise, kept rather than dropped.
   *
   * Empty for every patch this endpoint sends. It is what lets the parser be total instead of
   * throwing, and it is not rendered: a reader is better served by a diff missing an oddity than
   * by no diff at all.
   */
  unparsed: string[];
};

/**
 * `@@ -12,7 +12,9 @@ function useThing() {`
 *
 * An omitted count means one, because git writes `@@ -1 +1 @@` for a single-line side. A count of
 * zero is legal and means that side is empty, as in `@@ -0,0 +1,3 @@` for a new file; the numbers
 * are recorded as written and the line walk below only advances on lines that exist, so a zero
 * count never produces a line number.
 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Not a line of the file, and it can appear twice in one hunk — once per side. */
const NO_NEWLINE = "\\ No newline at end of file";

/** One trailing carriage return, off the lines whose shape has to be matched. */
function withoutCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

export function parseUnifiedPatch(patch: string): ParsedPatch {
  const hunks: DiffHunk[] = [];
  const unparsed: string[] = [];

  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const lines = patch.split("\n");
  // A patch ending in a newline splits to a final empty string that is not a line of the file.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  for (const line of lines) {
    const structural = withoutCr(line);

    const header = HUNK_HEADER.exec(structural);
    if (header) {
      current = {
        header: structural,
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        section: header[5] === "" ? null : header[5],
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }

    // Before the first `@@`: `diff --git`, `index`, `Binary files … differ`. Not in these patches,
    // and kept rather than thrown at.
    if (!current) {
      unparsed.push(line);
      continue;
    }

    if (structural === NO_NEWLINE) {
      /*
        Attached to the line immediately before it, not to the hunk's last line. Git emits it
        twice in one hunk when a file's final line changes — once after the removed version and
        once after the added one — and only the preceding line is the one it describes.
      */
      const previous = current.lines[current.lines.length - 1];
      if (previous) previous.noNewlineAtEof = true;
      else unparsed.push(line);
      continue;
    }

    /*
      An empty string is an empty context line. Git writes one as a single space, but anything
      that trims trailing whitespace on the way here drops it — and reading it as unparsed would
      lose a line of the student's file without saying so.
    */
    if (line === "") {
      current.lines.push({
        kind: "context",
        oldLine: oldLine++,
        newLine: newLine++,
        text: "",
        noNewlineAtEof: false,
      });
      continue;
    }

    // The first character and nothing else. See the note at the top about `+++`.
    const marker = line[0];
    const text = line.slice(1);

    if (marker === "+") {
      current.lines.push({
        kind: "add",
        oldLine: null,
        newLine: newLine++,
        text,
        noNewlineAtEof: false,
      });
    } else if (marker === "-") {
      current.lines.push({
        kind: "remove",
        oldLine: oldLine++,
        newLine: null,
        text,
        noNewlineAtEof: false,
      });
    } else if (marker === " ") {
      current.lines.push({
        kind: "context",
        oldLine: oldLine++,
        newLine: newLine++,
        text,
        noNewlineAtEof: false,
      });
    } else {
      unparsed.push(line);
    }
  }

  return { hunks, unparsed };
}

/** Bytes rather than characters, because a ceiling on a payload is a ceiling on bytes. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The largest run of whole hunks from the front of `patch` that fits in `maxBytes`, or `""` when
 * even the first hunk does not.
 *
 * **Cut at a hunk boundary rather than at a byte, which is what lets the parser stay total.** A
 * patch severed mid-hunk has a header promising more lines than follow, and every reader of it
 * then has to decide what half a hunk means. Cutting here means no reader ever has to.
 *
 * An empty result is not an error: it renders as the same "open it on GitHub" state a file GitHub
 * sent no patch for gets, so one state serves both.
 */
export function truncateAtHunkBoundary(patch: string, maxBytes: number): string {
  if (byteLength(patch) <= maxBytes) return patch;

  const hunks: string[] = [];
  let current: string[] | null = null;

  for (const line of patch.split("\n")) {
    if (HUNK_HEADER.test(withoutCr(line))) {
      if (current) hunks.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    }
    // Anything before the first `@@` is dropped. These patches have nothing there.
  }
  if (current) hunks.push(current.join("\n"));

  let kept = "";
  for (const hunk of hunks) {
    const candidate = kept === "" ? hunk : `${kept}\n${hunk}`;
    if (byteLength(candidate) > maxBytes) break;
    kept = candidate;
  }
  return kept;
}
