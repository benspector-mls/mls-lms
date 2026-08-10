"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { shownInPlace, useServerMutation } from "@/hooks/use-server-mutation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  displayNameOf,
  initials,
} from "@/lib/people";
import { formatDate } from "@/lib/status";
import { isTestStudent } from "@/lib/students/test-student";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Your own account: what you are called, and what this application knows about you.
 *
 * **One editable field and a page around it**, which is the right proportion rather than an
 * apology for a thin screen. The name is the only thing here anybody can change, and the rest is
 * on the page because a screen called Profile that showed a single input would leave the obvious
 * next questions — where did this name come from, what else is stored, who sees it — to be asked
 * somewhere there is nobody to ask.
 *
 * The name matters more than its size suggests. Every account arrives with one derived by the
 * signup trigger: a GitHub profile's full name where there is one, and otherwise the local part of
 * the email address. So a cohort's roster opens reading `bspector`, `amina.k`, `jrivera23` — and
 * those are the names on the gradebook's column of students, in the grading queue, and in the
 * sentence that says whose work is being read. This is the screen that fixes that, and it is the
 * reason it exists.
 */

type Profile = NonNullable<RouterOutputs["me"]>;

export function ProfileView({ profile }: { profile: Profile }) {
  return (
    <div className="flex flex-col gap-6">
      <NameCard profile={profile} />
      <AccountCard profile={profile} />
      <StoredDataCard />
    </div>
  );
}

/**
 * The one thing on this screen that is yours to change.
 *
 * **The avatar beside the field previews the initials as they are typed**, because the initials are
 * the half of the name most people never see themselves — they are what a roster row draws at the
 * size where the name does not fit, and a name that abbreviates badly is worth discovering while
 * the cursor is still in the box.
 *
 * The refusal renders under the field rather than in a toast, which is what `shownInPlace` says.
 * A message about what you typed has to stay on screen while you fix it, and a toast about a length
 * limit has usually gone by the time the text is selected.
 */
function NameCard({ profile }: { profile: Profile }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const saved = profile.displayName ?? "";
  const [value, setValue] = React.useState(saved);

  const update = useMutation(
    trpc.updateDisplayName.mutationOptions(
      settled({
        onSuccess: (result) => {
          toast.success(`You are ${result.displayName} everywhere in this application now.`);
        },
        onError: shownInPlace,
      }),
    ),
  );

  const trimmed = value.trim();
  const tooShort = trimmed.length < DISPLAY_NAME_MIN_LENGTH;
  const changed = trimmed !== saved;
  const canSave = changed && !tooShort && !update.isPending;

  /*
    What a reader would be called if this field were emptied rather than saved — the GitHub login,
    or failing that the email address. Shown as the preview's fallback so the avatar never draws a
    bare `?` while the box is momentarily empty, which reads as something having gone wrong.
  */
  const previewName = trimmed || displayNameOf({ ...profile, displayName: null }, "you");

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Your name</h2>
        <p className="text-xs text-muted-foreground">
          What instructors and classmates see: on a cohort&apos;s roster, on the gradebook, and
          beside every piece of work you hand in. Set it to the name you want to be called by.
        </p>
      </div>

      {/*
        A real form, so the return key saves. The field is the only one on it, and a single-input
        form that ignores Enter is the one interaction everybody tries first.
      */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) update.mutate({ displayName: trimmed });
        }}
      >
        <div className="flex items-end gap-3">
          <Avatar className="mb-0.5 size-10 shrink-0">
            <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
              {initials(previewName)}
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={value}
              autoComplete="name"
              /*
                The ceiling stops the typing rather than refusing the save. A limit discovered by
                being turned away, after a name has been typed out in full, is a limit that should
                have been a `maxLength`.
              */
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              disabled={update.isPending}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
        </div>

        {update.error ? (
          <p className="text-xs text-destructive">{update.error.message}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {/*
              The count appears as the ceiling is approached rather than sitting there from the
              first keystroke, so it is information at the moment it is worth having and quiet the
              rest of the time. Ten characters out is far enough to change course.
            */}
            {trimmed.length > DISPLAY_NAME_MAX_LENGTH - 10
              ? `${trimmed.length} of ${DISPLAY_NAME_MAX_LENGTH} characters.`
              : `Between ${DISPLAY_NAME_MIN_LENGTH} and ${DISPLAY_NAME_MAX_LENGTH} characters.`}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={!canSave}>
            {update.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Check data-icon="inline-start" />
            )}
            Save name
          </Button>
          {/*
            Only once there is something to undo. A permanently visible Cancel next to a field
            nobody has touched is a control that does nothing, and this one does something specific:
            it puts back the name that is actually stored.
          */}
          {changed && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => {
                setValue(saved);
                update.reset();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>

      {/*
        Under a test-student view this screen is the test student's, because every procedure in the
        request is. Said plainly, because the one way to get this wrong is to rename a preview
        identity while believing you are renaming yourself.
      */}
      {isTestStudent(profile) && (
        <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          This is Test Student {profile.testStudentNumber}&apos;s profile, not your own. Saving here
          renames the test student wherever it appears.
        </p>
      )}
    </section>
  );
}

/** How a role reads on screen, rather than as the enum it is stored as. */
const ROLE_LABEL: Record<Profile["role"], string> = {
  STUDENT: "Student",
  INSTRUCTOR: "Instructor",
  ADMIN: "Admin",
};

/**
 * The facts about the account that are not yours to type.
 *
 * Every one of them is settled elsewhere — by the identity provider, by an admin, by the moment
 * you signed up — and each says so. **Naming where a value comes from is what makes a read-only
 * row informative rather than merely disabled**: "Admin" beside a role, with nothing else, invites
 * exactly the question the sentence under it answers.
 */
function AccountCard({ profile }: { profile: Profile }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Your account</h2>
        <p className="text-xs text-muted-foreground">
          None of this is set here. Each row says what does set it.
        </p>
      </div>

      <dl className="flex flex-col gap-3">
        <Fact
          label="Email"
          value={profile.email ?? "—"}
          note="What you sign in with. This application does not change it — ask an instructor if it is wrong."
        />
        <Fact
          label="GitHub"
          value={
            profile.githubUsername ? (
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono">@{profile.githubUsername}</span>
              </span>
            ) : (
              "Not linked"
            )
          }
          note={
            profile.githubUsername
              ? "Recorded when you signed in with GitHub. Every repository handed to you is named after it, so it is fixed once your first assignment is accepted."
              : "Sign in with GitHub to link it. Until then, repository-backed assignments have no account to hand a repository to."
          }
        />
        <Fact
          label="Role"
          value={
            <Badge variant="secondary" className="font-normal">
              {ROLE_LABEL[profile.role]}
            </Badge>
          }
          note="Decided by an admin, on the Staff screen. It is what the application checks before every action, so it is not something an account can set about itself."
        />
        <Fact
          label="Member since"
          value={formatDate(profile.createdAt)}
          note="When this profile was created, which is the first time you signed in."
        />
      </dl>
    </section>
  );
}

/**
 * What this application holds about a person, said outright.
 *
 * **The list is short enough to print, which is the point.** A student who wants to know what a
 * school's software has on them should be able to read the answer rather than ask for it, and the
 * answer here is four columns and the work itself. Saying what is *absent* is the half that carries
 * the reassurance: no date of birth, no address, no phone number, nothing about how anybody is
 * paid — those are admissions records and payroll records, and they are not in here.
 *
 * Hard-coded rather than derived from the schema, deliberately. A generated list would grow a row
 * the moment a column was added, which sounds like an improvement and is the opposite: the value of
 * this card is that somebody decided each line belonged on it.
 */
function StoredDataCard() {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">What this application stores about you</h2>
      </div>

      <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs text-muted-foreground">
        <li>Your name, email address, and GitHub login — the four rows on this screen.</li>
        <li>Which cohorts you are in, and which groups within them.</li>
        <li>
          The work you hand in: the repository or link or file, when it arrived, and whether it was
          late.
        </li>
        <li>Your grades, and the feedback an instructor released with them.</li>
      </ul>

      <p className="text-xs text-muted-foreground">
        Date of birth, home address, phone number, government identifiers, or anything to
        do with payment are NOT collected by this application.
      </p>
      <p className="text-xs text-muted-foreground">
        Instructors on your cohort can read your work and your grades; nobody
        outside it can. Code you hand in through a repository also lives on GitHub, in private
        repositories owned by the Marcy Lab School.
      </p>
    </section>
  );
}

/** One labelled fact, with the sentence that says where it came from. */
function Fact({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="shrink-0 pt-0.5 text-xs text-muted-foreground sm:w-28">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm break-words">{value}</span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </dd>
    </div>
  );
}
