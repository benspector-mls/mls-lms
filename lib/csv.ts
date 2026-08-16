/**
 * Text a spreadsheet cannot misread, and cannot execute.
 *
 * **Two separate problems, and only one of them is about formatting.**
 *
 * Quoting is the CSV one: a comma, a quote, a newline, or an edge space would otherwise split or
 * shift a field, and a student who put a comma in their display name would push their whole row one
 * column to the right. Doubling the quote and wrapping is RFC 4180.
 *
 * The leading apostrophe is the other, and it is a security fix. Excel and Google Sheets evaluate
 * any cell beginning `=`, `+`, `-`, or `@` as a formula when the file is opened — so a display name
 * of `=HYPERLINK("http://…"&A2)` runs on an instructor's machine against the roster sitting beside
 * it. Quoting alone does not stop this; both spreadsheets parse the formula out of a quoted field.
 * The apostrophe is what makes it literal text, and it is applied only to fields that are text, so
 * a negative number is untouched.
 *
 * **This file exists because there are now two exports.** The gradebook wrote these three functions
 * for itself; attendance needs them too, and its most dangerous field is worse — a note a fellow
 * typed about why they missed a morning, which no instructor reviewed before it reached the file.
 * A guard against formula injection has to exist exactly once, or the second copy is the one that
 * falls behind.
 *
 * Pure and browser-safe, in the manner of `lib/people.ts`: both exports build their file from the
 * payload already on screen rather than from a second query, so the file and the page cannot
 * disagree.
 */

import { displayNameOf } from "@/lib/people";

const NEEDS_QUOTING = /[",\r\n]|^\s|\s$/;
const READS_AS_FORMULA = /^[=+\-@\t\r]/;

export function csvText(value: string): string {
  const literal = READS_AS_FORMULA.test(value) ? `'${value}` : value;
  return NEEDS_QUOTING.test(literal) ? `"${literal.replace(/"/g, '""')}"` : literal;
}

/** One record. Numbers pass through unquoted so they arrive as numbers; null is an empty cell. */
export function csvLine(fields: readonly (string | number | null)[]): string {
  return fields
    .map((field) => {
      if (field == null) return "";
      return typeof field === "number" ? String(field) : csvText(field);
    })
    .join(",");
}

/**
 * Whatever this person is best called, and whether they are real.
 *
 * The badge a screen draws beside a seeded student has to survive into the file, because the file
 * is where it matters most: a test row on screen is marked, and the same row in a spreadsheet of
 * cohort results is indistinguishable from somebody who has fallen behind. In words rather than a
 * column of its own, since that is what the screens do — the mark belongs to the name.
 */
export function csvPersonName(
  person: {
    displayName: string | null;
    email: string | null;
    githubUsername: string | null;
    testStudentNumber: number | null;
  },
  fallback: string,
): string {
  const name = displayNameOf(person, fallback);
  return person.testStudentNumber === null ? name : `${name} (test student)`;
}
