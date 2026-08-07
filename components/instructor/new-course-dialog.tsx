'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  cohortSlugProblem,
  MAX_COHORT_SLUG,
  slugifyCohort,
} from '@/lib/courses/cohort-slug';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useTRPC } from '@/trpc/client';

/**
 * Creating a cohort, optionally from a previous one.
 *
 * **Copying is the point of this screen, not a convenience on it.** A new cohort of an existing
 * program is last term's modules and assignments with new dates, so the alternative to copying
 * is re-entering twelve assignments and two repository URLs each. The first course in a
 * deployment has nothing to copy from, which is why it is optional rather than required.
 *
 * What the copy does and does not carry is stated here rather than left to be discovered: due
 * dates are cleared because a new cohort has new ones, and copies arrive unpublished because the
 * reason to copy is that last term's version was nearly right.
 *
 * **A partial copy is reported, not rolled back.** An assignment can legitimately fail — a
 * template made private since last term, an answer key folder renamed upstream — and discarding
 * a whole new cohort because one of twelve needs attention would be the wrong trade.
 */
export function NewCourseDialog({
  courses,
}: {
  /** Courses the caller can copy from — the ones they teach, archived ones included. */
  courses: {
    id: string;
    name: string;
    cohortTerm: string;
    archivedAt: Date | null;
    teaches: boolean;
    _count: { assignments: number };
  }[];
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [cohortTerm, setCohortTerm] = React.useState('');
  const [copyFrom, setCopyFrom] = React.useState('');

  /*
    Two steps, because one of these fields cannot be taken back.

    The short name is settled here and never again — every repository the cohort generates is
    named after it, so a typo is forty repositories with a typo in them and no way to rename
    them from this application. Copying is the other reason: it can bring a term's worth of
    assignments into the wrong course, and undoing that means deleting them one at a time.

    A review step rather than a warning beside the button, because a warning next to the thing
    you are already committed to pressing is read after the fact.
  */
  const [step, setStep] = React.useState<'form' | 'confirm'>('form');

  /*
    The slug follows the cohort term until somebody edits it, and then stops.

    Held as "have they touched it" rather than by comparing the two, because those are different
    questions: an instructor who deliberately types `fall-2026` — the same thing the term would
    have suggested — has still taken it over, and their next keystroke in the term field should
    not silently overwrite it.
  */
  const [slug, setSlug] = React.useState('');
  const [slugEdited, setSlugEdited] = React.useState(false);
  const effectiveSlug = slugEdited ? slug : slugifyCohort(cohortTerm);
  const slugProblem = effectiveSlug === '' ? null : cohortSlugProblem(effectiveSlug);

  /*
    Every course the caller teaches, archived ones included, and that is the interesting half.

    A cohort is normally copied the term after it finished, which is exactly when the source
    has been archived — so excluding them would leave this list empty at the moment it is most
    wanted. They are labelled rather than hidden, because a term nobody is teaching is a
    reasonable thing to copy and a confusing thing to copy by accident.
  */
  const copyable = courses.filter((course) => course.teaches);
  const source = copyable.find((course) => course.id === copyFrom) ?? null;

  const sourceLabel = (course: (typeof courses)[number]) =>
    course.archivedAt != null
      ? `${course.name} · ${course.cohortTerm} · Archived`
      : `${course.name} · ${course.cohortTerm}`;

  /** Whether the form is filled in enough to be worth reviewing. */
  const ready =
    name.trim() !== '' && cohortTerm.trim() !== '' && effectiveSlug !== '' && slugProblem === null;

  const close = () => {
    setOpen(false);
    setStep('form');
  };

  const create = useMutation(
    trpc.courses.create.mutationOptions({
      onSuccess: (result) => {
        if (result.failed.length > 0) {
          // A warning rather than a success, and it names them: an instructor who is not told
          // which assignments did not arrive would find out by noticing one missing weeks later.
          toast.warning(
            `Created ${result.course.name} with ${result.copied} of ` +
              `${result.copied + result.failed.length} assignments. ` +
              `Could not copy: ${result.failed.map((entry) => entry.title).join(', ')}.`,
            { duration: 12_000 },
          );
        } else if (result.copied > 0) {
          toast.success(
            `Created ${result.course.name} with ${result.copied} ` +
              `${result.copied === 1 ? 'assignment' : 'assignments'}, none published yet.`,
          );
        } else {
          toast.success(`Created ${result.course.name}.`);
        }

        close();
        setName('');
        setCohortTerm('');
        setCopyFrom('');
        setSlug('');
        setSlugEdited(false);
        router.push(`/instructor/courses/${result.course.id}`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        New course
      </Button>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:min-w-96">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Create this course?</span>
          <span className="text-xs text-muted-foreground">
            The short name is set here and cannot be changed afterwards.
          </span>
        </div>

        <dl className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <Detail label="Course" value={name.trim()} />
          <Detail label="Cohort" value={cohortTerm.trim()} />
          {/*
            The pattern rather than the bare slug, because the slug on its own does not show what
            it is for. This is the string students read for the next nine months.
          */}
          <Detail
            label="Repositories"
            value={`${effectiveSlug}-assignment-githubname`}
            mono
            emphasis
          />
          <Detail
            label="Copying"
            value={
              source
                ? `${source.name} · ${source.cohortTerm} — its modules and ` +
                  `${source._count.assignments} ` +
                  `${source._count.assignments === 1 ? 'assignment' : 'assignments'}, ` +
                  `unpublished, with due dates cleared`
                : 'Nothing. Modules and assignments are added afterwards.'
            }
          />
        </dl>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={create.isPending}
            onClick={() =>
              create.mutate({
                name: name.trim(),
                cohortTerm: cohortTerm.trim(),
                cohortSlug: effectiveSlug,
                copyFromCourseId: copyFrom || undefined,
              })
            }
          >
            {create.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Create course
          </Button>
          {/* Back rather than Cancel: every field is still filled in, and this is a review. */}
          <Button
            size="sm"
            variant="ghost"
            disabled={create.isPending}
            onClick={() => setStep('form')}
          >
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:min-w-96"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        setStep('confirm');
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="course-name">
          Course
        </label>
        <Input
          id="course-name"
          value={name}
          autoFocus
          placeholder="Software Engineering Fellowship"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="course-term">
          Cohort
        </label>
        <Input
          id="course-term"
          value={cohortTerm}
          placeholder="Fall 2026"
          onChange={(event) => setCohortTerm(event.target.value)}
        />
      </div>

      {/*
        The short name, which is the only field here whose value is visible outside this
        application — it is in the name of every repository the cohort generates, which students
        see, clone, and read for the next nine months.

        Suggested rather than asked for, because typing one per cohort is a chore and "Fall 2026"
        already implies it. Editable in the same breath, because `f26` is what somebody reading
        forty repository names actually wants — and this is the only moment it is editable at all,
        which is what the review step exists to make sure gets read.
      */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="course-slug">
          Short name
        </label>
        <Input
          id="course-slug"
          value={effectiveSlug}
          maxLength={MAX_COHORT_SLUG}
          placeholder="f26"
          className="font-mono"
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value.toLowerCase());
          }}
        />
        {slugProblem ? (
          <p className="text-xs text-destructive">{slugProblem}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Every repository this cohort generates is named{' '}
            <code>{effectiveSlug || 'short-name'}-assignment-githubname</code>. It cannot be
            changed after the course is created.
          </p>
        )}
      </div>

      {copyable.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Copy from</label>
          <Select
            value={copyFrom}
            onValueChange={(value) => setCopyFrom(value ?? '')}
            items={{
              '': 'Start empty',
              ...Object.fromEntries(copyable.map((course) => [course.id, sourceLabel(course)])),
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Start empty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Start empty</SelectItem>
              {copyable.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {sourceLabel(course)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {copyFrom
              ? 'Its modules and assignments come across unpublished, with due dates cleared.'
              : 'Modules and assignments are added afterwards.'}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {/* "Review" and not "Create", because it is not the button that creates anything. */}
        <Button type="submit" size="sm" disabled={!ready}>
          Review
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One labelled fact on the review step, in a column that lines its labels up. */
function Detail({
  label,
  value,
  mono = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground sm:w-24 sm:pt-0.5">{label}</dt>
      <dd
        className={cn(
          'min-w-0 break-words text-sm',
          mono && 'font-mono text-xs',
          emphasis ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
