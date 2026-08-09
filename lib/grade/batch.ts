import type { TriageBucket } from "./triage";

/**
 * What a "generate everything pending" run covers, and why it covers nothing when it does.
 *
 * **It reads `bucket` rather than deriving one.** `triageBucket` is already the single authority
 * on what is outstanding, shared by triage, the queue's filter and the gradebook counts, and
 * both screens that offer a batch already carry it on every row. Re-deriving the answer here
 * from a status and a draft would be a fifth implementation of the question — and the one that
 * decides what actually gets graded, so a disagreement would not be a cosmetic difference
 * between two screens but reports generated for work nobody asked about.
 *
 * `lib/grade/triage.ts` says as much where `needs_report` is produced: it is "where a run that
 * generates reports for everything pending would find its subjects". This is that run.
 *
 * Pure, and imports one type, so both the button's count and the set it acts on come from one
 * call and cannot drift apart.
 */

/** One row of either screen, reduced to what deciding a batch needs. */
export type BatchCandidate = {
  submissionId: string;
  /**
   * What to call this in a failure list — a student's name on an assignment's queue, an
   * assignment's title on a student's record.
   *
   * Carried rather than looked up later, because the two screens name a subject differently and
   * the batch should not have to know which one it is running on.
   */
  label: string;
  bucket: TriageBucket | null;
};

/**
 * The subjects, and an account of everything else.
 *
 * The counts exist so an empty batch can say *why*. A button that reads "Nothing to generate" on
 * a queue with twelve rows in it is a screen the instructor has to reconcile themselves — and
 * the three reasons are genuinely different: a run already in flight resolves itself, an
 * assignment graded by hand never had a report to generate, and everything else is simply done.
 */
export type BatchPlan = {
  subjects: BatchCandidate[];
  /** Already being generated. Excluded because the work is happening, not because it cannot. */
  generating: number;
  /** Waiting on a person by design — the pipeline has nothing to offer these. */
  manual: number;
  /** Graded, reviewed, or never handed in. Nothing outstanding of any kind. */
  settled: number;
};

export function planBatch(candidates: readonly BatchCandidate[]): BatchPlan {
  const subjects = candidates.filter((candidate) => candidate.bucket === "needs_report");

  return {
    subjects,
    generating: candidates.filter((candidate) => candidate.bucket === "generating").length,
    manual: candidates.filter((candidate) => candidate.bucket === "needs_manual_grade").length,
    /*
      Everything left, counted by subtraction rather than by listing the buckets that mean
      "nothing to do here". Listed, a bucket added later would fall out of every count and the
      three numbers would quietly stop adding up to the rows on screen.
    */
    settled:
      candidates.length -
      subjects.length -
      candidates.filter(
        (candidate) => candidate.bucket === "generating" || candidate.bucket === "needs_manual_grade",
      ).length,
  };
}

/**
 * What the button says, given a plan.
 *
 * Here rather than in the component because it is the sentence a reader acts on, it has five
 * cases, and every one of them is a decision about what is worth telling somebody. A component
 * is where this would be written as nested ternaries and never checked.
 */
export function batchLabel(plan: BatchPlan): string {
  const count = plan.subjects.length;
  if (count > 0) return `Generate ${count} ${count === 1 ? "report" : "reports"}`;

  // Ordered by what the reader can act on. A run in flight is the one that changes on its own,
  // so it is worth saying even when something else is also true.
  if (plan.generating > 0) return "Already generating";
  if (plan.manual > 0 && plan.settled === 0) return "Graded by hand";
  return "Nothing to generate";
}
