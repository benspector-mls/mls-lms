import "server-only";

import { z } from "zod";

import { ProviderError, type ReportGenerator, type ReportRequest } from "../provider";
import { gradingReportSchema, parseGradingReport } from "../schema";

/**
 * Groq, through its OpenAI-compatible chat completions endpoint.
 *
 * This is the proof of concept's provider, chosen for a free tier generous enough
 * to iterate on prompts without watching a bill. `openai/gpt-oss-120b` with the
 * strict `json_schema` response format is the one Groq model and mode combination
 * confirmed to guarantee schema-conformant output.
 *
 * Plain `fetch` rather than an SDK: the endpoint is OpenAI-compatible and this file
 * uses two fields of it, so a dependency would buy nothing.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

type GroqResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export function createGroqGenerator(): ReportGenerator {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new ProviderError(
      "GROQ_API_KEY is not set. Create one at https://console.groq.com/keys and add " +
      "it to .env.local — see .env.example.",
    );
  }

  const model = process.env.GROQ_MODEL ?? DEFAULT_MODEL;

  return {
    name: `groq:${model}`,

    async generate(request: ReportRequest) {
      // Derived here rather than passed in, so the zod schema stays the single
      // source of truth for both providers.
      const jsonSchema = z.toJSONSchema(gradingReportSchema) as Record<string, unknown>;
      delete jsonSchema.$schema;

      let response: Response;
      try {
        response = await fetch(GROQ_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
            // `strict: true` is what turns this from a hint into a guarantee.
            response_format: {
              type: "json_schema",
              json_schema: { name: "grading_report", strict: true, schema: jsonSchema },
            },
            // Grading is judgment against a rubric, not creative writing. Low but
            // not zero, because zero has never guaranteed identical output.
            temperature: 0.2,
          }),
        });
      } catch (err) {
        throw new ProviderError("Could not reach the Groq API.", { cause: err });
      }

      const body = (await response.json().catch(() => null)) as GroqResponse | null;

      if (!response.ok) {
        throw new ProviderError(
          `Groq returned ${response.status}: ${body?.error?.message ?? "no detail"}`,
        );
      }

      const choice = body?.choices?.[0];
      const content = choice?.message?.content;

      if (choice?.finish_reason === "length") {
        // The response was cut off mid-JSON, so it will not parse. Distinguished
        // from a schema violation because the fix is different: raise the limit.
        throw new ProviderError(
          "Groq stopped at the token limit, so the report is incomplete. The " +
          "submission may be too large, or max_tokens too low.",
        );
      }
      if (!content) {
        throw new ProviderError("Groq returned no content.");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new ProviderError(
          "Groq's response was not valid JSON despite the strict schema.",
          { cause: err },
        );
      }

      return {
        // Validated again on this side. Strict mode makes it unlikely to fail, but
        // "unlikely" is not the same as "checked", and a malformed report routes to
        // manual review rather than reaching a student.
        output: parseGradingReport(parsed),
        usage: {
          promptTokens: body?.usage?.prompt_tokens ?? 0,
          completionTokens: body?.usage?.completion_tokens ?? 0,
        },
        modelId: model,
      };
    },
  };
}
