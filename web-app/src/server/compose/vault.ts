import "server-only";
import { hkdfSync, randomBytes, randomUUID } from "node:crypto";
import type { VaultKind } from "@shared/dashboards/vault";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { parseHashKey } from "../crypto/hash";
import { createVaultService, type VaultPorts, type VaultRow, type VaultService } from "../services/vault/vaultService";
import { getPlatformConsoleUnit } from "./platform";

// The composition of the vault (platform 0168): the items in platform.vault_items (an in-memory store without a database), the Super Admin check and the audit through the platform
// console's unit, and the vault key. The key is DERIVED from the server secret HMS_HASH_KEY (HKDF-SHA-256, info "hms-vault-v1", 32 bytes): nothing extra to set up, separate from the
// mail key (a different purpose gives a different key), the same on every start. Changing HMS_HASH_KEY makes the stored secrets unreadable, so it is never rotated without re-saving them.
export const VAULT_KEY_INFO = "hms-vault-v1";

export function deriveVaultKey(hashKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", hashKey, Buffer.alloc(0), VAULT_KEY_INFO, 32));
}

async function query(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = await getDatabase().pool.connect();
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

const t = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const COLUMNS = "id, hotel_id, kind, title, username, url, secret, notes, expires_on, updated_at, updated_by_name";
const rowOf = (r: Record<string, unknown>): VaultRow => ({
  id: String(r.id), hotelId: t(r.hotel_id), kind: r.kind as VaultKind, title: String(r.title), username: t(r.username), url: t(r.url), secret: t(r.secret), notes: t(r.notes),
  expiresOn: r.expires_on instanceof Date ? r.expires_on.toISOString().slice(0, 10) : t(r.expires_on), updatedAt: new Date(r.updated_at as string), updatedByName: t(r.updated_by_name),
});
// the Central Vault is hotel_id NULL: "IS NOT DISTINCT FROM" matches both
const OWNER = "hotel_id IS NOT DISTINCT FROM $1::uuid AND deleted_at IS NULL";

/** The items in PostgreSQL (exported for the database check). */
export function pgVaultPorts(): VaultPorts {
  return {
    async list(hotelId) {
      return (await query(`SELECT ${COLUMNS} FROM platform.vault_items WHERE ${OWNER} ORDER BY updated_at DESC LIMIT 500`, [hotelId])).map(rowOf);
    },
    async get(hotelId, id) {
      const rows = await query(`SELECT ${COLUMNS} FROM platform.vault_items WHERE ${OWNER} AND id = $2::uuid`, [hotelId, id]);
      return rows[0] ? rowOf(rows[0]) : null;
    },
    async insert(r, by) {
      const rows = await query(
        `INSERT INTO platform.vault_items (id, hotel_id, kind, title, username, url, secret, notes, expires_on, created_by, updated_by, updated_by_name)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::date, $10::uuid, $10::uuid, $11) RETURNING ${COLUMNS}`,
        [r.id, r.hotelId, r.kind, r.title, r.username, r.url, r.secret, r.notes, r.expiresOn, by, r.updatedByName?.slice(0, 120) ?? null],
      );
      return rowOf(rows[0] as Record<string, unknown>);
    },
    async update(r, by) {
      const rows = await query(
        `UPDATE platform.vault_items SET kind = $3, title = $4, username = $5, url = $6, secret = $7, notes = $8, expires_on = $9::date, updated_by = $10::uuid, updated_by_name = $11
         WHERE ${OWNER} AND id = $2::uuid RETURNING ${COLUMNS}`,
        [r.hotelId, r.id, r.kind, r.title, r.username, r.url, r.secret, r.notes, r.expiresOn, by, r.updatedByName?.slice(0, 120) ?? null],
      );
      return rows[0] ? rowOf(rows[0]) : null;
    },
    async remove(hotelId, id, by) {
      const rows = await query(`UPDATE platform.vault_items SET deleted_at = now(), updated_by = $3::uuid WHERE ${OWNER} AND id = $2::uuid RETURNING id`, [hotelId, id, by]);
      return rows.length > 0;
    },
  };
}

/** The in-memory store (no database, tests): the same rules, for this process only. */
export function memoryVaultPorts(now: () => Date = () => new Date()): VaultPorts & { rows: Map<string, VaultRow & { deleted: boolean }> } {
  const rows = new Map<string, VaultRow & { deleted: boolean }>();
  const live = (hotelId: string | null, id: string) => {
    const r = rows.get(id);
    return r && !r.deleted && r.hotelId === hotelId ? r : null;
  };
  return {
    rows,
    async list(hotelId) {
      return [...rows.values()]
        .filter((r) => !r.deleted && r.hotelId === hotelId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((r): VaultRow => ({ id: r.id, hotelId: r.hotelId, kind: r.kind, title: r.title, username: r.username, url: r.url, secret: r.secret, notes: r.notes, expiresOn: r.expiresOn, updatedAt: r.updatedAt, updatedByName: r.updatedByName }));
    },
    async get(hotelId, id) {
      const r = live(hotelId, id);
      return r ? { ...r } : null;
    },
    async insert(r) {
      const row = { ...r, updatedAt: now(), deleted: false };
      rows.set(r.id, row);
      return { ...r, updatedAt: row.updatedAt };
    },
    async update(r) {
      if (!live(r.hotelId, r.id)) return null;
      const row = { ...r, updatedAt: now(), deleted: false };
      rows.set(r.id, row);
      return { ...r, updatedAt: row.updatedAt };
    },
    async remove(hotelId, id) {
      const r = live(hotelId, id);
      if (!r) return false;
      r.deleted = true;
      return true;
    },
  };
}

let service: VaultService | null = null;

export function getVault(): VaultService {
  if (service) return service;
  const config = getConfig();
  const pg = Boolean(config.DATABASE_URL && config.HMS_HASH_KEY);
  const key = config.HMS_HASH_KEY ? deriveVaultKey(parseHashKey(config.HMS_HASH_KEY)) : pg ? null : randomBytes(32);
  service = createVaultService({ unit: getPlatformConsoleUnit(), now: () => new Date(), ports: pg ? pgVaultPorts() : memoryVaultPorts(), key, newId: randomUUID });
  return service;
}

/** Replaces the service (tests). */
export function configureVault(next: VaultService | null): void {
  service = next;
}
