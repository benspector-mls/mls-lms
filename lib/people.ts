/**
 * What to call somebody, and how to draw them when there is no room for a name.
 *
 * **Browser-safe on purpose, and that is the whole reason this is its own module.** Both
 * questions are asked on the server — a refusal message names the instructor who owns a cohort —
 * and on the client, by every avatar and every row of a roster. `trpc/selects.ts` cannot be the
 * home because it imports Prisma's generated types and sits in the transport layer; `lib/status.ts`
 * cannot be, because that is the vocabulary of a *submission* and this is the vocabulary of a
 * *person*. So: no `server-only`, nothing here touches the database, and the one import is Zod,
 * which the authoring specs under `lib/` already rely on running in the browser.
 */

import { z } from "zod";

/**
 * Whatever this person is best called.
 *
 * The fallback chain the interface has always used: a display name if they set one, their GitHub
 * login if not, their email as the last resort.
 *
 * It has to agree with `personSelect` in `trpc/selects.ts`, which fetches exactly the three
 * columns it reads — the chain is only as good as the columns fetched, and a caller selecting
 * `displayName` alone would fall all the way through for everybody whose name is unset.
 *
 * **`fallback` is required rather than defaulted**, because there is no answer that suits every
 * caller: one of these messages is about an instructor and another is about a student, and a
 * default would have quietly called one of them by the other's name. It was written out three
 * times before this, and the third copy was the one that differed.
 */
export function displayNameOf(
  user: { displayName: string | null; email: string | null; githubUsername: string | null },
  fallback: string,
): string {
  return user.displayName ?? user.githubUsername ?? user.email ?? fallback;
}

/**
 * Up to two uppercase letters for an avatar, from whatever name there is.
 *
 * **Six copies before this, in four behaviours**, which is the more interesting number. They
 * differed on the two inputs nobody writes a test for: a name with two spaces in it, and no name
 * at all. Two of them took the first character of every space-separated piece without discarding
 * the empty piece a double space produces, so `"Ada  Lovelace"` drew as `A` rather than `AL` —
 * the second slot was taken by the gap. Three sliced before filtering and returned an empty
 * string for a name that was only whitespace, which draws as a blank circle that looks like a
 * loading state that never finishes.
 *
 * So this splits on runs of whitespace rather than on a single space, and answers `?` when
 * nothing is left. `?` rather than an empty string because an avatar is a fixed circle either
 * way: the question mark says the name is missing, and the blank says nothing at all.
 *
 * Not the same question as `displayNameOf` and deliberately downstream of it — this is handed a
 * name that has already fallen through, so an email address gives `B` for `ben@…`, which is the
 * right answer for somebody who has set nothing else.
 */
/**
 * How long a display name may be.
 *
 * Exported as numbers as well as folded into the schema below, because the form needs them for
 * things a schema cannot do: `maxLength` on the input, so the ceiling stops the typing rather than
 * refusing the save, and a live character count as it is approached.
 *
 * **Two at the bottom** because a single letter is indistinguishable from a slip of the keyboard,
 * and `initials` draws one letter either way — so a one-character name costs a reader everything
 * and gains them nothing. **Fifty at the top** because this string is rendered in a sidebar row, a
 * roster cell, and a gradebook column header, every one of which truncates: a longer name is not
 * so much stored as hidden.
 */
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;

/**
 * What a display name somebody typed has to satisfy.
 *
 * **One definition, read by the procedure and by the form that calls it**, for the reason
 * `lib/assignments/spec.ts` holds one definition of an assignment: a limit written out twice
 * disagrees with itself eventually, and this particular disagreement surfaces as a form that
 * accepts a name and a server that then refuses it, with the reason arriving in a toast after the
 * text has already been typed.
 *
 * `.trim()` runs before the length checks rather than after, which is what makes `"  "` too short
 * instead of two characters long, and what stops a pasted name with a trailing newline from being
 * one character over the ceiling.
 *
 * There is no way to *clear* a name here, and that is deliberate: the signup trigger fills the
 * column for every account — from the GitHub profile, or from the local part of the email address —
 * so an empty one is not a state anybody is in, and offering to reach it would mean offering to be
 * listed on a roster as an email address.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN_LENGTH, `Please use at least ${DISPLAY_NAME_MIN_LENGTH} characters.`)
  .max(DISPLAY_NAME_MAX_LENGTH, `Please use ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`);

export function initials(name: string | null | undefined): string {
  const letters = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return letters || "?";
}
