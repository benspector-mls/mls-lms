'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/list-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useTRPC } from '@/trpc/client';

/**
 * The modules of a course: create, rename, reorder, remove.
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
export function ModulesTab({ courseId }: { courseId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const modules = useQuery(trpc.modules.listForCourse.queryOptions({ courseId }));

  const [newName, setNewName] = React.useState('');
  const [renaming, setRenaming] = React.useState<string | null>(null);

  /*
    Both, because this screen's own list is a client query and the Assignments tab beside it is
    not — that one is fetched by a server component and passed down, so renaming a module here
    would leave the old name on the assignment rows until a manual reload. `invalidateQueries`
    refreshes this list; `router.refresh()` re-runs the server component for the rest.
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

  const busy =
    create.isPending || rename.isPending || reorder.isPending || remove.isPending;

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
          icon={Plus}
          title="No modules yet"
          description="An assignment belongs to a module, so a course needs at least one before anything can be added to it."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((row, index) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="flex shrink-0 flex-col">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5"
                  disabled={busy || index === 0}
                  aria-label={`Move ${row.name} up`}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5"
                  disabled={busy || index === rows.length - 1}
                  aria-label={`Move ${row.name} down`}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </div>

              {renaming === row.id ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get('name');
                    if (typeof value !== 'string' || value.trim() === '') return;
                    rename.mutate({ moduleId: row.id, name: value.trim() });
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
                  <Button type="submit" size="sm" disabled={rename.isPending}>
                    {rename.isPending && (
                      <Loader2 data-icon="inline-start" className="animate-spin" />
                    )}
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRenaming(null)}
                  >
                    <X data-icon="inline-start" />
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>

                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {row._count.assignments === 1
                      ? '1 assignment'
                      : `${row._count.assignments} assignments`}
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRenaming(row.id)}
                  >
                    <Pencil data-icon="inline-start" />
                    Rename
                  </Button>

                  {/*
                    Absent rather than disabled when the module holds work. A disabled button
                    invites a click and explains nothing; the count beside it already says why
                    there is nothing to press.
                  */}
                  {row._count.assignments === 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => remove.mutate({ moduleId: row.id })}
                    >
                      <Trash2 data-icon="inline-start" />
                      Remove
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        Modules are this course&apos;s own. Renaming one does not touch its assignments, and a
        module holding work cannot be removed until the assignments in it are moved elsewhere.
      </p>
    </div>
  );
}
