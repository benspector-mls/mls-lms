"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useTRPC } from "@/trpc/client";

/**
 * Deleting a test student outright: its account, its work in every program, and its repositories.
 *
 * **Wider than the roster's Remove**, and the difference is the reason this is a separate control.
 * Remove takes somebody off one roster and keeps everything they submitted, which is what an
 * instructor wants for a real fellow. This deletes the identity itself, so it reaches every
 * program the test student is on, not only the one whose roster the button was pressed on.
 * The dialog names those programs, because a roster belongs to one of them and this is not an
 * act on one of them.
 *
 * **No typed confirmation**, unlike removing an assignment. That check exists there because the
 * work being destroyed is a student's own and cannot be recreated. Everything here was made to be
 * thrown away, and a friction that says "this is grave" about deleting scratch work teaches somebody
 * to type past the ones that are.
 *
 * Repositories are listed rather than counted. A list is something to recognise before agreeing to;
 * "3 repositories" is a number to agree with.
 */
export function RemoveTestStudentDialog({
  profileId,
  open,
  onOpenChange,
}: {
  profileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const preview = useQuery({
    ...trpc.testStudents.removalPreview.queryOptions({ profileId }),
    enabled: open,
  });

  const remove = useMutation(
    trpc.testStudents.remove.mutationOptions(
      settled({
        onSuccess: (result) => {
          onOpenChange(false);
          toast.success(
            result.deletedRepositories.length === 0
              ? `Deleted ${result.displayName}.`
              : `Deleted ${result.displayName} and ${result.deletedRepositories.length} ` +
                  `repositor${result.deletedRepositories.length === 1 ? "y" : "ies"}.`,
          );
          if (result.failedRepositories.length > 0) {
            // Said plainly, because nothing else will say it: these are still on GitHub and
            // nothing in the application refers to them any more.
            toast.warning(
              `These repositories could not be deleted and are still on GitHub: ` +
                `${result.failedRepositories.join(", ")}`,
              { duration: 15_000 },
            );
          }
        },
      }),
    ),
  );

  const name = preview.data?.displayName ?? "this test student";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            The account goes, along with everything it accepted or submitted in every program, and
            the repositories it generated are deleted from GitHub. Its number is never reused.
          </DialogDescription>
        </DialogHeader>

        {preview.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : preview.error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Could not check what this would delete</AlertTitle>
            <AlertDescription>{preview.error.message}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {preview.data.programs.length > 1 && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>It is on more than one roster</AlertTitle>
                <AlertDescription>
                  Deleting it removes it from all of them: {preview.data.programs.join(", ")}. To
                  take it off this roster alone, use Remove on its row instead.
                </AlertDescription>
              </Alert>
            )}

            <p className="text-sm text-muted-foreground">
              {preview.data.submissionCount === 0
                ? "It has not accepted anything yet."
                : `${preview.data.submissionCount} submission(s), and the reports and test runs under them.`}
            </p>

            {preview.data.repositories.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">Repositories to delete</span>
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {preview.data.repositories.map((repo) => (
                    <li key={repo} className="truncate font-mono">
                      {repo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

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
            disabled={remove.isPending}
            onClick={() => remove.mutate({ profileId })}
          >
            {remove.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            Delete test student
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
