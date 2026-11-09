import "server-only";
import type { Delivery, NewSecurityEvent, SecurityEventRow, SecurityRepo, SecurityResetRow } from "../security";

/** The in-memory double of the security repository (tests, and a server with no database). */
export function createMemorySecurity(): SecurityRepo {
  const events: SecurityEventRow[] = [];
  const resets: SecurityResetRow[] = [];
  let n = 0;
  const id = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  return {
    async addEvent(e: NewSecurityEvent) {
      const row: SecurityEventRow = { ...e, id: id(), slack: "skipped", sms: "skipped" };
      events.push(row);
      return row.id;
    },
    async markAlerted(eventId: string, slack: Delivery, sms: Delivery) {
      const row = events.find((e) => e.id === eventId);
      if (row) Object.assign(row, { slack, sms });
    },
    async listEvents({ severity, limit }) {
      return events.filter((e) => !severity || e.severity === severity).slice().reverse().slice(0, limit);
    },
    async createReset(r) {
      const row: SecurityResetRow = { id: id(), layer: r.layer, state: r.state, reason: r.reason, requestedBy: r.requestedBy, requestedByName: r.requestedByName, approvedBy: null, approvedByName: null, steps: [], healthOk: null, healthDetail: null, createdAt: r.at, finishedAt: null };
      resets.push(row);
      return row.id;
    },
    async getReset(resetId) {
      const row = resets.find((r) => r.id === resetId);
      return row ? { ...row, steps: [...row.steps] } : null;
    },
    async updateReset(resetId, patch) {
      const row = resets.find((r) => r.id === resetId);
      if (row) Object.assign(row, patch);
    },
    async transitionReset(resetId, from, patch) {
      const row = resets.find((r) => r.id === resetId);
      if (!row || row.state !== from) return false;
      Object.assign(row, patch);
      return true;
    },
    async listResets(limit) {
      return resets.slice().reverse().slice(0, limit).map((r) => ({ ...r, steps: [...r.steps] }));
    },
  };
}
