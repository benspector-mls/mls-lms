"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { SortableList, SortableRow } from "@/components/sortable-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ITEM_KIND_META,
  OVERVIEW_HEADING_MAX_LENGTH,
  PANEL_KINDS,
  QUESTION_KINDS,
  TEMPERATURE_KIND,
  coachingLayoutSchema,
  isPanel,
  isQuestion,
  type CoachingLayout,
  type ItemKind,
  type LayoutItem,
  type LayoutSection,
  type PanelKind,
  type QuestionKind,
} from "@/lib/coaching";
import { coachingFormsHref } from "@/lib/links";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Template = RouterOutputs["coachingTemplates"]["get"];

/**
 * Writing one coaching form: its name, its sections, and the questions and data panels in each.
 *
 * **The whole form is held here and saved whole.** A form is one JSON layout on one row, so the
 * builder edits a copy in memory — adding, rewording, dragging — and Save writes it back in one
 * call, validated by the same schema the server applies. Saving is a button rather than an
 * autosave because a half-edited question, a scale with no labels yet, should not be the version a
 * coach starts a session from in the meantime.
 *
 * **Editing here can never change a session.** A session copies the form it starts with, so
 * rewording, reordering or removing anything on this screen leaves every session already begun
 * exactly as it was. The screen says so beside the controls that would otherwise look dangerous.
 *
 * **Two people editing one form at once** is refused rather than silently merged: Save carries
 * the `updatedAt` this screen loaded, and the server refuses when the row has moved since. The
 * refusal says to reload, which is the only honest answer.
 *
 * Sections and items are both `SortableList`s, nested the way the Curriculum screen nests units
 * and resources: dragging is plain array state here, and the order is whatever is saved.
 */
export function CoachingFormBuilder({ template }: { template: Template }) {
  const trpc = useTRPC();
  const [name, setName] = React.useState(template.name);
  const [layout, setLayout] = React.useState<CoachingLayout | null>(template.layout);
  const [updatedAt, setUpdatedAt] = React.useState(template.updatedAt);
  const [dirty, setDirty] = React.useState(false);

  const save = useMutation(
    trpc.coachingTemplates.save.mutationOptions({
      onSuccess: (saved) => {
        setUpdatedAt(saved.updatedAt);
        setDirty(false);
        toast.success("Saved.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (layout === null) {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
        This form cannot be read, so it cannot be edited here.
      </p>
    );
  }

  const edit = (next: CoachingLayout) => {
    setLayout(next);
    setDirty(true);
  };

  const editSection = (sectionId: string, patch: Partial<LayoutSection>) =>
    edit({
      ...layout,
      sections: layout.sections.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section,
      ),
    });

  const editItem = (sectionId: string, itemId: string, patch: Partial<LayoutItem>) =>
    editSection(sectionId, {
      items: layout.sections
        .find((section) => section.id === sectionId)!
        .items.map((item) => (item.id === itemId ? ({ ...item, ...patch } as LayoutItem) : item)),
    });

  const changeItemKind = (sectionId: string, itemId: string, kind: ItemKind) =>
    editSection(sectionId, {
      items: layout.sections
        .find((section) => section.id === sectionId)!
        .items.map((item) => (item.id === itemId ? convertItem(item, kind) : item)),
    });

  /* The copy lands right after the original, under a new id, so it is edited in place. */
  const duplicateItem = (sectionId: string, itemId: string) =>
    editSection(sectionId, {
      items: layout.sections
        .find((section) => section.id === sectionId)!
        .items.flatMap((item) =>
          item.id === itemId ? [item, { ...item, id: crypto.randomUUID() }] : [item],
        ),
    });

  const addItem = (sectionId: string, item: LayoutItem) =>
    editSection(sectionId, {
      items: [...layout.sections.find((section) => section.id === sectionId)!.items, item],
    });

  const removeItem = (sectionId: string, itemId: string) =>
    editSection(sectionId, {
      items: layout.sections
        .find((section) => section.id === sectionId)!
        .items.filter((item) => item.id !== itemId),
    });

  const reorderItems = (sectionId: string, ids: string[]) => {
    const section = layout.sections.find((candidate) => candidate.id === sectionId)!;
    editSection(sectionId, {
      items: ids.map((id) => section.items.find((item) => item.id === id)!),
    });
  };

  const hasTemperature = layout.sections.some((section) =>
    section.items.some((item) => item.kind === TEMPERATURE_KIND),
  );

  const submit = () => {
    /*
      The same schema the server applies, run first so the message names the field rather than
      arriving as a refused request. The first issue is enough: an admin fixes one thing at a time.
    */
    const checked = coachingLayoutSchema.safeParse(layout);
    if (!checked.success) {
      toast.error(checked.error.issues[0]?.message ?? "The form has a problem.");
      return;
    }
    if (name.trim() === "") {
      toast.error("A form needs a name.");
      return;
    }
    save.mutate({ id: template.id, name: name.trim(), layout: checked.data, updatedAt });
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={coachingFormsHref()}
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3" aria-hidden />
        All coaching forms
      </Link>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="form-name" className="text-sm font-medium">
            Name
          </Label>
          <Input
            id="form-name"
            value={name}
            maxLength={120}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <Button type="button" disabled={save.isPending || !dirty} onClick={submit}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Save
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Sessions already started keep the form they started with, however this one changes.
      </p>

      <SortableList
        ids={layout.sections.map((section) => section.id)}
        onReorder={(ids) =>
          edit({
            ...layout,
            sections: ids.map((id) => layout.sections.find((section) => section.id === id)!),
          })
        }
        announce={(id) =>
          layout.sections.find((section) => section.id === id)?.title ?? "a section"
        }
      >
        <div className="flex flex-col gap-4">
          {layout.sections.map((section) => (
            <SortableRow
              key={section.id}
              id={section.id}
              label={section.title || "an untitled section"}
              className="rounded-lg border border-border bg-card"
            >
              {(handle) => (
                <SectionCard
                  section={section}
                  handle={handle}
                  hasTemperature={hasTemperature}
                  onEdit={(patch) => editSection(section.id, patch)}
                  onRemove={() =>
                    edit({
                      ...layout,
                      sections: layout.sections.filter((candidate) => candidate.id !== section.id),
                    })
                  }
                  onEditItem={(itemId, patch) => editItem(section.id, itemId, patch)}
                  onChangeItemKind={(itemId, kind) => changeItemKind(section.id, itemId, kind)}
                  onDuplicateItem={(itemId) => duplicateItem(section.id, itemId)}
                  onAddItem={(item) => addItem(section.id, item)}
                  onRemoveItem={(itemId) => removeItem(section.id, itemId)}
                  onReorderItems={(ids) => reorderItems(section.id, ids)}
                />
              )}
            </SortableRow>
          ))}
        </div>
      </SortableList>

      <Button
        type="button"
        variant="outline"
        className="self-start"
        data-icon="inline-start"
        onClick={() =>
          edit({
            ...layout,
            sections: [
              ...layout.sections,
              {
                id: crypto.randomUUID(),
                title: `Section ${layout.sections.length + 1}`,
                items: [],
              },
            ],
          })
        }
      >
        <Plus aria-hidden />
        Add section
      </Button>
    </div>
  );
}

/** A new item of the chosen kind, blank, with the kind-specific fields at sensible starts. */
function newItem(kind: ItemKind): LayoutItem {
  return (PANEL_KINDS as readonly string[]).includes(kind)
    ? newPanel(kind as PanelKind)
    : newQuestion(kind as QuestionKind | typeof TEMPERATURE_KIND);
}

/** A new question of the chosen kind, blank, with the kind-specific fields at sensible starts. */
function newQuestion(kind: QuestionKind | typeof TEMPERATURE_KIND): LayoutItem {
  const id = crypto.randomUUID();
  if (kind === TEMPERATURE_KIND) return { kind, id, prompt: "Temperature check" };
  const base = { id, prompt: "", shared: false, overview: false };
  switch (kind) {
    case "SCALE":
      return { kind, ...base, min: 1, max: 5, lowLabel: "", highLabel: "" };
    case "SINGLE_CHOICE":
    case "MULTIPLE_CHOICE":
      return { kind, ...base, options: [] };
    default:
      return { kind, ...base };
  }
}

function newPanel(kind: PanelKind): LayoutItem {
  return { kind, id: crypto.randomUUID(), heading: ITEM_KIND_META[kind].label };
}

/**
 * The same item as another kind, keeping what carries over: the words (a question's prompt or a
 * panel's heading), the caption, and — between two question kinds — the two switches and the
 * column heading. The options survive a change between the two choice kinds; every other field a
 * kind needs starts where a new item of that kind starts. The id is kept, so the row stays where
 * it is in the list.
 */
function convertItem(item: LayoutItem, kind: ItemKind): LayoutItem {
  if (kind === item.kind) return item;

  const id = item.id;
  const text = isPanel(item) ? item.heading : item.prompt;
  const caption = item.caption === undefined ? {} : { caption: item.caption };

  if ((PANEL_KINDS as readonly string[]).includes(kind)) {
    return { kind: kind as PanelKind, id, heading: text, ...caption };
  }
  if (kind === TEMPERATURE_KIND) {
    return { kind, id, prompt: text, ...caption };
  }

  const switches = isQuestion(item)
    ? {
        shared: item.shared,
        overview: item.overview,
        ...(item.heading === undefined ? {} : { heading: item.heading }),
      }
    : { shared: false, overview: false };
  const base = { id, prompt: text, ...caption, ...switches };
  const questionKind = kind as QuestionKind;

  switch (questionKind) {
    case "SCALE":
      return { kind: questionKind, ...base, min: 1, max: 5, lowLabel: "", highLabel: "" };
    case "SINGLE_CHOICE":
    case "MULTIPLE_CHOICE":
      return {
        kind: questionKind,
        ...base,
        options:
          item.kind === "SINGLE_CHOICE" || item.kind === "MULTIPLE_CHOICE" ? item.options : [],
      };
    case "SHORT_TEXT":
    case "LONG_TEXT":
    case "YES_NO":
      return { kind: questionKind, ...base };
  }
}

/**
 * Every kind an item can be, in two groups: the question kinds with the temperature check among
 * them, and the data panels. The temperature is left out while another item already is it, which
 * is what `current` is for: a row that is the temperature keeps the option so its select can show
 * it.
 */
type KindGroups = { questions: ItemKind[]; panels: ItemKind[] };

function kindGroups(current: ItemKind | null, temperatureElsewhere: boolean): KindGroups {
  const temperature: ItemKind[] =
    temperatureElsewhere && current !== TEMPERATURE_KIND ? [] : [TEMPERATURE_KIND];
  return { questions: [...QUESTION_KINDS, ...temperature], panels: [...PANEL_KINDS] };
}

/**
 * One select of every kind under the two headings. The add control at the foot of a section and
 * the kind on every row both draw this, so the two read the same way.
 */
function KindSelect({
  value,
  groups,
  ariaLabel,
  className,
  onChange,
}: {
  value: ItemKind;
  groups: KindGroups;
  ariaLabel: string;
  className?: string;
  onChange: (kind: ItemKind) => void;
}) {
  const labels = Object.fromEntries(
    [...groups.questions, ...groups.panels].map((kind) => [kind, ITEM_KIND_META[kind].label]),
  );

  return (
    <Select
      value={value}
      items={labels}
      onValueChange={(next) => next && onChange(next as ItemKind)}
    >
      <SelectTrigger className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Question types</SelectLabel>
          {groups.questions.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {ITEM_KIND_META[kind].label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Data panels</SelectLabel>
          {groups.panels.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {ITEM_KIND_META[kind].label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function SectionCard({
  section,
  handle,
  hasTemperature,
  onEdit,
  onRemove,
  onEditItem,
  onChangeItemKind,
  onDuplicateItem,
  onAddItem,
  onRemoveItem,
  onReorderItems,
}: {
  section: LayoutSection;
  handle: React.ReactNode;
  hasTemperature: boolean;
  onEdit: (patch: Partial<LayoutSection>) => void;
  onRemove: () => void;
  onEditItem: (itemId: string, patch: Partial<LayoutItem>) => void;
  onChangeItemKind: (itemId: string, kind: ItemKind) => void;
  onDuplicateItem: (itemId: string) => void;
  onAddItem: (item: LayoutItem) => void;
  onRemoveItem: (itemId: string) => void;
  onReorderItems: (ids: string[]) => void;
}) {
  const [addKind, setAddKind] = React.useState<ItemKind>("LONG_TEXT");
  const groups = kindGroups(null, hasTemperature);
  // The temperature can drop out of the choices once the form has one; fall back rather than add a second.
  const chosenKind = [...groups.questions, ...groups.panels].includes(addKind)
    ? addKind
    : "LONG_TEXT";

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-2">
        <div className="pt-2">{handle}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            value={section.title}
            maxLength={200}
            aria-label="Section title"
            placeholder="Section title"
            className="font-medium"
            onChange={(event) => onEdit({ title: event.target.value })}
          />
          <Input
            value={section.caption ?? ""}
            maxLength={500}
            aria-label="Section caption"
            placeholder="Caption, optional: a line under the title."
            onChange={(event) => onEdit({ caption: event.target.value || undefined })}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Remove this section"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>

      {section.items.length > 0 && (
        <SortableList
          ids={section.items.map((item) => item.id)}
          onReorder={onReorderItems}
          announce={(id) => {
            const item = section.items.find((candidate) => candidate.id === id);
            return item === undefined ? "an item" : isPanel(item) ? item.heading : item.prompt;
          }}
        >
          <ul className="flex flex-col gap-3">
            {section.items.map((item) => (
              <SortableRow
                key={item.id}
                id={item.id}
                as="li"
                label={isPanel(item) ? item.heading : item.prompt || "an untitled question"}
                className="rounded-md border border-border bg-muted/20"
              >
                {(itemHandle) => (
                  <ItemRow
                    item={item}
                    handle={itemHandle}
                    temperatureElsewhere={hasTemperature && item.kind !== TEMPERATURE_KIND}
                    onEdit={(patch) => onEditItem(item.id, patch)}
                    onChangeKind={(kind) => onChangeItemKind(item.id, kind)}
                    onDuplicate={() => onDuplicateItem(item.id)}
                    onRemove={() => onRemoveItem(item.id)}
                  />
                )}
              </SortableRow>
            ))}
          </ul>
        </SortableList>
      )}

      {/* One control adds either a question or a panel: the kind is chosen under its heading. */}
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Add to this section</span>
          <KindSelect
            value={chosenKind}
            groups={groups}
            ariaLabel="What to add"
            className="w-56"
            onChange={setAddKind}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAddItem(newItem(chosenKind))}
          data-icon="inline-start"
        >
          <Plus aria-hidden />
          Add
        </Button>
      </div>
    </div>
  );
}

/**
 * One item's fields: a panel's heading and caption; a question's prompt, caption, the fields its
 * kind needs, and the two switches that decide who else reads the answer. The kind is a select
 * rather than a fixed label: changing it keeps the words, the caption and the switches through
 * `convertItem`, and resets only what the new kind needs — which is safe because nothing is
 * stored until Save, and no session reads the template afterwards.
 */
function ItemRow({
  item,
  handle,
  temperatureElsewhere,
  onEdit,
  onChangeKind,
  onDuplicate,
  onRemove,
}: {
  item: LayoutItem;
  handle: React.ReactNode;
  /** Another item on the form is already the temperature check, so this one cannot become it. */
  temperatureElsewhere: boolean;
  onEdit: (patch: Partial<LayoutItem>) => void;
  onChangeKind: (kind: ItemKind) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const meta = ITEM_KIND_META[item.kind];

  return (
    <div className="flex items-start gap-2 p-3">
      <div className="pt-1.5">{handle}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <KindSelect
            value={item.kind}
            groups={kindGroups(item.kind, temperatureElsewhere)}
            ariaLabel="Kind"
            className="h-8 w-44 text-xs"
            onChange={onChangeKind}
          />
          <span className="text-xs text-muted-foreground">{meta.describes}</span>
        </div>

        {isPanel(item) ? (
          <>
            <Input
              value={item.heading}
              maxLength={200}
              aria-label="Panel heading"
              placeholder="Heading"
              onChange={(event) => onEdit({ heading: event.target.value })}
            />
            <Input
              value={item.caption ?? ""}
              maxLength={500}
              aria-label="Panel caption"
              placeholder="Caption, optional."
              onChange={(event) => onEdit({ caption: event.target.value || undefined })}
            />
          </>
        ) : (
          <>
            <Textarea
              value={item.prompt}
              maxLength={500}
              rows={1}
              aria-label="Question"
              placeholder="The question, as the coach will read it."
              onChange={(event) => onEdit({ prompt: event.target.value })}
            />
            <Input
              value={item.caption ?? ""}
              maxLength={500}
              aria-label="Question caption"
              placeholder="Caption, optional: a line under the question."
              onChange={(event) => onEdit({ caption: event.target.value || undefined })}
            />
          </>
        )}

        {item.kind === "SCALE" && (
          <div className="flex flex-wrap items-end gap-2">
            <NumberField label="Low end" value={item.min} onChange={(min) => onEdit({ min })} />
            <Input
              value={item.lowLabel}
              maxLength={60}
              aria-label="Low end label"
              placeholder="Low end label"
              className="w-40"
              onChange={(event) => onEdit({ lowLabel: event.target.value })}
            />
            <NumberField label="High end" value={item.max} onChange={(max) => onEdit({ max })} />
            <Input
              value={item.highLabel}
              maxLength={60}
              aria-label="High end label"
              placeholder="High end label"
              className="w-40"
              onChange={(event) => onEdit({ highLabel: event.target.value })}
            />
          </div>
        )}

        {(item.kind === "SINGLE_CHOICE" || item.kind === "MULTIPLE_CHOICE") && (
          <OptionsField options={item.options} onChange={(options) => onEdit({ options })} />
        )}

        {isQuestion(item) && (
          <div className="flex flex-col gap-2 pt-1">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={item.shared}
                onCheckedChange={(next) => onEdit({ shared: next === true })}
              />
              Shared with the fellow after the session is completed
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={item.overview}
                  onCheckedChange={(next) => onEdit({ overview: next === true })}
                />
                Show on the Fellows Coaching tab
              </label>
              {item.overview && (
                <Input
                  value={item.heading ?? ""}
                  maxLength={OVERVIEW_HEADING_MAX_LENGTH}
                  aria-label="Column heading"
                  placeholder="Column heading"
                  className="w-48"
                  onChange={(event) => onEdit({ heading: event.target.value || undefined })}
                />
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {/* A form holds one temperature check, so that is the one item with no copy. */}
        {item.kind !== TEMPERATURE_KIND && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Duplicate this item"
            onClick={onDuplicate}
          >
            <Copy aria-hidden />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Remove this item"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={value}
        aria-label={label}
        className="w-20"
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (Number.isInteger(next)) onChange(next);
        }}
      />
    </div>
  );
}

/**
 * The options of a choice question, one per line. Held as text while it is typed, so a line in
 * progress is not split or dropped on every keystroke; the list is what is saved.
 */
function OptionsField({
  options,
  onChange,
}: {
  options: readonly string[];
  onChange: (options: string[]) => void;
}) {
  const [text, setText] = React.useState(options.join("\n"));

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">Options, one per line</span>
      <Textarea
        value={text}
        rows={3}
        aria-label="Options, one per line"
        onChange={(event) => {
          setText(event.target.value);
          onChange(
            event.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== ""),
          );
        }}
      />
    </div>
  );
}
