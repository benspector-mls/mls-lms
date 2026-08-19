/**
 * The section types, and everything the application knows about each one.
 *
 * A gradable section has a type, and four different parts of the application had to know
 * something about that type: what to call it on screen, which `Rubric` row grades it, which
 * heading in `rubric.md` governs it, and which sample report the model's output must be shaped
 * like. **Those were four maps in four files**, plus the list of names in two more and the union
 * type written out by hand in a seventh — seven places that had to agree, related only by
 * convention, with nothing to say so when one of them fell behind.
 *
 * That is a bearable amount of duplication for a closed set, and the set is about to open:
 * instructor-authored rubrics make a section type something somebody adds rather than something
 * the four values in this file exhaust. Adding one should be one entry here.
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
   * The `## ` heading in `rubric.md` whose text is sliced out and sent.
   *
   * The whole rubric is roughly 110 lines, so sending all of it would not be expensive. It is
   * sliced anyway because the irrelevant sections are actively misleading: a short response
   * report given the algorithm rubric has a plausible scoring scale to reach for that does not
   * apply.
   */
  rubricHeading: string;
  /** The sample report in `grading-toolkit/` that the model's output must be shaped like. */
  sampleFile: string;
};

/**
 * `satisfies` rather than an annotation, so a type added to the tuple above and forgotten here
 * is a compile error — which is the whole point of the two being in one file.
 */
export const SECTION_TYPE_REGISTRY = {
  short_response: {
    label: "Short Response",
    rubricName: "SHORT_RESPONSE",
    rubricHeading: "SHORT RESPONSE",
    /*
      Pair 1 of two. The toolkit also holds sample-short-response-submission-1.md, the work this
      report was written about.

      Pair 2 is deliberately NOT used here. It is the held-out calibration case: `npm run
      calibrate` grades submission 2 and compares the result against report 2, which only
      measures anything as long as the model has not been shown the answer. Adding it to this
      prompt would quietly invalidate that test.
    */
    sampleFile: "sample-short-response-report-1.md",
  },
  coding_algorithm: {
    label: "Algorithm Fluency",
    rubricName: "CODING_ALGORITHM_FLUENCY",
    rubricHeading: "CODING — ALGORITHM FLUENCY",
    sampleFile: "sample-coding-fluency-report.md",
  },
  coding_sql: {
    label: "SQL Fluency",
    rubricName: "CODING_SQL_FLUENCY",
    rubricHeading: "CODING — SQL FLUENCY",
    /*
      The frontend sample, and **not a copy-and-paste slip** — the toolkit holds no
      `sample-coding-sql-report.md`, so this is the nearest report of the right shape. What the
      sample teaches is the *form* of a report, and the rubric heading above is what supplies the
      criteria, so borrowing one is survivable in a way borrowing a rubric would not be. Writing
      a SQL sample is the fix; until somebody does, this is the honest stand-in rather than a
      missing file that fails the run.
    */
    sampleFile: "sample-coding-frontend-report.md",
  },
  coding_frontend: {
    label: "Frontend",
    rubricName: "CODING_FRONTEND",
    rubricHeading: "CODING — FRONTEND",
    sampleFile: "sample-coding-frontend-report.md",
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
