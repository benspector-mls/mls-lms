/**
 * Makes an existing account an admin.
 *
 *   npm run grant:admin -- somebody@example.com
 *
 * **The first admin of a deployment has to be granted from outside the application**, because
 * there is nobody to grant it from inside: `staff.setAdmin` is `adminProcedure`, and an
 * instructor promoting themselves is the escalation that guard exists to prevent. So this script
 * is not a convenience — it is the base case, and every later admin comes from the Admin screen.
 *
 * It cannot create an account. Identity belongs to Supabase Auth, so the person must have signed
 * in at least once; this only changes the role on the profile that login created.
 *
 * Deliberately one direction. There is no `revoke:admin` here, because taking admin away is an
 * ordinary decision the Admin screen makes — with the check that refuses removing the last one,
 * which a script bypassing the procedure would not have.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error('Usage: npm run grant:admin -- somebody@example.com');
    process.exit(1);
  }

  const { db } = await import('../lib/prisma');

  const profile = await db.profile.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true, role: true },
  });

  if (!profile) {
    console.error(
      `No account found for ${email}.\n\n` +
      `Profiles are created by Supabase Auth when somebody signs in — this script cannot ` +
      `create one. Have them sign in once, then run this again.`,
    );
    process.exit(1);
  }

  if (profile.role === 'ADMIN') {
    console.log(`${email} is already an admin.`);
  } else {
    await db.profile.update({ where: { id: profile.id }, data: { role: 'ADMIN' } });
    console.log(`${email} raised from ${profile.role} to ADMIN.`);
  }

  // Printed because "who else can do this" is the question somebody running this is one step away
  // from asking, and the answer decides whether the deployment has a single point of failure.
  const admins = await db.profile.findMany({
    where: { role: 'ADMIN' },
    orderBy: { email: 'asc' },
    select: { email: true, displayName: true },
  });

  console.log(`\nAdmins (${admins.length}):`);
  for (const admin of admins) {
    console.log(`  ${admin.email}${admin.displayName ? ` — ${admin.displayName}` : ''}`);
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
