import "server-only";
import { randomUUID } from "node:crypto";
import type { TemplateDraft, TemplateRecord, TemplateStatus } from "./templates";

/** What the template service needs from the hotel's wa_templates (one hotel; the unit binds it). */
export interface WaTemplatesRepo {
  list(): Promise<TemplateRecord[]>;
  get(id: string): Promise<TemplateRecord | null>;
  /** `taken` when the name and language already exist for this line. */
  create(draft: TemplateDraft, lineId: string | null): Promise<TemplateRecord | "taken">;
  /** Replaces a draft's or rejected template's text (back to draft). `taken` when the new name collides. */
  update(id: string, draft: TemplateDraft): Promise<TemplateRecord | "taken" | null>;
  /** Moves the state: pending after a submission (with Meta's id and the line), or what Meta decided. */
  setStatus(id: string, status: TemplateStatus, o?: { reason?: string | null; metaTemplateId?: string | null; lineId?: string | null; name?: string }): Promise<TemplateRecord | null>;
  remove(id: string): Promise<boolean>;
}

const copy = (r: TemplateRecord): TemplateRecord => ({ ...r, variables: r.variables.map((v) => ({ ...v })) });

/** The in-memory double: the same rules as the table (unique name + language + line); like the table it hands back copies, never the stored row. */
export function createMemoryTemplatesRepo(now: () => Date = () => new Date()): WaTemplatesRepo & { rows: TemplateRecord[] } {
  const rows: TemplateRecord[] = [];
  const clash = (d: TemplateDraft, lineId: string | null, except?: string): boolean => rows.some((r) => r.id !== except && r.name === d.name && r.language === d.language && r.lineId === lineId);
  return {
    rows,
    async list() {
      return rows.map(copy).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async get(id) {
      const row = rows.find((r) => r.id === id);
      return row ? copy(row) : null;
    },
    async create(draft, lineId) {
      if (clash(draft, lineId)) return "taken";
      const at = now();
      const row: TemplateRecord = { ...draft, id: randomUUID(), status: "draft", statusReason: null, metaTemplateId: null, lineId, createdAt: at, updatedAt: at };
      rows.push(row);
      return copy(row);
    },
    async update(id, draft) {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      if (clash(draft, row.lineId, id)) return "taken";
      Object.assign(row, draft, { status: "draft" as const, statusReason: null, metaTemplateId: null, updatedAt: now() });
      return copy(row);
    },
    async setStatus(id, status, o = {}) {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      row.status = status;
      if (o.reason !== undefined) row.statusReason = o.reason;
      if (o.metaTemplateId !== undefined) row.metaTemplateId = o.metaTemplateId;
      if (o.lineId !== undefined) row.lineId = o.lineId;
      if (o.name !== undefined) row.name = o.name;
      row.updatedAt = now();
      return copy(row);
    },
    async remove(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
}
