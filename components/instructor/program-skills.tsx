"use client";

import { ArrowDown, ArrowUp, ChevronsLeft, ChevronsRight, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { SkillFigureCell, SkillRuleNote } from "@/components/instructor/skill-figure";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  stickyColumn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { programStudentHref } from "@/lib/links";
import { displayNameOf, initials } from "@/lib/people";
import { groupFigures, skillShare, WRITING_SKILL, type SkillFigure } from "@/lib/skills";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/types";

type Data = RouterOutputs["programs"]["skills"];
type Fellow = Data["fellows"][number];
type Group = Data["groups"][number];

/** The width of the fellow column, of a group's column, and of a skill's column, in rem. */
const FELLOW_REM = 13;
const GROUP_REM = 10;
const SKILL_REM = 9;

/**
 * The roster's skills grid: a row per fellow, a column per group of the program's taxonomy, each
 * cell that fellow's term figure for the group — its skills' figures added together.
 *
 * **A plain table, by decision.** The Performance grid colours every cell against a pair of bars
 * and sorts the roster into bands; this one renders the figures and nothing judges them, because
 * a skill share is a grade and the Performance tab already answers who to talk to.
 *
 * **Groups across the top, and each opens into its skills.** A taxonomy has fifty skills, and a
 * grid that wide reads as nothing, so the grid starts with one column per group. The chevron on a
 * group's heading adds a column per skill in that group beside the group's own column, which
 * stays as the total, and a second press puts them away. Which groups are open is held here and
 * forgotten when the page is left.
 *
 * **Every column sorts.** A heading pressed once orders the roster by that column's share,
 * lowest first; pressed again, highest first; pressed a third time, the roster returns to name
 * order. A fellow with nothing graded in that column sorts last either way, because a reader
 * sorting a column is reading its figures. The fellow column stays put while the others scroll
 * beneath it, as every grid here does, so a row of figures is never read without the name beside
 * it.
 */
export function ProgramSkills({
  programId,
  data,
  cohortName,
}: {
  programId: string;
  data: Data;
  cohortName: Map<string, string>;
}) {
  const [sort, setSort] = React.useState<Sort | null>(null);
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set());

  const groups = data.groups.filter((group) => group.skills.length > 0);
  const writingGroup = data.groups.find((group) =>
    group.skills.some((skill) => skill.canonicalId === WRITING_SKILL),
  );

  if (groups.length === 0) {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
        This program&apos;s discipline has no skills taxonomy yet. An admin writes one under Admin →
        Skills.
      </p>
    );
  }

  if (data.fellows.length === 0) {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
        Nobody to read yet.
      </p>
    );
  }

  /*
    Each fellow's figures, by skill id and by group id, computed once rather than in every cell
    and again in every comparison the sort makes.
  */
  const rows: Row[] = data.fellows.map((fellow) => {
    const bySkill = new Map(Object.entries(fellow.figures) as [string, SkillFigure][]);
    return { fellow, bySkill, byGroup: groupFigures(bySkill, groups) };
  });

  const columns: Column[] = groups.flatMap((group) => {
    const own: Column = {
      key: `group:${group.id}`,
      title: group.name,
      kind: "group",
      group,
      detailFlags: group.id === writingGroup?.id,
      figure: (row) => row.byGroup.get(group.id),
    };
    if (!open.has(group.id)) return [own];
    return [
      own,
      ...group.skills.map((skill): Column => ({
        key: `skill:${skill.id}`,
        title: skill.name,
        kind: "skill",
        group,
        detailFlags: skill.canonicalId === WRITING_SKILL,
        figure: (row) => row.bySkill.get(skill.id),
      })),
    ];
  });

  const sorted = [...rows].sort((a, b) => {
    const byName = nameOf(a.fellow).localeCompare(nameOf(b.fellow));
    if (sort === null) return byName;
    if (sort.key === "name") return sort.direction === "asc" ? byName : -byName;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return byName;
    return (
      compareShares(shareOf(column.figure(a)), shareOf(column.figure(b)), sort.direction) || byName
    );
  });

  function toggleGroup(groupId: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  const width =
    FELLOW_REM +
    columns.reduce((sum, column) => sum + (column.kind === "group" ? GROUP_REM : SKILL_REM), 0);

  return (
    <div className="flex flex-col gap-3">
      <SkillRuleNote />
      <div className="w-fit max-w-full overflow-hidden rounded-lg border border-border">
        <Table className="table-fixed" style={{ width: `${width}rem` }}>
          <colgroup>
            <col style={{ width: `${FELLOW_REM}rem` }} />
            {columns.map((column) => (
              <col
                key={column.key}
                style={{ width: `${column.kind === "group" ? GROUP_REM : SKILL_REM}rem` }}
              />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead
                className={cn(stickyColumn, "align-middle")}
                aria-sort={ariaSort(sort, "name")}
              >
                <SortButton label="Fellow" sortKey="name" sort={sort} onSort={setSort} />
              </TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  aria-sort={ariaSort(sort, column.key)}
                  className={cn(
                    "h-auto py-1.5 align-middle text-xs font-normal whitespace-normal",
                    column.kind === "group" ? "border-l border-border" : "bg-muted/30",
                  )}
                >
                  {column.kind === "group" ? (
                    <span className="flex items-center justify-between gap-1">
                      <SortButton
                        label={column.title}
                        sortKey={column.key}
                        sort={sort}
                        onSort={setSort}
                      />
                      {/*
                        The name sorts and the button at the cell's right edge opens, two presses
                        on one heading. The same button the attendance grid uses to bring in
                        earlier dates: its chevrons point to where the skill columns will appear,
                        to the right, and back the other way while they are showing.
                      */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0"
                        onClick={() => toggleGroup(column.group.id)}
                        aria-expanded={open.has(column.group.id)}
                        aria-label={`${open.has(column.group.id) ? "Hide" : "Show"} the skills in ${column.title}`}
                        title={`${open.has(column.group.id) ? "Hide" : "Show"} the skills in ${column.title}`}
                      >
                        {open.has(column.group.id) ? <ChevronsLeft /> : <ChevronsRight />}
                      </Button>
                    </span>
                  ) : (
                    <SortButton
                      label={column.title}
                      sortKey={column.key}
                      sort={sort}
                      onSort={setSort}
                    />
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.fellow.enrollmentId}>
                <TableCell className={stickyColumn}>
                  <FellowCell programId={programId} fellow={row.fellow} cohortName={cohortName} />
                </TableCell>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      "align-top",
                      column.kind === "group" ? "border-l border-border" : "bg-muted/30",
                    )}
                  >
                    <SkillFigureCell figure={column.figure(row)} detailFlags={column.detailFlags} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** One fellow with their figures looked up once: by skill, and summed by group. */
type Row = {
  fellow: Fellow;
  bySkill: ReadonlyMap<string, SkillFigure>;
  byGroup: ReadonlyMap<string, SkillFigure>;
};

/**
 * One column of the grid: a group's total, or one skill of a group that has been opened. The
 * header, the cells and the sort all read this one list, so a column cannot be drawn under one
 * heading and sorted by another's figure.
 */
type Column = {
  key: string;
  title: string;
  kind: "group" | "skill";
  group: Group;
  /** Whether the cell prints the proofreading count: Technical Writing and its group only. */
  detailFlags: boolean;
  figure: (row: Row) => SkillFigure | undefined;
};

// ===========================================================================
// Sorting
// ===========================================================================

/** A column key, or "name" for the fellow column, and which way. */
type Sort = { key: string; direction: "asc" | "desc" };

/** The share to sort a cell by, or null for a cell with nothing in it yet. */
function shareOf(figure: SkillFigure | undefined): number | null {
  return figure === undefined ? null : skillShare(figure);
}

/** Empty cells last in either direction, since a reader sorting a column is reading its figures. */
function compareShares(a: number | null, b: number | null, direction: Sort["direction"]): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

/** The first press sorts ascending, the next descending, and a third returns to name order. */
function nextSort(current: Sort | null, key: string): Sort | null {
  if (current?.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

function ariaSort(sort: Sort | null, key: string): "ascending" | "descending" | undefined {
  if (sort?.key !== key) return undefined;
  return sort.direction === "asc" ? "ascending" : "descending";
}

function nameOf(fellow: Fellow): string {
  return displayNameOf(fellow.student, "Unnamed");
}

function SortButton({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: string;
  sort: Sort | null;
  onSort: (sort: Sort | null) => void;
}) {
  const active = sort?.key === sortKey;

  return (
    <button
      type="button"
      onClick={() => onSort(nextSort(sort, sortKey))}
      aria-label={`Sort by ${label.toLowerCase()}`}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-sm text-left transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      {!active ? (
        <ChevronsUpDown className="size-3 shrink-0" aria-hidden />
      ) : sort.direction === "asc" ? (
        <ArrowUp className="size-3 shrink-0" aria-hidden />
      ) : (
        <ArrowDown className="size-3 shrink-0" aria-hidden />
      )}
    </button>
  );
}

/** The name, linking to the fellow's own Skills tab, with their cohort beneath it. */
function FellowCell({
  programId,
  fellow,
  cohortName,
}: {
  programId: string;
  fellow: Fellow;
  cohortName: Map<string, string>;
}) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-8">
        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
          {initials(fellow.student.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <Link
          href={programStudentHref(programId, fellow.student.id, "skills")}
          className="truncate font-medium hover:underline"
        >
          {nameOf(fellow)}
        </Link>
        <span className="truncate text-xs text-muted-foreground">
          {fellow.cohortId === null
            ? "No cohort"
            : (cohortName.get(fellow.cohortId) ?? "Unknown cohort")}
        </span>
      </div>
    </div>
  );
}
