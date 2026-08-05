'use client';

import { useMutation } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';

/**
 * Accepting an assignment creates something, so it is a mutation the student triggers
 * rather than something that happens while a page renders. That is what makes this a
 * client component.
 *
 * Labelled "Accept" rather than "Accept on GitHub", because accepting is the step and how
 * it is carried out depends on the kind: a repository is generated from a template, and a
 * Google Doc assignment sends the student to Google's own prompt to take a copy. The
 * procedure returns `copyUrl` when there is somewhere to be sent, so this component does
 * not have to know which kind it is looking at.
 */
export function AcceptAssignmentButton({
  assignmentId,
  kind,
}: {
  assignmentId: string;
  kind: 'REPO' | 'GOOGLE_DOC' | 'FILE_UPLOAD';
}) {
  const trpc = useTRPC();
  const router = useRouter();

  /*
    Held so the link can be offered when the tab could not be opened. A pop-up blocker
    refusing `window.open` is ordinary and not an error: the copy prompt is where the
    student needs to go, so the fallback has to be a link they can click themselves rather
    than a message telling them it failed.
  */
  const [copyUrl, setCopyUrl] = React.useState<string | null>(null);

  const accept = useMutation(
    trpc.assignments.accept.mutationOptions({
      onSuccess: (result) => {
        if (result.copyUrl) {
          setCopyUrl(result.copyUrl);
          const opened = window.open(result.copyUrl, '_blank', 'noopener,noreferrer');
          if (opened) opened.focus();
        }
        // Re-renders the server component, so the row picks up its new status and its
        // repository or document link.
        router.refresh();
      },
    }),
  );

  return (
    <>
      <Button
        size="sm"
        onClick={() => accept.mutate({ assignmentId })}
        disabled={accept.isPending}
      >
        {accept.isPending
          ? kind === 'GOOGLE_DOC'
            ? 'Opening Google Docs…'
            : 'Creating repository…'
          : kind === 'GOOGLE_DOC'
            ? 'Accept and copy the doc'
            : 'Accept'}
      </Button>

      {copyUrl && (
        <a
          href={copyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Open your copy of the document
          <ExternalLink className="size-3.5" />
        </a>
      )}

      {/*
        Full width so the message wraps under the row rather than stretching it. Failures
        here are things the student can act on — an unlinked GitHub account, most often —
        so the text has to be readable, not truncated into a row.
      */}
      {accept.error && (
        <p className="w-full text-sm text-destructive" role="alert">
          {accept.error.message}
        </p>
      )}
    </>
  );
}
