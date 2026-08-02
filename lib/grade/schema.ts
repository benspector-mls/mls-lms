import { z } from "zod";

/**
 * The shape a grading report must come back in, and the single source of truth
 * for it.
 *
 * One definition serves three purposes: the JSON Schema handed to whichever
 * language model provider is in use, runtime validation of what comes back, and
 * the TypeScript types everything downstream reads. Deriving all three from one
 * zod schema is what stops them drifting apart.
 *
 * No "server-only": pure, so it can be checked from a script.
 */

/**
 * Constraints deliberately absent, and why.
 *
 * Claude's structured output rejects numeric constraints (`minimum`, `maximum`),
 * string length limits, and objects without `additionalProperties: false`. So no
 * `.min()`, `.max()`, or `.length()` appears below — a schema carrying them would
 * work on Groq and fail on Claude, which defeats the point of one definition.
 *
 * The cost is that the schema cannot express "score_earned must not exceed
 * score_possible", or that scores are non-negative. Those are checked in
 * cross-check.ts instead. This is why the arithmetic verification there is not
 * made redundant by schema validation on either provider.
 */

/** One criterion's contribution, matching a row in the rubric. */
export const rubricItemSchema = z.object({
  /**
   * What this line item covers. For an algorithm report, the question or function
   * name plus the criterion, e.g. "Question 2: calculateDiscount — algorithm".
   * For a short response, "Question 3: Flexbox vs. CSS Grid".
   */
  label: z.string(),
  /** Which rubric criterion this scores, e.g. "algorithm", "code_style", "technical", "writing_quality", "checklist", "query_task". */
  criterion: z.string(),
  scoreEarned: z.number(),
  scorePossible: z.number(),
  /** Only when there is something to say. Null for a fully correct item. */
  note: z.string().nullable(),
});

/**
 * What the model claims about a named test's outcome.
 *
 * This field exists so the cross-check has something mechanical to compare. The
 * rule the pipeline enforces is that test results are a *fact* the model may
 * report but must not contradict — and a claim buried in prose cannot be checked,
 * so it is stated here as data too.
 *
 * Deliberately NOT the score. The model may withhold points from code that passes
 * every test, for hardcoded return values or a wildly inefficient approach, and
 * that judgment is the reason it is reading the code at all.
 */
export const testClaimSchema = z.object({
  /** The test name exactly as it appears in the results provided to the model. */
  testName: z.string(),
  claimedStatus: z.enum(["passed", "failed", "skipped"]),
});

/**
 * Every flag the model may raise, and the whole list.
 *
 * Each one names a reason a student lost points, and each corresponds to a bullet in
 * a `rubric.md` score band, so a flag can always be traced to the written criterion
 * behind it. Raised only where points were actually deducted — a full-marks section
 * carries none.
 *
 * These are for the instructor. They are never written into the report a student
 * reads; `cross-check.ts` holds a draft whose text contains one.
 *
 * Adding a flag means adding it here and describing it in the prompt. The two have to
 * move together, which is the point of keeping the vocabulary in one place.
 */
export const REPORT_FLAGS = [
  // Writing Quality band bullets.
  /** Spelling and grammar errors. */
  "MECHANICAL",
  /** Ideas hard to follow: vague, contradictory, or needlessly complex. */
  "CLARITY",
  /** Markdown that does not render, or is not used where it would help. */
  "MARKDOWN",
  /** Organization: unclear structure, poor flow, missing transitions. */
  "STRUCTURE",

  // Technical Score band bullets.
  /** Parts of the question left unanswered. */
  "INCOMPLETE",
  /** Gaps, inaccuracies, or misunderstanding of the concept. */
  "UNDERSTANDING",
  /** Technical terminology missing or misused. */
  "TERMINOLOGY",
] as const;

export const gradingReportSchema = z.object({
  /**
   * The report as the student will read it, following the structure of the sample
   * report for this section type. Second person throughout.
   */
  reportMarkdown: z.string(),
  scoreEarned: z.number(),
  scorePossible: z.number(),
  /** Must sum to scoreEarned and scorePossible. Verified in cross-check.ts. */
  rubricItems: z.array(rubricItemSchema),
  /**
   * Empty unless something applies. A closed vocabulary, not free text.
   *
   * This was `z.array(z.string())` and that was a mistake. The same column also
   * carries codes the pipeline writes itself (TEST_EVIDENCE, LOW_CONFIDENCE, the
   * cross-check findings) and the review interface renders every entry as a short
   * badge. Given a field with no stated purpose, the model reasonably used it as a
   * notes field and wrote full sentences into it, which rendered as prose in a badge
   * and buried the codes. `instructorNotes` is where that content belongs.
   */
  flags: z.array(z.enum(REPORT_FLAGS)),
  /**
   * Caveats for the instructor, in prose, never shown to the student.
   *
   * Separate from `reportMarkdown` because the audiences differ: "the point value I
   * was given does not divide evenly into the checklist in this README" is exactly
   * what an instructor needs and exactly what a student should not read.
   */
  instructorNotes: z.array(z.string()),
  /**
   * The model's own assessment. "low" routes to manual review regardless of
   * anything else, because a report the model does not trust should not reach a
   * student with an instructor's name on it.
   */
  confidence: z.enum(["high", "low"]),
  /**
   * The "you pushed to a branch that is not `draft`" note. Null when the student
   * followed the expected process.
   */
  submissionProcessNote: z.string().nullable(),
  /**
   * Every test the report makes a claim about. Empty when the section has no test
   * evidence, which is the ordinary case for short response and frontend work.
   */
  testClaims: z.array(testClaimSchema),
});

export type RubricItem = z.infer<typeof rubricItemSchema>;
export type TestClaim = z.infer<typeof testClaimSchema>;
export type GradingReport = z.infer<typeof gradingReportSchema>;

/**
 * The JSON Schema both providers receive.
 *
 * Derived rather than hand-written, so it cannot fall out of step with the
 * validator. zod 4 emits `additionalProperties: false` and a complete `required`
 * array for every object, which is what strict modes demand.
 *
 * `$schema` is stripped: Groq's strict `json_schema` response format rejects the
 * declaration, and it carries no information the provider needs.
 */
export function gradingReportJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(gradingReportSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** Thrown when a response does not match the schema. */
export class ReportValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`The model's response did not match the report schema: ${issues.join("; ")}`);
    this.name = "ReportValidationError";
    this.issues = issues;
  }
}

/**
 * Validates a parsed response.
 *
 * Throws rather than returning a result union, because a malformed response is
 * never something to grade on — it routes the draft to manual review with the
 * reason attached.
 */
export function parseGradingReport(value: unknown): GradingReport {
  const result = gradingReportSchema.safeParse(value);
  if (!result.success) {
    throw new ReportValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}
