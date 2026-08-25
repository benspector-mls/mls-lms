"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  ShieldMinus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { EmptyState } from "@/components/list-states";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INVITE_LIFETIME_DAYS } from "@/lib/staff/invite";
import { initials } from "@/lib/people";
import { formatDate, formatRelative } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Who may teach, and who may decide that.
 *
 * Two tabs because there are two mechanisms and they answer different questions: an invitation is
 * how somebody *becomes* staff, and the role control is how an account that already exists gains
 * more. Neither substitutes for the other — an invitation works before the person has an account,
 * and promotion only acts on somebody already here.
 *
 * Everything on this screen is admin-only, enforced by `adminProcedure` rather than by this
 * component rendering or not: the page is one URL away from any instructor who guesses it.
 */

type People = RouterOutputs["staff"]["people"];
type Invites = RouterOutputs["staff"]["invites"];

export function StaffAdmin({
  people,
  invites,
  now,
}: {
  people: People;
  invites: Invites;
  /**
   * Passed in rather than read here, so every relative time on the screen is measured from one
   * instant and two rows cannot disagree about whether a link has expired.
   */
  now: Date;
}) {
  const openInvites = invites.filter((invite) => invite.state === "open").length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Staff"
        description={[
          `${people.adminCount} ${people.adminCount === 1 ? "admin" : "admins"}`,
          `${people.people.length} with staff access`,
          openInvites > 0
            ? `${openInvites} ${openInvites === 1 ? "invitation" : "invitations"} outstanding`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {/*
        Said once, at the top, because both tabs below hand out the same thing and it is the one
        fact that makes this screen worth being careful on. A cohort's join link admits somebody to
        one course; this admits them to all of them.
      */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          Staff access is not scoped to a cohort. An instructor can author assignments and read
          every student&apos;s grades in every course, so this is the one list where who is on it
          matters more than what they are doing.
        </p>
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="invites">Invitations</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-4">
          <PeopleTab people={people} />
        </TabsContent>
        <TabsContent value="invites" className="mt-4">
          <InvitesTab invites={invites} now={now} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function PeopleTab({ people }: { people: People }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  const setAdmin = useMutation(
    trpc.staff.setAdmin.mutationOptions(
      settled({
        onSuccess: (result) => {
          const who = result.displayName ?? result.email ?? "That account";
          toast.success(
            result.role === "ADMIN" ? `${who} is now an admin.` : `${who} is an instructor again.`,
          );
        },
      }),
    ),
  );

  if (people.people.length === 0) {
    return (
      <EmptyState
        icon={<Users />}
        title="Nobody has staff access yet"
        description="Generate an invitation on the next tab and send it to whoever is teaching."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="hidden sm:table-cell">Teaches</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Admin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.people.map((person) => {
              const name = person.displayName ?? person.githubUsername ?? person.email ?? "Unnamed";
              const isAdmin = person.role === "ADMIN";

              /*
                Refused by the procedure and not offered here, which is the same pair as every
                other destructive control in this application: the interface should not offer an
                action that cannot succeed, and the procedure is what actually refuses, because a
                request can carry anything the browser did not send.
              */
              const lastAdmin = isAdmin && people.adminCount <= 1;

              return (
                <TableRow key={person.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                          {initials(name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {name}
                          {person.isYou && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {person.email ?? "—"}
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    {person.programs.length === 0 ? (
                      // Worth naming rather than leaving blank. An instructor teaching nothing is
                      // usually somebody who redeemed an invitation and was never added to a
                      // matriculation, which is a loose end rather than a normal state.
                      <span className="text-xs text-muted-foreground">No program yet</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {person.programs.map((program) => (
                          <span key={program.id} className="truncate text-xs">
                            {program.name}{" "}
                            <span className="text-muted-foreground">· {program.matriculation}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge variant={isAdmin ? "default" : "secondary"}>
                      {isAdmin ? "Admin" : "Instructor"}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-right">
                    {lastAdmin ? (
                      <span className="text-xs text-muted-foreground">Only admin</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className={isAdmin ? "text-destructive hover:text-destructive" : undefined}
                        disabled={setAdmin.isPending}
                        onClick={() => setAdmin.mutate({ profileId: person.id, admin: !isAdmin })}
                      >
                        {isAdmin ? (
                          <ShieldMinus data-icon="inline-start" />
                        ) : (
                          <ShieldCheck data-icon="inline-start" />
                        )}
                        {isAdmin ? "Revoke" : "Make admin"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        An admin can invite staff and grant admin to anybody here. Revoking the last admin is
        refused — it would leave nobody able to use this screen, and no way back except editing the
        database. Making somebody staff in the first place is an invitation, so that there is a
        record of how they got access.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

function InvitesTab({ invites, now }: { invites: Invites; now: Date }) {
  const trpc = useTRPC();
  const settled = useServerMutation();

  /** The one just generated, so it can be copied without hunting for it in the table. */
  const [fresh, setFresh] = React.useState<string | null>(null);

  const create = useMutation(
    trpc.staff.createInvite.mutationOptions(
      settled({
        onSuccess: (result) => {
          setFresh(result.token);
        },
      }),
    ),
  );

  const revoke = useMutation(
    trpc.staff.revokeInvite.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Invitation deleted. That link no longer works.");
        },
      }),
    ),
  );

  const busy = create.isPending || revoke.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Invite an instructor</span>
          <span className="text-xs text-muted-foreground">
            Generate a link and send it however you already talk to them. Whoever opens it and signs
            in becomes an instructor. Each link works <strong>once</strong> and expires after{" "}
            {INVITE_LIFETIME_DAYS} days — unlike a cohort&apos;s join link, which is reusable,
            because this one grants access to every course.
          </span>
        </div>

        <div>
          <Button size="sm" disabled={busy} onClick={() => create.mutate()}>
            {create.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            New invitation
          </Button>
        </div>

        {/*
          Shown once, right after generating. The token is in the table below too, but a link you
          have to find again is a link that gets sent wrong.
        */}
        {fresh && <FreshLink token={fresh} onDismiss={() => setFresh(null)} />}
      </div>

      {invites.length === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title="No invitations yet"
          description="Generate one above. Used and expired links stay on this list, so how somebody got access stays answerable."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>Who used it</TableHead>
                <TableHead className="hidden sm:table-cell">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell>
                    <InviteStateBadge state={invite.state} expiresAt={invite.expiresAt} now={now} />
                  </TableCell>

                  <TableCell>
                    {invite.redeemedBy ? (
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {invite.redeemedBy.displayName ??
                            invite.redeemedBy.githubUsername ??
                            invite.redeemedBy.email ??
                            "Unnamed"}
                        </span>
                        {invite.redeemedAt && (
                          <span className="text-xs text-muted-foreground">
                            {formatRelative(invite.redeemedAt, now)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-xs">{formatDate(invite.createdAt)}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        by {invite.createdBy.displayName ?? invite.createdBy.email ?? "unknown"}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {invite.state === "open" && <CopyLinkButton token={invite.token} />}
                      {/*
                        Not offered on a redeemed one. That row has stopped being a credential and
                        become the record of somebody getting access — deleting it would remove the
                        only trace of how they got in, which is why the procedure refuses it too.
                      */}
                      {invite.state !== "redeemed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => revoke.mutate({ inviteId: invite.id })}
                        >
                          <Trash2 data-icon="inline-start" />
                          Delete
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function InviteStateBadge({
  state,
  expiresAt,
  now,
}: {
  state: Invites[number]["state"];
  expiresAt: Date;
  now: Date;
}) {
  if (state === "redeemed") return <Badge variant="secondary">Used</Badge>;
  if (state === "expired") return <Badge variant="outline">Expired</Badge>;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Badge className="w-fit">Open</Badge>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        expires {formatRelative(expiresAt, now)}
      </span>
    </div>
  );
}

/** The link just generated, spelled out and copyable. */
function FreshLink({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const link = useInviteLink(token);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
      <span className="text-xs font-medium">Send this link</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-xs">
          {link}
        </code>
        <CopyLinkButton token={token} variant="outline" />
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

function CopyLinkButton({
  token,
  variant = "ghost",
}: {
  token: string;
  variant?: "ghost" | "outline";
}) {
  const link = useInviteLink(token);
  const [copied, setCopied] = React.useState(false);

  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => {
        void navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

/**
 * The absolute link, built in the browser.
 *
 * The server rendering this has no reliable idea what host the admin is looking at — a preview
 * deployment and production share the same code — and a link that pointed at the wrong host would
 * be discovered by the person it was sent to.
 */
function useInviteLink(token: string): string {
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  return origin ? `${origin}/invite/${token}` : `/invite/${token}`;
}
