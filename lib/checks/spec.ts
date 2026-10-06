import { z } from "zod";

import { retryWaitHoursOf } from "./attempts";

/**
 * What a check for understanding is, and what makes one valid.
 *
 * The same shape as `lib/resources/spec.ts` and for the same reason: the authoring form is a
 * client component and reports a problem as it is typed, and the procedure is what actually
 * refuses. **No `server-only` import**; nothing here touches the database or a secret.
 */

const markdown = (what: string) => z.string().trim().min(1, `${what} cannot be empty.`).max(10_000);

/*
  `.strict()`, the same as every spec in this application. Zod's default is to strip an unknown key
  silently, which would let a caller send a field this schema does not know and watch it vanish.
*/
export const checkSpecSchema = z
  .object({
    /** One line: the learning objective this checks. Never sent to a fellow. */
    objective: z.string().trim().min(1, "Name the objective this checks.").max(200),
    /** The question, in markdown. */
    question: markdown("The question"),
    /** What a level-2 answer looks like, in markdown. Never sent to a fellow. */
    factsExample: markdown("The level-2 example"),
    /** What a level-3 answer looks like, in markdown. A fellow sees it after their third attempt. */
    exemplar: markdown("The level-3 example"),
    /**
     * The wait between attempts, as the form asks for it. Days and hours rather than hours, so the
     * conversion happens once, in `checkColumns`, rather than in every caller.
     */
    retryWait: z
      .object({
        days: z.number().int().min(0).max(365),
        hours: z.number().int().min(0).max(23),
      })
      .strict(),
  })
  .strict();

export type CheckSpec = z.infer<typeof checkSpecSchema>;

/**
 * A validated spec as the columns it is stored in. One function, so that creating a check and
 * editing one cannot write a row two different ways.
 */
export function checkColumns(spec: CheckSpec): {
  objective: string;
  question: string;
  factsExample: string;
  exemplar: string;
  retryWaitHours: number;
} {
  return {
    objective: spec.objective,
    question: spec.question,
    factsExample: spec.factsExample,
    exemplar: spec.exemplar,
    retryWaitHours: retryWaitHoursOf(spec.retryWait),
  };
}
