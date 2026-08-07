'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/list-states';
import { AssignmentKindBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/status';
import { useTRPC } from '@/trpc/client';
import type { RouterOutputs } from '@/trpc/types';

/**
 * The course's shape: every module, in order, holding what is in it.
 *
 * **This is the student's course page with module management on it**, and that is the feature
 * rather than a resemblance. The screen used to be a list of module names with up and down
 * buttons — accurate, and silent about what was actually in a module — so the question an
 * instructor has about their own module list, "is this in the right place and does this module
 * have anything in it", could not be answered from the screen that manages modules.
 *
 * **The assignments listed here are not interactive.** No links, no menus, no publish toggles.
 * This screen shows the shape; the Assignments screen is where assignments are worked on, and a
 * second route into the grading queue that looked different from the first would be two answers
 * to one question. The cost is accepted: something spotted in the wrong module here is moved
 * from there.
 *
 * **Drafts are shown and marked** rather than hidden. A truer mirror would omit what a student
 * cannot see, and then a module that is full to the instructor and empty to the cohort reads as
 * simply empty — which is the confusion this screen exists to remove. Marking them answers the
 * question directly: this is why your students see nothing in Mod 4.
 *
 * Up and down buttons rather than drag-and-drop. No new dependency, it works from the keyboard,
 * and eight modules is not a list that needs dragging. Each move sends the whole new order
 * rather than "swap these two", so the server rewrites every position from a list nobody has to
 * interpret — see `modules.reorder`.
 *
 * Removal is refused by the procedure while any assignment references the module, and this
 * screen does not offer the button in that case. Both, deliberately: the interface should not
 * offer an action that cannot succeed, and the procedure is what actually refuses, because a
 * request can carry anything the browser did not send.
 */

type Module = RouterOutputs['modules']['listForCourse'][number];

export function CourseModules({ courseId }: { courseId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const modules = useQuery(trpc.modules.listForCourse.queryOptions({ courseId }));

  const [newName, setNewName] = React.useState('');
  const [renaming, setRenaming] = React.useState<string | null>(null);

  /*
    Both, because this screen's own list is a client query and the assignments it now shows come
    from server-rendered screens elsewhere. `invalidateQueries` refreshes this list;
    `router.refresh()` re-runs the server components so a module renamed here does not leave the
    old name on the assignments screen until a manual reload.
  */
  function refreshEverything() {
    void queryClient.invalidateQueries();
    router.refresh();
  }

  const settled = {
    onSuccess: () => refreshEverything(),
    onError: (error: { message: string }) => toast.error(error.message),
  };

  const create = useMutation(trpc.modules.create.mutationOptions(settled));
  const rename = useMutation(
    trpc.modules.rename.mutationOptions({
      ...settled,
      onSuccess: () => {
        setRenaming(null);
        refreshEverything();
      },
    }),
  );
  const reorder = useMutation(trpc.modules.reorder.mutationOptions(settled));
  const remove = useMutation(
    trpc.modules.remove.mutationOptions({
      ...settled,
      onSuccess: (result) => {
        toast.success(`Removed "${result.name}".`);
        refreshEverything();
      },
    }),
  );

  const busy = create.isPending || rename.isPending || reorder.isPending || remove.isPending;

  if (modules.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const rows = modules.data ?? [];

  /** Sends the whole order with one pair swapped. */
  function move(index: number, direction: -1 | 1) {
    const next = [...rows];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate({ courseId, moduleIds: next.map((row) => row.id) });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newName.trim();
          if (!name) return;
          create.mutate({ courseId, name }, { onSuccess: () => setNewName('') });
        }}
      >
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Mod 8 - Capstone"
          className="max-w-sm"
          aria-label="New module name"
        />
        <Button type="submit" size="sm" disabled={busy || newName.trim() === ''}>
          {create.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Plus data-icon="inline-start" />
          )}
          Add module
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Plus />}
          title="No modules yet"
          description="An assignment belongs to a module, so a course needs at least one before anything can be added to it."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <ModuleSection
              key={row.id}
              module={row}
              busy={busy}
              isFirst={index === 0}
              isLast={index === rows.length - 1}
              renaming={renaming === row.id}
              onStartRename={() => setRenaming(row.id)}
              onCancelRename={() => setRenaming(null)}
              onRename={(name) => rename.mutate({ moduleId: row.id, name })}
              renamePending={rename.isPending}
              onMove={(direction) => move(index, direction)}
              onRemove={() => remove.mutate({ moduleId: row.id })}
            />
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        This is the course as your students meet it, in the order they meet it. Assignments are
        listed by due date and are not editable here — open the Assignments screen to change one.
        A module holding work cannot be removed until the assignments in it are moved elsewhere.
      </p>
    </div>
  );
}

/**
 * One module: its header, and what is in it.
 *
 * The reordering, rename, and remove controls sit **beside** the trigger rather than inside it,
 * because a button may only contain phrasing content — nesting them would be invalid markup and
 * would make every click on them toggle the section as well.
 */
function ModuleSection({
  module: row,
  busy,
  isFirst,
  isLast,
  renaming,
  onStartRename,
  onCancelRename,
  onRename,
  renamePending,
  onMove,
  onRemove,
}: {
  module: Module;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  renaming: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (name: string) => void;
  renamePending: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  // Open when it holds something, closed when it does not — the same rule the student's course
  // page follows. An empty module is worth seeing in the list and not worth the vertical space.
  const [open, setOpen] = React.useState(row.assignments.length > 0);
  const drafts = row.assignments.filter((a) => a.distributedAt === null).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <section className="overflow-hidden rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-2 py-2">
          <div className="flex shrink-0 flex-col">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              disabled={busy || isFirst}
              aria-label={`Move ${row.name} up`}
              onClick={() => onMove(-1)}
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              disabled={busy || isLast}
              aria-label={`Move ${row.name} down`}
              onClick={() => onMove(1)}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </div>

          {renaming ? (
            <form
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get('name');
                if (typeof value !== 'string' || value.trim() === '') return;
                onRename(value.trim());
              }}
            >
              {/* autoFocus so renaming is one click and then typing. */}
              <Input
                name="name"
                defaultValue={row.name}
                autoFocus
                className="min-w-0 flex-1"
                aria-label={`Rename ${row.name}`}
              />
              <Button type="submit" size="sm" disabled={renamePending}>
                {renamePending && <Loader2 data-icon="inline-start" className="animate-spin" />}
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelRename}>
                <X data-icon="inline-start" />
                Cancel
              </Button>
            </form>
          ) : (
            <>
              {/*
                The heading wraps the control rather than sitting inside it: a button may only
                contain phrasing content, so an <h2> within one is invalid markup, and this is
                the shape screen readers expect from a collapsible section anyway.
              */}
              <h2 className="min-w-0 flex-1">
                <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground">
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.name}</span>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {moduleSummary(row.assignments.length, drafts)}
                  </span>
                </CollapsibleTrigger>
              </h2>

              <Button variant="ghost" size="sm" disabled={busy} onClick={onStartRename}>
                <Pencil data-icon="inline-start" />
                Rename
              </Button>

              {/*
                Absent rather than disabled when the module holds work. A disabled button invites
                a click and explains nothing; the count beside it already says why there is
                nothing to press. Counted from `_count`, which includes drafts — the foreign key
                refuses on all of them, so a count of only what is published would offer a button
                the procedure then refuses.
              */}
              {row._count.assignments === 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={onRemove}
                >
                  <Trash2 data-icon="inline-start" />
                  Remove
                </Button>
              )}
            </>
          )}
        </div>

        <CollapsibleContent>
          {row.assignments.length === 0 ? (
            <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
              Nothing in this module yet. Add an assignment to it from the Assignments screen.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {row.assignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{assignment.title}</span>
                  <AssignmentKindBadge kind={assignment.kind} />
                  {/* Why a module can look full here and empty to the cohort. */}
                  {assignment.distributedAt === null && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
                    >
                      Draft
                    </Badge>
                  )}
                  <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {assignment.pointValue} pts
                  </span>
                  {/*
                    The due date is the ordering, so it is on every row including the undated
                    ones — a blank where the sort key should be reads as missing data rather
                    than as the reason that row is at the bottom.
                  */}
                  <span className="w-28 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground">
                    {assignment.dueAt ? formatDate(assignment.dueAt) : 'No due date'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/**
 * "6 assignments · 2 drafts", or "Nothing yet".
 *
 * The draft count is separate from the total rather than folded into it, because the two
 * answer different questions: how much is in this module, and how much of it the cohort
 * cannot see.
 */
function moduleSummary(total: number, drafts: number): string {
  if (total === 0) return 'Nothing yet';
  const assignments = total === 1 ? '1 assignment' : `${total} assignments`;
  return drafts === 0 ? assignments : `${assignments} · ${drafts} draft${drafts === 1 ? '' : 's'}`;
}
