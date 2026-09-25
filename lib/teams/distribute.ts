/**
 * Dividing a roster into teams of about one size.
 *
 * Pure, and deliberately not `server-only`: the team sets screen runs this in the browser to
 * show an instructor what "teams of 3" will produce before anything is written, and then to
 * decide who goes where once the teams exist. Nothing here reaches the database; the two
 * procedures it feeds are `teamSets.addTeam`, which makes the teams, and
 * `teamSets.setPlacements`, which records the result.
 *
 * **The one rule is never a team of one.** An instructor asks for teams of about a size, and any
 * outcome within one of it is a project a small group can do — but a team of one is somebody
 * doing group work alone, which is the outcome this screen exists to prevent. So a remainder of
 * one is folded into an existing team (19 in twos is eight 2s and a 3) and a remainder of two or
 * more becomes a team of its own (5 in threes is a 3 and a 2, not one team of 5).
 */

/**
 * How many teams a group of this many fellows makes at about this size.
 *
 * Rounded up, then one fewer if rounding up would leave a team of exactly one. A group smaller
 * than the size is one small team, and a group of one is one team of one — there is nothing else
 * it can be, and refusing would leave that fellow on no team at all.
 */
export function teamCountFor(fellowCount: number, teamSize: number): number {
  if (fellowCount <= 0) return 0;
  const teams = Math.ceil(fellowCount / teamSize);
  return teams > 1 && fellowCount % teamSize === 1 ? teams - 1 : teams;
}

/**
 * Deals fellows into this many teams in turn, first to the first team, second to the second.
 *
 * Round-robin is what keeps the sizes within one of each other whatever the count. The order of
 * `fellows` is kept, so this is deterministic — the only randomness is whatever the caller did to
 * the list first.
 */
export function dealIntoTeams<T>(fellows: T[], teamCount: number): T[][] {
  if (teamCount <= 0) return [];
  const teams: T[][] = Array.from({ length: teamCount }, () => []);
  fellows.forEach((fellow, index) => teams[index % teamCount].push(fellow));
  return teams;
}

/**
 * A copy of the list in random order.
 *
 * Fisher–Yates over a copy. `random` is a parameter so a test can fix the outcome; the screen
 * passes nothing and gets `Math.random`, which is what makes a second press of Distribute
 * evenly give a different answer from the first.
 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** One group to divide on its own: the whole roster, or one cohort of it. */
export type DistributionGroup<T> = { label: string; fellows: T[] };

/** The same group with its team count decided. */
export type PlannedGroup<T> = DistributionGroup<T> & { teamCount: number };

export type DistributionPlan<T> = {
  /** Only the groups with somebody in them, in the order given. */
  groups: PlannedGroup<T>[];
  /** Every group's teams added up: how many the set needs to hold in total. */
  teamCount: number;
  fellowCount: number;
};

/**
 * How many teams each group makes, and how many that is altogether.
 *
 * One group is "everybody"; one per cohort is "keep cohorts together". A group with nobody in it
 * is dropped rather than planned at zero, so the summary the screen prints names only cohorts that
 * will get a team.
 */
export function planDistribution<T>(
  groups: DistributionGroup<T>[],
  teamSize: number,
): DistributionPlan<T> {
  const planned = groups
    .filter((group) => group.fellows.length > 0)
    .map((group) => ({ ...group, teamCount: teamCountFor(group.fellows.length, teamSize) }));

  return {
    groups: planned,
    teamCount: planned.reduce((total, group) => total + group.teamCount, 0),
    fellowCount: planned.reduce((total, group) => total + group.fellows.length, 0),
  };
}

/** Where one fellow goes. */
export type TeamAssignment<T> = { fellow: T; teamId: string };

/**
 * Who goes on which team, once the teams exist.
 *
 * Each group takes the next run of team ids in the order given, so with cohorts kept together the
 * first cohort's teams come first and a cohort's teams sit next to each other on the screen.
 * Within a group the fellows are shuffled and then dealt, which is the one place chance enters.
 *
 * Refuses too few teams rather than dealing into what there is: the caller made the teams from
 * this plan's count, so a shortfall is a bug and not a case to absorb.
 */
export function assignTeams<T>(
  plan: DistributionPlan<T>,
  teamIds: readonly string[],
  random: () => number = Math.random,
): TeamAssignment<T>[] {
  if (teamIds.length < plan.teamCount) {
    throw new Error(`This plan needs ${plan.teamCount} teams and was given ${teamIds.length}.`);
  }

  const assignments: TeamAssignment<T>[] = [];
  let next = 0;

  for (const group of plan.groups) {
    const ids = teamIds.slice(next, next + group.teamCount);
    next += group.teamCount;

    dealIntoTeams(shuffle(group.fellows, random), group.teamCount).forEach((team, index) => {
      for (const fellow of team) assignments.push({ fellow, teamId: ids[index] });
    });
  }

  return assignments;
}
