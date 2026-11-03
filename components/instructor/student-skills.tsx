import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { SkillFigureCell, SkillRuleNote } from "@/components/instructor/skill-figure";
import { studentHref } from "@/lib/links";
import { formatSchoolDay, schoolDayOf } from "@/lib/school-time";
import { groupFigures, WRITING_SKILL, type SkillFigure } from "@/lib/skills";
import type { RouterOutputs } from "@/trpc/types";

type Skills = RouterOutputs["programs"]["studentSkills"];

/**
 * The Skills tab of one fellow's record: one card per group of the taxonomy, closed to the
 * group's figure and opening to a row per skill, with under each skill every contributing
 * section, oldest first.
 *
 * **The history is the point.** A figure says where the fellow stands; the list beneath says how
 * they got there — a run of 2/3s on a skill that became 3/3s in October is development, and a
 * single share cannot show it. Each line is one section of one approved round: the assignment,
 * what it scored toward this skill, and when it was due, linking to the fellow's work with the
 * feedback showing. A skill with nothing behind it reads as a dash, so the taxonomy is read whole
 * and what has not been assessed yet is as visible as what has. A section counted toward
 * Technical Writing whose round raised a proofreading or rendering flag says so on its line.
 *
 * A server component: the only thing pressed is a group's heading, which the browser opens on
 * its own.
 */
export function StudentSkills({ skills, studentId }: { skills: Skills; studentId: string }) {
  const lines = new Map<string, Skills["history"]>();
  for (const line of skills.history) {
    lines.set(line.skillId, [...(lines.get(line.skillId) ?? []), line]);
  }
  const figures = new Map(Object.entries(skills.figures) as [string, SkillFigure][]);
  const byGroup = groupFigures(figures, skills.groups);
  const total = skills.groups.reduce((sum, group) => sum + group.skills.length, 0);

  return (
    <section id="skills" className="flex scroll-mt-(--outline-offset) flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">Skills · {total}</h2>
        <SkillRuleNote />
      </div>

      {total === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          This program&apos;s discipline has no skills taxonomy yet.
        </p>
      ) : (
        skills.groups.map((group) => (
          /*
            A group starts closed, with its figure on the heading, and opens to its skills on a
            press. A taxonomy has fifty skills, and a record that listed every definition and
            every history line at once put the one group a reader came for below a screen of
            others. The native element rather than the house collapsible, so this stays a
            server component with nothing to hydrate; the marker is drawn as a chevron that
            turns while the group is open.
          */
          <details
            key={group.id}
            className="group flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border"
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 bg-muted/40 px-3 py-2 [&::-webkit-details-marker]:hidden">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                  aria-hidden
                />
                {group.name}
                <span className="font-normal text-muted-foreground">· {group.skills.length}</span>
              </h3>
              <SkillFigureCell
                figure={byGroup.get(group.id)}
                detailFlags={group.skills.some((skill) => skill.canonicalId === WRITING_SKILL)}
                className="items-end text-right"
              />
            </summary>
            {group.skills.map((skill) => {
              const own = lines.get(skill.id) ?? [];
              return (
                <div key={skill.id} className="flex flex-col gap-2 px-3 py-2">
                  {/*
                    The name and definition take what width is left and wrap inside it, and the
                    figure keeps its own width at the right, so a long definition never pushes
                    the figure onto a line of its own beneath it.
                  */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium">{skill.name}</span>
                      {skill.definition !== "" && (
                        <span className="text-xs text-muted-foreground">{skill.definition}</span>
                      )}
                    </div>
                    <div className="shrink-0">
                      <SkillFigureCell
                        figure={figures.get(skill.id)}
                        detailFlags={skill.canonicalId === WRITING_SKILL}
                        className="items-end text-right"
                      />
                    </div>
                  </div>
                  {own.length > 0 && (
                    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border">
                      {own.map((line, index) => (
                        <li
                          key={`${line.assignmentId}-${index}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm"
                        >
                          {/*
                            Opens the fellow's work in that course with this submission selected
                            and the feedback showing, which is the report the line's score was
                            read from.
                          */}
                          <Link
                            href={studentHref(
                              line.courseId,
                              studentId,
                              line.submissionId,
                              "report",
                            )}
                            className="min-w-0 flex-1 truncate hover:underline"
                          >
                            {line.assignmentTitle}
                          </Link>
                          {line.flagged && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              proofreading flagged
                            </span>
                          )}
                          <span className="shrink-0 tabular-nums">
                            {line.earned}/{line.possible}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            due {formatSchoolDay(schoolDayOf(line.dueAt))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </details>
        ))
      )}
    </section>
  );
}
