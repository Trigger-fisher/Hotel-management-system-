import "server-only";
// The repository interface of the security layer (platform migration 0173; security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md sections 7 and 9). No SQL and no driver here.

export type SecuritySeverity = "warning" | "critical";
export type Delivery = "sent" | "skipped" | "failed" | "throttled";
export type DetailValue = string | number | boolean | null;

export interface NewSecurityEvent {
  severity: SecuritySeverity;
  kind: string;
  summary: string;
  detail: Record<string, DetailValue>;
  ip: string | null;
  traceId: string | null;
  at: Date;
}

export interface SecurityEventRow extends NewSecurityEvent {
  id: string;
  slack: Delivery;
  sms: Delivery;
}

/** 1 = edge (Cloudflare), 2 = application (VPS), 3 = database. */
export type ResetLayer = 1 | 2 | 3;
export type ResetState = "awaiting_approval" | "running" | "healthy" | "unhealthy" | "rejected";

export interface ResetStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SecurityResetRow {
  id: string;
  layer: ResetLayer;
  state: ResetState;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  steps: ResetStep[];
  healthOk: boolean | null;
  healthDetail: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export type ResetPatch = Partial<Pick<SecurityResetRow, "state" | "approvedBy" | "approvedByName" | "steps" | "healthOk" | "healthDetail" | "finishedAt">>;

export interface SecurityRepo {
  addEvent(event: NewSecurityEvent): Promise<string>;
  markAlerted(id: string, slack: Delivery, sms: Delivery): Promise<void>;
  /** Newest first. */
  listEvents(filter: { severity?: SecuritySeverity; limit: number }): Promise<SecurityEventRow[]>;
  createReset(reset: { layer: ResetLayer; state: ResetState; reason: string; requestedBy: string; requestedByName: string; at: Date }): Promise<string>;
  getReset(id: string): Promise<SecurityResetRow | null>;
  /** Moves a reset forward; only the fields given change. */
  updateReset(id: string, patch: ResetPatch): Promise<void>;
  /** Like updateReset, but only when the reset is still in state `from`: true for the one caller that won (two approvals at once run the reset once). */
  transitionReset(id: string, from: ResetState, patch: ResetPatch): Promise<boolean>;
  /** Newest first. */
  listResets(limit: number): Promise<SecurityResetRow[]>;
}
