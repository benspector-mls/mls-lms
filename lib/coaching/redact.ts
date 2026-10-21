/**
 * What Themes hides from Anthropic before a prompt leaves the LMS, and how Claude's answer is put
 * back afterwards.
 *
 * **Names.** The fellow's name, every part of it, their GitHub login and their email become "the
 * fellow". Everyone else on the program's roster and staff becomes `person_1`, `person_2`, and so
 * on. Matching ignores case, so a name a coach typed in lower case is still hidden; the cost is
 * that a name which is also an ordinary word, such as Will or May, hides that word too.
 *
 * **Sensitive terms.** Each distinct term from `SENSITIVE_TERMS` becomes `personal_matter_1`,
 * `personal_matter_2`, and so on, numbered in the order they first appear, so Claude can still
 * see that two records mention the same matter. The list is the whole protection: a sensitive
 * matter described in words that are not on it is sent as written.
 *
 * **The map from placeholder to word is never stored.** It lives for one generation: `restore`
 * puts the original words back into Claude's answer before the themes are saved, and the next
 * generation hides them again when it resends those themes.
 */

/**
 * Words and phrases that are replaced wherever they appear, ignoring case, with a plural "s" or
 * "es" allowed. Reviewed by the program team; add a term here and it is hidden from the next
 * generation on.
 */
export const SENSITIVE_TERMS = [
  // Immigration
  "immigration",
  "immigrant",
  "undocumented",
  "deportation",
  "deported",
  "deport",
  "ICE",
  "visa",
  "green card",
  "asylum",
  "refugee",
  "DACA",
  "citizenship",
  // Abuse and violence
  "abuse",
  "abused",
  "abusive",
  "assault",
  "assaulted",
  "violence",
  "violent",
  "harassment",
  "harassed",
  "stalking",
  "rape",
  // Legal matters
  "legal",
  "lawyer",
  "attorney",
  "lawsuit",
  "court",
  "custody",
  "divorce",
  "arrest",
  "arrested",
  "police",
  "jail",
  "prison",
  "incarcerated",
  "probation",
  "parole",
  "misdemeanor",
  "felony",
  // Housing
  "homeless",
  "homelessness",
  "shelter",
  "eviction",
  "evicted",
  // Health and mental health
  "aids",
  "hiv",
  "mental health",
  "therapy",
  "therapist",
  "psychiatrist",
  "depression",
  "depressed",
  "anxiety",
  "panic attack",
  "suicide",
  "suicidal",
  "self-harm",
  "medication",
  "diagnosis",
  "diagnosed",
  "hospital",
  "hospitalized",
  "surgery",
  "cancer",
  "pregnant",
  "pregnancy",
  "miscarriage",
  "abortion",
  "addiction",
  "rehab",
  "overdose",
  // Bereavement
  "died",
  "death",
  "funeral",
  "passed away",
  "grief",
] as const;

/** The name fields of one person, as `personNameSelect` loads them. */
export type PersonName = {
  displayName: string | null;
  email: string | null;
  githubUsername: string | null;
};

/** Whose names to hide: the fellow the summary is about, and everyone else their record might name. */
export type RedactionNames = {
  fellow: PersonName;
  others: PersonName[];
};

export type Redaction = {
  /** The text with every name and sensitive term replaced. */
  text: string;
  /** Puts the original words back in place of the placeholders in a piece of Claude's answer. */
  restore: (text: string) => string;
};

/**
 * Every way a person's name might be written: the whole name, each part of it, the GitHub login,
 * and the email with and without its domain. A part shorter than two letters is left out, because
 * an initial would hide every "a" and "I" in the record.
 */
function namesOf(person: PersonName): string[] {
  const names: string[] = [];
  const full = person.displayName?.trim().replace(/\s+/g, " ");
  if (full) names.push(full, ...full.split(" "));
  if (person.githubUsername) names.push(person.githubUsername);
  if (person.email) names.push(person.email, person.email.split("@")[0]);
  return names.filter((name) => name.length >= 2);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest first, so "Maria Lopez" is replaced whole before "Maria" alone could match. */
function alternation(texts: string[]): string {
  return [...texts]
    .sort((a, b) => b.length - a.length)
    .map(escaped)
    .join("|");
}

/** Replaces names and sensitive terms in `text`, and returns how to put them back. */
export function redact(text: string, names: RedactionNames): Redaction {
  // The fellow's names are claimed first, so a classmate who shares a first name never takes it.
  const fellowNames = new Set(namesOf(names.fellow).map((name) => name.toLowerCase()));
  const otherNames = new Set(
    names.others
      .flatMap(namesOf)
      .map((name) => name.toLowerCase())
      .filter((name) => !fellowNames.has(name)),
  );

  const nameTexts = [...fellowNames, ...otherNames];
  const nameGroup = nameTexts.length > 0 ? `(?<name>${alternation(nameTexts)})` : "(?<name>(?!))";
  const termGroup = `(?<term>(?:${alternation([...SENSITIVE_TERMS])})(?:e?s)?)`;
  // A letter, digit or underscore on either side means the match is part of a longer word.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${nameGroup}|${termGroup})(?![\\p{L}\\p{N}_])`,
    "giu",
  );

  // Placeholder to the words it replaced, as first written; and the reverse, by lower case.
  const originals = new Map<string, string>();
  const placeholders = new Map<string, string>();
  let people = 0;
  let matters = 0;

  const placeholderFor = (match: string, kind: "person" | "personal_matter"): string => {
    const key = `${kind}:${match.toLowerCase()}`;
    let placeholder = placeholders.get(key);
    if (placeholder === undefined) {
      placeholder = kind === "person" ? `person_${++people}` : `personal_matter_${++matters}`;
      placeholders.set(key, placeholder);
      originals.set(placeholder, match);
    }
    return placeholder;
  };

  const redacted = text.replace(pattern, (match: string, ...rest: unknown[]) => {
    const groups = rest.at(-1) as { name?: string; term?: string };
    if (groups.name !== undefined) {
      return fellowNames.has(match.toLowerCase()) ? "the fellow" : placeholderFor(match, "person");
    }
    return placeholderFor(match, "personal_matter");
  });

  return {
    text: redacted,
    // Forgiving about how Claude writes a placeholder back: "Personal Matter 1" is the same one.
    restore: (answer) =>
      answer.replace(
        /(?<![\p{L}\p{N}_])(personal[ _-]?matter|person)[ _-]?(\d+)(?![\p{L}\p{N}_])/giu,
        (match: string, kind: string, number: string) => {
          const placeholder = `${/^personal/i.test(kind) ? "personal_matter" : "person"}_${number}`;
          return originals.get(placeholder) ?? match;
        },
      ),
  };
}
