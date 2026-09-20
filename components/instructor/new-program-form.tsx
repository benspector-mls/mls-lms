"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DISCIPLINES, DISCIPLINE_META, type Discipline } from "@/lib/competencies";
import { rosterHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";

/**
 * Starting a program.
 *
 * **Three fields and no review step**, which is the opposite of creating a course and deliberately so.
 * A course settles a short name that every repository it generates is named after, so it cannot be
 * taken back and gets a page of its own to be read on. A program is created empty: nothing is
 * named after it, nothing has been generated, and one made by mistake is deleted in three clicks.
 *
 * **The name and the term both, because either alone is ambiguous.** A school runs several programs a year and each
 * program runs every year, so "Software Engineering Fellowship" and "Fall 2026" are each half of an
 * identity — which is why they are a unique pair in the database, and why the refusal for a duplicate
 * says which half to check.
 *
 * **The discipline is the one field that is not identity.** It decides which competencies this
 * program's fellows are offered goals from, and it is changed later from the program's settings
 * screen — unlike the name and the term, which are half of the program's identity each and are
 * fixed by creating the program again.
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
  const [discipline, setDiscipline] = React.useState<Discipline>("SOFTWARE_ENGINEERING");

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
        if (ready) create.mutate({ name: name.trim(), term: term.trim(), discipline });
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

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="program-discipline">
          Discipline
        </label>
        <Select value={discipline} onValueChange={(value) => setDiscipline(value as Discipline)}>
          <SelectTrigger id="program-discipline" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DISCIPLINES.map((option) => (
              <SelectItem key={option} value={option}>
                {DISCIPLINE_META[option].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Which fellowship this is a run of. It decides which competencies its fellows choose their
          goals from, and it can be changed later from this program&apos;s settings.
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
