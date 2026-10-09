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

/**
 * One digest entry: feedback released on one round.
 *
 * The course is not on the line because the heading above it carries the course — see
 * `digestDm`. Naming it twice is how the first version of this message came to read as one
 * undifferentiated pile.
 */
export function feedbackDigestLine(args: {
  assignmentTitle: string;
  finalScore: number;
  finalScorePossible: number;
  isComplete: boolean;
  href: string | null;
}): string {
  const score = `${args.finalScore}/${args.finalScorePossible}`;
  const verdict = args.isComplete ? "Complete" : "Not yet complete";
  return `• Feedback on ${linked(args.assignmentTitle, args.href)}: ${score} — ${verdict}.`;
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

/** One course's worth of a digest: the course it is about, and the lines under it. */
export type DigestSection = { courseName: string; lines: string[] };

/**
 * The whole digest DM: a short count, then one brief per course.
 *
 * **Grouped by course rather than totalled across them**, because a reader acts on one course at a
 * time. A single list summing every course asks them to sort it themselves, and a heading that
 * names several courses at once is read as describing all of the lines below it.
 *
 * Callers only reach this with at least one section, each holding at least one line.
 */
export function digestDm(sections: readonly DigestSection[]): string {
  const total = sections.reduce((count, section) => count + section.lines.length, 0);
  const count = total === 1 ? "1 update" : `${total} updates`;
  const body = sections
    .map((section) => [courseHeading(section.courseName), ...section.lines].join("\n"))
    .join("\n\n");

  return `While you were away — ${count}:\n\n${body}`;
}

/** A course's name, standing over the lines that belong to it. */
export function courseHeading(name: string): string {
  return `*${escapeMrkdwn(name)}*`;
}

/* ---- Summaries: what is outstanding, rather than what happened ---------------------------- */

/** The one line above the per-course briefs. */
export const OUTSTANDING_HEADING = "Waiting on you";

/**
 * One course's pile: how much is waiting, whose work it covers, and where to go.
 *
 * **Per course, each with its own scope.** An instructor on two programmes has a cohort selection
 * for each, and the first version of this message joined those scopes into one phrase above a
 * single total — which read as though both scopes applied to all of the work. The cohort
 * breakdown appears only where one course genuinely spans several cohorts, which is the case it
 * was written for; below that it repeats the scope already on the line above.
 */
export function courseGradingLines(args: {
  courseName: string;
  count: number;
  scope: string;
  cohorts: readonly { name: string; count: number }[];
  href: string | null;
}): string[] {
  const lines = [
    `${courseHeading(args.courseName)} — ${args.count} to grade · ${escapeMrkdwn(args.scope)}`,
  ];

  if (args.cohorts.length > 1) {
    for (const cohort of args.cohorts) {
      lines.push(`• ${escapeMrkdwn(cohort.name)} — ${cohort.count}`);
    }
  }

  lines.push(linked("Open triage", args.href));
  return lines;
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
