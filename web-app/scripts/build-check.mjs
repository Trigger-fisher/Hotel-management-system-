// A production build in a private folder, for checking without disturbing the shared dev server (next dev on :3001).
// `next build` rewrites tsconfig.json to list the build folder's type files; this script puts tsconfig.json back exactly as it was
// and removes the folder, so a check leaves nothing behind.   Usage: npm run build:check
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const dir = ".next-check";
const before = readFileSync("tsconfig.json", "utf8");
const run = spawnSync("npx", ["next", "build"], { stdio: "inherit", shell: true, env: { ...process.env, NEXT_DIST_DIR: dir } });
writeFileSync("tsconfig.json", before);
rmSync(dir, { recursive: true, force: true });
process.exit(run.status ?? 1);
