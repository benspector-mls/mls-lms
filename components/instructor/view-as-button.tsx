import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Entering a fellow's view, from the roster row or from the fellow's record.
 *
 * A form rather than a button with an onClick, because entering the view is a cookie and a full
 * navigation — see `app/api/view-as/route.ts`. One component for both screens so the fields that
 * route reads are written in one place.
 *
 * Offered to every instructor: whoever can open the roster or the record instructs the program,
 * and the server decides whether the view is read-only, which it is for everybody but an admin
 * looking through a test student. Callers offer it only for an active enrollment, because looking
 * through somebody removed from the program would show courses they cannot act in.
 */
export function ViewAsButton({
  studentId,
  programId,
  disabled,
}: {
  studentId: string;
  programId: string;
  disabled?: boolean;
}) {
  return (
    <form method="post" action="/api/view-as">
      <input type="hidden" name="studentId" value={studentId} />
      {/* Where to come back to. A test student can be on several rosters, so leaving cannot work
          this out later — this is the one moment that knows which program is being checked. */}
      <input type="hidden" name="programId" value={programId} />
      <Button size="sm" variant="ghost" type="submit" disabled={disabled}>
        <Eye data-icon="inline-start" />
        View as
      </Button>
    </form>
  );
}
