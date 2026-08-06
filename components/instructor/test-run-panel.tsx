'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MinusCircle,
  ShieldAlert,
  Terminal,
  TimerOff,
  XCircle,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { formatDuration, formatPercent, formatRelative, shortSha } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { RouterOutputs } from '@/trpc/types';

/**
 * What the runner observed, and nothing more.
 *
 * This panel never turns a failure or an infrastructure error into a score. The
 * distinction it exists to hold is that a suite which errored is not a suite the student
 * failed — conflating the two is how somebody gets a zero for a problem that was never
 * theirs.
 */

type TestRun = RouterOutputs['testRuns']['listForSubmission']['runs'][number];

/**
 * `results` and `tamperedPaths` are Json columns, so they arrive as `unknown` and are
 * read defensively here. A malformed value should cost the detail list, not the page.
 */
interface TestResult {
  suite: string;
  name: string;
  status: string;
  failureMessage?: string;
}

function readResults(value: unknown): TestResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== 'string' || typeof row.status !== 'string') return [];
    return [
      {
        suite: typeof row.suite === 'string' ? row.suite : '',
        name: row.name,
        status: row.status,
        failureMessage:
          typeof row.failureMessage === 'string' ? row.failureMessage : undefined,
      },
    ];
  });
}

function readTamperedPaths(value: unknown): { path: string; kind: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.path !== 'string') return [];
    return [{ path: row.path, kind: typeof row.kind === 'string' ? row.kind : 'changed' }];
  });
}

export function TestRunPanel({
  run,
  hasRunner,
  runnerPreset,
  now,
}: {
  run: TestRun | null;
  /** False when this assignment has no suite at all, which is not a missing run. */
  hasRunner: boolean;
  runnerPreset: string;
  now: Date;
}) {
  /*
    Three states that look alike and are not: an assignment with no tests by design, an
    assignment whose tests have not been run, and tests that ran and failed. Only the
    middle one is a gap in the evidence.
  */
  if (!hasRunner) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
        This assignment has no test suite ({runnerPreset}). Scores rest on the rubric and
        the model&apos;s reading of the code.
      </div>
    );
  }

  if (!run) {
    return (
      <Alert>
        <AlertTriangle className="size-4" />
        <AlertTitle>No test run for this commit</AlertTitle>
        <AlertDescription>
          This assignment has tests, but none have been recorded at this commit. Treat any
          score as unverified until a run completes.
        </AlertDescription>
      </Alert>
    );
  }

  const tampered = readTamperedPaths(run.tamperedPaths);
  const results = readResults(run.results);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/*
          No status badge here. Every state one could report is stated better immediately below
          by `RunOutcome` — a spinner while running, a destructive alert saying an error is not a
          score of zero, another for a timeout, and the pass rate itself when the suite finished.
          The badge was the weaker of two descriptions of the same fact, and the misleading one:
          "Completed" in green sat above a pass rate of 3 out of 13, which is a suite that ran
          and work that failed.
        */}
        <span className="font-mono text-xs text-muted-foreground">
          {run.runnerPreset} · {shortSha(run.headSha)}
        </span>
        <span className="text-xs text-muted-foreground">
          {run.trigger === 'MANUAL' ? 'Manual' : 'Webhook'} ·{' '}
          {formatRelative(run.startedAt, now)}
        </span>
      </div>

      <RunOutcome run={run} />

      {tampered.length > 0 && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Protected files were changed</AlertTitle>
          <AlertDescription>
            <p className="mb-1">
              The student changed files the grader relies on. The template&apos;s version
              of each was restored before the suite ran, so the pass rate is unaffected —
              but the diff is worth reading before accepting the score.
            </p>
            <ul className="ml-4 list-disc font-mono text-xs">
              {tampered.map((entry) => (
                <li key={entry.path}>
                  {entry.path} <span className="opacity-70">({entry.kind})</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {run.status === 'COMPLETED' && results.length > 0 && <TestResultList results={results} />}

      <LogTail label="stdout" content={run.stdoutTail} />
      <LogTail label="stderr" content={run.stderrTail} tone="danger" />
    </div>
  );
}

/**
 * The headline number depends entirely on the status. ERRORED and TIMED_OUT must never
 * read as "0 passed".
 */
function RunOutcome({ run }: { run: TestRun }) {
  if (run.status === 'RUNNING') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Tests are still running…
      </div>
    );
  }

  if (run.status === 'ERRORED') {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>The runner errored — this is not a score of zero</AlertTitle>
        <AlertDescription className="font-mono text-xs">
          {run.errorDetail ?? 'The sandbox failed before the tests could run.'}
        </AlertDescription>
      </Alert>
    );
  }

  if (run.status === 'TIMED_OUT') {
    return (
      <Alert variant="destructive">
        <TimerOff className="size-4" />
        <AlertTitle>The run timed out</AlertTitle>
        <AlertDescription>
          The suite exceeded its time budget. Any partial results below are incomplete, and
          a timeout is not a grade on its own.
        </AlertDescription>
      </Alert>
    );
  }

  // COMPLETED. A null pass rate means no tests matched, which is not nought per cent.
  const emptySuite = run.passRate == null || (run.testsTotal ?? 0) === 0;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex flex-col">
        <span className="text-lg leading-none font-semibold tabular-nums">
          {emptySuite ? '—' : formatPercent(run.passRate)}
        </span>
        <span className="text-xs text-muted-foreground">
          {emptySuite ? 'no tests matched' : 'pass rate'}
        </span>
      </div>
      <div className="h-8 w-px bg-border" />
      <div className="flex items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" />
          {run.testsPassed ?? 0} passed
        </span>
        <span className="inline-flex items-center gap-1 text-destructive">
          <XCircle className="size-4" />
          {run.testsFailed ?? 0} failed
        </span>
        {(run.testsSkipped ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MinusCircle className="size-4" />
            {run.testsSkipped} skipped
          </span>
        )}
      </div>
      <span className="ml-auto text-xs text-muted-foreground">
        {formatDuration(run.durationMs)}
        {run.setupDurationMs != null ? ` (setup ${formatDuration(run.setupDurationMs)})` : ''}
      </span>
    </div>
  );
}

/** Failures first and by default; the passing tests are there but not in the way. */
function TestResultList({ results }: { results: TestResult[] }) {
  const [showAll, setShowAll] = React.useState(false);
  const failing = results.filter((result) => result.status === 'failed');
  const shown = showAll || failing.length === 0 ? results : failing;

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {showAll ? 'All tests' : failing.length > 0 ? `Failing tests (${failing.length})` : 'Tests'}
        </span>
        {failing.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showAll ? 'Show failures only' : `Show all ${results.length}`}
          </button>
        )}
      </div>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {shown.map((result, index) => (
          <li
            key={`${result.suite}-${result.name}-${index}`}
            className="flex items-start gap-2 px-3 py-2"
          >
            {result.status === 'passed' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : result.status === 'failed' ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {result.suite && <span className="text-muted-foreground">{result.suite} › </span>}
                {result.name}
              </p>
              {result.failureMessage && (
                <p className="mt-0.5 font-mono text-xs whitespace-pre-wrap text-destructive">
                  {result.failureMessage}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogTail({
  label,
  content,
  tone = 'muted',
}: {
  label: string;
  content: string | null;
  tone?: 'muted' | 'danger';
}) {
  const [open, setOpen] = React.useState(false);
  if (!content) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50">
        <Terminal className="size-3.5" />
        {label}
        <ChevronDown className="ml-auto size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre
          className={cn(
            'mt-1 max-h-48 overflow-auto rounded-md bg-foreground/[0.04] p-3 font-mono text-xs',
            tone === 'danger' && 'text-destructive',
          )}
        >
          {content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
