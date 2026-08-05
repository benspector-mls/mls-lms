'use client';

import { useMutation } from '@tanstack/react-query';
import { Download, FileUp, Loader2 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';
import { formatBytes } from '@/lib/uploads/file-types';

/**
 * One uploaded file, with a button that fetches it.
 *
 * Shared between the student's own view of what they handed in and the instructor's review
 * screen, because both need the same thing and the reason it cannot be a plain link is the
 * same for both: **the bucket is private, so there is no URL that keeps working.** A download
 * is a signed link minted for one request and valid for minutes, which is what makes the
 * procedure that authorizes the caller the only route to the bytes.
 *
 * The link is fetched when the button is pressed rather than when the row renders. A URL
 * minted on render would have expired by the time an instructor working through a queue
 * reached it, and a list of forty students would mint forty links nobody clicked.
 */
export function UploadedFileRow({
  submissionId,
  filename,
  sizeBytes,
  isLate = false,
  label = 'The file you submitted',
}: {
  submissionId: string;
  filename: string;
  sizeBytes: number | null;
  isLate?: boolean;
  label?: string;
}) {
  const trpc = useTRPC();
  const [error, setError] = React.useState<string | null>(null);

  const link = useMutation(
    trpc.submissions.uploadUrl.mutationOptions({
      onSuccess: ({ url }) => {
        setError(null);
        /*
          An anchor clicked from script rather than assigning `location`. The signed URL
          answers with `Content-Disposition: attachment`, so this downloads without navigating
          the page away from a report the instructor is part-way through reading — and unlike
          `window.open` it is not treated as a popup, which is blocked in Safari when it
          happens after an await.
        */
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.rel = 'noreferrer';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      },
      onError: (err) => setError(err.message),
    }),
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileUp className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">
              {label}
              {isLate ? ' (late)' : ''}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {filename}
              {sizeBytes === null ? '' : ` — ${formatBytes(sizeBytes)}`}
            </span>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={link.isPending}
          onClick={() => link.mutate({ submissionId })}
        >
          {link.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          {link.isPending ? 'Preparing…' : 'Download'}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
