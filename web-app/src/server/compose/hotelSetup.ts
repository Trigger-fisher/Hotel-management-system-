import "server-only";
import { getConfig } from "../config/env";
import { createHotelSetupService, type HotelSetupService } from "../services/platform/hotelSetupService";
import { createSetupCentreService, type SetupCentreService } from "../services/platform/setupCentreService";
import { getAdminBackup, getAdminRazorpay, getAdminSettings } from "./admin";
import { getPlatformConsoleUnit, getPlatformSettings } from "./platform";
import { getWebsiteSettings } from "./website";
import { getWhatsAppConnections } from "./whatsappConnections";

let made: HotelSetupService | null = null;
let centre: SetupCentreService | null = null;

/** One hotel's secret set-up (mail server, online payments, backup, website Google keys) from the Set-up centre: the Super Admin only. */
export function getHotelSetup(): HotelSetupService {
  return (made ??= createHotelSetupService({ unit: getPlatformConsoleUnit(), now: () => new Date(), settings: getAdminSettings, backup: getAdminBackup, website: getWebsiteSettings, razorpay: getAdminRazorpay }));
}

/** The Set-up centre's status list and Tests: the Super Admin only. Without a database it is the demo (every Test simulated). */
export function getSetupCentre(): SetupCentreService {
  return (centre ??= createSetupCentreService({
    unit: getPlatformConsoleUnit(),
    now: () => new Date(),
    demo: !getConfig().DATABASE_URL,
    settings: getAdminSettings,
    backup: getAdminBackup,
    razorpay: getAdminRazorpay,
    whatsapp: getWhatsAppConnections,
    sendPlatformTest: (session, to, meta) => getPlatformSettings().sendTest(session, to, meta),
    photoStorage: () => Boolean(getConfig().S3_BUCKET && getConfig().S3_ACCESS_KEY_ID),
  }));
}