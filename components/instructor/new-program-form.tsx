"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rosterHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";

/**
 * Starting a program.
 *
 * **Two fields and no review step**, which is the opposite of creating a course and deliberately so.
 * A course settles a short name that every repository it generates is named after, so it cannot be
 * taken back and gets a page of its own to be read on. A program is created empty: nothing is
 * named after it, nothing has been generated, and one made by mistake is deleted in three clicks.
 *
 * **Both fields, because either alone is ambiguous.** A school runs several programs a year and each
 * program runs every year, so "Software Engineering Fellowship" and "Fall 2026" are each half of an
 * identity — which is why they are a unique pair in the database, and why the refusal for a duplicate
 * says which half to check.
 *
 * **Nothing is copied.** Carrying a term forward is done course by course, from the new
 * program's settings screen, where each course names the one it is copying from. A whole-program
 * copy is that same operation once per course and is deliberately not built yet.
 *
 * **It sits beneath the page heading and not beside it**, because the term field is explained by a
 * paragraph and a paragraph does not fit in the strip of a heading row. The button that opens it is
 * what belongs up there; the screen that opens is the width of the page.
 */
export function NewProgramForm({
  onClose,
}: {
  /** Close the form and put the button back. Called on cancel and after a program is created. */
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const [name, setName] = React.useState("");
  const [term, setTerm] = React.useState("");

  const create = useMutation(
    trpc.programs.create.mutationOptions({
      onSuccess: (program) => {
        toast.success(`Created ${program.name} · ${program.term}. It has no courses yet.`);
        onClose();
        /*
          The roster, which is the first thing a new program needs: who is expected, and the
          link to send them. Its courses come next and are added from its settings screen, but a
          course with nobody on the roster has nobody to hand anything to.
        */
        router.push(rosterHref(program.id));
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const ready = name.trim() !== "" && term.trim() !== "";

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) create.mutate({ name: name.trim(), term: term.trim() });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="program-name">
          Program
        </label>
        <Input
          id="program-name"
          value={name}
          autoFocus
          placeholder="Software Engineering Fellowship"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="program-term">
          Term
        </label>
        <Input
          id="program-term"
          value={term}
          placeholder="Fall 2026"
          onChange={(event) => setTerm(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          When this run of the program starts, in whatever words you use for it. It is what tells
          this year of {name.trim() || "a program"} from every other one, so it appears beside the
          name everywhere — in the switcher, in every breadcrumb, and in the name of every exported
          file.
        </p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={!ready || create.isPending}>
          {create.isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
          Create program
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          disabled={create.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
