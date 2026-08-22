/**
 * Points the database at a GitHub organization's new name, after it has been renamed on GitHub.
 *
 *   npm run rename:org -- old-org-name new-org-name           # reports what it would change
 *   npm run rename:org -- old-org-name new-org-name --write   # changes it
 *
 * **Reports by default and writes only when told to.** One Supabase project serves both local
 * development and the deployment, so there is no such thing as a rehearsal against a copy — the
 * report is the rehearsal. Printing the counts and then immediately writing would make them a
 * receipt rather than a check, and the number worth seeing before a write is whether this
 * database holds the rows you expect at all.
 *
 * **A GitHub rename leaves the database naming an organization that no longer answers to that
 * name, and the failure is silent.** The webhook finds a submission by an exact `repo_full_name`
 * match, so every payload arriving under the new name matches nothing: a student's pull request
 * is logged as an unknown repository and the submission never becomes `SUBMITTED`. Grading, test
 * runs, the pull request diff, and posting a grade all split the same column for its owner, so
 * they fail the same way. GitHub redirects requests for a renamed organization, which makes the
 * gap survivable but is not something to depend on — the old name becomes claimable by anyone the
 * moment the rename completes, and the redirect stops the moment somebody takes it.
 *
 * A script rather than a migration, because the change is to data in one deployment rather than
 * to the schema. A migration rewriting rows would run again against a database that never held
 * the old name.
 *
 * Both names are arguments, so this is an operation that can be run for any rename rather than a
 * record of one particular one.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/**
 * GitHub's own rule for an organization or repository name: letters, digits, hyphens,
 * underscores, and periods. Checked because a name with a slash or a space in it would make the
 * prefix matching below mean something other than what it reads as.
 */
const NAME = /^[A-Za-z0-9._-]+$/;

async function main() {
  const write = process.argv.includes("--write");
  const [oldOrg, newOrg] = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"))
    .map((arg) => arg?.trim());

  if (!oldOrg || !newOrg) {
    console.error("Usage: npm run rename:org -- old-org-name new-org-name [--write]");
    process.exit(1);
  }

  if (!NAME.test(oldOrg) || !NAME.test(newOrg)) {
    console.error(
      `Organization names may hold only letters, digits, hyphens, underscores, and periods.\n` +
        `Received "${oldOrg}" and "${newOrg}".`,
    );
    process.exit(1);
  }

  if (oldOrg === newOrg) {
    console.error(`"${oldOrg}" and "${newOrg}" are the same name. There is nothing to rename.`);
    process.exit(1);
  }

  const { db } = await import("../lib/prisma");

  /*
    Every match is anchored to the organization's position in the value rather than being a
    substring of it. A bare replace would corrupt a repository whose own *name* contained the
    organization name — `example-org/example-org-fixtures` is a legal repository, and a
    substring replace would rename both halves.
  */
  const oldPrefix = `${oldOrg}/`;
  const newPrefix = `${newOrg}/`;
  const oldUrl = `https://github.com/${oldOrg}/`;
  const newUrl = `https://github.com/${newOrg}/`;

  const [assignmentsByOrg, assignmentsByTemplate, submissionsByRepo, submissionsByUrl] =
    await Promise.all([
      db.assignment.count({ where: { githubOrg: oldOrg } }),
      db.assignment.count({ where: { templateRepo: { startsWith: oldPrefix } } }),
      db.submission.count({ where: { repoFullName: { startsWith: oldPrefix } } }),
      db.submission.count({ where: { repoUrl: { startsWith: oldUrl } } }),
    ]);

  console.log(`Renaming ${oldOrg} to ${newOrg}\n`);
  console.log(`  assignments.github_org        ${assignmentsByOrg}`);
  console.log(`  assignments.template_repo     ${assignmentsByTemplate}`);
  console.log(`  submissions.repo_full_name    ${submissionsByRepo}`);
  console.log(`  submissions.repo_url          ${submissionsByUrl}`);

  const total = assignmentsByOrg + assignmentsByTemplate + submissionsByRepo + submissionsByUrl;

  if (total === 0) {
    console.log(
      `\nNo row names ${oldOrg}. Either the rename has already been run against this ` +
        `database, or this is not the database that holds it.`,
    );
    await db.$disconnect();
    return;
  }

  /*
    `repo_full_name` is unique, so a row already naming the new organization is the one way this
    can fail partway through. Found first rather than discovered as a Prisma constraint error
    mid-transaction, because the error names a constraint and this names the repository.
  */
  const collisions = await db.submission.findMany({
    where: { repoFullName: { startsWith: newPrefix } },
    select: { repoFullName: true },
    orderBy: { repoFullName: "asc" },
  });

  if (collisions.length > 0) {
    console.error(
      `\n${collisions.length} submission${collisions.length === 1 ? "" : "s"} already name ` +
        `${newOrg}, and repo_full_name is unique — the rename would collide:\n` +
        collisions.map((row) => `  ${row.repoFullName}`).join("\n") +
        `\n\nResolve these before renaming.`,
    );
    await db.$disconnect();
    process.exit(1);
  }

  // Reported after the collision check rather than before it, so a report says whether the write
  // would succeed and not merely how much of it there is.
  if (!write) {
    console.log(`\nNothing written. Add --write to make these changes.`);
    await db.$disconnect();
    return;
  }

  /**
   * The same value with its leading organization replaced, or null when it does not start with
   * the old one. Prisma's `updateMany` can only set a literal — it has no way to say "this
   * column, with its first n characters replaced" — so the new value is computed here and
   * written per row. That is one statement per row rather than one per column, which is nothing
   * at the size a rename ever has and keeps the column names out of hand-written SQL.
   */
  const swap = (value: string, from: string, to: string) =>
    value.startsWith(from) ? to + value.slice(from.length) : null;

  // One transaction, so a rename cannot survive halfway: an assignment pointing at the new
  // organization while its submissions point at the old one is worse than either name alone.
  const written = await db.$transaction(async (tx) => {
    const org = await tx.assignment.updateMany({
      where: { githubOrg: oldOrg },
      data: { githubOrg: newOrg },
    });

    const assignments = await tx.assignment.findMany({
      where: { templateRepo: { startsWith: oldPrefix } },
      select: { id: true, templateRepo: true },
    });

    for (const row of assignments) {
      const templateRepo = swap(row.templateRepo!, oldPrefix, newPrefix);
      if (templateRepo)
        await tx.assignment.update({ where: { id: row.id }, data: { templateRepo } });
    }

    const submissions = await tx.submission.findMany({
      where: {
        OR: [{ repoFullName: { startsWith: oldPrefix } }, { repoUrl: { startsWith: oldUrl } }],
      },
      select: { id: true, repoFullName: true, repoUrl: true },
    });

    let repo = 0;
    let url = 0;

    for (const row of submissions) {
      /*
        Both columns on one update, because they describe the same repository and a row carrying
        the new name in one and the old name in the other is a state nothing reads correctly.
        Either may be null on its own, so each is swapped independently and only what changed is
        written.
      */
      const repoFullName = row.repoFullName && swap(row.repoFullName, oldPrefix, newPrefix);
      const repoUrl = row.repoUrl && swap(row.repoUrl, oldUrl, newUrl);

      await tx.submission.update({
        where: { id: row.id },
        data: { ...(repoFullName ? { repoFullName } : {}), ...(repoUrl ? { repoUrl } : {}) },
      });

      if (repoFullName) repo += 1;
      if (repoUrl) url += 1;
    }

    return { org: org.count, template: assignments.length, repo, url };
  });

  console.log(
    `\nWritten:\n` +
      `  assignments.github_org        ${written.org}\n` +
      `  assignments.template_repo     ${written.template}\n` +
      `  submissions.repo_full_name    ${written.repo}\n` +
      `  submissions.repo_url          ${written.url}`,
  );

  const remaining = await db.assignment.count({ where: { githubOrg: oldOrg } });
  console.log(
    remaining === 0
      ? `\nNo assignment names ${oldOrg} any more.`
      : `\n${remaining} assignments still name ${oldOrg}. Something is wrong — investigate before running again.`,
  );

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
