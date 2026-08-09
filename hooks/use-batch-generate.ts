"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

import { runPool } from "@/lib/concurrency";
import type { BatchCandidate } from "@/lib/grade/batch";
import { useTRPCClient } from "@/trpc/client";

/**
 * Generating reports for everything outstanding on one screen.
 *
 * **The batch is not a request.** It is N requests, one per submission, fired a few at a time
 * from the browser. That is not a shortcut around a queue — it is what
 * [ROADMAP.md](../ROADMAP.md) concluded when it worked out that a single submission takes about
 * two minutes against a 300-second function limit, so one invocation per submission satisfies
 * the only requirement that ever argued for a worker process. What is left over is the reason
 * the automatic half is still unbuilt, not a gap in this one.
 *
 * The cost, stated rather than discovered: **closing the tab stops the batch.** Whatever is in
 * flight finishes on the server and its report lands; nothing further starts. Nothing is lost
 * and nothing is half-written, because each submission is its own transaction-free unit and its
 * draft row is the record — reopening the screen shows exactly what got done. For a student's
 * four outstanding assignments that is nothing to worry about. For a whole cohort it is the
 * point at which the durable design becomes worth building.
 */

/** What happened to one subject, once the batch is over. */
export type BatchFailure = { submissionId: string; label: string; message: string };

export type BatchState = {
  running: boolean;
  /** How many subjects this run started with, so progress can be read as "7 of 12". */
  total: number;
  done: number;
  /** In flight right now, so a row can say so before the server has been asked again. */
  inFlight: ReadonlySet<string>;
  failures: BatchFailure[];
  /** Never started, because the run was stopped. Offered back as "resume", not as "retry". */
  skipped: BatchCandidate[];
};

/**
 * How many at a time.
 *
 * E2B allows twenty concurrent sandboxes on this account, so the sandbox half is not what binds.
 * Six rather than twenty for three reasons that all point the same way: this organization's
 * output-tokens-per-minute limit at Anthropic is unmeasured and each report writes two and a
 * half to three and a half thousand output tokens with thinking counted in; running at the cap
 * leaves no sandbox for a second instructor grading at the same time; and the failure mode of
 * guessing high is a rate limit, which lands a submission in the failure list rather than
 * breaking the run.
 *
 * An environment variable rather than a constant so raising it after watching one real batch is
 * a setting rather than a deploy.
 */
function poolWidth(): number {
  const configured = Number(process.env.NEXT_PUBLIC_BATCH_GENERATE_WIDTH);
  return Number.isFinite(configured) && configured > 0 ? configured : 6;
}

export function useBatchGenerate() {
  const client = useTRPCClient();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [state, setState] = React.useState<BatchState>({
    running: false,
    total: 0,
    done: 0,
    inFlight: new Set(),
    failures: [],
    skipped: [],
  });

  /*
    A ref rather than state, because `runPool` reads it from inside a closure that was created
    when the run started. State read there would be the value at that moment forever, and Stop
    would set a flag nothing ever looked at again.
  */
  const stopped = React.useRef(false);

  const run = React.useCallback(
    async (
      subjects: readonly BatchCandidate[],
      options: {
        /**
         * Run the first subject alone before fanning out the rest.
         *
         * Worth doing when every subject shares a prompt: the cacheable block is the system
         * prompt, built from the rubric section, agent rules, sample report and answer keys, so
         * one assignment's queue is twenty students against one identical prefix. Fired cold and
         * all at once, twenty requests each pay to *write* that cache instead of one writing and
         * nineteen reading.
         *
         * Deliberately off for a student's record, where each row is a different assignment with
         * different answer keys and therefore a different prefix. There is nothing to warm, and
         * holding the first submission back would serialize a batch that is small to begin with.
         */
        warmFirst: boolean;
      },
    ) => {
      if (subjects.length === 0) return;

      stopped.current = false;
      setState({
        running: true,
        total: subjects.length,
        done: 0,
        inFlight: new Set(),
        failures: [],
        skipped: [],
      });

      const failures: BatchFailure[] = [];

      const generateOne = async (subject: BatchCandidate) => {
        setState((prev) => ({ ...prev, inFlight: new Set(prev.inFlight).add(subject.submissionId) }));
        try {
          /*
            The procedure is called through the client rather than through `useMutation`. Two
            reasons, and the second is the one that matters.

            `useMutation` holds the state of *one* call, so N of them would need N hooks — which
            is not a thing a component can do for a list whose length it learns at runtime.

            And `useServerMutation` must not be used here, which is the trap. Its `settled`
            wrapper invalidates every query and calls `router.refresh()` on each success, and
            both screens offering a batch are server components whose list arrives as a prop. On
            a run of twenty that is twenty full page refreshes, each re-fetching the whole list
            while the run is still going. The two refreshes are right and necessary — they are
            just right *once*, when the run is over, which is where this does them.
          */
          await client.gradingDrafts.generate.mutate({ submissionId: subject.submissionId });
        } finally {
          setState((prev) => {
            const inFlight = new Set(prev.inFlight);
            inFlight.delete(subject.submissionId);
            return { ...prev, inFlight, done: prev.done + 1 };
          });
        }
      };

      const record = (subject: BatchCandidate, error: unknown) => {
        failures.push({
          submissionId: subject.submissionId,
          label: subject.label,
          // The server's own sentence. Every refusal `generate` produces is written for the
          // person who hit it — "no answer keys at that path", "the pull request contains none
          // of the sections this assignment declares" — and rewording them here would replace
          // something actionable with something generic.
          message: error instanceof Error ? error.message : String(error),
        });
      };

      // The warm-up is one ordinary run of the same worker, not a special path. If it fails it
      // is recorded like any other subject and the rest still go — a first submission that
      // cannot be graded says nothing about the nineteen behind it.
      const [first, ...rest] = subjects;
      const fanOut = options.warmFirst ? rest : subjects;

      if (options.warmFirst) {
        try {
          await generateOne(first);
        } catch (error) {
          record(first, error);
        }
      }

      const results = stopped.current
        ? []
        : await runPool(fanOut, poolWidth(), generateOne, { shouldStop: () => stopped.current });

      const skipped: BatchCandidate[] = [];
      results.forEach((result, index) => {
        if (result.status === "failed") record(fanOut[index], result.error);
        if (result.status === "skipped") skipped.push(fanOut[index]);
      });
      if (stopped.current && options.warmFirst && results.length === 0) skipped.push(...rest);

      /*
        Once, at the end, and both of them.

        Two caches, for the reason `useServerMutation` documents: the list on these screens is
        server-rendered so only `router.refresh()` re-runs it, and the review pane beside it
        fetches through the tRPC client where `router.refresh()` does not reach. A batch that
        refreshed neither would finish with every row still reading "needs report".
      */
      await queryClient.invalidateQueries();
      router.refresh();

      setState((prev) => ({ ...prev, running: false, inFlight: new Set(), failures, skipped }));
    },
    [client, queryClient, router],
  );

  const stop = React.useCallback(() => {
    stopped.current = true;
  }, []);

  /** Clears a finished run's report, so the button goes back to offering the next one. */
  const dismiss = React.useCallback(() => {
    setState({
      running: false,
      total: 0,
      done: 0,
      inFlight: new Set(),
      failures: [],
      skipped: [],
    });
  }, []);

  return { state, run, stop, dismiss };
}
