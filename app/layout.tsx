import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TRPCReactProvider } from "@/trpc/client";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Marcy LMS",
  description:
    "Assignments and instructor-approved grading for The Marcy Lab School.",
};

/**
 * Both families are exposed as CSS variables rather than applied as a class, because
 * `globals.css` maps `--font-sans` and `--font-mono` onto them through Tailwind's
 * `@theme`. Setting `geistSans.className` instead would leave those variables undefined
 * and every `font-mono` utility — the raw report view, commit SHAs, test names — would
 * silently fall back to the browser default.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/*
            TRPCReactProvider is a client component, but it is mounted here in a
            server component. That is intentional and supported: only the
            provider itself ships to the browser, not this layout. Without it,
            any client component calling useTRPC() throws.
          */}
          <TRPCReactProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </TRPCReactProvider>
        </ThemeProvider>
        {/*
          Actions in the grading screens report their outcome through toasts —
          approving, reposting a comment, saving an edit. Mounted once here so any
          screen can call `toast()` without providing its own host.
        */}
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
