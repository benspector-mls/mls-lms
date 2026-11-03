import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Suggesting a skill for each section of an assignment being authored.
 *
 * A suggestion, never a tag: the procedure returns one skill per section with a reason, the
 * section editor shows it beside the picker, and the instructor confirms or changes it. The
 * model is given the taxonomy's definitions and each section's label and prompt, which is what
 * an instructor reads when they tag by hand.
 *
 * Its own small call rather than the grading provider, because that provider's whole contract is
 * the grading report schema; what is shared with it is the key, the model and the SDK.
 */

const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Room for the sixty sections the procedure accepts, at a key, an id and a sentence each; no
 * thinking is paid for, so this is the ceiling on the answer alone.
 */
const MAX_TOKENS = 16_000;

export type SectionToTag = {
  key: string;
  label: string;
  heading?: string;
  /** The prompt or instructions the section scores, when the form has them. */
  text?: string;
};

export type SkillChoice = { id: string; canonicalId: string; name: string; definition: string };

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      key: z.string(),
      /** The canonical id of the chosen skill, or an empty string for a section that is evidence of none. */
      canonicalId: z.string(),
      /** One sentence for the instructor, saying what in the section calls for that skill. */
      reason: z.string(),
    }),
  ),
});

export type SkillSuggestion = { key: string; skillId: string | null; reason: string };

export async function suggestSkills(params: {
  assignmentTitle: string;
  sections: SectionToTag[];
  skills: SkillChoice[];
}): Promise<SkillSuggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set, so nothing can be suggested.");
  if (params.sections.length === 0 || params.skills.length === 0) return [];

  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { format: zodOutputFormat(suggestionSchema) },
    system: [
      {
        type: "text",
        text: systemPrompt(params.skills),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt(params.assignmentTitle, params.sections) }],
  });

  if (!response.parsed_output) {
    throw new Error("The model's suggestions did not match the expected shape.");
  }

  const byCanonicalId = new Map(params.skills.map((skill) => [skill.canonicalId, skill.id]));
  const keys = new Set(params.sections.map((section) => section.key));
  return response.parsed_output.suggestions.flatMap((suggestion) => {
    if (!keys.has(suggestion.key)) return [];
    const id = suggestion.canonicalId.trim();
    // An empty id is the model saying the section is evidence of no skill, which is a
    // suggestion. An id the taxonomy does not hold is an invention, and treating it as
    // "nothing" would untag a section on "Use every suggestion"; it is dropped instead.
    if (id !== "" && !byCanonicalId.has(id)) return [];
    return [
      { key: suggestion.key, skillId: byCanonicalId.get(id) ?? null, reason: suggestion.reason },
    ];
  });
}

function systemPrompt(skills: SkillChoice[]): string {
  return [
    "# Tagging an assignment's sections with skills",
    "",
    "An instructor at The Marcy Lab School is writing an assignment. Each section of it is one",
    "scored unit: a question, an exercise, or a rubric criterion. Every section is tagged with",
    "exactly one skill from the taxonomy below, so that a fellow's scores can be read per skill",
    "over a term. You suggest the tag; the instructor decides.",
    "",
    "Choose the skill whose definition names what the section actually scores. A question that",
    "asks a fellow to predict what code prints is Reading and Predicting Code even if the code is",
    "about loops; a question that asks them to write a loop is Python Programming. When two skills",
    "fit, choose the narrower one. A section that is evidence of no skill in the list, such as",
    "a participation mark, gets an empty canonicalId.",
    "",
    "Return one entry per section, carrying the section's key exactly as given, the chosen",
    "skill's canonical id exactly as given, and one sentence saying what in the section calls",
    "for that skill.",
    "",
    "# The taxonomy",
    "",
    ...skills.map((skill) => `- \`${skill.canonicalId}\` — ${skill.name}: ${skill.definition}`),
  ].join("\n");
}

function userPrompt(title: string, sections: SectionToTag[]): string {
  const parts = [`# Assignment: ${title}`, ""];
  for (const section of sections) {
    parts.push(`## Section \`${section.key}\`: ${section.label}`);
    if (section.heading) parts.push(`Under the heading: ${section.heading}`);
    parts.push("");
    parts.push(section.text ? section.text : "(No further text; judge from the label.)");
    parts.push("");
  }
  return parts.join("\n");
}
