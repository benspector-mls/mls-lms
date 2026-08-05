'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useTRPC } from '@/trpc/client';

/**
 * Removing an assignment, which is the one irreversible action in the application.
 *
 * There is no soft delete: the row goes, and its submissions, drafts, feedback, and test runs
 * go with it by cascade. The database's own backups are the only way back. So this dialog does
 * two things beyond asking.
 *
 * It states what would actually be destroyed, counted from the database rather than described
 * in general terms. "3 submissions, 2 released grades" is a sentence somebody can act on;
 * "this cannot be undone" is not.
 *
 * And it requires the title to be typed. That check is *also* enforced in the procedure, which
 * is what actually refuses — a guard living only in a dialog is decoration, and anything that
 * can call the procedure can skip the dialog.
 */
export function RemoveAssignmentDialog({
  assignmentId,
  title,
  open,
  onOpenChange,
  onRemoved,
}: {
  assignmentId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [typed, setTyped] = React.useState('');

  const impact = useQuery({
    ...trpc.assignments.removalImpact.queryOptions({ assignmentId }),
    enabled: open,
  });

  const remove = useMutation(
    trpc.assignments.remove.mutationOptions({
      onSuccess: (result) => {
        onOpenChange(false);
        setTyped('');
        toast.success(
          result.submissions === 0
            ? `Removed ${result.title}.`
            : `Removed ${result.title}, along with ${result.submissions} submission(s) and ` +
              `${result.drafts} report(s).`,
        );
        if (result.orphanedRepositories.length > 0) {
          // Said plainly, because nothing else will say it: these still exist on GitHub and
          // nothing in the application refers to them any more.
          toast.warning(
            `${result.orphanedRepositories.length} student repositor(y/ies) are still on ` +
              `GitHub and are no longer tracked here: ${result.orphanedRepositories.join(', ')}`,
            { duration: 15_000 },
          );
        }
        void queryClient.invalidateQueries();
        onRemoved?.();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const matches = typed === title;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setTyped('');
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {title}?</DialogTitle>
          <DialogDescription>
            This cannot be undone from the application. Student repositories on GitHub are left
            alone, and reported afterwards so they can be dealt with deliberately.
          </DialogDescription>
        </DialogHeader>

        {impact.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : impact.error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Could not check what this would remove</AlertTitle>
            <AlertDescription>{impact.error.message}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            {impact.data.submissions === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing has been submitted for this assignment.
              </p>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>This destroys student work</AlertTitle>
                <AlertDescription>
                  <ul className="ml-4 list-disc">
                    <li>{impact.data.submissions} submission(s)</li>
                    {impact.data.releasedGrades > 0 && (
                      <li>
                        <strong>{impact.data.releasedGrades} released grade(s)</strong> that
                        students can currently see
                      </li>
                    )}
                    {impact.data.feedbackRounds > 0 && (
                      <li>{impact.data.feedbackRounds} round(s) of approved feedback</li>
                    )}
                    {impact.data.drafts > 0 && <li>{impact.data.drafts} report(s)</li>}
                    {impact.data.testRuns > 0 && <li>{impact.data.testRuns} test run(s)</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {impact.data.published && (
              <p className="text-sm text-muted-foreground">
                It is currently visible to students. If the goal is to stop handing it out,
                unpublishing does that and keeps the work.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-title">
            Type <span className="font-mono">{title}</span> to confirm
          </Label>
          <Input
            id="confirm-title"
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={remove.isPending}>
                Keep it
              </Button>
            }
          />
          <Button
            variant="destructive"
            disabled={!matches || remove.isPending}
            onClick={() => remove.mutate({ assignmentId, confirmTitle: typed })}
          >
            {remove.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            Remove permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
