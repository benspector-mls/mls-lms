'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/status';
import { useTRPC } from '@/trpc/client';
import type { RouterOutputs } from '@/trpc/types';

/**
 * Accepting an instructor invitation.
 *
 * **A button rather than granting on arrival**, for the same reason the course join screen has
 * one, and more so: opening a link is not consent to become staff, and a page that promoted on
 * load would promote anybody who clicked a URL to see what it was. It also gives the one screen
 * where this can be said a place to say what accepting means — this is access to every course and
 * every student's grades, not a seat in a class.
 *
 * Every refusal is the procedure's message rather than a state handled here: an unknown link, an
 * expired one, one somebody else has used. The procedure is the authority on all three.
 */
export function AcceptInvite({
  token,
  preview,
}: {
  token: string;
  preview: RouterOutputs['staff']['previewInvite'];
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const redeem = useMutation(
    trpc.staff.redeemInvite.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.alreadyRedeemed
            ? 'You already have instructor access.'
            : 'You are now an instructor.',
        );
        /*
          `refresh()` as well as the push, because the sidebar reads the role from the profile and
          it was fetched before this changed. Without it the instructor navigation would not appear
          until a manual reload, which reads as the invitation not having worked.
        */
        router.refresh();
        router.push('/courses');
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!preview) {
    return (
      <Shell>
        <TriangleAlert className="size-8 text-amber-600 dark:text-amber-400" />
        <h1 className="text-lg font-semibold">This invitation link does not work</h1>
        <p className="text-sm text-muted-foreground">
          It may have been deleted. Ask whoever sent it for a new one.
        </p>
      </Shell>
    );
  }

  // Their own, opened again — a bookmark, or a second click. Not an error.
  if (preview.redeemedByYou) {
    return (
      <Shell>
        <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
          <Check className="size-4" />
          You already have instructor access.
        </p>
        <Button onClick={() => router.push('/courses')}>
          Go to your courses
          <ArrowRight data-icon="inline-end" />
        </Button>
      </Shell>
    );
  }

  if (preview.state === 'redeemed') {
    return (
      <Shell>
        <TriangleAlert className="size-8 text-amber-600 dark:text-amber-400" />
        <h1 className="text-lg font-semibold">This invitation has already been used</h1>
        <p className="text-sm text-muted-foreground">
          Each one works once. Ask whoever sent it for a new link.
        </p>
      </Shell>
    );
  }

  if (preview.state === 'expired') {
    return (
      <Shell>
        <TriangleAlert className="size-8 text-amber-600 dark:text-amber-400" />
        <h1 className="text-lg font-semibold">This invitation has expired</h1>
        <p className="text-sm text-muted-foreground">
          It stopped working on {formatDate(preview.expiresAt)}. Ask whoever sent it for a new one.
        </p>
      </Shell>
    );
  }

  /*
    Said plainly, because an admin accepting one keeps their admin role and the obvious reading of
    "become an instructor" is that it would take something away. The person most likely to click a
    link to see what it does is the admin who just generated it.
  */
  const alreadyStaff = preview.yourRole === 'ADMIN' || preview.yourRole === 'INSTRUCTOR';

  return (
    <Shell>
      <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <ShieldCheck className="size-6" />
      </div>

      <h1 className="text-xl font-semibold text-balance">Become an instructor</h1>

      <p className="text-sm text-muted-foreground">
        Accepting lets you create cohorts, author assignments, and read and grade the work of every
        student in every course you are added to.
      </p>

      {alreadyStaff && (
        <p className="text-sm text-muted-foreground">
          You already have{' '}
          {preview.yourRole === 'ADMIN' ? 'admin' : 'instructor'} access, and accepting will not
          change it.
        </p>
      )}

      <Button disabled={redeem.isPending} onClick={() => redeem.mutate({ token })}>
        {redeem.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
        Accept invitation
      </Button>

      <p className="text-xs text-muted-foreground">
        This link works once and expires on {formatDate(preview.expiresAt)}.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col p-4 md:p-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
