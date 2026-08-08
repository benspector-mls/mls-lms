/**
 * Reading facts back out of a report's own prose.
 *
 * Kept free of database and network imports so the review interface can run these in the
 * browser. That matters more than it sounds: the interface warns about a report whose
 * text disagrees with its score, and the server refuses to approve one. If those two
 * used different rules, the warning would be advice about a different question than the
 * refusal, and an instructor would be told their edit is fine right up until it is not.
 */

/**
 * The score a report's own text claims, or null if it states none.
 *
 * Matches the score line the report templates put under the heading. An instructor can
 * change the prose and the recorded number independently, and editing "28/30" into the
 * text while the column still says 30 would hand the student one figure and the
 * gradebook another.
 */
export function statedScoreInText(markdown: string): { earned: number; possible: number } | null {
  const match = markdown.match(/^#{1,3}\s.*?Score:\s*([\d.]+)\s*\/\s*([\d.]+)/im);
  return match ? { earned: Number(match[1]), possible: Number(match[2]) } : null;
}
