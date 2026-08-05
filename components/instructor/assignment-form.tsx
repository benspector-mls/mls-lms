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
import { NO_RUNNER, RUNNER_PRESETS } from '@/lib/sandbox/presets';
import { moduleLabel } from '@/lib/status';
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

/** The shape the procedures accept. Mirrors `assignmentSpecSchema` for the REPO kind. */
type FormState = {
  kind: 'REPO';
  title: string;
  moduleTag: string;
  completionThreshold: number;
  dueAt: Date | null;
  templateRepo: string;
  assignmentRepoName: string;
  githubOrg: string;
  templateRef: string | null;
  runnerPreset: string;
  runnerConfig: null;
  sections: SectionDraft[];
};

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

  const [moduleTag, setModuleTag] = React.useState<string>(
    existing?.moduleTag ?? context.course.moduleStructure[0] ?? '',
  );

  // What the server has been asked about. Trails the form by DEBOUNCE_MS so that typing a
  // point value does not make a GitHub request per keystroke.
  const [settled, setSettled] = React.useState<FormState | null>(state);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(state), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const catalogue = useQuery({
    ...trpc.assignments.catalogue.queryOptions({ courseId, moduleTag }),
    enabled: moduleTag.length > 0,
  });

  const answerKeys = useQuery({
    ...trpc.assignments.answerKeyOptions.queryOptions({
      courseId,
      moduleTag: state?.moduleTag ?? '',
      repoName: state?.assignmentRepoName ?? '',
    }),
    enabled: Boolean(state?.moduleTag && state?.assignmentRepoName),
  });

  const validation = useQuery({
    ...trpc.assignments.validateDraft.queryOptions({
      courseId,
      assignmentId: existing?.id,
      draft: settled,
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
                if (existing) update.mutate({ assignmentId: existing.id, draft: state });
                else create.mutate({ courseId, draft: state });
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
          <Field label="Module" findings={fieldFindings('moduleTag')}>
            <Select
              value={moduleTag}
              onValueChange={(value) => {
                // Base UI reports null when a select is cleared; there is no cleared state
                // here, so an empty string keeps the rest of the form's types honest.
                const tag = value ?? '';
                setModuleTag(tag);
                setState((prev) => (prev ? { ...prev, moduleTag: tag } : prev));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a module" />
              </SelectTrigger>
              <SelectContent>
                {context.course.moduleStructure.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {moduleLabel(tag)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {existing ? (
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
                  The answer-keys repository holds nothing for {moduleLabel(moduleTag)}.
                </p>
              ) : (
                <Select
                  value={state?.assignmentRepoName ?? ''}
                  onValueChange={(value) =>
                    setState(
                      blankDraft({
                        name: value ?? '',
                        moduleTag,
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
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" findings={fieldFindings('title')}>
                <Input
                  value={state.title}
                  onChange={(event) => setState({ ...state, title: event.target.value })}
                />
              </Field>
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
                      dueAt: event.target.value ? new Date(`${event.target.value}T23:59:00`) : null,
                    })
                  }
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
              <Field
                label="Test runner"
                findings={fieldFindings('runnerPreset')}
                hint={
                  state.runnerPreset === NO_RUNNER
                    ? 'No automated tests. Normal for short response and frontend work — most of the program.'
                    : 'The instructor tests come from the template repository, never the student’s copy.'
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

              <Separator />

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

              <div className="flex flex-wrap gap-2">
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
              </div>
            </CardContent>
          </Card>

          {/* ---- GitHub ---------------------------------------------------- */}
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
  moduleTag,
  githubOrg,
  rubrics,
}: {
  name: string;
  moduleTag: string;
  githubOrg: string;
  rubrics: { id: string; name: string }[];
}): FormState {
  return {
    kind: 'REPO',
    title: name,
    moduleTag,
    completionThreshold: 0.75,
    dueAt: null,
    templateRepo: githubOrg ? `${githubOrg}/${name}` : '',
    assignmentRepoName: name,
    githubOrg,
    templateRef: null,
    runnerPreset: NO_RUNNER,
    runnerConfig: null,
    sections: [aiSection({ rubrics })],
  };
}

function fromDraft(draft: Draft): FormState {
  return {
    kind: 'REPO',
    title: draft.title,
    moduleTag: draft.moduleTag,
    completionThreshold: draft.completionThreshold,
    dueAt: draft.dueAt,
    templateRepo: draft.templateRepo ?? '',
    assignmentRepoName: draft.assignmentRepoName ?? '',
    githubOrg: draft.githubOrg ?? '',
    templateRef: draft.templateRef,
    runnerPreset: draft.runnerPreset,
    runnerConfig: null,
    sections: (draft.sections as SectionDraft[]) ?? [],
  };
}

/** A date input wants yyyy-mm-dd in local time, which toISOString does not give. */
function toDateInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
