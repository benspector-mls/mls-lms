/**
 * The section types, and everything the application knows about each one.
 *
 * A gradable section has a type, and three different parts of the application have to know
 * something about that type: what to call it on screen, which `Rubric` row grades it, and what
 * the report's title is. **Those were maps in separate files**, plus the list of names in two
 * more and the union type written out by hand — places that had to agree, related only by
 * convention, with nothing to say so when one of them fell behind.
 *
 * The rubric's text, its guidance and its sample report are not here: they are versions of the
 * `Rubric` row, read by `loadGradingAssets` through the `rubricId` a section stores. What this
 * file still fixes is the *pairing* — a `coding_algorithm` section is graded against the row
 * named `CODING_ALGORITHM_FLUENCY` and no other — which is what lets the authoring procedures
 * check the pairing an instructor submits rather than trust it.
 *
 * **Browser-safe and importing nothing**, because the interface reads it as much as grading
 * does — the section editor draws the picker from it, and `lib/status.ts` names a section from
 * it. Anything that needed the network or the database would take it out of reach of both.
 *
 * **What is deliberately not here: how a section is *detected*.** `lib/grade/classify.ts` maps a
 * changed file path to a section type through an ordered list where the first match wins, and
 * the order is load-bearing — a flat `src/*.js` file is an algorithm exercise when the template
 * has Jest and frontend work otherwise. Folding those rules into a record keyed by type would
 * make that order an accident of how the object literal was typed. The classifier imports the
 * names from here and keeps its own ordering.
 */

/**
 * The four types, in the order the interface offers them.
 *
 * A tuple rather than the registry's keys, because `z.enum` needs one and because the order is a
 * decision — this is what the section editor's dropdown lists, and short response first is the
 * one most assignments start with.
 */
export const SECTION_TYPES = [
  "short_response",
  "coding_algorithm",
  "coding_sql",
  "coding_frontend",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export type SectionTypeEntry = {
  /** What a person is shown. Sentence case, because it appears mid-sentence as often as not. */
  label: string;
  /**
   * The `Rubric` row this is graded against, by name.
   *
   * The pairing is fixed rather than chosen: a `coding_algorithm` section graded against the
   * short response rubric would produce a confident report against criteria that do not apply to
   * it. Stating it here is what lets the authoring procedures *check* the pairing an instructor
   * submits rather than trust it.
   */
  rubricName: string;
  /**
   * The first line of the report, before the score the application appends to it.
   *
   * Here rather than in the sample report, because the application writes every heading in the
   * posted comment: the model returns the summary and one row per scored item, and
   * `composeReport` builds the document from them. A title copied from the sample by the model
   * would be a second place the score could disagree with the rows.
   */
  reportTitle: string;
};

/**
 * `satisfies` rather than an annotation, so a type added to the tuple above and forgotten here
 * is a compile error — which is the whole point of the two being in one file.
 */
export const SECTION_TYPE_REGISTRY = {
  short_response: {
    label: "Short Response",
    rubricName: "SHORT_RESPONSE",
    reportTitle: "Short Response Score Report",
  },
  coding_algorithm: {
    label: "Algorithm Fluency",
    rubricName: "CODING_ALGORITHM_FLUENCY",
    reportTitle: "Coding Fluency Score Report",
  },
  coding_sql: {
    label: "SQL Fluency",
    rubricName: "CODING_SQL_FLUENCY",
    reportTitle: "SQL Coding Report",
  },
  coding_frontend: {
    label: "Frontend",
    rubricName: "CODING_FRONTEND",
    reportTitle: "Frontend Coding Report",
  },
} satisfies Record<SectionType, SectionTypeEntry>;

/**
 * Whether a string stored in the `sections` JSON column is a type this application knows.
 *
 * `sections` is JSON, so a stored `type` is a string until something narrows it, and the answer
 * has to be "not one of ours" rather than a throw: an assignment authored against a later
 * version of this list must still be readable by an older one.
 */
export function isSectionType(value: string): value is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(value);
}
