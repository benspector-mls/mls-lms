"use client";

/**
 * The two cards that fetch what the grade is *about*, for work collected as a repository: the
 * files the student changed, and what the test suite made of them.
 *
 * Both are wrappers. Everything about how a diff or a run reads is in `PrDiffPanel` and
 * `TestRunPanel`, which are given their data and draw it — so these stay small enough to see the
 * loading and error decisions in one glance.
 */

import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ExternalLink,
  FlaskConical,
  FileDiff,
  GitPullRequest,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { TestRunPanel } from "@/components/instructor/test-run-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { PrDiffPanel } from "@/components/instructor/pr-diff-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";
/**
 * Test evidence, shown in every state and below the report in each of them, because it is
 * what the report's claims rest on rather than the thing being reviewed.
 */
/**
 * The pull request's diff, fetched.
 *
 * The counterpart of `TestEvidence` below and deliberately the same shape: a card with a title, an
 * action, and a component that draws the data without knowing where it came from. Everything about
 * how a diff reads is in `PrDiffPanel`, so this stays a wrapper.
 */
export function DiffPanel({
  diff,
  loading,
  error,
  prUrl,
  prNumber,
}: {
  diff: RouterOutputs["pullRequests"]["diffForSubmission"] | undefined;
  loading: boolean;
  error: { message: string } | null;
  prUrl: string | null;
  prNumber: number | null;
}) {
  if (loading) return <Skeleton className="h-20 w-full" />;

  const pullRequestLink = prUrl ? (
    <a
      href={prUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}
    >
      <GitPullRequest data-icon="inline-start" />
      PR #{prNumber}
      <ExternalLink data-icon="inline-end" />
    </a>
  ) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileDiff className="size-4 text-muted-foreground" />
            Changed files
          </CardTitle>
          {pullRequestLink}
        </div>

        {/*
          The limit of what this can show, said once for the panel and in the description rather
          than behind a hover. A pull request's diff is measured against its base, and the base is
          the template snapshot this student received — so a change they committed straight to
          their own default branch before branching is *in* that base and does not appear here.
          Students are taught to revert that, which means it happens; a card calling itself the
          changed files and quietly omitting some would be the wrong place to be silent.
        */}
        <CardDescription>
          Measured against the template this student started from, which is the base of their pull
          request. Anything they committed to their own <code className="font-mono">main</code>{" "}
          before branching is part of that base and is not shown here.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/*
          A message rather than nothing. "The diff could not be loaded" and "there is no diff" are
          different facts, and an empty card would report the second when the first is true — with
          the pull request link above still offering the way through.
        */}
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Could not load the changed files</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : diff ? (
          <PrDiffPanel diff={diff} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TestEvidence({
  submissionId,
  runs,
  currentRun,
  loading,
  now,
}: {
  submissionId: string;
  runs: RouterOutputs["testRuns"]["listForSubmission"] | undefined;
  currentRun: RouterOutputs["testRuns"]["listForSubmission"]["runs"][number] | null;
  loading: boolean;
  now: Date;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const start = useMutation(
    trpc.testRuns.start.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Test run finished.");
        },
      }),
    ),
  );

  if (loading) return <Skeleton className="h-20 w-full" />;
  if (!runs) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4 text-muted-foreground" />
            Test evidence
          </CardTitle>
          {runs.hasRunner && runs.canRun && (
            <Button
              size="sm"
              variant="outline"
              disabled={start.isPending}
              onClick={() => start.mutate({ submissionId })}
            >
              {start.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {start.isPending ? "Running the suite…" : currentRun ? "Run again" : "Run tests"}
            </Button>
          )}
        </div>
        {runs.presetError && (
          <CardDescription className="text-destructive">{runs.presetError}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <TestRunPanel
          run={currentRun}
          hasRunner={runs.hasRunner}
          runnerPreset={runs.runnerPreset}
          now={now}
        />
      </CardContent>
    </Card>
  );
}
