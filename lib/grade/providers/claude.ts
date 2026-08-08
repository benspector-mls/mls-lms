import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { ProviderError, type ReportGenerator, type ReportRequest } from "../provider";
import { gradingReportSchema, parseGradingReport } from "../schema";

/**
 * Claude, through the official SDK.
 *
 * Two things this does that the Groq implementation cannot, and they are the reason
 * the interface passes a zod schema rather than a JSON Schema document.
 *
 * `messages.parse()` with `zodOutputFormat()` derives the response format from the
 * same schema that validates the result, so there is no hand-written validator to
 * fall out of step with it.
 *
 * `cache_control` marks the system prompt as cacheable. That prompt — the tone
 * rules, the rubric section, and the sample report — is byte-for-byte identical for
 * every submission of a given section type, and cached content bills at roughly a
 * tenth of the normal input price. On a cohort's worth of submissions that is the
 * dominant cost factor, well ahead of which model tier is chosen.
 */

const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Grading is judgment over fixed inputs, which is what the effort parameter is for.
 * `high` is the default; the work is not the long-horizon agentic kind that would
 * justify `xhigh`.
 *
 * Settable with GRADING_LLM_EFFORT because it is the significant cost lever and the
 * trade-off is a judgment call, not a fact. Thinking is billed as output, and output
 * is roughly 70 percent of what a report costs, so lowering this moves total cost far
 * more than prompt caching or model tier do. It also lowers grading quality, which is
 * why it is neither hard-coded low nor left undiscussable.
 */
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;
type Effort = (typeof EFFORT_LEVELS)[number];
const DEFAULT_EFFORT: Effort = "high";

function resolveEffort(): Effort {
  const configured = process.env.GRADING_LLM_EFFORT?.toLowerCase();
  if (!configured) return DEFAULT_EFFORT;
  if (!(EFFORT_LEVELS as readonly string[]).includes(configured)) {
    // Thrown rather than silently defaulting: a typo here would quietly change what
    // every report costs and how carefully it was graded.
    throw new ProviderError(
      `GRADING_LLM_EFFORT is "${configured}". Use one of: ${EFFORT_LEVELS.join(", ")}.`,
    );
  }
  return configured as Effort;
}

/**
 * Generous, and deliberately so. Thinking is on by default on this model and
 * `max_tokens` caps thinking plus response text together, so a limit sized to the
 * report alone would truncate it mid-sentence.
 */
const MAX_TOKENS = 16_000;

export function createClaudeGenerator(): ReportGenerator {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ProviderError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local — see .env.example.",
    );
  }

  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const effort = resolveEffort();
  const client = new Anthropic({ apiKey });

  return {
    // Carries the effort level, because it is recorded in model_metadata and two
    // drafts of the same submission graded at different levels are not comparable.
    name: `claude:${model}:${effort}`,

    async generate(request: ReportRequest) {
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: MAX_TOKENS,
          output_config: {
            format: zodOutputFormat(gradingReportSchema),
            effort,
          },
          // An array rather than a string, because cache_control attaches to a
          // content block. The whole system prompt is one block and one cache
          // breakpoint: everything before it is stable, everything after it varies.
          system: [
            {
              type: "text",
              text: request.system,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: request.user }],
        });

        // Safety classifiers can decline a request, and that arrives as a normal
        // 200 with an empty content array. Checked before reading anything out of
        // the response, because indexing into content would otherwise throw.
        if (response.stop_reason === "refusal") {
          throw new ProviderError(
            `Claude declined to produce this report` +
              `${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}. ` +
              `The submission's content may have tripped a safety classifier — an ` +
              `instructor should read it directly.`,
          );
        }
        if (response.stop_reason === "max_tokens") {
          throw new ProviderError(
            `Claude hit the ${MAX_TOKENS} token limit, so the report is incomplete. ` +
              `Raise MAX_TOKENS in lib/grade/providers/claude.ts, or reduce how much ` +
              `of the submission is sent.`,
          );
        }

        if (!response.parsed_output) {
          throw new ProviderError(
            "Claude returned a response that did not parse against the report schema.",
          );
        }

        return {
          // Run through the same validator the other provider uses, so both sides
          // enforce the schema identically rather than trusting parsed_output alone.
          output: parseGradingReport(response.parsed_output),
          usage: {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            cachedPromptTokens: response.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
          },
          modelId: response.model,
        };
      } catch (err) {
        if (err instanceof ProviderError) throw err;

        // Typed SDK errors, most specific first. Worth distinguishing because the
        // responses differ: a rate limit is worth retrying, a bad request is not.
        if (err instanceof Anthropic.RateLimitError) {
          throw new ProviderError("Claude rate limit reached. Retry shortly.", { cause: err });
        }
        if (err instanceof Anthropic.AuthenticationError) {
          throw new ProviderError("ANTHROPIC_API_KEY was rejected.", { cause: err });
        }
        if (err instanceof Anthropic.APIConnectionError) {
          throw new ProviderError("Could not reach the Claude API.", { cause: err });
        }
        if (err instanceof Anthropic.APIError) {
          throw new ProviderError(`Claude returned an error: ${err.message}`, { cause: err });
        }
        throw err;
      }
    },
  };
}
