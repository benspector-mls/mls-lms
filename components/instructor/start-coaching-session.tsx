"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

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
import { useServerMutation } from "@/hooks/use-server-mutation";
import { coachingSessionHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";

type Template = { id: string; name: string; isDefault: boolean };

/**
 * The one interactive thing on the record page's coaching section: make a draft, go to its form.
 * A draft is staff-only scratch until completing it, so there is nothing to confirm here.
 *
 * **Which form, when there is a choice.** With one form in the list the button starts at once;
 * with several it asks, the default preselected, because a session copies the form it starts
 * with and cannot change it afterwards. With none, it says who can write one.
 */
export function StartCoachingSession({
  programId,
  studentId,
  templates,
}: {
  programId: string;
  studentId: string;
  /** The forms a session can start from, default first, as `coaching.forStudent` lists them. */
  templates: readonly Template[];
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const settled = useServerMutation();
  const [choosing, setChoosing] = React.useState(false);
  const [chosen, setChosen] = React.useState<string>(
    () => (templates.find((template) => template.isDefault) ?? templates[0])?.id ?? "",
  );

  const start = useMutation(
    trpc.coaching.startSession.mutationOptions(
      settled({
        onSuccess: (session) => {
          setChoosing(false);
          router.push(coachingSessionHref(programId, studentId, session.id));
        },
      }),
    ),
  );

  const begin = (templateId: string) => start.mutate({ programId, studentId, templateId });

  if (templates.length === 0) {
    return (
      <div className="flex flex-col gap-1 self-start">
        <Button type="button" variant="outline" size="sm" disabled data-icon="inline-start">
          <Plus aria-hidden />
          Start coaching session
        </Button>
        <p className="text-xs text-muted-foreground">
          No coaching form exists yet. An admin creates one under Admin, Coaching forms.
        </p>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={start.isPending}
        onClick={() => (templates.length === 1 ? begin(templates[0]!.id) : setChoosing(true))}
        data-icon="inline-start"
      >
        {start.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
        Start coaching session
      </Button>

      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which form?</DialogTitle>
            <DialogDescription>
              The session is run through the form you choose, and keeps it however the form is
              changed afterwards.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Coaching form" className="flex flex-col gap-2">
            {templates.map((template) => (
              <label
                key={template.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-checked:border-primary"
              >
                <input
                  type="radio"
                  name="coaching-template"
                  value={template.id}
                  checked={chosen === template.id}
                  onChange={() => setChosen(template.id)}
                  className="size-4 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate">{template.name}</span>
                {template.isDefault && (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    Default
                  </Badge>
                )}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setChoosing(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={start.isPending || chosen === ""}
              onClick={() => begin(chosen)}
            >
              {start.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
