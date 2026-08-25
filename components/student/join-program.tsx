"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, School, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Joining a matriculation from its link.
 *
 * **One link where there used to be one per course**, and it admits somebody to every course of the
 * matriculation at once. So the screen names them: a fellow pressing Join is agreeing to more than
 * one course, and a page that said only the program's name would be asking them to agree to a list
 * it had not shown them.
 *
 * **A button rather than joining on arrival.** Opening a link is not consent to be enrolled, and
 * a page that enrolled on load would enrol anybody who clicked a URL in a group chat to see what
 * it was. It also gives the one screen where this can be said a place to say it: which
 * matriculation, who owns it, and what is in it.
 *
 * Every refusal is a message from the procedure rather than a state handled here — an expired
 * link, a finished program, an enrollment they were removed from. The procedure is the authority on
 * all of them and each has something specific to tell the person reading it.
 */
export function JoinProgram({
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
        /*
          Straight to the course list rather than into one course, because joining admits them to
          every course of the matriculation and there is no single one to pick. Landing back on this
          screen after succeeding would read as nothing having happened.
        */
        router.push("/courses");
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
          <School className="size-6" />
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance">{preview.name}</h1>
          <p className="text-sm text-muted-foreground">
            {preview.matriculation}
            {preview.owner && ` · ${preview.owner}`}
          </p>
        </div>

        {preview.archived ? (
          <p className="text-sm text-muted-foreground">
            This program has finished, so it is not taking new fellows.
          </p>
        ) : alreadyActive ? (
          <>
            <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
              <Check className="size-4" />
              You are already in this program.
            </p>
            <Button onClick={() => router.push("/courses")}>
              Open my courses
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
            with an enrollment, so the two cannot both apply — but a fellow who joined before the
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
                  not on the list of fellows expected in {preview.name}.
                </>
              ) : (
                <>Your account is not on the list of fellows expected in {preview.name}.</>
              )}{" "}
              If you usually use a different GitHub account, sign out and try again with that one.
              Otherwise ask your instructor to add you.
            </p>
          </>
        ) : (
          <>
            {/*
              What they are agreeing to, named. Joining enrolls somebody in every course of the
              matriculation at once, so a screen that offered the button without listing them would
              be asking for consent to a set it had not shown. Nothing is listed for a program whose
              courses are all still unpublished — there is nothing to name yet, and the sentence
              below says what joining does either way.
            */}
            {preview.courses.length > 0 && (
              <div className="flex w-full flex-col gap-1 rounded-lg border border-border px-3 py-2 text-left">
                <span className="text-xs font-medium text-muted-foreground">
                  Joining enrolls you in
                </span>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {preview.courses.map((course) => (
                    <li key={course.id} className="truncate">
                      {course.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Joining adds you to this program so your instructors can hand out assignments and
              grade your work, and puts your attendance on its daily check-in.
            </p>
            <Button disabled={join.isPending} onClick={() => join.mutate({ token })}>
              {join.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Join this program
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
