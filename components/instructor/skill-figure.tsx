import { skillShare, type SkillFigure } from "@/lib/skills";
import { formatPercent } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * One skill figure as both tabs print it: the points, the share, and what it rests on.
 *
 * Three lines rather than one, because each answers a different question. `26/30` is the grade;
 * `87%` is the same grade as a share, which is what lets two skills with different maximums be
 * read side by side; `5 sections` is how much is behind it, which a reader needs before
 * trusting either. Technical Writing adds how many assignments raised a proofreading or
 * rendering flag, because the rubric scores attention to detail as half of one band and a count
 * is the nearest honest reading of it.
 *
 * Uncoloured, like the Understanding column on the Performance tab: nothing here is a rule.
 */
export function SkillFigureCell({
  figure,
  detailFlags,
  className,
}: {
  figure: SkillFigure | undefined;
  /** Whether to print the flagged count: true beside Technical Writing and its group only. */
  detailFlags: boolean;
  /** Where the lines sit: left in a grid column, right at the end of a record's row. */
  className?: string;
}) {
  if (figure === undefined || figure.sections === 0) {
    return (
      <div className={cn("flex min-w-0 flex-col", className)}>
        <span className="text-sm tabular-nums">—</span>
        <span className="text-xs text-muted-foreground">nothing graded yet</span>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <span className="text-sm tabular-nums">
        {figure.earned}/{figure.possible}
        <span className="ml-1.5 text-muted-foreground">{formatPercent(skillShare(figure))}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {figure.sections === 1 ? "1 section" : `${figure.sections} sections`}
      </span>
      {detailFlags && figure.flaggable > 0 && (
        <span className="text-xs text-muted-foreground">
          proofreading flagged {figure.flagged} of {figure.flaggable}
        </span>
      )}
    </div>
  );
}

/** The one sentence the rule needs, above either table. */
export function SkillRuleNote() {
  return (
    <p className="text-xs text-muted-foreground">
      Points earned over points possible on every approved section tagged with each skill, so far
      this term. A section counts toward the skill its assignment tags it with, and toward nothing
      when it is tagged with none. Proofreading flagged counts the assignments with a section tagged
      Technical Writing whose report raised a spelling, grammar or rendering flag.
    </p>
  );
}
