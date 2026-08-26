import type { RouterOutputs } from "@/trpc/types";

/**
 * The conversation as the browser receives it.
 *
 * Inferred from the procedure rather than written out, so a field added there reaches every reader
 * and one removed is a compile error at each of them.
 */
export type Thread = RouterOutputs["submissionComments"]["thread"];

/** One message, already collapsed for this reader: a withdrawn one carries no body. */
export type Comment = Thread["comments"][number];
