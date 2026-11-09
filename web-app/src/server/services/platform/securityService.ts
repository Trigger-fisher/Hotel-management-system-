import "server-only";
import { z } from "zod";
import {
  SESSION_KINDS, SESSION_KIND_LABELS, durationText, sessionMinutesOf, tempPasswordMinutesOf, validSessionMinutes, validTempPasswordMinutes,
  type SecuritySettings, type SecuritySettingsInput,
} from "@shared/dashboards/security";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { createGate, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";

// Platform settings > Security (MJ, 5 Nov 2026), Super Admin only: how long each user kind stays signed in, and how long a temporary password works.
// Stored as platform_settings rows (security.session_minutes, security.temp_password_minutes; the database CHECKs the bounds, migration 0192). The session
// resolver reads the first in its one statement on every request, so a change reaches sessions already open at their next request.

const KEYS = { sessions: "security.session_minutes", temp: "security.temp_password_minutes" } as const;

const minutes = z.number().int().min(0).max(1_000_000);
/** What PUT /platform/security accepts: only the values sent change. */
export const securityBody = z.strictObject({
  sessionMinutes: z.strictObject(Object.fromEntries(SESSION_KINDS.map((k) => [k, minutes.optional()])) as Record<(typeof SESSION_KINDS)[number], z.ZodOptional<typeof minutes>>).optional(),
  tempPasswordMinutes: minutes.optional(),
});
export const SESSION_MINUTES_PROBLEM = "Choose a time from 15 minutes to 30 days.";
export const TEMP_PASSWORD_MINUTES_PROBLEM = "Choose a time from 5 minutes to 24 hours.";

export function createSecurityService(deps: Pick<ConsoleDeps, "unit" | "now"> & { onChanged?: () => void }) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);

  async function view(repos: Parameters<Parameters<typeof unit.run>[0]>[0]): Promise<SecuritySettings> {
    const rows = (await repos.settings.all()).filter((r) => r.key === KEYS.sessions || r.key === KEYS.temp);
    const by = new Map(rows.map((r) => [r.key, r]));
    const changed = rows.filter((r) => r.updatedBy !== null).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    return {
      sessionMinutes: sessionMinutesOf(by.get(KEYS.sessions)?.value ?? null),
      tempPasswordMinutes: tempPasswordMinutesOf(by.get(KEYS.temp)?.value ?? null),
      updatedAt: changed ? changed.updatedAt.toISOString() : null,
      updatedBy: changed ? changed.updatedByName : null,
    };
  }

  async function get(session: VerifiedSession): Promise<SecuritySettings> {
    gate.superRead(session);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      return view(repos);
    });
  }

  async function update(session: VerifiedSession, input: SecuritySettingsInput, meta: PlatformMeta): Promise<SecuritySettings> {
    const probe = { action: "settings_updated", entity: "platform", entityId: null } as const;
    await gate.superWrite(session, meta, probe);
    const fields: Record<string, string> = {};
    for (const [kind, minutes] of Object.entries(input.sessionMinutes ?? {})) {
      if (!(SESSION_KINDS as readonly string[]).includes(kind)) fields[`sessionMinutes.${kind}`] = "Not a user kind.";
      else if (!validSessionMinutes(minutes)) fields[`sessionMinutes.${kind}`] = SESSION_MINUTES_PROBLEM;
    }
    if (input.tempPasswordMinutes !== undefined && !validTempPasswordMinutes(input.tempPasswordMinutes)) fields.tempPasswordMinutes = TEMP_PASSWORD_MINUTES_PROBLEM;
    if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
    const out = await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const at = now();
      const before = await view(repos);
      const changes: string[] = [];
      const next = { ...before.sessionMinutes };
      for (const kind of SESSION_KINDS) {
        const minutes = input.sessionMinutes?.[kind];
        if (minutes !== undefined && minutes !== before.sessionMinutes[kind]) {
          next[kind] = minutes;
          changes.push(`${SESSION_KIND_LABELS[kind]} signed in for ${durationText(minutes)}`);
        }
      }
      if (changes.length > 0) await repos.settings.set(KEYS.sessions, next, actor.userId, at);
      if (input.tempPasswordMinutes !== undefined && input.tempPasswordMinutes !== before.tempPasswordMinutes) {
        await repos.settings.set(KEYS.temp, input.tempPasswordMinutes, actor.userId, at);
        changes.push(`Temporary password works for ${durationText(input.tempPasswordMinutes)}`);
      }
      if (changes.length > 0) {
        await gate.audit(repos, actor, meta, {
          ...probe,
          reason: changes.join(", "),
          before: { sessionMinutes: before.sessionMinutes, tempPasswordMinutes: before.tempPasswordMinutes },
          after: { sessionMinutes: next, tempPasswordMinutes: input.tempPasswordMinutes ?? before.tempPasswordMinutes },
        });
      }
      return { settings: await view(repos), changed: changes.length > 0 };
    });
    if (out.changed) deps.onChanged?.();
    return out.settings;
  }

  return { get, update };
}

export type SecurityService = ReturnType<typeof createSecurityService>;
