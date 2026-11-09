import "server-only";
import { isIP } from "node:net";
import type { ResetLayer, ResetStep, SecurityRepo, SecurityResetRow } from "../../repos/security";
import { AppError } from "../../errors";
import type { SecurityEvents } from "./events";

// The emergency reset system (plan section 9): three independent actions, one per layer, so a small edge event never forces a database credential rotation.
//   1 edge (Cloudflare)   any Super Admin
//   2 application (VPS)   any Super Admin
//   3 database            TWO Super Admins: one asks, a different one approves
// Every reset ends with the layer's own health check. A layer is "healthy" only when its steps worked AND its check passed; a layer whose executor is not connected (no Cloudflare token,
// no VPS yet) ends "unhealthy" with the reason, never "healthy": no false confidence. The steps and the check's answer are kept on the reset's row.

export interface ResetContext {
  reason: string;
  /** Layer 1 only: an address to block at the edge. */
  ip: string | null;
}

export interface ResetExecutor {
  /** What this layer is connected to (or why it is not), shown on the status screen. */
  describe(): string;
  configured(): boolean;
  run(context: ResetContext): Promise<ResetStep[]>;
  health(context: ResetContext): Promise<{ ok: boolean; detail: string }>;
}

export interface ResetActor {
  userId: string;
  name: string;
  isSuper: boolean;
}

export interface LayerStatus {
  layer: ResetLayer;
  name: string;
  /** unknown = never reset since this was built; unhealthy also covers "not connected". */
  state: "unknown" | "running" | "awaiting_approval" | "healthy" | "unhealthy";
  connected: boolean;
  note: string;
  lastResetId: string | null;
  lastAt: string | null;
}

const LAYER_NAMES: Record<ResetLayer, string> = { 1: "Edge (Cloudflare)", 2: "Application (VPS)", 3: "Database" };
const short = (s: string, n: number): string => s.replace(/[^\x20-\x7e]/g, "?").trim().slice(0, n);

export function createResetService(deps: { repo: SecurityRepo; events: SecurityEvents; executors: Record<ResetLayer, ResetExecutor>; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const { repo, events, executors } = deps;

  function mustBeSuper(actor: ResetActor): void {
    if (!actor.isSuper) throw new AppError("FORBIDDEN", "Only a Super Admin can run an emergency reset.");
  }

  /** Runs the layer's steps and its health check, and writes the outcome. Never throws: a crash in an executor is an unhealthy layer. */
  async function execute(row: SecurityResetRow): Promise<SecurityResetRow> {
    const executor = executors[row.layer];
    const context: ResetContext = { reason: row.reason, ip: ipOf(row.reason) };
    let steps: ResetStep[];
    let health: { ok: boolean; detail: string };
    if (!executor.configured()) {
      steps = [{ name: "connect", ok: false, detail: short(executor.describe(), 200) }];
      health = { ok: false, detail: "Not connected, so nothing was reset and the layer cannot be called healthy." };
    } else {
      try {
        steps = await executor.run(context);
      } catch (error) {
        steps = [{ name: "run", ok: false, detail: `The reset stopped: ${error instanceof Error ? short(error.message, 150) : "unknown error"}` }];
      }
      try {
        health = await executor.health(context);
      } catch (error) {
        health = { ok: false, detail: `The health check could not run: ${error instanceof Error ? short(error.message, 150) : "unknown error"}` };
      }
    }
    const healthy = steps.length > 0 && steps.every((s) => s.ok) && health.ok;
    const patch = { state: healthy ? ("healthy" as const) : ("unhealthy" as const), steps, healthOk: health.ok, healthDetail: short(health.detail, 500), finishedAt: now() };
    await repo.updateReset(row.id, patch);
    await events.record({ kind: "reset_finished", summary: `Layer ${row.layer} (${LAYER_NAMES[row.layer]}) reset finished: ${patch.state}`, detail: { layer: row.layer, state: patch.state, resetId: row.id } });
    return { ...row, ...patch };
  }

  /** The address an edge reset should block, written into the reason as `ip=1.2.3.4` by the route; null when none or not a real address. */
  function ipOf(reason: string): string | null {
    const m = /(?:^|\s)ip=(\S+)/.exec(reason);
    return m && isIP(m[1]!) !== 0 ? m[1]! : null;
  }

  return {
    ipOf,

    /** Layers 1 and 2 run at once; layer 3 waits for a second Super Admin. */
    async request(actor: ResetActor, input: { layer: ResetLayer; reason: string }): Promise<SecurityResetRow> {
      mustBeSuper(actor);
      const reason = short(input.reason, 500);
      if (reason.length < 5) throw new AppError("VALIDATION_FAILED", "Say why in a few words (at least 5 characters).", { fields: { reason: "Say why in a few words." } });
      const twoPeople = input.layer === 3;
      const id = await repo.createReset({ layer: input.layer, state: twoPeople ? "awaiting_approval" : "running", reason, requestedBy: actor.userId, requestedByName: short(actor.name, 120), at: now() });
      await events.record({ kind: "reset_requested", summary: `Layer ${input.layer} (${LAYER_NAMES[input.layer]}) reset requested by ${short(actor.name, 60)}${twoPeople ? ", waiting for a second Super Admin" : ""}`, detail: { layer: input.layer, resetId: id } });
      const row = (await repo.getReset(id))!;
      return twoPeople ? row : execute(row);
    },

    /** The second Super Admin approves a layer 3 reset (never the one who asked) and it runs. */
    async approve(actor: ResetActor, id: string): Promise<SecurityResetRow> {
      mustBeSuper(actor);
      const row = await repo.getReset(id);
      if (!row) throw new AppError("NOT_FOUND");
      if (row.state !== "awaiting_approval") throw new AppError("CONFLICT", "This reset is not waiting for approval.");
      if (row.requestedBy === actor.userId) throw new AppError("FORBIDDEN", "A different Super Admin must approve this reset.");
      const won = await repo.transitionReset(id, "awaiting_approval", { state: "running", approvedBy: actor.userId, approvedByName: short(actor.name, 120) });
      if (!won) throw new AppError("CONFLICT", "This reset is no longer waiting for approval.");
      return execute({ ...row, state: "running", approvedBy: actor.userId, approvedByName: short(actor.name, 120) });
    },

    /** Any Super Admin, including the requester, may call a waiting reset off. */
    async reject(actor: ResetActor, id: string): Promise<SecurityResetRow> {
      mustBeSuper(actor);
      const row = await repo.getReset(id);
      if (!row) throw new AppError("NOT_FOUND");
      const done = await repo.transitionReset(id, "awaiting_approval", { state: "rejected", finishedAt: now() });
      if (!done) throw new AppError("CONFLICT", "This reset is not waiting for approval.");
      return { ...row, state: "rejected" };
    },

    async list(actor: ResetActor, limit = 50): Promise<SecurityResetRow[]> {
      mustBeSuper(actor);
      return repo.listResets(Math.min(Math.max(limit, 1), 200));
    },

    /** The dashboard's three lights: what each layer's last reset ended as, and whether it is connected at all. */
    async status(actor: ResetActor): Promise<LayerStatus[]> {
      mustBeSuper(actor);
      const rows = await repo.listResets(200);
      return ([1, 2, 3] as const).map((layer) => {
        const last = rows.find((r) => r.layer === layer);
        const connected = executors[layer].configured();
        return {
          layer, name: LAYER_NAMES[layer], connected, note: executors[layer].describe(), lastResetId: last?.id ?? null, lastAt: last ? (last.finishedAt ?? last.createdAt).toISOString() : null,
          state: !last ? "unknown" : last.state === "rejected" ? "unknown" : last.state,
        };
      });
    },
  };
}

export type ResetService = ReturnType<typeof createResetService>;
