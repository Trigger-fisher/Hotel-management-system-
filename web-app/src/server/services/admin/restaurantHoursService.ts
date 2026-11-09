import "server-only";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { ACCEPTING_KEY, checkHours, HOURS_KEY, hoursFromSettings, hoursToSettings, type RestaurantHours } from "../menu/hours";
import { actorOf, fieldError, logLine, type AdminDeps, type Who } from "./context";

// The restaurant's ordering hours (decision 52): the hotel admin's switch "accepting orders" and the hours per weekday. Master Data's permission (the
// room-service menu lives there too). The rules and the storage format are in services/menu/hours.ts; the guest side reads the same two settings.

const PART = "masters";

export function createRestaurantHoursService(deps: AdminDeps) {
  const { unit, catalog } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });

  return {
    async get(session: VerifiedSession): Promise<RestaurantHours> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const rows = new Map((await repos.adminSettings.get([ACCEPTING_KEY, HOURS_KEY])).map((r) => [r.key, r.value]));
        return hoursFromSettings(rows.get(ACCEPTING_KEY) as string | null | undefined, rows.get(HOURS_KEY) as string | null | undefined);
      });
    },

    async save(session: VerifiedSession, input: { accepting: boolean; days: { day: number; closed: boolean; opens: string; closes: string }[] }, meta: RequestMeta): Promise<RestaurantHours> {
      requirePermission(session, catalog, PART, "edit");
      const checked = checkHours(input);
      if (!checked.ok) throw fieldError("days", checked.message);
      const w = await who(session, meta);
      const stored = hoursToSettings(checked.hours);
      return unit.run(session, async (repos) => {
        await repos.adminSettings.set([{ key: ACCEPTING_KEY, value: stored.accepting, secret: false }, { key: HOURS_KEY, value: stored.hours, secret: false }], session.userId);
        await repos.systemLogs.write(logLine(w, "masters", { action: "updated", entity: "Restaurant hours", summary: `Restaurant hours saved (${checked.hours.accepting ? "accepting orders" : "not accepting orders"})`, subject: null }));
        return checked.hours;
      });
    },
  };
}

export type RestaurantHoursService = ReturnType<typeof createRestaurantHoursService>;
