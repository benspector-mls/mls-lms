"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ResourceKind } from "@/lib/generated/prisma/enums";
import {
  IMPLEMENTED_RESOURCE_KINDS,
  parseVideoUrl,
  RESOURCE_KIND_BLURB,
  RESOURCE_KIND_LABEL,
  VIDEO_PROVIDER_LABEL,
} from "@/lib/resources/spec";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

/**
 * Adding a resource, or editing one.
 *
 * One dialog for both, because the fields are identical and two forms would be two places for a
 * field to be added to only one of them. `resource` being null is what "new" means.
 *
 * **The kind is the first question and decides which fields exist**, the same shape the
 * assignment form uses: a link never shows a markdown box, and a note never shows a URL field.
 * Fields that do not apply are absent rather than disabled, because they are questions that do
 * not arise rather than settings left at a default.
 *
 * Unlike the assignment form, the kind stays editable after saving. Changing an assignment's kind
 * would change what its existing submissions are; a resource has none, so turning a link into a
 * note is a legitimate edit and `resourceColumns` clears the columns the old kind used.
 */

type Modules = RouterOutputs["modules"]["listForCourse"];
type Resource = RouterOutputs["resources"]["listForCourse"][number];

export function ResourceDialog({
  open,
  onOpenChange,
  modules,
  /** Null to create. Given, the row being edited. */
  resource,
  /** Which module a new one lands in. Ignored when editing, which reads the resource's own. */
  defaultModuleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modules: Modules;
  resource: Resource | null;
  defaultModuleId?: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();

  const [kind, setKind] = React.useState<ResourceKind>("LINK");
  const [moduleId, setModuleId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");

  /*
    Reset when the dialog opens rather than on every render of a closed one, so a half-typed
    resource is not wiped by an unrelated refetch — and so reopening on a different row does not
    show the previous row's text. Keyed on `open` and the row's id together: editing A, closing,
    then editing B has to reload, and both changes land in the same commit.
  */
  React.useEffect(() => {
    if (!open) return;

    if (resource) {
      setKind(resource.kind);
      setModuleId(resource.moduleId);
      setTitle(resource.title);
      setUrl(resource.url ?? "");
      setDescription(resource.description ?? "");
      setBody(resource.body ?? "");
      return;
    }

    setKind("LINK");
    setModuleId(defaultModuleId ?? modules[0]?.id ?? "");
    setTitle("");
    setUrl("");
    setDescription("");
    setBody("");
  }, [open, resource, defaultModuleId, modules]);

  const settled = {
    onError: (error: { message: string }) => toast.error(error.message),
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
  };

  const create = useMutation(
    trpc.resources.create.mutationOptions({
      ...settled,
      onSuccess: (row) => {
        toast.success(`Added "${row.title}".`);
        onOpenChange(false);
        router.refresh();
      },
    }),
  );
  const update = useMutation(
    trpc.resources.update.mutationOptions({
      ...settled,
      onSuccess: (row) => {
        toast.success(`Saved "${row.title}".`);
        onOpenChange(false);
        router.refresh();
      },
    }),
  );

  const busy = create.isPending || update.isPending;

  /*
    The video URL checked as it is typed, so a Loom link is refused where it was pasted rather
    than after the save. The same function the server writes the row with, so the two cannot
    disagree about what is recognised — an interface that accepted more than the procedure would
    be a save that fails for no visible reason.
  */
  const video = kind === "VIDEO" && url.trim() !== "" ? parseVideoUrl(url) : null;
  const videoProblem = kind === "VIDEO" && url.trim() !== "" && video === null;

  const complete =
    moduleId !== "" &&
    title.trim() !== "" &&
    (kind === "TEXT" ? body.trim() !== "" : url.trim() !== "") &&
    !videoProblem;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete) return;

    const spec =
      kind === "LINK"
        ? {
            kind: "LINK" as const,
            title,
            url,
            description: description.trim() === "" ? null : description,
          }
        : kind === "TEXT"
          ? { kind: "TEXT" as const, title, body }
          : { kind: "VIDEO" as const, title, url };

    if (resource) {
      update.mutate({ resourceId: resource.id, moduleId, spec });
    } else {
      create.mutate({ moduleId, spec });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{resource ? "Edit resource" : "Add a resource"}</DialogTitle>
            <DialogDescription>
              Readings, notes, and videos. Nothing here is graded or handed in — a resource is
              visible to the cohort as soon as it is saved.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="resource-kind">What is it?</Label>
              <Select
                value={kind}
                onValueChange={(next) => next && setKind(next as ResourceKind)}
                items={Object.fromEntries(
                  IMPLEMENTED_RESOURCE_KINDS.map((k) => [k, RESOURCE_KIND_LABEL[k]]),
                )}
              >
                <SelectTrigger id="resource-kind" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPLEMENTED_RESOURCE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {RESOURCE_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{RESOURCE_KIND_BLURB[kind]}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="resource-module">Module</Label>
              <Select
                value={moduleId}
                onValueChange={(next) => next && setModuleId(next)}
                items={Object.fromEntries(modules.map((row) => [row.id, row.name]))}
              >
                <SelectTrigger id="resource-module" className="w-full min-w-0">
                  <SelectValue placeholder="Choose a module" />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="resource-title">Title</Label>
              <Input
                id="resource-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={kind === "TEXT" ? "How to read an error message" : "MDN: Array.map()"}
                maxLength={200}
              />
              {/* The ordering is alphabetical, so the title is also where a resource sits. */}
              <p className="text-xs text-muted-foreground">
                Resources are listed alphabetically within their module.
              </p>
            </div>

            {kind !== "TEXT" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="resource-url">{kind === "VIDEO" ? "Video link" : "Link"}</Label>
                <Input
                  id="resource-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={
                    kind === "VIDEO"
                      ? "https://www.youtube.com/watch?v=…"
                      : "https://developer.mozilla.org/…"
                  }
                  maxLength={2000}
                  aria-invalid={videoProblem || undefined}
                />
                {/*
                  Which video was recognised, rather than only whether one was. An instructor who
                  pasted the wrong tab's URL gets a valid-looking field either way; naming the
                  provider is what lets them notice.
                */}
                {video && (
                  <p className="text-xs text-muted-foreground">
                    {VIDEO_PROVIDER_LABEL[video.provider]} video{" "}
                    <span className="font-mono">{video.videoId}</span>. It will play on the course
                    page.
                  </p>
                )}
                {videoProblem && (
                  <p className="text-xs text-destructive">
                    Only YouTube and Vimeo links can be embedded. Paste the address from the
                    video&apos;s own page — or add it as a Link instead, which accepts any address.
                  </p>
                )}
              </div>
            )}

            {kind === "LINK" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="resource-description">Description (optional)</Label>
                <Input
                  id="resource-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Read the first two sections before Wednesday."
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">
                  One line, shown under the title. Anything that wants formatting is a Note.
                </p>
              </div>
            )}

            {kind === "TEXT" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="resource-body">Note</Label>
                <Textarea
                  id="resource-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={10}
                  placeholder={"## Before you start\n\nRun `npm i` first, then…"}
                  maxLength={50_000}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Markdown, rendered the same way feedback is.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!complete || busy}>
              {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {resource ? "Save" : "Add resource"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
