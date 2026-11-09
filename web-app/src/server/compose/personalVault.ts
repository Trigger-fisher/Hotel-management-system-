import "server-only";
import { hkdfSync, randomBytes, randomUUID } from "node:crypto";
import type { PersonalVaultKind } from "@shared/dashboards/personalVault";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { parseHashKey } from "../crypto/hash";
import { createPersonalVaultService, type PersonalVaultPorts, type PersonalVaultRow, type PersonalVaultService } from "../services/vault/personalVaultService";
import { getPlatformConsoleUnit } from "./platform";

// My vault (platform 0190): the owners' sealed data keys in platform.personal_vault_keys, the items in platform.personal_vault_items (in memory without a database). The master key is
// derived from HMS_HASH_KEY like the hotel vault's, with its own purpose ("hms-personal-vault-v1"), so the two never share a key.
export const PERSONAL_VAULT_KEY_INFO = "hms-personal-vault-v1";

export function derivePersonalVaultKey(hashKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", hashKey, Buffer.alloc(0), PERSONAL_VAULT_KEY_INFO, 32));
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
const COLUMNS = "id, owner_id, kind, title, username, url, secret, notes, expires_on, updated_at";
const rowOf = (r: Record<string, unknown>): PersonalVaultRow => ({
  id: String(r.id), ownerId: String(r.owner_id), kind: r.kind as PersonalVaultKind, title: String(r.title), username: t(r.username), url: t(r.url), secret: t(r.secret), notes: t(r.notes),
  expiresOn: r.expires_on instanceof Date ? r.expires_on.toISOString().slice(0, 10) : t(r.expires_on), updatedAt: new Date(r.updated_at as string),
});
const OWNER = "owner_id = $1::uuid AND deleted_at IS NULL";

export function pgPersonalVaultPorts(): PersonalVaultPorts {
  return {
    async wrappedKey(ownerId) {
      const rows = await query("SELECT wrapped_key FROM platform.personal_vault_keys WHERE owner_id = $1::uuid", [ownerId]);
      return rows[0] ? String(rows[0].wrapped_key) : null;
    },
    async keepWrappedKey(ownerId, wrapped) {
      await query("INSERT INTO platform.personal_vault_keys (owner_id, wrapped_key) VALUES ($1::uuid, $2) ON CONFLICT (owner_id) DO NOTHING", [ownerId, wrapped]);
      const rows = await query("SELECT wrapped_key FROM platform.personal_vault_keys WHERE owner_id = $1::uuid", [ownerId]);
      return String(rows[0]?.wrapped_key ?? wrapped);
    },
    async list(ownerId) {
      return (await query(`SELECT ${COLUMNS} FROM platform.personal_vault_items WHERE ${OWNER} ORDER BY updated_at DESC LIMIT 500`, [ownerId])).map(rowOf);
    },
    async get(ownerId, id) {
      const rows = await query(`SELECT ${COLUMNS} FROM platform.personal_vault_items WHERE ${OWNER} AND id = $2::uuid`, [ownerId, id]);
      return rows[0] ? rowOf(rows[0]) : null;
    },
    async insert(r) {
      const rows = await query(
        `INSERT INTO platform.personal_vault_items (id, owner_id, kind, title, username, url, secret, notes, expires_on)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::date) RETURNING ${COLUMNS}`,
        [r.id, r.ownerId, r.kind, r.title, r.username, r.url, r.secret, r.notes, r.expiresOn],
      );
      return rowOf(rows[0] as Record<string, unknown>);
    },
    async update(r) {
      const rows = await query(
        `UPDATE platform.personal_vault_items SET kind = $3, title = $4, username = $5, url = $6, secret = $7, notes = $8, expires_on = $9::date
         WHERE ${OWNER} AND id = $2::uuid RETURNING ${COLUMNS}`,
        [r.ownerId, r.id, r.kind, r.title, r.username, r.url, r.secret, r.notes, r.expiresOn],
      );
      return rows[0] ? rowOf(rows[0]) : null;
    },
    async remove(ownerId, id) {
      const rows = await query(`UPDATE platform.personal_vault_items SET deleted_at = now() WHERE ${OWNER} AND id = $2::uuid RETURNING id`, [ownerId, id]);
      return rows.length > 0;
    },
  };
}

/** The in-memory store (no database, tests): the same rules, for this process only. */
export function memoryPersonalVaultPorts(now: () => Date = () => new Date()): PersonalVaultPorts & { rows: Map<string, PersonalVaultRow & { deleted: boolean }>; keys: Map<string, string> } {
  const rows = new Map<string, PersonalVaultRow & { deleted: boolean }>();
  const keys = new Map<string, string>();
  const live = (ownerId: string, id: string) => {
    const r = rows.get(id);
    return r && !r.deleted && r.ownerId === ownerId ? r : null;
  };
  const plain = (r: PersonalVaultRow & { deleted: boolean }): PersonalVaultRow => ({ id: r.id, ownerId: r.ownerId, kind: r.kind, title: r.title, username: r.username, url: r.url, secret: r.secret, notes: r.notes, expiresOn: r.expiresOn, updatedAt: r.updatedAt });
  return {
    rows,
    keys,
    async wrappedKey(ownerId) {
      return keys.get(ownerId) ?? null;
    },
    async keepWrappedKey(ownerId, wrapped) {
      if (!keys.has(ownerId)) keys.set(ownerId, wrapped);
      return keys.get(ownerId) as string;
    },
    async list(ownerId) {
      return [...rows.values()].filter((r) => !r.deleted && r.ownerId === ownerId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(plain);
    },
    async get(ownerId, id) {
      const r = live(ownerId, id);
      return r ? plain(r) : null;
    },
    async insert(r) {
      const row = { ...r, updatedAt: now(), deleted: false };
      rows.set(r.id, row);
      return plain(row);
    },
    async update(r) {
      if (!live(r.ownerId, r.id)) return null;
      const row = { ...r, updatedAt: now(), deleted: false };
      rows.set(r.id, row);
      return plain(row);
    },
    async remove(ownerId, id) {
      const r = live(ownerId, id);
      if (!r) return false;
      r.deleted = true;
      return true;
    },
  };
}

let service: PersonalVaultService | null = null;

export function getPersonalVault(): PersonalVaultService {
  if (service) return service;
  const config = getConfig();
  const pg = Boolean(config.DATABASE_URL && config.HMS_HASH_KEY);
  const key = config.HMS_HASH_KEY ? derivePersonalVaultKey(parseHashKey(config.HMS_HASH_KEY)) : pg ? null : randomBytes(32);
  service = createPersonalVaultService({ unit: getPlatformConsoleUnit(), now: () => new Date(), ports: pg ? pgPersonalVaultPorts() : memoryPersonalVaultPorts(), key, newId: randomUUID });
  return service;
}

/** Replaces the service (tests). */
export function configurePersonalVault(next: PersonalVaultService | null): void {
  service = next;
}
