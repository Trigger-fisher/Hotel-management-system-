import "server-only";
import type { PlatformMailUsage } from "@shared/dashboards/platform";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { utcDay } from "../auth/mail";
import { createGate, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";

// Mail usage and the Super Admin's daily cap per hotel (MAIL-PROVIDERS-50K plan, 18 Oct 2026). The worker counts every sent mail per owner (a hotel, or the platform) per UTC day
// (platform.mail_send_counts, migration 0126); this reads them by month so the platform owner can see what each hotel used (and bill hotels later), and sets the most mails a hotel
// may send a day, whatever its own mail service allows. The cap lowers the figure of the hotel's service and never raises it. Super Admin only.

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MAX_CAP = 10_000_000;

export function createMailUsageService(deps: ConsoleDeps) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);

  /** `YYYY-MM-DD` of the first day of the month and of the next month. */
  function window(month: string): { from: string; to: string; days: number } {
    const m = MONTH.exec(month);
    if (!m) throw new AppError("VALIDATION_FAILED", "Enter the month as YYYY-MM.", { fields: { month: "Enter the month as YYYY-MM." } });
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    return { from: `${month}-01`, to: `${next}-01`, days: new Date(Date.UTC(y, mo, 0)).getUTCDate() };
  }

  /** Mails sent in a month per hotel (and by the platform itself), with today's count and the Super Admin's cap. Every listed hotel appears, those with no mail with 0. */
  async function report(session: VerifiedSession, month?: string): Promise<PlatformMailUsage> {
    gate.superRead(session);
    const at = now();
    const chosen = month ?? utcDay(at).slice(0, 7);
    const w = window(chosen);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      const hotels = await repos.hotels.list({ words: [] }, at);
      const ids = hotels.map((h) => h.id);
      const scopes = ["platform", ...ids];
      const [monthly, today, caps] = await Promise.all([repos.auth.outbox.usage(w.from, w.to, scopes), repos.auth.outbox.sentToday(scopes, utcDay(at)), repos.auth.outbox.caps(ids)]);
      const rows = hotels
        .map((h) => ({ hotelId: h.id, name: h.name, slug: h.slug, sentThisMonth: monthly.get(h.id) ?? 0, sentToday: today.get(h.id) ?? 0, dailyCap: caps.get(h.id) ?? null }))
        .sort((a, b) => b.sentThisMonth - a.sentThisMonth || a.name.localeCompare(b.name));
      return { month: chosen, days: w.days, platformSent: monthly.get("platform") ?? 0, totalSent: [...monthly.values()].reduce((a, n) => a + n, 0), hotels: rows };
    });
  }

  /** Sets the most mails a day one hotel may send (0 stops its campaigns; null removes the cap). Audited. */
  async function setCap(session: VerifiedSession, hotelId: string, dailyCap: number | null, meta: PlatformMeta): Promise<{ hotelId: string; dailyCap: number | null }> {
    const probe = { action: "settings_updated", entity: "hotel", entityId: hotelId, hotelId } as const;
    await gate.superWrite(session, meta, probe);
    if (dailyCap !== null && !(Number.isInteger(dailyCap) && dailyCap >= 0 && dailyCap <= MAX_CAP)) {
      throw new AppError("VALIDATION_FAILED", "Enter a whole number of mails a day, or leave it empty for no cap.", { fields: { dailyCap: "Enter a whole number of mails a day, or leave it empty for no cap." } });
    }
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      const hotel = await repos.hotels.get(hotelId, now());
      if (!hotel) throw new AppError("NOT_FOUND");
      const before = (await repos.auth.outbox.caps([hotelId])).get(hotelId) ?? null;
      const saved = await repos.auth.outbox.setCap(hotelId, dailyCap);
      if (!saved) throw new AppError("CONFLICT", "Mail caps need platform migration 0126. Run it first.");
      await gate.audit(repos, actor, meta, { ...probe, targetLabel: hotel.name, reason: dailyCap === null ? "Mail daily cap removed" : `Mail daily cap set to ${dailyCap} a day`, before: { dailyCap: before }, after: { dailyCap } });
      return { hotelId, dailyCap };
    });
  }

  return { report, setCap };
}

export type MailUsageService = ReturnType<typeof createMailUsageService>;
