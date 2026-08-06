'use client';

import { Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RUBRIC_NAME_BY_SECTION_TYPE, SECTION_TYPES } from '@/lib/assignments/spec';
import { sectionLabel } from '@/lib/status';

/**
 * One gradable section of an assignment being authored.
 *
 * Two shapes, because a section is graded one of two ways and they need different fields. An
 * AI-graded section carries a type and a rubric; a manually graded one carries a label and a
 * point value and nothing else. The fields that do not apply are absent rather than disabled.
 *
 * **A section does not name its reference solutions.** Those are every file under the folder
 * the assignment names, which is stated once above this editor rather than per section — so
 * there is nothing here to tick, and no way to author a section whose ticked list has gone
 * stale against the folder it came from.
 *
 * Nothing here is typed by hand that can be chosen instead: the section type is a select, and
 * the rubric follows from it rather than being a third thing to get right.
 */

export type SectionDraft =
  | {
      grading: 'ai';
      type: (typeof SECTION_TYPES)[number];
      pointValue: number;
      rubricId: string;
      reportTemplate?: string;
      evidence?: 'tests';
      testNamePattern?: string;
    }
  | { grading: 'manual'; label: string; pointValue: number };

export function SectionEditor({
  section,
  index,
  rubrics,
  findings,
  hasRunner,
  onChange,
  onRemove,
}: {
  section: SectionDraft;
  index: number;
  rubrics: { id: string; name: string }[];
  findings: { path: string; message: string; severity: 'error' | 'warning' }[];
  /** False when the assignment runs no tests, which makes test evidence meaningless. */
  hasRunner: boolean;
  onChange: (next: SectionDraft) => void;
  onRemove: () => void;
}) {
  const fieldFindings = (field: string) =>
    findings.filter((finding) => finding.path === `sections.${index}.${field}`);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            {section.grading === 'ai' ? sectionLabel(section.type) : 'Graded by hand'}
          </Badge>
          <span className="text-xs text-muted-foreground">Section {index + 1}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 data-icon="inline-start" />
          Remove
        </Button>
      </div>

      {section.grading === 'manual' ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          {/*
            Two suggestions rather than one, because they answer different questions. An
            assignment with several hand-graded parts wants each named for what it is; an
            assignment that is simply worth twenty points wants one section called "Total", and
            nothing else in the interface says that is a reasonable thing to type.
          */}
          <Field label="What this section is called" findings={fieldFindings('label')}>
            <Input
              value={section.label}
              placeholder='"Total" or "Reflection"'
              onChange={(event) => onChange({ ...section, label: event.target.value })}
            />
          </Field>
          <PointValueField
            value={section.pointValue}
            findings={fieldFindings('pointValue')}
            onChange={(pointValue) => onChange({ ...section, pointValue })}
          />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label="Section type" findings={fieldFindings('type')}>
              <Select
                value={section.type}
                onValueChange={(value) => {
                  const type = value as (typeof SECTION_TYPES)[number];
                  // The rubric follows the type rather than being chosen separately. The
                  // procedures refuse a mismatched pairing, so offering the choice would only
                  // create a way to be refused.
                  const rubric = rubrics.find(
                    (candidate) => candidate.name === RUBRIC_NAME_BY_SECTION_TYPE[type],
                  );
                  onChange({ ...section, type, rubricId: rubric?.id ?? section.rubricId });
                }}
                // Or the trigger shows `coding_algorithm` where the list said "Coding —
                // algorithm fluency".
                items={Object.fromEntries(
                  SECTION_TYPES.map((type) => [type, sectionLabel(type)]),
                )}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {sectionLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Graded against {RUBRIC_NAME_BY_SECTION_TYPE[section.type]}
              </p>
            </Field>
            <PointValueField
              value={section.pointValue}
              findings={fieldFindings('pointValue')}
              onChange={(pointValue) => onChange({ ...section, pointValue })}
            />
          </div>

          {/*
            No checkbox. Whether the suite covers this section follows from its type and from
            the assignment having a runner at all — a short response has nothing to execute and
            every other type is checked against the suite when there is one. The only two
            settings a checkbox could have had were "correct" and "silently graded without the
            evidence it should have had".
          */}
          <p className="text-xs text-muted-foreground">
            {section.type === 'short_response'
              ? 'Graded against the rubric and the reference answer. A short response has nothing to execute.'
              : hasRunner
                ? 'The score is checked against the instructor’s test suite. A report claiming a test passed that failed is held for review.'
                : 'This assignment runs no tests, so the score rests on the model reading the code against the rubric.'}
          </p>
        </>
      )}
    </div>
  );
}

function PointValueField({
  value,
  findings,
  onChange,
}: {
  value: number;
  findings: { message: string; severity: 'error' | 'warning' }[];
  onChange: (value: number) => void;
}) {
  return (
    <Field label="Points" findings={findings}>
      <Input
        type="number"
        min={1}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
      />
    </Field>
  );
}

/** A labelled field with its findings underneath, so a message sits where the problem is. */
export function Field({
  label,
  hint,
  findings = [],
  children,
}: {
  label: string;
  hint?: string;
  findings?: { message: string; severity: 'error' | 'warning' }[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && findings.length === 0 && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {findings.map((finding, index) => (
        <p
          key={index}
          className={
            finding.severity === 'error'
              ? 'text-xs text-destructive'
              : 'text-xs text-amber-700 dark:text-amber-300'
          }
        >
          {finding.message}
        </p>
      ))}
    </div>
  );
}
