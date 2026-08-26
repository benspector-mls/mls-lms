"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { rosterHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Taking up an instructor link.
 *
 * **The link admits somebody to a program rather than to one course**, which is the change
 * that made one link enough: an instructor of a program may act in any of its courses, so there is
 * one grant to make and one link to send. Which courses their name goes on is a separate decision
 * the owner makes on the program's settings screen, and it grants nothing either way.
 *
 * **A button rather than joining on arrival**, the same as the fellow's join screen and for the
 * same reason: opening a link is not consent to take on a program, and this is the one screen
 * where which program it is can be said.
 *
 * **The ineligible case is answered here rather than by a failed button.** A student account cannot
 * be made staff from a program link — that would be a second path to staff access with no admin
 * involved — so the screen says what is actually needed instead of offering an action that is going
 * to be refused. The procedure refuses it regardless; this only decides whether somebody is invited
 * to try.
 */
export function AcceptInstructorLink({
  token,
  preview,
}: {
  token: string;
  preview: RouterOutputs["programs"]["previewInstructorLink"];
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const accept = useMutation(
    trpc.programs.acceptInstructorLink.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.added
            ? `You now instruct ${result.name}.`
            : `You already instruct ${result.name}.`,
        );
        /*
          Into the roster rather than a course's triage, which is where a new instructor of a
          program actually starts: they have been given no course yet, and the roster is the
          one screen that is theirs the moment the link is redeemed.
        */
        router.push(rosterHref(result.programId));
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!preview) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-center">
          <TriangleAlert className="size-8 text-amber-600 dark:text-amber-400" />
          <h1 className="text-lg font-semibold">This instructor link does not work</h1>
          <p className="text-sm text-muted-foreground">
            It may have been replaced with a newer one. Ask whoever sent it for the current link.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="size-6" />
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance">{preview.name}</h1>
          <p className="text-sm text-muted-foreground">
            {preview.term}
            {preview.owner && ` · ${preview.owner}`}
          </p>
        </div>

        {preview.alreadyInstructs ? (
          <>
            <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
              <Check className="size-4" />
              You already instruct this program.
            </p>
            <Button onClick={() => router.push(rosterHref(preview.programId))}>
              Open the roster
              <ArrowRight data-icon="inline-end" />
            </Button>
          </>
        ) : !preview.eligible ? (
          /*
            The one refusal with an answer, so it is stated rather than left to the button.
            Everything else on this screen is about a program; this is about the account.
          */
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              This link adds an instructor to the program, and your account is not an instructor
              account.
            </p>
            <p className="text-sm text-muted-foreground">
              An admin has to send you an instructor invitation first. Once you have used that, come
              back to this link and it will work.
            </p>
          </div>
        ) : preview.archived ? (
          <p className="text-sm text-muted-foreground">
            This program is archived, so it is not taking new instructors.
          </p>
        ) : (
          <>
            {/*
              What the grant actually reaches, said plainly. It is wider than a course — every
              course of the program, every fellow's work in them, and the roster and
              attendance above them — and somebody pressing this should know that before they do.
            */}
            <p className="text-sm text-muted-foreground">
              Taking this up lets you author assignments in any course of this program, read every
              fellow&apos;s work, approve grades, and take attendance.
            </p>
            <Button disabled={accept.isPending} onClick={() => accept.mutate({ token })}>
              {accept.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Instruct this program
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
