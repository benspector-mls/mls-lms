/**
 * The two pieces every "what would this destroy" list is built from.
 *
 * Their own module because there are two such lists — deleting a course and deleting a
 * program — and they have to read identically. A reader who has weighed one of these
 * confirmations should not have to work out the shape of the other while holding a permanent
 * action, and two copies of a labelled row is how the two come to be laid out differently.
 */

/** "3 modules", "1 module", "no modules" — a count somebody reads rather than parses. */
export function countLabel(count: number, noun: string): string {
  if (count === 0) return `no ${noun}s`;
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** One labelled fact in an impact list, in a column that lines its labels up. */
export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground sm:w-24 sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-muted-foreground">{value}</dd>
    </div>
  );
}
