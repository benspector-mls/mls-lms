"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, School, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISPLAY_NAME_MAX_LENGTH, displayNameSchema, looksLikeFirstLast } from "@/lib/people";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Joining a program from its link.
 *
 * **One link where there used to be one per course**, and it admits somebody to every course of the
 * program at once. So the screen names them: a fellow pressing Join is agreeing to more than
 * one course, and a page that said only the program's name would be asking them to agree to a list
 * it had not shown them.
 *
 * **A button rather than joining on arrival.** Opening a link is not consent to be enrolled, and
 * a page that enrolled on load would enrol anybody who clicked a URL in a group chat to see what
 * it was. It also gives the one screen where this can be said a place to say it: which
 * program, who owns it, and what is in it.
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

  /*
    The name this fellow will be known by, asked for here when this is the first program they have
    ever joined — `preview.firstProgram`. Every display name in this application is written by the
    signup trigger rather than by the person, so a fellow whose GitHub profile has no full name on it
    arrives called `bspector` or `jrivera23`, and that is the name an instructor then reads on the
    roster, in the gradebook, and beside every piece of work. This is the moment it starts to matter,
    and it is the only moment they are asked: joining leaves an enrollment behind, and the next join
    link they open sees it and asks nothing.

    Started from the name they already have rather than empty, because for somebody whose GitHub
    profile does carry their real name there is nothing to change, and a blank box would ask them to
    type out something the application already knew.
  */
  const [name, setName] = React.useState(preview?.displayName ?? "");

  /*
    Whether the warning about an odd-looking name has been shown and is being overridden.

    **The second press is the whole point.** `looksLikeFirstLast` is a guess about the shape of a
    person's name and it is wrong about somebody — a mononym, a name this application has no business
    refusing — so the first press explains and the second saves it regardless. A hard rule here would
    turn a nudge into a locked door on the one screen a fellow cannot get past.
  */
  const [warned, setWarned] = React.useState(false);

  const join = useMutation(
    trpc.enrollments.join.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.joined ? `You have joined ${result.name}.` : `You are already in ${result.name}.`,
        );
        /*
          Straight to the dashboard rather than into one course, because joining admits them to
          every course of the program and there is no single one to pick. It is also where they
          would have landed signing in, and where the sidebar now names every course they are in.
          Landing back on this screen after succeeding would read as nothing having happened.
        */
        router.push("/dashboard");
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

  const trimmed = name.trim();
  /*
    The same rule the procedure applies, read from the same module, so the button cannot offer a
    name the server then refuses. Only consulted when the field is on screen — a fellow joining
    their second program is not being asked anything and has nothing to get wrong.
  */
  const nameAccepted = !preview.firstProgram || displayNameSchema.safeParse(name).success;

  /**
   * The one press, and what it does depends on what is in the field.
   *
   * A name that reads as a first and last name joins immediately. One that does not stops here the
   * first time to say so, and goes through on the next press — which is what `warned` records, and
   * why typing in the field clears it: the confirmation has to be about the name actually saved.
   */
  const attemptJoin = () => {
    if (!preview.firstProgram) return join.mutate({ token });
    if (!looksLikeFirstLast(trimmed) && !warned) return setWarned(true);
    join.mutate({ token, displayName: trimmed });
  };

  return (
    <Shell>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <School className="size-6" />
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance">{preview.name}</h1>
          <p className="text-sm text-muted-foreground">
            {preview.term}
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
            <Button onClick={() => router.push("/dashboard")}>
              Open my work
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
              program at once, so a screen that offered the button without listing them would
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

            {/*
              A real form, so the return key joins. `items-center` keeps the button the size it has
              always been while the field below stretches, which is what a labelled input needs and
              a lone button does not.
            */}
            <form
              className="flex w-full flex-col items-center gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                attemptJoin();
              }}
            >
              {preview.firstProgram && (
                <div className="flex w-full flex-col gap-1.5 text-left">
                  <Label htmlFor="join-display-name">Your name</Label>
                  <Input
                    id="join-display-name"
                    value={name}
                    autoComplete="name"
                    /*
                      The ceiling stops the typing rather than refusing the save, matching the
                      Profile screen: a limit discovered by being turned away, after a name has been
                      typed out in full, is a limit that should have been a `maxLength`.
                    */
                    maxLength={DISPLAY_NAME_MAX_LENGTH}
                    disabled={join.isPending}
                    onChange={(event) => {
                      setName(event.target.value);
                      setWarned(false);
                    }}
                  />
                  {warned ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      That does not look like a first and last name. Press Join again to use it
                      anyway.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Your first and last name, as your instructors know you — for example, Ada
                      Lovelace. This is what appears on the roster and beside every piece of work
                      you hand in.
                    </p>
                  )}
                </div>
              )}

              <Button type="submit" disabled={join.isPending || !nameAccepted}>
                {join.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
                {warned ? "Join anyway" : "Join this program"}
              </Button>
            </form>
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
