import "server-only";
import { VAULT_KINDS, vaultCopy, type VaultInput, type VaultItem, type VaultKind, type VaultSecret } from "@shared/dashboards/vault";
import { assertRechecked } from "../../auth/recheck";
import type { VerifiedSession } from "../../auth/session";
import { open, seal } from "../../crypto/secretBox";
import { AppError } from "../../errors";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import { createGate, type AuditInput, type PlatformMeta } from "../platform/access";

// The vault (MJ, 2 Nov 2026; platform 0168): a hotel's important things kept by the Super Admin in the hotel's profile. The secret and the private notes are sealed here before they
// are stored (AES-256-GCM, crypto/secretBox.ts) with the vault key, bound to the hotel, the item and the field, and opened only by Show. Super Admin only; every add, change, Show and
// removal is written to the platform audit log under the hotel (its Activity tab). A removed item is only marked removed.

/** One row as stored: the secret and the notes still sealed. */
export interface VaultRow {
  id: string;
  hotelId: string | null;
  kind: VaultKind;
  title: string;
  username: string | null;
  url: string | null;
  secret: string | null;
  notes: string | null;
  expiresOn: string | null;
  updatedAt: Date;
  updatedByName: string | null;
}

export interface VaultPorts {
  /** The items of one hotel (null = the Central Vault) that are not removed, newest change first. */
  list(hotelId: string | null): Promise<VaultRow[]>;
  get(hotelId: string | null, id: string): Promise<VaultRow | null>;
  insert(row: Omit<VaultRow, "updatedAt">, by: string): Promise<VaultRow>;
  update(row: Omit<VaultRow, "updatedAt">, by: string): Promise<VaultRow | null>;
  remove(hotelId: string | null, id: string, by: string): Promise<boolean>;
}

const LIMITS = { title: 120, username: 200, url: 500, secret: 2000, notes: 5000 };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function createVaultService(deps: { unit: PlatformConsoleUnit; now: () => Date; ports: VaultPorts; key: Buffer | null; newId: () => string }) {
  const { unit, now, ports } = deps;
  const gate = createGate(unit, now);
  const context = (hotelId: string | null, id: string, field: "secret" | "notes") => `vault:${hotelId ?? "central"}:${id}:${field}`;

  function keyOrRefuse(): Buffer {
    if (!deps.key) throw new AppError("CONFLICT", "The vault needs the server secret HMS_HASH_KEY. Set it first.");
    return deps.key;
  }

  const view = (r: VaultRow): VaultItem => ({
    id: r.id, kind: r.kind, title: r.title, username: r.username, url: r.url, hasSecret: r.secret !== null, hasNotes: r.notes !== null,
    expiresOn: r.expiresOn, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedByName,
  });

  /** The input checked and trimmed; a field in error is named for the form. */
  function clean(input: VaultInput): { kind: VaultKind; title: string; username: string | null; url: string | null; expiresOn: string | null } {
    const fields: Record<string, string> = {};
    const kind = VAULT_KINDS.includes(input.kind) ? input.kind : null;
    if (!kind) fields.kind = "Choose a type.";
    const title = (input.title ?? "").trim();
    if (title === "") fields.title = "Give it a name.";
    else if (title.length > LIMITS.title) fields.title = `Keep the name under ${LIMITS.title} characters.`;
    const username = (input.username ?? "").trim();
    if (username.length > LIMITS.username) fields.username = `Keep it under ${LIMITS.username} characters.`;
    const url = (input.url ?? "").trim();
    if (url.length > LIMITS.url) fields.url = `Keep it under ${LIMITS.url} characters.`;
    if ((input.secret ?? "").length > LIMITS.secret) fields.secret = `Keep it under ${LIMITS.secret} characters.`;
    if ((input.notes ?? "").length > LIMITS.notes) fields.notes = `Keep the notes under ${LIMITS.notes} characters.`;
    const expiresOn = input.expiresOn ? input.expiresOn.trim() : "";
    if (expiresOn !== "" && !(DAY.test(expiresOn) && !Number.isNaN(Date.parse(`${expiresOn}T00:00:00Z`)))) fields.expiresOn = "Enter the date as YYYY-MM-DD.";
    if (Object.keys(fields).length) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
    return { kind: kind as VaultKind, title, username: username || null, url: url || null, expiresOn: expiresOn || null };
  }

  /** The hotel must exist; the actor must still be an active Super Admin. */
  async function within<T>(session: VerifiedSession, hotelId: string, work: (who: { userId: string; name: string }, hotelName: string, audit: (input: Omit<AuditInput, "entity" | "entityId" | "hotelId">) => Promise<void>) => Promise<T>, meta: PlatformMeta | null): Promise<T> {
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      if (!actor.isSuper) throw new AppError("FORBIDDEN", vaultCopy.superOnly);
      const hotel = await repos.hotels.get(hotelId, now());
      if (!hotel) throw new AppError("NOT_FOUND");
      const audit = async (input: Omit<AuditInput, "entity" | "entityId" | "hotelId">) => {
        if (meta) await gate.audit(repos, actor, meta, { ...input, entity: "hotel", entityId: hotelId, hotelId });
      };
      return work({ userId: actor.userId, name: actor.name }, hotel.name, audit);
    });
  }

  const label = (r: { kind: VaultKind; title: string }) => `${vaultCopy.kinds[r.kind]}: ${r.title}`;

  return {
    async list(session: VerifiedSession, hotelId: string): Promise<VaultItem[]> {
      gate.superRead(session);
      return within(session, hotelId, async () => (await ports.list(hotelId)).map(view), null);
    },

    async add(session: VerifiedSession, hotelId: string, input: VaultInput, meta: PlatformMeta): Promise<VaultItem> {
      await gate.superWrite(session, meta, { action: "vault_item_added", entity: "hotel", entityId: hotelId, hotelId });
      const c = clean(input);
      const key = keyOrRefuse();
      return within(session, hotelId, async (who, _hotel, audit) => {
        const id = deps.newId();
        const secret = input.secret ? seal(key, input.secret, context(hotelId, id, "secret")) : null;
        const notes = input.notes ? seal(key, input.notes, context(hotelId, id, "notes")) : null;
        const row = await ports.insert({ id, hotelId, ...c, secret, notes, updatedByName: who.name }, who.userId);
        await audit({ action: "vault_item_added", targetLabel: c.title, reason: label(c) });
        return view(row);
      }, meta);
    },

    async change(session: VerifiedSession, hotelId: string, id: string, input: VaultInput, meta: PlatformMeta): Promise<VaultItem> {
      await gate.superWrite(session, meta, { action: "vault_item_changed", entity: "hotel", entityId: hotelId, hotelId });
      const c = clean(input);
      const key = keyOrRefuse();
      return within(session, hotelId, async (who, _hotel, audit) => {
        const before = await ports.get(hotelId, id);
        if (!before) throw new AppError("NOT_FOUND");
        // left out = keep the sealed value; an empty string = remove it
        const secret = input.secret === undefined ? before.secret : input.secret === "" ? null : seal(key, input.secret, context(hotelId, id, "secret"));
        const notes = input.notes === undefined ? before.notes : input.notes === "" ? null : seal(key, input.notes, context(hotelId, id, "notes"));
        const row = await ports.update({ id, hotelId, ...c, secret, notes, updatedByName: who.name }, who.userId);
        if (!row) throw new AppError("NOT_FOUND");
        const what = [before.title !== c.title ? "name" : null, input.secret !== undefined ? "secret" : null, input.notes !== undefined ? "notes" : null].filter(Boolean).join(", ");
        await audit({ action: "vault_item_changed", targetLabel: c.title, reason: what ? `${label(c)} (${what} changed)` : label(c) });
        return view(row);
      }, meta);
    },

    async remove(session: VerifiedSession, hotelId: string, id: string, meta: PlatformMeta): Promise<{ id: string }> {
      await gate.superWrite(session, meta, { action: "vault_item_removed", entity: "hotel", entityId: hotelId, hotelId });
      return within(session, hotelId, async (who, _hotel, audit) => {
        const before = await ports.get(hotelId, id);
        if (!before || !(await ports.remove(hotelId, id, who.userId))) throw new AppError("NOT_FOUND");
        await audit({ action: "vault_item_removed", targetLabel: before.title, reason: label(before) });
        return { id };
      }, meta);
    },

    /** Show: the secret and the notes opened, and the opening recorded. */
    async reveal(session: VerifiedSession, hotelId: string, id: string, meta: PlatformMeta): Promise<VaultSecret> {
      await gate.superWrite(session, meta, { action: "vault_item_revealed", entity: "hotel", entityId: hotelId, hotelId });
      assertRechecked(session, now());
      const key = keyOrRefuse();
      return within(session, hotelId, async (_who, _hotel, audit) => {
        const row = await ports.get(hotelId, id);
        if (!row) throw new AppError("NOT_FOUND");
        const openOrRefuse = (sealed: string | null, field: "secret" | "notes") => {
          if (sealed === null) return null;
          try {
            return open(key, sealed, context(hotelId, id, field));
          } catch {
            throw new AppError("CONFLICT", "This item was locked with a different server key and cannot be opened. Enter the secret again.");
          }
        };
        const out = { secret: openOrRefuse(row.secret, "secret"), notes: openOrRefuse(row.notes, "notes") };
        await audit({ action: "vault_item_revealed", targetLabel: row.title, reason: label(row) });
        return out;
      }, meta);
    },
  };
}

export type VaultService = ReturnType<typeof createVaultService>;
