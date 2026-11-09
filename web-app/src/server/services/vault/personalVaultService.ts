import "server-only";
import { randomBytes } from "node:crypto";
import { PERSONAL_VAULT_KINDS, personalVaultCopy, type PersonalVaultInput, type PersonalVaultItem, type PersonalVaultKind } from "@shared/dashboards/personalVault";
import type { VaultSecret } from "@shared/dashboards/vault";
import { assertRechecked } from "../../auth/recheck";
import type { VerifiedSession } from "../../auth/session";
import { open, seal } from "../../crypto/secretBox";
import { AppError } from "../../errors";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import { createGate, type Actor, type AuditInput, type PlatformMeta } from "../platform/access";

// My vault (MJ, 5 Nov 2026; platform 0190): the signed-in Super Admin's own items. The owner is the session's login, never an input; anyone else (another Super Admin, a Platform
// Admin, a hotel login, an API key, a visit) gets NOT_FOUND, so the vault's existence is not shown. Envelope encryption: the owner's data key is made once, kept sealed with the vault
// key; each secret and note is sealed with the data key, bound to the owner, the item and the field. The audit row names the owner and the item id (a Show also the item's name), never
// its secret. A Show needs a fresh re-check of the session (auth/recheck.ts).

export interface PersonalVaultRow {
  id: string;
  ownerId: string;
  kind: PersonalVaultKind;
  title: string;
  username: string | null;
  url: string | null;
  secret: string | null;
  notes: string | null;
  expiresOn: string | null;
  updatedAt: Date;
}

export interface PersonalVaultPorts {
  /** The owner's data key, sealed; null before the first item. */
  wrappedKey(ownerId: string): Promise<string | null>;
  /** Keeps the first sealed data key of an owner and returns the one stored (a second writer gets the first). */
  keepWrappedKey(ownerId: string, wrapped: string): Promise<string>;
  list(ownerId: string): Promise<PersonalVaultRow[]>;
  get(ownerId: string, id: string): Promise<PersonalVaultRow | null>;
  insert(row: Omit<PersonalVaultRow, "updatedAt">): Promise<PersonalVaultRow>;
  update(row: Omit<PersonalVaultRow, "updatedAt">): Promise<PersonalVaultRow | null>;
  remove(ownerId: string, id: string): Promise<boolean>;
}

type Action = "personal_vault_item_added" | "personal_vault_item_changed" | "personal_vault_item_revealed" | "personal_vault_item_removed";

const LIMITS = { title: 120, username: 200, url: 500, secret: 2000, notes: 5000 };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const V = personalVaultCopy;

export function createPersonalVaultService(deps: { unit: PlatformConsoleUnit; now: () => Date; ports: PersonalVaultPorts; key: Buffer | null; newId: () => string }) {
  const { unit, now, ports } = deps;
  const gate = createGate(unit, now);
  const keyContext = (ownerId: string) => `personal-vault-key:${ownerId}`;
  const context = (ownerId: string, id: string, field: "secret" | "notes") => `personal-vault:${ownerId}:${id}:${field}`;
  const notFound = () => new AppError("NOT_FOUND");

  function masterOrRefuse(): Buffer {
    if (!deps.key) throw new AppError("CONFLICT", "The vault needs the server secret HMS_HASH_KEY. Set it first.");
    return deps.key;
  }

  /** The owner's data key: opened from its sealed copy, or made and kept on first use. */
  async function dataKey(ownerId: string, make: boolean): Promise<Buffer | null> {
    const master = masterOrRefuse();
    let wrapped = await ports.wrappedKey(ownerId);
    if (!wrapped) {
      if (!make) return null;
      wrapped = await ports.keepWrappedKey(ownerId, seal(master, randomBytes(32).toString("base64"), keyContext(ownerId)));
    }
    try {
      return Buffer.from(open(master, wrapped, keyContext(ownerId)), "base64");
    } catch {
      throw new AppError("CONFLICT", "Your vault was locked with a different server key and cannot be opened.");
    }
  }

  const view = (r: PersonalVaultRow, by: string | null): PersonalVaultItem => ({
    id: r.id, kind: r.kind, title: r.title, username: r.username, url: r.url, hasSecret: r.secret !== null, hasNotes: r.notes !== null,
    expiresOn: r.expiresOn, updatedAt: r.updatedAt.toISOString(), updatedBy: by,
  });

  function clean(input: PersonalVaultInput): { kind: PersonalVaultKind; title: string; username: string | null; url: string | null; expiresOn: string | null } {
    const fields: Record<string, string> = {};
    const kind = PERSONAL_VAULT_KINDS.includes(input.kind) ? input.kind : null;
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
    return { kind: kind as PersonalVaultKind, title, username: username || null, url: url || null, expiresOn: expiresOn || null };
  }

  /** Only the owner, signed in as an active Super Admin in the browser; everyone else is told it does not exist. */
  function ownerOf(session: VerifiedSession): string {
    if (session.token !== undefined || session.client === "token" || session.visit !== undefined || session.accountRole !== "super_admin") throw notFound();
    return session.userId;
  }

  async function within<T>(session: VerifiedSession, work: (owner: Actor, audit: (action: Action, itemId: string, kind: PersonalVaultKind, title?: string) => Promise<void>) => Promise<T>, meta: PlatformMeta | null): Promise<T> {
    const ownerId = ownerOf(session);
    return unit.run(async (repos) => {
      let actor: Actor;
      try {
        actor = await gate.actor(repos, session);
      } catch {
        throw notFound();
      }
      if (!actor.isSuper || actor.userId !== ownerId) throw notFound();
      // a Show names the item (MJ, 5 Nov 2026: who, which item, when); every other change names only its kind and id
      const audit = async (action: Action, itemId: string, kind: PersonalVaultKind, title?: string) => {
        if (!meta) return;
        const input: AuditInput = { action, entity: "user", entityId: ownerId, targetLabel: V.auditLabel, reason: title ? `${V.kinds[kind]}: ${title}` : V.kinds[kind], after: { item: itemId } };
        await gate.audit(repos, actor, meta, input);
      };
      return work(actor, audit);
    });
  }

  return {
    async list(session: VerifiedSession): Promise<PersonalVaultItem[]> {
      return within(session, async (owner) => (await ports.list(owner.userId)).map((r) => view(r, owner.name)), null);
    },

    async add(session: VerifiedSession, input: PersonalVaultInput, meta: PlatformMeta): Promise<PersonalVaultItem> {
      ownerOf(session);
      const c = clean(input);
      return within(session, async (owner, audit) => {
        const key = (await dataKey(owner.userId, true)) as Buffer;
        const id = deps.newId();
        const secret = input.secret ? seal(key, input.secret, context(owner.userId, id, "secret")) : null;
        const notes = input.notes ? seal(key, input.notes, context(owner.userId, id, "notes")) : null;
        const row = await ports.insert({ id, ownerId: owner.userId, ...c, secret, notes });
        await audit("personal_vault_item_added", id, c.kind);
        return view(row, owner.name);
      }, meta);
    },

    async change(session: VerifiedSession, id: string, input: PersonalVaultInput, meta: PlatformMeta): Promise<PersonalVaultItem> {
      ownerOf(session);
      const c = clean(input);
      return within(session, async (owner, audit) => {
        const before = await ports.get(owner.userId, id);
        if (!before) throw notFound();
        const key = (await dataKey(owner.userId, true)) as Buffer;
        const secret = input.secret === undefined ? before.secret : input.secret === "" ? null : seal(key, input.secret, context(owner.userId, id, "secret"));
        const notes = input.notes === undefined ? before.notes : input.notes === "" ? null : seal(key, input.notes, context(owner.userId, id, "notes"));
        const row = await ports.update({ id, ownerId: owner.userId, ...c, secret, notes });
        if (!row) throw notFound();
        await audit("personal_vault_item_changed", id, c.kind);
        return view(row, owner.name);
      }, meta);
    },

    async remove(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<{ id: string }> {
      return within(session, async (owner, audit) => {
        const before = await ports.get(owner.userId, id);
        if (!before || !(await ports.remove(owner.userId, id))) throw notFound();
        await audit("personal_vault_item_removed", id, before.kind);
        return { id };
      }, meta);
    },

    /** Show: the secret and the notes opened for their owner, and the opening recorded. */
    async reveal(session: VerifiedSession, id: string, meta: PlatformMeta): Promise<VaultSecret> {
      ownerOf(session);
      assertRechecked(session, now());
      return within(session, async (owner, audit) => {
        const row = await ports.get(owner.userId, id);
        if (!row) throw notFound();
        const key = await dataKey(owner.userId, false);
        const openOrRefuse = (sealed: string | null, field: "secret" | "notes") => {
          if (sealed === null) return null;
          try {
            if (!key) throw new Error("no key");
            return open(key, sealed, context(owner.userId, id, field));
          } catch {
            throw new AppError("CONFLICT", "This item cannot be opened. Enter the secret again.");
          }
        };
        const out = { secret: openOrRefuse(row.secret, "secret"), notes: openOrRefuse(row.notes, "notes") };
        await audit("personal_vault_item_revealed", id, row.kind, row.title);
        return out;
      }, meta);
    },
  };
}

export type PersonalVaultService = ReturnType<typeof createPersonalVaultService>;
