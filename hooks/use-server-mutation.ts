"use client";

import { useQueryClient, type UseMutationOptions } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

/**
 * A mutation whose result is on a server-rendered screen.
 *
 * **Two refreshes, because there are two caches, and forgetting either leaves the screen wrong
 * in a way that looks like the mutation failed.** Instructor screens are server components: the
 * roster, the module list and the gradebook are rendered on the server and arrive as HTML, so
 * the browser holds no query to invalidate and only `router.refresh()` re-runs them. Anything
 * fetched through the tRPC client — a group picker, a validation preview — is the opposite: it
 * lives in React Query and `router.refresh()` does not touch it. Most screens have both.
 *
 * That is why this is one hook rather than a convention. The pair was written out at twenty-odd
 * call sites and five of them had invented a local `settled` object to stop repeating it, in
 * four different flavours: some refreshed, some invalidated, two did both, and nothing said
 * which was correct — a mutation that only refreshed left a stale list in a dropdown, and one
 * that only invalidated left the old name on the page behind the dialog. Doing both is the
 * answer at every one of them, and `invalidateQueries()` with no filter is cheap here precisely
 * because these screens are server-rendered: there are few active client queries to refetch.
 *
 * It **wraps** the options rather than replacing them, so a call site keeps its own `onSuccess`
 * for what is local to it — closing a dialog, clearing a field, naming what happened in a toast —
 * and loses only the two lines it could get wrong. Wrapping is also what keeps inference intact:
 * the object is still contextually typed by `mutationOptions`, so `onSuccess` still knows what
 * the procedure returned and no call site has to write a type argument.
 *
 * `onError` is a default rather than an addition. A call site that wants a different refusal —
 * one that sets form state, or names the field — passes its own and this steps aside; one that
 * passes nothing gets the message in a toast, which is better than the silence that four sites
 * had.
 *
 * ```tsx
 * const settled = useServerMutation();
 * const remove = useMutation(
 *   trpc.enrollments.remove.mutationOptions(
 *     settled({ onSuccess: (result) => toast.success(`Removed ${result.studentName}.`) }),
 *   ),
 * );
 * ```
 */
/**
 * `onError` for a form that renders the refusal itself.
 *
 * A few screens print `mutation.error.message` beside the field it is about, which is better
 * than a toast for a message about what you typed — it stays while you fix it. Those want the
 * default *off*, and a bare `() => {}` at the call site reads as a swallowed error rather than
 * as a decision. This says which it is.
 */
export const shownInPlace = () => {};

export function useServerMutation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return React.useCallback(
    <TData, TError extends { message: string }, TVariables, TOnMutateResult>(
      options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult> = {},
    ): UseMutationOptions<TData, TError, TVariables, TOnMutateResult> => ({
      ...options,

      /*
        The call site's own success handler runs first, and the refreshes after.

        Order matters for the dialogs: closing one in `onSuccess` and then refreshing renders the
        new data behind a dialog that has already gone, rather than under one still fading out.

        Spread from `Parameters` rather than named, because React Query has changed this
        signature — it takes four arguments in this version and took three before — and a
        wrapper that names them silently drops whatever is added next.
      */
      onSuccess: (...args: Parameters<NonNullable<typeof options.onSuccess>>) => {
        options.onSuccess?.(...args);
        void queryClient.invalidateQueries();
        router.refresh();
      },

      onError:
        options.onError ??
        ((error) => {
          toast.error(error.message);
        }),
    }),
    [queryClient, router],
  );
}
