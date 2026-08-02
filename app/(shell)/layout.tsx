import type { ReactNode } from "react"
import { AppShell } from "@/components/app-shell"

export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
