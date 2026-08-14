"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Check, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Joining a course from its link.
 *
 * **A button rather than joining on arrival.** Opening a link is not consent to be enrolled, and
 * a page that enrolled on load would enrol anybody who clicked a URL in a group chat to see what
 * it was. It also gives the one screen where this can be said a place to say it: which cohort,
 * and who teaches it.
 *
 * Every refusal is a message from the procedure rather than a state handled here — an expired
 * link, a finished cohort, a course they teach, an enrollment they were removed from. The
 * procedure is the authority on all four and each has something specific to tell the person
 * reading it.
 */
export function JoinCourse({
  token,
  preview,
}: {
  token: string;
  preview: RouterOutputs["enrollments"]["preview"];
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const join = useMutation(
    trpc.enrollments.join.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.joined ? `You have joined ${result.name}.` : `You are already in ${result.name}.`,
        );
        // Straight into the course, because the next thing they want is the assignment list —
        // and landing back on this screen after succeeding would read as nothing having happened.
        router.push(`/courses/${result.courseId}`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!preview) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-center">
          <TriangleAlert className="size-8 text-amber-600 dark:text-amber-400" />
          <h1 className="text-lg font-semibold">This join link does not work</h1>
          <p className="text-sm text-muted-foreground">
            It may have been replaced with a newer one. Ask your instructor for the current link.
          </p>
        </div>
      </Shell>
    );
  }

  if (preview.alreadyIn === "REMOVED") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-center">
          <TriangleAlert className="size-8 text-amber-600 dark:text-amber-400" />
          <h1 className="text-lg font-semibold">You are no longer in {preview.name}</h1>
          <p className="text-sm text-muted-foreground">
            Everything you submitted and the feedback you were given is still available to you. Ask
            your instructor if this is wrong — rejoining is something they do.
          </p>
        </div>
      </Shell>
    );
  }

  const alreadyActive = preview.alreadyIn === "ACTIVE";

  return (
    <Shell>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BookOpen className="size-6" />
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance">{preview.name}</h1>
          <p className="text-sm text-muted-foreground">
            {preview.cohortTerm}
            {preview.primaryInstructor && ` · ${preview.primaryInstructor}`}
          </p>
        </div>

        {preview.archived ? (
          <p className="text-sm text-muted-foreground">
            This cohort has finished, so it is not taking new students.
          </p>
        ) : alreadyActive ? (
          <>
            <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
              <Check className="size-4" />
              You are already in this course.
            </p>
            <Button onClick={() => router.push(`/courses/${preview.courseId}`)}>
              Open course
              <ArrowRight data-icon="inline-end" />
            </Button>
          </>
        ) : !preview.onRoster ? (
          /*
            Handled here rather than left to the mutation's refusal, unlike the four states above.
            Those are things the person cannot act on until an instructor does; this one usually
            has an answer they can reach themselves — they signed in with a personal GitHub
            account instead of the one their instructor wrote down — and telling them after they
            press Join means telling them once they have already concluded they are in the right
            place.

            **Below the already-in branch, not above it.** `preview.onRoster` is true for anybody
            with an enrollment, so the two cannot both apply — but a student who joined before the
            roster existed has no entry, and this order means the screen stays right even if that
            ever stops being true in the procedure. The worst version of this screen tells somebody
            sitting in a course that the link to it is not for them.

            The account is named for the same reason the refusal is here at all. Somebody who has
            two GitHub accounts cannot see which one this browser is signed in as, and that is
            precisely the fact that resolves it.
          */
          <>
            <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <TriangleAlert className="size-4 shrink-0" />
              This link is not for this account.
            </p>
            <p className="text-sm text-muted-foreground">
              {preview.signedInAs ? (
                <>
                  You are signed in as{" "}
                  <span className="font-mono text-foreground">{preview.signedInAs}</span>, which is
                  not on the list of students expected in {preview.name}.
                </>
              ) : (
                <>Your account is not on the list of students expected in {preview.name}.</>
              )}{" "}
              If you usually use a different GitHub account, sign out and try again with that one.
              Otherwise ask your instructor to add you.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Joining adds you to this cohort so your instructor can hand out assignments and grade
              your work.
            </p>
            <Button disabled={join.isPending} onClick={() => join.mutate({ token })}>
              {join.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Join this course
            </Button>
          </>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col p-4 md:p-6">
      <Card>
        <CardContent className="py-8">{children}</CardContent>
      </Card>
    </div>
  );
}
