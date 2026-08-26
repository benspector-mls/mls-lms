"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical, Loader2, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

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
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * Putting a test student in this cohort: a new one, or one that already exists.
 *
 * **Two ways in, because reuse is worth offering and is not the obvious default.** A test student
 * is an identity rather than a program's property, so the same one can sit on several rosters, and
 * its repositories stay distinct — a repository is named for the course as well as the student.
 * What reuse buys is one identity an admin gets used to seeing instead of a growing list of
 * numbers. What a new one buys is a clean slate, and two rows in one gradebook when that is what
 * you want to look at.
 *
 * Ones already on this roster are listed and unselectable rather than hidden, because "Test Student
 * 1 is already here" is the answer to the question somebody opened this to ask, and an absence does
 * not say it.
 */
export function TestStudentDialog({
  programId,
  open,
  onOpenChange,
}: {
  programId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const existing = useQuery({
    ...trpc.testStudents.list.queryOptions({ programId }),
    enabled: open,
  });

  const create = useMutation(
    trpc.testStudents.create.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`${result.displayName} is on the roster.`);
          onOpenChange(false);
        },
      }),
    ),
  );

  const enroll = useMutation(
    trpc.testStudents.enroll.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`${result.displayName} is on the roster.`);
          onOpenChange(false);
        },
      }),
    ),
  );

  const busy = create.isPending || enroll.isPending;
  const available = (existing.data ?? []).filter(
    (student) => student.enrollmentStatus !== "ACTIVE",
  );
  const alreadyHere = (existing.data ?? []).filter(
    (student) => student.enrollmentStatus === "ACTIVE",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a test student</DialogTitle>
          <DialogDescription>
            A student-shaped account you can look through to meet this program the way a fellow does
            — accept the work of any of its courses, push to its repositories, and grade the result.
            It is left out of the roster count, and shown with a Test badge everywhere else.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <Button
            variant="outline"
            className="justify-start"
            disabled={busy}
            onClick={() => create.mutate({ programId })}
          >
            {create.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            Create a new test student
          </Button>

          {existing.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            available.length > 0 && (
              <div className="flex min-w-0 flex-col gap-2">
                <span className="text-sm font-medium">Or use one that already exists</span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  {available.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      disabled={busy}
                      onClick={() => enroll.mutate({ programId, profileId: student.id })}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm",
                        "transition-colors hover:bg-muted disabled:opacity-60",
                      )}
                    >
                      <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {student.displayName ?? `Test Student ${student.testStudentNumber}`}
                      </span>
                      {/* A previously removed one reads as what it is, so pressing it is
                          understood as putting it back rather than adding something new. */}
                      {student.enrollmentStatus === "REMOVED" && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          removed from this cohort
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}

          {alreadyHere.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Already in this cohort:{" "}
              {alreadyHere
                .map(
                  (student) => student.displayName ?? `Test Student ${student.testStudentNumber}`,
                )
                .join(", ")}
              .
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
