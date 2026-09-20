"use client";

import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  entriesOfKind,
  filterCompetencies,
  type Competency,
  type CompetencyEntry,
  type CompetencyEntryKind,
  type CompetencySection,
  type PickableEntry,
} from "@/lib/competencies";
import { cn } from "@/lib/utils";

/**
 * Choosing the competency entry a goal is built on: a skill to work toward, or a pitfall to work
 * away from. Used by the fellow, who owns their goals — an instructor reads them and writes
 * nothing, which is why this is not under `components/instructor/`. "Skill" is what these are called on screen; the source document and the stored kind
 * both call them indicators, and `lib/competencies.ts` keeps that word so the two can be matched
 * up by anybody reading them side by side.
 *
 * **Three levels, opened one at a time**: the sections, a section's competencies, and a
 * competency's skills and pitfalls. Nearly two hundred lines sit under eighteen competencies, and
 * showing them at once asks somebody to read the whole vocabulary to find the one thing they
 * already have in mind. Opening a section is how a conversation about a goal actually narrows.
 *
 * **The list arrives as a prop**, already restricted to what this fellow's fellowship is offered.
 * It is authored by admins and read on the server by the page above, so this component neither
 * queries it nor decides what is in it.
 *
 * **Searching overrides the levels rather than filtering inside them.** A query prunes the tree to
 * what matches and shows every survivor open, because the point of typing is to see the matches —
 * so the disclosure state is what a reader browsing controls, and search is the way past it.
 *
 * The dialog closes on pick, because picking is the whole of what it is for. Reopening on a chosen
 * entry opens the path down to it and highlights it, so "Change" starts from what was chosen
 * rather than from the top.
 */
export function CompetencyPicker({
  open,
  onOpenChange,
  sections,
  selectedId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The list this fellow may choose from, in the order an admin put it. */
  sections: readonly CompetencySection[];
  /** The currently chosen entry's id, highlighted when the picker reopens. */
  selectedId: string | null;
  onPick: (entry: PickableEntry) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [openGroups, setOpenGroups] = React.useState<ReadonlySet<string>>(new Set());
  const [openCompetencies, setOpenCompetencies] = React.useState<ReadonlySet<string>>(new Set());

  /*
    Opening is a fresh search, and the tree opens down to whatever is already chosen — "Change"
    should land on the current answer rather than make somebody find it a second time.
  */
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    const chosen = selectedId === null ? null : locate(sections, selectedId);
    setOpenGroups(chosen ? new Set([chosen.sectionId]) : new Set());
    setOpenCompetencies(chosen ? new Set([chosen.competencyId]) : new Set());
  }, [open, selectedId, sections]);

  const shown = filterCompetencies(query, sections);
  const searching = query.trim() !== "";

  const toggle = (
    setOpen: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
    key: string,
  ) => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const pick = (entry: PickableEntry) => {
    onPick(entry);
    onOpenChange(false);
  };

  /*
    Enter in the search box picks the first match — the one keyboard nicety worth having, since
    "type a few words, hit Enter" is how a person who knows the list moves. **Only while
    searching**, because that is the only time the first entry is on screen: with the levels
    closed it would pick something nobody had been shown. Everything else is the dialog's own
    keyboard handling: Tab and Enter across the rows, Escape to close.
  */
  const first = searching ? firstEntryOf(shown) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[75vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a competency</DialogTitle>
          <DialogDescription>
            A skill to work toward, or a pitfall to work away from. The wording you pick is saved
            with the goal.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && first !== null) {
                event.preventDefault();
                pick(first);
              }
            }}
            placeholder="Search competencies, skills, and pitfalls"
            aria-label="Search competencies, skills, and pitfalls"
            className="pl-8"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="-mx-2 flex-1 overflow-y-auto px-2">
          {shown.length === 0 ? (
            <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
              {sections.length === 0
                ? "Your programme has no competencies yet. Ask an instructor — somebody has to write the list before there is anything to choose from."
                : "Nothing matches that search."}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 pb-2">
              {shown.map((section) => {
                const sectionOpen = searching || openGroups.has(section.id);
                const held = section.competencies.length;

                return (
                  <section key={section.id} className="flex flex-col">
                    <DisclosureRow
                      open={sectionOpen}
                      onClick={() => toggle(setOpenGroups, section.id)}
                      label={<span className="text-sm font-medium">{section.name}</span>}
                      meta={held === 1 ? "1 competency" : `${held} competencies`}
                    />

                    {sectionOpen &&
                      section.competencies.map((competency) => {
                        const competencyOpen = searching || openCompetencies.has(competency.id);
                        const indicators = entriesOfKind(competency, "INDICATOR");
                        const pitfalls = entriesOfKind(competency, "PITFALL");

                        return (
                          <div key={competency.id} className="flex flex-col pl-5">
                            <DisclosureRow
                              open={competencyOpen}
                              onClick={() => toggle(setOpenCompetencies, competency.id)}
                              label={<span className="text-sm">{competency.name}</span>}
                              meta={`${indicators.length} ${
                                indicators.length === 1 ? "skill" : "skills"
                              } · ${pitfalls.length} ${
                                pitfalls.length === 1 ? "pitfall" : "pitfalls"
                              }`}
                            />

                            {competencyOpen && (
                              <div className="flex flex-col pl-5">
                                {competency.blurb !== "" && (
                                  <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
                                    {competency.blurb}
                                  </p>
                                )}

                                {indicators.map((entry) => (
                                  <EntryRow
                                    key={entry.id}
                                    text={entry.text}
                                    kind="INDICATOR"
                                    selected={entry.id === selectedId}
                                    onClick={() => pick(entryOf(competency, entry))}
                                  />
                                ))}

                                {pitfalls.length > 0 && (
                                  <p className="px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground">
                                    Pitfalls
                                  </p>
                                )}
                                {pitfalls.map((entry) => (
                                  <EntryRow
                                    key={entry.id}
                                    text={entry.text}
                                    kind="PITFALL"
                                    selected={entry.id === selectedId}
                                    onClick={() => pick(entryOf(competency, entry))}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The chosen entry, or the button that chooses one. Owns the picker and its open state, so a form
 * needing "one competency entry" renders this and holds only the value.
 *
 * The caption under a chosen entry states the copy rule in the fellow's terms, because the fellow
 * will read this wording on their own goals page: what was agreed stays as it was agreed.
 */
export function CompetencyEntryField({
  value,
  sections,
  onChange,
}: {
  value: PickableEntry | null;
  sections: readonly CompetencySection[];
  onChange: (entry: PickableEntry) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-2">
      {value === null ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="self-start"
        >
          Choose a competency
        </Button>
      ) : (
        <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {value.competencyName}
            </span>
            {value.kind === "PITFALL" && (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                Pitfall
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setOpen(true)}
              className="ml-auto"
            >
              Change
            </Button>
          </div>
          <p className="text-sm">“{value.text}”</p>
          <p className="text-xs text-muted-foreground">
            This wording is saved with the goal — later edits to the competency list won’t change
            it.
          </p>
        </div>
      )}

      <CompetencyPicker
        open={open}
        onOpenChange={setOpen}
        sections={sections}
        selectedId={value?.entryId ?? null}
        onPick={onChange}
      />
    </div>
  );
}

/**
 * A row that opens the level beneath it: a chevron, a name, and how much is inside.
 *
 * A plain button carrying `aria-expanded` rather than the house `Collapsible`, because openness
 * here has two sources — what somebody clicked, and what the search is showing — and a controlled
 * collapsible whose panel can be forced open by a keystroke elsewhere reports state it does not
 * own. The count is what makes an unopened row worth reading.
 */
function DisclosureRow({
  open,
  onClick,
  label,
  meta,
}: {
  open: boolean;
  onClick: () => void;
  label: React.ReactNode;
  meta: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
    >
      {open ? (
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 flex-1">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </button>
  );
}

/** One row: a dot saying which kind, the text, and the check when it is the current choice. */
function EntryRow({
  text,
  kind,
  selected,
  onClick,
}: {
  text: string;
  kind: CompetencyEntryKind;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50",
        selected && "bg-primary/10",
      )}
    >
      <span
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          kind === "PITFALL" ? "bg-amber-500" : "bg-muted-foreground/40",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">{text}</span>
      {kind === "PITFALL" && (
        <Badge variant="outline" className="shrink-0 text-amber-700 dark:text-amber-400">
          Pitfall
        </Badge>
      )}
      {selected && <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

/** A row's full entry, carrying the competency's name because that is what a goal copies. */
function entryOf(competency: Competency, entry: CompetencyEntry): PickableEntry {
  return {
    entryId: entry.id,
    kind: entry.kind,
    text: entry.text,
    competencyName: competency.name,
  };
}

/** Where a chosen entry sits, so that reopening the picker opens the path down to it. */
function locate(
  sections: readonly CompetencySection[],
  entryId: string,
): { sectionId: string; competencyId: string } | null {
  for (const section of sections) {
    for (const competency of section.competencies) {
      if (competency.entries.some((entry) => entry.id === entryId)) {
        return { sectionId: section.id, competencyId: competency.id };
      }
    }
  }

  return null;
}

/** What Enter in the search box picks: the first entry the current query leaves standing. */
function firstEntryOf(sections: readonly CompetencySection[]): PickableEntry | null {
  for (const section of sections) {
    for (const competency of section.competencies) {
      const entry = competency.entries[0];
      if (entry) return entryOf(competency, entry);
    }
  }

  return null;
}
