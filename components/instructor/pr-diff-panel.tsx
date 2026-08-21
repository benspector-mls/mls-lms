"use client";

import * as React from "react";

import { DiffFileCard } from "@/components/instructor/diff-file-card";
import { Button } from "@/components/ui/button";
import { shortSha } from "@/lib/status";
import type { RouterOutputs } from "@/trpc/types";

type Diff = RouterOutputs["pullRequests"]["diffForSubmission"];

/**
 * How many files a diff can have before none of them opens on its own.
 *
 * Measured rather than guessed: across every pull request in the development database, a
 * submission changed between one and five files. So the ordinary diff opens read-to-read, and a
 * click for no reason is not the price of arriving. Past that the collapsed list is a table of
 * contents read in two seconds, and it keeps the column's height predictable — forty open files
 * would bury the grade beside them, and on a narrow screen would bury it under them.
 */
const AUTO_EXPAND_FILE_LIMIT = 5;

/**
 * What a student changed, file by file.
 *
 * Pure, and told everything it draws — the fetching wrapper is in `grading-review.tsx`, which is
 * the arrangement `TestRunPanel` already has and for the same reason: what this decides is how a
 * diff reads, and it should be possible to see that without a query in the way.
 *
 * **No vertical scroll region anywhere in here.** The column this sits in has its own scrollbar,
 * and a second one inside it would take the wheel whenever the pointer happened to be over the
 * code. Two things replace it: each file scrolls horizontally on its own, which conflicts with
 * nothing, and `DiffFileCard` draws at most five hundred lines of any one file and says how many
 * there were.
 */
export function PrDiffPanel({ diff }: { diff: Diff }) {
  /*
    Which files are open, in one place. The alternative — state inside each card, plus a counter
    above them to override it — is two sources for one fact that have to be kept agreeing, and
    Expand all becomes forty state changes instead of one.
  */
  const [openPaths, setOpenPaths] = React.useState<ReadonlySet<string>>(() => {
    const worthReading = diff.files.filter((file) => file.bulkReason === null);
    // Bulk never opens on its own whatever the count: a committed lockfile is not the thing being
    // read, which is also why it sorts last.
    return worthReading.length <= AUTO_EXPAND_FILE_LIMIT
      ? new Set(worthReading.map((file) => file.path))
      : new Set();
  });

  const setOpen = React.useCallback((path: string, open: boolean) => {
    setOpenPaths((previous) => {
      const next = new Set(previous);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  if (diff.files.length === 0) {
    // A real state and not an error: a pull request can be opened with nothing on the branch.
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
        This pull request changes no files.
      </div>
    );
  }

  const allOpen = openPaths.size === diff.files.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm">
        <span className="font-medium">
          {diff.totals.files} {diff.totals.files === 1 ? "file" : "files"}
        </span>
        {diff.totals.additions > 0 && (
          <span className="text-emerald-600 tabular-nums dark:text-emerald-400">
            +{diff.totals.additions}
          </span>
        )}
        {diff.totals.deletions > 0 && (
          <span className="text-destructive tabular-nums">−{diff.totals.deletions}</span>
        )}

        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {shortSha(diff.headSha)}
        </span>

        {/*
          Here rather than in the card header above, because this is where the state it changes
          lives. Threading a set of open paths up into `GradingReview` to put one button in its
          header would add state to the largest component in the repository for a control that
          belongs beside the list it opens.
        */}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setOpenPaths(allOpen ? new Set() : new Set(diff.files.map((file) => file.path)))
          }
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {diff.files.map((file) => (
          <DiffFileCard
            key={file.path}
            file={file}
            open={openPaths.has(file.path)}
            onOpenChange={(open) => setOpen(file.path, open)}
          />
        ))}
      </ul>

      {/*
        Each ceiling says which one it was, because they mean different things to the reader: one
        is this application declining to load a very large diff, and the other is GitHub declining
        to describe one. Both leave the pull request as the way to see the rest.
      */}
      {diff.omittedFiles > 0 && (
        <p className="text-xs text-muted-foreground">
          {diff.omittedFiles} more changed {diff.omittedFiles === 1 ? "file is" : "files are"} not
          shown, because this diff is larger than this panel will load. Open the pull request to see{" "}
          {diff.omittedFiles === 1 ? "it" : "them"}.
        </p>
      )}

      {diff.githubCapReached && (
        <p className="text-xs text-muted-foreground">
          GitHub returns at most 3,000 files for one pull request, and this one reached that limit,
          so the list above may be incomplete.
        </p>
      )}
    </div>
  );
}
