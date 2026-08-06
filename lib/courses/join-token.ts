/**
 * A course's join token.
 *
 * Its own module, and deliberately not in `membership.ts`: that one is `server-only` because it
 * reads the database, and this is a pure function that the seed script and any future
 * command-line tool need too. Importing a server-only module from a plain `tsx` script fails at
 * load — which is how this ended up separated.
 */

/**
 * A random, unguessable token.
 *
 * `randomUUID` rather than anything derived from the course id, because the id appears in the
 * address bar of every course page and in links an instructor shares — a token derived from it
 * would be readable off a screenshot. 122 bits of randomness, hyphens removed so the link is one
 * word to paste.
 */
export function newJoinToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
