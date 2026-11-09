import "server-only";
import type { SettingsMap, SettingsMapItem } from "@shared/dashboards/admin";
import { adminCopy } from "@shared/dashboards/admin";
import type { VerifiedSession } from "../../auth/session";
import type { RoomRepo } from "../../repos/frontOffice";
import type { Unit } from "../../repos/types";
import { requireSuperAdmin, type AdminUnitRepos } from "./context";

// The Settings home as a map (MJ's plan, H12): one row per area a hotel must set up (profile, bill header, email, rooms, rates, staff, website, online
// payments), each with what is there now and a link to the real page. Read only; it is the "Set up your hotel" checklist turned into a status board for
// every hotel, new or old. The facts come from the hotel's own tables (settings rows, rooms, plan rates), the people side (user count) and the platform
// (the website switch); `buildSettingsMap` is pure and tested on its own.

export interface SettingsFacts {
  settings: ReadonlyMap<string, string>;
  rooms: number;
  planRates: number;
  /** Active people in this hotel, the signed-in Super Admin included. */
  users: number;
  /** null: the hotel has no website row at all. */
  site: { live: boolean; domains: number } | null;
}

const C = adminCopy.settings.map;

export function buildSettingsMap(f: SettingsFacts): SettingsMap {
  const v = (key: string): string => (f.settings.get(key) ?? "").trim();
  const items: SettingsMapItem[] = [];
  const add = (id: string, state: SettingsMapItem["state"], detail: string | null, view: string, params?: Record<string, string>) => {
    const copy = C.items[id as keyof typeof C.items];
    items.push({ id, label: copy.label, help: copy.help, icon: copy.icon, state, detail, view, ...(params ? { params } : {}) });
  };
  const name = v("general.site_name");
  const address = v("general.address");
  const phone = v("general.support_phone");
  add("profile", name && (address || phone) ? "done" : name ? "partial" : "todo", name ? [name, phone].filter(Boolean).join(", ") : null, "hotel.admin.settings", { tab: "general" });
  const gstin = v("billing.hotel_gstin");
  add("billing", gstin ? "done" : "todo", gstin || null, "hotel.admin.settings", { tab: "billing" });
  // No "email" step: a hotel sends through the platform's mail, which only the Super Admin sets up (MJ, 1 Nov 2026).
  add("rooms", f.rooms > 0 ? "done" : "todo", f.rooms > 0 ? C.count(f.rooms, "room") : null, "hotel.fo.rooms");
  add("rates", f.planRates > 0 ? "done" : "todo", f.planRates > 0 ? C.count(f.planRates, "plan rate") : null, "hotel.admin.masters", { list: "plan-rates" });
  add("staff", f.users > 1 ? "done" : "todo", f.users > 0 ? C.count(f.users, "person", "people") : null, "hotel.admin.users");
  add("website", f.site?.live ? "done" : f.site ? "partial" : "todo", f.site ? (f.site.live ? C.websiteLive(f.site.domains) : C.websiteOff) : null, "hotel.web.overview");
  const payOn = v("razorpay_hotel.enabled") === "1" || v("razorpay_food.enabled") === "1";
  const keys = v("razorpay_hotel.key_id") !== "" || v("razorpay_food.key_id") !== "";
  add("payments", payOn && keys ? "done" : payOn || keys ? "partial" : "todo", payOn && keys ? C.paymentsOn : null, "hotel.admin.settings", { tab: "razorpay_hotel" });
  const done = items.filter((i) => i.state === "done").length;
  return { items, done, total: items.length };
}

interface Deps {
  unit: Unit<AdminUnitRepos & { rooms: RoomRepo }>;
  users(session: VerifiedSession): Promise<number>;
  site(session: VerifiedSession): Promise<{ live: boolean; domains: number } | null>;
}

const KEYS = ["general.site_name", "general.address", "general.support_phone", "billing.hotel_gstin", "razorpay_hotel.enabled", "razorpay_food.enabled", "razorpay_hotel.key_id", "razorpay_food.key_id"];

export function createSettingsMapService(deps: Deps) {
  return {
    /** The map for the signed-in hotel (Super Admin). */
    async map(session: VerifiedSession): Promise<SettingsMap> {
      requireSuperAdmin(session, "Settings");
      const own = await deps.unit.run(session, async (repos) => ({
        settings: new Map((await repos.adminSettings.get(KEYS)).map((r) => [r.key, r.value ?? ""])),
        rooms: (await repos.rooms.all()).length,
        planRates: (await repos.planRates.list()).length,
      }));
      const [users, site] = await Promise.all([deps.users(session), deps.site(session)]);
      return buildSettingsMap({ ...own, users, site });
    },
  };
}

export type SettingsMapService = ReturnType<typeof createSettingsMapService>;
