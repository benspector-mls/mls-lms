"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  PencilLine,
  Plus,
  Save,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Field, SectionEditor, type SectionDraft } from "@/components/instructor/section-editor";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  normalizeRepoRef,
  parseRepoRef,
  repoNameFromRef,
  repoPathFromRef,
} from "@/lib/assignments/repo-ref";
import { CATEGORY_META, UNIT_CATEGORIES, compareByPosition } from "@/lib/course-units";
import { curriculumHref } from "@/lib/links";
import {
  END_OF_DAY,
  instantAtSchoolClock,
  schoolClockOf,
  schoolDayOf,
  type SchoolClock,
} from "@/lib/school-time";
import { SECTION_TYPE_REGISTRY } from "@/lib/section-types";
import type { AssignmentKind } from "@/lib/generated/prisma/enums";
import { NO_RUNNER, RUNNER_PRESETS } from "@/lib/sandbox/presets";
import {
  formatBytes,
  isUploadFileTypeKey,
  MAX_UPLOAD_BYTES,
  UPLOAD_FILE_TYPE_KEYS,
  extensionsOf,
  UPLOAD_FILE_TYPES,
  type UploadFileTypeKey,
} from "@/lib/uploads/file-types";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Creating and editing an assignment.
 *
 * Two properties this screen is built around.
 *
 * **An assignment says which repositories it uses.** For a repository assignment an instructor
 * pastes two URLs — the template every student's repository is generated from, and the private
 * repository holding the reference solutions. Everything that can follow from those does: the
 * repository name follows the template's own name until it is changed, the runner follows what
 * the template's `package.json` declares, and the answer keys are ticked from a listing of the
 * repository that was named. What is left to enter is what genuinely needs a person: the
 * title, point values, the due date, and whether the test suite covers each section.
 *
 * **Nothing an instructor can select is typed by hand.** The module, the section type, and the
 * runner preset are all selects, the rubric follows from the section type, and answer key paths
 * come from a directory listing. A typo in any of them is a grading failure discovered weeks
 * later, and the cheapest fix is an interface where the wrong value cannot be expressed.
 *
 * Validation runs on the server as fields change — the same function the write refuses on, so
 * the form cannot say a draft is fine and then have saving fail. It is debounced because it
 * makes real GitHub calls.
 */

/**
 * The select's value for "not team work". Not a set id, so it cannot collide with one, and
 * not the empty string, which Base UI treats as no selection at all.
 */
const INDIVIDUAL_WORK = "individual";

type Context = RouterOutputs["assignments"]["authoringContext"];
type Draft = RouterOutputs["assignments"]["getDraft"];

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
 * rather than a convention: a Drive draft carrying `templateRepo: ""` is a validation
 * error, not a field quietly ignored.
 */
type FormState = {
  kind: Kind;
  title: string;
  /**
   * The module, project, or assessment this belongs to.
   *
   * One field, because an assignment has one parent. All three categories are course units, so
   * there is nothing to derive and nothing that can disagree — the form asks the question once
   * and the answer is what gets saved.
   */
  courseUnitId: string;
  completionThreshold: number;
  dueAt: Date | null;
  /** As pasted. Normalized to owner/repo on the way out — see toDraft. */
  templateRepo: string;
  /** As pasted, and only a REPO assignment has one. */
  answerKeyRepo: string;
  /**
   * The directory inside it whose contents are the reference solutions. "" is the root.
   *
   * Part of the draft rather than local state, because it is stored: every file under it is
   * what grading reads, so it is the assignment's answer to "where are the solutions" and not
   * a place the form happens to be looking.
   */
  answerKeyDir: string;
  assignmentRepoName: string;
  githubOrg: string;
  templateRef: string | null;
  runnerPreset: string;
  runnerConfig: null;
  templateDriveUrl: string;
  /** Keys of UPLOAD_FILE_TYPES. Only a FILE_UPLOAD assignment sends these. */
  acceptedFileTypes: UploadFileTypeKey[];
  submissionInstructions: string;
  /**
   * The set of teams this is handed in by, or null for work each student does alone.
   *
   * One field rather than a tick-box beside a select, because pointing at a set *is* what makes
   * an assignment team work — two fields could disagree and nothing would say which was right.
   * The tick-box below writes this and reads it; it holds no state of its own.
   */
  teamSetId: string | null;
  sections: SectionDraft[];
};

/** What the kind is called on screen, and what it means in one line. */
const KIND_META: Record<Kind, { label: string; hint: string }> = {
  REPO: {
    label: "GitHub repository",
    hint: "Generated from a template. The student opens a pull request, and the pipeline grades it.",
  },
  GOOGLE_DRIVE: {
    label: "Google Drive",
    hint: "Students take their own copy of a template Doc, Sheet, or Slides deck and submit the link. Graded by hand.",
  },
  FILE_UPLOAD: {
    label: "File upload",
    hint: "Students hand in a file. No template and nothing to accept. Graded by hand.",
  },
  EXTERNAL_URL: {
    label: "External URL",
    hint: "Students make something on another service — Canva, Loom, a deployed site — and submit the link. No template and nothing to accept. Graded by hand.",
  },
};

/** True when this kind has a repository, a template, and a suite that can run. */
function isRepoKind(kind: Kind): boolean {
  return kind === "REPO";
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
    courseUnitId: state.courseUnitId,
    completionThreshold: state.completionThreshold,
    dueAt: state.dueAt,
    sections: state.sections,
    // Empty is absent. A textarea an instructor cleared should read as no instructions
    // rather than as instructions that happen to be blank.
    submissionInstructions: state.submissionInstructions.trim() || null,
    teamSetId: state.teamSetId,
  };

  if (state.kind === "REPO") {
    return {
      ...shared,
      kind: "REPO",
      /*
        Both sent as typed. The schema normalizes them, so a pasted URL and a typed
        owner/repo are the same value by the time anything checks or stores one — and
        normalizing here as well would mean two implementations of the same rule, with the
        server's being the one that decides.
      */
      templateRepo: state.templateRepo,
      answerKeyRepo: state.answerKeyRepo,
      answerKeyDir: state.answerKeyDir,
      assignmentRepoName: state.assignmentRepoName,
      githubOrg: state.githubOrg,
      templateRef: state.templateRef,
      runnerPreset: state.runnerPreset,
      runnerConfig: state.runnerConfig,
    };
  }

  if (state.kind === "GOOGLE_DRIVE") {
    return { ...shared, kind: "GOOGLE_DRIVE", templateDriveUrl: state.templateDriveUrl.trim() };
  }

  if (state.kind === "FILE_UPLOAD") {
    return {
      ...shared,
      kind: "FILE_UPLOAD",
      acceptedFileTypes: state.acceptedFileTypes,
    };
  }

  // Nothing of its own to send. What the student is asked to make, and where, is prose in
  // `submissionInstructions` rather than a field — see the schema's own note on why there is no
  // column for a starting link.
  return { ...shared, kind: "EXTERNAL_URL" };
}

const DEBOUNCE_MS = 600;

/**
 * Where the reference solution browser starts, and where it returns to when the answer key
 * repository changes.
 *
 * The grading guides repository holds the answer keys under `answer-keys/`, and its root holds
 * other things — the grading toolkit among them. Starting the browser one level in means an
 * instructor walking to an assignment's folder begins where the modules are listed rather than
 * scrolling past directories no assignment ever names.
 *
 * A starting point, not a rule. The schema accepts a folder at any depth, including the root,
 * and the breadcrumb above the listing still reaches it in one click — which is what a
 * repository holding a single assignment's solutions and nothing else needs.
 */
const ANSWER_KEYS_START_DIR = "answer-keys";

export function AssignmentForm({
  courseId,
  existing,
  initialCourseUnitId,
}: {
  courseId: string;
  /** Absent when creating. */
  existing?: Draft;
  /**
   * The unit this assignment is being written into, from `?unit=`.
   *
   * A starting value for the unit selector rather than a lock: the form opened from inside a
   * project on the Curriculum screen arrives with it chosen, and an instructor who changes their
   * mind can still pick another. Ignored when editing, since an existing assignment already
   * carries its own answer.
   */
  initialCourseUnitId?: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const context = useQuery(trpc.assignments.authoringContext.queryOptions({ courseId }));

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
      initialCourseUnitId={initialCourseUnitId}
      onSaved={(assignmentId) => {
        /*
          To the Curriculum screen, which is where an instructor sees the result in context —
          the new row, its draft badge, and its place inside the unit it belongs to.

          Written as the bare course address until the cohort's views became seven addresses,
          at which point that address stopped being a page and became a redirect to Settings.
          So saving an assignment landed on the cohort's name and slug, with nothing on screen
          to say the save had worked but a toast that was already fading. The lesson is the
          reason `lib/links.ts` exists: an address assembled from a template does not move when
          the routes do, and this was the one place still assembling one by hand.
        */
        router.push(curriculumHref(courseId));
        void assignmentId;
      }}
    />
  );
}

function Editor({
  courseId,
  context,
  existing,
  initialCourseUnitId,
  onSaved,
}: {
  courseId: string;
  context: Context;
  existing?: Draft;
  initialCourseUnitId?: string;
  onSaved: (assignmentId: string) => void;
}) {
  const trpc = useTRPC();

  /**
   * The course's units in the order the instructor put them, which is one sequence across all
   * three categories — the same order the Curriculum screen and a student's course page show.
   *
   * Sorted here rather than trusted from the payload, because the select groups them by category
   * below and a group's items have to stay in course order within it.
   */
  const units = React.useMemo(
    () => [...context.course.courseUnits].sort(compareByPosition),
    [context.course.courseUnits],
  );

  /**
   * Which unit this belongs to.
   *
   * Held outside `state` for the reason `kind` is: the form reads it while deciding what else to
   * show, and an existing assignment always has one because the column is not nullable.
   */
  const [courseUnitId, setCourseUnitId] = React.useState<string>(
    existing?.courseUnitId ?? initialCourseUnitId ?? units[0]?.id ?? "",
  );

  /*
    The draft lives here rather than a level up, because it can only be built once the
    authoring context has loaded: a new repository assignment starts with this course's own
    organization and answer-key repository already filled in, and neither is known before
    then. `Editor` renders only after that, so the initial value is a real starting draft
    rather than a null the form has to render around.
  */
  /*
    The time of day a due date was last set to, so that clearing the date and choosing another
    does not quietly reset a deliberate 5pm deadline to 11:59pm. It is a ref rather than state
    because nothing renders from it — the two due date inputs both read the stored instant, and
    this is consulted only when there is no instant to read a time from.
  */
  const lastDueClock = React.useRef<SchoolClock>(
    existing?.dueAt ? schoolClockOf(existing.dueAt) : END_OF_DAY,
  );

  const [state, setState] = React.useState<FormState | null>(() =>
    existing
      ? fromDraft(existing)
      : blankDraft({
          kind: "REPO",
          courseUnitId: initialCourseUnitId ?? units[0]?.id ?? "",
          defaults: {
            githubOrg: context.defaultGithubOrg,
            answerKeyRepo: context.defaultAnswerKeyRepo,
          },
          existingState: null,
        }),
  );

  /**
   * The chosen team set, for the readout under the select. Null for individual work.
   *
   * After `state` rather than beside `units`, which is where it started and where `.find` ran its
   * callback while `state` was still in its temporal dead zone. TypeScript allows a closure to
   * name a later `const`, and `.find` calls that closure immediately — so it typechecked and would
   * have thrown on the first render.
   */
  const chosenTeamSet = context.teamSets.find((set) => set.id === state?.teamSetId) ?? null;

  // Held outside `state` because a kind can be chosen before the rest of the form is filled
  // in, and switching it rebuilds the draft into that kind's shape.
  const [kind, setKind] = React.useState<Kind>((existing?.kind as Kind) ?? "REPO");

  // What the server has been asked about. Trails the form by DEBOUNCE_MS so that typing a
  // point value does not make a GitHub request per keystroke.
  const [settled, setSettled] = React.useState<FormState | null>(state);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(state), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  /*
    Read off the *settled* draft, so the listing does not issue a request per keystroke while a
    URL is being pasted.
  */
  const answerKeyRepo = isRepoKind(kind) ? (settled?.answerKeyRepo ?? "") : "";
  const answerKeyDir = state?.answerKeyDir ?? "";

  /*
    What the named directory resolves to: the files grading will read, and what it skipped.

    Read-only. Nothing is chosen here — the folder *is* the answer, and this says what naming
    it means. It is the same function `loadGradingAssets` calls at grading time, so what an
    instructor is shown is what the model will be given rather than a second opinion about it.
  */
  const answerKeys = useQuery({
    ...trpc.assignments.answerKeyPreview.queryOptions({
      courseId,
      answerKeyRepo,
      dir: settled?.answerKeyDir ?? "",
    }),
    enabled: answerKeyRepo.length > 0,
  });

  /*
    What the template says about how it runs, applied once rather than asked for.

    Keyed on the template rather than on the repository name, which is what it is actually
    about — and guarded on having already been applied for that template, so an instructor
    who deliberately set the runner to something else does not have it overwritten on the
    next keystroke.
  */
  const detection = useQuery({
    ...trpc.assignments.inferFromTemplate.queryOptions({
      courseId,
      templateRepo: settled?.templateRepo ?? "",
    }),
    enabled: !existing && Boolean(settled?.templateRepo),
  });

  const applied = React.useRef<{ runner?: string; pasted?: string }>({});

  /*
    A pasted address that points inside the repository *is* the answer.

    `https://github.com/org/guides/tree/main/answer-keys/mod-1-js-fundamentals/swe-1-2-…` says
    both which repository and which folder, and every file under that folder is the reference
    set — so pasting the address of the folder an instructor already has open finishes the
    question rather than starting a search.

    Two cases, and they differ:

    - The address carries a path: take it.
    - It does not, but names a *different* repository than before: reset to the starting
      folder, because a directory from the previous repository almost certainly does not exist
      in this one.

    Otherwise the directory is left alone, so an instructor who navigated somewhere keeps that
    place rather than being pulled back by an unrelated keystroke. Guarded on the exact pasted
    string, so this settles once per paste.
  */
  React.useEffect(() => {
    const pasted = settled?.answerKeyRepo;
    if (pasted === undefined || applied.current.pasted === pasted) return;
    const previous = applied.current.pasted;
    applied.current.pasted = pasted;

    const within = repoPathFromRef(pasted);
    const changedRepository =
      previous !== undefined && normalizeRepoRef(previous) !== normalizeRepoRef(pasted);

    if (within) setState((prev) => (prev ? { ...prev, answerKeyDir: within } : prev));
    else if (changedRepository) {
      setState((prev) => (prev ? { ...prev, answerKeyDir: ANSWER_KEYS_START_DIR } : prev));
    }
  }, [settled?.answerKeyRepo, setState]);

  React.useEffect(() => {
    const template = settled?.templateRepo;
    if (!template || !detection.data?.confident) return;
    if (applied.current.runner === template) return;

    applied.current.runner = template;
    setState((prev) => (prev ? { ...prev, runnerPreset: detection.data.preset } : prev));
  }, [detection.data, settled?.templateRepo, setState]);

  /*
    The repository name follows the template's own name until somebody edits it.

    A suggestion rather than a derivation: it names every student's repository, so an
    instructor who wants `swe-1-4-loops` from a template called `1-4-loops-starter` has to be
    able to say so. Applied only while the field is empty, which is what makes it a default
    rather than something that fights the person typing.
  */
  React.useEffect(() => {
    const template = settled?.templateRepo;
    if (existing || !template) return;
    const suggested = repoNameFromRef(template);
    if (!suggested) return;
    setState((prev) =>
      prev && prev.assignmentRepoName === "" ? { ...prev, assignmentRepoName: suggested } : prev,
    );
  }, [settled?.templateRepo, existing, setState]);

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
  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const fieldFindings = (path: string) => findings.filter((finding) => finding.path === path);

  /*
    Creating says nothing on success and leaves nowhere on its own, unlike `update` below. Handing
    the assignment out is a second write, so what to say and where to go are only known once both
    have been attempted — see `createAssignment`.
  */
  const create = useMutation(
    trpc.assignments.create.mutationOptions({
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
  /*
    No `onError` of its own: a failure here is reported by `createAssignment` together with the
    fact that the assignment was created anyway, which is the part the instructor needs to know.
  */
  const publish = useMutation(trpc.assignments.publish.mutationOptions({}));

  const busy = create.isPending || update.isPending || publish.isPending;
  // Deliberately not "no errors": a draft the server has not seen yet has no findings, which
  // is not the same as being valid. Saving is refused until the settled draft has been checked.
  const checked = settled === state && validation.isSuccess;
  const canSave = state !== null && checked && errors.length === 0 && !busy;

  const pointTotal = (state?.sections ?? []).reduce(
    (total, section) => total + (Number.isFinite(section.pointValue) ? section.pointValue : 0),
    0,
  );

  /**
   * Creates the assignment, and hands it out when that is what was asked for.
   *
   * **Two writes rather than one**, because publishing is its own procedure and an assignment is
   * created unpublished by design — a draft is the state every assignment passes through, and
   * `distributedAt` is what a student's listing reads. "Create and publish" is not a different
   * kind of creation; it is the two operations an instructor otherwise performs a screen apart.
   *
   * **A publish that fails still leaves for the Curriculum screen**, and this is the case worth
   * being deliberate about. The assignment exists by then. Staying on the form would leave an
   * instructor looking at fields they have already saved, where pressing the button again makes a
   * second copy; the Curriculum screen shows the draft that was made, with Publish on its row.
   */
  async function createAssignment(distribute: boolean) {
    if (!state) return;

    let created;
    try {
      created = await create.mutateAsync({ courseId, draft: toDraft(state) });
    } catch {
      // `create`'s own handler named the reason. Nothing was written, and the form is untouched
      // and can be submitted again once it is fixed.
      return;
    }

    const { assignment } = created;

    if (!distribute) {
      toast.success(`Created ${assignment.title}. It is not visible to students yet.`);
    } else {
      try {
        await publish.mutateAsync({ assignmentId: assignment.id });
        toast.success(`Created ${assignment.title} and published it to your students.`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Publishing did not go through.";
        toast.error(`Created ${assignment.title} as a draft. It was not published: ${reason}`);
      }
    }

    onSaved(assignment.id);
  }

  const runnerNames = [NO_RUNNER, ...Object.keys(RUNNER_PRESETS)];

  // Which mode this assignment is already committed to, so only that one is offered.
  const hasAiSection = (state?.sections ?? []).some((section) => section.grading === "ai");
  const hasManualSection = (state?.sections ?? []).some((section) => section.grading === "manual");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={existing ? `Edit ${existing.title}` : "New assignment"}
        description={`${context.course.name} · ${context.course.cohortTerm}`}
        /*
          The point total, and nothing to press. It is a readout of what the sections below add up
          to, which is worth seeing while they are edited; the button that commits them is at the
          foot of the form, after the fields it writes.
        */
        actions={
          state && (
            <Badge variant="outline" className="font-normal tabular-nums">
              {pointTotal} pts
            </Badge>
          )
        }
      />

      {/* ---- Which assignment ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Which assignment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/*
            The first question, because it decides everything after it: whether there are
            repositories and a runner at all, and whether the pipeline can grade this. Locked
            once the assignment exists — changing the kind of a saved assignment would change
            what its existing submissions are, and there is no migration from a pull request
            to a document.
          */}
          <Field
            label="Kind"
            findings={fieldFindings("kind")}
            hint={
              existing
                ? "Fixed once an assignment exists. Create a new one to hand work in a different way."
                : KIND_META[state?.kind ?? kind].hint
            }
          >
            {existing ? (
              <Input value={KIND_META[existing.kind as Kind].label} disabled />
            ) : (
              <Select
                value={kind}
                onValueChange={(value) => {
                  const next = (value ?? "REPO") as Kind;
                  setKind(next);
                  setState(
                    blankDraft({
                      kind: next,
                      courseUnitId,
                      defaults: {
                        githubOrg: context.defaultGithubOrg,
                        answerKeyRepo: context.defaultAnswerKeyRepo,
                      },
                      existingState: state,
                    }),
                  );
                }}
                // Without this the trigger shows the raw enum value — `FILE_UPLOAD` — while the
                // list it was chosen from showed "File upload". Base UI's trigger renders the
                // value, not the item, so a select whose label differs from its value has to say
                // how they map. The module select below needs it for the same reason; the runner
                // preset does not, because there each label *is* its value.
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
            Which module, project, or assessment this belongs to.

            **One question where there were two.** An assignment used to name a module and then,
            separately, the project it was a part of — and the second answer overrode the first,
            so the form showed a module field it was going to ignore. All three are course units
            now, so there is one parent to choose and no rule reconciling two answers.

            A course with no units cannot hold an assignment, and the foreign key says so. Stated
            rather than shown as an empty select, which would read as a loading failure.
          */}
          {units.length === 0 ? (
            <Field label="Belongs to" findings={fieldFindings("courseUnitId")}>
              <Alert>
                <AlertTriangle />
                <AlertTitle>This course has nothing to put an assignment in yet</AlertTitle>
                <AlertDescription>
                  Every assignment belongs to a module, a project, or an assessment. Create one on
                  the Curriculum screen, then come back.
                </AlertDescription>
              </Alert>
            </Field>
          ) : (
            <Field
              label="Belongs to"
              findings={fieldFindings("courseUnitId")}
              hint="A module, a project, or an assessment."
            >
              <Select
                value={courseUnitId}
                onValueChange={(value) => {
                  // Base UI reports null when a select is cleared; there is no cleared state
                  // here, so an empty string keeps the rest of the form's types honest.
                  const next = value ?? "";
                  setCourseUnitId(next);
                  setState((prev) => (prev ? { ...prev, courseUnitId: next } : prev));
                }}
                // The trigger renders the value, which is a uuid. Without this it would show one.
                items={Object.fromEntries(units.map((row) => [row.id, row.name]))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose where this belongs" />
                </SelectTrigger>
                <SelectContent>
                  {/*
                    Grouped by category rather than listed in one sequence, so that a course with
                    twenty modules and one project does not bury the project in the middle of
                    them. Within a group the course's own order is kept, which is the order the
                    instructor arranged and the order a student meets the work in.

                    A category with no units contributes no heading. An empty "Assessments"
                    label would suggest the list had failed to load rather than that the course
                    has no assessments yet.
                  */}
                  {UNIT_CATEGORIES.map((category) => {
                    const inCategory = units.filter((row) => row.category === category);
                    if (inCategory.length === 0) return null;

                    return (
                      <SelectGroup key={category}>
                        <SelectLabel>{CATEGORY_META[category].unitsLabel}</SelectLabel>
                        {inCategory.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {row.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
          )}

          {/* Typed, for every kind. It is what a student sees in their list. */}
          <Field
            label="Title"
            findings={fieldFindings("title")}
            hint="What students see in their list."
          >
            <Input
              value={state?.title ?? ""}
              onChange={(event) =>
                setState((prev) => (prev ? { ...prev, title: event.target.value } : prev))
              }
            />
          </Field>

          {/*
            Whether a team hands this in, asked here because it belongs with "which assignment is
            this" rather than with how the work arrives: a team hands in a document, a file, a link
            or a repository, and which of those it is changes where the work lives rather than
            whether it belongs to a team.

            Frozen once published, and the hint says so — the same rule Kind above uses. Turning it
            on afterwards would force a choice of whose work survives out of however many students
            had already submitted separately; turning it off would leave every member but one
            holding a grade whose feedback history belonged to somebody else's submission.
          */}
          {state && (
            <Field
              label="Handed in by"
              findings={fieldFindings("teamSetId")}
              hint={
                context.teamSets.length === 0
                  ? "Make a team set on the roster to hand an assignment in by teams."
                  : existing?.distributedAt
                    ? "Fixed once the assignment is published. Create a new one to change it."
                    : "One piece of work per team, and one grade, shared by everybody on it."
              }
            >
              <div className="flex flex-col gap-2">
                <Select
                  value={state.teamSetId ?? INDIVIDUAL_WORK}
                  disabled={context.teamSets.length === 0 || Boolean(existing?.distributedAt)}
                  onValueChange={(value) =>
                    setState((prev) =>
                      prev
                        ? {
                            ...prev,
                            teamSetId: !value || value === INDIVIDUAL_WORK ? null : String(value),
                          }
                        : prev,
                    )
                  }
                  items={{
                    [INDIVIDUAL_WORK]: "Each student, on their own",
                    ...Object.fromEntries(context.teamSets.map((set) => [set.id, set.name])),
                  }}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INDIVIDUAL_WORK}>Each student, on their own</SelectItem>
                    {context.teamSets.map((set) => (
                      <SelectItem key={set.id} value={set.id}>
                        {set.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/*
                  The readout, and the second number is the one that matters: a fellow on no team
                  of this set has nothing to accept at all, and this is the last screen that can
                  say so before students see the assignment.
                */}
                {chosenTeamSet && (
                  <p className="text-xs text-muted-foreground">
                    {chosenTeamSet.teamCount} {chosenTeamSet.teamCount === 1 ? "team" : "teams"} ·{" "}
                    {chosenTeamSet.placedCount}{" "}
                    {chosenTeamSet.placedCount === 1 ? "fellow" : "fellows"} placed
                    {chosenTeamSet.unplacedCount > 0 && (
                      <span className="text-amber-600 dark:text-amber-500">
                        {" "}
                        · {chosenTeamSet.unplacedCount} on no team, who will have nothing to accept
                      </span>
                    )}
                  </p>
                )}
              </div>
            </Field>
          )}
        </CardContent>
      </Card>

      {/*
        A skeleton rather than instructions, because there is nothing to instruct: the draft is
        built when this component mounts, so `null` is a state the form passes through for no
        frames rather than one an instructor is meant to act on. It used to be where a
        repository assignment waited for a catalogue choice.
      */}
      {state === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {/* ---- Repositories --------------------------------------------- */}
          {isRepoKind(state.kind) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Repositories</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field
                  label="Template repository"
                  findings={fieldFindings("templateRepo")}
                  hint="Paste its URL. It has to be marked as a template repository on GitHub, and readable by this deployment's App — which any public repository is, wherever it lives."
                >
                  <Input
                    value={state.templateRepo}
                    placeholder="https://github.com/owner/swe-1-4-loops"
                    onChange={(event) => setState({ ...state, templateRepo: event.target.value })}
                  />
                  <NormalizedAs value={state.templateRepo} />
                </Field>

                <Field
                  label="Answer key repository"
                  findings={fieldFindings("answerKeyRepo")}
                  hint="Paste its URL — including the path to the folder holding this assignment's solutions, if you have it open. Private, and in an organization the GitHub App is installed on: this holds the reference solutions, so it must not be readable by students."
                >
                  <Input
                    value={state.answerKeyRepo}
                    placeholder="https://github.com/owner/swe-assignment-grading-guides"
                    onChange={(event) => setState({ ...state, answerKeyRepo: event.target.value })}
                  />
                  <NormalizedAs value={state.answerKeyRepo} showPath />
                </Field>

                {/*
                  The folder, and what naming it means.

                  Every file under it is the reference set — nothing is selected. So this shows
                  the resolved list rather than offering one: the same function grading calls,
                  so what an instructor reads here is what the model will be given, and a
                  reference file added to the folder later is used without anybody returning to
                  this screen.
                */}
                <Field
                  label="Reference solutions"
                  findings={fieldFindings("answerKeyDir")}
                  hint="Every file under this folder, at any depth, is sent to the model as reference — never shown to the student. Paste the folder's address above, or walk to it here."
                >
                  <AnswerKeyBrowser
                    courseId={courseId}
                    answerKeyRepo={state.answerKeyRepo}
                    dir={answerKeyDir}
                    onNavigate={(dir) => setState({ ...state, answerKeyDir: dir })}
                    resolved={answerKeys.data ?? null}
                    loading={answerKeys.isFetching}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Organization"
                    findings={fieldFindings("githubOrg")}
                    hint="Where each student's repository is created."
                  >
                    <Input
                      value={state.githubOrg}
                      onChange={(event) => setState({ ...state, githubOrg: event.target.value })}
                    />
                  </Field>

                  <Field
                    label="Repository name"
                    findings={fieldFindings("assignmentRepoName")}
                    hint={
                      existing && existing.submissionCount > 0
                        ? `${existing.submissionCount} student(s) have accepted this. Their repositories are named after it, so it cannot be changed.`
                        : "Each student gets {this}-{their github login}. Follows the template’s name until you change it."
                    }
                  >
                    <Input
                      value={state.assignmentRepoName}
                      disabled={Boolean(existing && existing.submissionCount > 0)}
                      onChange={(event) =>
                        setState({ ...state, assignmentRepoName: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---- What students see ---------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What students see</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/*
                Two inputs for one instant. Picking a date sets the time to 11:59pm, which is
                what almost every deadline is, and the instructor changes it from there. Clearing
                the date clears the whole due date: an assignment with no deadline is an ordinary
                thing and this is how it is said.
              */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Due date"
                  findings={fieldFindings("dueAt")}
                  hint="Optional. Leave it blank for no due date. A late submission is recorded as late, never refused."
                >
                  <Input
                    type="date"
                    value={state.dueAt ? schoolDayOf(state.dueAt) : ""}
                    onChange={(event) =>
                      setState({
                        ...state,
                        dueAt: event.target.value
                          ? instantAtSchoolClock(
                              event.target.value,
                              dueClockOf(state.dueAt, lastDueClock.current),
                            )
                          : null,
                      })
                    }
                  />
                </Field>
                <Field
                  label="Due time"
                  hint={
                    state.dueAt
                      ? "New York time, which is the timezone every date on every screen is shown in."
                      : "Set a date first. The time then starts at 11:59pm."
                  }
                >
                  <Input
                    type="time"
                    disabled={state.dueAt === null}
                    value={state.dueAt ? schoolClockOf(state.dueAt) : ""}
                    onChange={(event) => {
                      const clock = event.target.value || END_OF_DAY;
                      lastDueClock.current = clock;
                      setState({
                        ...state,
                        dueAt: state.dueAt
                          ? instantAtSchoolClock(schoolDayOf(state.dueAt), clock)
                          : null,
                      });
                    }}
                  />
                </Field>
              </div>

              {state.kind === "GOOGLE_DRIVE" && (
                <Field
                  label="Template file"
                  findings={fieldFindings("templateDriveUrl")}
                  hint="A Doc, a Sheet, or a Slides deck. Accepting sends the student to Google's own prompt to take a copy, built from this link. Paste the sharing link — it should end in /view or /edit."
                >
                  <Input
                    value={state.templateDriveUrl}
                    placeholder="https://docs.google.com/presentation/d/…/edit"
                    onChange={(event) =>
                      setState({ ...state, templateDriveUrl: event.target.value })
                    }
                  />
                </Field>
              )}

              {/*
                Checkboxes from a fixed list rather than a text field, for the reason the runner
                preset is a select: a typo'd MIME type is not an error an instructor sees, it is
                a student being told their correct file is the wrong kind, on the due date.
              */}
              {state.kind === "FILE_UPLOAD" && (
                <Field
                  label="What students may hand in"
                  findings={fieldFindings("acceptedFileTypes")}
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
                            {extensionsOf(key).join(" ")}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Field>
              )}

              <Field
                label="Submission instructions"
                findings={fieldFindings("submissionInstructions")}
                hint={
                  isRepoKind(state.kind)
                    ? "Optional, in markdown. The draft-branch-and-pull-request steps are already shown, so this is for anything specific to this assignment."
                    : "Optional, in markdown. How to hand the work in — this kind has no ritual of its own, so anything the student needs to know goes here."
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
                  findings={fieldFindings("runnerPreset")}
                  hint={
                    detection.data?.reason
                      ? `${detection.data.reason} The tests come from the template repository, never the student’s copy.`
                      : state.runnerPreset === NO_RUNNER
                        ? "No automated tests. Normal for short response and frontend work — most of the program."
                        : "The tests come from the template repository, never the student’s copy."
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

              {state.sections.map((section, index) => (
                <SectionEditor
                  key={index}
                  section={section}
                  index={index}
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

              {fieldFindings("sections").map((finding, index) => (
                <p key={index} className="text-xs text-destructive">
                  {finding.message}
                </p>
              ))}

              {/*
                One grading mode per assignment. A mixed assignment is refused by the schema —
                the pipeline would report on some of its sections and not others, and the
                assignment's point total would exceed what approving could record — so a second
                section can only ever be added in the mode this assignment is already in.

                Which leaves the other mode to offer as a *switch* rather than as an addition,
                and a repository assignment is offered both directions. It starts graded by
                hand — a repository nobody wants a report on is still a repository, and that is
                the more common of the two — so the switch an instructor reaches for is the one
                that asks the model to grade it. Each button says what it does: it replaces the
                sections above with a single one in the other mode, and the button beside it
                goes back.

                A kind with no repository has nothing for the pipeline to read, so hand grading
                is its only mode and no switch is offered.
              */}
              <div className="flex flex-wrap gap-2">
                {isRepoKind(state.kind) && !hasManualSection && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setState({
                        ...state,
                        sections: [...state.sections, aiSection({ rubrics: context.rubrics })],
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
                      setState({ ...state, sections: [...state.sections, manualSection()] })
                    }
                  >
                    <Plus data-icon="inline-start" />
                    Section graded by hand
                  </Button>
                )}
                {isRepoKind(state.kind) && hasAiSection && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setState({ ...state, sections: [manualSection()] })}
                  >
                    <PencilLine data-icon="inline-start" />
                    Grade this by hand instead
                  </Button>
                )}
                {isRepoKind(state.kind) && hasManualSection && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setState({ ...state, sections: [aiSection({ rubrics: context.rubrics })] })
                    }
                  >
                    <Sparkles data-icon="inline-start" />
                    Have the model grade this instead
                  </Button>
                )}
              </div>

              {isRepoKind(state.kind) && hasManualSection && (
                <p className="text-xs text-muted-foreground">
                  This assignment is graded by hand, so no report is generated for it.
                </p>
              )}

              {isRepoKind(state.kind) && hasAiSection && (
                <p className="text-xs text-muted-foreground">
                  An assignment is graded one way or the other, never both. Switching to hand
                  grading replaces the sections above with a single one you score yourself.
                </p>
              )}
            </CardContent>
          </Card>

          <Findings errors={errors} warnings={warnings} checking={!checked} />

          {/*
            At the end, after every field it commits and after the findings that say why it is
            disabled.

            In the header it was the first thing on the screen and the last thing that made sense:
            an instructor met "Create" before being asked what they were creating, and a disabled
            button at the top with its explanation at the bottom is a question answered three
            screens away from where it is asked. Here the order reads: fill this in, here is what
            is still wrong with it, now create it.
          */}
          {/*
            Editing an existing assignment saves it and says nothing about publishing: whether
            students can see it is already decided, and its row on the Curriculum screen is where
            that is changed. Creating one decides both at once, so both are offered.
          */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {existing ? (
              <Button
                disabled={!canSave}
                onClick={() => {
                  if (!state) return;
                  update.mutate({ assignmentId: existing.id, draft: toDraft(state) });
                }}
              >
                {busy ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                Save
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={!canSave}
                  onClick={() => void createAssignment(false)}
                >
                  {busy ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Save data-icon="inline-start" />
                  )}
                  Create Draft
                </Button>
                {/*
                  The primary of the two, and not guarded by a confirmation. Publishing is one
                  click from the assignment's own row and "Hide from students" is one click back
                  from it, which is a cheaper undo than a dialog is a warning.
                */}
                <Button disabled={!canSave} onClick={() => void createAssignment(true)}>
                  {busy ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Eye data-icon="inline-start" />
                  )}
                  Create and Publish
                </Button>
              </>
            )}
          </div>
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
            {errors.length === 1 ? "One thing to fix" : `${errors.length} things to fix`}
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

/**
 * What a pasted repository reference will actually be stored as, and where it pointed.
 *
 * Shown rather than rewriting the field as it is typed. Rewriting a URL to `owner/repo`
 * mid-paste moves the caret and reads as the form fighting the person; saying what it means
 * underneath answers the same question — did it understand what I pasted — without touching
 * what they typed. Absent when the field already is `owner/repo`, since repeating it back
 * would be noise.
 *
 * The directory is reported separately because it is a separate fact: the repository is what
 * gets stored, and the path is only where the listing below starts. `showPath` is off for the
 * template, where an address copied from a subdirectory means nothing.
 */
function NormalizedAs({ value, showPath = false }: { value: string; showPath?: boolean }) {
  const parsed = parseRepoRef(value);
  if (!parsed || parsed.fullName === value.trim()) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Stored as <code>{parsed.fullName}</code>
      {showPath && parsed.path !== "" && (
        <>
          , opening at <code>{parsed.path}</code>
        </>
      )}
    </p>
  );
}

/**
 * The folder whose contents are the reference solutions, and what those turn out to be.
 *
 * Two jobs in one control, because they are one question. The breadcrumb and the subdirectory
 * buttons are how a folder is reached when its address was not pasted; the list underneath is
 * what naming that folder means. **Nothing here is a choice** — the files are shown, not
 * offered, because every one of them is used.
 *
 * That is what makes the list worth showing rather than a count. "17 files" says nothing about
 * whether the right folder was named; seeing `from-scratch.js`, `modify.js`, `debug.js` says it
 * immediately, and seeing `solutions.zip — an archive` in the skipped line says the exclusion
 * happened rather than leaving it to be assumed.
 *
 * A repository that cannot be read shows nothing and says nothing here. The validation findings
 * beneath the form explain why, and they distinguish a name that is wrong from an organization
 * the App was never installed on, which this could not.
 */
function AnswerKeyBrowser({
  courseId,
  answerKeyRepo,
  dir,
  onNavigate,
  resolved,
  loading,
}: {
  courseId: string;
  answerKeyRepo: string;
  dir: string;
  onNavigate: (dir: string) => void;
  /** What the folder resolves to, from the same function grading calls. */
  resolved: {
    paths: string[];
    excluded: { path: string; reason: string }[];
    missing: boolean;
    limit: number;
  } | null;
  loading: boolean;
}) {
  const trpc = useTRPC();
  const normalized = parseRepoRef(answerKeyRepo)?.fullName ?? null;

  const listing = useQuery({
    ...trpc.assignments.browseAnswerKeys.queryOptions({
      courseId,
      answerKeyRepo: normalized ?? "",
      dir,
    }),
    enabled: Boolean(normalized),
  });

  if (!normalized) {
    return (
      <p className="text-sm text-muted-foreground">
        Name an answer key repository above and its folders appear here.
      </p>
    );
  }

  const segments = dir === "" ? [] : dir.split("/");
  const dirs = (listing.data?.entries ?? []).filter((entry) => entry.type === "dir");

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-3">
      {/* Every ancestor is clickable, so going back up is one click rather than several. */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 font-mono hover:bg-accent"
          onClick={() => onNavigate("")}
        >
          {normalized}
        </button>
        {segments.map((segment, index) => (
          <React.Fragment key={index}>
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 font-mono hover:bg-accent"
              onClick={() => onNavigate(segments.slice(0, index + 1).join("/"))}
            >
              {segment}
            </button>
          </React.Fragment>
        ))}
      </div>

      {listing.isPending ? (
        <Skeleton className="h-8 w-full" />
      ) : listing.data?.entries === null ? (
        <p className="text-sm text-muted-foreground">
          There is no <code>{dir}</code> in this repository. It may have been renamed.
        </p>
      ) : dirs.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {dirs.map((entry) => (
            <Button
              key={entry.name}
              type="button"
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={() => onNavigate(dir === "" ? entry.name : `${dir}/${entry.name}`)}
            >
              {entry.name}
            </Button>
          ))}
        </div>
      ) : null}

      {/* What will actually be sent. Shown, not offered. */}
      {loading || resolved === null ? (
        <p className="text-xs text-muted-foreground">Reading this folder…</p>
      ) : resolved.missing ? (
        <p className="text-xs text-muted-foreground">This folder is not in the repository.</p>
      ) : resolved.paths.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing here can be used as a reference solution. The assignment can still be graded, with
          the model reading the code against the rubric alone.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {resolved.paths.length === 1
              ? "1 reference file, sent to the model:"
              : `${resolved.paths.length} reference files, sent to the model:`}
          </p>
          <ul className="flex flex-col gap-0.5">
            {resolved.paths.map((path) => (
              // Relative to the folder, because the folder is already named in the breadcrumb
              // above and repeating it on every row makes the shape of the set harder to read.
              <li key={path} className="font-mono text-xs text-muted-foreground">
                {dir === "" ? path : path.slice(dir.length + 1)}
              </li>
            ))}
          </ul>
          {resolved.paths.length > resolved.limit && (
            <p className="text-xs text-destructive">
              Only the first {resolved.limit} would be used. Name a folder further down.
            </p>
          )}
        </div>
      )}

      {resolved !== null && resolved.excluded.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Skipped:{" "}
          {resolved.excluded
            .map(
              (entry) =>
                `${dir === "" ? entry.path : entry.path.slice(dir.length + 1)} (${entry.reason})`,
            )
            .join(", ")}
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

/**
 * What a new section is worth until an instructor says otherwise.
 *
 * One point, because there is no number a form can guess that is right more often than it is
 * wrong, and a wrong guess that looks deliberate is worse than an obvious placeholder. Thirty
 * points reads as a decision somebody made; one point reads as a field waiting to be filled
 * in, which is what it is.
 */
const DEFAULT_POINT_VALUE = 1;

/** A new AI-graded section, with the rubric already matched to its type. */
function aiSection({ rubrics }: { rubrics: { id: string; name: string }[] }): SectionDraft {
  const type = "coding_algorithm" as const;
  return {
    grading: "ai",
    type,
    pointValue: DEFAULT_POINT_VALUE,
    rubricId: rubrics.find((r) => r.name === SECTION_TYPE_REGISTRY[type].rubricName)?.id ?? "",
    reportTemplate: "coding-fluency",
  };
}

/** A new hand-graded section. Unnamed, because what it is called is the instructor's to say. */
function manualSection(): SectionDraft {
  return { grading: "manual", label: "", pointValue: DEFAULT_POINT_VALUE };
}

/**
 * A starting draft for a kind.
 *
 * One per kind rather than one for repository assignments and one for the rest, because
 * there is no longer a catalogue for a repository assignment to be opened from — every kind
 * starts from an empty form and the two repositories are pasted in.
 *
 * What was already typed carries across, so choosing the kind twice while deciding does not
 * lose a title. The defaults for the organization and the answer-key repository come from
 * this course's other repository assignments, which is where they are almost always the same.
 */
function blankDraft({
  kind,
  courseUnitId,
  defaults,
  existingState,
}: {
  kind: Kind;
  /** The unit it goes in, kept across a change of kind. */
  courseUnitId: string;
  defaults: { githubOrg: string | null; answerKeyRepo: string | null };
  existingState: FormState | null;
}): FormState {
  const repo = kind === "REPO";

  return {
    kind,
    title: existingState?.title ?? "",
    courseUnitId,
    completionThreshold: existingState?.completionThreshold ?? 0.75,
    dueAt: existingState?.dueAt ?? null,
    templateRepo: repo ? (existingState?.templateRepo ?? "") : "",
    answerKeyRepo: repo ? existingState?.answerKeyRepo || defaults.answerKeyRepo || "" : "",
    // Where the answer keys live until an address with a path is pasted, or a folder is
    // chosen below.
    answerKeyDir: repo ? (existingState?.answerKeyDir ?? ANSWER_KEYS_START_DIR) : "",
    // Follows the template's own name once one is named — see the effect in `Editor`.
    assignmentRepoName: repo ? (existingState?.assignmentRepoName ?? "") : "",
    githubOrg: repo ? existingState?.githubOrg || defaults.githubOrg || "" : "",
    templateRef: null,
    runnerPreset: NO_RUNNER,
    runnerConfig: null,
    templateDriveUrl: existingState?.templateDriveUrl ?? "",
    // Ticked rather than empty, because every file-upload assignment needs at least one and a
    // PDF is what almost all of them want. An instructor changes it; they cannot forget it.
    acceptedFileTypes:
      existingState?.acceptedFileTypes && existingState.acceptedFileTypes.length > 0
        ? existingState.acceptedFileTypes
        : ["pdf"],
    submissionInstructions: existingState?.submissionInstructions ?? "",
    // Kept across a change of kind. A team hands in a document, a file, a link or a repository;
    // which of those it is changes where the work lives, not whether it belongs to a team.
    teamSetId: existingState?.teamSetId ?? null,
    /*
      Every kind starts with a section graded by hand. For a document, a file or a link that is
      not a default but the only mode the kind has, so offering the other would be offering
      something the schema refuses. For a repository it is a choice: an instructor who wants a
      report asks for one with the button below, and one who does not is never handed a
      model-graded section to delete.

      Sections already typed carry across a change of kind whenever the new kind allows them,
      which for a repository is either mode and for every other kind is hand grading alone.
    */
    sections: repo
      ? existingState && existingState.sections.length > 0
        ? existingState.sections
        : [manualSection()]
      : existingState?.sections.every((section) => section.grading === "manual")
        ? existingState.sections
        : [manualSection()],
  };
}

function fromDraft(draft: Draft): FormState {
  return {
    kind: draft.kind as Kind,
    title: draft.title,
    courseUnitId: draft.courseUnitId,
    completionThreshold: draft.completionThreshold,
    dueAt: draft.dueAt,
    templateRepo: draft.templateRepo ?? "",
    answerKeyRepo: draft.answerKeyRepo ?? "",
    answerKeyDir: draft.answerKeyDir ?? "",
    assignmentRepoName: draft.assignmentRepoName ?? "",
    githubOrg: draft.githubOrg ?? "",
    templateRef: draft.templateRef,
    runnerPreset: draft.runnerPreset,
    runnerConfig: null,
    templateDriveUrl: draft.templateDriveUrl ?? "",
    acceptedFileTypes: (draft.acceptedFileTypes ?? []).filter(isUploadFileTypeKey),
    submissionInstructions: draft.submissionInstructions ?? "",
    teamSetId: draft.teamSetId ?? null,
    sections: (draft.sections as SectionDraft[]) ?? [],
  };
}

/**
 * The time of day to keep when the calendar date changes.
 *
 * The time the due date already holds where there is one, so moving a deadline from Friday to
 * Monday moves the date and nothing else. Where there is none — a new assignment, or one whose
 * date was just cleared — the last time the instructor chose, which is 11:59pm until they choose
 * another.
 */
function dueClockOf(dueAt: Date | null, fallback: SchoolClock): SchoolClock {
  return dueAt ? schoolClockOf(dueAt) : fallback;
}
