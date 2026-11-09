// Runs TypeScript that imports "server-only" outside Next.js (tests, command-line tools, a future worker).
// Next.js resolves the name "server-only" itself and turns a client-side import into a build error; the npm package is NOT
// installed. Outside Next, nothing resolves that name, so this hook points it at an empty module.
//
//   tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/*.test.ts
//
// This is the ONE file under src/server that does not start with import "server-only" (it must run before that import is resolved).
// Scripts under db/scripts never import server-only code and never need this hook.
import * as nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

type NextResolve = (specifier: string, context?: unknown) => unknown;
type RegisterHooks = (hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }) => unknown;

const registerHooks = (nodeModule as unknown as { registerHooks?: RegisterHooks }).registerHooks;
if (!registerHooks) throw new Error("This Node.js has no module.registerHooks (Node 22.15 or newer is needed)");

const EMPTY = pathToFileURL(path.join(__dirname, "empty.cjs")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY, format: "commonjs", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
