import {
  groupByAssignment,
  nameSubtext,
  rowNames,
  triageStudentName,
  type GroupableRow,
} from "@/lib/grade/triage-groups";

const COURSE = "course-1";

function row(
  id: string,
  assignmentId: string,
  title: string,
  student: Partial<GroupableRow["student"]> = {},
): GroupableRow {
  return {
    id,
    assignment: { id: assignmentId, courseId: COURSE, title },
    student: { displayName: `Student ${id}`, email: `${id}@example.com`, ...student },
  };
}

/** One row handed in by a team, with the member holding it first, as the payload builds it. */
function teamRow(id: string, assignmentId: string, title: string, members: string[]): GroupableRow {
  return {
    ...row(id, assignmentId, title, { displayName: members[0] }),
    team: {
      members: members.map((name) => ({ displayName: name, email: `${name}@example.com` })),
    },
  };
}

describe("who a row is waiting on", () => {
  it("is the student, for work they did alone", () => {
    expect(rowNames(row("1", "a1", "Recursion", { displayName: "Ada" }))).toEqual(["Ada"]);
  });

  it("is every member, for work a team handed in", () => {
    // The whole point. Naming only the member holding the row answers "is Liz in the pile?"
    // wrongly for everybody else on the team — and which member holds it is an accident of who
    // pressed Accept first.
    expect(rowNames(teamRow("1", "a1", "Project", ["Ben Spector", "Liz Treacy"]))).toEqual([
      "Ben Spector",
      "Liz Treacy",
    ]);
  });

  it("falls back the same way for a member with no display name", () => {
    expect(
      rowNames({
        ...row("1", "a1", "Project"),
        team: { members: [{ displayName: null, email: "liz@example.com" }] },
      }),
    ).toEqual(["liz@example.com"]);
  });

  it("treats a null team as work done alone", () => {
    expect(
      rowNames({ ...row("1", "a1", "Recursion", { displayName: "Ada" }), team: null }),
    ).toEqual(["Ada"]);
  });
});

describe("grouping a bucket by assignment", () => {
  it("names every member of a team under the assignment's title", () => {
    const groups = groupByAssignment([
      teamRow("1", "a1", "Project", ["Ben Spector", "Liz Treacy"]),
    ]);

    expect(groups[0]!.studentNames).toEqual(["Ben Spector", "Liz Treacy"]);
    // One row, two people: the count of work and the count of names are different questions.
    expect(groups[0]!.rows).toHaveLength(1);
  });

  it("gathers the members of several teams on one assignment", () => {
    const groups = groupByAssignment([
      teamRow("1", "a1", "Project", ["Ada", "Grace"]),
      teamRow("2", "a1", "Project", ["Katherine", "Dorothy"]),
    ]);

    expect(groups[0]!.studentNames).toEqual(["Ada", "Grace", "Katherine", "Dorothy"]);
    expect(nameSubtext(groups[0]!.studentNames)).toBe("Ada, Grace, Katherine and 1 more");
  });

  it("does not name somebody twice", () => {
    // A set is a partition, so two rows for one assignment cannot share a member — but a subtext
    // naming the same person twice would read as two people with the same name.
    const groups = groupByAssignment([
      teamRow("1", "a1", "Project", ["Ada", "Grace"]),
      teamRow("2", "a1", "Project", ["Ada", "Katherine"]),
    ]);

    expect(groups[0]!.studentNames).toEqual(["Ada", "Grace", "Katherine"]);
  });

  it("puts every row of one assignment in one group", () => {
    const groups = groupByAssignment([
      row("1", "a1", "Recursion"),
      row("2", "a1", "Recursion"),
      row("3", "a2", "Loops"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.assignmentId === "a1")?.rows).toHaveLength(2);
    expect(groups.find((g) => g.assignmentId === "a2")?.rows).toHaveLength(1);
  });

  /*
    The property the screen's heading rests on. "N submissions left to grade" counts rows, and the
    groups beneath it are a way of drawing those same rows — so the two can only agree if nothing
    is lost or duplicated in the grouping.
  */
  it("keeps every row, so the groups and the heading count the same work", () => {
    const rows = [
      row("1", "a1", "Recursion"),
      row("2", "a2", "Loops"),
      row("3", "a1", "Recursion"),
      row("4", "a3", "Arrays"),
    ];

    const total = groupByAssignment(rows).reduce((sum, group) => sum + group.rows.length, 0);
    expect(total).toBe(rows.length);
  });

  it("orders the biggest pile first, because that is the one to pick up", () => {
    const groups = groupByAssignment([
      row("1", "a1", "Recursion"),
      row("2", "a2", "Loops"),
      row("3", "a2", "Loops"),
      row("4", "a2", "Loops"),
    ]);

    expect(groups.map((g) => g.title)).toEqual(["Loops", "Recursion"]);
  });

  // Without a tie-break the order would come from whatever the payload happened to hold, which
  // can differ between two renders of one screen.
  it("breaks a tie on title, so the order is total", () => {
    const groups = groupByAssignment([row("1", "a2", "Zebras"), row("2", "a1", "Arrays")]);
    expect(groups.map((g) => g.title)).toEqual(["Arrays", "Zebras"]);
  });

  it("collects the students who are waiting, in row order", () => {
    const groups = groupByAssignment([
      row("1", "a1", "Recursion", { displayName: "Ada" }),
      row("2", "a1", "Recursion", { displayName: "Grace" }),
    ]);

    expect(groups[0]!.studentNames).toEqual(["Ada", "Grace"]);
  });

  it("names a student by email when they have no display name", () => {
    const groups = groupByAssignment([
      row("1", "a1", "Recursion", { displayName: null, email: "ada@example.com" }),
    ]);

    expect(groups[0]!.studentNames).toEqual(["ada@example.com"]);
  });

  it("falls back to a placeholder rather than an empty name", () => {
    expect(triageStudentName({ displayName: null, email: null })).toBe("Unknown student");
  });

  it("carries the course, so a row can link into the queue", () => {
    const groups = groupByAssignment([row("1", "a1", "Recursion")]);
    expect(groups[0]!.courseId).toBe(COURSE);
  });

  it("has nothing to group when the bucket is empty", () => {
    expect(groupByAssignment([])).toEqual([]);
  });
});

describe("the names under an assignment's title", () => {
  it("lists them plainly when they fit", () => {
    expect(nameSubtext(["Ada", "Grace"])).toBe("Ada, Grace");
  });

  it("shows exactly three without a remainder", () => {
    expect(nameSubtext(["Ada", "Grace", "Katherine"])).toBe("Ada, Grace, Katherine");
  });

  /*
    A count rather than a bare ellipsis. "and 9 more" says how much is behind it, which is the
    thing a reader deciding what to pick up actually needs; "…" says only that there is some.
  */
  it("counts the rest rather than trailing off", () => {
    const names = ["Ada", "Grace", "Katherine", "Dorothy", "Mary"];
    expect(nameSubtext(names)).toBe("Ada, Grace, Katherine and 2 more");
  });

  it("says nothing when there is nobody", () => {
    expect(nameSubtext([])).toBe("");
  });
});
