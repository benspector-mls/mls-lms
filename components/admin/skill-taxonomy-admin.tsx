"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Taxonomies = RouterOutputs["skills"]["all"];
type Taxonomy = Taxonomies[number];
type Group = Taxonomy["groups"][number];
type Skill = Group["skills"][number];

/**
 * Writing the skills taxonomies: one tab per discipline, and under it the groups with their
 * skills.
 *
 * **Editing this changes no grade.** A section of an assignment names its skill by id, and the
 * Skills tabs read a fellow's figures from approved rounds at request time, so renaming a skill
 * renames it on every tab at once and nothing else moves. The two things that could lose data are
 * refused by the procedures and not offered here: a skill that an assignment's section names
 * cannot be deleted until the section is re-tagged, and a group is deleted only once it is empty.
 *
 * **The canonical id is the skill's name in the taxonomy document**, `reading-a-traceback` for
 * Reading a Traceback. It is unique within a taxonomy, and the form fills it in from the name
 * until it is typed over.
 */
export function SkillTaxonomyAdmin({ taxonomies }: { taxonomies: Taxonomies }) {
  if (taxonomies.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No taxonomy has been seeded.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm">
          One taxonomy per fellowship. Every section of an assignment is tagged with one skill from
          its program&apos;s taxonomy, and the Skills tabs add up the tagged sections. Renaming a
          skill changes no grade. A skill that an assignment names cannot be deleted until the
          assignment is re-tagged.
        </p>
      </div>

      <Tabs defaultValue={taxonomies[0]!.id}>
        <TabsList>
          {taxonomies.map((taxonomy) => (
            <TabsTrigger key={taxonomy.id} value={taxonomy.id}>
              {taxonomy.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {taxonomies.map((taxonomy) => (
          <TabsContent key={taxonomy.id} value={taxonomy.id}>
            <TaxonomyPanel taxonomy={taxonomy} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function TaxonomyPanel({ taxonomy }: { taxonomy: Taxonomy }) {
  const [adding, setAdding] = React.useState(false);
  const held = taxonomy.groups.reduce((sum, group) => sum + group.skills.length, 0);

  return (
    <div className="flex flex-col gap-3 pt-2">
      <p className="text-xs text-muted-foreground">
        {taxonomy.groups.length === 1 ? "1 group" : `${taxonomy.groups.length} groups`} ·{" "}
        {held === 1 ? "1 skill" : `${held} skills`}
      </p>

      {taxonomy.groups.length > 0 && (
        <ul className="flex flex-col gap-3">
          {taxonomy.groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </ul>
      )}

      {adding ? (
        <GroupForm taxonomyId={taxonomy.id} group={null} onDone={() => setAdding(false)} />
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
          Add a group
        </Button>
      )}
    </div>
  );
}

/** One group: its name, the skills under it, and the way to add one. */
function GroupCard({ group }: { group: Group }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [open, setOpen] = React.useState(true);
  const [renaming, setRenaming] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const remove = useMutation(
    trpc.skills.removeGroup.mutationOptions(
      settled({ onSuccess: () => toast.success(`Removed ${group.name}.`) }),
    ),
  );

  const held = group.skills.length;

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
          <span className="truncate text-sm font-medium">{group.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {held === 1 ? "1 skill" : `${held} skills`}
          </span>
        </button>

        <Button type="button" variant="ghost" size="xs" onClick={() => setRenaming(true)}>
          Rename
        </Button>

        {/*
          Only offered on an empty group. The procedure refuses a full one and names the count,
          but a control that is there and always fails teaches an admin to distrust the screen.
        */}
        {held === 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ groupId: group.id })}
            className="text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        )}
      </div>

      {renaming && <GroupForm taxonomyId={null} group={group} onDone={() => setRenaming(false)} />}

      {open && (
        <>
          {held > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {group.skills.map((skill) => (
                <SkillRow key={skill.id} skill={skill} />
              ))}
            </ul>
          )}

          {adding ? (
            <SkillForm groupId={group.id} skill={null} onDone={() => setAdding(false)} />
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
              Add a skill
            </Button>
          )}
        </>
      )}
    </li>
  );
}

/** One skill: name, canonical id, definition, and the way to change or delete it. */
function SkillRow({ skill }: { skill: Skill }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [editing, setEditing] = React.useState(false);

  const remove = useMutation(
    trpc.skills.removeSkill.mutationOptions(
      settled({ onSuccess: () => toast.success(`Removed ${skill.name}.`) }),
    ),
  );

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm">
            <span className="font-medium">{skill.name}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {skill.canonicalId}
            </span>
          </span>
          {skill.definition !== "" && (
            <span className="text-xs text-muted-foreground">{skill.definition}</span>
          )}
        </div>

        <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ skillId: skill.id })}
          className="text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      </div>

      {editing && <SkillForm groupId={null} skill={skill} onDone={() => setEditing(false)} />}
    </li>
  );
}

/** Adding a group to a taxonomy, or renaming one. */
function GroupForm({
  taxonomyId,
  group,
  onDone,
}: {
  /** The taxonomy a new group is added to; null when renaming. */
  taxonomyId: string | null;
  group: Group | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [name, setName] = React.useState(group?.name ?? "");

  const add = useMutation(
    trpc.skills.addGroup.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Group added.");
          onDone();
        },
      }),
    ),
  );
  const rename = useMutation(
    trpc.skills.renameGroup.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Group renamed.");
          onDone();
        },
      }),
    ),
  );
  const pending = add.isPending || rename.isPending;

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") return;
        if (group !== null) rename.mutate({ groupId: group.id, name: trimmed });
        else if (taxonomyId !== null) add.mutate({ taxonomyId, name: trimmed });
      }}
    >
      <Input
        autoFocus
        value={name}
        placeholder="Technical Reasoning"
        aria-label="Group name"
        onChange={(event) => setName(event.target.value)}
        className="w-full sm:w-72"
      />
      <Button type="submit" size="sm" disabled={name.trim() === "" || pending}>
        {group === null ? "Add group" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

/** `Reading a Traceback` becomes `reading-a-traceback`: the form's first guess at a canonical id. */
function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Adding a skill to a group, or changing one. */
function SkillForm({
  groupId,
  skill,
  onDone,
}: {
  /** The group a new skill is added to; null when editing, since a skill stays in its group. */
  groupId: string | null;
  skill: Skill | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const [name, setName] = React.useState(skill?.name ?? "");
  const [canonicalId, setCanonicalId] = React.useState(skill?.canonicalId ?? "");
  // Until the id is typed over, it follows the name; after that the name leaves it alone.
  const [idTyped, setIdTyped] = React.useState(skill !== null);
  const [definition, setDefinition] = React.useState(skill?.definition ?? "");

  const add = useMutation(
    trpc.skills.addSkill.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Skill added.");
          onDone();
        },
      }),
    ),
  );
  const save = useMutation(
    trpc.skills.saveSkill.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Skill saved.");
          onDone();
        },
      }),
    ),
  );
  const pending = add.isPending || save.isPending;
  const complete = name.trim() !== "" && canonicalId.trim() !== "";

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete) return;
        const fields = {
          name: name.trim(),
          canonicalId: canonicalId.trim(),
          definition: definition.trim(),
        };
        if (skill !== null) save.mutate({ skillId: skill.id, ...fields });
        else if (groupId !== null) add.mutate({ groupId, ...fields });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Name
          <Input
            autoFocus
            value={name}
            placeholder="Reading a Traceback"
            onChange={(event) => {
              setName(event.target.value);
              if (!idTyped) setCanonicalId(slugOf(event.target.value));
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Canonical id
          <Input
            value={canonicalId}
            placeholder="reading-a-traceback"
            className="font-mono"
            onChange={(event) => {
              setIdTyped(true);
              setCanonicalId(event.target.value);
            }}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Definition
        <Textarea
          value={definition}
          rows={2}
          placeholder="What a fellow can do when they have this skill, in one or two sentences."
          onChange={(event) => setDefinition(event.target.value)}
        />
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!complete || pending}>
          {skill === null ? "Add skill" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
