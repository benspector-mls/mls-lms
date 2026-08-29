"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarCheck,
  ChevronsUpDown,
  GraduationCap,
  Gauge,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquarePlus,
  School,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  Users,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatSchoolDay } from "@/lib/school-time";
import { ThemeToggle } from "@/components/theme-toggle";
import { ViewAsBanner } from "@/components/view-as-banner";
import { feedbackFormUrl } from "@/lib/feedback-form";
import {
  attendanceHref,
  curriculumHref,
  courseSettingsHref,
  gradebookHref,
  gradingQueueHref,
  gcfHref,
  myAttendanceHref,
  programSettingsHref,
  programsHref,
  rosterHref,
  sameViewInCourse,
  sameViewInProgram,
  teamsHref,
  triageHref,
} from "@/lib/links";
import { LAST_PLACE_COOKIE, LAST_PLACE_MAX_AGE, viewPlaceOf } from "@/lib/instructor/last-place";
import { initials } from "@/lib/people";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

/**
 * What the sidebar offers, which is not the same question as which page you are on.
 *
 * v0 derived this from the pathname — anything under /instructor was the instructor
 * view. That is a prototype convenience and would be wrong here twice over: a student
 * who typed an instructor URL would be shown instructor navigation, and an instructor
 * looking at their own course list would lose it. The role comes from the profile, and
 * the procedures enforce it independently.
 */
type Role = "student" | "instructor";

/**
 * Which course the reader is in, according to the address and nothing else.
 *
 * The URL is the only record of it. There is no remembered "current course", which is
 * deliberate: a remembered one disagrees with the page the moment you open a link, and a
 * sidebar that names a different course than the screen is worse than one that names none.
 *
 * So this returns null rather than a guess. It used to fall back to the first course in
 * the list, which is newest-first, and the result was a switcher confidently naming last
 * term's course while you graded this term's work.
 */
function useActiveCourseId(): string | null {
  const segments = usePathname().split("/").filter(Boolean);

  if (segments[0] === "instructor" && segments[1] === "courses" && segments[2]) {
    return segments[2];
  }
  // The student side has carried it all along: /courses/[courseId].
  if (segments[0] === "courses" && segments[1]) return segments[1];
  return null;
}

/**
 * Which program the reader is in, according to the address and nothing else.
 *
 * The counterpart of `useActiveCourseId`, and null rather than a guess for the same reason: a
 * sidebar naming a different program than the screen is worse than one naming none.
 *
 * **It reads only program addresses.** A course address names a course and resolves its program
 * from the course list — see `programOfCourse` — because carrying both identifiers in one URL would
 * give every link two scopes that could disagree and nothing to reconcile them with.
 */
function useActiveProgramId(): string | null {
  const segments = usePathname().split("/").filter(Boolean);

  if (segments[0] === "instructor" && segments[1] === "programs" && segments[2]) {
    return segments[2];
  }
  // The fellow-facing side: /programs, and /programs/[programId]/attendance.
  if (segments[0] === "programs" && segments[1]) return segments[1];
  return null;
}

/**
 * The program a course belongs to, from the list the sidebar already holds.
 *
 * A course address names no program, and the sidebar still has to draw the program group while an
 * instructor is inside a course. Reading it off `courses.listMine` rather than fetching it is what
 * keeps that free: every course in that payload carries its program, so this is a lookup
 * rather than a request.
 *
 * Null where the list has no row for the id — an address naming a course the caller is not in,
 * which every procedure behind the screen refuses anyway.
 */
function programOfCourse(
  courses: { id: string; program: { id: string } }[],
  courseId: string | null,
): string | null {
  if (!courseId) return null;
  return courses.find((course) => course.id === courseId)?.program.id ?? null;
}

// ---------------------------------------------------------------------------
// Breadcrumbs derived from the pathname + mock data
// ---------------------------------------------------------------------------

interface Crumb {
  label: string;
  href?: string;
}

function useBreadcrumbs(
  courses: { id: string; name: string; program: { id: string } }[],
  programs: { id: string; name: string; term: string }[],
): Crumb[] {
  const trpc = useTRPC();
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // ["instructor", "courses", <courseId>, ...rest]
  const inCourse = segments[0] === "instructor" && segments[1] === "courses" && segments[2];
  const rest = inCourse ? segments.slice(3) : [];

  /*
    The assignment routes: .../curriculum/<id> and .../curriculum/<id>/edit. "new" is a sibling
    of the ids rather than one of them, so it is excluded here and named below.
  */
  const assignmentId = rest[0] === "curriculum" && rest[1] !== "new" ? rest[1] : undefined;

  // Only fetched where the path names an assignment, because the title is the one label on
  // these screens the course list in memory cannot supply.
  const assignment = useQuery({
    ...trpc.assignments.get.queryOptions({ assignmentId: assignmentId ?? "" }),
    enabled: Boolean(assignmentId),
  });

  /*
    The term as well as the name, because a program runs every term under the same name:
    "Software Engineering Fellowship" is the first step of an identical trail in every year of it,
    and the term is what tells two of them apart.

    Parenthesised rather than a middot, because a breadcrumb already separates its steps and a
    second free-standing separator inside one step reads as another step.

    "Program" where the list has no row for the id — an address naming a program the caller
    is not in, which every procedure behind the screen refuses anyway. There is no term to give
    alongside it, which is why the fallback is the bare word rather than a half-built label.
  */
  const programLabel = (id: string) => {
    const program = programs.find((p) => p.id === id);
    return program ? `${program.name} (${program.term})` : "Program";
  };

  /*
    The course's own name and nothing else. It sits under the program crumb, which carries the
    term, so repeating the term here would say the same thing twice in one trail.
  */
  const courseLabel = (id: string) => courses.find((c) => c.id === id)?.name ?? "Course";

  /**
   * Every crumb before the view, for an instructor screen scoped to a course.
   *
   * **Two steps rather than one, and this is what the program above the course changed.** The
   * trail used to begin with the course, because a course was the whole scope; a course now
   * belongs to a program, and reading "Fullstack Software Engineering" without knowing
   * which year of it leaves the same question the sidebar used to answer wrongly.
   *
   * Both are plain text rather than links. There is no program home and no course home — the bare
   * course address redirects to Triage — and a breadcrumb whose first step lands somewhere the
   * reader did not name is worse than one that only says where they are.
   */
  const courseTrail = (courseId: string): Crumb[] => {
    const programId = programOfCourse(courses, courseId);
    return [
      ...(programId ? [{ label: programLabel(programId) }] : []),
      { label: courseLabel(courseId) },
    ];
  };

  if (inCourse) {
    const courseId = segments[2];
    const crumbs: Crumb[] = courseTrail(courseId);

    if (rest[0] === "triage") crumbs.push({ label: "Grading triage" });
    else if (rest[0] === "gradebook") crumbs.push({ label: "Gradebook" });
    else if (rest[0] === "teams") crumbs.push({ label: "Teams" });
    else if (rest[0] === "settings") crumbs.push({ label: "Settings" });
    else if (rest[0] === "curriculum") {
      // The list is a screen of its own, so it is a step on the trail rather than a heading
      // the deeper screens skip past.
      const listCrumb: Crumb = {
        label: "Curriculum",
        href: rest.length > 1 ? curriculumHref(courseId) : undefined,
      };
      crumbs.push(listCrumb);

      if (rest[1] === "new") crumbs.push({ label: "New assignment" });
      else if (rest[1]) {
        crumbs.push({
          label: assignment.data ? `Grading · ${assignment.data.title}` : "Grading queue",
          href: rest[2] === "edit" ? gradingQueueHref(courseId, rest[1]) : undefined,
        });
        if (rest[2] === "edit") crumbs.push({ label: "Edit" });
      }
    } else if (rest[0] === "students") crumbs.push({ label: "Work in this course" });

    return crumbs;
  }

  // ["instructor", "programs", <programId>, ...rest]
  if (segments[0] === "instructor" && segments[1] === "programs" && segments[2]) {
    const programId = segments[2];
    const programRest = segments.slice(3);
    const crumbs: Crumb[] = [{ label: programLabel(programId) }];

    if (programRest[0] === "attendance") {
      crumbs.push({
        label: "Attendance",
        href: programRest.length > 1 ? attendanceHref(programId) : undefined,
      });

      // The two tabs are one address and get no crumb of their own. A day does, and the date is
      // already the label a reader wants — "Friday, Aug 14" rather than the id of a session
      // nobody has seen. `formatSchoolDay` takes the segment as it stands in the URL.
      if (programRest[1] === "day" && programRest[2]) {
        crumbs.push({ label: formatSchoolDay(programRest[2]) });
      }
    } else if (programRest[0] === "roster") crumbs.push({ label: "Roster" });
    else if (programRest[0] === "cohorts") crumbs.push({ label: "Cohorts" });
    else if (programRest[0] === "instructors") crumbs.push({ label: "Instructors" });
    else if (programRest[0] === "settings") crumbs.push({ label: "Settings" });
    else if (programRest[0] === "students") crumbs.push({ label: "Fellow record" });

    return crumbs;
  }

  // `/instructor` itself, which shows nothing and redirects into a course's triage.
  if (segments[0] === "instructor") return [{ label: "Grading triage" }];

  /*
    A student's screens that are not one course. One step and no parent: the dashboard spans every
    course rather than sitting under one, and a trail claiming otherwise would be describing a
    hierarchy this side of the application does not have. The GCF is the same case for a sharper
    reason — a result carries no program at all.
  */
  if (segments[0] === "dashboard") return [{ label: "Dashboard" }];
  if (segments[0] === "gcf") return [{ label: "My GCF" }];

  /*
    A fellow's own attendance, which is the one screen on this side addressed by program. Its
    parent is the program rather than a course, because there is one morning to check into
    however many courses somebody is taking.
  */
  if (segments[0] === "programs" && segments[1]) {
    return [{ label: programLabel(segments[1]) }, { label: "Attendance" }];
  }

  if (segments[0] === "programs") return [{ label: "Programs" }];

  /*
    One course of a fellow's own. The same two steps the instructor screens take — the program with
    its term, then the course — because the question a bare course name leaves open is the same on
    both sides: a program runs every year under one name, and only the term tells two of them apart.

    Both are plain text. There is no screen above a fellow's course to point at: the sidebar lists
    every course they are in, and a first step that led somewhere they did not ask for would be
    worse than a trail that only says where they are.
  */
  if (segments[0] === "courses" && segments[1]) {
    return courseTrail(segments[1]);
  }

  /*
    The two screens that belong to the reader rather than to a program: their own account, and the
    staff list an admin keeps. One step each, because neither sits under anything.
  */
  if (segments[0] === "profile") return [{ label: "Profile" }];
  if (segments[0] === "admin") return [{ label: "Staff" }];

  /*
    An address this function does not recognise, which draws no trail at all. Every route in the
    application is named above, so an invented label here could only be wrong — and a breadcrumb
    that names the wrong screen is worse than a header with no breadcrumb in it.
  */
  return [];
}

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

/**
 * Which program an instructor is working in, and the way into another one.
 *
 * **Instructors only**, and the asymmetry is deliberate rather than unfinished. An instructor works
 * a handful of programs whose screens are identical, so a switcher trades one click for a
 * sidebar that stays the same height however many years they accumulate. A fellow is in one
 * program at a time and lands on `/dashboard`, which names none — a switcher in the header
 * would greet them every morning with a control pointing at something the screen is not about, and
 * the alternative of guessing one is what the note on `useActiveCourseId` records going wrong.
 * Their own programs are listed instead. See `StudentPrograms`.
 *
 * **It is selected from a course address too.** An instructor inside a course is inside its
 * program, and a switcher that emptied itself there would be blank on the screens where they
 * spend the most time. `programOfCourse` is what fills it in.
 */
function ProgramSwitcher({
  programs,
  selected,
}: {
  programs: { id: string; name: string; term: string; archivedAt: Date | null }[];
  /** The program the address is in, resolved through the course where it names one. */
  selected: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Nothing to select between and nothing to say, which is where anybody starts before their
  // first program exists.
  if (programs.length === 0) return null;

  /*
    Only a program this switcher can actually label. An id it has no row for would otherwise
    reach `Select.Value`, which falls back to printing the raw value, and the trigger would read
    as a bare uuid.
  */
  const value = programs.some((p) => p.id === selected) ? selected : null;

  /*
    Archived programs last, and labelled, rather than mixed in by date.

    They belong in here — it is how somebody gets back into a finished year — but a switcher is a
    list of places to work, and the ones still running are what it should open on.
  */
  const ordered = [
    ...programs.filter((p) => p.archivedAt == null),
    ...programs.filter((p) => p.archivedAt != null),
  ];

  const label = (p: (typeof programs)[number]) =>
    p.archivedAt != null ? `${p.name} · ${p.term} · Archived` : `${p.name} · ${p.term}`;

  return (
    <Select
      value={value}
      /*
        The same view in the other program, not its front page. Somebody comparing two
        years' attendance asks for the other year's attendance; being dropped at a front page
        means finding the way again on every switch.
      */
      onValueChange={(id) => {
        // Typed as nullable because `value` is: the trigger sits on a placeholder wherever the
        // address names no program, and clearing the selection is not a navigation.
        if (id) router.push(sameViewInProgram(pathname, id));
      }}
      /*
        Without this the trigger renders the *value* — a program id — rather than the name,
        because `Select.Value` has no other way to know what the selected item was labelled.
        Any select whose value is not also its label needs it.
      */
      items={Object.fromEntries(ordered.map((p) => [p.id, label(p)]))}
    >
      <SelectTrigger className="w-full" aria-label="Select program">
        <School className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Choose a program" />
        <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
      </SelectTrigger>
      {/*
        Under the trigger, not over it. The default positioning puts the *selected* row on top of
        the trigger, so an instructor whose current program is third in the list opens the
        switcher onto a popup whose first two rows are above the top of the window and cannot be
        scrolled to. Anchoring the popup below the trigger starts the list at its first row, which
        is the only arrangement where every program is reachable.
      */}
      <SelectContent alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {/*
            The term as well as the name, because a program runs every year under the same name:
            two rows both reading "Software Engineering Fellowship" are a switcher that cannot be
            used. The term is what tells them apart, so it belongs on the row and on the trigger —
            which is why it is in `items` above too.
          */}
          {ordered.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{p.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {p.archivedAt != null ? `${p.term} · Archived` : p.term}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * The course's first letter, where every other row in the sidebar draws its icon. A book beside a
 * name the reader can already see says nothing; the collapsed sidebar is 48 pixels wide and shows
 * the icon alone, and that is where a row has to be recognisable. Two courses in one program whose
 * names begin with the same letter are told apart by the tooltip, which carries the full name.
 *
 * `size-4 shrink-0` is written out rather than inherited. `SidebarMenuButton` sizes its icons with
 * `[&_svg]:size-4 [&_svg]:shrink-0`, and those two rules are the only thing it does to an icon —
 * there is no colour rule and no margin rule for a text element to miss — so naming the same
 * 16-pixel square here lands in the same place a lucide icon does. `shrink-0` is what stops the
 * letter being squeezed once a long course name fills the row.
 *
 * The colour comes by inheritance, so the open course's letter darkens with the rest of its row.
 * `font-semibold` is set here deliberately, to outrank the `data-active:font-medium` the button
 * inherits down: the letter should not change weight when the course is opened.
 *
 * `aria-hidden`, because the letter is the first character of the name announced immediately after
 * it — without it a screen reader reads "F, Fullstack Software Engineering".
 */
function CourseInitial({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center text-sm font-semibold leading-none"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * The program's courses, each opening to its own five views.
 *
 * **A list rather than a picker**, which is the difference between choosing a course and being shown
 * what there is. A select answered "which one am I in" and hid the rest behind a click; an
 * instructor with three courses now reads all three, and the one they are working in shows what it
 * holds. It is the same shape a fellow's own sidebar has, and it is the shape for the same reason:
 * a flat list can say *which* course but has nothing to say which screen inside it.
 *
 * **Only the course being read expands.** Three courses each showing five views is fifteen rows to
 * hold five destinations, and nobody is choosing among all of them at once — they are in one course,
 * looking for one of its parts.
 *
 * **Clicking a course keeps the view.** From course A's gradebook, course B's row goes to *its*
 * gradebook rather than to a front page, which is the one property the picker had that was worth
 * keeping: somebody comparing two courses' triage asks for the other one's triage. `sameViewInCourse`
 * decides, and where the view cannot travel — an assignment's queue belongs to one course — it lands
 * on settings rather than on an id the other course does not have.
 *
 * **Only this program's courses**, which is what keeps the list readable: courses are named for
 * what they teach and every year runs the same ones, so an unscoped list would hold four rows
 * reading "Fullstack Software Engineering" that nothing on the row could tell apart. Reaching another
 * year is the program switcher in the header.
 */
function CourseList({
  courses,
  selected,
  pathname,
}: {
  courses: { id: string; name: string; archivedAt: Date | null }[];
  selected: string | null;
  pathname: string;
}) {
  /*
    Archived courses last, and labelled. They belong in here — it is how somebody gets back into a
    course that has finished while the rest of the program runs on — but this is a list of
    places to work, and the ones still running are what it should open on.
  */
  const ordered = [
    ...courses.filter((course) => course.archivedAt == null),
    ...courses.filter((course) => course.archivedAt != null),
  ];

  return (
    <SidebarMenu>
      {ordered.map((course) => {
        const open = course.id === selected;

        return (
          <SidebarMenuItem key={course.id}>
            <SidebarMenuButton
              isActive={open}
              tooltip={course.archivedAt != null ? `${course.name} · Archived` : course.name}
              // `h-auto` because an archived row is two lines where every other one is one.
              className="h-auto py-1.5"
              render={<Link href={sameViewInCourse(pathname, course.id)} />}
            >
              <CourseInitial name={course.name} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{course.name}</span>
                {course.archivedAt != null && (
                  <span className="truncate text-xs text-muted-foreground">Archived</span>
                )}
              </span>
            </SidebarMenuButton>

            {open && (
              <SidebarMenuSub>
                {COURSE_VIEWS.map((view) => (
                  <SidebarMenuSubItem key={view.segment}>
                    <SidebarMenuSubButton
                      isActive={isActiveCourseView(pathname, course.id, view.segment)}
                      render={<Link href={view.href(course.id)} />}
                    >
                      <span>{view.title}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/**
 * The three views a program has, in the order they are offered.
 *
 * Attendance leads, and it is the only item in either group touched at a fixed time every single
 * morning — being findable without thinking is most of what it needs. The roster is second because
 * it is what everything else is about, and the settings last because they are read at the start of a
 * year and rarely after.
 *
 * **Three rather than five, and the two that went were sections rather than screens.** Cohorts are a
 * tab on the roster, because placing fellows is a thing done to it; instructors are a card on the
 * settings, because who runs a program is a fact about it. Each had its own address while the
 * question was open, and running it answered them — five sidebar items were five doors onto three
 * rooms, and a menu that long stops being read.
 */
const PROGRAM_VIEWS = [
  { title: "Attendance", href: attendanceHref, icon: CalendarCheck, segment: "attendance" },
  { title: "Roster", href: rosterHref, icon: Users, segment: "roster" },
  { title: "Settings", href: programSettingsHref, icon: Settings, segment: "settings" },
] as const;

/**
 * The five views a course has, in the order they are offered.
 *
 * They were tabs on one course page until the page had a header, a triage button, a tab bar, and a
 * row of counts competing for the same band of screen. As sidebar items each one is an address,
 * which is what lets the switcher keep the view across a change of course and what lets a link name
 * a screen rather than a page-plus-a-tab nobody can bookmark.
 *
 * Triage leads, because "what is waiting on me" is the question an instructor opens this
 * application to ask. Attendance and the roster are not here at all any more: a fellow arrives at
 * the building once and joins one roster, so both are the program's above.
 */
const COURSE_VIEWS = [
  { title: "Triage", href: triageHref, icon: ListChecks, segment: "triage" },
  { title: "Gradebook", href: gradebookHref, icon: BarChart3, segment: "gradebook" },
  { title: "Curriculum", href: curriculumHref, icon: Layers, segment: "curriculum" },
  { title: "Teams", href: teamsHref, icon: UsersRound, segment: "teams" },
  { title: "Settings", href: courseSettingsHref, icon: Settings, segment: "settings" },
] as const;

function MainNav({
  role,
  isAdmin,
  courses,
}: {
  role: Role;
  isAdmin: boolean;
  /** A fellow's sidebar *is* this list, so it comes down rather than being fetched twice. */
  courses: StudentCourse[];
}) {
  const pathname = usePathname();
  const activeCourseId = useActiveCourseId();
  const activeProgramId = useActiveProgramId();

  if (role === "student") {
    return (
      <>
        <StudentWork pathname={pathname} />
        <StudentPrograms courses={courses} pathname={pathname} />
        <AdminGroup isAdmin={isAdmin} pathname={pathname} />
      </>
    );
  }

  /*
    Every scoped item points at the program or the course in the address, so navigating never
    changes which one you are in. They used to be a fixed `/instructor` and the *first* course in
    the list, which meant grading one course's queue and then clicking "Course" took you into a
    different one entirely.

    Only from an instructor address, though. `/courses/[courseId]` names a course too, and an
    instructor is sometimes reading one they do not teach — a colleague's course they are enrolled
    in — where every one of these would lead somewhere that refuses them. The switchers are
    unaffected: switching *out* of such a course is exactly what they are for.

    With nothing to scope them to the group is dropped rather than pointed at a guess, which is how
    this went wrong in the first place. "All programs" is always there, and the bare `/instructor`
    still resolves to a real course's triage for anybody who types it.
  */
  const inInstructorArea = pathname.startsWith("/instructor/");
  const navCourseId = inInstructorArea ? activeCourseId : null;
  /*
    The program of the address, from the program id in it or from the course in it. A course
    address names no program, so without the second half the program group would vanish on the
    screens an instructor uses most — and the sidebar would stop offering attendance exactly where
    it is opened every morning.
  */
  const navProgramId = inInstructorArea
    ? (activeProgramId ?? programOfCourse(courses, activeCourseId))
    : null;

  // Only this program's courses, for the reason `CourseSwitcher` records: every year runs
  // the same courses under the same names, so an unscoped list cannot be read.
  const programCourses = navProgramId
    ? courses.filter((course) => course.teaches && course.program.id === navProgramId)
    : [];

  return (
    <>
      {/*
        Its own group, above the two scopes and separated from them. Everything below is scoped to
        one program or one of its courses; this is the way out of all of them, and grouping
        it among them made it read as one more view of the program you were already in.
      */}
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === programsHref()}
              tooltip="All programs"
              render={<Link href={programsHref()} />}
            >
              <School />
              <span>All programs</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      {navProgramId && (
        <SidebarGroup>
          <SidebarSeparator className="mx-0 mb-2" />
          {/*
            No label. The switcher in the header names the program, and a heading reading
            "Program" over five items that are all this program would be a second, vaguer answer
            to a question already answered.
          */}
          <SidebarMenu>
            {PROGRAM_VIEWS.map((view) => (
              <SidebarMenuItem key={view.segment}>
                <SidebarMenuButton
                  isActive={isActiveProgramView(pathname, navProgramId, view.segment)}
                  tooltip={view.title}
                  render={<Link href={view.href(navProgramId)} />}
                >
                  <view.icon />
                  <span>{view.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}

      {/*
        The program's courses, under a heading rather than behind a control.

        **Drawn whenever a program is known, whether or not a course is**, which is what makes
        it a list and not a picker: an instructor standing on the roster is shown what the year holds
        rather than an empty select. Nothing expands until one of them is open.
      */}
      {navProgramId && programCourses.length > 0 && (
        <SidebarGroup>
          <SidebarSeparator className="mx-0 mb-2" />
          <SidebarGroupLabel>Courses</SidebarGroupLabel>
          <CourseList courses={programCourses} selected={navCourseId} pathname={pathname} />
        </SidebarGroup>
      )}

      <AdminGroup isAdmin={isAdmin} pathname={pathname} />
    </>
  );
}

/** What the sidebar needs from `courses.listMine`. */
type StudentCourse = {
  id: string;
  name: string;
  /** The program the course belongs to, which is what the fellow's own list groups by. */
  program: { id: string; name: string; term: string; archivedAt: Date | null };
  archivedAt: Date | null;
  enrolledAs: "ACTIVE" | "REMOVED" | null;
  /** Whether the caller instructs the course's program, which scopes the course switcher. */
  teaches: boolean;
};

/**
 * The screen that spans a fellow's courses, above the courses themselves.
 *
 * **A group of one, and separated from the list below deliberately.** Everything under a program's
 * heading belongs to one program; this is the view across all of them, and putting it among
 * them would make it read as a course. It is where signing in lands and what the sidebar opens on,
 * because "what is due" is the question a fellow arrives with and no single course can answer it.
 *
 * The Notes screen will be the second item here.
 */
function StudentWork({ pathname }: { pathname: string }) {
  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/dashboard"}
            tooltip="Dashboard"
            render={<Link href="/dashboard" />}
          >
            <LayoutDashboard />
            <span>Dashboard</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * A fellow's programs, each holding its attendance and its courses.
 *
 * Most of their navigation, and every course they are in rather than a link to a list of them. It
 * replaced a single "My courses" item under a heading reading "Student", which spent a row telling
 * a reader who they were and then made reaching a course two clicks: one to a list, one to the
 * course.
 *
 * **Attendance sits beside the program's name rather than under a course**, which is the change the
 * program above the course made visible here. A fellow taking three courses that all meet on a
 * Tuesday used to have three attendance screens and three codes to type; there is one morning, so
 * there is one row. It comes first inside the group for the reason it leads the instructor's group
 * too — it is the one item touched at a fixed time every single morning.
 *
 * The courses beneath it are flat, each linking straight to its coursework. They used to expand to
 * show their screens, which existed only to reach attendance from inside a course; with attendance
 * a sibling of the courses there is nothing left underneath one to offer.
 *
 * **There is no screen listing a fellow's courses and no item pointing at one.** This is that list,
 * on every screen rather than on one of them, so a page whose whole purpose was navigating between
 * courses would be a row leading to a copy of the rows above it — and it was reachable only in the
 * one state this group cannot draw, which made it a screen a fellow saw once and never again.
 *
 * **Archived programs and courses stay, labelled**, exactly as the course itself labels them. A
 * program somebody has finished or been removed from is still theirs to read — that is what
 * removal being a status rather than a deletion is for — and one sitting here unlabelled among the
 * ones they are in would be the sidebar telling them something false.
 */
function StudentPrograms({ courses, pathname }: { courses: StudentCourse[]; pathname: string }) {
  /*
    Grouped by program, current ones first and finished ones after, preserving the order
    `listMine` sent — the same ordering the instructor switchers apply and for the same reason: this
    is a list of places to work, and the ones still running are what it should open on.
  */
  const programs: StudentCourse["program"][] = [];
  const byProgram = new Map<string, StudentCourse[]>();

  for (const course of courses) {
    const existing = byProgram.get(course.program.id);
    if (existing) {
      existing.push(course);
    } else {
      programs.push(course.program);
      byProgram.set(course.program.id, [course]);
    }
  }

  const ordered = [
    ...programs.filter((program) => program.archivedAt == null),
    ...programs.filter((program) => program.archivedAt != null),
  ];

  /*
    Nothing to group, which is where a fellow starts: signed in, on nobody's roster yet. The GCF is
    all this group has left to offer, and the dashboard they are already on is what explains the
    empty sidebar — a row leading to a second screen saying the same thing would be one more place
    to go and nothing more to read.
  */
  if (ordered.length === 0) {
    return (
      <SidebarGroup>
        <StudentGcf pathname={pathname} />
      </SidebarGroup>
    );
  }

  return (
    <>
      {ordered.map((program) => {
        const programCourses = byProgram.get(program.id) ?? [];
        const attendance = myAttendanceHref(program.id);

        return (
          <SidebarGroup key={program.id}>
            {/*
              The term in the heading, because a program runs every year under the same
              name and somebody repeating one would otherwise see two identical headings. Archived
              is said here rather than on every course beneath it: it is a fact about the whole
              program, and repeating it per course would say the same thing four times.
            */}
            <SidebarGroupLabel>
              {program.archivedAt != null
                ? `${program.name} · ${program.term} · Archived`
                : `${program.name} · ${program.term}`}
            </SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === attendance}
                  tooltip={`Attendance · ${program.term}`}
                  render={<Link href={attendance} />}
                >
                  <CalendarCheck />
                  <span>Attendance</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {programCourses.map((course) => {
                const note = courseNote(course);
                const base = `/courses/${course.id}`;

                return (
                  <SidebarMenuItem key={course.id}>
                    <SidebarMenuButton
                      /*
                        Prefix, not equality. A fellow reading one assignment is deeper inside the
                        course and is still inside it — an exact match would leave every row in the
                        sidebar dark and the reader nowhere.
                      */
                      isActive={pathname === base || pathname.startsWith(`${base}/`)}
                      /*
                        The full name, because the label truncates and the collapsed sidebar shows
                        nothing else. The term is not repeated — the heading above carries it.
                      */
                      tooltip={note ? `${course.name} · ${note}` : course.name}
                      // `h-auto` because this row is two lines wherever there is a note to show.
                      className="h-auto py-1.5"
                      render={<Link href={base} />}
                    >
                      <CourseInitial name={course.name} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{course.name}</span>
                        {note && (
                          <span className="truncate text-xs text-muted-foreground">{note}</span>
                        )}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        );
      })}

      <SidebarGroup>
        <StudentGcf pathname={pathname} />
      </SidebarGroup>
    </>
  );
}

/**
 * The GCF, outside every program.
 *
 * **A record that follows a person rather than a program.** CodeSignal has no idea what a
 * program is, a fellow sits the assessment on their own schedule, and somebody who repeats a
 * year should find one history rather than two halves of it. So `/gcf` names no scope at all, and
 * it sits in its own group beneath every program rather than under any one program's heading,
 * which would be claiming a result belonged to that year.
 */
function StudentGcf({ pathname }: { pathname: string }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={pathname === gcfHref()}
          tooltip="My GCF results"
          render={<Link href={gcfHref()} />}
        >
          <Gauge />
          <span>My GCF</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * Why a course is in the list but not one somebody is currently in, or null when it is.
 *
 * Removal wins over archiving when both are true, because it is the fact about *this reader*: a
 * program that ended is something everybody in it shares, and having left one is not.
 */
function courseNote(course: StudentCourse): string | null {
  if (course.enrolledAs === "REMOVED") return "No longer enrolled";
  if (course.archivedAt != null) return "Archived";
  return null;
}

/**
 * Which sidebar item the current address belongs to, for a program's five views.
 *
 * **Attendance owns the day drill-down beneath it**, so the item stays lit while an instructor
 * corrects an earlier morning rather than going blank on the one screen reached from it.
 *
 * A fellow's record under `/students/[studentId]` deliberately matches nothing. It is reached from
 * three different places and belongs to none of them.
 */
function isActiveProgramView(pathname: string, programId: string, segment: string): boolean {
  const base = `/instructor/programs/${programId}`;
  return pathname === `${base}/${segment}` || pathname.startsWith(`${base}/${segment}/`);
}

/**
 * Which sidebar item the current address belongs to, for a course's five views.
 *
 * Two segments need more than a prefix test. **Curriculum** covers its own list *and* every screen
 * filed under it — one assignment's grading queue, its edit form, the new-assignment form — because
 * those are reached from it and highlighting nothing while you grade would make the sidebar go
 * blank exactly where an instructor spends the most time. **Triage** owns the bare course
 * address, which redirects to it, so the item is lit before the redirect resolves rather than
 * flickering off and on.
 *
 * A fellow's work under `/students/[studentId]` deliberately matches nothing, for the reason the
 * program version above records.
 */
function isActiveCourseView(pathname: string, courseId: string, segment: string): boolean {
  const base = `/instructor/courses/${courseId}`;

  if (segment === "triage" && pathname === base) return true;

  return pathname === `${base}/${segment}` || pathname.startsWith(`${base}/${segment}/`);
}

/**
 * Who may teach at all, which is a different kind of capability from everything above it:
 * those are scoped to a program, and this decides who gets one.
 *
 * Hidden from an instructor, and that is presentation only — `/admin` reads through
 * `adminProcedure`, so an instructor who types the URL is refused by the procedures rather than
 * by this component having declined to draw a link. Offering a link that leads to a refusal is
 * the thing worth avoiding here; the refusal itself is not this file's job.
 */
function AdminGroup({ isAdmin, pathname }: { isAdmin: boolean; pathname: string }) {
  if (!isAdmin) return null;

  return (
    <SidebarGroup>
      <SidebarSeparator className="mx-0 mb-2" />
      <SidebarGroupLabel>Admin</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/admin"}
            tooltip="Staff"
            render={<Link href="/admin" />}
          >
            <ShieldCheck />
            <span>Staff</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function UserMenu({
  person,
}: {
  person: { displayName: string | null; email: string | null; githubUsername: string | null };
}) {
  const router = useRouter();

  // The screen the reader is on when they open the menu, which is the one useful thing a bug
  // report cannot be expected to name for itself. Read here rather than passed in: this component
  // already sits inside `ShellSidebar`'s Suspense boundary, which is what reading the address
  // requires under Cache Components.
  //
  // The query string matters as much as the path — it is where the gradebook keeps the cohort it
  // is filtered to and the grading queue keeps the submission it has open. `feedbackFormUrl` says
  // which addresses this cannot reach and what the form does about them.
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Signing out clears the Supabase session cookie; the redirect is a fallback for the
  // rare case the proxy has already served this page from cache.
  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };

  const name = person.displayName ?? person.email ?? "Your account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            /*
              Collapsed, this is one 32-pixel square and nothing else — the same shape the brand
              above it and every navigation item take, and the same shape the footer has room
              for. The icon-width sidebar is 3rem with 8 pixels of footer padding on each side,
              which leaves exactly the width of the avatar: the horizontal padding has to go, or
              the square is pushed 6 pixels past the sidebar on both sides and reads as being
              oversized rather than as overflowing.
            */
            className="flex w-full items-center gap-2 rounded-md p-1.5 text-left outline-none transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <Avatar className="size-8 shrink-0 rounded-md">
          <AvatarFallback className="rounded-md bg-primary/10 text-xs font-medium text-primary">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        {/*
          The name, the address and the chevron are all gone when collapsed, for the reason the
          brand's wordmark is: there is no width for them. The chevron in particular has nothing
          to shrink into — it is `shrink-0`, so it does not compress, it simply hangs outside the
          sidebar's right edge.
        */}
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-sm font-medium text-sidebar-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{person.email}</p>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-56" side="top" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="text-xs font-normal text-muted-foreground">
              {person.githubUsername ? "Signed in as" : "No GitHub account linked"}
            </span>
            {person.githubUsername && (
              <>
                <br />@{person.githubUsername}
              </>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/*
          The way to the Profile screen, and the only one. It belongs here rather than in the
          navigation above because everything up there is a place to work — a program, a course, a
          queue — and this is the account those are being worked in. It is also where the name and
          the address already are, two lines up on the trigger, so it is where somebody who wants to
          change one of them looks first.
        */}
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/profile" />}>
            <UserRound />
            Profile
          </DropdownMenuItem>
          {/*
            Beside Profile rather than in the navigation above, for that item's own reason:
            everything up there is a place to work, and this is neither a place nor work.

            A new tab, which is the whole point of pre-filling the screen — the reader is
            reporting something about the page they are looking at, and sending them away from it
            to describe it would be the one thing this must not do.
          */}
          <DropdownMenuItem
            render={
              <a
                href={feedbackFormUrl({ pathname, search: searchParams.toString() })}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <MessageSquarePlus />
            Send feedback
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={signOut} variant="destructive">
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/**
 * The frame, which reads nothing.
 *
 * The sidebar and the breadcrumb both need the signed-in profile and the caller's
 * courses, and with Cache Components a layout that reads uncached data blocks every page
 * beneath it — the build refuses it outright. So the two data-dependent pieces sit
 * behind their own Suspense boundaries and `children` streams independently of both. A
 * page is never waiting on the chrome around it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      {/*
        Renders nothing and is here for its effect, in a boundary of its own for the reason the
        three below have theirs: it reads the address, which is uncached, and a layout that reads
        uncached data outside a boundary blocks every page under it — the build refuses it outright.
      */}
      <React.Suspense fallback={null}>
        <RememberPlace />
      </React.Suspense>

      <React.Suspense fallback={<ShellSidebarFallback />}>
        <ShellSidebar />
      </React.Suspense>

      {/*
        `min-w-0`, and it is the whole reason a wide table scrolls rather than the page.

        `SidebarInset` is a flex item of the provider's row, and a flex item's `min-width: auto`
        resolves to its content-based minimum — so the gradebook's fifty columns pushed this
        wider than the viewport, and everything measured against it went with them. The window
        scrolled sideways instead of the table: the header's theme toggle left the screen, the
        search box and the New assignment button were cut off, and the gradebook's sticky
        Student column stuck to a scroll that was not the one moving, so it slid over the
        sidebar. `w-full` does not prevent any of that — it sets the basis and leaves the
        minimum alone.

        With a floor of zero the width is definite at every level below, which is what lets the
        `overflow-x-auto` around each table be the thing that scrolls.
      */}
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <React.Suspense fallback={<div className="min-w-0 flex-1" />}>
            <ShellBreadcrumb />
          </React.Suspense>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        {/*
          Below the header and above everything else, in its own boundary for the same reason the
          sidebar and breadcrumb are in theirs: it reads the session, and a layout that reads
          uncached data blocks every page beneath it. The fallback is nothing at all — an empty
          strip flashing in on every navigation would be worse than the banner arriving a moment
          after the page, and it renders nothing in the overwhelmingly common case anyway.
        */}
        <React.Suspense fallback={null}>
          <ViewAsBanner />
        </React.Suspense>
        <main className="flex-1 overflow-x-hidden">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Records the instructor view being read, so that `/instructor` can return to it next time.
 *
 * **In the shell rather than on each screen**, because it has to happen on every one of them and a
 * screen that forgot would quietly lose the reader's place rather than fail. It costs nothing on
 * the screens it does not apply to: `viewPlaceOf` returns null for every fellow-facing address
 * and for the two instructor screens that light no sidebar item, and null writes nothing.
 *
 * **A component rather than a hook called by `AppShell`**, so that reading the address happens
 * inside a Suspense boundary. `AppShell` itself reads nothing, and that is deliberate: with Cache
 * Components a layout that reads uncached data delays every page beneath it.
 *
 * **A cookie written by the browser**, the way `sidebar_state` is in `components/ui/sidebar.tsx`.
 * The alternative was a column on `Profile` and a mutation, which would have made a network request
 * of every navigation to remember something a redirect reads once a day. Not `httpOnly`, because
 * this is what writes it; nothing trusts it, and `/instructor` re-checks the course or program it
 * names against the caller's own list before going there.
 *
 * The trade is that it is remembered per browser. Signing in somewhere new falls back to the guess
 * `/instructor` has always made, which is the right thing for it to do anyway.
 */
function RememberPlace(): null {
  const pathname = usePathname();

  React.useEffect(() => {
    const place = viewPlaceOf(pathname);
    if (!place) return;

    document.cookie = `${LAST_PLACE_COOKIE}=${place.href}; path=/; max-age=${LAST_PLACE_MAX_AGE}; samesite=lax`;
  }, [pathname]);

  return null;
}

/** The sidebar's shape while the profile, the program list and the course list are in flight. */
function ShellSidebarFallback() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ShellBrand />
      </SidebarHeader>
      <SidebarContent />
    </Sidebar>
  );
}

function ShellBrand() {
  return (
    <div className="flex items-center gap-2 px-1.5 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <GraduationCap className="size-5" />
      </div>
      <div className="min-w-0 group-data-[collapsible=icon]:hidden">
        <p className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
          Marcy LMS
        </p>
      </div>
    </div>
  );
}

function ShellSidebar() {
  const trpc = useTRPC();
  const { data: profile } = useSuspenseQuery(trpc.me.queryOptions());
  const { data: courses } = useSuspenseQuery(trpc.courses.listMine.queryOptions());
  /*
    Both lists, because the sidebar has two scopes to name and neither payload holds the other's
    facts. `courses.listMine` carries each course's program, which is what resolves the
    program of a course address; it cannot carry one that has no courses yet, and an
    instructor setting one up needs its roster and its settings before it does.
  */
  const { data: programs } = useSuspenseQuery(trpc.programs.listMine.queryOptions());

  // Read from the profile rather than the URL. A student who typed an instructor
  // address would otherwise be shown instructor navigation, and every page behind it
  // would refuse them — which is a worse answer than not offering the link.
  const role: Role =
    profile?.role === "INSTRUCTOR" || profile?.role === "ADMIN" ? "instructor" : "student";

  // Separate from `role` rather than a third value in it, because an admin is an instructor who
  // can also do one more thing. Folding it into `role` would make every `role === "instructor"`
  // check in here silently exclude admins.
  const isAdmin = profile?.role === "ADMIN";

  /*
    Read here as well as in `MainNav`, because the switcher sits in the header and the groups sit
    in the content — two components, one answer. Both are hooks over the pathname, so this costs
    nothing beyond the parse.
  */
  const activeCourseId = useActiveCourseId();
  const activeProgramId = useActiveProgramId();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ShellBrand />
        {/*
          Instructors only. A student's courses are the sidebar itself, a few rows down, so a
          switcher here would be a second control over the same list.
        */}
        {role === "instructor" && (
          <div className="group-data-[collapsible=icon]:hidden">
            <ProgramSwitcher
              programs={programs}
              selected={activeProgramId ?? programOfCourse(courses, activeCourseId)}
            />
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <MainNav role={role} isAdmin={isAdmin} courses={courses} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator className="mx-0" />
        {profile && <UserMenu person={profile} />}
      </SidebarFooter>
    </Sidebar>
  );
}

function ShellBreadcrumb() {
  const trpc = useTRPC();
  const { data: courses } = useSuspenseQuery(trpc.courses.listMine.queryOptions());
  const { data: programs } = useSuspenseQuery(trpc.programs.listMine.queryOptions());
  const crumbs = useBreadcrumbs(courses, programs);

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <React.Fragment key={`${crumb.label}-${i}`}>
              <BreadcrumbItem className={cn(i > 0 && "hidden md:block")}>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={crumb.href} />} className="truncate">
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator className={cn(i > 0 && "hidden md:block")} />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
