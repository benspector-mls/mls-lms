import "server-only";

import { TRPCError } from "@trpc/server";

import { studentRepoName, teamRepoName } from "../courses/cohort-slug";
import type { Prisma } from "../generated/prisma/client";
import type { SubmissionModel } from "../generated/prisma/models";
import { getConfiguredInstallationId, isGithubAppConfigured } from "../github/app-client";
import {
  addCollaborator,
  generateRepoFromTemplate,
  getRepo,
  removeClassroomWorkflow,
  waitForRepoContent,
} from "../github/repos";
import type { Tx } from "../prisma";
import { claimTeamWork, ensureTeamRows, type ResolvedTeam } from "../submissions/team";
import {
  copyUrlFromTemplate,
  NotRepositoryBackedError,
  repositorySource,
  UnsupportedAssignmentKindError,
} from "./spec";

/**
 * What accepting an assignment does, once it is known who is allowed to.
 *
 * **Two functions, because there are two acts.** Accepting a Drive assignment is being sent to
 * Google's own copy prompt — no repository, no collaborators, no credentials, and nothing
 * created on this side beyond the row recording that the student started. Accepting a
 * repository assignment generates one from a template, invites the student and every
 * instructor, waits for the copy to land, strips a workflow, and only then writes the row.
 * Those had been one procedure body, branching on kind at the top, and the second act is
 * around fifteen times the size of the first.
 *
 * They are here rather than in the router for the reason `runTestsForSubmission` and
 * `approveDraft` are: **taking a client rather than reaching for one** is what lets a check
 * script drive the whole act inside a transaction it then rolls back. A procedure body cannot
 * be called that way, so the parts of the application that talk to GitHub were the parts with
 * no way to be exercised against real rows.
 *
 * Authorization is deliberately *not* here. Who may accept is `assertActiveStudent`, which the
 * procedure asks before calling either of these, and it is a different question — a removed
 * student can still read the assignment and must not be able to accept it. Nothing below
 * re-asks it, so nothing below may be called by anything that has not.
 *
 * They throw `TRPCError`, as `lib/uploads/submit.ts` does and for the same reason: the caller
 * propagates it unchanged, and one error vocabulary beats one per layer.
 */

/**
 * The columns accepting reads, named here because this module is what needs them.
 *
 * The procedure selects this rather than a list of its own, so adding a column to the act does
 * not mean remembering to widen a select in another file.
 */
export const acceptableAssignmentSelect = {
  id: true,
  courseId: true,
  kind: true,
  templateRepo: true,
  assignmentRepoName: true,
  githubOrg: true,
  templateDriveUrl: true,
  /// The set of teams this is handed in by, or null for work each student does alone. Read here
  /// because it is what decides whether accepting claims a team's row or creates one of its own.
  teamSetId: true,
  // The cohort's short name, which prefixes the repository this creates.
  course: { select: { cohortSlug: true } },
} satisfies Prisma.AssignmentSelect;

/** An assignment loaded for accepting. */
export type AcceptableAssignment = Prisma.AssignmentGetPayload<{
  select: typeof acceptableAssignmentSelect;
}>;

/**
 * The same shape every kind returns, so the button has one result to handle rather than a union
 * it has to narrow.
 *
 * `copyUrl` is where the student is sent *on acceptance*, which is only ever Google's copy
 * prompt. A repository is opened from the row's own link afterwards, so it is null there.
 */
export type Accepted = {
  /** The whole row, unselected, because the button re-renders the card from it. */
  submission: SubmissionModel;
  copyUrl: string | null;
};

/**
 * The caller's own row, which is what the button re-renders their card from.
 *
 * Their own and not the team's, deliberately. On a team assignment the work lives on one row and
 * every member has a mirror of it, and what a member's own screen is about is their own record —
 * the grade they were given and whether they have read the feedback. Where the work is is read
 * through the mirror by the screens that need it.
 */
async function ownRow(db: Tx, assignmentId: string, studentId: string): Promise<SubmissionModel> {
  return db.submission.findUniqueOrThrow({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
}

/**
 * Accepting a Google Drive assignment: record that the student started, and hand back the copy
 * prompt.
 *
 * **A team makes one copy between them and it is nobody's to create here.** Google's prompt makes
 * a copy owned by whoever presses it, so a team pressing Accept twice has two documents — which is
 * the team's business and not a state this owns. What this records is that they started, and which
 * of their rows the link they eventually paste will live on.
 */
export async function acceptDriveAssignment(
  db: Tx,
  params: { assignment: AcceptableAssignment; studentId: string; team?: ResolvedTeam | null },
): Promise<Accepted> {
  const { assignment, studentId } = params;
  const team = params.team ?? null;

  if (!assignment.templateDriveUrl) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This assignment has no template document, so there is nothing to copy. " +
        "Contact your instructor.",
    });
  }

  if (team) {
    /*
      Claim the row that holds the team's work, then give every member of the team one. Both are
      idempotent, so a second member pressing Accept joins what the first made rather than
      making anything.
    */
    const { submissionId } = await claimTeamWork(db, {
      assignmentId: assignment.id,
      studentId,
      team,
      statusIfNew: "ACCEPTED",
    });
    await ensureTeamRows(db, {
      assignmentId: assignment.id,
      teamId: team.id,
      teamSetId: team.teamSetId,
      teamSubmissionId: submissionId,
    });

    return {
      submission: await ownRow(db, assignment.id, studentId),
      copyUrl: copyUrlFromTemplate(assignment.templateDriveUrl),
    };
  }

  // Upserted rather than created, so pressing Accept twice is the same as pressing it once: the
  // copy prompt is idempotent on Google's side too — a second press makes a second copy, which
  // is the student's business and not a state this owns.
  const submission = await db.submission.upsert({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
    create: {
      assignmentId: assignment.id,
      studentId,
      status: "ACCEPTED",
      lastActivityAt: new Date(),
    },
    update: {},
  });

  return { submission, copyUrl: copyUrlFromTemplate(assignment.templateDriveUrl) };
}

/**
 * Accepting a repository assignment: generate the student's repository from the template, grant
 * access, remove the legacy Classroom workflow, and record the submission.
 *
 * Ordering note: the repository is created before the submission row is written, because the row
 * stores the repository's URL. That means a failure partway through can leave a repository on
 * GitHub with no matching row. The recovery for that is below — an existing repository is reused
 * rather than treated as an error.
 *
 * **A team gets one repository, named after the team.** Every active member is a collaborator
 * with push access, one pull request against it is the team's submission, and one row holds it
 * while the rest of the team mirrors that row. The row is claimed before anything touches GitHub,
 * so two members accepting in the same moment cannot produce two repositories for one team — the
 * loser of that race joins the winner's row instead. Whether the repository itself then exists is
 * read from the row rather than assumed from having won, which is what stops a failure at GitHub
 * leaving a team with a claimed row and no repository nobody will ever create.
 *
 * **A test student differs in exactly one respect: who is invited.** The repository is generated
 * from the same template, is private like every other, is named the same way, and produces the same
 * row — which is what makes previewing an assignment worth anything. What changes is that
 * `test-student-3` names no GitHub account, so the invitation goes to the admin looking through it
 * instead. Everything downstream — the pull request, the test run, the report, the comment — is
 * unaware, because there is nothing there for it to be aware of.
 */
export async function acceptRepoAssignment(
  db: Tx,
  params: {
    assignment: AcceptableAssignment;
    /** The accepting student. `githubUsername` is what the repository is named after. */
    student: { id: string; githubUsername: string | null; testStudentNumber: number | null };
    /**
     * The admin looking through a test student, and null for every real accept.
     *
     * Present because a test student's handle names no GitHub account, so somebody else has to be
     * the account with push access — and the person who should have it is whoever is previewing.
     */
    actingAdmin?: { githubUsername: string | null; email: string | null } | null;
    /** The team this student is on for this assignment, or null for work they do alone. */
    team?: ResolvedTeam | null;
  },
): Promise<Accepted> {
  const { assignment, student } = params;
  const isTestStudent = student.testStudentNumber !== null;
  const actingAdmin = params.actingAdmin ?? null;
  const team = params.team ?? null;

  if (!student.githubUsername) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Link your GitHub account before accepting an assignment. Your repository is named after your GitHub username.",
    });
  }

  /*
    A test student with nobody behind it is refused, before anything is created.

    Reached two ways. An admin who has not linked GitHub cannot be given push access, and a
    repository nobody can push to is not a preview of anything — it wastes a repository name and
    reads as a working accept. And `npm run accept` pointed at a test student has no acting admin at
    all, which is the same dead end arrived at from the terminal.

    Note this is *stricter* than the real-student path below, which only warns when an instructor has
    no linked account. There, the student must not be blocked by somebody else's incomplete setup and
    can work in their own repository regardless. Here the acting admin is the only account that will
    ever push, so a missing handle is the whole failure rather than a degraded case.
  */
  let pushesOnItsBehalf: string | null = null;

  if (isTestStudent) {
    if (!actingAdmin) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "A test student can only accept an assignment while an admin is looking through it, " +
          "because the admin is who gets access to push to the repository.",
      });
    }
    if (!actingAdmin.githubUsername) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Link your own GitHub account before accepting as a test student. You are the only " +
          "account that can push to the repository this creates, since a test student has no " +
          "GitHub account of its own.",
      });
    }
    pushesOnItsBehalf = actingAdmin.githubUsername;
  }

  if (!isGithubAppConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The GitHub App is not configured on this deployment. See the GitHub App setup section of the README.",
    });
  }

  let source;
  try {
    source = repositorySource(assignment);
  } catch (err) {
    // Worded for the person who hits it rather than for a stack trace. Reaching this with a kind
    // that has no repository means the caller's branch missed one, which is a defect rather than
    // something a student can act on; a misconfigured REPO row is the ordinary case, where an
    // instructor set up the assignment without a template, org, or repository name.
    if (err instanceof NotRepositoryBackedError || err instanceof UnsupportedAssignmentKindError) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This assignment is not accepted this way. Contact your instructor.",
        cause: err,
      });
    }
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Source repository not found for this assignment. Contact your instructor.",
      cause: err,
    });
  }

  /*
    Already accepted, which for a team is a question about the team rather than about the caller.

    Claimed before the check and before anything touches GitHub, so the row that will hold the
    work exists whichever member got here first. `claimedNow` is deliberately not read: a member
    who lost the race still needs the repository to exist, and a member who won still needs to
    cope with it existing already. What decides is whether the row has a repository.
  */
  let teamSubmissionId: string | null = null;

  if (team) {
    const claim = await claimTeamWork(db, {
      assignmentId: assignment.id,
      studentId: student.id,
      team,
      statusIfNew: "ACCEPTED",
    });
    teamSubmissionId = claim.submissionId;

    const held = await db.submission.findUniqueOrThrow({
      where: { id: claim.submissionId },
      select: { repoFullName: true },
    });

    if (held.repoFullName) {
      /*
        The team has its repository. This member may be new to the team, so they are invited and
        given a row — both idempotent — and then read their own row back.
      */
      const [owner, repo] = held.repoFullName.split("/");
      if (owner && repo && student.githubUsername && !isTestStudent) {
        await addCollaborator(getConfiguredInstallationId(), {
          owner,
          repo,
          username: student.githubUsername,
          permission: "push",
        });
      }
      await ensureTeamRows(db, {
        assignmentId: assignment.id,
        teamId: team.id,
        teamSetId: team.teamSetId,
        teamSubmissionId: claim.submissionId,
      });
      return { submission: await ownRow(db, assignment.id, student.id), copyUrl: null };
    }
  } else {
    // Already accepted. Return the existing submission rather than creating a second repository.
    const existing = await db.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
    });
    if (existing?.repoFullName) {
      return { submission: existing, copyUrl: null };
    }
  }

  const installationId = getConfiguredInstallationId();
  /*
    `{cohortSlug}-{assignmentRepoName}-{github login}`, built in one place.

    The cohort in the name is what keeps two courses running the same program apart on GitHub, so
    a student repeating a module gets a fresh repository rather than wanting the one their
    previous cohort holds.
  */
  const repoName = team
    ? teamRepoName({
        cohortSlug: assignment.course.cohortSlug,
        assignmentRepoName: source.assignmentRepoName,
        teamName: team.name,
      })
    : studentRepoName({
        cohortSlug: assignment.course.cohortSlug,
        assignmentRepoName: source.assignmentRepoName,
        githubLogin: student.githubUsername,
      });
  const [templateOwner, templateRepoName] = source.templateRepo.split("/");

  if (!templateOwner || !templateRepoName) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Assignment templateRepo must be in "owner/repo" form, got "${source.templateRepo}".`,
    });
  }

  /*
    The same repository name in two cohorts, for the same student.

    A generated repository is `{assignmentRepoName}-{github login}` with no course in it, so two
    courses holding an assignment of the same name in the same organization would want one
    repository for two submissions. `@@unique([courseId, assignmentRepoName])` does not catch
    this — it is per course, and the collision domain is the organization.

    **Different students never collide**, which is why reusing `swe-1-4-loops` for a new cohort
    every term is fine and normal. This only fires when one person is in both, which happens when
    a cohort is copied and tested, and when a student repeats a module.

    Checked here, before anything touches GitHub, because the failure without it is ugly:
    `generate` fails on the taken name, the catch reuses the existing repository — correct for
    retrying a half-finished accept — collaborators are added, and only then does
    `repo_full_name @unique` refuse the write, with a Prisma constraint error reaching a student.
    The database is what makes that safe rather than silently wrong; this is what makes it
    legible.
  */
  const repoFullName = `${source.githubOrg}/${repoName}`;
  const claimed = await db.submission.findUnique({
    where: { repoFullName },
    select: {
      assignment: { select: { title: true, course: { select: { name: true } } } },
    },
  });

  if (claimed) {
    throw new TRPCError({
      code: "CONFLICT",
      message: team
        ? `The repository ${repoFullName} is already taken by ` +
          `"${claimed.assignment.title}" in ${claimed.assignment.course.name}. Team names are ` +
          `unique within a set but not across a course, so two sets can each hold a ` +
          `"${team.name}" — ask your instructor to rename this team or the assignment's ` +
          `repository.`
        : `You already have the repository ${repoFullName}, for ` +
          `"${claimed.assignment.title}" in ${claimed.assignment.course.name}. One ` +
          `repository cannot serve two courses, so this assignment needs a different ` +
          `repository name — ask your instructor to change it.`,
    });
  }

  // A repository with this name can already exist on GitHub without a matching submission row: a
  // previous attempt may have created the repository and then failed before the database write,
  // or a local reseed may have cleared submissions without touching GitHub. Reuse it instead of
  // failing on the name collision.
  let repo;
  try {
    repo = await generateRepoFromTemplate(installationId, {
      templateOwner,
      templateRepo: templateRepoName,
      owner: source.githubOrg,
      name: repoName,
    });
  } catch (err) {
    const existingRepo = await getRepo(installationId, {
      owner: source.githubOrg,
      repo: repoName,
    });
    if (!existingRepo) throw err;
    repo = existingRepo;
  }

  /*
    Who is invited to push.

    For work a student does alone that is the student — unless there is no such person. A test
    student's handle is `test-student-3`, which names no GitHub account, so the invitation would
    answer 404 and fail an accept that had already created the repository. The admin looking
    through it is invited in its place, and is the account that pushes on its behalf —
    `pushesOnItsBehalf`, resolved and checked at the top of this function.

    For a team it is **every active member**, because the repository is the team's and a member
    who cannot push to it cannot do the work. A member with no linked GitHub account is warned
    over rather than refused, exactly as an instructor without one is: they must not block their
    teammates, and their next Accept invites them once they have linked it.
  */
  const invitees = new Set<string>([pushesOnItsBehalf ?? student.githubUsername]);

  if (team) {
    const members = await db.teamMembership.findMany({
      where: { teamId: team.id, enrollment: { status: "ACTIVE" } },
      select: {
        enrollment: {
          select: { student: { select: { githubUsername: true, email: true, id: true } } },
        },
      },
    });

    for (const { enrollment } of members) {
      if (!enrollment.student.githubUsername) {
        console.warn(
          `accept: ${enrollment.student.email ?? "a team member"} has no GitHub account linked, ` +
            `so they were not added to ${source.githubOrg}/${repoName}`,
        );
        continue;
      }
      // A test student's handle names no account, so inviting it would 404. The admin looking
      // through one is already in this set as `pushesOnItsBehalf`.
      if (enrollment.student.id === student.id && isTestStudent) continue;
      invitees.add(enrollment.student.githubUsername);
    }
  }

  for (const username of invitees) {
    await addCollaborator(installationId, {
      owner: source.githubOrg,
      repo: repoName,
      username,
      permission: "push",
    });
  }

  // Every instructor on the course is added, so no repository ever needs manual permission
  // changes.
  const instructors = await db.courseInstructor.findMany({
    where: { courseId: assignment.courseId },
    select: { user: { select: { githubUsername: true, email: true } } },
  });

  for (const { user } of instructors) {
    if (!user.githubUsername) {
      // An instructor who has not linked GitHub cannot be added. This must not fail the
      // student's accept — they would be blocked by someone else's incomplete setup.
      console.warn(
        `accept: skipping collaborator invite for ${user.email ?? "an instructor"} — no GitHub account linked`,
      );
      continue;
    }
    await addCollaborator(installationId, {
      owner: source.githubOrg,
      repo: repoName,
      username: user.githubUsername,
      permission: "push",
    });
  }

  /*
    The copy is asynchronous, so the tree is not readable the moment `generate` returns.

    Waiting here rather than inside `removeClassroomWorkflow` because this is the only caller
    that has just created the repository — everything else reads one that has existed for days.
    A repository still empty after the wait is reported and not treated as a failure: it exists,
    the student can work in it, and refusing their accept over a workflow file whose results
    nothing trusts would be the worse trade.
  */
  const landed = await waitForRepoContent(installationId, {
    owner: source.githubOrg,
    repo: repoName,
  });

  const workflow = landed
    ? await removeClassroomWorkflow(installationId, {
        owner: source.githubOrg,
        repo: repoName,
      })
    : ("repository-empty" as const);

  if (workflow === "repository-empty") {
    console.warn(
      `accept: ${source.githubOrg}/${repoName} had no content after waiting, so a ` +
        `classroom.yml may have been left in it. The template is ` +
        `${source.templateRepo}.`,
    );
  }

  const where = {
    status: "ACCEPTED" as const,
    repoFullName,
    repoUrl: repo.html_url,
    repoGithubLoginAtCreation: student.githubUsername,
  };

  if (team && teamSubmissionId) {
    /*
      Written to the row already claimed above rather than upserted, because that row is where the
      team's work lives and it may not be this member's. Then every member gets one — after the
      repository exists, so a mirror never appears for work there is nowhere to do.
    */
    await db.submission.update({ where: { id: teamSubmissionId }, data: where });
    await ensureTeamRows(db, {
      assignmentId: assignment.id,
      teamId: team.id,
      teamSetId: team.teamSetId,
      teamSubmissionId,
    });

    return { submission: await ownRow(db, assignment.id, student.id), copyUrl: null };
  }

  const submission = await db.submission.upsert({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
    create: { assignmentId: assignment.id, studentId: student.id, ...where },
    update: where,
  });

  return { submission, copyUrl: null };
}
