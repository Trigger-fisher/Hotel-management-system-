import "server-only";
import { DEMO_REQUEST_STATUSES, type DemoRequestStatus } from "@shared/dashboards/demoRequests";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createDemoRequestService, type DemoRequestPorts, type DemoRequestRow, type DemoRequestService } from "../services/platform/demoRequests";
import { getPlatformConsoleUnit } from "./platform";

// The composition of the website's demo requests (platform 0169): the rows in platform.demo_requests, or an in-memory list without a database.

async function query(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = await getDatabase().pool.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

const COLUMNS = "id, name, email, phone, hotel_name, city, rooms, properties, message, status, handled_by_name, handled_at, created_at";
const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const rowOf = (r: Record<string, unknown>): DemoRequestRow => ({
  id: String(r.id),
  name: String(r.name),
  email: String(r.email),
  phone: s(r.phone),
  hotelName: String(r.hotel_name),
  city: s(r.city),
  rooms: n(r.rooms),
  properties: n(r.properties),
  message: s(r.message),
  status: DEMO_REQUEST_STATUSES.includes(r.status as DemoRequestStatus) ? (r.status as DemoRequestStatus) : "new",
  handledByName: s(r.handled_by_name),
  handledAt: r.handled_at ? new Date(r.handled_at as string) : null,
  createdAt: new Date(r.created_at as string),
});
const emptyCounts = (): Record<DemoRequestStatus, number> => ({ new: 0, contacted: 0, closed: 0 });

/** The rows in PostgreSQL (exported for the database check). */
export function pgDemoRequestPorts(): DemoRequestPorts {
  return {
    async add(r) {
      await query("INSERT INTO platform.demo_requests (name, email, phone, hotel_name, city, rooms, properties, message) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
        r.name, r.email, r.phone, r.hotelName, r.city, r.rooms, r.properties, r.message,
      ]);
    },
    async list({ status, page, pageSize }) {
      const [items, counts] = await Promise.all([
        query(`SELECT ${COLUMNS}, count(*) OVER () AS total FROM platform.demo_requests WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [status, pageSize, (page - 1) * pageSize]),
        query("SELECT status, count(*)::int AS n FROM platform.demo_requests GROUP BY status", []),
      ]);
      const c = emptyCounts();
      for (const r of counts) if (DEMO_REQUEST_STATUSES.includes(r.status as DemoRequestStatus)) c[r.status as DemoRequestStatus] = Number(r.n);
      return { items: items.map(rowOf), total: items[0] ? Number(items[0].total) : 0, counts: c };
    },
    async get(id) {
      const rows = await query(`SELECT ${COLUMNS} FROM platform.demo_requests WHERE id = $1`, [id]);
      return rows[0] ? rowOf(rows[0]) : null;
    },
    async setStatus(id, status, by, at) {
      const rows = await query(`UPDATE platform.demo_requests SET status = $2, handled_by = $3::uuid, handled_by_name = $4, handled_at = $5 WHERE id = $1 RETURNING ${COLUMNS}`, [
        id, status, /^[0-9a-f-]{36}$/i.test(by.userId) ? by.userId : null, by.name.slice(0, 120), at,
      ]);
      return rows[0] ? rowOf(rows[0]) : null;
    },
  };
}

/** The in-memory list (no database): the same rules, kept for this process only. */
export function memoryDemoRequestPorts(): DemoRequestPorts & { rows: DemoRequestRow[] } {
  const rows: DemoRequestRow[] = [];
  return {
    rows,
    async add(r) {
      rows.unshift({ ...r, id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`, status: "new", handledByName: null, handledAt: null, createdAt: new Date() });
    },
    async list({ status, page, pageSize }) {
      const all = status ? rows.filter((r) => r.status === status) : rows;
      const c = emptyCounts();
      for (const r of rows) c[r.status] += 1;
      return { items: all.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r })), total: all.length, counts: c };
    },
    async get(id) {
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async setStatus(id, status, by, at) {
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, { status, handledByName: by.name, handledAt: at });
      return { ...r };
    },
  };
}

let service: DemoRequestService | null = null;

export function getDemoRequests(): DemoRequestService {
  if (service) return service;
  service = createDemoRequestService({ unit: getPlatformConsoleUnit(), now: () => new Date(), ports: getConfig().DATABASE_URL ? pgDemoRequestPorts() : memoryDemoRequestPorts() });
  return service;
}

/** Replaces the service (tests). */
export function configureDemoRequests(next: DemoRequestService | null): void {
  service = next;
}
