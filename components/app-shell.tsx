"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import {
  BarChart3,
  BookOpen,
  ChevronsUpDown,
  ClipboardList,
  GraduationCap,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react"

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
  SidebarProvider,
  SidebarTrigger,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  courseAssignmentsHref,
  courseSettingsHref,
  gradebookHref,
  gradingQueueHref,
  modulesHref,
  rosterHref,
  sameViewInCourse,
  triageHref,
} from "@/lib/links"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

/**
 * What the sidebar offers, which is not the same question as which page you are on.
 *
 * v0 derived this from the pathname — anything under /instructor was the instructor
 * view. That is a prototype convenience and would be wrong here twice over: a student
 * who typed an instructor URL would be shown instructor navigation, and an instructor
 * looking at their own course list would lose it. The role comes from the profile, and
 * the procedures enforce it independently.
 */
type Role = "student" | "instructor"

/**
 * Which cohort the reader is in, according to the address and nothing else.
 *
 * The URL is the only record of it. There is no remembered "current course", which is
 * deliberate: a remembered one disagrees with the page the moment you open a link, and a
 * sidebar that names a different cohort than the screen is worse than one that names none.
 *
 * So this returns null rather than a guess. It used to fall back to the first course in
 * the list, which is newest-first, and the result was a switcher confidently naming last
 * term's cohort while you graded this term's work.
 */
function useActiveCourseId(): string | null {
  const segments = usePathname().split("/").filter(Boolean)

  if (segments[0] === "instructor" && segments[1] === "courses" && segments[2]) {
    return segments[2]
  }
  // The student side has carried it all along: /courses/[courseId].
  if (segments[0] === "courses" && segments[1]) return segments[1]
  return null
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// Breadcrumbs derived from the pathname + mock data
// ---------------------------------------------------------------------------

interface Crumb {
  label: string
  href?: string
}

function useBreadcrumbs(courses: { id: string; name: string }[]): Crumb[] {
  const trpc = useTRPC()
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)

  // ["instructor", "courses", <courseId>, ...rest]
  const inCourse = segments[0] === "instructor" && segments[1] === "courses" && segments[2]
  const rest = inCourse ? segments.slice(3) : []

  // The assignment routes: .../assignments/<id> and .../assignments/<id>/edit. "new" is a
  // sibling of the ids rather than one of them, so it is excluded here and named below.
  const assignmentId = rest[0] === "assignments" && rest[1] !== "new" ? rest[1] : undefined

  // Only fetched where the path names an assignment, because the title is the one label on
  // these screens the course list in memory cannot supply.
  const assignment = useQuery({
    ...trpc.assignments.get.queryOptions({ assignmentId: assignmentId ?? "" }),
    enabled: Boolean(assignmentId),
  })

  const courseName = (id: string) => courses.find((c) => c.id === id)?.name ?? "Course"

  if (inCourse) {
    const courseId = segments[2]
    /*
      The cohort first on every instructor screen, because it is what every one of them is
      scoped to — and a trail that did not start there would leave the same question the
      sidebar used to answer wrongly: which course is this.

      Plain text rather than a link. There is no course home any more; the address it would
      point at redirects to Settings, and a breadcrumb whose first step lands somewhere the
      reader did not name is worse than one that only says where they are.
    */
    const crumbs: Crumb[] = [{ label: courseName(courseId) }]

    if (rest[0] === "triage") crumbs.push({ label: "Grading triage" })
    else if (rest[0] === "gradebook") crumbs.push({ label: "Gradebook" })
    else if (rest[0] === "roster") crumbs.push({ label: "Roster" })
    else if (rest[0] === "modules") crumbs.push({ label: "Modules" })
    else if (rest[0] === "settings") crumbs.push({ label: "Settings" })
    else if (rest[0] === "assignments") {
      // The list is a screen of its own now, so it is a step on the trail rather than a
      // heading the deeper screens skip past.
      const listCrumb: Crumb = {
        label: "Assignments",
        href: rest.length > 1 ? courseAssignmentsHref(courseId) : undefined,
      }
      crumbs.push(listCrumb)

      if (rest[1] === "new") crumbs.push({ label: "New assignment" })
      else if (rest[1]) {
        crumbs.push({
          label: assignment.data ? `Grading · ${assignment.data.title}` : "Grading queue",
          href: rest[2] === "edit" ? gradingQueueHref(courseId, rest[1]) : undefined,
        })
        if (rest[2] === "edit") crumbs.push({ label: "Edit" })
      }
    } else if (rest[0] === "students") crumbs.push({ label: "Student record" })

    return crumbs
  }

  // `/instructor` itself, which shows nothing and redirects into a cohort's triage.
  if (segments[0] === "instructor") return [{ label: "Grading triage" }]

  if (segments[0] === "courses" && segments[1]) {
    return [{ label: "Courses", href: "/courses" }, { label: courseName(segments[1]) }]
  }
  return [{ label: "Courses" }]
}

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

function CourseSelector({
  role,
  courses,
}: {
  role: Role
  courses: { id: string; name: string; cohortTerm: string; archivedAt: Date | null }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const activeCourseId = useActiveCourseId()

  // Nothing to select between, and nothing to say. A student enrolled in one course
  // does not need a switcher, and neither does anyone before their first enrollment.
  if (courses.length === 0) return null

  if (role === "student") {
    const active = courses.find((c) => c.id === activeCourseId)

    // On the course list itself there is no current course, and naming one would be a
    // claim about a screen the reader is not looking at.
    if (!active) return null

    return (
      <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-2.5 py-2">
        <BookOpen className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-sidebar-foreground">
            {active.cohortTerm}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{active.name}</p>
        </div>
      </div>
    )
  }

  /*
    Only a course this switcher can actually label. An id it has no row for would otherwise
    reach `Select.Value`, which falls back to printing the raw value, and the trigger would
    read as a bare uuid. That used to happen on every archived cohort, because `listMine` left
    them out and their screens stayed reachable.
  */
  const selected = courses.some((c) => c.id === activeCourseId) ? activeCourseId : null

  /*
    Archived cohorts last, and labelled, rather than mixed in by date.

    They belong in here — it is how somebody gets back into a finished term — but a switcher
    is a list of places to work, and the ones still running are what it should open on.
  */
  const ordered = [
    ...courses.filter((c) => c.archivedAt == null),
    ...courses.filter((c) => c.archivedAt != null),
  ]

  const label = (c: (typeof courses)[number]) =>
    c.archivedAt != null ? `${c.name} · ${c.cohortTerm} · Archived` : `${c.name} · ${c.cohortTerm}`

  return (
    <Select
      value={selected}
      /*
        The same view in the other cohort, not that cohort's front page. An instructor
        comparing two terms' triage asks for the other term's triage; being dropped back at
        the course overview means finding the way again on every switch.
      */
      onValueChange={(id) => {
        // Typed as nullable because `value` is: the trigger sits on a placeholder wherever
        // the address names no cohort, and clearing the selection is not a navigation.
        if (id) router.push(sameViewInCourse(pathname, id))
      }}
      /*
        Without this the trigger renders the *value* — a course id — rather than the name,
        because `Select.Value` has no other way to know what the selected item was labelled.
        Any select whose value is not also its label needs it.
      */
      items={Object.fromEntries(ordered.map((c) => [c.id, label(c)]))}
    >
      <SelectTrigger className="w-full" aria-label="Select course">
        <BookOpen className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Choose a cohort" />
        <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {/*
            The cohort as well as the name, because a program runs every term under the same
            name: two rows both reading "Software Engineering Fellowship" are a switcher that
            cannot be used. The term is what tells them apart, so it belongs on the row and on
            the trigger — which is why it is in `items` above too.
          */}
          {ordered.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{c.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {c.archivedAt != null ? `${c.cohortTerm} · Archived` : c.cohortTerm}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/**
 * The six views a cohort has, in the order they are offered.
 *
 * They were tabs on one course page until the page had a header, a triage button, a tab bar,
 * and a row of counts competing for the same band of screen. As sidebar items each one is an
 * address, which is what lets the switcher keep the view across a change of cohort and what
 * lets a link name a screen rather than a page-plus-a-tab nobody can bookmark.
 *
 * Triage leads, because "what is waiting on me" is the question an instructor opens this
 * application to ask.
 */
const COURSE_VIEWS = [
  { title: "Triage", href: triageHref, icon: ListChecks, segment: "triage" },
  { title: "Assignments", href: courseAssignmentsHref, icon: ClipboardList, segment: "assignments" },
  { title: "Gradebook", href: gradebookHref, icon: BarChart3, segment: "gradebook" },
  { title: "Roster", href: rosterHref, icon: Users, segment: "roster" },
  { title: "Modules", href: modulesHref, icon: Layers, segment: "modules" },
  { title: "Settings", href: courseSettingsHref, icon: Settings, segment: "settings" },
] as const

function MainNav({ role, isAdmin }: { role: Role; isAdmin: boolean }) {
  const pathname = usePathname()
  const activeCourseId = useActiveCourseId()

  if (role === "student") {
    return (
      <>
        <SidebarGroup>
          <SidebarGroupLabel>Student</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/courses" || pathname.startsWith("/courses/")}
                tooltip="My courses"
                render={<Link href="/courses" />}
              >
                <LayoutDashboard />
                <span>My courses</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <AdminGroup isAdmin={isAdmin} pathname={pathname} />
      </>
    )
  }

  /*
    Every course-scoped item points at the cohort in the address, so navigating never changes
    which course you are in. They used to be a fixed `/instructor` and the *first* course in the
    list, which meant grading one cohort's queue and then clicking "Course" took you into a
    different cohort entirely.

    Only from an instructor address, though. `/courses/[courseId]` names a course too, and an
    instructor is sometimes reading one they do not teach — a colleague's cohort they are
    enrolled in — where every one of these would lead somewhere that refuses them. The switcher
    above is unaffected: switching *out* of such a course is exactly what it is for.

    With no course to scope them to the whole group is dropped rather than pointed at a guess,
    which is how this went wrong in the first place. "All courses" is always there, and the bare
    `/instructor` still resolves to a real cohort's triage for anybody who types it.
  */
  const navCourseId = pathname.startsWith("/instructor/") ? activeCourseId : null

  return (
    <>
      {/*
        Its own group, above the cohort and separated from it. Everything below is scoped to one
        course; this is the way out of all of them, and grouping it among them made it read as a
        seventh view of the cohort you were already in.
      */}
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/courses"}
              tooltip="All courses"
              render={<Link href="/courses" />}
            >
              <GraduationCap />
              <span>All courses</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      {navCourseId && (
        <SidebarGroup>
          <SidebarSeparator className="mx-0 mb-2" />
          {/*
            No label. The switcher directly above names the cohort, and a heading reading
            "Course" over six items that are all this course would be a second, vaguer answer to
            a question already answered.
          */}
          <SidebarMenu>
            {COURSE_VIEWS.map((view) => (
              <SidebarMenuItem key={view.segment}>
                <SidebarMenuButton
                  isActive={isActiveView(pathname, navCourseId, view.segment)}
                  tooltip={view.title}
                  render={<Link href={view.href(navCourseId)} />}
                >
                  <view.icon />
                  <span>{view.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}

      <AdminGroup isAdmin={isAdmin} pathname={pathname} />
    </>
  )
}

/**
 * Which sidebar item the current address belongs to.
 *
 * Two segments need more than a prefix test. **Assignments** covers its own list *and* every
 * screen filed under it — one assignment's grading queue, its edit form, the new-assignment
 * form — because those are reached from it and highlighting nothing while you grade would make
 * the sidebar go blank exactly where an instructor spends the most time. **Settings** owns the
 * bare course address, which redirects to it, so the item is lit before the redirect resolves
 * rather than flickering off and on.
 *
 * A student's record under `/students/[studentId]` deliberately matches nothing. It is reached
 * from three different places and belongs to none of them.
 */
function isActiveView(pathname: string, courseId: string, segment: string): boolean {
  const base = `/instructor/courses/${courseId}`

  if (segment === "settings" && pathname === base) return true

  return pathname === `${base}/${segment}` || pathname.startsWith(`${base}/${segment}/`)
}

/**
 * Who may teach at all, which is a different kind of capability from everything above it:
 * those are scoped to a cohort, and this decides who gets one.
 *
 * Hidden from an instructor, and that is presentation only — `/admin` reads through
 * `adminProcedure`, so an instructor who types the URL is refused by the procedures rather than
 * by this component having declined to draw a link. Offering a link that leads to a refusal is
 * the thing worth avoiding here; the refusal itself is not this file's job.
 */
function AdminGroup({ isAdmin, pathname }: { isAdmin: boolean; pathname: string }) {
  if (!isAdmin) return null

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
  )
}

function UserMenu({
  person,
}: {
  person: { displayName: string | null; email: string | null; githubUsername: string | null }
}) {
  const router = useRouter()

  // Signing out clears the Supabase session cookie; the redirect is a fallback for the
  // rare case the proxy has already served this page from cache.
  const signOut = async () => {
    await createClient().auth.signOut()
    router.push("/auth/login")
    router.refresh()
  }

  const name = person.displayName ?? person.email ?? "Your account"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md p-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <Avatar className="size-8 rounded-md">
          <AvatarFallback className="rounded-md bg-primary/10 text-xs font-medium text-primary">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-sidebar-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{person.email}</p>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-(--anchor-width) min-w-56"
        side="top"
        align="start"
      >
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
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={signOut} variant="destructive">
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
        <main className="flex-1 overflow-x-hidden">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** The sidebar's shape while the profile and course list are in flight. */
function ShellSidebarFallback() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ShellBrand />
      </SidebarHeader>
      <SidebarContent />
    </Sidebar>
  )
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
        <p className="truncate text-[11px] leading-tight text-muted-foreground">
          Internal grading
        </p>
      </div>
    </div>
  )
}

function ShellSidebar() {
  const trpc = useTRPC()
  const { data: profile } = useSuspenseQuery(trpc.me.queryOptions())
  const { data: courses } = useSuspenseQuery(trpc.courses.listMine.queryOptions())

  // Read from the profile rather than the URL. A student who typed an instructor
  // address would otherwise be shown instructor navigation, and every page behind it
  // would refuse them — which is a worse answer than not offering the link.
  const role: Role =
    profile?.role === "INSTRUCTOR" || profile?.role === "ADMIN" ? "instructor" : "student"

  // Separate from `role` rather than a third value in it, because an admin is an instructor who
  // can also do one more thing. Folding it into `role` would make every `role === "instructor"`
  // check in here silently exclude admins.
  const isAdmin = profile?.role === "ADMIN"

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ShellBrand />
        <div className="group-data-[collapsible=icon]:hidden">
          <CourseSelector role={role} courses={courses} />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <MainNav role={role} isAdmin={isAdmin} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator className="mx-0" />
        {profile && <UserMenu person={profile} />}
      </SidebarFooter>
    </Sidebar>
  )
}

function ShellBreadcrumb() {
  const trpc = useTRPC()
  const { data: courses } = useSuspenseQuery(trpc.courses.listMine.queryOptions())
  const crumbs = useBreadcrumbs(courses)

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
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
              {!isLast && (
                <BreadcrumbSeparator className={cn(i > 0 && "hidden md:block")} />
              )}
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
