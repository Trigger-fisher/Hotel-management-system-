import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Backend/other build output folders (NEXT_DIST_DIR=.next-xxx).
    ".next-*/**",
    // Hotel Pallav's vendored scripts and styles (third-party code, served as is).
    "public/**",
  ]),
  // Server code logs only through src/server/logger, which redacts secrets. Raw console calls would bypass that.
  {
    files: ["src/server/**/*.ts", "src/db/**/*.ts", "src/app/api/**/*.ts"],
    rules: { "no-console": "error" },
  },
  // Layers (A14): routes -> services -> repository interfaces. A route file only calls the wrapper; a service never sees SQL, pg or a
  // concrete repository; `pg` is imported only under src/db. (Later blocks override earlier ones for the same files, so each block
  // that matches a file lists everything restricted for it.)
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/db/**", "src/server/db/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["pg", "pg/*", "mysql2", "mysql2/*"], message: "The database drivers are imported only under src/db and src/server/db." }] }],
    },
  },
  {
    files: ["src/app/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["pg", "pg/*"], message: "Routes never touch the database driver." },
            { group: ["@/db/*", "**/db/*"], message: "Routes never touch src/db: go through a service." },
            { group: ["@/server/repos", "@/server/repos/*", "**/server/repos/*"], message: "Routes never touch a repository: go through a service." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["pg", "pg/*"], message: "A service never sees the database driver." },
            { group: ["@/db/*", "**/db/*"], message: "A service never sees src/db: it receives repositories from a unit." },
            { group: ["**/repos/memory/*", "**/repos/memory"], message: "A service never imports a concrete repository, only the interfaces." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
