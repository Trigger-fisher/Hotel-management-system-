// DEMO hotels (MJ, 1 Nov 2026: "add mock data also for few hotels"): a few clearly named sample hotels with a small working set of data, so every screen has something to show
// on a fresh database. Two real groups (each with a Group Hotel Admin) and two individual hotels, every hotel with its own Hotel Admin. Everything is named "Demo" / "(Demo)".
// The data is the speed-check generator (perf-hotel.ts) at a small size: plain SQL with generate_series, deterministic, amounts in paise.
// Refuses to run on a database that already holds a real (non-demo) hotel, so sample data can never land in live data. Running it twice adds nothing new.
import { createHotel, type CreatedHotel } from "./create-hotel";
import { createUser } from "./create-user";
import type { MigrationFile } from "./migrate";
import type { DbClient } from "./pg-db";
import { perfDataStatements } from "./perf-hotel";

export interface DemoHotel {
  name: string;
  slug: string;
  /** slug of its group; absent = an individual hotel */
  group?: string;
  /** 1 = the base size */
  scale: number;
}
export interface DemoGroup {
  name: string;
  slug: string;
  adminUsername: string;
}

export const DEMO_GROUPS: readonly DemoGroup[] = [
  { name: "Sunrise Group (Demo)", slug: "demo-sunrise-group", adminUsername: "demo.sunrise.group" },
  { name: "Lake Group (Demo)", slug: "demo-lake-group", adminUsername: "demo.lake.group" },
];

export const DEMO_HOTELS: readonly DemoHotel[] = [
  { name: "Sunrise Goa (Demo)", slug: "demo-sunrise-goa", group: "demo-sunrise-group", scale: 2 },
  { name: "Sunrise Pune (Demo)", slug: "demo-sunrise-pune", group: "demo-sunrise-group", scale: 1 },
  { name: "Sunrise Jaipur (Demo)", slug: "demo-sunrise-jaipur", group: "demo-sunrise-group", scale: 1 },
  { name: "Lake Udaipur (Demo)", slug: "demo-lake-udaipur", group: "demo-lake-group", scale: 2 },
  { name: "Lake Bhopal (Demo)", slug: "demo-lake-bhopal", group: "demo-lake-group", scale: 1 },
  { name: "Hotel Anand (Demo)", slug: "demo-hotel-anand", scale: 1 },
  { name: "Hotel Meera (Demo)", slug: "demo-hotel-meera", scale: 1 },
];

/** The data of one demo hotel: the perf-hotel statements with the row counts cut down (and the references that depend on them kept in step). */
export function demoDataStatements(userId: string, scale: number): string[] {
  const n = (base: number): number => Math.max(1, Math.round(base * scale));
  const companies = n(6);
  const customers = n(40);
  return perfDataStatements(userId).map((sql) =>
    sql
      .replaceAll("generate_series(1, 20) n", `generate_series(1, ${companies}) n`)
      .replaceAll("k = n % 20", `k = n % ${companies}`)
      .replaceAll("generate_series(1, 800) n", `generate_series(1, ${customers}) n`)
      .replaceAll("n % 800 + 1", `n % ${customers} + 1`)
      .replaceAll("generate_series(1, 1500) n", `generate_series(1, ${n(25)}) n`)
      .replaceAll("generate_series(1, 2000) n", `generate_series(1, ${n(30)}) n`)
      .replaceAll("generate_series(1, 1000) n", `generate_series(1, ${n(20)}) n`)
      .replaceAll("generate_series(1, 600) n", `generate_series(1, ${n(12)}) n`)
      .replaceAll("generate_series(1, 400) n", `generate_series(1, ${n(12)}) n`)
      .replaceAll("PERF", "DEMO"),
  );
}

export interface DemoDeps {
  owner: DbClient;
  hotelMigrations: readonly MigrationFile[];
  hotelSeeds: readonly MigrationFile[];
  searchPathExtra?: string;
  /** a new temporary password and its hash */
  newPassword(): Promise<{ plain: string; hash: string }>;
  /** the account and its password go to a git-ignored file, never to the screen */
  saveLogin(username: string, password: string): void;
  say(message: string): void;
}

export interface DemoSummary {
  hotelsCreated: number;
  hotelsSkipped: number;
  groupsCreated: number;
  accountsCreated: number;
}

async function activeAccount(owner: DbClient, username: string, displayName: string, accountRole: string, hotelSlug: string | undefined, deps: DemoDeps): Promise<string> {
  const { plain, hash } = await deps.newPassword();
  const id = await createUser(owner, { username, displayName, email: `${username}@example.test`, accountRole, roleKey: "admin", hotelSlug }, hash);
  // a usable password for a sample account: no first-change step
  await owner.query("UPDATE platform.logins SET must_change_password = false, status = 'active', password_changed_at = now() WHERE id = $1", [id]);
  deps.saveLogin(username, plain);
  return id;
}

export async function createDemoHotels(deps: DemoDeps): Promise<DemoSummary> {
  const { owner } = deps;
  const real = Number((await owner.query("SELECT count(*)::int AS n FROM platform.hotels WHERE slug NOT LIKE 'demo-%' AND deleted_at IS NULL")).rows[0]?.n ?? 0);
  if (real > 0) throw new Error("This database already holds a real hotel; demo hotels are only added to an empty database");
  const summary: DemoSummary = { hotelsCreated: 0, hotelsSkipped: 0, groupsCreated: 0, accountsCreated: 0 };

  const groupId = new Map<string, string>();
  for (const g of DEMO_GROUPS) {
    const found = (await owner.query("SELECT id FROM platform.hotel_groups WHERE slug = $1 AND deleted_at IS NULL", [g.slug])).rows[0] as { id: string } | undefined;
    if (found) {
      groupId.set(g.slug, found.id);
      continue;
    }
    const adminId = await activeAccount(owner, g.adminUsername, `${g.name} admin`, "group_hotel_admin", undefined, deps);
    const inserted = await owner.query("INSERT INTO platform.hotel_groups (name, slug, status, admin_user_id) VALUES ($1, $2, 'active', $3) RETURNING id", [g.name, g.slug, adminId]);
    groupId.set(g.slug, String(inserted.rows[0].id));
    summary.groupsCreated += 1;
    summary.accountsCreated += 1;
    deps.say(`Group ${g.name} made, with its Group Hotel Admin.`);
  }

  for (const h of DEMO_HOTELS) {
    const exists = (await owner.query("SELECT 1 AS x FROM platform.hotels WHERE slug = $1 AND deleted_at IS NULL", [h.slug])).rows.length > 0;
    if (exists) {
      summary.hotelsSkipped += 1;
      continue;
    }
    const created: CreatedHotel = await createHotel({ owner, hotelMigrations: deps.hotelMigrations, hotelSeeds: deps.hotelSeeds, report: () => undefined, searchPathExtra: deps.searchPathExtra }, { name: h.name, slug: h.slug });
    const adminId = await activeAccount(owner, `${h.slug}.admin`, `${h.name} admin`, "hotel_admin", h.slug, deps);
    summary.accountsCreated += 1;
    if (h.group) {
      const hotelRow = (await owner.query("SELECT id FROM platform.hotels WHERE slug = $1", [h.slug])).rows[0] as { id: string };
      await owner.query("INSERT INTO platform.group_members (group_id, hotel_id) VALUES ($1, $2)", [groupId.get(h.group), hotelRow.id]);
    }
    await owner.query("BEGIN");
    try {
      await owner.query(`SET LOCAL search_path TO "${created.schema}"`);
      for (const sql of demoDataStatements(adminId, h.scale)) await owner.query(sql);
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }
    summary.hotelsCreated += 1;
    deps.say(`Hotel ${h.name} made (${h.group ? "in its group" : "individual"}), with a Hotel Admin and sample data.`);
  }
  return summary;
}
