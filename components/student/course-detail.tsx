"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import * as React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  ListChecks,
  Wrench,
} from "lucide-react";

import { AcceptAssignmentButton } from "@/components/accept-assignment-button";
import { EmptyState } from "@/components/list-states";
import { ResourceItem } from "@/components/resource-item";
import { UnitList } from "@/components/unit-list";
import { PageHeader } from "@/components/page-header";
import { AssignmentKindIcon, SubmissionStatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { hasAcceptStep } from "@/lib/assignments/spec";
import { gradingQueueHref } from "@/lib/links";
import {
  CATEGORY_META,
  sortByDueDate,
  UNIT_CATEGORIES,
  type CourseUnitCategory,
} from "@/lib/course-units";
import { completionMeta, formatDueDateShort, formatPercent, scorePercent } from "@/lib/status";
import { completeCount } from "@/lib/student/progress";
import { cn } from "@/lib/utils";

import { AssignmentPanel } from "./assignment-panel";
import { CourseProgressBar } from "./progress-bar";
import type { Assignment, Course, Resource, Submission } from "./types";

/**
 * A student's assignments for one course.
 *
 * Grouped by module and collapsed down to one row each, because a nine-month program
 * runs to something like fifty assignments and a page of cards is unreadable at that
 * length. A row carries only what you scan for — where it stands, what it is worth, what
 * you got, when it is due — and opens a panel for the work itself.
 */

/**
 * The row's own address in the document, so arriving at `?assignment=…` can scroll to it.
 *
 * One function rather than the same template string in two places, because the two places are a
 * `getElementById` and the `id` it has to match — a difference between them fails by finding
 * nothing, which looks exactly like a row that is already in view.
 */
function assignmentRowId(assignmentId: string): string {
  return `assignment-row-${assignmentId}`;
}

export function StudentCourseDetail({
  course,
  assignments,
  resources,
  githubLinked,
  now,
}: {
  course: Course;
  assignments: Assignment[];
  /**
   * The readings, notes, and videos in this course, flat and already ordered.
   *
   * A second list rather than a field on the module, because they come from a second table —
   * a resource is a sibling of an assignment under a module, not a kind of assignment. The
   * merge is here, which is the cost that model was chosen knowing about.
   */
  resources: Resource[];
  githubLinked: boolean;
  /** Read once on the server, so relative times do not differ between the two render passes. */
  now: Date;
}) {
  const units = groupByCourseUnit(course, assignments, resources);

  /*
    Which assignment is open is React state, and the address is kept in step with it.

    **Not `router.replace`, which is what this was and is why the panel was slow to appear.** A
    changed search parameter is a soft navigation in the App Router: it misses the router cache,
    fetches a fresh payload for the route, and re-runs this page's server component — `me`,
    `courses.get`, `assignments.listForCourse`, and `resources.listForCourse`, against the database,
    every time a row was pressed. The panel could not begin animating until that round trip
    committed, and closing paid the same cost again. Not one of those reads can return anything the
    page does not already have, because the parameter is read here in the browser and the server
    component never looks at it.

    `history.replaceState` moves the address without navigating, so opening is a state change and
    nothing else.

    **The panel always mounts closed, and the parameter is adopted a frame later.** Arriving from a
    link is then the same sequence as pressing a row — closed, then open — where reading the
    parameter as the initial state made it the one case that mounted already open. That asymmetry is
    what a link from the dashboard fell into: `Sheet` is a Base UI dialog whose entrance is a
    `closed → open` transition with a `data-starting-style` frame, and it has no such frame to
    render when the first render is already open. Costing one frame to have one path is worth it,
    and the entrance animation is the same from both directions as a result.

    The effect and `show` cannot fight, whether or not Next mirrors `replaceState` back into
    `useSearchParams`. If it does, the effect re-sets the value `show` has already set, which is a
    no-op. If it does not, the parameter never changes after mount and the effect never runs again.
    Either way the state is what the panel reads and the address is what a reader copies.

    `replaceState` rather than `pushState`, in both directions. The address stays shareable either
    way, and this keeps the back button as the way out of the course page rather than a walk back
    through every panel the student happened to open. Escape, the close button, and the backdrop are
    the ways to close it, and `Sheet` handles all three.
  */
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramId = searchParams.get("assignment");
  const [openId, setOpenId] = React.useState<string | null>(null);

  /*
    Adopting the parameter opens the panel and brings the row it names into view behind it.

    **The scroll happens before the state above has been rendered, and that ordering is the whole
    trick.** `setOpenId` is batched and flushes after this effect returns, so the page is still
    unlocked at the moment `scrollIntoView` runs — a modal dialog stops the page scrolling once it
    is open, and the same two lines in the other order move nothing.

    Instant rather than smooth, because a student arriving from a link has no position to preserve:
    there is nothing on screen yet for a glide to give continuity with, and an animation that the
    panel's scroll lock interrupts half way leaves the list somewhere arbitrary.

    `center` rather than `start` so the sticky header cannot sit over the row. Only on arrival from
    the address, never in `show` — a row a student has just pressed is already where they are
    looking, and moving the page under them would be the panel stealing their place in the list.
  */
  React.useEffect(() => {
    setOpenId(paramId);
    if (!paramId) return;

    document
      .getElementById(assignmentRowId(paramId))
      ?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [paramId]);

  const show = React.useCallback(
    (assignmentId: string | null) => {
      setOpenId(assignmentId);
      window.history.replaceState(
        null,
        "",
        assignmentId ? `${pathname}?assignment=${assignmentId}` : pathname,
      );
    },
    [pathname],
  );

  /*
    A stale or invented id opens nothing rather than erroring. An address can outlive the
    assignment it names — an instructor can unpublish one — and the course list behind it is a
    perfectly good thing to be looking at instead.
  */
  const openAssignment = openId ? (assignments.find((a) => a.id === openId) ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <Link
        href="/courses"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "-ml-2 w-fit text-muted-foreground",
        )}
      >
        <ArrowLeft data-icon="inline-start" />
        All courses
      </Link>

      <PageHeader title={course.name} description={course.program.term} />

      {/*
        Where the course stands, in one line. Below the header because it is about the work
        rather than about the cohort, and above the modules because it is the summary of them.
      */}
      {assignments.length > 0 && <CourseProgress assignments={assignments} />}

      {/*
        Accepting an assignment creates a repository named after the GitHub username, so
        without one the button below fails at the point of use. Said here rather than
        found there.
      */}
      {!githubLinked && (
        <Card className="border-amber-500/50">
          <CardContent className="py-4 text-sm">
            <p className="font-medium">Your GitHub account is not linked</p>
            <p className="mt-1 text-muted-foreground">
              Accepting an assignment creates a repository named after your GitHub username, so you
              need to sign in with GitHub at least once first. Sign out, then choose &ldquo;Sign in
              with GitHub&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {units.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="Nothing here yet"
          description="When your instructor adds assignments or readings to this course, they will appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {units.map(({ id, name, category, rows, resources: unitResources }) => (
            <UnitSection
              key={id}
              name={name}
              category={category}
              assignments={rows}
              resources={unitResources}
              teaches={course.teaches}
              openAssignmentId={openId}
              onOpen={show}
            />
          ))}
        </div>
      )}

      {/*
        One panel for the page rather than one per row. Fifty rows would otherwise mount fifty
        dialogs and their portals, and the panel is handed the assignment it is pointed at.
      */}
      <AssignmentPanel
        assignment={openAssignment}
        now={now}
        open={openAssignment != null}
        onOpenChange={(next) => {
          if (!next) show(null);
        }}
      />
    </div>
  );
}

/**
 * Every unit of the course, in the order the instructor set, with what is in it underneath.
 *
 * **A module, a project, and an assessment are peer sections in one list.** All three are course
 * units, so a project is not a block nested inside the module it happens to fall near — it sits
 * in the sequence where the instructor put it, with its own deliverables under it, exactly as a
 * module sits with its assignments.
 *
 * **Built from the course's units rather than from the assignments**, so a unit a student has
 * nothing in yet still appears. That is the point: the list is the shape of the course, and a
 * student should be able to see what is coming rather than only what has been handed out. A unit
 * whose assignments are all still drafts looks empty to them and full to the instructor, which is
 * what `distributedAt` is for.
 *
 * An assignment whose unit is somehow not in the list is still shown, under that unit, so nothing
 * can go missing from a student's page because of a data problem they cannot see. A *resource* in
 * an unknown unit is dropped instead, and the difference is deliberate: an assignment is work
 * somebody is graded on and must never disappear silently, where a reading filed under nothing has
 * nowhere to be shown and no consequence for going unseen.
 */
function groupByCourseUnit(course: Course, assignments: Assignment[], resources: Resource[]) {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      position: number;
      category: CourseUnitCategory;
      rows: Assignment[];
      resources: Resource[];
    }
  >();

  for (const row of course.courseUnits) {
    groups.set(row.id, { ...row, rows: [], resources: [] });
  }

  for (const assignment of assignments) {
    const existing = groups.get(assignment.courseUnit.id);
    if (existing) existing.rows.push(assignment);
    else
      groups.set(assignment.courseUnit.id, {
        ...assignment.courseUnit,
        rows: [assignment],
        resources: [],
      });
  }

  // Already in title order from the procedure, so pushing preserves it. Ordering resources
  // here would be a second alphabet beside the one the server applied.
  for (const resource of resources) {
    groups.get(resource.courseUnitId)?.resources.push(resource);
  }

  return [...groups.values()].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
}

function UnitSection({
  name,
  category,
  assignments,
  resources,
  teaches,
  openAssignmentId,
  onOpen,
}: {
  name: string;
  category: CourseUnitCategory;
  assignments: Assignment[];
  resources: Resource[];
  teaches: boolean;
  openAssignmentId: string | null;
  onOpen: (assignmentId: string | null) => void;
}) {
  /*
    Collapsed when there is nothing in it at all — resources count, so a unit holding only
    readings opens rather than reading as empty. A unit with nothing yet is worth seeing in the
    list and not worth taking up space open.

    Forced open when it holds the assignment the address names, which is what makes a link from
    the dashboard land somewhere a student can see. Without it, following one would open the panel
    over a unit still collapsed underneath, and closing the panel would leave them looking at a
    course page that had apparently ignored the link.
  */
  const holdsOpenAssignment =
    openAssignmentId != null && assignments.some((a) => a.id === openAssignmentId);
  const [open, setOpen] = React.useState(assignments.length > 0 || resources.length > 0);
  const complete = completeCount(assignments);
  const meta = CATEGORY_META[category];

  /*
    By due date, through the same comparator every other screen uses, so what a student sees is
    the order their instructor authored against.
  */
  const work = React.useMemo(() => sortByDueDate(assignments), [assignments]);

  return (
    <Collapsible open={open || holdsOpenAssignment} onOpenChange={setOpen}>
      <section className="overflow-hidden rounded-lg border border-border">
        {/*
          The heading wraps the control rather than sitting inside it: a button may only
          contain phrasing content, so an <h2> within one is invalid markup, and this is
          the shape screen readers expect from a collapsible section anyway.
        */}
        <h2>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/70">
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
            {/*
              What kind of unit this is, on everything but a module.

              A module is what most of a course is made of, so a badge on every one of eighteen
              would be a word repeated to distinguish nothing; the two that are not modules are
              exactly where the word carries information.
            */}
            {category !== "MODULE" && (
              <Badge variant="secondary" className="shrink-0 capitalize">
                {meta.noun}
              </Badge>
            )}
            {/*
              The assignment progress is the summary, and resources are counted beside it rather
              than folded into it: "2 of 5 complete" is a claim about work, and a reading is not
              work. A unit holding only readings says so instead of reading as 0 of 0.
            */}
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {unitSummary(work.length, complete, resources.length)}
            </span>
          </CollapsibleTrigger>
        </h2>

        <CollapsibleContent>
          {work.length === 0 && resources.length === 0 ? (
            <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
              Nothing has been handed out for this {meta.noun} yet.
            </p>
          ) : (
            <>
              {/*
                Named, the way the resources beneath are, and with the word the category uses —
                "Assignments" in a module, "Deliverables" in a project, "Parts" in an assessment.
                Without a heading only the second list said what it was, so the work read as "the
                unit's contents" and the readings as an afterthought, when they are two kinds of
                thing that happen to live in the same place. The instructor's curriculum screen
                names both lists for the same reason, from this same one place.
              */}
              {work.length > 0 && (
                <UnitList heading={meta.partPluralNoun}>
                  {work.map((assignment) => (
                    <li key={assignment.id}>
                      <AssignmentRow
                        assignment={assignment}
                        teaches={teaches}
                        isOpen={assignment.id === openAssignmentId}
                        onOpen={onOpen}
                      />
                    </li>
                  ))}
                </UnitList>
              )}

              {/*
                Beneath the assignments, under a heading of their own, and never interleaved with
                them. That is what makes the ordering question go away rather than needing an
                answer: assignments sort by due date and resources alphabetically, and two
                sequences cannot be merged into one without inventing a rule for comparing a
                deadline to a title.
              */}
              {resources.length > 0 && (
                <UnitList heading="Resources">
                  {resources.map((resource) => (
                    <li key={resource.id}>
                      <ResourceItem resource={resource} />
                    </li>
                  ))}
                </UnitList>
              )}
            </>
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/**
 * One assignment, as a row that opens the panel.
 *
 * **Every row opens, which the collapsing version could not manage.** A row with nothing behind
 * it yet had nothing to expand into, so an unaccepted assignment was a plain undecorated line and
 * the Accept button was the only control on it — which meant the instructions could not be read
 * before deciding to accept. The panel always has something to show, so the distinction goes.
 *
 * The Accept button stays on the row as well as in the panel. It is the common first action and
 * worth one press rather than two, and it stops the click from reaching the row so pressing it
 * does not also open a panel over the work it just created.
 */
function AssignmentRow({
  assignment,
  teaches,
  isOpen,
  onOpen,
}: {
  assignment: Assignment;
  teaches: boolean;
  isOpen: boolean;
  onOpen: (assignmentId: string | null) => void;
}) {
  // listForCourse scopes the relation to the caller, so this is the student's own
  // submission or nothing at all.
  const submission = assignment.submissions[0] ?? null;
  const status = submission?.status ?? "NOT_STARTED";
  const awaitingAccept =
    (!submission || status === "NOT_STARTED") && hasAcceptStep(assignment.kind);

  return (
    <div className="flex items-center">
      {/*
        Not wrapping: the two halves keep their columns in line, and a wrap would let the
        right-hand group drop under the title on one row and not the next.

        Which is why the right-hand group gives up its fixed widths below `sm` rather than the row
        giving up its shape. **The title is the one thing that is never dropped**, since every
        other column here is a press away inside the panel and the title is what a student is
        looking for in the list.
      */}
      <button
        id={assignmentRowId(assignment.id)}
        type="button"
        onClick={() => onOpen(assignment.id)}
        aria-expanded={isOpen}
        className={cn(
          "flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 min-[800px]:flex-nowrap",
          // The open row stays marked while the panel is over it, so it is clear which of fifty
          // rows the panel is describing once the reader looks back at the list.
          isOpen && "bg-accent/60",
        )}
      >
        <RowSummary
          assignment={assignment}
          submission={submission}
          action={
            awaitingAccept ? (
              /*
                A span rather than the button itself carrying the handler: the Accept control is
                inside the row's button, and a nested button is invalid markup that browsers
                resolve by discarding one of them. This stops the press here instead.
              */
              <span
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                role="presentation"
              >
                <AcceptAssignmentButton assignmentId={assignment.id} kind={assignment.kind} />
              </span>
            ) : null
          }
        />
      </button>

      {/*
        An instructor reading their own course as a student, which is what the test-student view
        is for. Outside the row's button for the same reason the Accept control stops the event:
        a link inside a button is markup neither element survives.
      */}
      {teaches && (
        <Link
          href={gradingQueueHref(assignment.courseId, assignment.id)}
          title="Every submission for this assignment"
          className="mr-3 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Wrench className="size-3.5" />
          <span className="sr-only">Every submission for this assignment</span>
        </Link>
      )}
    </div>
  );
}

/**
 * The scannable part of a row, identical whether or not the row opens.
 *
 * **Three siblings, and which of them grows is what holds the columns in line.** The title group
 * grows; the Accept control and the group of three columns beside it do not. So the columns are
 * anchored to the right edge of the row by the title having taken every remaining pixel, which
 * makes their position independent of whether the row has a button at all. Laying the five out as
 * siblings *without* that — which is how this started — put the button in the middle of the row
 * and shifted the status, score, and due date out of line with the rows above it.
 *
 * The status pill is the one thing in that group whose width varies, which is why it is first:
 * everything to its right is fixed-width and right-anchored, so those are the edges read down the
 * list. The kind badge stays with the title rather than joining them, so nothing above 800 pixels
 * looks any different from before.
 *
 * **Below 800 pixels it stacks instead**, and the whole point of that is the title. Three fixed
 * widths plus a variable pill plus a button came to more than a phone has, so the title — which is
 * what somebody is actually looking for — was squeezed to nothing. Given its own line it always
 * has the row. The rest follows underneath, where there is room for all of it, including the two
 * columns that used to be dropped at narrow widths.
 *
 * 800 rather than a named breakpoint because it is one measurement in one component: it is where
 * the group of columns stops fitting beside a title long enough to read, and nothing else in the
 * application has an opinion about that width.
 */
function RowSummary({
  assignment,
  submission,
  action,
}: {
  assignment: Assignment;
  submission: Submission | null;
  /** The Accept control, on the rows that have one. Its own sibling, so it moves when the row does. */
  action?: React.ReactNode;
}) {
  const status = submission?.status ?? "NOT_STARTED";
  const graded = submission?.finalScore != null;
  const percent = scorePercent(submission?.finalScore, submission?.finalScorePossible);
  // Null until something is graded, so an ungraded row cannot read as "Incomplete".
  const verdict = graded ? completionMeta(submission?.isComplete) : null;

  return (
    <>
      {/*
        The chevron travels with the title rather than sitting outside this group, which is what
        lets the title claim a whole line: a group asking for 100% of the row cannot share that
        line with anything, so anything meant to be beside the title has to be inside it.
      */}
      <span className="flex min-w-0 basis-full items-center gap-3 min-[800px]:basis-0 min-[800px]:flex-1">
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {/*
          What they are handing in, which decides what they do next: push and open a pull request,
          take a copy of a document, or upload a file. In front of the title rather than labelled
          after it, and at every width — the pill this replaced had to disappear below 800 pixels
          to leave the title a line of its own, and an icon costs sixteen pixels, so the narrow row
          keeps the one thing the wide row was telling it.
        */}
        <AssignmentKindIcon assignment={assignment} />
        <span className="min-w-0 truncate text-sm font-medium">{assignment.title}</span>
      </span>

      {/*
        `shrink-0`, so a long title truncates rather than the button compressing into the pill
        beside it. A half-width button is unpressable; a truncated title is still readable.
      */}
      {action && <span className="shrink-0">{action}</span>}

      <span className="flex shrink-0 items-center gap-x-2 sm:gap-x-3">
        <SubmissionStatusBadge status={status} audience="student" />

        {/*
          The score carries the verdict, because it is the number a student looks for and the
          pill beside it deliberately does not say it — "Graded" is blue, and green means
          "complete" here and nowhere else.

          Colour is not the only signal. An icon gives it a shape, and the word itself is read
          out to a screen reader, because red against green is the one pair a colourblind
          student is least likely to distinguish.
        */}
        <span
          className={cn(
            "flex items-center justify-end gap-1 text-right text-sm whitespace-nowrap tabular-nums min-[800px]:w-28",
            verdict?.className,
          )}
        >
          {graded ? (
            <>
              {verdict &&
                (submission?.isComplete ? (
                  <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />
                ) : (
                  <CircleSlash aria-hidden="true" className="size-3.5 shrink-0" />
                ))}
              {verdict && <span className="sr-only">{verdict.label}. </span>}
              <span className="font-medium">
                {submission?.finalScore}/{submission?.finalScorePossible}
              </span>
              <span className={verdict ? undefined : "text-muted-foreground"}>
                {formatPercent(percent)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{assignment.pointValue} pts</span>
          )}
        </span>

        {/*
          The time as well as the date, and the same words the dashboard uses for the same
          deadline. A row saying only "Due Oct 9" left a student to guess whether that meant the
          start of the day or the end of it, and anything after the hour their instructor chose is
          recorded as late.
        */}
        <span className="text-right text-xs whitespace-nowrap text-muted-foreground min-[800px]:w-36">
          {assignment.dueAt ? `Due ${formatDueDateShort(assignment.dueAt)}` : "No due date"}
        </span>
      </span>
    </>
  );
}

/**
 * "2 of 5 complete · 3 resources", or what is true when a part of it is empty.
 *
 * Separate counts rather than one figure, because they answer different questions and only one of
 * them is about work. Folding readings into the progress figure would make a unit read as
 * unfinished for holding a link.
 *
 * **No deadline.** A unit has no due date of its own; the closest thing is the latest among its
 * assignments, and one date standing for several says less than the rows beneath it already say —
 * each of those carries its own deadline to the minute.
 */
function unitSummary(assignments: number, complete: number, resources: number): string {
  const work = assignments === 0 ? null : `${complete} of ${assignments} complete`;
  const reading =
    resources === 0 ? null : `${resources} ${resources === 1 ? "resource" : "resources"}`;

  if (!work && !reading) return "Nothing yet";
  return [work, reading].filter(Boolean).join(" · ");
}

/**
 * Where the course stands, as one bar per category of work.
 *
 * **Three bars rather than one**, because "how am I doing" has three answers and one bar over
 * everything gives an average of them that describes none — a student who has finished every
 * assignment and no deliverable of the project reads as three quarters of the way through a
 * course they are behind in.
 *
 * A category with nothing in it gets no bar. Most courses have only assignments, and two empty
 * bars beneath the real one would imply work that has not been set.
 *
 * **The denominator is deliverables, not projects.** The instructor's overview counts whole
 * projects completed, which is the right figure for "how many has this student finished"; a
 * student is asking how far through the work they are, and the work is the deliverables. The two
 * are different questions rather than two answers to one, which is why they are allowed to
 * differ.
 */
function CourseProgress({ assignments }: { assignments: Assignment[] }) {
  const byCategory: Record<CourseUnitCategory, Assignment[]> = {
    MODULE: assignments.filter((a) => a.courseUnit.category === "MODULE"),
    PROJECT: assignments.filter((a) => a.courseUnit.category === "PROJECT"),
    ASSESSMENT: assignments.filter((a) => a.courseUnit.category === "ASSESSMENT"),
  };

  // Only where there is more than one bar. A course with modules alone should read exactly as it
  // did before, with no heading over a single bar explaining which of one thing it is.
  const shown = UNIT_CATEGORIES.filter((category) => byCategory[category].length > 0);

  return (
    <div className="flex flex-col gap-4">
      {shown.map((category) => (
        <CourseProgressBar
          key={category}
          assignments={byCategory[category]}
          label={shown.length > 1 ? CATEGORY_META[category].tabLabel : undefined}
          nouns={{
            one: CATEGORY_META[category].partNoun,
            many: CATEGORY_META[category].partPluralNoun,
          }}
        />
      ))}
    </div>
  );
}
