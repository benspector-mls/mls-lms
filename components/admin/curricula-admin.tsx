"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import * as React from "react";
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
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatDateTime } from "@/lib/status";
import { useTRPC } from "@/trpc/client";
import type { RouterOutputs } from "@/trpc/types";

type Curricula = RouterOutputs["curricula"]["list"];
type SyncResult = RouterOutputs["curricula"]["sync"];

/**
 * The curricula, and what is done to each: add one, copy it from GitHub now, remove it.
 *
 * **The problems a copy finds are listed under its curriculum until the page is left.** They are
 * the run's answer rather than stored state: the next run, by the hour or by the button, finds them
 * again for as long as they are in the repository.
 */
export function CurriculaAdmin({ curricula }: { curricula: Curricula }) {
  const trpc = useTRPC();
  const settled = useServerMutation();
  const [name, setName] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [results, setResults] = React.useState<Record<string, SyncResult>>({});
  const [removing, setRemoving] = React.useState<Curricula[number] | null>(null);

  const create = useMutation(
    trpc.curricula.create.mutationOptions(
      settled({
        onSuccess: (created) => {
          toast.success(`Added ${created.name}. Press Sync now to copy its lessons.`);
          setName("");
          setRepo("");
          setRef("");
        },
      }),
    ),
  );
  const sync = useMutation(
    trpc.curricula.sync.mutationOptions(
      settled({
        onSuccess: (result, input) => {
          setResults((previous) => ({ ...previous, [input.curriculumId]: result }));
          toast.success(
            `Copied ${result.lessons} lessons from commit ${result.commitSha.slice(0, 7)}; ` +
              `${result.changed} had changed.`,
          );
        },
      }),
    ),
  );
  const remove = useMutation(
    trpc.curricula.remove.mutationOptions(
      settled({
        onSuccess: () => {
          toast.success("Curriculum removed.");
          setRemoving(null);
        },
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "" || repo.trim() === "") return;
          create.mutate({ name: name.trim(), repo: repo.trim(), ref: ref.trim() || undefined });
        }}
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium">Name</span>
          <Input
            value={name}
            maxLength={120}
            placeholder="Software Engineering"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium">Repository</span>
          <Input
            value={repo}
            placeholder="owner/repo"
            onChange={(event) => setRepo(event.target.value)}
          />
        </label>
        <label className="flex min-w-32 flex-col gap-1.5">
          <span className="text-sm font-medium">Branch</span>
          <Input
            value={ref}
            placeholder="Default branch"
            onChange={(event) => setRef(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          disabled={create.isPending || name.trim() === "" || repo.trim() === ""}
          data-icon="inline-start"
        >
          {create.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Plus aria-hidden />
          )}
          Add
        </Button>
      </form>

      {curricula.length === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          No curriculum yet. No course can show lessons until one is added and copied.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {curricula.map((curriculum) => {
            const result = results[curriculum.id];
            const syncing = sync.isPending && sync.variables?.curriculumId === curriculum.id;

            return (
              <li
                key={curriculum.id}
                className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="font-medium">{curriculum.name}</p>
                    <p className="text-muted-foreground">
                      <a
                        href={`https://github.com/${curriculum.repo}${curriculum.ref ? `/tree/${curriculum.ref}` : ""}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono underline underline-offset-2"
                      >
                        {curriculum.repo}
                      </a>
                      {curriculum.ref ? ` · branch ${curriculum.ref}` : ""}
                    </p>
                    <p className="text-muted-foreground">
                      {curriculum.lastCopy
                        ? `At commit ${curriculum.lastCopy.commitSha.slice(0, 7)}, copied ${formatDateTime(curriculum.lastCopy.syncedAt)}`
                        : "Not copied yet"}
                      {" · "}
                      {curriculum.courses === 1
                        ? "1 course shows it"
                        : `${curriculum.courses} courses show it`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={sync.isPending}
                      onClick={() => sync.mutate({ curriculumId: curriculum.id })}
                      data-icon="inline-start"
                    >
                      {syncing ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw aria-hidden />
                      )}
                      Sync now
                    </Button>
                    {/* Only an unused curriculum, which is what the procedure allows. */}
                    {curriculum.courses === 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${curriculum.name}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRemoving(curriculum)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>

                {result && (
                  <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                    <p className="font-medium">
                      {result.problems.length === 0
                        ? "No problems in the curriculum."
                        : `${result.problems.length} ${result.problems.length === 1 ? "problem" : "problems"} to fix in the repository`}
                    </p>
                    {result.problems.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {result.problems.map((problem, index) => (
                          <li key={index}>
                            <span className="font-mono text-xs">{problem.path}</span>{" "}
                            <span className="text-muted-foreground">{problem.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              Its copied lessons are deleted from the LMS. The repository on GitHub is not touched,
              and adding it again copies the lessons back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate({ curriculumId: removing.id })}
            >
              {remove.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Remove curriculum
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
