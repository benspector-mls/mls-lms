"use client";

import { useMutation } from "@tanstack/react-query";
import { Copy, Loader2, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { coachingFormHref } from "@/lib/links";
import { formatDate } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Templates = RouterOutputs["coachingTemplates"]["all"];

/**
 * The list of coaching forms, and the acts done to a form as a whole: make one, copy one, make
 * one the default, delete one. Editing what a form asks is the builder, one click in.
 *
 * **Deleting is always safe**, and the confirmation says why: a session copies the form it starts
 * with, so no session already begun is touched. What deleting the default does change is that
 * starting a session then asks which form to use every time, until an admin picks a new default.
 */
export function CoachingFormsAdmin({ templates }: { templates: Templates }) {
  const trpc = useTRPC();
  const router = useRouter();
  const settled = useServerMutation();
  const [name, setName] = React.useState("");
  const [deleting, setDeleting] = React.useState<Templates[number] | null>(null);

  const create = useMutation(
    trpc.coachingTemplates.create.mutationOptions(
      settled({ onSuccess: (created) => router.push(coachingFormHref(created.id)) }),
    ),
  );
  const duplicate = useMutation(
    trpc.coachingTemplates.duplicate.mutationOptions(
      settled({ onSuccess: (copy) => router.push(coachingFormHref(copy.id)) }),
    ),
  );
  const setDefault = useMutation(
    trpc.coachingTemplates.setDefault.mutationOptions(
      settled({ onSuccess: () => toast.success("That is the default form now.") }),
    ),
  );
  const remove = useMutation(
    trpc.coachingTemplates.remove.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Form deleted.");
          setDeleting(null);
        },
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "") return;
          create.mutate({ name: name.trim() });
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="new-form-name" className="text-sm font-medium">
            New form
          </label>
          <Input
            id="new-form-name"
            value={name}
            maxLength={120}
            placeholder="What the form is for, such as Mid-term check-in"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          disabled={create.isPending || name.trim() === ""}
          data-icon="inline-start"
        >
          {create.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Plus aria-hidden />
          )}
          Create
        </Button>
      </form>

      {templates.length === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          No coaching form yet. Nobody can start a session until one exists.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm"
            >
              <Link
                href={coachingFormHref(template.id)}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {template.name}
              </Link>
              {template.isDefault && (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  Default
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                Changed {formatDate(template.updatedAt)}
              </span>
              <div className="flex items-center gap-1">
                {!template.isDefault && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={setDefault.isPending}
                    onClick={() => setDefault.mutate({ id: template.id })}
                    data-icon="inline-start"
                  >
                    <Star aria-hidden />
                    Make default
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={duplicate.isPending}
                  onClick={() => duplicate.mutate({ id: template.id })}
                  data-icon="inline-start"
                >
                  <Copy aria-hidden />
                  Duplicate
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${template.name}`}
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleting(template)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Sessions already started keep their copy of this form and are not changed.
              {deleting?.isDefault &&
                " This is the default form, so starting a session will ask which form to use until another is made the default."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate({ id: deleting.id })}
            >
              {remove.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Delete form
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
