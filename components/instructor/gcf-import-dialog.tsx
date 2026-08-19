"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatTakenOn, GCF_KIND_META, gcfScoreLabel } from "@/lib/gcf";
import { studentLabel } from "@/lib/gradebook/filters";
import {
  assessmentChoices,
  dedupeRows,
  parseGcfExport,
  selectRows,
  type GcfAssessmentChoice,
  type GcfImportProblem,
  type GcfImportRow,
} from "@/lib/gcf/import";
import { useTRPC } from "@/trpc/client";

/**
 * Uploading CodeSignal's export, in three steps that are each a question worth asking.
 *
 * **The file is read in the browser and never uploaded.** What crosses to the server is the parsed
 * rows, which it validates again from scratch — the page decides what to *show*, never what is
 * true. So nothing goes to storage, there is no file to clean up afterwards, and a term of
 * personal email addresses does not sit in a bucket.
 *
 * **Step one is which assessments are the GCF**, and it exists because nothing in the file except
 * the assessment's name can answer it. A real export's 261 unproctored rows are 61 mock GCFs and
 * 200 lecture exercises; `Proctoring Status` groups all 261 together, and a `Max Score` of 1200
 * catches 46 exercises as well as every mock. So the names are listed with counts, the proctored
 * ones and anything named `[Mock]` are ticked, and the rest are visibly *not* ticked rather than
 * silently discarded — 200 rows vanishing without a word reads as a broken import.
 *
 * **Step two is who each row belongs to.** Most resolve on their own, because a fellow signs up to
 * CodeSignal with the address they use for GitHub. The rest are assigned by hand once and
 * remembered, so the next upload matches them without asking.
 *
 * **Step three is committing**, which upserts on the fellow, the kind, and the day — so pressing
 * the button twice, or uploading next month's export that still contains this month's rows,
 * changes nothing.
 */

type Preview = ReturnType<typeof usePreview>["data"];

function usePreview(courseId: string, rows: GcfImportRow[], enabled: boolean) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.gcf.previewImport.queryOptions({ courseId, rows }),
    enabled: enabled && rows.length > 0,
  });
}

export function GcfImportDialog({
  courseId,
  open,
  onOpenChange,
}: {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [fileName, setFileName] = React.useState<string | null>(null);
  const [allRows, setAllRows] = React.useState<GcfImportRow[]>([]);
  const [problems, setProblems] = React.useState<GcfImportProblem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [choices, setChoices] = React.useState<GcfAssessmentChoice[]>([]);
  const [selectedNames, setSelectedNames] = React.useState<string[]>([]);
  const [readError, setReadError] = React.useState<string | null>(null);
  /** Email to student id, for the rows a person resolved here. */
  const [assignments, setAssignments] = React.useState<Record<string, string>>({});

  const reset = () => {
    setFileName(null);
    setAllRows([]);
    setProblems([]);
    setTotal(0);
    setChoices([]);
    setSelectedNames([]);
    setAssignments({});
    setReadError(null);
  };

  async function readFile(file: File) {
    setReadError(null);
    try {
      const reading = parseGcfExport(await file.text());

      if (reading.total === 0) {
        setReadError("That file has no records in it. Is it the CSV CodeSignal exports?");
        return;
      }

      const offered = assessmentChoices(reading.rows);
      setFileName(file.name);
      setAllRows(reading.rows);
      setProblems(reading.problems);
      setTotal(reading.total);
      setChoices(offered);
      setSelectedNames(offered.filter((c) => c.selectedByDefault).map((c) => c.name));
      setAssignments({});
    } catch {
      setReadError("That file could not be read as a CSV.");
    }
  }

  /*
    Deduplicated before anything is previewed or written. Two rows describing one attempt should
    not arise — a real export produces 74 distinct triples from its 74 GCF rows — but the database
    enforces the same uniqueness, so a duplicate reaching the write would fail an import half way
    rather than being something the preview could show.
  */
  const selected = React.useMemo(
    () => dedupeRows(selectRows(allRows, selectedNames)).rows,
    [allRows, selectedNames],
  );

  const preview = usePreview(courseId, selected, open);

  const commit = useMutation(
    trpc.gcf.commitImport.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(
            `Imported ${result.written} ${result.written === 1 ? "attempt" : "attempts"}.` +
              (result.remembered > 0 ? ` Remembered ${result.remembered} address.` : "") +
              (result.skipped > 0
                ? ` ${result.skipped} skipped with nobody to attach them to.`
                : ""),
          );
          reset();
          onOpenChange(false);
        },
      }),
    ),
  );

  const unresolved =
    preview.data?.rows.filter((row) => row.studentId === null && !assignments[row.email]) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import GCF results</DialogTitle>
          <DialogDescription>
            The CSV CodeSignal exports. It is read here in your browser — the file itself is never
            uploaded.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcf-file">Export file</Label>
            <input
              id="gcf-file"
              type="file"
              accept=".csv,text/csv"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            {fileName && (
              <p className="text-xs text-muted-foreground">
                {fileName} — {total} {total === 1 ? "record" : "records"}
              </p>
            )}
          </div>

          {readError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Could not read that file</AlertTitle>
              <AlertDescription>{readError}</AlertDescription>
            </Alert>
          )}

          {problems.length > 0 && (
            <Alert>
              <AlertTriangle />
              <AlertTitle>
                {problems.length} {problems.length === 1 ? "row" : "rows"} could not be read
              </AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-0.5">
                  {problems.slice(0, 4).map((problem) => (
                    <li key={`${problem.line}-${problem.subject}`}>
                      Line {problem.line} ({problem.subject}) — {problem.reason}.
                    </li>
                  ))}
                  {problems.length > 4 && <li>and {problems.length - 4} more.</li>}
                </ul>
                Everything else can still be imported.
              </AlertDescription>
            </Alert>
          )}

          {choices.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-medium">Which of these are the GCF?</h3>
                <p className="text-xs text-muted-foreground">
                  Proctored attempts are the real assessment. Everything else in the file is
                  unproctored, and only its name says whether it was a mock GCF or a class exercise
                  — so the mocks are ticked and the rest are left for you to decide.
                </p>
              </div>

              <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {choices.map((choice) => {
                  const ticked = selectedNames.includes(choice.name);

                  return (
                    <li key={choice.name} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                      <Checkbox
                        id={`gcf-choice-${choice.name}`}
                        checked={ticked}
                        onCheckedChange={() =>
                          setSelectedNames((current) =>
                            ticked
                              ? current.filter((name) => name !== choice.name)
                              : [...current, choice.name],
                          )
                        }
                      />
                      <label
                        htmlFor={`gcf-choice-${choice.name}`}
                        className="min-w-0 flex-1 truncate"
                        title={choice.name}
                      >
                        {choice.name || "(unnamed)"}
                      </label>
                      <Badge variant="secondary">{GCF_KIND_META[choice.kind].label}</Badge>
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {choice.count}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <p className="text-xs text-muted-foreground">
                {selected.length} of {total} rows selected.
              </p>
            </section>
          )}

          {preview.isPending && selected.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Matching {selected.length} rows to students…
            </p>
          )}

          {preview.data && (
            <Resolution
              preview={preview.data}
              assignments={assignments}
              onAssign={(email, studentId) =>
                setAssignments((current) => ({ ...current, [email]: studentId }))
              }
            />
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={selected.length === 0 || commit.isPending || preview.isPending}
            onClick={() =>
              commit.mutate({
                courseId,
                rows: selected,
                assignments: Object.entries(assignments).map(([email, studentId]) => ({
                  email,
                  studentId,
                })),
              })
            }
          >
            {commit.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Upload data-icon="inline-start" />
            )}
            Import {selected.length - unresolved.length || ""} {}
            {selected.length - unresolved.length === 1 ? "attempt" : "attempts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the import would do, and the rows that still need a person.
 *
 * Grouped by address rather than listed per row, because a fellow with eight mock attempts is one
 * decision rather than eight — assigning them once resolves every row they appear in.
 */
function Resolution({
  preview,
  assignments,
  onAssign,
}: {
  preview: NonNullable<Preview>;
  assignments: Record<string, string>;
  onAssign: (email: string, studentId: string) => void;
}) {
  const unresolved = React.useMemo(() => {
    const byEmail = new Map<string, { email: string; fullName: string; rows: number }>();

    for (const row of preview.rows) {
      if (row.studentId !== null) continue;
      const existing = byEmail.get(row.email);
      if (existing) existing.rows += 1;
      else byEmail.set(row.email, { email: row.email, fullName: row.fullName, rows: 1 });
    }

    return [...byEmail.values()].sort((a, b) => b.rows - a.rows || a.email.localeCompare(b.email));
  }, [preview.rows]);

  const stillOpen = unresolved.filter((row) => !assignments[row.email]).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" />
          {preview.matched} matched
        </span>
        {preview.updates > 0 && (
          <span className="text-muted-foreground">{preview.updates} already on file, updating</span>
        )}
        {stillOpen > 0 && (
          <span className="text-amber-700 dark:text-amber-300">
            {stillOpen} {stillOpen === 1 ? "address needs" : "addresses need"} a student
          </span>
        )}
      </div>

      {unresolved.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {unresolved.map((row) => (
            <li key={row.email} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{row.fullName || row.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.email} · {row.rows} {row.rows === 1 ? "attempt" : "attempts"}
                </p>
              </div>

              <Select
                value={assignments[row.email] ?? ""}
                onValueChange={(value) => value && onAssign(row.email, value)}
                items={Object.fromEntries(
                  preview.students.map((student) => [student.id, studentLabel(student)]),
                )}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Choose a student" />
                </SelectTrigger>
                <SelectContent>
                  {preview.students.map((student) => (
                    <SelectItem key={student.id} value={student.id}>
                      {studentLabel(student)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      )}

      {/*
        A sample of what will be written, so the numbers above are checkable against something
        concrete rather than taken on trust.
      */}
      {preview.matched > 0 && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Preview the first few attempts
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {preview.rows
              .filter((row) => row.studentId !== null)
              .slice(0, 6)
              .map((row) => (
                <li key={`${row.email}-${row.kind}-${row.takenOn}`} className="text-xs">
                  <span className="font-medium tabular-nums">{gcfScoreLabel(row)}</span> ·{" "}
                  {GCF_KIND_META[row.kind].label} · {formatTakenOn(row.takenOn)} · {row.email}
                  {row.updates && <span className="text-muted-foreground"> · updates</span>}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
