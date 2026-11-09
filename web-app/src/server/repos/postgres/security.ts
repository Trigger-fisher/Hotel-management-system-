import "server-only";
import type { ClientPool } from "../../../db/withHotel";
import type { Delivery, NewSecurityEvent, ResetLayer, ResetPatch, ResetState, ResetStep, SecurityEventRow, SecurityRepo, SecurityResetRow } from "../security";

// The PostgreSQL side of the security layer (platform.security_events and platform.security_resets, migration 0199). Each call is one statement on a pooled connection as hms_app.
type Row = Record<string, unknown>;

const eventOf = (r: Row): SecurityEventRow => ({
  id: String(r.id), at: r.at as Date, severity: r.severity as SecurityEventRow["severity"], kind: String(r.kind), summary: String(r.summary), detail: (r.detail ?? {}) as SecurityEventRow["detail"],
  ip: r.ip === null ? null : String(r.ip), traceId: r.trace_id === null ? null : String(r.trace_id), slack: r.slack_status as Delivery, sms: r.sms_status as Delivery,
});

const resetOf = (r: Row): SecurityResetRow => ({
  id: String(r.id), layer: Number(r.layer) as ResetLayer, state: r.state as ResetState, reason: String(r.reason), requestedBy: String(r.requested_by ?? ""), requestedByName: String(r.requested_by_name),
  approvedBy: r.approved_by === null ? null : String(r.approved_by), approvedByName: r.approved_by_name === null ? null : String(r.approved_by_name), steps: (r.steps ?? []) as ResetStep[],
  healthOk: r.health_ok === null ? null : Boolean(r.health_ok), healthDetail: r.health_detail === null ? null : String(r.health_detail), createdAt: r.created_at as Date, finishedAt: (r.finished_at as Date | null) ?? null,
});

export function createPgSecurity(pool: ClientPool): SecurityRepo {
  async function q(text: string, params: unknown[] = []): Promise<Row[]> {
    const client = await pool.connect();
    try {
      return (await client.query(text, params)).rows as Row[];
    } finally {
      client.release();
    }
  }
  return {
    async addEvent(e: NewSecurityEvent) {
      const rows = await q("INSERT INTO platform.security_events (at, severity, kind, summary, detail, ip, trace_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id", [e.at, e.severity, e.kind, e.summary, JSON.stringify(e.detail), e.ip, e.traceId]);
      return String(rows[0]!.id);
    },
    async markAlerted(id, slack, sms) {
      await q("UPDATE platform.security_events SET slack_status = $2, sms_status = $3 WHERE id = $1", [id, slack, sms]);
    },
    async listEvents({ severity, limit }) {
      const rows = severity
        ? await q("SELECT * FROM platform.security_events WHERE severity = $1 ORDER BY at DESC, id DESC LIMIT $2", [severity, limit])
        : await q("SELECT * FROM platform.security_events ORDER BY at DESC, id DESC LIMIT $1", [limit]);
      return rows.map(eventOf);
    },
    async createReset(r) {
      const rows = await q("INSERT INTO platform.security_resets (layer, state, reason, requested_by, requested_by_name, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [r.layer, r.state, r.reason, r.requestedBy, r.requestedByName, r.at]);
      return String(rows[0]!.id);
    },
    async getReset(id) {
      const rows = await q("SELECT * FROM platform.security_resets WHERE id = $1", [id]);
      return rows[0] ? resetOf(rows[0]) : null;
    },
    async updateReset(id, patch) {
      await update(id, null, patch);
    },
    async transitionReset(id, from, patch) {
      return update(id, from, patch);
    },
    async listResets(limit) {
      return (await q("SELECT * FROM platform.security_resets ORDER BY created_at DESC, id DESC LIMIT $1", [limit])).map(resetOf);
    },
  };

  /** UPDATE of the fields given; with `from`, only while the row is still in that state. True when a row changed. */
  async function update(id: string, from: ResetState | null, patch: ResetPatch): Promise<boolean> {
    const columns: Record<string, unknown> = {
      state: patch.state, approved_by: patch.approvedBy, approved_by_name: patch.approvedByName, steps: patch.steps === undefined ? undefined : JSON.stringify(patch.steps),
      health_ok: patch.healthOk, health_detail: patch.healthDetail, finished_at: patch.finishedAt,
    };
    const set = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (set.length === 0) return false;
    const params: unknown[] = [id, ...set.map(([, v]) => v)];
    if (from !== null) params.push(from);
    const sql = `UPDATE platform.security_resets SET ${set.map(([c], i) => `${c} = $${i + 2}${c === "steps" ? "::jsonb" : ""}`).join(", ")} WHERE id = $1${from !== null ? ` AND state = $${params.length}` : ""} RETURNING id`;
    return (await q(sql, params)).length > 0;
  }
}
