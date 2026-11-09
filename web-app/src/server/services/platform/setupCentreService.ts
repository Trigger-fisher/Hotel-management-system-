import "server-only";
import { platformSetupSession } from "../../auth/secretSettings";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import type { BackupService } from "../admin/backupService";
import type { RazorpayService } from "../admin/razorpayService";
import type { SettingsService } from "../admin/settingsService";
import type { ConnectionService } from "../whatsapp/connectionService";
import { createGate, type AuditInput, type Gate, type PlatformMeta } from "./access";

// The Set-up centre's server side (MJ, 5 Nov 2026, rule 6): ONE status list of every outside service, platform-wide and per hotel, each Not set up / Working / Needs attention with one
// plain reason and the step of the wizard that fixes it; and ONE Test per service that answers in plain words. Super Admin only, in the browser. Statuses come from what is already kept
// (saved settings, the last test, the WhatsApp numbers' health); never a secret. In the demo (no database) every Test is simulated and says so; on the real server a Test runs only
// when the Super Admin presses it.

export type SetupStatus = "not_set_up" | "working" | "needs_attention";
export type SetupService = "mail" | "whatsapp" | "storage" | "hotel_mail" | "payments_hotel" | "payments_food" | "backup";

export interface SetupRow {
  /** Unique on the page: the service, and the hotel for a hotel's row. */
  id: string;
  service: SetupService;
  scope: "platform" | "hotel";
  hotelId: string | null;
  hotelName: string | null;
  name: string;
  status: SetupStatus;
  /** One plain sentence: what is true and what to do (null when Working needs no words). */
  reason: string | null;
  /** The wizard step the next-step button opens (platform.setup params.step). */
  step: string;
}

export interface SetupOverview {
  /** True in the demo: statuses are sample ones and every Test is simulated. */
  demo: boolean;
  rows: SetupRow[];
  counts: Record<SetupStatus, number>;
}

export interface SetupTestResult {
  ok: boolean;
  /** Plain words: what happened and, when it failed, what to do. */
  message: string;
  simulated: boolean;
}

export interface SetupCentreDeps {
  unit: PlatformConsoleUnit;
  now: () => Date;
  /** No database: the demo. */
  demo: boolean;
  settings: () => SettingsService;
  backup: () => BackupService;
  razorpay: () => RazorpayService;
  whatsapp: () => ConnectionService;
  /** The platform's own mail test (Platform settings' Send test email). */
  sendPlatformTest: (session: VerifiedSession, to: string, meta: PlatformMeta) => Promise<{ ok?: boolean; sent?: boolean; message: string }>;
  /** Photo storage (S3) is configured on this server. */
  photoStorage: () => boolean;
  gate?: Gate;
  /** At most this many hotels get their own rows (the rest are counted in a line of their own). */
  maxHotels?: number;
}

const fieldsOf = (g: { fields: { key: string; value: string | null; set: boolean }[] }): Map<string, { value: string | null; set: boolean }> => new Map(g.fields.map((f) => [f.key, { value: f.value, set: f.set }]));
const parsed = (s: unknown): { ok?: boolean; message?: string } | null => {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return v && typeof v === "object" ? (v as { ok?: boolean; message?: string }) : null;
  } catch {
    return null;
  }
};

export function createSetupCentreService(deps: SetupCentreDeps) {
  const { unit, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);
  const browserOnly = (session: VerifiedSession): void => {
    if (session.token !== undefined || session.visit !== undefined) throw new AppError("FORBIDDEN", "The Set-up centre is used in the browser by the Super Admin, outside any hotel visit.");
  };
  const row = (r: Omit<SetupRow, "id" | "hotelId" | "hotelName"> & { hotelId?: string; hotelName?: string }): SetupRow => ({ ...r, id: r.hotelId ? `${r.service}:${r.hotelId}` : r.service, hotelId: r.hotelId ?? null, hotelName: r.hotelName ?? null });

  async function platformRows(session: VerifiedSession): Promise<SetupRow[]> {
    const saved = await unit.run(async (repos) => new Map((await repos.settings.all()).map((r) => [r.key, r.value])));
    const host = String(saved.get("mail.smtp_host") ?? "").trim();
    const test = parsed(saved.get("mail.test_result"));
    const mail = row({
      service: "mail", scope: "platform", name: "Email for the platform", step: "mail",
      ...(host === "" ? { status: "not_set_up" as const, reason: "No mail service is set up, so no email goes out. Start with Amazon SES." } : test && test.ok === false ? { status: "needs_attention" as const, reason: "The last test email did not go out. Open the mail step and send a test." } : { status: "working" as const, reason: null }),
    });
    let wa: SetupRow;
    try {
      const { lines } = await deps.whatsapp().list(session);
      const live = lines.filter((l) => l.tokenState !== "disconnected");
      const trouble = live.find((l) => l.tokenState === "failing" || l.tokenState === "needs_reconnect" || l.status !== "active");
      wa = row({
        service: "whatsapp", scope: "platform", name: "WhatsApp numbers", step: "whatsapp",
        ...(live.length === 0 ? { status: "not_set_up" as const, reason: "No WhatsApp number is connected yet." } : trouble ? { status: "needs_attention" as const, reason: trouble.tokenState === "needs_reconnect" || trouble.tokenState === "failing" ? `${trouble.label} needs a new token.` : `${trouble.label} is paused.` } : { status: "working" as const, reason: null }),
      });
    } catch {
      wa = row({ service: "whatsapp", scope: "platform", name: "WhatsApp numbers", step: "whatsapp", status: "needs_attention", reason: "The WhatsApp numbers could not be read. Try again in a minute." });
    }
    const storage = row({ service: "storage", scope: "platform", name: "Photo storage", step: "storage", ...(deps.photoStorage() ? { status: "working" as const, reason: null } : { status: "not_set_up" as const, reason: "Photos are kept on this server only. Give the storage bucket details to keep them safe." }) });
    return [mail, wa, storage];
  }

  async function hotelRows(session: VerifiedSession): Promise<SetupRow[]> {
    const hotels = (await unit.run((repos) => repos.hotels.list({ words: [] } as never, now()))).filter((h) => h.status === "active" || h.status === "suspended").slice(0, deps.maxHotels ?? 200);
    const out: SetupRow[] = [];
    for (const h of hotels) {
      const as = platformSetupSession(session, h.id);
      const group = async (key: string) => fieldsOf((await deps.settings().overview(as, key)).current);
      try {
        for (const book of ["hotel", "food"] as const) {
          const f = await group(`razorpay_${book}`);
          const on = f.get(`razorpay_${book}.enabled`)?.value === "1";
          const keyId = (f.get(`razorpay_${book}.key_id`)?.value ?? "").trim();
          const secret = f.get(`razorpay_${book}.key_secret`)?.set === true;
          const name = book === "hotel" ? "Online payments (rooms)" : "Online payments (food)";
          out.push(row({
            service: book === "hotel" ? "payments_hotel" : "payments_food", scope: "hotel", hotelId: h.id, hotelName: h.name, name, step: `payments_${book}`,
            ...(keyId === "" && !secret ? { status: "not_set_up" as const, reason: "Not set up. Guests and companies pay at the hotel." } : !secret || keyId === "" ? { status: "needs_attention" as const, reason: "The key ID or the key secret is missing." } : !on ? { status: "needs_attention" as const, reason: "The keys are saved but online payment is switched off for guests." } : { status: "working" as const, reason: keyId.startsWith("rzp_test_") ? "Working in Test mode: no real money moves yet." : null }),
          }));
        }
        const mail = await group("email");
        const mode = mail.get("email.mode")?.value ?? "platform";
        out.push(row({ service: "hotel_mail", scope: "hotel", hotelId: h.id, hotelName: h.name, name: "Hotel email", step: "hotel_mail", ...(mode === "own" && (mail.get("email.username")?.value ?? "") === "" ? { status: "needs_attention" as const, reason: "Own mail is chosen but no address is saved." } : { status: "working" as const, reason: mode === "own" ? null : "Sends through the platform's mail." }) }));
        const backup = await deps.backup().status(as);
        out.push(row({ service: "backup", scope: "hotel", hotelId: h.id, hotelName: h.name, name: "Backup", step: "backup", ...(backup.connected ? { status: "working" as const, reason: backup.lastAt ? null : "Connected; the first backup runs tonight." } : { status: "not_set_up" as const, reason: "Google Drive is not connected for this hotel." }) }));
      } catch {
        out.push(row({ service: "hotel_mail", scope: "hotel", hotelId: h.id, hotelName: h.name, name: "Hotel set-up", step: "hotel", status: "needs_attention", reason: "This hotel's settings could not be read. Try again in a minute." }));
      }
    }
    return out;
  }

  const probe = (service: string): AuditInput => ({ action: "settings_updated", entity: "platform", entityId: null, reason: `setup_test:${service}` });

  return {
    /** Every service with its status, platform-wide first, then each hotel. Super Admin only. */
    async overview(session: VerifiedSession): Promise<SetupOverview> {
      gate.superRead(session);
      browserOnly(session);
      const rows = [...(await platformRows(session)), ...(await hotelRows(session))];
      const counts: Record<SetupStatus, number> = { not_set_up: 0, working: 0, needs_attention: 0 };
      for (const r of rows) counts[r.status]++;
      return { demo: deps.demo, rows, counts };
    },

    /**
     * Test one service: mail sends one email to `to` (default: the Super Admin's own address is the caller's to give), WhatsApp sends one message from `lineId` to `to`, payments ask Razorpay
     * for the account's refunds with the saved keys (a read: nothing is charged), backup writes and reads a small file. The demo only simulates, and says so.
     */
    async test(session: VerifiedSession, service: SetupService, input: { to?: string; hotelId?: string; lineId?: string }, meta: PlatformMeta): Promise<SetupTestResult> {
      await gate.superWrite(session, meta, probe(service));
      browserOnly(session);
      if (deps.demo) return { ok: true, simulated: true, message: "Simulated in the demo: nothing was sent and no outside service was called. On the real server this test runs for real." };
      const needHotel = (): string => {
        if (!input.hotelId) throw new AppError("VALIDATION_FAILED", "Choose the hotel.", { fields: { hotelId: "Choose the hotel." } });
        return input.hotelId;
      };
      const asHotel = async () => {
        const id = needHotel();
        const h = await unit.run((repos) => repos.hotels.get(id, now()));
        if (!h) throw new AppError("NOT_FOUND", "This hotel was not found.");
        return platformSetupSession(session, h.id);
      };
      const words = (e: unknown, fix: string): SetupTestResult => ({ ok: false, simulated: false, message: `${e instanceof AppError ? e.message : "The test did not finish."} ${fix}`.trim() });
      switch (service) {
        case "mail": {
          const to = (input.to ?? "").trim();
          if (to === "") throw new AppError("VALIDATION_FAILED", "Type your own email address to receive the test.", { fields: { to: "Type your own email address." } });
          try {
            const r = await deps.sendPlatformTest(session, to, meta);
            const ok = r.ok ?? r.sent ?? true;
            return { ok, simulated: false, message: ok ? `A test email was sent to ${to}. Check that it arrived.` : r.message };
          } catch (e) {
            return words(e, "Check the SMTP user and password from the Amazon SES console, then test again.");
          }
        }
        case "whatsapp": {
          if (!input.lineId || !input.to) throw new AppError("VALIDATION_FAILED", "Choose the number and type the mobile number to send the test to.", { fields: { to: "Type a mobile number." } });
          try {
            const r = await deps.whatsapp().test(session, input.lineId, input.to.replace(/\D/g, ""), meta);
            return { ok: r.ok, simulated: false, message: r.ok ? "The test message was sent. Check the phone." : (r.message ?? "The message did not go out. Check the token in WhatsApp Manager and test again.") };
          } catch (e) {
            return words(e, "Check the number's token in WhatsApp Manager, then test again.");
          }
        }
        case "payments_hotel":
        case "payments_food": {
          try {
            await deps.razorpay().refunds(await asHotel(), service === "payments_hotel" ? "hotel" : "food", 1);
            return { ok: true, simulated: false, message: "These keys work: Razorpay answered. Nothing was charged." };
          } catch (e) {
            return words(e, "Copy the Key ID and Key secret again from Razorpay Dashboard > Account and settings > API keys.");
          }
        }
        case "backup": {
          try {
            const r = await deps.backup().test(await asHotel());
            return { ok: true, simulated: false, message: r.message };
          } catch (e) {
            return words(e, "Connect Google Drive for this hotel, then test again.");
          }
        }
        case "hotel_mail": {
          try {
            const r = await deps.settings().testEmail(await asHotel(), { ...(input.to ? { to: input.to } : {}) }, meta);
            return { ok: r.sent, simulated: false, message: r.sent ? `A test email was sent to ${r.to}.` : `${r.message}${r.hint ? ` ${r.hint}` : ""}` };
          } catch (e) {
            return words(e, "Check the hotel's mail address and app password, then test again.");
          }
        }
        default:
          return { ok: false, simulated: false, message: "This service has no test yet." };
      }
    },
  };
}

export type SetupCentreService = ReturnType<typeof createSetupCentreService>;
