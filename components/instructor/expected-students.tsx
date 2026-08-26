"use client";

import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ListPlus,
  Trash2,
  UserRoundCheck,
  UserRoundPlus,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/list-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MAX_ROSTER_PASTE, parseRosterInput } from "@/lib/courses/roster-input";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Who is expected in this program, and the box that says so.
 *
 * **This is the other half of the join link, and it goes above it on the screen for that reason.**
 * The link on its own admits whoever holds it; with this list it admits whoever holds it *and* was
 * written down here first. An instructor who has not filled this in has a program nobody can join,
 * which is why the empty state says so in those words rather than describing the feature.
 *
 * **The paste is parsed in the browser before anything is sent**, by the same function the
 * procedure parses with — see `lib/courses/roster-input.ts` for why that matters. What it buys is
 * the thing a spreadsheet paste actually needs: the chance to notice that column three was somebody's
 * name and column one was blank, while the text is still in the box and still editable.
 */

type Entries = RouterOutputs["enrollments"]["roster"];

export function ExpectedStudents({ programId, entries }: { programId: string; entries: Entries }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);

  /*
    Re-parsed on every keystroke rather than on a button press. It is a few hundred characters of
    string splitting, and the alternative — parse when you submit — puts the one piece of
    information that would have changed what you pasted on the far side of pasting it.
  */
  const parsed = React.useMemo(() => parseRosterInput(text), [text]);

  const add = useMutation(
    trpc.enrollments.addToRoster.mutationOptions(
      settled({
        onSuccess: (result) => {
          setText("");
          setOpen(false);

          // Both numbers, because "22 were already there" is the difference between a paste that
          // did nothing and a paste that failed, and those look identical if only `added` is said.
          toast.success(
            result.alreadyPresent > 0
              ? `Added ${result.added}. ${result.alreadyPresent} ${
                  result.alreadyPresent === 1 ? "was" : "were"
                } already expected.`
              : `Added ${result.added} to the expected list.`,
          );
        },
      }),
    ),
  );

  const remove = useMutation(
    trpc.enrollments.removeFromRoster.mutationOptions(
      settled({ onSuccess: () => toast.success("Taken off the expected list.") }),
    ),
  );

  const busy = add.isPending || remove.isPending;

  const waiting = entries.filter((entry) => entry.claimedAt === null);
  const arrived = entries.filter((entry) => entry.claimedAt !== null);

  const tooMany = parsed.entries.length > MAX_ROSTER_PASTE;
  const canAdd = parsed.entries.length > 0 && !tooMany && !busy;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">Expected students</span>
          <span className="text-xs text-muted-foreground">
            Only these accounts can use the join link. Add everyone before you send it.
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((previous) => !previous)}>
          <ListPlus data-icon="inline-start" />
          {open ? "Close" : "Add students"}
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">One student per line</span>
            <span className="text-xs text-muted-foreground">
              A GitHub username, an email address, or both with a name — separated by commas or
              tabs, in any order. Paste straight from a spreadsheet.
            </span>
            <Textarea
              className="mt-1 min-h-32 font-mono text-xs"
              placeholder={
                "ada-lovelace, ada@example.com, Ada Lovelace\ngrace-hopper\nalan@example.com"
              }
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
            />
          </label>

          {/*
            The preview, which is the whole reason the parser is browser-safe. It says what will be
            written rather than what was typed — the two differ exactly where somebody has made the
            mistake worth catching.
          */}
          {parsed.entries.length > 0 && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium">
                {parsed.entries.length} {parsed.entries.length === 1 ? "student" : "students"} read
              </span>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {parsed.entries.slice(0, 5).map((entry, index) => (
                  <li key={index} className="font-mono">
                    {entry.githubUsername ? `@${entry.githubUsername}` : null}
                    {entry.githubUsername && entry.email ? " · " : null}
                    {entry.email}
                    {entry.note ? <span className="font-sans"> — {entry.note}</span> : null}
                  </li>
                ))}
                {parsed.entries.length > 5 && <li>and {parsed.entries.length - 5} more</li>}
              </ul>
            </div>
          )}

          {parsed.problems.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-destructive-foreground">
                <AlertTriangle className="size-3.5" />
                {parsed.problems.length}{" "}
                {parsed.problems.length === 1 ? "line needs" : "lines need"} a look
              </span>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {parsed.problems.map((problem, index) => (
                  <li key={index}>
                    Line {problem.line}: {problem.reason}
                  </li>
                ))}
              </ul>
              {/*
                Not a blocker. A paste of forty lines with one bad line should add the thirty-nine —
                refusing all of it would mean editing the spreadsheet to fix one row, and the person
                who pasted it can see exactly which row was skipped.
              */}
              <span className="text-muted-foreground">
                These lines are skipped. The rest can still be added.
              </span>
            </div>
          )}

          {tooMany && (
            <p className="text-xs text-destructive-foreground">
              That is {parsed.entries.length} students, and the most that can be added at once is{" "}
              {MAX_ROSTER_PASTE}. Add them in smaller batches.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!canAdd}
              onClick={() => add.mutate({ programId, entries: parsed.entries })}
            >
              <Check data-icon="inline-start" />
              Add {parsed.entries.length > 0 ? parsed.entries.length : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setText("")} disabled={busy}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<UserRoundPlus />}
          title="Nobody is expected yet"
          description="The join link will not admit anyone until you add the students you expect. Add them above, then send the link."
        />
      ) : (
        <>
          {waiting.length > 0 && (
            <EntryTable
              caption={`Waiting to join (${waiting.length})`}
              entries={waiting}
              busy={busy}
              onRemove={(entryId) => remove.mutate({ programId, entryId })}
            />
          )}
          {/*
            Kept on the screen after they arrive rather than dropped from it. The row is the record
            of who was expected and which account turned up — which is what somebody checks when a
            fellow says they cannot get in and a stranger's handle is sitting on the roster.
          */}
          {arrived.length > 0 && (
            <EntryTable caption={`Joined (${arrived.length})`} entries={arrived} busy={busy} />
          )}
        </>
      )}
    </div>
  );
}

function EntryTable({
  caption,
  entries,
  busy,
  onRemove,
}: {
  caption: string;
  entries: Entries;
  busy: boolean;
  /** Absent for the joined table, where removing an entry is refused by the procedure anyway. */
  onRemove?: (entryId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{caption}</h3>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Expected</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Joined as</TableHead>
              {onRemove && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-mono text-xs">
                  {entry.githubUsername ? <span>@{entry.githubUsername}</span> : null}
                  {entry.githubUsername && entry.email ? (
                    <span className="text-muted-foreground"> · </span>
                  ) : null}
                  {entry.email ? (
                    <span className="text-muted-foreground">{entry.email}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{entry.note ?? "—"}</TableCell>
                <TableCell>
                  {entry.claimedByName ? (
                    <Badge variant="secondary" className="gap-1">
                      <UserRoundCheck className="size-3" />
                      {entry.claimedByName}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not yet</span>
                  )}
                </TableCell>
                {onRemove && (
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Remove ${entry.githubUsername ?? entry.email} from the expected list`}
                      onClick={() => onRemove(entry.id)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
