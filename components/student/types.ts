/**
 * What a student's screens are handed.
 *
 * Derived from the procedures rather than declared, in the manner of every other component in
 * this application — a `select` that stops returning `finalScore` is a type error at the call
 * site rather than an undefined at runtime.
 *
 * They live in a file of their own because the course list and the assignment panel are two
 * components reading one payload. Declaring them in whichever file happened to be written first
 * and importing from there makes the other file depend on a component it does not use, and the
 * two would eventually be declared twice and drift.
 */

import type { RouterOutputs } from "@/trpc/types";

export type Course = RouterOutputs["courses"]["get"];
export type Assignment = RouterOutputs["assignments"]["listForCourse"][number];
export type Submission = Assignment["submissions"][number];
export type Resource = RouterOutputs["resources"]["listForCourse"][number];

/** The dashboard's row, which is a different and much narrower read. */
export type DashboardAssignment = RouterOutputs["assignments"]["listMine"][number];
