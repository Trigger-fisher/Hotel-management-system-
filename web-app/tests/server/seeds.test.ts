// The platform seeds: generated from Pallav's own permission list and role grants, mapped onto MJ's four levels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { OUTPUT_FILES, PORTAL_ROLES, ROLE_GRANTS, generate, loadSource, type Level } from "../../../common/db/scripts/generate-platform-seeds";
import { lintDirectory, formatViolations } from "../../../common/db/scripts/lint-sql";
import { loadMigrationFiles, runMigrations, type MigrationClient, type QueryResult } from "../../../common/db/scripts/migrate";

const seedsDir = path.join(__dirname, "..", "..", "..", "common", "db", "seeds", "platform");
const source = loadSource();
const generated = generate(source);
const RANK: Record<Level, number> = { view: 1, create: 2, edit: 3, full: 4 };

const levelOf = (role: string, permission: string): Level | undefined => generated.grants.find((g) => g.role === role && g.permission === permission)?.level;
const keysOf = (role: string): string[] => generated.grants.filter((g) => g.role === role).map((g) => g.permission);

describe("Pallav's permission list", () => {
  test("13 modules, 37 parts and 6 abilities, straight from Permissions.php", () => {
    assert.equal(source.modules.length, 13);
    assert.equal(source.modules.reduce((n, m) => n + m.parts.length, 0), 37);
    assert.equal(source.abilities.length, 6);
    assert.deepEqual(source.abilities.map((a) => a.key), ["users.password", "users.set-password", "users.activity", "website.secrets", "system.backdate", "system.force"]);
    assert.equal(source.source, "app/Support/Permissions.php");
  });

  test("every key fits the permissions.key CHECK and is unique", () => {
    const keys = [...source.modules.flatMap((m) => [m.key, ...m.parts.map((p) => p.key)]), ...source.abilities.map((a) => a.key)];
    assert.equal(keys.length, 56);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of keys) assert.match(key, /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/, key);
  });

  test("labels and descriptions fit the column limits", () => {
    for (const item of [...source.modules, ...source.modules.flatMap((m) => m.parts), ...source.abilities]) {
      assert.ok(item.label.length >= 1 && item.label.length <= 120, item.key);
      assert.ok((item.about ?? "").length <= 500, item.key);
    }
  });
});

describe("the generated seed files", () => {
  test("the committed files are exactly what the generator produces (no hand edits, no drift)", () => {
    assert.equal(readFileSync(OUTPUT_FILES.permissions, "utf8"), generated.permissionsSql);
    assert.equal(readFileSync(OUTPUT_FILES.roles, "utf8"), generated.rolesSql);
  });

  test("they pass the seed lint (idempotent INSERT ... ON CONFLICT only, no secrets)", () => {
    const violations = lintDirectory(seedsDir, "platform", "seed");
    assert.equal(violations.length, 0, formatViolations(violations));
  });

  test("the SQL names every permission once and quotes apostrophes", () => {
    const sql = generated.permissionsSql;
    for (const item of [...source.modules, ...source.modules.flatMap((m) => m.parts), ...source.abilities]) {
      assert.equal(sql.split(`('${item.key}',`).length - 1, 1, `${item.key} appears once`);
    }
    assert.ok(sql.includes("guest''s account"));
    assert.ok(!/[^']'[^',()\n]*[a-z]'s [a-z]/.test(sql.replace(/''/g, "")), "no unescaped apostrophe inside a string");
  });

  test("every seed file is applied by the runner in seeds mode, in order, on a fake database", async () => {
    // a minimal fake: it remembers the versions recorded in platform.schema_seeds (the runner's own logic is tested in migrate.test.ts)
    const recorded: { version: string; checksum: string }[] = [];
    const db: MigrationClient = {
      async query(text: string, params: readonly unknown[] = []): Promise<QueryResult> {
        if (text.startsWith("SELECT pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        if (text.startsWith("SELECT version, checksum FROM")) return { rows: [...recorded] };
        if (text.startsWith("INSERT INTO \"platform\".schema_seeds")) recorded.push({ version: String(params[0]), checksum: String(params[1]) });
        return { rows: [] };
      },
    };
    const files = loadMigrationFiles(seedsDir);
    assert.deepEqual(files.map((f) => f.version), ["0001_permissions", "0002_roles", "0003_hms_permissions"]);
    const result = await runMigrations({ client: db, kind: "seeds", platformFiles: files, hotelFiles: [], listHotelSchemas: async () => [] });
    assert.deepEqual(result.applied.map((a) => a.version), ["0001_permissions", "0002_roles", "0003_hms_permissions"]);
    const again = await runMigrations({ client: db, kind: "seeds", platformFiles: files, hotelFiles: [], listHotelSchemas: async () => [] });
    assert.deepEqual(again.applied, []);
  });
});

describe("roles", () => {
  test("Pallav's four roles plus the guest and corporate portal roles, all built-in system roles", () => {
    assert.deepEqual(ROLE_GRANTS.map((r) => [r.key, r.level]), [["viewer", 1], ["editor", 2], ["admin", 3], ["super_admin", 4]]);
    assert.deepEqual(PORTAL_ROLES.map((r) => r.key), ["guest", "corporate"]);
    assert.match(generated.rolesSql, /ON CONFLICT/, "built-in roles are idempotent: a second run changes nothing");
    for (const role of [...ROLE_GRANTS, ...PORTAL_ROLES]) {
      assert.match(role.key, /^[a-z0-9][a-z0-9_-]{0,62}$/);
      assert.match(role.accent, /^#[0-9A-Fa-f]{6}$/);
      assert.ok(role.level >= 1 && role.level <= 100);
      assert.ok(role.description.length <= 500 && role.icon.length <= 40);
    }
  });

  test("Viewer reads, Editor edits, Admin has full access to the money books, SuperAdmin owns the rest", () => {
    for (const m of ["revenue", "expense", "handover", "bills", "companies", "payroll"]) {
      assert.equal(levelOf("viewer", m), "view", `viewer ${m}`);
      assert.equal(levelOf("editor", m), "edit", `editor ${m}`);
      assert.equal(levelOf("admin", m), "full", `admin ${m}`);
      assert.equal(levelOf("super_admin", m), "full", `super_admin ${m}`);
    }
    assert.equal(levelOf("viewer", "dashboard"), "view");
    assert.equal(levelOf("viewer", "reports"), "view");
    assert.equal(levelOf("admin", "users"), "full");
    assert.equal(levelOf("admin", "access"), "view");
    assert.equal(levelOf("super_admin", "access"), "edit");
    assert.equal(levelOf("super_admin", "masters"), "edit");
    assert.equal(levelOf("editor", "users"), undefined);
    assert.equal(levelOf("viewer", "masters"), undefined);
    assert.equal(levelOf("admin", "masters"), undefined);
  });

  test("a role never has less than the role below it (the ladder is cumulative)", () => {
    const ladder = ["viewer", "editor", "admin", "super_admin"];
    for (let i = 1; i < ladder.length; i++) {
      for (const g of generated.grants.filter((x) => x.role === ladder[i - 1])) {
        const above = levelOf(ladder[i], g.permission);
        assert.ok(above !== undefined && RANK[above] >= RANK[g.level], `${ladder[i]} on ${g.permission}`);
      }
    }
  });

  test("abilities are on/off (level full) and only for the roles Pallav gives them to", () => {
    assert.deepEqual(keysOf("admin").filter((k) => source.abilities.some((a) => a.key === k)).sort(), ["system.backdate", "users.activity", "users.password"]);
    assert.deepEqual(keysOf("super_admin").filter((k) => source.abilities.some((a) => a.key === k)).sort(), ["system.backdate", "system.force", "users.activity", "users.password", "users.set-password", "website.secrets"]);
    for (const ability of source.abilities) {
      for (const role of ["viewer", "editor"]) assert.equal(levelOf(role, ability.key), undefined, `${role} ${ability.key}`);
      for (const g of generated.grants.filter((x) => x.permission === ability.key)) assert.equal(g.level, "full");
    }
  });

  test("only SuperAdmin gets Front Office and Website, part by part, as Pallav's two follow-up migrations do", () => {
    for (const role of ["viewer", "editor", "admin"]) assert.equal(keysOf(role).filter((k) => k.startsWith("pms") || k.startsWith("website")).length, 0, role);
    const parts = source.modules.filter((m) => m.key === "pms" || m.key === "website").flatMap((m) => m.parts.map((p) => p.key));
    assert.equal(parts.length, 11);
    for (const part of parts) assert.ok(levelOf("super_admin", part), part);
    assert.equal(levelOf("super_admin", "pms.stays"), "full");
    assert.equal(levelOf("super_admin", "pms.reservations"), "full");
    assert.equal(levelOf("super_admin", "pms.board"), "full");
    assert.equal(levelOf("super_admin", "website.enquiries"), "full");
    assert.equal(levelOf("super_admin", "website.settings"), "full");
  });

  test("module-level grants cover their parts, so no part rows are written for Viewer, Editor or Admin", () => {
    for (const role of ["viewer", "editor", "admin"]) assert.equal(keysOf(role).filter((k) => k.includes(".") && !source.abilities.some((a) => a.key === k)).length, 0, role);
  });

  test("portal roles hold no module permissions", () => {
    assert.deepEqual(keysOf("guest"), []);
    assert.deepEqual(keysOf("corporate"), []);
  });

  test("row counts per role (so a generator change is noticed)", () => {
    assert.deepEqual(["viewer", "editor", "admin", "super_admin"].map((r) => keysOf(r).length), [8, 8, 13, 30]);
    assert.equal(generated.grants.length, 59);
  });

  test("a grant naming something that is not in Pallav's list is refused", () => {
    const broken = { ...source, modules: source.modules.filter((m) => m.key !== "payroll") };
    assert.throws(() => generate(broken), /not in Pallav's permission list/);
  });
});

describe("where Pallav's per-action grid does not fit the four levels (for the master to rule on)", () => {
  const kinds = (kind: string): string[] => [...new Set(generated.misfits.filter((m) => m.kind === kind).map((m) => `${m.role}:${m.permission}`))];

  test("export (PDF) is folded into the level on six modules", () => {
    const modules = new Set(generated.misfits.filter((m) => m.kind === "export-folded").map((m) => m.permission));
    assert.deepEqual([...modules].sort(), ["bills", "expense", "handover", "payroll", "reports", "revenue"]);
    assert.equal(kinds("export-folded").length, 24);
  });

  test("four parts hold everything they offer but offer no delete: stored as full (R2), the service caps the effective level", () => {
    assert.deepEqual(kinds("no-delete-offered").sort(), ["super_admin:pms.board", "super_admin:pms.reservations", "super_admin:website.calendar", "super_admin:website.settings"]);
  });

  test("parts that offer fewer actions than their module's level are capped by what they offer", () => {
    assert.equal(kinds("inherited-subset").length, 31);
    assert.ok(kinds("inherited-subset").includes("editor:bills.debit-bills"));
    assert.ok(kinds("inherited-subset").includes("admin:payroll.salary-slip"));
  });
});
