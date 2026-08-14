# Security

What protects student data in this application, where each control lives, and the settings that live outside this repository and matter just as much.

## The one thing to do before students arrive

**Disable the Email provider in the Supabase dashboard** (Authentication → Sign In / Providers → Email). Nothing in this codebase calls `signUp` or `signInWithPassword` any more, but removing the forms does not close the door: the publishable key is public by design, so both calls remain reachable against the Supabase API from anywhere until the provider itself is off. Until that setting is changed, anyone on the internet can still create an account.

With it off, GitHub is the only way in, which is the intended design — students need a GitHub account for the coursework regardless, so it costs them nothing and removes passwords, password reuse, and the reset flow from the surface entirely.

## Where each control lives

| Control | Enforced by | Read the reasoning in |
| --- | --- | --- |
| Who may sign in | Supabase (GitHub provider only) | `components/login-form.tsx` |
| Who may join a cohort | Per-cohort roster, checked in `enrollments.join` | `lib/courses/roster.ts` |
| Who may read a course | `assertCourseMember` / `assertActiveStudent` | `lib/courses/membership.ts` |
| Who may act in a course | Procedure builders, not call-site checks | `trpc/init.ts` |
| Which cohort an instructor may touch | `courseProcedure`, `lib/courses/scope.ts` | `trpc/init.ts` |
| What client-side JavaScript may read | Table privileges — nothing | migration `20260814024306` |
| What happened, and who did it | Append-only `audit_events` | `lib/audit/record.ts` |
| Spending on models and sandboxes | Counts out of the audit log | `lib/audit/rate-limit.ts` |

**Prisma connects as the table owner and is not restricted by row level security.** Every guard above is procedure code, and that is deliberate rather than an oversight — but it means a procedure written without a guard has no second line of defence. Build on the procedure builders in `trpc/init.ts` rather than checking roles inline; that is what makes the check impossible to leave out.

## Two-factor authentication

There is none in this application, and there should not be. Sign-in is GitHub, so two-factor is GitHub's to enforce — a GitHub organization can require it of every member in one setting, which is stronger than anything here could offer and needs no maintenance.

If Marcy staff are in a GitHub organization, turn that setting on there. Students are not in the organization, so their own GitHub two-factor is their choice, the same as it is for their coursework.

## Getting back in if everyone is locked out of GitHub

Re-enable the Email provider in the Supabase dashboard and send a recovery link to an admin's address. The route that consumes it, `app/auth/confirm/route.ts`, is kept for exactly this and is otherwise unused. Turn the provider back off afterwards.

This is the reason there is no break-glass password form in the application: a form would be a permanently open door for an event that has never happened, and the dashboard is reachable whenever the Supabase account is.

## Settings to check in the Supabase dashboard

These are not in version control and none of them are visible from the code.

- **Email provider: off.** See above. This is the important one.
- **Redirect URLs** (Authentication → URL Configuration): only the deployment's own origins. `app/auth/callback/route.ts` and `app/auth/confirm/route.ts` both refuse non-relative `next` values, but a loose allowlist here is a separate door.
- **Rate limits** (Authentication → Rate Limits): tighten sign-in and token refresh. Supabase enforces these; the application cannot.
- **Session length**: shorter is better for an application that shows grades on shared laptops.
- **Service role key**: rotate it. It has been in a development environment since the project started, and it bypasses row level security and every policy. Prefer the newer `sb_secret_…` format, which can be issued more than once and revoked individually, so the next rotation is not an outage.

## Settings to add at the platform edge

Rate limiting inside the application covers what costs money. Two surfaces it cannot reach are better handled by Vercel WAF rules, which need no code and no dependency:

- `/auth/*` — modest per-address limit. Supabase's own limits cover the authentication endpoints; this covers the pages.
- `/join/*` and the invitation routes — join and invitation tokens are 122 bits of randomness, so brute force is not a real threat. The rule exists so that enumeration attempts cost something rather than nothing.

## What the audit log records

Role changes, invitations created, revoked and redeemed, roster entries added and removed, enrollments joined, removed and restored, join-token rotation, test students created and deleted, entry into a test-student view, grades released, and the two operations that spend money.

Two properties worth knowing before reading it:

**The actor is always the real signed-in person.** While an admin is viewing as a test student, `createTRPCContext` substitutes the test student's id onto `ctx.user` — so an event written from `ctx.profile` would name the test student. `auditActor` reads `ctx.viewingAs` first for this reason, and `acted_as_id` records that the act happened inside a preview.

**There is no exit event for a test-student view.** The view is held by a session cookie with no lifetime, so closing the browser leaves it without any request being made. An event that was absent more often than present would invite conclusions from its absence.

The table is append-only, enforced by triggers rather than grants — grants would not constrain Prisma, which owns the table. Pruning means dropping the triggers deliberately.

## What is not covered

- **No second factor on the application itself**, by design. It rests on GitHub.
- **No alerting.** The audit log is written and can be read; nothing watches it.
- **A Salesforce integration will need its own section here** when it exists: the integration user's permission set, which fields it may write, and the record of each write. `GRADE_APPROVED` events are the intended basis for that record.
