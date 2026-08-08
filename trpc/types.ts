import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./routers/_app";

/**
 * The shapes the procedures actually return, for components to take as props.
 *
 * Derived rather than hand-written so a change to a `select` in a router is a type error
 * at the component that reads the removed field, instead of `undefined` at runtime.
 *
 * Import these with `import type`. The declaration is erased at compile time, so a
 * client component naming a router type does not pull the server router into its bundle.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;
