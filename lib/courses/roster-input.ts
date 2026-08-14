import { z } from "zod";

/**
 * Turning a pasted list of students into roster entries.
 *
 * **Browser-safe on purpose**, the same reason `lib/people.ts` is: the paste box shows what it
 * understood before anything is saved, and the procedure parses the same text again on arrival.
 * One parser rather than two, so what the instructor was shown is what gets written — a preview
 * produced by different code from the write is a preview that is sometimes a lie.
 *
 * **Forgiving about shape, strict about keys.** What an instructor has is whatever their
 * onboarding spreadsheet exported, so the separator may be a comma or a tab and the columns may
 * be in any order. What it must not do is guess: a field is a GitHub login only if it looks like
 * one and an address only if it looks like one, and anything else becomes the note. A parser that
 * silently recorded a person's name in the GitHub column would produce an entry that matches
 * nobody and reads on screen as a student who never joined.
 */

/** One person, as the roster stores them. */
export type ParsedRosterEntry = {
  githubUsername: string | null;
  email: string | null;
  note: string | null;
};

/** A line that could not be used, kept beside its text so the screen can show which one. */
export type RosterInputProblem = {
  line: number;
  text: string;
  reason: string;
};

export type ParsedRosterInput = {
  entries: ParsedRosterEntry[];
  problems: RosterInputProblem[];
};

/**
 * What a GitHub login may contain.
 *
 * GitHub's own rule: letters, digits, and single hyphens, not starting or ending with one, up to
 * 39 characters. Written out rather than approximated to `\S+`, because the whole job of this
 * pattern is to be able to say "that is not a handle, so it must be the person's name".
 */
const GITHUB_LOGIN = /^@?(?![-])(?!.*--)[A-Za-z0-9-]{1,39}(?<![-])$/;

/**
 * Something with an `@` and a dot after it.
 *
 * Deliberately not a full address grammar. The question here is only "is this field an address or
 * a handle", and the two are never close enough for this to be the wrong call. A malformed address
 * is caught by the person reading the preview, which is what the preview is for.
 */
const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseRosterInput(text: string): ParsedRosterInput {
  const entries: ParsedRosterEntry[] = [];
  const problems: RosterInputProblem[] = [];

  const lines = text.split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    // Blank lines are how people space a pasted list. Skipped rather than reported, because
    // reporting them would bury the one line that is actually wrong.
    if (line === "") continue;

    const fields = line
      .split(/[,\t]/)
      .map((field) => field.trim())
      .filter(Boolean);

    let githubUsername: string | null = null;
    let email: string | null = null;
    const noteParts: string[] = [];

    for (const field of fields) {
      if (!email && LOOKS_LIKE_EMAIL.test(field)) {
        email = field.toLowerCase();
      } else if (!githubUsername && GITHUB_LOGIN.test(field)) {
        // The leading `@` is how people write a handle and is not part of it.
        githubUsername = field.replace(/^@/, "").toLowerCase();
      } else {
        noteParts.push(field);
      }
    }

    if (!githubUsername && !email) {
      problems.push({
        line: index + 1,
        text: line,
        reason: "No GitHub username or email address on this line.",
      });
      continue;
    }

    entries.push({
      githubUsername,
      email,
      note: noteParts.length > 0 ? noteParts.join(" ") : null,
    });
  }

  return { entries, problems: problems.concat(duplicateProblems(entries, lines)) };
}

/**
 * The same person written twice in one paste.
 *
 * Caught here rather than left to the unique constraint, because the constraint fails the whole
 * write and says which index collided — neither of which helps somebody looking at forty lines of
 * spreadsheet. Reported as a problem so the screen can point at the repeat.
 */
function duplicateProblems(entries: ParsedRosterEntry[], lines: string[]): RosterInputProblem[] {
  const seen = new Map<string, number>();
  const problems: RosterInputProblem[] = [];

  for (const [index, entry] of entries.entries()) {
    for (const key of [entry.githubUsername, entry.email]) {
      if (!key) continue;

      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, index);
        continue;
      }

      problems.push({
        line: index + 1,
        text: lines[index] ?? key,
        reason: `${key} is already on line ${first + 1} of this paste.`,
      });
    }
  }

  return problems;
}

/** What one entry has to satisfy when it reaches a procedure. */
export const rosterEntrySchema = z
  .object({
    githubUsername: z.string().trim().toLowerCase().regex(GITHUB_LOGIN).nullable(),
    email: z.string().trim().toLowerCase().email().nullable(),
    note: z.string().trim().max(120).nullable(),
  })
  .refine((entry) => entry.githubUsername !== null || entry.email !== null, {
    message: "A roster entry needs a GitHub username or an email address.",
  });

/**
 * How many may be added at once.
 *
 * A cohort is around twenty-five people and a paste is one cohort, so this is not a performance
 * limit — it is a limit on how wrong one mistake can be. Pasting an entire spreadsheet of every
 * student the school has ever had should be refused rather than accepted and then unpicked.
 */
export const MAX_ROSTER_PASTE = 200;
