'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
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
  /** Courses the caller can copy from — the ones they teach. */
  courses: { id: string; name: string; cohortTerm: string; teaches: boolean }[];
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [cohortTerm, setCohortTerm] = React.useState('');
  const [copyFrom, setCopyFrom] = React.useState('');

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

  const copyable = courses.filter((course) => course.teaches);

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

        setOpen(false);
        setName('');
        setCohortTerm('');
        setCopyFrom('');
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

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:min-w-96"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || !cohortTerm.trim()) return;
        create.mutate({
          name: name.trim(),
          cohortTerm: cohortTerm.trim(),
          cohortSlug: effectiveSlug,
          copyFromCourseId: copyFrom || undefined,
        });
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
        forty repository names actually wants, and this is the only moment it is free to change:
        after the first student accepts, their repositories are named after it.
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
            changed once a student has accepted anything.
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
              ...Object.fromEntries(
                copyable.map((course) => [course.id, `${course.name} · ${course.cohortTerm}`]),
              ),
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Start empty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Start empty</SelectItem>
              {copyable.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.name} · {course.cohortTerm}
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
        <Button
          type="submit"
          size="sm"
          disabled={
            create.isPending ||
            !name.trim() ||
            !cohortTerm.trim() ||
            effectiveSlug === '' ||
            slugProblem !== null
          }
        >
          {create.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
          Create
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
