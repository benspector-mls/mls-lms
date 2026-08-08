/**
 * Accepts an assignment as a student, from the terminal.
 *
 *   npm run accept -- <assignment-repo-name> [student-email]
 *
 * Calls the real `assignments.accept` tRPC mutation through a caller, so the
 * repository generation, collaborator invitations, classroom.yml removal and
 * database bookkeeping are all the same code the browser triggers. The only thing
 * bypassed is the cookie-to-Supabase-session exchange: the context is built with
 * the student's profile id directly rather than from a verified JWT.
 *
 * Needs --conditions=react-server, as the modules it reaches import "server-only".
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function main() {
  const repoName = process.argv[2];
  if (!repoName) {
    console.error("Usage: npm run accept -- <assignment-repo-name> [student-email]");
    process.exit(1);
  }

  const { db } = await import("../lib/prisma");
  const { appRouter } = await import("../trpc/routers/_app");
  const { createCallerFactory } = await import("../trpc/init");

  const assignment = await db.assignment.findFirst({
    where: { assignmentRepoName: repoName },
    select: { id: true, title: true, templateRepo: true, courseId: true },
  });
  if (!assignment) {
    console.error(
      `No assignment named "${repoName}". Seed it first with SEED_TEMPLATE_REPO=${repoName} npm run db:seed`,
    );
    process.exit(1);
  }

  const email = process.argv[3];
  const student = await db.profile.findFirst({
    where: email ? { email } : { role: "STUDENT" },
    select: { id: true, email: true, githubUsername: true, role: true },
  });
  if (!student) {
    console.error(email ? `No profile for ${email}.` : "No STUDENT profile found.");
    process.exit(1);
  }

  console.log(`Assignment  ${assignment.title} (template ${assignment.templateRepo})`);
  console.log(`Student     ${student.email} / @${student.githubUsername}\n`);

  // The context a request would have built, minus the JWT verification.
  const caller = createCallerFactory(appRouter)({
    db,
    user: { id: student.id } as Parameters<typeof createCallerFactory>[0] extends never
      ? never
      : never,
  } as never);

  const result = await caller.assignments.accept({ assignmentId: assignment.id });
  console.log("Accepted:", JSON.stringify(result, null, 2));

  await db.$disconnect();
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
