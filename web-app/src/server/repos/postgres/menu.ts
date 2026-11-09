import "server-only";
import { toBigInt } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { MenuGroupKey, MenuItemRecord, MenuRepo } from "../menu";
import { RepoError } from "../types";
import { asText, guard } from "./shared";

type Row = Record<string, unknown>;

const itemOf = (r: Row): MenuItemRecord => ({
  id: String(r.id), group: String(r.menu_group) as MenuGroupKey, name: String(r.name), note: asText(r.note), pricePaise: toBigInt(r.price_paise), available: r.available === true, sortOrder: Number(r.sort_order),
  // round 3 columns (0041, 0043): absent on a hotel that has not run them yet
  category: asText(r.category), veg: (asText(r.veg) as MenuItemRecord["veg"]) ?? "unknown", imageFile: asText(r.image_file),
});

/** The room-service menu on PostgreSQL (table menu_items); the in-memory double (repos/memory/admin.ts) is the reference for every rule. */
export function pgMenuRepo(tx: TxClient): MenuRepo {
  const q = (text: string, params?: readonly unknown[]) => tx.query(text, params);
  return {
    async list() {
      // a hotel built before migration 0020 has no menu table yet: its menu is simply empty (the savepoint keeps the unit usable after the error)
      await q("SAVEPOINT menu_list");
      try {
        const r = await q('SELECT * FROM menu_items WHERE deleted_at IS NULL ORDER BY menu_group, sort_order, name COLLATE "C", id');
        await q("RELEASE SAVEPOINT menu_list");
        return r.rows.map(itemOf);
      } catch (error) {
        if ((error as { code?: unknown }).code !== "42P01") throw error;
        await q("ROLLBACK TO SAVEPOINT menu_list");
        return [];
      }
    },
    async get(id) {
      const r = await q("SELECT * FROM menu_items WHERE id = $1 AND deleted_at IS NULL", [id]);
      return r.rows[0] ? itemOf(r.rows[0]) : null;
    },
    async create(group, f) {
      const r = await guard(
        q(
          `INSERT INTO menu_items (menu_group, name, note, price_paise, available, sort_order)
           VALUES ($1::text, $2::text, $3::text, $4::bigint, $5::boolean, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM menu_items WHERE menu_group = $1::text AND deleted_at IS NULL)) RETURNING *`,
          [group, f.name, f.note, f.pricePaise.toString(), f.available],
        ),
      );
      const made = itemOf(r.rows[0]);
      return f.category !== undefined || f.veg !== undefined ? ((await this.update(made.id, f)) ?? made) : made;
    },
    async update(id, f) {
      // category and veg only when sent (an older caller, or a hotel before migration 0041, leaves them alone)
      const extra: string[] = [];
      const params: unknown[] = [id, f.name, f.note, f.pricePaise.toString(), f.available];
      if (f.category !== undefined) {
        params.push(f.category);
        extra.push(`category = $${params.length}::text`);
      }
      if (f.veg !== undefined) {
        params.push(f.veg);
        extra.push(`veg = $${params.length}::text`);
      }
      const set = ["name = $2::text", "note = $3::text", "price_paise = $4::bigint", "available = $5::boolean", ...extra].join(", ");
      const r = await guard(q(`UPDATE menu_items SET ${set} WHERE id = $1 AND deleted_at IS NULL RETURNING *`, params));
      return r.rows[0] ? itemOf(r.rows[0]) : null;
    },
    async setImage(id, imageFile) {
      const before = await q("SELECT * FROM menu_items WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (!before.rows[0]) return null;
      await q("UPDATE menu_items SET image_file = $2 WHERE id = $1", [id, imageFile]);
      return itemOf(before.rows[0]);
    },
    async remove(id) {
      return (await q("UPDATE menu_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", [id])).affectedRows > 0;
    },
    async swap(id, direction) {
      const me = await q("SELECT id, menu_group, sort_order FROM menu_items WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (!me.rows[0]) return false;
      const up = direction === "up";
      const group = String(me.rows[0].menu_group);
      const order = Number(me.rows[0].sort_order);
      const next = await q(
        `SELECT id, sort_order FROM menu_items WHERE menu_group = $1 AND deleted_at IS NULL AND (sort_order, id) ${up ? "<" : ">"} ($2::int, $3::uuid) ORDER BY sort_order ${up ? "DESC" : "ASC"}, id ${up ? "DESC" : "ASC"} LIMIT 1 FOR UPDATE`,
        [group, order, id],
      );
      if (!next.rows[0]) return false;
      // equal orders (a fresh list) are first made distinct, then the two places are exchanged
      await q("UPDATE menu_items SET sort_order = n FROM (SELECT id AS i, row_number() OVER (ORDER BY sort_order, id) AS n FROM menu_items WHERE menu_group = $1 AND deleted_at IS NULL) s WHERE id = i", [group]);
      const a = Number((await q("SELECT sort_order FROM menu_items WHERE id = $1", [id])).rows[0].sort_order);
      const b = Number((await q("SELECT sort_order FROM menu_items WHERE id = $1", [String(next.rows[0].id)])).rows[0].sort_order);
      await q("UPDATE menu_items SET sort_order = CASE id WHEN $1::uuid THEN $3::int WHEN $2::uuid THEN $4::int END WHERE id IN ($1::uuid, $2::uuid)", [id, String(next.rows[0].id), b, a]);
      return true;
    },
  };
}

void RepoError;
