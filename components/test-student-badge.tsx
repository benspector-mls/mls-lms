import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * The marker on every row that is not a person.
 *
 * Shared rather than written at each of the three screens that draw a student — the roster, the
 * gradebook, and triage — because they have to agree. A test student that reads as a badged row on
 * two of them and an ordinary name on the third is a student who has not started, which is the one
 * misreading this whole feature has to prevent.
 *
 * Amber, matching the banner an admin sees while looking through one, so the two states are legible
 * as the same fact from either side. Not red: nothing is wrong, and a warning colour on a roster
 * would say a student was in trouble.
 */
export function TestStudentBadge() {
  return (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 border-amber-500/40 font-normal text-amber-700 dark:text-amber-300"
    >
      <FlaskConical className="size-3" />
      Test
    </Badge>
  );
}
