/**
 * The section types, and everything the application knows about each one.
 *
 * A gradable section has a type, and different parts of the application have to know something
 * about that type: what to call it on screen and what the report's title is. **Those were maps in
 * separate files**, plus the list of names in two more and the union type written out by hand —
 * places that had to agree, related only by convention, with nothing to say so when one of them
 * fell behind.
 *
 * The rubric a section is graded against is the instructor's choice, stored on the section as
 * `rubricId`; `loadGradingAssets` reads the rubric's current version through that id.
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
  /**
   * What a person is shown: the files the section grades, which is also the heading above the
   * section in a fellow's feedback and on the review screen.
   */
  label: string;
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
    reportTitle: "Short Response Score Report",
  },
  coding_algorithm: {
    label: "Coding Exercises",
    reportTitle: "Coding Exercises Score Report",
  },
  coding_sql: {
    label: "SQL Queries",
    reportTitle: "SQL Queries Score Report",
  },
  coding_frontend: {
    label: "Web Pages and App Code",
    reportTitle: "Web Pages and App Code Score Report",
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
