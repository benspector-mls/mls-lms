import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import prettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    // `npm run lint` is `eslint .`, which walks everything, so generated and
    // vendored trees have to be excluded explicitly. Without this the run
    // reported over 22,000 problems — almost all of them from `.next` — which
    // made it useless for finding the real ones.
    //
    // .next: Next.js build output, rewritten on every build.
    // lib/generated: the Prisma client, rewritten on every `prisma generate`.
    // swe-assignment-grading-guides: a clone of the grading toolkit and answer
    //   keys, pointed at by GRADING_ASSETS_PATH and already gitignored.
    // assignment-templates: copies of the student assignment repositories, kept for
    //   reference. They carry their own Airbnb eslint config and are deliberately
    //   full of unfinished stub code, so linting them with this project's rules
    //   produced ~680 meaningless errors.
    ignores: [
      ".next/**",
      "lib/generated/**",
      "swe-assignment-grading-guides/**",
      "assignment-templates/**",
      // The v0 output, kept as a reference copy while its screens are ported one at a
      // time. It is a separate project with its own dependencies and is not built.
      "v0/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  /*
    Last, deliberately. This turns off every eslint rule that overlaps with
    Prettier, so formatting has exactly one authority and `npm run lint` never
    reports a problem `npm run format` would fix. It disables rules rather than
    adding any, which is why it has to come after everything it is switching off.
  */
  prettier,
];

export default eslintConfig;
