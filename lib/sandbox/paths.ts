/**
 * Where things live inside the sandbox.
 *
 * Under the sandbox user's home directory rather than at the filesystem root,
 * because the default user in an E2B template is not root and cannot create `/work`.
 *
 * Running the commands as root would also have fixed that, and would have been the
 * wrong fix: the whole point of the test stage is that it executes code written by
 * a student. Non-root is the property to keep, so the paths move instead.
 *
 * A pure module so that both the presets, which name a results file in their test
 * command, and the sandbox mechanics can use the same values.
 */

const HOME = "/home/user";

/** The student's code, with the template's grading files overlaid onto it. */
export const WORK_DIR = `${HOME}/work`;

/** The template, kept separate so its versions can be copied over the student's. */
export const TEMPLATE_DIR = `${HOME}/template`;

/** Where the test runner writes its machine-readable report. */
export const RESULTS_DIR = `${HOME}/results`;
