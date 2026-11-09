// Generates db/seeds/platform/0001_permissions.sql and 0002_roles.sql from Pallav's own data, so the seed is Pallav's list
// and Pallav's role grants, mapped onto MJ's four access levels by a rule that can be read and tested.
//   Write the files:   npx tsx db/scripts/generate-platform-seeds.ts
//   Check for drift:   npx tsx db/scripts/generate-platform-seeds.ts --check      (also run by tests/server/seeds.test.ts)
//
// Sources
//   db/seeds/source/pallav-permissions.json   exported by db/scripts/php/export-permissions.php from app/Support/Permissions.php
//   ROLE_GRANTS below                         copied from Pallav's migration 2026_09_20_200000_create_roles_and_permissions.php
//                                             (seedRoles) plus 2026_10_05_100001 (the top role gets every website.*) and
//                                             2026_10_06_100001 (the top role gets every pms.*)
//
// The four levels (MJ): view = View Only, create = View & Create, edit = View & Edit, full = Full Access.
// Level rule for one role on one module or part: the highest rank among the actions the role holds, where
//   view = 1, create = 2, edit = 3, delete = 4 (full). "export" (PDF/print) never raises the level: it is folded into view.
// A part that a role holds in full (every action the part offers) is stored as full even when the part has no delete (R2).
// A role that holds a module holds all its parts (Pallav: "a module's own permission stands for all of it"), so parts get a
// row only when a role was given that part on its own (Pallav's top role, for pms.* and website.*).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Level = "view" | "create" | "edit" | "full";
const RANK: Record<string, number> = { view: 1, create: 2, edit: 3, delete: 4 };
const LEVEL_BY_RANK: Record<number, Level> = { 1: "view", 2: "create", 3: "edit", 4: "full" };

interface PermissionItem {
  key: string;
  label: string;
  about: string | null;
  icon: string | null;
  actions: string[];
}
interface PartItem extends PermissionItem {
  section: string | null;
}
interface ModuleItem extends PermissionItem {
  group: string | null;
  parts: PartItem[];
}
interface AbilityItem {
  key: string;
  label: string;
  about: string | null;
  icon: string | null;
  sensitive: boolean;
}
export interface PermissionSource {
  source: string;
  modules: ModuleItem[];
  abilities: AbilityItem[];
}

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  icon: string;
  accent: string;
  level: number;
  inherits: boolean;
  /** Permission strings Pallav grants this role ITSELF (before inheriting the roles below it). */
  grants: string[];
  /** Everything starting with these prefixes (Pallav's top role is given every website.* and pms.* permission). */
  grantPrefixes?: string[];
}

/** Pallav's four roles, in ladder order. Each inherits everything below it. Copied verbatim from its seedRoles(). */
export const ROLE_GRANTS: readonly RoleSeed[] = [
  {
    key: "viewer", name: "Viewer", level: 1, icon: "bi-eye", accent: "#64748B", inherits: true,
    description: "Reads every screen and report, and changes nothing.",
    grants: [
      "dashboard.view", "revenue.view", "revenue.export", "expense.view", "expense.export", "handover.view", "handover.export",
      "bills.view", "bills.export", "companies.view", "payroll.view", "payroll.export", "reports.view", "reports.export",
    ],
  },
  {
    key: "editor", name: "Editor", level: 2, icon: "bi-pencil-square", accent: "#0F766E", inherits: true,
    description: "Records the day's work and corrects it. Cannot delete or manage accounts.",
    grants: [
      "revenue.create", "revenue.edit", "expense.create", "expense.edit", "handover.create", "handover.edit",
      "bills.create", "bills.edit", "companies.create", "companies.edit", "payroll.create", "payroll.edit",
    ],
  },
  {
    key: "admin", name: "Admin", level: 3, icon: "bi-person-gear", accent: "#B45309", inherits: true,
    description: "Runs the day to day. Deletes records, manages Editors and Viewers.",
    grants: [
      "revenue.delete", "expense.delete", "handover.delete", "bills.delete", "companies.delete", "payroll.delete",
      "users.view", "users.create", "users.edit", "users.delete", "users.password", "users.activity", "access.view", "system.backdate",
    ],
  },
  {
    key: "super_admin", name: "SuperAdmin", level: 4, icon: "bi-shield-fill-check", accent: "#6D28D9", inherits: true,
    description: "Owns the system. The only role that can change roles, Master Data and force mode.",
    grants: ["access.edit", "masters.view", "masters.edit", "system.force", "users.set-password"],
    grantPrefixes: ["website.", "pms."],
  },
];

/** The portal roles. They get no Pallav module permissions: portal screens are scoped to the person's own company or booking. */
export const PORTAL_ROLES: readonly RoleSeed[] = [
  { key: "guest", name: "Guest", level: 1, icon: "bi-person", accent: "#64748B", inherits: false, description: "A hotel guest using the guest portal. Sees only their own bookings, bills and advances.", grants: [] },
  { key: "corporate", name: "Corporate", level: 1, icon: "bi-buildings", accent: "#64748B", inherits: false, description: "A company's contact using the corporate portal. Sees only their own company's bookings, bills and ledger.", grants: [] },
];

export interface RoleGrant {
  role: string;
  permission: string;
  level: Level;
  held: string[];
  offered: string[];
}

export interface Misfit {
  role: string;
  permission: string;
  kind: "export-folded" | "inherited-subset" | "no-delete-offered";
  note: string;
}

export interface Generated {
  permissionsSql: string;
  rolesSql: string;
  grants: RoleGrant[];
  misfits: Misfit[];
}

const sqlText = (value: string | null): string => (value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`);

function allPermissionStrings(source: PermissionSource): string[] {
  const all: string[] = [];
  for (const m of source.modules) {
    for (const a of m.actions) all.push(`${m.key}.${a}`);
    for (const p of m.parts) for (const a of p.actions) all.push(`${p.key}.${a}`);
  }
  for (const ability of source.abilities) all.push(ability.key);
  return all;
}

/** Every permission string a role holds: its own grants plus those of the roles below it (the ladder is cumulative). */
function effectiveStrings(source: PermissionSource, role: RoleSeed, ladder: readonly RoleSeed[]): Set<string> {
  const held = new Set<string>();
  const all = allPermissionStrings(source);
  for (const r of ladder) {
    if (r.level > role.level) continue;
    r.grants.forEach((g) => held.add(g));
    for (const prefix of r.grantPrefixes ?? []) all.filter((p) => p.startsWith(prefix)).forEach((p) => held.add(p));
  }
  return held;
}

function levelFor(held: readonly string[]): Level | null {
  const ranks = held.map((a) => RANK[a]).filter((r): r is number => r !== undefined);
  if (ranks.length === 0) return null;
  return LEVEL_BY_RANK[Math.max(...ranks)];
}

export function generate(source: PermissionSource): Generated {
  const grants: RoleGrant[] = [];
  const misfits: Misfit[] = [];
  const abilityKeys = new Set(source.abilities.map((a) => a.key));
  const known = new Set(allPermissionStrings(source));

  for (const role of ROLE_GRANTS) {
    for (const g of role.grants) if (!known.has(g)) throw new Error(`Role ${role.key} grants ${g}, which is not in Pallav's permission list`);
  }

  for (const role of ROLE_GRANTS) {
    const strings = effectiveStrings(source, role, ROLE_GRANTS);
    for (const m of source.modules) {
      // module row
      const moduleHeld = m.actions.filter((a) => strings.has(`${m.key}.${a}`));
      const moduleLevel = levelFor(moduleHeld);
      if (moduleLevel) {
        grants.push({ role: role.key, permission: m.key, level: moduleLevel, held: moduleHeld, offered: m.actions });
        if (moduleHeld.includes("export")) {
          misfits.push({ role: role.key, permission: m.key, kind: "export-folded", note: `holds ${moduleHeld.join("+")}: export (PDF) is folded into ${moduleLevel}` });
        }
      }
      // part rows: only where the role was given the part on its own (Pallav's top role, for pms.* and website.*)
      for (const p of m.parts) {
        const direct = p.actions.filter((a) => strings.has(`${p.key}.${a}`));
        const viaModule = p.actions.filter((a) => strings.has(`${m.key}.${a}`));
        if (direct.length === 0) {
          // the module covers this part; note when the part offers less than the module level
          const effective = levelFor(viaModule);
          if (moduleLevel && effective !== moduleLevel) {
            misfits.push({ role: role.key, permission: p.key, kind: "inherited-subset", note: `module level ${moduleLevel}, but the part only offers ${p.actions.join("+")}: effective ${effective ?? "none"}` });
          }
          continue;
        }
        const held = [...new Set([...direct, ...viaModule])];
        // R2 (master): a role that holds EVERY action a part offers gets the part at full, even when the part offers no delete.
        // The service works out the effective level as min(role's level, the highest level the part offers).
        const holdsAll = p.actions.every((a) => held.includes(a));
        const partLevel = holdsAll ? "full" : levelFor(held);
        if (!partLevel) continue;
        grants.push({ role: role.key, permission: p.key, level: partLevel, held, offered: p.actions });
        if (held.includes("export")) misfits.push({ role: role.key, permission: p.key, kind: "export-folded", note: `holds ${held.join("+")}: export (PDF) is folded into ${partLevel}` });
        if (holdsAll && !p.actions.includes("delete")) {
          misfits.push({ role: role.key, permission: p.key, kind: "no-delete-offered", note: `holds everything the part offers (${p.actions.join("+")}), which has no delete: stored as full (R2); effective level = min(full, highest the part offers)` });
        }
      }
    }
    for (const key of abilityKeys) {
      if (strings.has(key)) grants.push({ role: role.key, permission: key, level: "full", held: [key], offered: [key] });
    }
  }

  // Each role's rows only list what the role holds ITSELF OR via the ladder; the ladder is already folded in above, so the
  // seed lists the full effective grant for every role (no reliance on `inherits` at read time).

  const permissionRows: string[] = [];
  const partRows: string[] = [];
  let sort = 0;
  for (const m of source.modules) {
    permissionRows.push(`  (${[`'${m.key}'`, "'module'", sqlText(m.label), sqlText(m.about), sqlText(m.group), "NULL", sqlText(m.icon), "false", String((sort += 10))].join(", ")})`);
    for (const p of m.parts) partRows.push(`  (${[`'${p.key}'`, `'${m.key}'`, sqlText(p.label), sqlText(p.about), sqlText(m.group), sqlText(p.section), sqlText(p.icon), "false", String((sort += 10))].join(", ")})`);
  }
  for (const a of source.abilities) {
    permissionRows.push(`  (${[`'${a.key}'`, "'ability'", sqlText(a.label), sqlText(a.about), "NULL", "NULL", sqlText(a.icon), String(a.sensitive), String((sort += 10))].join(", ")})`);
  }

  const moduleCount = source.modules.length;
  const partCount = source.modules.reduce((n, m) => n + m.parts.length, 0);
  const permissionsSql = `-- seed: Pallav's permission list (${moduleCount} modules, ${partCount} parts, ${source.abilities.length} abilities), exported from app/Support/Permissions.php
-- GENERATED by db/scripts/generate-platform-seeds.ts from db/seeds/source/pallav-permissions.json. Do not edit by hand:
-- change the generator or the source and add a NEW seed file; an applied seed file is immutable.

-- modules and one-off abilities (no parent)
INSERT INTO platform.permissions (key, kind, label, about, group_name, section, icon, sensitive, sort_order)
VALUES
${permissionRows.join(",\n")}
ON CONFLICT (key) DO NOTHING;

-- parts of a module (the parent is looked up by key)
INSERT INTO platform.permissions (key, kind, parent_id, label, about, group_name, section, icon, sensitive, sort_order)
SELECT v.key, 'part', parent.id, v.label, v.about, v.group_name, v.section, v.icon, v.sensitive, v.sort_order
FROM (VALUES
${partRows.join(",\n")}
) AS v (key, parent_key, label, about, group_name, section, icon, sensitive, sort_order)
JOIN platform.permissions parent ON parent.key = v.parent_key
ON CONFLICT (key) DO NOTHING;
`;

  const roles = [...ROLE_GRANTS, ...PORTAL_ROLES];
  const roleRows = roles.map((r) => `  (${[`'${r.key}'`, sqlText(r.name), sqlText(r.description), sqlText(r.icon), sqlText(r.accent), String(r.level), String(r.inherits)].join(", ")})`);
  const grantRows = grants.map((g) => `  ('${g.role}', '${g.permission}', '${g.level}')`);
  const rolesSql = `-- seed: Pallav's four roles (viewer, editor, admin, super_admin) and the two portal roles (guest, corporate), with each role's grants on MJ's four levels
-- GENERATED by db/scripts/generate-platform-seeds.ts. Level rule: the highest of view < create < edit < delete(full) a role holds;
-- export (PDF) is folded into the level. Each row below is the role's FULL effective grant (the ladder is already included).
-- Built-in roles belong to no hotel (hotel_id NULL).

INSERT INTO platform.roles (key, name, description, icon, accent, level, inherits, is_system)
SELECT v.key, v.name, v.description, v.icon, v.accent, v.level, v.inherits, true
FROM (VALUES
${roleRows.join(",\n")}
) AS v (key, name, description, icon, accent, level, inherits)
ON CONFLICT (key) WHERE hotel_id IS NULL DO NOTHING;

INSERT INTO platform.role_permissions (role_id, permission_id, level)
SELECT r.id, p.id, v.level
FROM (VALUES
${grantRows.join(",\n")}
) AS v (role_key, permission_key, level)
JOIN platform.roles r ON r.key = v.role_key AND r.hotel_id IS NULL
JOIN platform.permissions p ON p.key = v.permission_key
ON CONFLICT (role_id, permission_id) DO NOTHING;
`;

  return { permissionsSql, rolesSql, grants, misfits };
}

const root = path.join(__dirname, "..");
export const SOURCE_PATH = path.join(root, "seeds", "source", "pallav-permissions.json");
export const OUTPUT_FILES = {
  permissions: path.join(root, "seeds", "platform", "0001_permissions.sql"),
  roles: path.join(root, "seeds", "platform", "0002_roles.sql"),
};

export function loadSource(): PermissionSource {
  return JSON.parse(readFileSync(SOURCE_PATH, "utf8")) as PermissionSource;
}

if (require.main === module) {
  const generated = generate(loadSource());
  if (process.argv.includes("--check")) {
    const current = { permissions: readFileSync(OUTPUT_FILES.permissions, "utf8"), roles: readFileSync(OUTPUT_FILES.roles, "utf8") };
    const same = current.permissions === generated.permissionsSql && current.roles === generated.rolesSql;
    process.stdout.write(same ? "Seeds are up to date\n" : "Seeds are OUT OF DATE: run npx tsx db/scripts/generate-platform-seeds.ts\n");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUTPUT_FILES.permissions, generated.permissionsSql);
  writeFileSync(OUTPUT_FILES.roles, generated.rolesSql);
  process.stdout.write(`Wrote ${OUTPUT_FILES.permissions}\nWrote ${OUTPUT_FILES.roles}\n${generated.misfits.length} level notes (see tests/server/seeds.test.ts)\n`);
}
