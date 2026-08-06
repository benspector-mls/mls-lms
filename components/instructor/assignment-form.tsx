'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Field, SectionEditor, type SectionDraft } from '@/components/instructor/section-editor';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { RUBRIC_NAME_BY_SECTION_TYPE } from '@/lib/assignments/spec';
import type { AssignmentKind } from '@/lib/generated/prisma/enums';
import { NO_RUNNER, RUNNER_PRESETS } from '@/lib/sandbox/presets';
import {
  formatBytes,
  isUploadFileTypeKey,
  MAX_UPLOAD_BYTES,
  UPLOAD_FILE_TYPE_KEYS,
  UPLOAD_FILE_TYPES,
  type UploadFileTypeKey,
} from '@/lib/uploads/file-types';
import { useTRPC } from '@/trpc/client';
import type { RouterOutputs } from '@/trpc/types';

/**
 * Creating and editing an assignment.
 *
 * Two properties this screen is built around.
 *
 * **It opens from the catalogue, not from a blank field.** Choosing a module and then an
 * assignment the answer-keys repository actually holds fills the title, the repository name,
 * and the template — all three are the directory name — and offers the answer keys found
 * inside. What is left to enter is what genuinely needs a person: point values, the due date,
 * and whether the test suite covers each section.
 *
 * **Nothing an instructor can select is typed by hand.** The module, the assignment, the
 * section type, and the runner preset are all selects, and the rubric follows from the section
 * type. A typo in any of them is a grading failure discovered weeks later, and the cheapest
 * fix is an interface where the wrong value cannot be expressed.
 *
 * Validation runs on the server as fields change — the same function the write refuses on, so
 * the form cannot say a draft is fine and then have saving fail. It is debounced because it
 * makes real GitHub calls.
 */

type Context = RouterOutputs['assignments']['authoringContext'];
type Draft = RouterOutputs['assignments']['getDraft'];

/**
 * From the enum rather than spelled out, so a kind added to the schema is a compile error in
 * `KIND_META` and `toDraft` — the two places that have to say something about every one — rather
 * than a value this form silently cannot express.
 */
type Kind = AssignmentKind;

/**
 * One flat state for every kind, narrowed into the right shape by `toDraft` below.
 *
 * Flat rather than a union mirroring `assignmentSpecSchema`, because a form's job is to hold
 * what has been typed — including the repository fields an instructor filled in before
 * switching the kind, which a union would discard on every switch. What crosses to the server
 * is the narrowed shape, and `.strict()` on the other side is what makes that mandatory
 * rather than a convention: a Google Doc draft carrying `templateRepo: ""` is a validation
 * error, not a field quietly ignored.
 */
type FormState = {
  kind: Kind;
  title: string;
  moduleId: string;
  /** Only a REPO assignment has one; null for every other kind. */
  moduleTag: string | null;
  completionThreshold: number;
  dueAt: Date | null;
  templateRepo: string;
  assignmentRepoName: string;
  githubOrg: string;
  templateRef: string | null;
  runnerPreset: string;
  runnerConfig: null;
  templateDocUrl: string;
  /** Keys of UPLOAD_FILE_TYPES. Only a FILE_UPLOAD assignment sends these. */
  acceptedFileTypes: UploadFileTypeKey[];
  submissionInstructions: string;
  sections: SectionDraft[];
};

/** What the kind is called on screen, and what it means in one line. */
const KIND_META: Record<Kind, { label: string; hint: string }> = {
  REPO: {
    label: 'GitHub repository',
    hint: 'Generated from a template. The student opens a pull request, and the pipeline grades it.',
  },
  GOOGLE_DOC: {
    label: 'Google Doc',
    hint: 'Students take their own copy of a template document and submit the link. Graded by hand.',
  },
  FILE_UPLOAD: {
    label: 'File upload',
    hint: 'Students hand in a file. No template and nothing to accept. Graded by hand.',
  },
  EXTERNAL_URL: {
    label: 'External URL',
    hint: 'Students make something on another service — Canva, Loom, a deployed site — and submit the link. No template and nothing to accept. Graded by hand.',
  },
};

/** True when this kind has a repository, a template, and a suite that can run. */
function isRepoKind(kind: Kind): boolean {
  return kind === 'REPO';
}

/**
 * The draft as the procedures want it, per kind.
 *
 * The repository fields are *omitted* for the kinds that have none rather than sent as null, which
 * the schema's own defaults then fill in. Sending `templateRepo: ""` would fail validation and
 * sending `null` would work — omitting says what is meant, which is that a document assignment
 * has no opinion about repositories at all.
 */
function toDraft(state: FormState): unknown {
  const shared = {
    title: state.title,
    moduleId: state.moduleId,
    completionThreshold: state.completionThreshold,
    dueAt: state.dueAt,
    sections: state.sections,
    // Empty is absent. A textarea an instructor cleared should read as no instructions
    // rather than as instructions that happen to be blank.
    submissionInstructions: state.submissionInstructions.trim() || null,
  };

  if (state.kind === 'REPO') {
    return {
      ...shared,
      kind: 'REPO',
      // Where the reference solutions are, which only this kind has.
      moduleTag: state.moduleTag,
      templateRepo: state.templateRepo,
      assignmentRepoName: state.assignmentRepoName,
      githubOrg: state.githubOrg,
      templateRef: state.templateRef,
      runnerPreset: state.runnerPreset,
      runnerConfig: state.runnerConfig,
    };
  }

  if (state.kind === 'GOOGLE_DOC') {
    return { ...shared, kind: 'GOOGLE_DOC', templateDocUrl: state.templateDocUrl.trim() };
  }

  if (state.kind === 'FILE_UPLOAD') {
    return {
      ...shared,
      kind: 'FILE_UPLOAD',
      acceptedFileTypes: state.acceptedFileTypes,
    };
  }

  // Nothing of its own to send. What the student is asked to make, and where, is prose in
  // `submissionInstructions` rather than a field — see the schema's own note on why there is no
  // column for a starting link.
  return { ...shared, kind: 'EXTERNAL_URL' };
}

const DEBOUNCE_MS = 600;

export function AssignmentForm({
  courseId,
  existing,
}: {
  courseId: string;
  /** Absent when creating. */
  existing?: Draft;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const context = useQuery(trpc.assignments.authoringContext.queryOptions({ courseId }));

  const [state, setState] = React.useState<FormState | null>(() =>
    existing ? fromDraft(existing) : null,
  );

  if (context.isPending) return <FormSkeleton />;
  if (context.error) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Could not open the form</AlertTitle>
          <AlertDescription>{context.error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <Editor
      courseId={courseId}
      context={context.data}
      existing={existing}
      state={state}
      setState={setState}
      onSaved={(assignmentId) => {
        // Back to the course, which is where an instructor sees the result in context —
        // the new row, its draft badge, and its place in the module ordering.
        router.push(`/instructor/courses/${courseId}`);
        void assignmentId;
      }}
    />
  );
}

function Editor({
  courseId,
  context,
  existing,
  state,
  setState,
  onSaved,
}: {
  courseId: string;
  context: Context;
  existing?: Draft;
  state: FormState | null;
  setState: React.Dispatch<React.SetStateAction<FormState | null>>;
  onSaved: (assignmentId: string) => void;
}) {
  const trpc = useTRPC();

  /*
    Two questions that used to be one. `moduleId` is which module of the course this belongs
    to — a row an instructor named. `answerKeyDir` is which directory in the answer-keys
    repository holds the reference solutions, which only a repository assignment has. One
    string used to do both, which is why a cohort's module list could not be changed without
    moving where grading looked for answer keys.
  */
  const [moduleId, setModuleId] = React.useState<string>(
    existing?.moduleId ?? context.course.modules[0]?.id ?? '',
  );
  const [answerKeyDir, setAnswerKeyDir] = React.useState<string>(existing?.moduleTag ?? '');

  // Held outside `state` because it is asked before there is a draft: for a repository
  // assignment nothing exists until one is chosen from the catalogue, and the kind is what
  // decides whether there is a catalogue at all.
  const [kind, setKind] = React.useState<Kind>((existing?.kind as Kind) ?? 'REPO');

  // What the server has been asked about. Trails the form by DEBOUNCE_MS so that typing a
  // point value does not make a GitHub request per keystroke.
  const [settled, setSettled] = React.useState<FormState | null>(state);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(state), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  // Listed from the repository rather than derived from the course, because the course's
  // modules are no longer its directory names.
  const answerKeyDirs = useQuery({
    ...trpc.assignments.answerKeyDirs.queryOptions({ courseId }),
    enabled: isRepoKind(kind),
  });

  const catalogue = useQuery({
    ...trpc.assignments.catalogue.queryOptions({ courseId, moduleTag: answerKeyDir }),
    // Only the repository kind has one. Asking anyway would spend a GitHub call listing
    // answer-key directories for an assignment that will never have any.
    enabled: answerKeyDir.length > 0 && isRepoKind(kind),
  });

  const answerKeys = useQuery({
    ...trpc.assignments.answerKeyOptions.queryOptions({
      courseId,
      moduleTag: state?.moduleTag ?? '',
      repoName: state?.assignmentRepoName ?? '',
    }),
    enabled: Boolean(state?.moduleTag && state?.assignmentRepoName),
  });

  /*
    Two things the repository already states, applied once each rather than asked for.

    Both arrive after the assignment is chosen, which is why they are effects rather than part
    of `blankDraft`: the catalogue choice is synchronous and these are two more round trips.
    Each guards on having already been applied for this repository, so that an instructor who
    deliberately unticks every answer key does not have them tick themselves again.
  */
  const detection = useQuery({
    ...trpc.assignments.inferFromTemplate.queryOptions({
      courseId,
      templateRepo: state?.templateRepo ?? '',
    }),
    enabled: !existing && Boolean(state?.templateRepo),
  });

  const applied = React.useRef<{ keys?: string; runner?: string }>({});

  React.useEffect(() => {
    const repoName = state?.assignmentRepoName;
    const paths = answerKeys.data?.paths;
    if (!repoName || !paths || paths.length === 0) return;
    if (applied.current.keys === repoName) return;

    applied.current.keys = repoName;
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map((section) =>
          // Only a section that has none: editing an existing assignment must not have its
          // deliberate subset replaced by everything in the directory.
          section.grading === 'ai' && section.answerKeyPaths.length === 0
            ? { ...section, answerKeyPaths: paths }
            : section,
        ),
      };
    });
  }, [answerKeys.data?.paths, state?.assignmentRepoName, setState]);

  React.useEffect(() => {
    const repoName = state?.assignmentRepoName;
    if (!repoName || !detection.data?.confident) return;
    if (applied.current.runner === repoName) return;

    applied.current.runner = repoName;
    setState((prev) => (prev ? { ...prev, runnerPreset: detection.data.preset } : prev));
  }, [detection.data, state?.assignmentRepoName, setState]);

  const validation = useQuery({
    ...trpc.assignments.validateDraft.queryOptions({
      courseId,
      assignmentId: existing?.id,
      // Narrowed to the kind's own shape, so the form is checked against exactly what saving
      // would send rather than against a superset of it.
      draft: settled ? toDraft(settled) : null,
    }),
    enabled: settled !== null,
  });

  const findings = validation.data?.findings ?? [];
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  const fieldFindings = (path: string) => findings.filter((finding) => finding.path === path);

  const create = useMutation(
    trpc.assignments.create.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Created ${result.assignment.title}. It is not visible to students yet.`);
        onSaved(result.assignment.id);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const update = useMutation(
    trpc.assignments.update.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Saved ${result.assignment.title}.`);
        onSaved(result.assignment.id);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const busy = create.isPending || update.isPending;
  // Deliberately not "no errors": a draft the server has not seen yet has no findings, which
  // is not the same as being valid. Saving is refused until the settled draft has been checked.
  const checked = settled === state && validation.isSuccess;
  const canSave = state !== null && checked && errors.length === 0 && !busy;

  const pointTotal = (state?.sections ?? []).reduce(
    (total, section) => total + (Number.isFinite(section.pointValue) ? section.pointValue : 0),
    0,
  );

  const runnerNames = [NO_RUNNER, ...Object.keys(RUNNER_PRESETS)];

  // Which mode this assignment is already committed to, so only that one is offered.
  const hasAiSection = (state?.sections ?? []).some((section) => section.grading === 'ai');
  const hasManualSection = (state?.sections ?? []).some(
    (section) => section.grading === 'manual',
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={existing ? `Edit ${existing.title}` : 'New assignment'}
        description={`${context.course.name} · ${context.course.cohortTerm}`}
        actions={
          <div className="flex items-center gap-2">
            {state && (
              <Badge variant="outline" className="font-normal tabular-nums">
                {pointTotal} pts
              </Badge>
            )}
            <Button
              disabled={!canSave}
              onClick={() => {
                if (!state) return;
                const draft = toDraft(state);
                if (existing) update.mutate({ assignmentId: existing.id, draft });
                else create.mutate({ courseId, draft });
              }}
            >
              {busy ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {existing ? 'Save' : 'Create'}
            </Button>
          </div>
        }
      />

      {/* ---- Which assignment ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Which assignment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/*
            The first question, because it decides everything after it: whether there is a
            catalogue to pick from, whether there is a runner and a template, and whether the
            pipeline can grade this at all. Locked once the assignment exists — changing the
            kind of a saved assignment would change what its existing submissions are, and
            there is no migration from a pull request to a document.
          */}
          <Field
            label="Kind"
            findings={fieldFindings('kind')}
            hint={
              existing
                ? 'Fixed once an assignment exists. Create a new one to hand work in a different way.'
                : KIND_META[state?.kind ?? kind].hint
            }
          >
            {existing ? (
              <Input value={KIND_META[existing.kind as Kind].label} disabled />
            ) : (
              <Select
                value={kind}
                onValueChange={(value) => {
                  const next = (value ?? 'REPO') as Kind;
                  setKind(next);
                  /*
                    A repository assignment is opened from the catalogue, so its state stays
                    null until an assignment is chosen. The others have nothing to choose from,
                    so the form starts immediately with one hand-graded section.
                  */
                  setState(
                    next === 'REPO'
                      ? null
                      : blankNonRepoDraft({ kind: next, moduleId, existingState: state }),
                  );
                }}
                // Without this the trigger shows the raw enum value — `FILE_UPLOAD` — while the
                // list it was chosen from showed "File upload". Base UI's trigger renders the
                // value, not the item, so a select whose label differs from its value has to say
                // how they map. The module select below needs it for the same reason; the runner
                // preset and the catalogue do not, because there each label *is* its value.
                items={Object.fromEntries(
                  (Object.keys(KIND_META) as Kind[]).map((name) => [name, KIND_META[name].label]),
                )}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_META) as Kind[]).map((name) => (
                    <SelectItem key={name} value={name}>
                      {KIND_META[name].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {/*
            A course with no modules cannot hold an assignment, and the foreign key says so.
            Stated rather than shown as an empty select, which would read as a loading failure.
          */}
          {context.course.modules.length === 0 ? (
            <Field label="Module" findings={fieldFindings('moduleId')}>
              <Alert>
                <AlertTriangle />
                <AlertTitle>This course has no modules yet</AlertTitle>
                <AlertDescription>
                  An assignment belongs to a module, so there has to be one first. Create them
                  on the course page&apos;s Modules tab, then come back.
                </AlertDescription>
              </Alert>
            </Field>
          ) : (
            <Field label="Module" findings={fieldFindings('moduleId')}>
              <Select
                value={moduleId}
                onValueChange={(value) => {
                  // Base UI reports null when a select is cleared; there is no cleared state
                  // here, so an empty string keeps the rest of the form's types honest.
                  const next = value ?? '';
                  setModuleId(next);
                  setState((prev) => (prev ? { ...prev, moduleId: next } : prev));
                }}
                // The trigger renders the value, which is a uuid. Without this it would show one.
                items={Object.fromEntries(
                  context.course.modules.map((row) => [row.id, row.name]),
                )}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a module" />
                </SelectTrigger>
                <SelectContent>
                  {context.course.modules.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {/*
            A second question, and only a repository assignment has it. This used to be the same
            field as the module above, which is what tied a cohort's module list to the
            answer-keys repository's directory names — renaming a module moved where grading
            looked for solutions. Superseded once an assignment names its own answer-key
            repository, at which point this becomes a URL.
          */}
          {isRepoKind(kind) && (
            <Field
              label="Reference solutions live under"
              findings={fieldFindings('moduleTag')}
              hint="Which directory of the answer-keys repository holds this assignment's solutions. Separate from the module above, which is what this course calls it."
            >
              <Select
                value={answerKeyDir}
                onValueChange={(value) => {
                  const next = value ?? '';
                  setAnswerKeyDir(next);
                  setState((prev) => (prev ? { ...prev, moduleTag: next } : prev));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a directory" />
                </SelectTrigger>
                <SelectContent>
                  {(answerKeyDirs.data?.dirs ?? []).map((dir) => (
                    <SelectItem key={dir} value={dir}>
                      {dir}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {/*
            No catalogue for the kinds with no repository, deliberately rather than for now. The
            answer-keys repository is the single source of truth for what repository-backed
            assignments the curriculum contains, and there is no equivalent list of documents
            to check a new one against — a shared Drive folder per module is the likely shape,
            and it is worth designing when a real one exists rather than guessing at it.
          */}
          {!isRepoKind(kind) ? (
            <Field
              label="Title"
              findings={fieldFindings('title')}
              hint="What students see in their list."
            >
              <Input
                value={state?.title ?? ''}
                onChange={(event) =>
                  setState((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                }
              />
            </Field>
          ) : existing ? (
            <Field
              label="Repository name"
              findings={fieldFindings('assignmentRepoName')}
              hint={
                existing.submissionCount > 0
                  ? `${existing.submissionCount} student(s) have accepted this. Their repositories are named after it, so it cannot be changed.`
                  : undefined
              }
            >
              <Input
                value={state?.assignmentRepoName ?? ''}
                disabled={existing.submissionCount > 0}
                onChange={(event) =>
                  setState((prev) =>
                    prev ? { ...prev, assignmentRepoName: event.target.value } : prev,
                  )
                }
              />
            </Field>
          ) : (
            <Field
              label="Assignment"
              findings={fieldFindings('assignmentRepoName')}
              hint="Read from the answer-keys repository. Adding a directory there is what makes a new assignment available here."
            >
              {catalogue.isPending ? (
                <Skeleton className="h-9 w-full" />
              ) : (catalogue.data?.assignments.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  The answer-keys repository holds nothing under{' '}
                  <code>{answerKeyDir || '(no directory chosen)'}</code>.
                </p>
              ) : (
                <Select
                  value={state?.assignmentRepoName ?? ''}
                  onValueChange={(value) =>
                    setState(
                      blankDraft({
                        name: value ?? '',
                        moduleId,
                        moduleTag: answerKeyDir,
                        githubOrg: context.defaultGithubOrg ?? '',
                        rubrics: context.rubrics,
                      }),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an assignment" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogue.data?.assignments.map((entry) => (
                      <SelectItem key={entry.name} value={entry.name} disabled={entry.alreadyAdded}>
                        {entry.name}
                        {/* Marked rather than hidden: an instructor looking for one they
                            already added should see that it is there. */}
                        {entry.alreadyAdded && ' — already in this course'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
        </CardContent>
      </Card>

      {state === null ? (
        <p className="text-sm text-muted-foreground">
          Choose an assignment to fill in the rest.
        </p>
      ) : (
        <>
          {/* ---- What students see ---------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What students see</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Entered above for the kinds with no catalogue, so it is not asked twice. */}
                {isRepoKind(state.kind) && (
                  <Field label="Title" findings={fieldFindings('title')}>
                    <Input
                      value={state.title}
                      onChange={(event) => setState({ ...state, title: event.target.value })}
                    />
                  </Field>
                )}
                <Field
                  label="Due"
                  findings={fieldFindings('dueAt')}
                  hint="Optional. A late submission is recorded as late, never refused."
                >
                  <Input
                    type="date"
                    value={state.dueAt ? toDateInput(state.dueAt) : ''}
                    onChange={(event) =>
                      setState({
                        ...state,
                        dueAt: event.target.value
                          ? new Date(`${event.target.value}T23:59:00`)
                          : null,
                      })
                    }
                  />
                </Field>
              </div>

              {state.kind === 'GOOGLE_DOC' && (
                <Field
                  label="Template document"
                  findings={fieldFindings('templateDocUrl')}
                  hint="Accepting sends the student to Google's own prompt to take a copy, built from this link. Paste the sharing link — it should end in /view or /edit."
                >
                  <Input
                    value={state.templateDocUrl}
                    placeholder="https://docs.google.com/document/d/…/view"
                    onChange={(event) =>
                      setState({ ...state, templateDocUrl: event.target.value })
                    }
                  />
                </Field>
              )}

              {/*
                Checkboxes from a fixed list rather than a text field, for the reason the runner
                preset is a select: a typo'd MIME type is not an error an instructor sees, it is
                a student being told their correct file is the wrong kind, on the due date.
              */}
              {state.kind === 'FILE_UPLOAD' && (
                <Field
                  label="What students may hand in"
                  findings={fieldFindings('acceptedFileTypes')}
                  hint={`At least one. Anything else is refused before it is stored, and the limit is ${formatBytes(MAX_UPLOAD_BYTES)} whatever you pick.`}
                >
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {UPLOAD_FILE_TYPE_KEYS.map((key) => {
                      const ticked = state.acceptedFileTypes.includes(key);
                      return (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={ticked}
                            onChange={() =>
                              setState({
                                ...state,
                                acceptedFileTypes: ticked
                                  ? state.acceptedFileTypes.filter((held) => held !== key)
                                  : [...state.acceptedFileTypes, key],
                              })
                            }
                            className="size-4 rounded border-input"
                          />
                          <span>{UPLOAD_FILE_TYPES[key].label}</span>
                          <span className="text-xs text-muted-foreground">
                            {UPLOAD_FILE_TYPES[key].extensions.join(' ')}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Field>
              )}

              <Field
                label="Submission instructions"
                findings={fieldFindings('submissionInstructions')}
                hint={
                  isRepoKind(state.kind)
                    ? 'Optional, in markdown. The draft-branch-and-pull-request steps are already shown, so this is for anything specific to this assignment.'
                    : 'Optional, in markdown. How to hand the work in — this kind has no ritual of its own, so anything the student needs to know goes here.'
                }
              >
                <textarea
                  rows={4}
                  value={state.submissionInstructions}
                  onChange={(event) =>
                    setState({ ...state, submissionInstructions: event.target.value })
                  }
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </Field>
            </CardContent>
          </Card>

          {/* ---- How it is graded ----------------------------------------- */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">How it is graded</CardTitle>
                <Badge variant="outline" className="font-normal tabular-nums">
                  {pointTotal} pts total
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/*
                Absent rather than disabled for a kind with no repository: there is no template
                to take a suite from, so a runner is not a setting left at its default, it is a
                question that does not apply.
              */}
              {isRepoKind(state.kind) && (
              <Field
                label="Test runner"
                findings={fieldFindings('runnerPreset')}
                hint={
                  detection.data?.reason
                    ? `${detection.data.reason} The tests come from the template repository, never the student’s copy.`
                    : state.runnerPreset === NO_RUNNER
                      ? 'No automated tests. Normal for short response and frontend work — most of the program.'
                      : 'The tests come from the template repository, never the student’s copy.'
                }
              >
                <Select
                  value={state.runnerPreset}
                  onValueChange={(value) =>
                    setState({ ...state, runnerPreset: value ?? NO_RUNNER })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {runnerNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              )}

              {isRepoKind(state.kind) && <Separator />}

              {state.sections.map((section, index) => (
                <SectionEditor
                  key={index}
                  section={section}
                  index={index}
                  answerKeyOptions={answerKeys.data?.paths ?? []}
                  rubrics={context.rubrics}
                  findings={findings}
                  hasRunner={state.runnerPreset !== NO_RUNNER}
                  onChange={(next) =>
                    setState({
                      ...state,
                      sections: state.sections.map((old, i) => (i === index ? next : old)),
                    })
                  }
                  onRemove={() =>
                    setState({
                      ...state,
                      sections: state.sections.filter((_, i) => i !== index),
                    })
                  }
                />
              ))}

              {fieldFindings('sections').map((finding, index) => (
                <p key={index} className="text-xs text-destructive">
                  {finding.message}
                </p>
              ))}

              {/*
                One grading mode per assignment, so only one of these is ever offered. A
                mixed assignment is refused by the schema — the pipeline would report on some
                of its sections and not others, and the assignment's point total would exceed
                what approving could record — so the button that would build one is absent
                rather than present and refused. Splitting the work into two assignments is
                the answer, and it is the direction the curriculum is going anyway.

                A kind with no repository has nothing for the pipeline to read, so hand
                grading is its only mode and the choice never arises.
              */}
              <div className="flex flex-wrap gap-2">
                {isRepoKind(state.kind) && !hasManualSection && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setState({
                        ...state,
                        sections: [
                          ...state.sections,
                          aiSection({ rubrics: context.rubrics }),
                        ],
                      })
                    }
                  >
                    <Plus data-icon="inline-start" />
                    Section the model grades
                  </Button>
                )}
                {!hasAiSection && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setState({
                        ...state,
                        sections: [
                          ...state.sections,
                          { grading: 'manual', label: '', pointValue: 10 },
                        ],
                      })
                    }
                  >
                    <Plus data-icon="inline-start" />
                    Section graded by hand
                  </Button>
                )}
              </div>

              {hasManualSection && isRepoKind(state.kind) && (
                <p className="text-xs text-muted-foreground">
                  This assignment is graded by hand, so no report is generated for it.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---- GitHub ---------------------------------------------------- */}
          {isRepoKind(state.kind) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">GitHub</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Organization" findings={fieldFindings('githubOrg')}>
                  <Input
                    value={state.githubOrg}
                    onChange={(event) => setState({ ...state, githubOrg: event.target.value })}
                  />
                </Field>
                <Field
                  label="Template repository"
                  findings={fieldFindings('templateRepo')}
                  hint="Checked against GitHub. Student repositories are generated from this."
                >
                  <Input
                    value={state.templateRepo}
                    onChange={(event) => setState({ ...state, templateRepo: event.target.value })}
                  />
                </Field>
              </CardContent>
            </Card>
          )}

          <Findings errors={errors} warnings={warnings} checking={!checked} />
        </>
      )}
    </div>
  );
}

/**
 * What the server said about the draft.
 *
 * Errors and warnings are separated rather than listed together, because they mean different
 * things: an error is why the save button is disabled, and a warning is something that will
 * be true of the saved assignment. Presenting them identically would teach an instructor to
 * dismiss both.
 */
function Findings({
  errors,
  warnings,
  checking,
}: {
  errors: { path: string; message: string }[];
  warnings: { path: string; message: string }[];
  checking: boolean;
}) {
  if (checking) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Checking against the repository…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            {errors.length === 1 ? 'One thing to fix' : `${errors.length} things to fix`}
          </AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {errors.map((finding, index) => (
                <li key={index}>{finding.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="text-amber-600 dark:text-amber-400" />
          <AlertTitle>Worth knowing, but not a problem</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {warnings.map((finding, index) => (
                <li key={index}>{finding.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {errors.length === 0 && warnings.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" />
          Everything checks out against the repository and the rubrics.
        </p>
      )}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** A new AI-graded section, with the rubric already matched to its type. */
function aiSection({ rubrics }: { rubrics: { id: string; name: string }[] }): SectionDraft {
  const type = 'coding_algorithm' as const;
  return {
    grading: 'ai',
    type,
    pointValue: 30,
    rubricId: rubrics.find((r) => r.name === RUBRIC_NAME_BY_SECTION_TYPE[type])?.id ?? '',
    answerKeyPaths: [],
    reportTemplate: 'coding-fluency',
  };
}

/**
 * What choosing an assignment from the catalogue fills in.
 *
 * The directory name is the title, the repository name, and the template repository's name,
 * exactly as `prisma/seed.ts` derives them — that agreement is what lets a catalogue choice
 * fill three fields rather than one.
 */
function blankDraft({
  name,
  moduleId,
  moduleTag,
  githubOrg,
  rubrics,
}: {
  name: string;
  moduleId: string;
  moduleTag: string;
  githubOrg: string;
  rubrics: { id: string; name: string }[];
}): FormState {
  return {
    kind: 'REPO',
    title: name,
    moduleId,
    moduleTag,
    completionThreshold: 0.75,
    dueAt: null,
    templateRepo: githubOrg ? `${githubOrg}/${name}` : '',
    assignmentRepoName: name,
    githubOrg,
    templateRef: null,
    runnerPreset: NO_RUNNER,
    runnerConfig: null,
    templateDocUrl: '',
    acceptedFileTypes: ['pdf'],
    submissionInstructions: '',
    sections: [aiSection({ rubrics })],
  };
}

/**
 * A starting draft for a kind with no catalogue to open from.
 *
 * One hand-graded section, because that is the only mode these kinds have and an assignment
 * needs at least one. What was already typed carries across, so choosing the kind twice while
 * deciding does not lose a title.
 */
function blankNonRepoDraft({
  kind,
  moduleId,
  existingState,
}: {
  kind: Kind;
  moduleId: string;
  existingState: FormState | null;
}): FormState {
  return {
    kind,
    title: existingState?.title ?? '',
    moduleId,
    // No repository, so no answer-keys directory.
    moduleTag: null,
    completionThreshold: existingState?.completionThreshold ?? 0.75,
    dueAt: existingState?.dueAt ?? null,
    templateRepo: '',
    assignmentRepoName: '',
    githubOrg: '',
    templateRef: null,
    runnerPreset: NO_RUNNER,
    runnerConfig: null,
    templateDocUrl: existingState?.templateDocUrl ?? '',
    // Ticked rather than empty, because every file-upload assignment needs at least one and a
    // PDF is what almost all of them want. An instructor changes it; they cannot forget it.
    acceptedFileTypes:
      existingState?.acceptedFileTypes && existingState.acceptedFileTypes.length > 0
        ? existingState.acceptedFileTypes
        : ['pdf'],
    submissionInstructions: existingState?.submissionInstructions ?? '',
    sections: existingState?.sections.every((section) => section.grading === 'manual')
      ? existingState.sections
      : [{ grading: 'manual', label: '', pointValue: 10 }],
  };
}

function fromDraft(draft: Draft): FormState {
  return {
    kind: draft.kind as Kind,
    title: draft.title,
    moduleId: draft.moduleId,
    moduleTag: draft.moduleTag,
    completionThreshold: draft.completionThreshold,
    dueAt: draft.dueAt,
    templateRepo: draft.templateRepo ?? '',
    assignmentRepoName: draft.assignmentRepoName ?? '',
    githubOrg: draft.githubOrg ?? '',
    templateRef: draft.templateRef,
    runnerPreset: draft.runnerPreset,
    runnerConfig: null,
    templateDocUrl: draft.templateDocUrl ?? '',
    acceptedFileTypes: (draft.acceptedFileTypes ?? []).filter(isUploadFileTypeKey),
    submissionInstructions: draft.submissionInstructions ?? '',
    sections: (draft.sections as SectionDraft[]) ?? [],
  };
}

/** A date input wants yyyy-mm-dd in local time, which toISOString does not give. */
function toDateInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
