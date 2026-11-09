import "server-only";
import type { TemplateButton, TemplateRecord, TemplateStatus } from "../../whatsapp/templates";
import type { WaTemplatesRepo } from "../../whatsapp/templatesStore";

// wa_templates of one hotel (hotel 0057), bound to the hotel's transaction. The unique index (name, language, line) is the backstop for a name used twice.
type Query = { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, name, language, category, body, variables, buttons, starter_key, status, status_reason, meta_template_id, line_id, created_at, updated_at";

const recordOf = (x: Record<string, unknown>): TemplateRecord => ({
  id: String(x.id),
  name: String(x.name),
  language: String(x.language),
  category: x.category as TemplateRecord["category"],
  body: String(x.body),
  variables: (Array.isArray(x.variables) ? x.variables : []).map((v: { index: number; name?: string; example?: string }) => ({ index: Number(v.index), name: String(v.name ?? ""), example: String(v.example ?? "") })),
  buttons: (Array.isArray(x.buttons) ? x.buttons : []).flatMap((b: { kind?: string; text?: string; url?: string }): TemplateButton[] => (b.kind === "url" ? [{ kind: "url", text: String(b.text ?? ""), url: String(b.url ?? "") }] : b.kind === "quick_reply" ? [{ kind: "quick_reply", text: String(b.text ?? "") }] : [])),
  starterKey: x.starter_key === null || x.starter_key === undefined ? null : String(x.starter_key),
  status: x.status as TemplateStatus,
  statusReason: x.status_reason === null || x.status_reason === undefined ? null : String(x.status_reason),
  metaTemplateId: x.meta_template_id === null || x.meta_template_id === undefined ? null : String(x.meta_template_id),
  lineId: x.line_id === null || x.line_id === undefined ? null : String(x.line_id),
  createdAt: x.created_at as Date,
  updatedAt: x.updated_at as Date,
});

const isUnique = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

export function pgWaTemplatesRepo(db: Query): WaTemplatesRepo {
  return {
    async list() {
      return (await db.query(`SELECT ${COLUMNS} FROM wa_templates ORDER BY created_at DESC, id LIMIT 500`)).rows.map(recordOf);
    },
    async get(id) {
      if (!UUID.test(id)) return null;
      const r = await db.query(`SELECT ${COLUMNS} FROM wa_templates WHERE id = $1`, [id]);
      return r.rows[0] ? recordOf(r.rows[0]) : null;
    },
    async create(d, lineId) {
      try {
        const r = await db.query(`INSERT INTO wa_templates (name, language, category, body, variables, line_id, buttons, starter_key) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8) RETURNING ${COLUMNS}`, [d.name, d.language, d.category, d.body, JSON.stringify(d.variables), lineId, JSON.stringify(d.buttons ?? []), d.starterKey ?? null]);
        return recordOf(r.rows[0]);
      } catch (e) {
        if (isUnique(e)) return "taken";
        throw e;
      }
    },
    async update(id, d) {
      if (!UUID.test(id)) return null;
      try {
        const r = await db.query(
          `UPDATE wa_templates SET name = $2, language = $3, category = $4, body = $5, variables = $6::jsonb, buttons = $7::jsonb, starter_key = $8, status = 'draft', status_reason = NULL, meta_template_id = NULL WHERE id = $1 RETURNING ${COLUMNS}`,
          [id, d.name, d.language, d.category, d.body, JSON.stringify(d.variables), JSON.stringify(d.buttons ?? []), d.starterKey ?? null],
        );
        return r.rows[0] ? recordOf(r.rows[0]) : null;
      } catch (e) {
        if (isUnique(e)) return "taken";
        throw e;
      }
    },
    async setStatus(id, status, o = {}) {
      if (!UUID.test(id)) return null;
      const r = await db.query(
        `UPDATE wa_templates SET status = $2,
           status_reason = CASE WHEN $3::boolean THEN $4 ELSE status_reason END,
           meta_template_id = CASE WHEN $5::boolean THEN $6 ELSE meta_template_id END,
           line_id = CASE WHEN $7::boolean THEN $8::uuid ELSE line_id END,
           name = coalesce($9, name)
         WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, status, o.reason !== undefined, o.reason === undefined ? null : o.reason === null ? null : o.reason.slice(0, 300), o.metaTemplateId !== undefined, o.metaTemplateId ?? null, o.lineId !== undefined, o.lineId ?? null, o.name ?? null],
      );
      return r.rows[0] ? recordOf(r.rows[0]) : null;
    },
    async remove(id) {
      if (!UUID.test(id)) return false;
      return (await db.query("DELETE FROM wa_templates WHERE id = $1 RETURNING id", [id])).rows.length > 0;
    },
  };
}
