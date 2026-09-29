import type { CheckLevel } from "@/lib/generated/prisma/enums";

/**
 * The levels a check for understanding is reviewed into, and the three a fellow reads.
 *
 * **Five stored, three shown.** The review classifies an answer on the SOLO taxonomy, and five
 * levels are what it can distinguish and what calibration compares. A fellow reads a category —
 * Blocked, Understands facts, Making connections — because the point of a check is an honest
 * reading rather than a score to chase, and the sub-level adds nothing a fellow can act on. The
 * sub-level is still one hover away on the badge, for anybody who wants it.
 *
 * Every screen and the review's prompt read their definitions from this file, so what the model
 * is told a level means and what a fellow is told it means cannot drift apart.
 *
 * **No `server-only` import.** The badge, the fellow's card, and the instructor's table are client
 * components, and the prompt is built on the server; all four need the same words.
 */

/** Every level, lowest first. The order is the order of understanding, and screens rely on it. */
export const CHECK_LEVELS = [
  "BLOCKED",
  "UNISTRUCTURAL",
  "MULTISTRUCTURAL",
  "RELATIONAL",
  "EXTENDED_ABSTRACT",
] as const satisfies readonly CheckLevel[];

export type CheckCategory = 1 | 2 | 3;

/** What each level means, in the words both the review and a fellow's tooltip use. */
export const LEVEL_DEFINITION: Record<CheckLevel, string> = {
  BLOCKED: "Does not yet grasp the concept, or answered something other than the question.",
  UNISTRUCTURAL: "States one relevant fact, without relating it to anything else.",
  MULTISTRUCTURAL: "States several relevant facts, without connecting them to each other.",
  RELATIONAL: "Connects the facts to each other and to the broader concept they belong to.",
  EXTENDED_ABSTRACT:
    "Discusses the concept in general terms, beyond this particular syntax or example.",
};

/** The SOLO name of each level, for the tooltip and the instructor's override control. */
export const LEVEL_NAME: Record<CheckLevel, string> = {
  BLOCKED: "Prestructural",
  UNISTRUCTURAL: "Unistructural",
  MULTISTRUCTURAL: "Multistructural",
  RELATIONAL: "Relational",
  EXTENDED_ABSTRACT: "Extended abstract",
};

export const CATEGORY_LABEL: Record<CheckCategory, string> = {
  1: "Blocked",
  2: "Understands facts",
  3: "Making connections",
};

/** Which of the three categories a level falls in. */
export function levelCategory(level: CheckLevel): CheckCategory {
  switch (level) {
    case "BLOCKED":
      return 1;
    case "UNISTRUCTURAL":
    case "MULTISTRUCTURAL":
      return 2;
    case "RELATIONAL":
    case "EXTENDED_ABSTRACT":
      return 3;
  }
}

/**
 * The level that stands for an attempt: an instructor's, where one set it, and the review's
 * otherwise. Null when the review has not produced one and nobody has set one by hand.
 */
export function effectiveLevel(attempt: {
  level: CheckLevel | null;
  instructorLevel: CheckLevel | null;
}): CheckLevel | null {
  return attempt.instructorLevel ?? attempt.level;
}
