"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { attendanceCsvFilename } from "@/lib/attendance/csv";
import type { SchoolDay } from "@/lib/school-time";

/**
 * Hands over the attendance record as a spreadsheet.
 *
 * The same shape as `gradebook-download.tsx`, and for the same reason: the file arrives already
 * built by the server render that drew the grid, so there is no second query, no second endpoint
 * to gate, and no way for the file to describe a different cohort from the table above it.
 */
export function AttendanceDownload({
  csv,
  cohortTerm,
  from,
  to,
}: {
  csv: string;
  cohortTerm: string;
  from: SchoolDay | null;
  to: SchoolDay | null;
}) {
  function download() {
    // The byte order mark is what makes Excel read this as UTF-8. Without it a name with an accent
    // arrives mangled, in a file whose whole job is to name people correctly.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = attendanceCsvFilename({ cohortTerm, from, to });
    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Button variant="outline" size="sm" onClick={download}>
      <Download data-icon="inline-start" />
      Download CSV
    </Button>
  );
}
