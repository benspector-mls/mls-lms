"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import {
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LogOut,
  BookOpen,
  ChevronsUpDown,
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

  const assignmentId =
    segments[0] === "instructor" && segments[1] === "assignments" ? segments[2] : undefined

  // Only fetched on the grading queue, where the path carries an assignment id and
  // nothing else. Everywhere else the course list already in memory has the name.
  const assignment = useQuery({
    ...trpc.assignments.get.queryOptions({ assignmentId: assignmentId ?? "" }),
    enabled: Boolean(assignmentId),
  })

  const courseName = (id: string) => courses.find((c) => c.id === id)?.name ?? "Course"

  if (segments[0] === "instructor") {
    const crumbs: Crumb[] = [{ label: "Triage", href: "/instructor" }]

    if (assignmentId) {
      crumbs.push({
        label: assignment.data ? `Grading · ${assignment.data.title}` : "Grading queue",
      })
      return crumbs
    }

    if (segments[1] === "courses" && segments[2]) {
      const courseId = segments[2]
      crumbs.push({ label: courseName(courseId), href: `/instructor/courses/${courseId}` })
      if (segments[3] === "gradebook") crumbs.push({ label: "Gradebook" })
    }
    return crumbs
  }

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
  courses: { id: string; name: string; cohortTerm: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  // Nothing to select between, and nothing to say. A student enrolled in one course
  // does not need a switcher, and neither does anyone before their first enrollment.
  if (courses.length === 0) return null

  const segments = pathname.split("/").filter(Boolean)
  const activeCourseId =
    segments[0] === "instructor" && segments[1] === "courses" && segments[2]
      ? segments[2]
      : courses[0].id

  if (role === "student") {
    const active = courses.find((c) => c.id === activeCourseId) ?? courses[0]
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

  return (
    <Select
      value={activeCourseId}
      onValueChange={(id) => router.push(`/instructor/courses/${id}`)}
      /*
        Without this the trigger renders the *value* — a course id — rather than the name,
        because `Select.Value` has no other way to know what the selected item was labelled.
        Any select whose value is not also its label needs it.
      */
      items={Object.fromEntries(courses.map((c) => [c.id, `${c.name} · ${c.cohortTerm}`]))}
    >
      <SelectTrigger className="w-full" aria-label="Select course">
        <BookOpen className="size-4 text-muted-foreground" />
        <SelectValue />
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
          {courses.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{c.name}</span>
                <span className="truncate text-xs text-muted-foreground">{c.cohortTerm}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function MainNav({
  role,
  courses,
}: {
  role: Role
  courses: { id: string }[]
}) {
  const pathname = usePathname()

  const studentItems = [
    {
      title: "My courses",
      href: "/courses",
      icon: LayoutDashboard,
      active: pathname === "/courses" || pathname.startsWith("/courses/"),
    },
  ]

  const instructorItems = [
    {
      title: "Triage",
      href: "/instructor",
      icon: ListChecks,
      active: pathname === "/instructor" || pathname.startsWith("/instructor/assignments"),
    },
    // Points at whichever course the instructor is looking at, falling back to their
    // first. Omitted entirely when they teach none, rather than linking nowhere.
    ...(courses.length > 0
      ? [
          {
            title: "Course",
            href: `/instructor/courses/${courses[0].id}`,
            icon: BookOpen,
            active: pathname.startsWith("/instructor/courses"),
          },
        ]
      : []),
    {
      title: "All courses",
      href: "/courses",
      icon: GraduationCap,
      active: pathname === "/courses",
    },
  ]

  const items = role === "student" ? studentItems : instructorItems

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        {role === "student" ? "Student" : "Instructor"}
      </SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={item.active}
              tooltip={item.title}
              render={<Link href={item.href} />}
            >
              <item.icon />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
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

      <SidebarInset>
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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ShellBrand />
        <div className="group-data-[collapsible=icon]:hidden">
          <CourseSelector role={role} courses={courses} />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <MainNav role={role} courses={courses} />
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
