"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Eye, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { Markdown } from "@/components/markdown";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_RETRY_WAIT_HOURS,
  MAX_ATTEMPTS,
  retryWaitHoursOf,
  retryWaitParts,
} from "@/lib/checks/attempts";
import type { ResourceKind } from "@/lib/generated/prisma/enums";
import {
  IMPLEMENTED_RESOURCE_KINDS,
  parseVideoUrl,
  RESOURCE_KIND_BLURB,
  RESOURCE_KIND_LABEL,
  VIDEO_PROVIDER_LABEL,
} from "@/lib/resources/spec";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Adding a resource, or editing one.
 *
 * One dialog for both, because the fields are identical and two forms would be two places for a
 * field to be added to only one of them. `resource` being null is what "new" means.
 *
 * **The kind is the first question and decides which fields exist**, the same shape the
 * assignment form uses: a link never shows a markdown box, and a note never shows a URL field.
 * Fields that do not apply are absent rather than disabled, because they are questions that do
 * not arise rather than settings left at a default.
 *
 * Unlike the assignment form, the kind stays editable after saving. Changing an assignment's kind
 * would change what its existing submissions are; a resource has none, so turning a link into a
 * note is a legitimate edit and `resourceColumns` clears the columns the old kind used.
 *
 * **A check for understanding is a section at the bottom, on every kind**, because it is a question
 * *about* the resource rather than a kind of one. It is saved in the same request as the resource,
 * and unticking it removes the check and every attempt at it — the dialog says how many first.
 */

/** Which markdown field is showing its preview. One at a time, and none when the dialog opens. */
type MarkdownFieldId = "body" | "question" | "factsExample" | "exemplar";

/**
 * A resource as every screen reads one — the whole row, body and all.
 *
 * Exported because `ResourceActions` holds one and hands it straight to this form: the Curriculum
 * screen's rows carry whole resources now, so nothing has to be fetched to open the form.
 */
export type Resource = RouterOutputs["resources"]["listForCourse"][number];

export function ResourceDialog({
  open,
  onOpenChange,
  courseId,
  /** Null to create. Given, the row being edited. */
  resource,
  /** Which unit a new one lands in. Ignored when editing, which reads the resource's own. */
  defaultCourseUnitId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  resource: Resource | null;
  defaultCourseUnitId?: string;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  /*
    The units this may be filed under, fetched here rather than passed in. The dialog is opened
    from inside a unit on the Curriculum screen, which already knows which one — but a resource
    can be *moved* between units from this form, so it needs the whole list either way, and
    threading it through every call site would be the same query written at each of them.
  */
  const units = useQuery({
    ...trpc.courseUnits.listForCourse.queryOptions({ courseId }),
    enabled: open,
  });
  const modules = React.useMemo(() => units.data ?? [], [units.data]);

  /*
    The two examples and the answered count, which a fellow must never receive and which are
    therefore not on the resource row itself. The Curriculum screen has already read this, so
    opening the dialog finds it in the cache.
  */
  const checks = useQuery({
    ...trpc.checks.forCourse.queryOptions({ courseId }),
    enabled: open,
  });
  const checkDetail = React.useMemo(
    () =>
      resource?.check
        ? (checks.data?.checks.find((entry) => entry.checkId === resource.check?.id) ?? null)
        : null,
    [checks.data, resource],
  );

  const [kind, setKind] = React.useState<ResourceKind>("LINK");
  const [courseUnitId, setCourseUnitId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  /**
   * Whether the note is being read rather than written.
   *
   * On the form rather than in the note field's own component, so that opening the dialog on
   * another resource puts it back to writing — arriving at an edit form in a state where the text
   * cannot be typed into would be a form that appears not to work.
   */
  const [previewing, setPreviewing] = React.useState<MarkdownFieldId | null>(null);

  const [hasCheck, setHasCheck] = React.useState(false);
  const [objective, setObjective] = React.useState("");
  const [question, setQuestion] = React.useState("");
  const [factsExample, setFactsExample] = React.useState("");
  const [exemplar, setExemplar] = React.useState("");
  const [waitDays, setWaitDays] = React.useState(retryWaitParts(DEFAULT_RETRY_WAIT_HOURS).days);
  const [waitHours, setWaitHours] = React.useState(retryWaitParts(DEFAULT_RETRY_WAIT_HOURS).hours);

  /*
    Reset when the dialog opens rather than on every render of a closed one, so a half-typed
    resource is not wiped by an unrelated refetch — and so reopening on a different row does not
    show the previous row's text. Keyed on `open` and the row's id together: editing A, closing,
    then editing B has to reload, and both changes land in the same commit.
  */
  React.useEffect(() => {
    if (!open) return;

    setPreviewing(null);

    if (resource) {
      setKind(resource.kind);
      setCourseUnitId(resource.courseUnitId);
      setTitle(resource.title);
      setUrl(resource.url ?? "");
      setDescription(resource.description ?? "");
      setBody(resource.body ?? "");

      const wait = retryWaitParts(resource.check?.retryWaitHours ?? DEFAULT_RETRY_WAIT_HOURS);
      setHasCheck(resource.check !== null);
      setObjective(checkDetail?.objective ?? "");
      setQuestion(resource.check?.question ?? "");
      setFactsExample(checkDetail?.factsExample ?? "");
      setExemplar(checkDetail?.exemplar ?? "");
      setWaitDays(wait.days);
      setWaitHours(wait.hours);
      return;
    }

    const wait = retryWaitParts(DEFAULT_RETRY_WAIT_HOURS);
    setKind("LINK");
    setCourseUnitId(defaultCourseUnitId ?? modules[0]?.id ?? "");
    setTitle("");
    setUrl("");
    setDescription("");
    setBody("");
    setHasCheck(false);
    setObjective("");
    setQuestion("");
    setFactsExample("");
    setExemplar("");
    setWaitDays(wait.days);
    setWaitHours(wait.hours);
  }, [open, resource, defaultCourseUnitId, modules, checkDetail]);

  const create = useMutation(
    trpc.resources.create.mutationOptions(
      settled({
        onSuccess: (row) => {
          toast.success(`Added "${row.title}".`);
          onOpenChange(false);
        },
      }),
    ),
  );
  const update = useMutation(
    trpc.resources.update.mutationOptions(
      settled({
        onSuccess: (row) => {
          toast.success(`Saved "${row.title}".`);
          onOpenChange(false);
        },
      }),
    ),
  );

  const busy = create.isPending || update.isPending;

  /*
    The video URL checked as it is typed, so a Loom link is refused where it was pasted rather
    than after the save. The same function the server writes the row with, so the two cannot
    disagree about what is recognised — an interface that accepted more than the procedure would
    be a save that fails for no visible reason.
  */
  const video = kind === "VIDEO" && url.trim() !== "" ? parseVideoUrl(url) : null;
  const videoProblem = kind === "VIDEO" && url.trim() !== "" && video === null;

  const waitTotal = retryWaitHoursOf({ days: waitDays, hours: waitHours });
  const checkComplete =
    !hasCheck ||
    ([objective, question, factsExample, exemplar].every((text) => text.trim() !== "") &&
      waitTotal >= 1);

  /*
    Unticking the box on a check fellows have answered removes their attempts along with it, so the
    number is said beside the box, before Save, rather than discovered afterwards.
  */
  const attemptsLost = resource?.check && !hasCheck ? (checkDetail?.answered ?? 0) : 0;

  const complete =
    courseUnitId !== "" &&
    title.trim() !== "" &&
    (kind === "TEXT" ? body.trim() !== "" : url.trim() !== "") &&
    !videoProblem &&
    checkComplete &&
    // An existing check's examples are not in the form until they have loaded, and saving before
    // then would write them back empty.
    !(resource?.check && hasCheck && !checkDetail);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete) return;

    const spec =
      kind === "LINK"
        ? {
            kind: "LINK" as const,
            title,
            url,
            description: description.trim() === "" ? null : description,
          }
        : kind === "TEXT"
          ? { kind: "TEXT" as const, title, body }
          : { kind: "VIDEO" as const, title, url };

    // The whole of what the form shows: null is "this resource has no check".
    const check = hasCheck
      ? {
          objective,
          question,
          factsExample,
          exemplar,
          retryWait: { days: waitDays, hours: waitHours },
        }
      : null;

    if (resource) {
      update.mutate({ resourceId: resource.id, courseUnitId, spec, check });
    } else {
      create.mutate({ courseUnitId, spec, check });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{resource ? "Edit resource" : "Add a resource"}</DialogTitle>
            <DialogDescription>
              Readings, notes, and videos, each with an optional check for understanding. Nothing
              here is graded — a check is answered and reviewed, not marked — and a resource is
              visible to the cohort as soon as it is saved.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="resource-kind">What is it?</Label>
              <Select
                value={kind}
                onValueChange={(next) => next && setKind(next as ResourceKind)}
                items={Object.fromEntries(
                  IMPLEMENTED_RESOURCE_KINDS.map((k) => [k, RESOURCE_KIND_LABEL[k]]),
                )}
              >
                <SelectTrigger id="resource-kind" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPLEMENTED_RESOURCE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {RESOURCE_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{RESOURCE_KIND_BLURB[kind]}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="resource-module">Module</Label>
              <Select
                value={courseUnitId}
                onValueChange={(next) => next && setCourseUnitId(next)}
                items={Object.fromEntries(modules.map((row) => [row.id, row.name]))}
              >
                <SelectTrigger id="resource-module" className="w-full min-w-0">
                  <SelectValue placeholder="Choose a module" />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/*
                Why the list is empty, on the one occasion it is empty for a reason other than the
                course having no units. An unexplained empty picker reads as "this course has no
                modules", which is a claim this dialog is in no position to make when the read
                failed — and the instructor's next move would be to go and create a module that
                already exists.
              */}
              {/*
                Where it lands, said here rather than on the title, which no longer decides
                anything about order. Both sentences are about the same rule from the two sides an
                instructor meets it from: a resource is added at the end of a module, and a
                resource that changes module is added to the end of the new one.
              */}
              <p className="text-xs text-muted-foreground">
                {resource
                  ? "Moving this to another module puts it at the end of that module's list."
                  : "Added at the end of the module. Drag it into place from the Curriculum screen."}
              </p>
              {units.error && (
                <p className="text-xs text-destructive">
                  The units of this course could not be loaded, so there is nothing to choose from.{" "}
                  {units.error.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="resource-title">Title</Label>
              <Input
                id="resource-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={kind === "TEXT" ? "How to read an error message" : "MDN: Array.map()"}
                maxLength={200}
              />
            </div>

            {kind !== "TEXT" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="resource-url">{kind === "VIDEO" ? "Video link" : "Link"}</Label>
                <Input
                  id="resource-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={
                    kind === "VIDEO"
                      ? "https://www.youtube.com/watch?v=…"
                      : "https://developer.mozilla.org/…"
                  }
                  maxLength={2000}
                  aria-invalid={videoProblem || undefined}
                />
                {/*
                  Which video was recognised, rather than only whether one was. An instructor who
                  pasted the wrong tab's URL gets a valid-looking field either way; naming the
                  provider is what lets them notice.
                */}
                {video && (
                  <p className="text-xs text-muted-foreground">
                    {VIDEO_PROVIDER_LABEL[video.provider]} video{" "}
                    <span className="font-mono">{video.videoId}</span>. It will play on the course
                    page.
                  </p>
                )}
                {videoProblem && (
                  <p className="text-xs text-destructive">
                    Only YouTube and Vimeo links can be embedded. Paste the address from the
                    video&apos;s own page — or add it as a Link instead, which accepts any address.
                  </p>
                )}
              </div>
            )}

            {kind === "LINK" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="resource-description">Description (optional)</Label>
                <Input
                  id="resource-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Read the first two sections before Wednesday."
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">
                  One line, shown under the title. Anything that wants formatting is a Note.
                </p>
              </div>
            )}

            {kind === "TEXT" && (
              <MarkdownField
                id="body"
                label="Note"
                value={body}
                onChange={setBody}
                previewing={previewing}
                onPreviewChange={setPreviewing}
                rows={10}
                maxLength={50_000}
                placeholder={"## Before you start\n\nRun `npm i` first, then…"}
                hint="Markdown, rendered the same way feedback is."
              />
            )}

            <CheckSection
              enabled={hasCheck}
              onEnabledChange={setHasCheck}
              attemptsLost={attemptsLost}
              loadingExamples={Boolean(resource?.check && hasCheck && !checkDetail)}
              objective={objective}
              onObjectiveChange={setObjective}
              question={question}
              onQuestionChange={setQuestion}
              factsExample={factsExample}
              onFactsExampleChange={setFactsExample}
              exemplar={exemplar}
              onExemplarChange={setExemplar}
              waitDays={waitDays}
              onWaitDaysChange={setWaitDays}
              waitHours={waitHours}
              onWaitHoursChange={setWaitHours}
              waitTooShort={hasCheck && waitTotal < 1}
              previewing={previewing}
              onPreviewChange={setPreviewing}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!complete || busy}>
              {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {resource ? "Save" : "Add resource"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A markdown box with an Edit/Preview switch.
 *
 * **Preview shows the text as the cohort will read it**, through the same renderer the course page
 * uses. Markdown is written blind otherwise: a heading that needed a blank line above it, or a list
 * that came out as one paragraph, is invisible in the box and obvious the moment it is rendered.
 *
 * One toggle rather than a box beside the text, because the dialog is not wide enough to read prose
 * in half of it, and rather than two tabs, because this is the same Edit/Preview switch the feedback
 * editor already uses. Which field is previewing is held by the dialog, so opening it on another
 * resource puts every field back to writing — arriving at a form whose text cannot be typed into
 * would be a form that appears not to work.
 */
function MarkdownField({
  id,
  label,
  value,
  onChange,
  previewing,
  onPreviewChange,
  rows,
  maxLength,
  placeholder,
  hint,
}: {
  id: MarkdownFieldId;
  label: string;
  value: string;
  onChange: (value: string) => void;
  previewing: MarkdownFieldId | null;
  onPreviewChange: (id: MarkdownFieldId | null) => void;
  rows: number;
  maxLength: number;
  placeholder?: string;
  hint: string;
}) {
  const showing = previewing === id;
  const inputId = `resource-${id}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {/* Nothing to point at while the rendered text stands in for the box. */}
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
        /*
          Held at roughly the height of the box it stands in for, and scrolling rather than growing
          past it, so switching back and forth leaves the Save button where it was.
        */
        <div className="max-h-[35vh] min-h-24 overflow-y-auto rounded-md border border-border bg-muted/20 p-4">
          <Markdown content={value} />
        </div>
      ) : (
        <Textarea
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          placeholder={placeholder}
          maxLength={maxLength}
          className="max-h-[35vh] font-mono text-sm"
        />
      )}
      <p className="text-xs text-muted-foreground">
        {showing ? "This is what your students will see on the course page." : hint}
      </p>
    </div>
  );
}

/**
 * The check for understanding: a box to add one, and while it is ticked, the question and the two
 * examples the review reads it against.
 *
 * **Two examples and no third.** Level 2 is the facts, stated; level 3 is the facts, connected. A
 * level-1 answer is one that shows neither, and the review can tell that without being shown one —
 * which spares the instructor writing out every way there is to miss a concept.
 */
function CheckSection({
  enabled,
  onEnabledChange,
  attemptsLost,
  loadingExamples,
  objective,
  onObjectiveChange,
  question,
  onQuestionChange,
  factsExample,
  onFactsExampleChange,
  exemplar,
  onExemplarChange,
  waitDays,
  onWaitDaysChange,
  waitHours,
  onWaitHoursChange,
  waitTooShort,
  previewing,
  onPreviewChange,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** How many fellows' attempts unticking the box would remove. */
  attemptsLost: number;
  /** An existing check's examples are still on their way; the fields wait for them. */
  loadingExamples: boolean;
  objective: string;
  onObjectiveChange: (value: string) => void;
  question: string;
  onQuestionChange: (value: string) => void;
  factsExample: string;
  onFactsExampleChange: (value: string) => void;
  exemplar: string;
  onExemplarChange: (value: string) => void;
  waitDays: number;
  onWaitDaysChange: (value: number) => void;
  waitHours: number;
  onWaitHoursChange: (value: number) => void;
  waitTooShort: boolean;
  previewing: MarkdownFieldId | null;
  onPreviewChange: (id: MarkdownFieldId | null) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={enabled}
          onCheckedChange={(next) => onEnabledChange(next === true)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Add a check for understanding</span>
          <span className="text-xs text-muted-foreground">
            One question about this resource. Each fellow may answer up to {MAX_ATTEMPTS} times, and
            every answer is reviewed into a level the moment it is handed in. Nothing about it is
            graded.
          </span>
        </span>
      </label>

      {attemptsLost > 0 && (
        <p className="text-sm text-destructive" role="alert">
          Removing this check deletes the attempts {attemptsLost}{" "}
          {attemptsLost === 1 ? "fellow" : "fellows"} made at it.
        </p>
      )}

      {enabled && loadingExamples && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the examples…
        </p>
      )}

      {enabled && !loadingExamples && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="check-objective">Objective</Label>
            <Input
              id="check-objective"
              value={objective}
              onChange={(event) => onObjectiveChange(event.target.value)}
              placeholder="Explain why a closure can read variables after its outer function returns."
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              One line: the learning objective this question checks. Only instructors and the review
              see it, so it may say plainly what a good answer shows.
            </p>
          </div>

          <MarkdownField
            id="question"
            label="Question"
            value={question}
            onChange={onQuestionChange}
            previewing={previewing}
            onPreviewChange={onPreviewChange}
            rows={4}
            maxLength={10_000}
            hint="Markdown, so a question can show code."
          />

          <MarkdownField
            id="factsExample"
            label="What a level-2 answer looks like"
            value={factsExample}
            onChange={onFactsExampleChange}
            previewing={previewing}
            onPreviewChange={onPreviewChange}
            rows={4}
            maxLength={10_000}
            hint="The facts, stated without the connections between them. Only instructors and the review see this."
          />

          <MarkdownField
            id="exemplar"
            label="What a level-3 answer looks like"
            value={exemplar}
            onChange={onExemplarChange}
            previewing={previewing}
            onPreviewChange={onPreviewChange}
            rows={5}
            maxLength={10_000}
            hint={`The facts and the connections. A fellow sees this after their ${ordinal(MAX_ATTEMPTS)} attempt.`}
          />

          <p className="text-xs text-muted-foreground">
            A level-1 answer is one that shows neither; there is nothing to write for it.
          </p>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Wait between attempts</span>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="check-wait-days"
                type="number"
                min={0}
                max={365}
                value={waitDays}
                onChange={(event) => onWaitDaysChange(wholeNumber(event.target.value, 365))}
                className="w-20"
                aria-invalid={waitTooShort || undefined}
              />
              <Label htmlFor="check-wait-days" className="font-normal">
                days
              </Label>
              <Input
                id="check-wait-hours"
                type="number"
                min={0}
                max={23}
                value={waitHours}
                onChange={(event) => onWaitHoursChange(wholeNumber(event.target.value, 23))}
                className="w-20"
                aria-invalid={waitTooShort || undefined}
              />
              <Label htmlFor="check-wait-hours" className="font-normal">
                hours
              </Label>
            </div>
            <p
              className={
                waitTooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"
              }
            >
              {waitTooShort
                ? "The wait must be at least an hour."
                : "How long a fellow waits after one attempt before they may make the next."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** A number field's text as a whole number between zero and `max`. */
function wholeNumber(raw: string, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), max);
}

function ordinal(n: number): string {
  return n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`;
}
