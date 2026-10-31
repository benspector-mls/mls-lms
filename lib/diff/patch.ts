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

/** The characters of a line that changed, as offsets into its `text`: `start` up to, not including, `end`. */
export type ChangedRange = { start: number; end: number };

/** A passage of a removed line, and the offset in the added line where it used to sit. */
export type Deletion = { at: number; text: string };

/** How a removed line and the added line that replaced it differ, word by word. */
export type LinePairDiff = {
  /** The parts of the removed line that the added line lacks, in order. */
  removed: ChangedRange[];
  /** The parts of the added line that the removed line lacked, in order. */
  added: ChangedRange[];
  /** Each removed passage, placed at the offset in the added line where it stood. */
  deletions: Deletion[];
};

/** What the preview of a Markdown file needs from a diff, by line number in the new file. */
export type PreviewChanges = {
  /** Lines that are wholly new: added with no removed line to pair with, or rewritten. */
  addedLines: Set<number>;
  /** Lines that were edited, with the words added to each and the words taken out. */
  editedLines: Map<number, { added: ChangedRange[]; deletions: Deletion[] }>;
};

/**
 * For every line of `hunks`, in the order they are rendered, the parts of it that changed. Empty
 * for a line with no counterpart to compare against.
 *
 * **The problem it solves.** A removed line and the added line that replaces it are each tinted
 * from end to end, so a one-word edit to a long line leaves the reader comparing the two by eye,
 * where a `<` that became `<=` is easy to miss. Marking the changed words points at the edit, and a
 * line edited in two places carries two marks, as GitHub draws it.
 */
export function changedRanges(hunks: DiffHunk[]): ChangedRange[][] {
  const pairs = pairedDiffs(hunks);
  return hunks
    .flatMap((hunk) => hunk.lines)
    .map((line, index) => {
      const pair = pairs[index];
      if (!pair) return [];
      return line.kind === "remove" ? pair.removed : pair.added;
    });
}

/**
 * The lines of the new file that a diff added or edited, for the preview of a Markdown file.
 *
 * An edited line carries the words added to it and the words taken out of it, so the preview can
 * mark the one and strike through the other where it stood, as GitHub's rich diff does. A line
 * with no partner, or one rewritten rather than edited, is wholly new.
 *
 * A deletion of nothing but whitespace is left out. Struck through, a removed space is invisible,
 * and a removed line ending is not a character a reader can see at all. A line whose only change
 * was of that kind, such as trailing spaces an editor trimmed on save, is left out altogether:
 * marking it as edited would point the instructor at a passage with nothing in it to find.
 */
export function previewChanges(hunks: DiffHunk[]): PreviewChanges {
  const pairs = pairedDiffs(hunks);
  const addedLines = new Set<number>();
  const editedLines: PreviewChanges["editedLines"] = new Map();

  for (const [index, line] of hunks.flatMap((hunk) => hunk.lines).entries()) {
    if (line.kind !== "add" || line.newLine === null) continue;
    const pair = pairs[index];
    if (!pair) {
      addedLines.add(line.newLine);
      continue;
    }
    const deletions = pair.deletions.filter((deletion) => deletion.text.trim() !== "");
    if (pair.added.length === 0 && deletions.length === 0) continue;
    editedLines.set(line.newLine, { added: pair.added, deletions });
  }

  return { addedLines, editedLines };
}

/**
 * The most comparisons one run of unequal length may try. A short response edits a few lines at a
 * time; a run larger than this is a file rewritten wholesale, where pairing finds little worth
 * marking and each attempt can cost a comparison table on the browser's main thread.
 */
const MAX_PAIRING_ATTEMPTS = 64;

/**
 * For every line of `hunks`, in render order, the comparison with its partner, or null for a line
 * with none. Both lines of a pair share one comparison, and each reader takes its own side of it.
 *
 * **Pairing.** A run of removed lines followed directly by a run of added lines is one region in
 * two states. When the two runs are the same length, the nth removed line is paired with the nth
 * added line. When they are not, as when a fellow edits a paragraph and writes a new one beneath
 * it, each removed line is paired with the closest of the added lines after the last one paired,
 * which keeps the pairs in order. Only a line that shares at least half its characters with the
 * removed line can be chosen, the same test `diffLinePair` applies to every pair, so a line that
 * matches nothing closely enough stays unpaired rather than being marked against a stranger. A run
 * never crosses from one hunk to the next, because the gap between hunks is part of the file.
 */
function pairedDiffs(hunks: DiffHunk[]): (LinePairDiff | null)[] {
  const pairs: (LinePairDiff | null)[] = [];

  for (const hunk of hunks) {
    const { lines } = hunk;
    let i = 0;

    while (i < lines.length) {
      if (lines[i].kind !== "remove") {
        pairs.push(null);
        i += 1;
        continue;
      }

      const removeStart = i;
      while (i < lines.length && lines[i].kind === "remove") i += 1;
      const addStart = i;
      while (i < lines.length && lines[i].kind === "add") i += 1;

      const removed = addStart - removeStart;
      const added = i - addStart;
      const run: (LinePairDiff | null)[] = new Array(removed + added).fill(null);

      if (removed === added) {
        for (let k = 0; k < removed; k += 1) {
          const pair = diffLinePair(lines[removeStart + k].text, lines[addStart + k].text);
          run[k] = pair;
          run[removed + k] = pair;
        }
      } else if (removed * added <= MAX_PAIRING_ATTEMPTS) {
        let nextAdded = 0;
        for (let k = 0; k < removed; k += 1) {
          let best: { candidate: number; pair: LinePairDiff; changed: number } | null = null;
          for (let candidate = nextAdded; candidate < added; candidate += 1) {
            const pair = diffLinePair(
              lines[removeStart + k].text,
              lines[addStart + candidate].text,
            );
            if (!pair) continue;
            // The share of the two lines that changed, so a long line is not penalised for length.
            const changed =
              (charactersIn(pair.removed) + charactersIn(pair.added)) /
              (lines[removeStart + k].text.length + lines[addStart + candidate].text.length);
            if (!best || changed < best.changed) best = { candidate, pair, changed };
          }
          if (!best) continue;
          run[k] = best.pair;
          run[removed + best.candidate] = best.pair;
          nextAdded = best.candidate + 1;
        }
      }

      pairs.push(...run);
    }
  }

  return pairs;
}

function charactersIn(ranges: ChangedRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start, 0);
}

/**
 * A word, a run of whitespace, or one punctuation mark.
 *
 * Words are compared whole, so `wan't` against `want` marks both words rather than the apostrophe
 * and the letter around it: a reader takes in a changed word faster than a changed letter.
 * Punctuation stands alone, so a sentence that gained a full stop marks only the full stop.
 */
const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

type Token = { text: string; start: number; end: number };

function tokenize(line: string): Token[] {
  return Array.from(line.matchAll(TOKEN), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/**
 * The most cells the comparison table may hold, which is one paragraph of about a thousand words
 * on each side once the shared start and end are set aside. A line longer than that is minified
 * code or a pasted blob, which nobody reads word by word, so it keeps the row tint alone.
 */
const MAX_TABLE_CELLS = 1_000_000;

/** One step through the two lines: a token both share, one only the removed line has, or one only the added line has. */
type Step =
  | { kind: "equal"; before: Token; after: Token }
  | { kind: "delete"; before: Token }
  | { kind: "insert"; after: Token };

/**
 * How two lines differ word by word, or null when they share too little for marking to help.
 *
 * **The comparison.** The longest sequence of tokens the two lines share, found with the standard
 * table over the part between their shared start and shared end. Everything outside that sequence
 * changed. Where a removed token and an added token compete for the same place, the removal comes
 * first, so a replaced word reads as the old word struck out and then the new one.
 *
 * **Spaces between two changes join them.** A rewritten phrase shares its spaces with the phrase
 * it replaced, and marking each word apart, with unmarked spaces between, scatters the mark into
 * fragments. A run of shared whitespace with a change on both sides is counted as changed.
 *
 * **The threshold.** When less than half of the longer line is shared, the line was rewritten
 * rather than edited, and marking it would shade nearly all of it, which is what the row tint
 * already says. Indentation the two lines share is left out of that count: in indented code it
 * would otherwise let a rewritten line pass as an edited one.
 *
 * A trailing carriage return is a whitespace token, so a line whose only change is its line ending
 * gets a range covering exactly that character, which the renderer draws as `␍`.
 */
export function diffLinePair(before: string, after: string): LinePairDiff | null {
  if (before === after) return null;

  const a = tokenize(before);
  const b = tokenize(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head].text === b[head].text) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail].text === b[b.length - 1 - tail].text
  ) {
    tail += 1;
  }

  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if ((n + 1) * (m + 1) > MAX_TABLE_CELLS) return null;

  // table[i * (m + 1) + j] is the length of the longest shared sequence of the middle tokens
  // from a[head + i] and b[head + j] onwards.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[head + i].text === b[head + j].text
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const steps: Step[] = [];
  for (let k = 0; k < head; k += 1) steps.push({ kind: "equal", before: a[k], after: b[k] });

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (
      i < n &&
      j < m &&
      a[head + i].text === b[head + j].text &&
      table[i * width + j] === table[(i + 1) * width + j + 1] + 1
    ) {
      steps.push({ kind: "equal", before: a[head + i], after: b[head + j] });
      i += 1;
      j += 1;
    } else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      steps.push({ kind: "delete", before: a[head + i] });
      i += 1;
    } else {
      steps.push({ kind: "insert", after: b[head + j] });
      j += 1;
    }
  }

  for (let k = tail; k > 0; k -= 1) {
    steps.push({ kind: "equal", before: a[a.length - k], after: b[b.length - k] });
  }

  const joined = joinChangesAcrossSpaces(steps);

  // The threshold, measured on the removed line's shared characters.
  const shared = joined.reduce(
    (sum, step) => (step.kind === "equal" ? sum + step.before.text.length : sum),
    0,
  );
  const first = joined[0];
  const indent = first?.kind === "equal" && first.before.text.trim() === "" ? first.before.end : 0;
  const longer = Math.max(before.length, after.length) - indent;
  if ((shared - indent) * 2 < longer) return null;

  const removed: ChangedRange[] = [];
  const added: ChangedRange[] = [];
  const deletions: Deletion[] = [];

  /*
    One deletion per run of changes, placed where the run begins in the added line, so the words
    taken out always come before the words that replaced them. The removed tokens of one run are
    consecutive in the removed line, because a shared token would have ended the run.
  */
  let runStart = 0;
  let open: Deletion | null = null;

  for (const step of joined) {
    if (step.kind === "equal") {
      runStart = step.after.end;
      open = null;
    } else if (step.kind === "delete") {
      extend(removed, step.before);
      if (open) open.text += step.before.text;
      else {
        open = { at: runStart, text: step.before.text };
        deletions.push(open);
      }
    } else {
      extend(added, step.after);
    }
  }

  return { removed, added, deletions };
}

/** Adds `token` to the last range when the two touch, or starts a new range. */
function extend(ranges: ChangedRange[], token: Token) {
  const last = ranges.at(-1);
  if (last && last.end === token.start) last.end = token.end;
  else ranges.push({ start: token.start, end: token.end });
}

/** Rewrites each run of shared whitespace that has a change on both sides as a change. */
function joinChangesAcrossSpaces(steps: Step[]): Step[] {
  const out: Step[] = [];
  let k = 0;
  while (k < steps.length) {
    if (steps[k].kind !== "equal") {
      out.push(steps[k]);
      k += 1;
      continue;
    }

    let end = k;
    while (end < steps.length && steps[end].kind === "equal") end += 1;
    const run = steps.slice(k, end) as Extract<Step, { kind: "equal" }>[];
    const between = k > 0 && end < steps.length;
    const blank = run.every((step) => step.before.text.trim() === "");

    if (between && blank) {
      for (const step of run) out.push({ kind: "delete", before: step.before });
      for (const step of run) out.push({ kind: "insert", after: step.after });
    } else {
      out.push(...run);
    }
    k = end;
  }
  return out;
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
