"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronUp, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  DISCIPLINES,
  DISCIPLINE_META,
  ENTRY_KINDS,
  type CompetencyEntryKind,
  type Discipline,
} from "@/lib/competencies";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Sections = RouterOutputs["competencies"]["all"];
type Section = Sections[number];
type Competency = Section["competencies"][number];
type Entry = Competency["entries"][number];

/** Every section, for the field that moves a competency from one to another. */
type SectionChoice = { id: string; name: string };

/**
 * Writing the competency list: the sections, the competencies under them, and the indicators and
 * pitfalls a fellow builds a goal on.
 *
 * **One list for the whole school, and every level of it is written here.** Which fellowships a
 * competency is offered to is a property of the competency — the sections about how a person works
 * and learns belong to both, a technical section to one — so the two fellowships share everything
 * they have in common instead of keeping two lists that drift.
 *
 * **Editing this can never damage a goal.** A goal copies its entry's wording when it is set and
 * never reads it back, so rewording, moving, or deleting anything here leaves every goal already
 * written exactly as its author wrote it. The screen says so beside the controls that would
 * otherwise look dangerous, because "will this delete somebody's goal" is the question an admin
 * will have and the answer is no.
 *
 * **Entries are one sequence per competency**, ordered as they are shown here. The goal picker
 * gathers the skills together and the pitfalls together for reading, keeping the order within each
 * — so an admin who keeps the two kinds apart sees the same list a fellow does.
 */
export function CompetencyAdmin({ sections }: { sections: Sections }) {
  const [adding, setAdding] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm">
          Every program shares this list. A competency reaches a fellow when it is offered to the
          discipline their program runs, so the sections about how somebody works and learns are
          usually offered to both.
        </p>
        <p className="text-xs text-muted-foreground">
          Goals already set keep the wording they were built on, whatever you change here. Nothing
          on this screen can alter or remove one.
        </p>
      </div>

      {sections.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
          There are no sections yet. Add the first one — &ldquo;Durable Skills&rdquo;, say — and the
          competencies go under it.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              all={sections.map((row) => ({ id: row.id, name: row.name }))}
              order={sections.map((row) => row.id)}
              index={index}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <SectionForm section={null} onDone={() => setAdding(false)} />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAdding(true)}
          data-icon="inline-start"
        >
          <Plus aria-hidden />
          Add a section
        </Button>
      )}
    </div>
  );
}

/** One section: its name, what it holds, and where a competency is added to it. */
function SectionCard({
  section,
  all,
  order,
  index,
}: {
  section: Section;
  all: SectionChoice[];
  order: string[];
  index: number;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [open, setOpen] = React.useState(true);
  const [renaming, setRenaming] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const remove = useMutation(
    trpc.competencies.removeGroup.mutationOptions(
      settled({ onSuccess: () => toast.success(`Removed ${section.name}.`) }),
    ),
  );

  const held = section.competencies.length;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="truncate text-sm font-medium">{section.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {held === 1 ? "1 competency" : `${held} competencies`}
          </span>
        </button>

        <MoveButtons of="groups" within={null} order={order} index={index} label="section" />

        <Button type="button" variant="ghost" size="xs" onClick={() => setRenaming(true)}>
          Rename
        </Button>

        {/*
          Only offered on an empty section. The procedure refuses a full one and names the count,
          and the foreign key refuses it underneath — but a control that is there and always fails
          teaches an admin to distrust the screen rather than the list.
        */}
        {held === 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ groupId: section.id })}
            className="text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        )}
      </div>

      {renaming && <SectionForm section={section} onDone={() => setRenaming(false)} />}

      {open && (
        <>
          {held > 0 && (
            <ul className="flex flex-col gap-3">
              {section.competencies.map((competency, competencyIndex) => (
                <CompetencyBlock
                  key={competency.id}
                  competency={competency}
                  sections={all}
                  groupId={section.id}
                  order={section.competencies.map((row) => row.id)}
                  index={competencyIndex}
                />
              ))}
            </ul>
          )}

          {adding ? (
            <CompetencyForm
              competency={null}
              sections={all}
              groupId={section.id}
              onDone={() => setAdding(false)}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="self-start"
              onClick={() => setAdding(true)}
              data-icon="inline-start"
            >
              <Plus aria-hidden />
              Add a competency
            </Button>
          )}
        </>
      )}
    </li>
  );
}

/** One competency: what it is called, who it is offered to, and the entries beneath it. */
function CompetencyBlock({
  competency,
  sections,
  groupId,
  order,
  index,
}: {
  competency: Competency;
  sections: SectionChoice[];
  groupId: string;
  order: string[];
  index: number;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [editing, setEditing] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const remove = useMutation(
    trpc.competencies.removeCompetency.mutationOptions(
      settled({
        onSuccess: () =>
          toast.success(`Removed ${competency.name}. Goals built on it keep their wording.`),
      }),
    ),
  );

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{competency.name}</span>
          {competency.blurb !== "" && (
            <span className="text-xs text-muted-foreground">{competency.blurb}</span>
          )}
          <span className="flex flex-wrap items-center gap-1.5">
            {competency.disciplines.length === 0 ? (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                Offered to nobody
              </Badge>
            ) : (
              competency.disciplines.map((discipline) => (
                <Badge key={discipline} variant="outline">
                  {DISCIPLINE_META[discipline].label}
                </Badge>
              ))
            )}
          </span>
        </div>

        <MoveButtons
          of="competencies"
          within={groupId}
          order={order}
          index={index}
          label="competency"
        />

        <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ competencyId: competency.id })}
          className="text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      </div>

      {editing && (
        <CompetencyForm
          competency={competency}
          sections={sections}
          groupId={groupId}
          onDone={() => setEditing(false)}
        />
      )}

      <ul className="flex flex-col">
        {competency.entries.map((entry, entryIndex) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            competencyId={competency.id}
            order={competency.entries.map((row) => row.id)}
            index={entryIndex}
          />
        ))}
      </ul>

      {adding ? (
        <EntryForm entry={null} competencyId={competency.id} onDone={() => setAdding(false)} />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="self-start"
          onClick={() => setAdding(true)}
          data-icon="inline-start"
        >
          <Plus aria-hidden />
          Add a skill or pitfall
        </Button>
      )}
    </li>
  );
}

/** One indicator or pitfall. */
function EntryRow({
  entry,
  competencyId,
  order,
  index,
}: {
  entry: Entry;
  competencyId: string;
  order: string[];
  index: number;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [editing, setEditing] = React.useState(false);

  const remove = useMutation(
    trpc.competencies.removeEntry.mutationOptions(
      settled({ onSuccess: () => toast.success("Removed. Goals built on it keep their wording.") }),
    ),
  );

  if (editing) {
    return (
      <li className="py-1">
        <EntryForm entry={entry} competencyId={competencyId} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-muted/40">
      <span
        className={`mt-2 size-1.5 shrink-0 rounded-full ${
          entry.kind === "PITFALL" ? "bg-amber-500" : "bg-muted-foreground/40"
        }`}
        aria-hidden
      />
      <span className="min-w-0 flex-1 py-0.5 text-sm">{entry.text}</span>
      {entry.kind === "PITFALL" && (
        <Badge variant="outline" className="shrink-0 text-amber-700 dark:text-amber-400">
          Pitfall
        </Badge>
      )}

      <MoveButtons of="entries" within={competencyId} order={order} index={index} label="entry" />

      <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label="Delete this entry"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ entryId: entry.id })}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

/**
 * Up and down for one row of one sequence.
 *
 * **Sends the whole order rather than the move**, because that is what the procedure takes: an
 * order that does not name exactly the rows of its level is refused rather than half-applied, so
 * two admins editing at once cannot interleave into a sequence neither of them chose.
 */
function MoveButtons({
  of,
  within,
  order,
  index,
  label,
}: {
  of: "groups" | "competencies" | "entries";
  within: string | null;
  order: string[];
  index: number;
  label: string;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const reorder = useMutation(trpc.competencies.reorder.mutationOptions(settled({})));

  const move = (to: number) => {
    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);

    /*
      The union in the procedure's input pairs `of` with what `within` may be — null for the
      sections, an id for the other two — so the call is written out per branch rather than spread
      from one object the type cannot narrow.
    */
    if (of === "groups") reorder.mutate({ of, within: null, ids: next });
    else if (within !== null) reorder.mutate({ of, within, ids: next });
  };

  return (
    <span className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={`Move this ${label} up`}
        disabled={index === 0 || reorder.isPending}
        onClick={() => move(index - 1)}
      >
        <ChevronUp aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={`Move this ${label} down`}
        disabled={index === order.length - 1 || reorder.isPending}
        onClick={() => move(index + 1)}
      >
        <ChevronDown aria-hidden />
      </Button>
    </span>
  );
}

/** Adding a section, or renaming one. */
function SectionForm({ section, onDone }: { section: Section | null; onDone: () => void }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [name, setName] = React.useState(section?.name ?? "");

  const save = useMutation(
    trpc.competencies.saveGroup.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success(section === null ? "Section added." : "Section renamed.");
          onDone();
        },
      }),
    ),
  );

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() !== "") {
          save.mutate({ groupId: section?.id ?? null, name: name.trim() });
        }
      }}
    >
      <Input
        autoFocus
        value={name}
        placeholder="Durable Skills"
        aria-label="Section name"
        onChange={(event) => setName(event.target.value)}
        className="w-full sm:w-72"
      />
      <Button type="submit" size="sm" disabled={name.trim() === "" || save.isPending}>
        {section === null ? "Add section" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

/** Adding a competency to a section, or changing one — including which section it sits in. */
function CompetencyForm({
  competency,
  sections,
  groupId,
  onDone,
}: {
  competency: Competency | null;
  sections: SectionChoice[];
  /** The section it is in now, which is where a new one is added. */
  groupId: string;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [name, setName] = React.useState(competency?.name ?? "");
  const [blurb, setBlurb] = React.useState(competency?.blurb ?? "");
  const [disciplines, setDisciplines] = React.useState<ReadonlySet<Discipline>>(
    new Set(competency?.disciplines ?? DISCIPLINES),
  );
  const [section, setSection] = React.useState(groupId);

  const save = useMutation(
    trpc.competencies.saveCompetency.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success(competency === null ? "Competency added." : "Competency saved.");
          onDone();
        },
      }),
    ),
  );

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === "") return;
        save.mutate({
          competencyId: competency?.id ?? null,
          groupId: section,
          name: name.trim(),
          blurb: blurb.trim(),
          disciplines: [...disciplines],
        });
      }}
    >
      <Input
        autoFocus
        value={name}
        placeholder="Growth Mindset"
        aria-label="Competency name"
        onChange={(event) => setName(event.target.value)}
      />

      <Textarea
        value={blurb}
        rows={2}
        placeholder="One line saying what this competency is."
        aria-label="What this competency is"
        onChange={(event) => setBlurb(event.target.value)}
      />

      {/*
        Only when changing one. A new competency belongs to the section whose "Add a competency"
        was pressed, and a field offering to put it somewhere else would be asking a question the
        press already answered.
      */}
      {competency !== null && sections.length > 1 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Section</span>
          <Select value={section} onValueChange={(value) => value && setSection(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            Moving it puts it at the end of the section it lands in.
          </span>
        </label>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium">Offered to</legend>
        {DISCIPLINES.map((discipline) => (
          <label key={discipline} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={disciplines.has(discipline)}
              onCheckedChange={(next) =>
                setDisciplines((current) => {
                  const copy = new Set(current);
                  if (next === true) copy.add(discipline);
                  else copy.delete(discipline);
                  return copy;
                })
              }
            />
            {DISCIPLINE_META[discipline].label}
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={name.trim() === "" || save.isPending}>
          {competency === null ? "Add competency" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Adding an indicator or a pitfall, or rewriting one. */
function EntryForm({
  entry,
  competencyId,
  onDone,
}: {
  entry: Entry | null;
  competencyId: string;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [text, setText] = React.useState(entry?.text ?? "");
  const [kind, setKind] = React.useState<CompetencyEntryKind>(entry?.kind ?? "INDICATOR");

  const save = useMutation(
    trpc.competencies.saveEntry.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success(entry === null ? "Added." : "Saved.");
          onDone();
        },
      }),
    ),
  );

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() === "") return;
        save.mutate({ entryId: entry?.id ?? null, competencyId, kind, text: text.trim() });
      }}
    >
      <Textarea
        autoFocus
        value={text}
        rows={2}
        placeholder="Asks for help when stuck rather than struggling in silence."
        aria-label="What this skill or pitfall says"
        onChange={(event) => setText(event.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(value) => setKind(value as CompetencyEntryKind)}>
          <SelectTrigger className="w-44" aria-label="Which kind this is">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTRY_KINDS.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "INDICATOR" ? "Skill to work toward" : "Pitfall to work away from"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button type="submit" size="sm" disabled={text.trim() === "" || save.isPending}>
          {entry === null ? "Add" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
