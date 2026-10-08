import { formatSchoolTime } from "@/lib/school-time";

/**
 * The words a Slack DM says.
 *
 * Pure string building, kept apart from the sending so the unit tests can read every message
 * without a token or a database. Plain mrkdwn text throughout — a three-line DM does not need
 * Block Kit.
 */

/**
 * The three characters Slack's message text treats as markup control. Everything else, including
 * quotes and asterisks in a title, is displayed as typed.
 */
export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Where this deployment lives, for the link at the foot of a DM.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` first, so a DM sent while a preview deployment happens to be
 * handling requests still links to the address a student actually uses; `VERCEL_URL` as the
 * fallback for previews themselves. Local development has neither, and the messages simply carry
 * no link — a DM without one still says what happened.
 */
export function appBaseUrl(): string | null {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : null;
}

/** A Slack link, `<url|label>`, or just the label when there is no base URL to link into. */
function linked(label: string, path: string | null): string {
  return path ? `<${path}|${escapeMrkdwn(label)}>` : escapeMrkdwn(label);
}

/** `path` joined onto the deployment's address, or null when there is no address. */
export function absoluteHref(path: string): string | null {
  const base = appBaseUrl();
  return base ? `${base}${path}` : null;
}

export function feedbackDmText(args: {
  assignmentTitle: string;
  courseName: string;
  finalScore: number;
  finalScorePossible: number;
  isComplete: boolean;
  href: string | null;
}): string {
  const score = `${args.finalScore}/${args.finalScorePossible}`;
  const verdict = args.isComplete ? "Complete" : "Not yet complete";
  return (
    `Your feedback for *${escapeMrkdwn(args.assignmentTitle)}* (${escapeMrkdwn(args.courseName)}) ` +
    `was released: ${score} — ${verdict}. ${linked("Read it here", args.href)}.`
  );
}

export function commentDmText(args: {
  authorName: string;
  assignmentTitle: string;
  excerpt: string;
  href: string | null;
}): string {
  return (
    `${escapeMrkdwn(args.authorName)} commented on *${escapeMrkdwn(args.assignmentTitle)}*: ` +
    `“${escapeMrkdwn(args.excerpt)}” ${linked("Open the conversation", args.href)}.`
  );
}

/** One digest entry: feedback released on one round. */
export function feedbackDigestLine(args: {
  assignmentTitle: string;
  courseName: string;
  finalScore: number;
  finalScorePossible: number;
  isComplete: boolean;
  href: string | null;
}): string {
  const score = `${args.finalScore}/${args.finalScorePossible}`;
  const verdict = args.isComplete ? "Complete" : "Not yet complete";
  return (
    `• Feedback on ${linked(args.assignmentTitle, args.href)} ` +
    `(${escapeMrkdwn(args.courseName)}): ${score} — ${verdict}.`
  );
}

/** One digest entry: a thread's new comments, grouped so ten replies are one line. */
export function commentsDigestLine(args: {
  count: number;
  assignmentTitle: string;
  /** Whose thread, for an instructor's digest; a student reading their own needs no name. */
  fellowName?: string;
  newestExcerpt: string;
  href: string | null;
}): string {
  const what = args.count === 1 ? "1 new comment" : `${args.count} new comments`;
  const whose = args.fellowName ? ` from ${escapeMrkdwn(args.fellowName)}` : "";
  return (
    `• ${what}${whose} on ${linked(args.assignmentTitle, args.href)}: ` +
    `“${escapeMrkdwn(args.newestExcerpt)}”`
  );
}

/** The whole digest DM. Callers only reach this with at least one line. */
export function digestDm(lines: readonly string[]): string {
  const count = lines.length === 1 ? "1 update" : `${lines.length} updates`;
  return `While you were away — ${count}:\n${lines.join("\n")}`;
}

/* ---- Summaries: what is outstanding, rather than what happened ---------------------------- */

/** An instructor's heading. Names the scope, so a summary widened by the cohort picker says so. */
export function outstandingSummary(args: { scope: string; total: number }): string {
  const work = args.total === 1 ? "1 submission" : `${args.total} submissions`;
  return `Waiting on you — ${escapeMrkdwn(args.scope)}, ${work} to grade`;
}

/** One cohort's share of that pile. Omitted by the caller when there is only one. */
export function summaryCohortLine(args: { name: string; count: number }): string {
  return `• ${escapeMrkdwn(args.name)} — ${args.count}`;
}

/** Where to go and do something about it, one link per course that has work waiting. */
export function summaryCourseLink(
  courses: readonly { name: string; href: string | null; count: number }[],
): string {
  const parts = courses.map((course) =>
    course.href
      ? `<${course.href}|${escapeMrkdwn(course.name)}> (${course.count})`
      : `${escapeMrkdwn(course.name)} (${course.count})`,
  );
  return `Open triage: ${parts.join(" · ")}`;
}

/**
 * A fellow's section heading.
 *
 * Stated rather than urged. The heading says what the list below it contains and nothing about
 * what the reader ought to feel, which is the whole of the wording decision here: a fellow who is
 * behind already knows, and a summary that scolds is one people turn off.
 */
export function upcomingSummary(args: { kind: "overdue" | "upcoming"; count: number }): string {
  return args.kind === "overdue"
    ? `*Overdue* — ${args.count}`
    : `*Due in the next 7 days* — ${args.count}`;
}

/** One piece of work on either list. */
export function summaryWorkLine(args: {
  title: string;
  courseName: string;
  dueAt: Date | null;
  href: string | null;
}): string {
  const when = args.dueAt ? ` — due ${formatSchoolTime(args.dueAt)}` : "";
  return `• ${linked(args.title, args.href)} (${escapeMrkdwn(args.courseName)})${when}`;
}
