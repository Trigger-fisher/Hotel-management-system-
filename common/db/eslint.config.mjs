// Lints the database scripts (db/scripts). ESLint, TypeScript and the shared rules are installed in "web-app", so they are
// loaded from there; run it with `npm run lint:db` from "web-app" (it changes into this folder first).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fromWebApp = createRequire(path.join(here, "..", "..", "web-app", "package.json"));
const { defineConfig } = fromWebApp("eslint/config");
const nextTs = fromWebApp("eslint-config-next/typescript");

export default defineConfig([
  ...nextTs,
  {
    files: ["scripts/**/*.ts"],
    // Scripts report through process.stdout/stderr; no stray console.log.
    rules: { "no-console": "error" },
  },
]);
