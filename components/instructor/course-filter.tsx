"use client";

import { BookOpen } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COURSES_PARAM, defaultCourseIds, shownCourseIds } from "@/lib/programs/performance";

/**
 * Which courses the Performance grid draws a band for.
 *
 * **It decides what is counted, not only what is drawn.** A fellow's group and the All courses
 * figures read only the courses chosen, so an instructor can ask who needs support in one course,
 * or in this month's courses, and have the roster sorted by that answer. Attendance counts
 * whichever courses are chosen, since it belongs to the program.
 *
 * **Archived courses are left out until ticked**, while the program is running, and listed under
 * their own heading so it is plain why they are unticked. Once the program is archived every
 * course is read by default. See `defaultCourseIds`.
 *
 * **The choice lives in the query string**, as the cohort picker's does, so a filtered grid can be
 * linked and survives a reload. Unlike the cohort, it is not remembered across visits: which
 * courses are worth comparing is a question of the moment rather than a way of working.
 */
export function CourseFilter({
  courses,
  programArchived,
}: {
  courses: { id: string; name: string; archived: boolean }[];
  /** A finished program reads every course by default; see `defaultCourseIds`. */
  programArchived: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const shown = shownCourseIds(searchParams.get(COURSES_PARAM), courses, programArchived);
  const fallback = defaultCourseIds(courses, programArchived);

  /*
    The default is written as no parameter at all, so the plain address keeps following the program
    as courses are published and archived. Anything else is written out in full, including "every
    course" while the default leaves the archived ones out.
  */
  function choose(next: Set<string>) {
    const params = new URLSearchParams(searchParams.toString());
    if (sameSet(next, fallback)) params.delete(COURSES_PARAM);
    else
      params.set(
        COURSES_PARAM,
        courses
          .filter((course) => next.has(course.id))
          .map((course) => course.id)
          .join(","),
      );
    const query = params.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  }

  function toggle(courseId: string, checked: boolean) {
    const next = new Set(shown);
    if (checked) next.add(courseId);
    else next.delete(courseId);
    choose(next);
  }

  if (courses.length === 0) return null;

  const running = courses.filter((course) => !course.archived);
  const archived = courses.filter((course) => course.archived);
  const defaultIsRunning = fallback.size < courses.length;

  const label = sameSet(shown, fallback)
    ? defaultIsRunning
      ? "Active courses"
      : "All courses"
    : shown.size === courses.length
      ? "All courses"
      : `${shown.size} of ${courses.length} courses`;

  const item = (course: { id: string; name: string }) => (
    <DropdownMenuCheckboxItem
      key={course.id}
      checked={shown.has(course.id)}
      onCheckedChange={(checked) => toggle(course.id, checked)}
      // Kept open, since choosing courses is usually several presses in a row.
      closeOnClick={false}
    >
      <span className="truncate">{course.name}</span>
    </DropdownMenuCheckboxItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Choose which courses to read"
          >
            <BookOpen data-icon="inline-start" />
            {label}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Which courses to read. The groups and the All courses figures count only these.
          </DropdownMenuLabel>
          {running.map(item)}
        </DropdownMenuGroup>
        {archived.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {defaultIsRunning
                  ? "Archived. Left out unless ticked, because they are over."
                  : "Archived"}
              </DropdownMenuLabel>
              {archived.map(item)}
            </DropdownMenuGroup>
          </>
        )}
        {!sameSet(shown, fallback) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => choose(fallback)}>
              {defaultIsRunning ? "Reset to active courses" : "Show every course"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}
