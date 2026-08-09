import { batchLabel, planBatch, type BatchCandidate } from "@/lib/grade/batch";
import type { TriageBucket } from "@/lib/grade/triage";

/**
 * What a batch covers.
 *
 * The stakes are different from the rest of triage: elsewhere a bucket decides what a screen
 * says, and here it decides what gets *generated*, which costs money and writes a report a
 * student may eventually read. So the exclusions are checked one by one rather than as a group.
 */

const candidate = (bucket: TriageBucket | null, label = "Ada Lovelace"): BatchCandidate => ({
  submissionId: `sub-${label}-${bucket}`,
  label,
  bucket,
});

describe("planBatch", () => {
  it("takes needs_report and nothing else", () => {
    const plan = planBatch([
      candidate("needs_report", "Ada"),
      candidate("draft_ready", "Grace"),
      candidate("needs_report", "Alan"),
    ]);
    expect(plan.subjects.map((s) => s.label)).toEqual(["Ada", "Alan"]);
  });

  // Each of these is a separate case because each is a separate way to spend money on a report
  // nobody asked for.
  describe("excludes", () => {
    // The first line of defence against generating twice. A run in flight is already doing this
    // work; picking it up again is two sandboxes and two model calls for one report.
    it("a run already in flight", () => {
      expect(planBatch([candidate("generating")]).subjects).toEqual([]);
    });

    // There is no report to generate — the pipeline has nothing to offer these, which is why
    // triage gives them their own bucket rather than folding them into needs_report.
    it("an assignment graded by hand", () => {
      expect(planBatch([candidate("needs_manual_grade")]).subjects).toEqual([]);
    });

    it("a report that already exists", () => {
      expect(planBatch([candidate("draft_ready")]).subjects).toEqual([]);
      expect(planBatch([candidate("needs_manual_review")]).subjects).toEqual([]);
    });

    // A failed run is deliberately not picked up. It failed for a reason an instructor should
    // read, and a batch that silently re-ran it would spend the same money on the same failure.
    it("a run that already failed", () => {
      expect(planBatch([candidate("grading_failed")]).subjects).toEqual([]);
    });

    it("an approval whose comment did not post", () => {
      expect(planBatch([candidate("comment_not_posted")]).subjects).toEqual([]);
    });

    // Never handed in, or already finished. `null` is triage's "needs nobody".
    it("a row that is outstanding to no one", () => {
      expect(planBatch([candidate(null)]).subjects).toEqual([]);
    });
  });

  describe("the account of what was left out", () => {
    it("counts each reason", () => {
      const plan = planBatch([
        candidate("needs_report"),
        candidate("generating"),
        candidate("generating"),
        candidate("needs_manual_grade"),
        candidate("draft_ready"),
        candidate(null),
      ]);
      expect({
        subjects: plan.subjects.length,
        generating: plan.generating,
        manual: plan.manual,
        settled: plan.settled,
      }).toEqual({ subjects: 1, generating: 2, manual: 1, settled: 2 });
    });

    // The four numbers have to account for every row, or the button would explain an empty batch
    // with figures that do not add up to what is on screen.
    it("accounts for every row", () => {
      const rows = [
        candidate("needs_report"),
        candidate("needs_manual_review"),
        candidate("grading_failed"),
        candidate("generating"),
        candidate("needs_manual_grade"),
        candidate("comment_not_posted"),
        candidate(null),
      ];
      const plan = planBatch(rows);
      expect(plan.subjects.length + plan.generating + plan.manual + plan.settled).toBe(rows.length);
    });

    it("handles an empty screen", () => {
      expect(planBatch([])).toEqual({ subjects: [], generating: 0, manual: 0, settled: 0 });
    });
  });
});

describe("batchLabel", () => {
  it("counts the subjects, and gets the singular right", () => {
    expect(batchLabel(planBatch([candidate("needs_report")]))).toBe("Generate 1 report");
    expect(batchLabel(planBatch([candidate("needs_report"), candidate("needs_report", "B")]))).toBe(
      "Generate 2 reports",
    );
  });

  // An empty batch has three different reasons and they are not interchangeable: one resolves
  // itself, one never had a report to generate, and one is simply done.
  it("says why there is nothing to do", () => {
    expect(batchLabel(planBatch([candidate("generating")]))).toBe("Already generating");
    expect(batchLabel(planBatch([candidate("needs_manual_grade")]))).toBe("Graded by hand");
    expect(batchLabel(planBatch([candidate("draft_ready")]))).toBe("Nothing to generate");
    expect(batchLabel(planBatch([]))).toBe("Nothing to generate");
  });

  // A run in flight is the one thing that changes on its own, so it is worth saying even when
  // something else is also true of the screen.
  it("prefers the reason the reader should wait for", () => {
    expect(batchLabel(planBatch([candidate("generating"), candidate("draft_ready")]))).toBe(
      "Already generating",
    );
  });

  // "Graded by hand" would be a lie on a screen that also holds pipeline work already done.
  it("does not call a mixed screen hand-graded", () => {
    expect(batchLabel(planBatch([candidate("needs_manual_grade"), candidate("draft_ready")]))).toBe(
      "Nothing to generate",
    );
  });
});
