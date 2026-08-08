/**
 * What to call somebody, and how to draw them when there is no room for a name.
 *
 * **Browser-safe on purpose, and that is the whole reason this is its own module.** Both
 * questions are asked on the server — a refusal message names the instructor who owns a cohort —
 * and on the client, by every avatar and every row of a roster. `trpc/selects.ts` cannot be the
 * home because it imports Prisma's generated types and sits in the transport layer; `lib/status.ts`
 * cannot be, because that is the vocabulary of a *submission* and this is the vocabulary of a
 * *person*. So: no imports, no `server-only`, and nothing here touches the database.
 */

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
