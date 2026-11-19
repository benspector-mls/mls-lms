/**
 * The Tutor's limits, free of `server-only` so the chat box and the procedure agree on them.
 */

/** The longest question accepted. A question is a paragraph; this only refuses a pasted file. */
export const MAX_QUESTION_LENGTH = 2_000;

/**
 * How many questions one person may ask in an hour. Sixty is more than anybody asks while working;
 * it stops a script, and a fellow who reaches it is told to come back shortly.
 */
export const ASK_LIMIT = { max: 60, windowMinutes: 60 };

/** How many earlier turns of the conversation Claude is shown, newest last. */
export const HISTORY_TURNS = 20;

/** How many turns the chat box loads when it opens. */
export const HISTORY_SHOWN = 50;
