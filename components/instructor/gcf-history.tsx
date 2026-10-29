import { Badge } from "@/components/ui/badge";
import { formatSchoolDay } from "@/lib/school-time";

export type GcfAttemptRow = {
  id: string;
  kind: "PROCTORED" | "MOCK";
  score: number;
  scorePossible: number | null;
  takenOn: Date;
  integrityFlagged: boolean;
};

/**
 * A fellow's GCF sittings, newest first, or the sentence that says there are none.
 *
 * Drawn on the record's Performance tab and by the coaching form's GCF panel, from one place so
 * the two cannot differ. No hooks and no client-only imports, so it renders on the server inside
 * the record and in the browser inside the form.
 */
export function GcfHistory({ attempts }: { attempts: readonly GcfAttemptRow[] }) {
  if (attempts.length === 0) {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
        They have not sat the GCF yet, real or mock.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
      {attempts.map((attempt) => (
        <li
          key={attempt.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">
            {attempt.kind === "PROCTORED" ? "Proctored" : "Mock"}
          </span>
          <span className="shrink-0 tabular-nums">
            {/*
              The two kinds are never compared, so a proctored score is shown bare — it is a
              calibrated index from 200 to 600 — and a mock is shown over its own possible,
              which is however many tasks that one had.
            */}
            {attempt.scorePossible === null
              ? attempt.score
              : `${attempt.score} / ${attempt.scorePossible}`}
          </span>
          {attempt.integrityFlagged && (
            <Badge variant="outline" className="shrink-0 font-normal text-destructive">
              Integrity flag
            </Badge>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatSchoolDay(attempt.takenOn.toISOString().slice(0, 10))}
          </span>
        </li>
      ))}
    </ul>
  );
}
