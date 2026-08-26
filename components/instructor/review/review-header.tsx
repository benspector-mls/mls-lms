"use client";

/**
 * The row above the review: who this is, what state their work is in, and the way to the code.
 *
 * Also the notice about a report whose delivery to GitHub failed, which sits directly under the
 * header for the same reason it is a card and not a toast: it is a state to act on rather than an
 * event that happened.
 */

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  FolderGit2,
  GitPullRequest,
  Loader2,
  MessageSquare,
  RotateCcw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { DraftStatusBadge, SubmissionStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { draftStatusAddsSomething } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Draft, DraftList, QueueSubmission } from "@/components/instructor/review/shared";
export function ReviewHeader({
  awaitsReply = false,
  submission,
  draft,
  studentHref,
  actionsRef,
}: {
  /** Whether a fellow has asked something nobody has answered. */
  awaitsReply?: boolean;
  submission: QueueSubmission;
  draft: Draft | null;
  studentHref?: string;
  /** Filled by whatever is being reviewed — see `HeaderActionsSlot`. */
  actionsRef: (node: HTMLDivElement | null) => void;
}) {
  /*
    A member's own record, built from the link this screen was already given.

    `studentHref` names the student whose row is open, so swapping the id in it is how each
    teammate gets a link without this component being told the course. It is optional — the
    student overview passes none — and where it is absent nobody is linked.
  */
  const memberHref = (memberId: string) =>
    studentHref ? studentHref.replace(submission.student.id, memberId) : "";

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border bg-card px-5 py-4">
      <div className="flex flex-col gap-1">
        {/*
          The name, the handle, and the way to the code on one row.

          One link, never two. The pull request is where the work, the commits, and the graded
          diff all are, and a closed pull request still opens, so nothing is lost when a student
          closes theirs. The repository stands in only where there is no pull request to open
          yet — a student who has accepted the assignment and not pushed anything — because that
          is the one state in which an instructor otherwise has no way to the student's code.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            {submission.team ? (
              /*
                The team, not a member of it. What is being read is one piece of work that four
                people did, and heading it with whichever of them happened to claim the row would
                name somebody the report is not about — and would be the same name for every team
                whose work they claimed.

                Unlinked, deliberately: a link on a person's name goes to their record, and a team
                has none. The members below are each linked instead.
              */
              submission.team.name
            ) : studentHref ? (
              <Link href={studentHref} className="hover:underline">
                {submission.student.displayName ?? submission.student.email ?? "Unknown student"}
              </Link>
            ) : (
              (submission.student.displayName ?? submission.student.email ?? "Unknown student")
            )}
          </h2>
          {/*
            The handle only where the repository is named after it. A team's repository is named
            after the team, so a member's handle here would suggest it was theirs.
          */}
          {!submission.team && submission.student.githubUsername && (
            <span className="text-sm text-muted-foreground">
              @{submission.student.githubUsername}
            </span>
          )}
          {submission.prUrl ? (
            <a
              href={submission.prUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-1")}
            >
              <GitPullRequest data-icon="inline-start" />
              PR #{submission.prNumber}
              <ExternalLink data-icon="inline-end" />
            </a>
          ) : (
            submission.repoUrl && (
              <a
                href={submission.repoUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-1")}
              >
                <FolderGit2 data-icon="inline-start" />
                Repository
                <ExternalLink data-icon="inline-end" />
              </a>
            )
          )}
        </div>
        {/*
          Who is on the team, and which of them handed in the version being read.

          Named rather than counted, because the release below goes to all of them and a count
          cannot show a team whose membership is wrong. Each name links to that fellow's own
          record, which is the question a report prompts about a member — the heading above cannot
          carry that link, because a team has no record of its own.
        */}
        {submission.team && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            <Users className="size-3.5 shrink-0" />
            <span>{submission.team.setName}</span>
            <span aria-hidden>·</span>
            {submission.team.members.map((member, index) => {
              const label = member.displayName ?? member.email ?? "Unknown";
              const href = memberHref(member.id);
              return (
                <span key={member.id}>
                  {href ? (
                    <Link href={href} className="text-foreground hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <span className="text-foreground">{label}</span>
                  )}
                  {index < submission.team!.members.length - 1 && ","}
                </span>
              );
            })}
            {submission.team.handedInBy && (
              <span>
                · handed in by{" "}
                <span className="text-foreground">
                  {submission.team.handedInBy.displayName ?? "a member"}
                </span>
              </span>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SubmissionStatusBadge status={submission.status} />
          {draft && draftStatusAddsSomething(draft.status) && (
            <DraftStatusBadge status={draft.status} />
          )}
          {submission.isLate && (
            <Badge variant="outline" className="font-normal">
              Late
            </Badge>
          )}
          {/*
            In the header because the header is what an instructor can still see from the bottom of
            a long report — the same reason the approve button is portalled into it. An anchor
            rather than a plain badge, because a badge saying something is below with no way down
            is a statement and not a control.
          */}
          {awaitsReply && (
            <Badge
              render={<a href={`#comments-${submission.student.id}`} />}
              variant="outline"
              className="border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
            >
              <MessageSquare data-icon="inline-start" />
              Reply owed
            </Badge>
          )}
        </div>
      </div>

      <div ref={actionsRef} className="flex flex-wrap items-center justify-end gap-3" />
    </header>
  );
}

/**
 * A grade that was recorded but whose comment never reached the pull request.
 *
 * The grade and the comment are written in two steps on purpose, so a GitHub outage
 * during approval leaves a real grade and an unsent comment rather than losing both.
 * This is the way out of that state that does not involve approving twice.
 */
export function CommentRecoveryNotice({
  submission,
  grade,
}: {
  submission: QueueSubmission;
  grade: DraftList["grade"];
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const retry = useMutation(
    trpc.gradingDrafts.retryComment.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Comment posted to the pull request.");
        },
      }),
    ),
  );

  // Only a real failure. `not_applicable` — a hand-graded assignment with no pull request
  // — is a finished grade, and offering it a retry would offer a button that cannot
  // succeed against a fault that does not exist.
  if (grade?.delivery !== "failed") return null;

  return (
    <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      <AlertTriangle className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>The feedback comment was never posted</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>
          This grade is recorded and the student can see it in the application, but the comment did
          not reach the pull request. The score is safe; only the comment is missing.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={retry.isPending}
          onClick={() => retry.mutate({ submissionId: submission.id })}
        >
          {retry.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <RotateCcw data-icon="inline-start" />
          )}
          {retry.isPending ? "Posting…" : "Post the comment"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
