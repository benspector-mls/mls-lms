import "server-only";

import type { GradingReport } from "./schema";

/**
 * The interface a grading provider implements.
 *
 * Everything upstream calls `getReportGenerator()` and never names a vendor, so
 * changing model or provider is a change to one file rather than to the pipeline.
 */

export type ReportRequest = {
  /**
   * The stable part of the prompt: the tone rules, the rubric section, and the
   * sample report. Byte-for-byte identical for every submission of a given section
   * type, which is what makes it worth marking as cacheable.
   *
   * Prompt caching is a prefix match, so this has to come first and must not carry
   * anything that varies per submission — a student's name or a timestamp spliced
   * in here would invalidate the cache on every single request.
   */
  system: string;
  /** The submission-specific part: the student's code, the answer keys, the results. */
  user: string;
};

/**
 * What a provider is asked to enforce, expressed once.
 *
 * The zod schema is the contract rather than a JSON Schema document, because a
 * provider's SDK derives the request format from it and validates the response
 * against the same definition. A JSON Schema document describes the request only,
 * and leaves the validator to be written a second time by hand.
 */

export type ReportResponse = {
  /** Validated and typed. */
  output: GradingReport;
  usage: {
    promptTokens: number;
    completionTokens: number;
    /**
     * Prompt tokens served from cache. Zero across repeated requests means the
     * stable prefix is being invalidated by something that varies — worth checking
     * rather than assuming caching is working.
     */
    cachedPromptTokens?: number;
    /** Tokens written to cache on this request, which cost more than a read. */
    cacheWriteTokens?: number;
  };
  modelId: string;
};

export interface ReportGenerator {
  readonly name: string;
  generate(request: ReportRequest): Promise<ReportResponse>;
}

export class ProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
  }
}

/**
 * Selected with GRADING_LLM_PROVIDER, which defaults to Claude.
 *
 * An unrecognized value throws rather than falling back, so a stale setting left in
 * an environment fails loudly instead of quietly grading with a provider nobody
 * chose.
 *
 * Imported lazily so that a missing ANTHROPIC_API_KEY does not break a process that
 * only wanted to run tests, and so that adding a provider does not pull its SDK into
 * every bundle that touches this module.
 */
export async function getReportGenerator(): Promise<ReportGenerator> {
  const provider = (process.env.GRADING_LLM_PROVIDER ?? "claude").toLowerCase();

  switch (provider) {
    case "claude": {
      const { createClaudeGenerator } = await import("./providers/claude");
      return createClaudeGenerator();
    }
    default:
      throw new ProviderError(`Unknown GRADING_LLM_PROVIDER "${provider}". Supported: claude.`);
  }
}
