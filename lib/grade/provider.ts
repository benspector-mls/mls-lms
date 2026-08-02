import "server-only";

import type { GradingReport } from "./schema";

/**
 * One interface, two implementations.
 *
 * The proof of concept runs on Groq's free tier; changing to Claude later should
 * modify one file rather than the pipeline. Everything upstream calls
 * `getReportGenerator()` and never names a vendor.
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
 * The zod schema is the contract rather than a JSON Schema document, because the
 * two providers consume it differently and each has a better path than a
 * hand-rolled one. Claude's SDK derives the format and parses the response through
 * the same schema; Groq needs a plain JSON Schema in its request body, which the
 * schema derives. Passing JSON Schema alone would throw away the Claude path.
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
 * Selected with GRADING_LLM_PROVIDER. Defaults to Groq, which is what the proof of
 * concept runs on.
 *
 * Imported lazily so that a missing GROQ_API_KEY does not break a process that only
 * wanted to run tests, and so that adding a provider does not pull its SDK into
 * every bundle that touches this module.
 */
export async function getReportGenerator(): Promise<ReportGenerator> {
  const provider = (process.env.GRADING_LLM_PROVIDER ?? "groq").toLowerCase();

  switch (provider) {
    case "groq": {
      const { createGroqGenerator } = await import("./providers/groq");
      return createGroqGenerator();
    }
    case "claude": {
      const { createClaudeGenerator } = await import("./providers/claude");
      return createClaudeGenerator();
    }
    default:
      throw new ProviderError(
        `Unknown GRADING_LLM_PROVIDER "${provider}". Supported: groq, claude.`,
      );
  }
}
