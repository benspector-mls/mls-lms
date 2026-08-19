"use client";

import { AlertTriangle, Gauge } from "lucide-react";

import { EmptyState } from "@/components/list-states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatTakenOn,
  GCF_KIND_META,
  GCF_KINDS,
  gcfScoreLabel,
  PROCTORED_SCALE,
  scaleLabel,
  sortByTakenOn,
  standingFor,
  targetLabel,
  type GcfKind,
} from "@/lib/gcf";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

/**
 * A fellow's own General Coding Framework results.
 *
 * **Their own and nobody else's**, which is a property of the procedure rather than of this
 * component: `gcf.mine` takes no student id at all, so there is no argument that could name
 * somebody else and no check that could be forgotten.
 *
 * **A flagged attempt says so, with the instructor's note beside it.** That is the decision worth
 * knowing about. The alternative — showing the score and hiding the flag — means a fellow can
 * learn from an employer that something on their record was questioned, having had no chance to
 * explain it. So the flag is shown, and where an instructor has not yet written a note the page
 * says the flag is there and that they can ask, rather than leaving a bare word with no account
 * of itself.
 *
 * The two kinds are never compared. A proctored score is a calibrated index from 200 to 600 and a
 * mock is raw test-case correctness out of however many tasks it had.
 */

type Attempt = RouterOutputs["gcf"]["mine"][number];

export function GcfHistory({ attempts }: { attempts: Attempt[] }) {
  if (attempts.length === 0) {
    return (
      <EmptyState
        icon={<Gauge />}
        title="No GCF results yet"
        description="Once you have sat the General Coding Framework — the real one or a mock — your results appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {GCF_KINDS.map((kind) => (
          <StandingCard key={kind} kind={kind} attempts={attempts} />
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Every attempt</h2>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {sortByTakenOn(attempts).map((attempt) => (
            <AttemptRow key={attempt.id} attempt={attempt} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function StandingCard({ kind, attempts }: { kind: GcfKind; attempts: Attempt[] }) {
  const standing = standingFor(attempts, kind);
  const meta = GCF_KIND_META[kind];
  /*
    The scale, named once in the heading so the scores beneath do not each repeat it. Null where
    this fellow's mocks were of different lengths, in which case each score carries its own
    denominator instead.
  */
  const scale = scaleLabel(attempts, kind);
  const score = (attempt: Attempt): string =>
    scale === null ? gcfScoreLabel(attempt) : String(attempt.score);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold">
            {meta.label}
            {scale && <span className="font-normal text-muted-foreground"> ({scale})</span>}
          </h2>
          <span className="text-xs text-muted-foreground">
            {standing.attempts === 0
              ? "no attempts yet"
              : `${standing.attempts} ${standing.attempts === 1 ? "attempt" : "attempts"}`}
          </span>
        </div>

        {standing.best === null ? (
          <p className="text-sm text-muted-foreground">{meta.blurb}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  standing.reached ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                )}
              >
                {score(standing.best)}
              </span>
              <span className="text-xs text-muted-foreground">
                your best, {formatTakenOn(standing.best.takenOn)}
              </span>
            </div>

            {/*
              Where the target is, and where the scale starts. A proctored score has a floor of
              200 rather than zero, so saying only "out of 600" would make a 250 look like a
              fraction of the marks rather than the bottom of the range.
            */}
            <p className="text-xs text-muted-foreground">
              {standing.reached ? "At or above" : "Aiming for"} {targetLabel(kind)}
              {/*
                Where the scale *starts*, which the heading's maximum does not say. A proctored
                200 is the floor rather than zero, so without this a 250 reads as a small fraction
                of the marks instead of the bottom of the range.
              */}
              {kind === "PROCTORED" &&
                ` · the scale runs ${PROCTORED_SCALE.min}–${PROCTORED_SCALE.max}`}
              {standing.latest &&
                standing.latest.id !== standing.best.id &&
                ` · most recent ${score(standing.latest)} on ${formatTakenOn(standing.latest.takenOn)}`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AttemptRow({ attempt }: { attempt: Attempt }) {
  return (
    <li className="flex flex-col gap-1.5 px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          The full label here, denominator and all. This list mixes the two kinds, so no heading
          above it can name one scale — and a bare 840 beside a bare 512 would invite reading the
          first as the better result when they are measurements of different things.
        */}
        <span className="font-medium tabular-nums">{gcfScoreLabel(attempt)}</span>
        <Badge variant="secondary">{GCF_KIND_META[attempt.kind].label}</Badge>
        <span className="text-xs text-muted-foreground">{formatTakenOn(attempt.takenOn)}</span>

        {attempt.integrityFlagged && (
          <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3" />
            Flagged by CodeSignal
          </Badge>
        )}
      </div>

      {/*
        The note, wherever there is one — and a sentence pointing at a person wherever a flag has
        arrived without one yet. A mark on somebody's record that nobody has explained is the
        thing showing the flag at all is meant to prevent, not to create.
      */}
      {attempt.note && <p className="text-xs text-muted-foreground">{attempt.note}</p>}

      {attempt.integrityFlagged && !attempt.note && (
        <p className="text-xs text-muted-foreground">
          CodeSignal flags an attempt for review — it is not a finding. Your instructor can tell you
          what this one was about.
        </p>
      )}
    </li>
  );
}
