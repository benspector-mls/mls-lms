'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';

/**
 * Test results for one submission, with a button to run them.
 *
 * A client component because running the suite is a mutation triggered by an
 * instructor rather than something that happens while a page renders.
 *
 * The three states this has to keep distinct are the whole point of the design:
 * an assignment with no tests, an assignment whose tests have not been run, and
 * an assignment whose tests ran and failed. Collapsing the first into the third
 * is how a short response student would receive a zero.
 */

type TestDetail = {
  suite: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  failureMessage?: string;
};

type TamperedPath = { path: string; kind: string; previousPath?: string };

export function TestRunPanel({ submissionId }: { submissionId: string }) {
  const trpc = useTRPC();
  const [expanded, setExpanded] = useState(false);

  const runs = useQuery(trpc.testRuns.listForSubmission.queryOptions({ submissionId }));
  const start = useMutation(
    trpc.testRuns.start.mutationOptions({
      onSuccess: () => runs.refetch(),
    }),
  );

  if (runs.isPending) {
    return <p className="text-sm text-muted-foreground">Loading test results…</p>;
  }

  if (runs.error) {
    return (
      <p className="text-sm text-red-500" role="alert">
        {runs.error.message}
      </p>
    );
  }

  const data = runs.data;
  if (!data) return null;

  // No runner is a normal state of the world, not something broken or
  // unconfigured, and it reads that way deliberately: no button, no error, no
  // disabled control implying the instructor is missing something.
  if (!data.hasRunner) {
    return (
      <p className="text-sm text-muted-foreground">
        {data.presetError ?? 'No automated tests for this assignment'}
      </p>
    );
  }

  const latest = data.runs[0];

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            onClick={() => start.mutate({ submissionId })}
            disabled={start.isPending || !data.canRun}
            size="sm"
            variant="outline"
          >
            {start.isPending ? 'Running tests…' : latest ? 'Run tests again' : 'Run tests'}
          </Button>
          <span className="text-xs text-muted-foreground">{data.runnerPreset}</span>
        </div>

        {data.runs.length > 1 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs underline underline-offset-4"
          >
            {expanded ? 'Hide' : `Show all ${data.runs.length} runs`}
          </button>
        )}
      </div>

      {!data.canRun && (
        <p className="text-xs text-muted-foreground">
          Nothing to test yet — the student has to open a pull request first.
        </p>
      )}

      {start.error && (
        <p className="text-sm text-red-500" role="alert">
          {start.error.message}
        </p>
      )}

      {!latest && data.canRun && (
        <p className="text-sm text-muted-foreground">Tests have not been run for this submission.</p>
      )}

      {latest && <RunSummary run={latest} />}

      {expanded &&
        data.runs.slice(1).map((run) => (
          <div key={run.id} className="opacity-60">
            <RunSummary run={run} />
          </div>
        ))}
    </div>
  );
}

type Run = {
  id: string;
  headSha: string;
  status: string;
  trigger: string;
  testsTotal: number | null;
  testsPassed: number | null;
  testsFailed: number | null;
  testsSkipped: number | null;
  passRate: number | null;
  results: unknown;
  tamperedPaths: unknown;
  errorDetail: string | null;
  stderrTail: string | null;
  durationMs: number | null;
  setupDurationMs: number | null;
  templateCommitSha: string | null;
  startedAt: Date;
};

function RunSummary({ run }: { run: Run }) {
  const tests = Array.isArray(run.results) ? (run.results as TestDetail[]) : [];
  const tampered = Array.isArray(run.tamperedPaths) ? (run.tamperedPaths as TamperedPath[]) : [];
  const failures = tests.filter((test) => test.status === 'failed');

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(run.status)}>{run.status}</Badge>

        {/* A completed run reports counts. Pass or fail is testsFailed, not status. */}
        {run.status === 'COMPLETED' && (
          <span>
            {run.testsPassed}/{run.testsTotal} passing
            {run.testsSkipped ? ` · ${run.testsSkipped} skipped` : ''}
            {run.passRate !== null && ` · ${Math.round(run.passRate * 100)}%`}
          </span>
        )}

        <span className="text-xs text-muted-foreground">
          {run.headSha.slice(0, 7)}
          {run.templateCommitSha && ` · tests ${run.templateCommitSha.slice(0, 7)}`}
          {run.durationMs !== null && ` · ${(run.durationMs / 1000).toFixed(1)}s`}
          {run.setupDurationMs !== null && ` (setup ${(run.setupDurationMs / 1000).toFixed(1)}s)`}
          {run.trigger === 'WEBHOOK' ? ' · automatic' : ''}
        </span>
      </div>

      {/*
        A changed protected path is a finding an instructor must see and never an
        automatic penalty. It cannot have affected the counts above: the template's
        version of every protected path is restored before the suite runs.
      */}
      {tampered.length > 0 && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-2">
          <p className="font-medium">
            {tampered.length} grading file{tampered.length === 1 ? '' : 's'} changed by the student
          </p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {tampered.map((entry) => (
              <li key={`${entry.kind}:${entry.path}`}>
                <code>{entry.path}</code> {entry.kind}
                {entry.previousPath && ` (was ${entry.previousPath})`}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            The template&rsquo;s versions were restored before the suite ran, so the counts above
            are unaffected.
          </p>
        </div>
      )}

      {/*
        ERRORED means nothing is known about the student's code. Shown as an
        infrastructure problem rather than as a result, because it is not a score.
      */}
      {(run.status === 'ERRORED' || run.status === 'TIMED_OUT') && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-2">
          <p className="text-xs">{run.errorDetail ?? 'No detail recorded.'}</p>
          {run.stderrTail && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
              {run.stderrTail}
            </pre>
          )}
        </div>
      )}

      {failures.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs underline underline-offset-4">
            {failures.length} failing test{failures.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {failures.map((test, index) => (
              <li key={`${test.suite}:${test.name}:${index}`} className="text-xs">
                <p className="font-medium">
                  {test.suite ? `${test.suite} › ` : ''}
                  {test.name}
                </p>
                {test.failureMessage && (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">
                    {test.failureMessage}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'COMPLETED':
      return 'default';
    case 'RUNNING':
      return 'secondary';
    case 'ERRORED':
    case 'TIMED_OUT':
      return 'destructive';
    default:
      return 'outline';
  }
}
