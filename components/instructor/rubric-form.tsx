"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rubricHref, rubricsHref, ruleSetHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Writing a rubric, or a rule set, as markdown.
 *
 * **Markdown, in a box, with a preview.** The model reads markdown — headings and band tables are
 * what a rubric is made of — and a Google Doc exported to markdown loses its tables often enough
 * that typing it here is the honest input. Preview is one switch per field rather than a pane
 * beside the box, as the resource dialog does it: the form is not wide enough to read prose in
 * half of it.
 *
 * **Save writes a version, never an edit in place.** The rubric's id stays what every assignment
 * points at; what changes is which version is current. Drafts already graded keep the version
 * they were graded against and the review screen says a newer one exists, so saving here never
 * changes a grade behind an instructor's back — the form says so beneath the button.
 */

type RubricData = RouterOutputs["rubrics"]["get"];
type RuleSetData = RouterOutputs["rubrics"]["getRuleSet"];

const MARKDOWN_MAX = 60_000;

/** "Use the program's rules", which a Select cannot hold as an empty string. */
const PROGRAM_RULES = "__program__";

export function RubricForm({ rubric }: { rubric: RubricData | null }) {
  const trpc = useTRPC();
  const router = useRouter();
  const settled = useServerMutation();

  const [name, setName] = React.useState(rubric?.name ?? "");
  const [rubricMarkdown, setRubricMarkdown] = React.useState(rubric?.rubricMarkdown ?? "");
  const [guidanceMarkdown, setGuidanceMarkdown] = React.useState(rubric?.guidanceMarkdown ?? "");
  const [sampleReportMarkdown, setSampleReportMarkdown] = React.useState(
    rubric?.sampleReportMarkdown ?? "",
  );
  const [ruleSetId, setRuleSetId] = React.useState<string | null>(rubric?.ruleSetId ?? null);
  const [previewing, setPreviewing] = React.useState<string | null>(null);

  const ruleSets = useQuery(trpc.rubrics.listRuleSets.queryOptions());

  const create = useMutation(
    trpc.rubrics.create.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`Saved ${name}.`);
          router.push(rubricHref(result.id));
        },
      }),
    ),
  );
  const update = useMutation(
    trpc.rubrics.update.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.changed ? `Saved ${name} as version ${result.version}.` : `Saved ${name}.`,
          ),
      }),
    ),
  );

  const readOnly = rubric !== null && !rubric.canEdit;
  const pending = create.isPending || update.isPending;
  const text = {
    name,
    rubricMarkdown,
    guidanceMarkdown,
    sampleReportMarkdown: sampleReportMarkdown.trim() === "" ? null : sampleReportMarkdown,
    ruleSetId,
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (rubric) update.mutate({ rubricId: rubric.id, ...text });
        else create.mutate(text);
      }}
    >
      {readOnly && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {rubric.author
            ? `${rubric.author} wrote this rubric, so only they or an admin can change it.`
            : "This rubric belongs to the program, so only an admin can change it."}{" "}
          To grade against something different, create a rubric of your own.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="rubric-name">Name</Label>
        <Input
          id="rubric-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          disabled={readOnly}
          placeholder="Resume review"
        />
        <p className="text-xs text-muted-foreground">
          What the assignment form shows when choosing a rubric.
        </p>
      </div>

      <MarkdownField
        id="rubric"
        label="Rubric"
        value={rubricMarkdown}
        onChange={setRubricMarkdown}
        previewing={previewing}
        onPreviewChange={setPreviewing}
        rows={16}
        disabled={readOnly}
        hint="The criteria and the score bands, as the model reads them. A table of bands with a description of each works best."
      />

      <MarkdownField
        id="guidance"
        label="Guidance"
        value={guidanceMarkdown}
        onChange={setGuidanceMarkdown}
        previewing={previewing}
        onPreviewChange={setPreviewing}
        rows={10}
        disabled={readOnly}
        hint="How the points add up and what each row of the report is: one row per question, one for the whole piece, what never costs points."
      />

      <MarkdownField
        id="sample"
        label="Sample report"
        value={sampleReportMarkdown}
        onChange={setSampleReportMarkdown}
        previewing={previewing}
        onPreviewChange={setPreviewing}
        rows={12}
        disabled={readOnly}
        hint="Optional. A finished report of the shape you want, which the model matches for tone and layout. Without one, the model is told the shape of a report in words only."
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="rubric-rules">Rules</Label>
        <Select
          value={ruleSetId ?? PROGRAM_RULES}
          onValueChange={(value) => setRuleSetId(value === PROGRAM_RULES ? null : value)}
          disabled={readOnly}
          // The trigger reads its label from here; without it, it shows the value itself.
          items={{
            [PROGRAM_RULES]: "Use the program's rules",
            ...Object.fromEntries(
              (ruleSets.data ?? []).map((ruleSet) => [ruleSet.id, ruleSet.name]),
            ),
          }}
        >
          <SelectTrigger id="rubric-rules" className="w-full sm:w-96">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PROGRAM_RULES}>Use the program&apos;s rules</SelectItem>
            {(ruleSets.data ?? []).map((ruleSet) => (
              <SelectItem key={ruleSet.id} value={ruleSet.id}>
                {ruleSet.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The tone, layout and labels every report follows. The program&apos;s rules are what an
          admin chose for it; name a rule set here only when this rubric needs a different voice.
          {ruleSetId && (
            <>
              {" "}
              <a href={ruleSetHref(ruleSetId)} className="underline underline-offset-2">
                Read the chosen rule set.
              </a>
            </>
          )}
        </p>
      </div>

      {!readOnly && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || name.trim() === ""}>
              {pending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {rubric ? "Save" : "Create rubric"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.push(rubricsHref())}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {rubric
              ? `Version ${rubric.version ?? 0} stays on every report already graded against it. ` +
                "Reports generated from now on use the new version, and a draft written against " +
                "the old one says so on the review screen."
              : "Reports are graded against the version that is current when they are generated."}
          </p>
        </div>
      )}
    </form>
  );
}

export function RuleSetForm({
  ruleSet,
  startFrom,
}: {
  ruleSet: RuleSetData | null;
  /** The rule sets a new one can start from, with their current text fetched on choice. */
  startFrom: { id: string; name: string }[];
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const settled = useServerMutation();

  const [name, setName] = React.useState(ruleSet?.name ?? "");
  const [markdown, setMarkdown] = React.useState(ruleSet?.markdown ?? "");
  const [startFromId, setStartFromId] = React.useState<string | null>(null);
  const [previewing, setPreviewing] = React.useState<string | null>(null);

  /*
    The text of the rule set to start from, shown in the box so the instructor edits what they
    will get rather than trusting a name. Fetched on choice; `createRuleSet` copies from the id
    as well, so what is sent is the box, which may have been edited since.
  */
  const source = useQuery({
    ...trpc.rubrics.getRuleSet.queryOptions({ ruleSetId: startFromId ?? "" }),
    enabled: startFromId !== null,
  });
  React.useEffect(() => {
    if (source.data && startFromId === source.data.id) setMarkdown(source.data.markdown);
  }, [source.data, startFromId]);

  const create = useMutation(
    trpc.rubrics.createRuleSet.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`Saved ${name}.`);
          router.push(ruleSetHref(result.id));
        },
      }),
    ),
  );
  const update = useMutation(
    trpc.rubrics.updateRuleSet.mutationOptions(
      settled({
        onSuccess: (result) =>
          toast.success(
            result.changed ? `Saved ${name} as version ${result.version}.` : `Saved ${name}.`,
          ),
      }),
    ),
  );

  const readOnly = ruleSet !== null && !ruleSet.canEdit;
  const pending = create.isPending || update.isPending;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (ruleSet) update.mutate({ ruleSetId: ruleSet.id, name, markdown });
        // The box is what is sent; the id only records where it started.
        else create.mutate({ name, markdown, startFromRuleSetId: null });
      }}
    >
      {readOnly && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {ruleSet.author
            ? `${ruleSet.author} wrote these rules, so only they or an admin can change them.`
            : "These rules belong to the program, so only an admin can change them."}{" "}
          To write in a different voice, create a rule set of your own and start from this one.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="rule-set-name">Name</Label>
        <Input
          id="rule-set-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          disabled={readOnly}
          placeholder="Data analytics grading rules"
        />
      </div>

      {!ruleSet && startFrom.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-set-start">Start from</Label>
          <Select
            value={startFromId ?? ""}
            onValueChange={(value) => setStartFromId(value || null)}
            items={Object.fromEntries(startFrom.map((option) => [option.id, option.name]))}
          >
            <SelectTrigger id="rule-set-start" className="w-full sm:w-96">
              <SelectValue placeholder="A blank page" />
            </SelectTrigger>
            <SelectContent>
              {startFrom.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Copies that rule set&apos;s text into the box below for you to change. The copy is
            yours: an edit to the original never reaches it.
          </p>
        </div>
      )}

      <MarkdownField
        id="rules"
        label="Rules"
        value={markdown}
        onChange={setMarkdown}
        previewing={previewing}
        onPreviewChange={setPreviewing}
        rows={24}
        disabled={readOnly || source.isFetching}
        hint="The voice of every report that follows these rules: how to open, what to praise, how to name a deduction, which labels the bullets carry."
      />

      {!readOnly && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={pending || name.trim() === "" || markdown.trim() === ""}
            >
              {pending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {ruleSet ? "Save" : "Create rule set"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.push(rubricsHref())}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {ruleSet
              ? "Every program and rubric that follows these rules uses the new version from the " +
                "next report on. A draft written against the old version says so on the review screen."
              : "A program follows a rule set once an admin chooses it in the program's settings; a rubric can name one of its own."}
          </p>
        </div>
      )}
    </form>
  );
}

/** A markdown box with an Edit/Preview switch; one field previews at a time. */
function MarkdownField({
  id,
  label,
  value,
  onChange,
  previewing,
  onPreviewChange,
  rows,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  previewing: string | null;
  onPreviewChange: (id: string | null) => void;
  rows: number;
  disabled: boolean;
  hint: string;
}) {
  const showing = previewing === id;
  const inputId = `rubric-${id}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={showing ? undefined : inputId}>{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={value.trim() === ""}
          onClick={() => onPreviewChange(showing ? null : id)}
        >
          {showing ? <Pencil data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
          {showing ? "Edit" : "Preview"}
        </Button>
      </div>

      {showing ? (
        <div className="max-h-[60vh] min-h-24 overflow-y-auto rounded-md border border-border bg-muted/20 p-4">
          <Markdown content={value} />
        </div>
      ) : (
        <MarkdownEditor
          id={inputId}
          ariaLabel={label}
          value={value}
          onChange={onChange}
          rows={rows}
          maxLength={MARKDOWN_MAX}
          disabled={disabled}
          className="max-h-[60vh] font-mono text-sm"
        />
      )}
      <p className="text-xs text-muted-foreground">
        {showing ? "How this will look when rendered." : hint}
      </p>
    </div>
  );
}
