import "server-only";
import { isSecretSettingGroup, platformSetupSession } from "../../auth/secretSettings";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import { randomBytes } from "node:crypto";
import type { BackupService } from "../admin/backupService";
import type { RazorpayService } from "../admin/razorpayService";
import type { SettingsBody } from "../admin/schemas";
import type { SettingsService } from "../admin/settingsService";
import type { SettingsService as WebsiteSettingsService } from "../website/settingsService";
import { createGate, type AuditInput, type Gate, type PlatformMeta } from "./access";

// One hotel's secret set-up from the Set-up centre (MJ, 5 Nov 2026): its mail server, both online payment accounts (hotel and food), its backup and its website's Google keys. The Super Admin only (gate.superRead /
// superWrite, a refused write audited as failed); the work is the hotel's own settings code, run in that hotel's unit with the set-up session (no visit needed). A hotel session never
// reaches these (settingsService and backupService refuse it with "This is set up by the platform team.").

export type HotelSetupGroup = "email" | "razorpay_hotel" | "razorpay_food" | "backup";
export type BackupStep = "status" | "connect" | "disconnect" | "test" | "run";
export type PayBusiness = "hotel" | "food";

/** One business's online payment as the Set-up centre's payments wizard draws it: whether each secret is saved, never the secret. */
export interface PaySetupView {
  business: PayBusiness;
  mode: "test" | "live";
  keyId: string;
  keySecretSet: boolean;
  webhookUrl: string;
  webhookSecretSet: boolean;
  webhookSecretAt: string | null;
  enabled: boolean;
  lastWebhookAt: string | null;
  lastPaymentAt: string | null;
  lastTest: { at: string; ok: boolean; message: string } | null;
}

export interface PaySaveInput {
  business: PayBusiness;
  mode?: "test" | "live";
  keyId?: string;
  keySecret?: string;
  enabled?: boolean;
}

export interface BackupSaveInput {
  clientId?: string;
  clientSecret?: string;
  keepDays?: number;
}

/** The backup wizard's view: Drive link state, the Google client (secret only as saved or not) and days kept. */
export interface BackupSetupView {
  connected: boolean;
  redirectUri: string;
  lastAt: string | null;
  lastResult: string | null;
  clientId: string;
  clientSecretSet: boolean;
  keepDays: number;
}

const KEY_ID = (mode: "test" | "live") => new RegExp(`^rzp_${mode}_[A-Za-z0-9]{8,32}$`);
const PAY_FIX = "Copy the Key ID and Key secret again from Razorpay Dashboard > Account and settings > API keys, save them, then test again.";

export function createHotelSetupService(deps: { unit: PlatformConsoleUnit; now: () => Date; settings: () => SettingsService; backup: () => BackupService; website?: () => WebsiteSettingsService; razorpay?: () => RazorpayService; gate?: Gate }) {
  const gate = deps.gate ?? createGate(deps.unit, deps.now);
  const probe = (hotelId: string, what: string): AuditInput => ({ action: "settings_updated", entity: "hotel", entityId: hotelId, hotelId, reason: `setup:${what}` });

  const browserOnly = (session: VerifiedSession): void => {
    if (session.token !== undefined || session.visit !== undefined) throw new AppError("FORBIDDEN", "Set-up is done in the browser by the Super Admin, outside any hotel visit.");
  };
  async function hotelOf(hotelId: string): Promise<{ id: string; name: string }> {
    const h = await deps.unit.run((repos) => repos.hotels.get(hotelId, deps.now()));
    if (!h) throw new AppError("NOT_FOUND", "This hotel was not found.");
    return { id: h.id, name: h.name };
  }
  const websiteOf = (): WebsiteSettingsService => {
    if (!deps.website) throw new AppError("CONFLICT", "The hotel website is not available on this server.");
    return deps.website();
  };
  const groupOrFail = (group: string): HotelSetupGroup => {
    if (!isSecretSettingGroup(group)) throw new AppError("NOT_FOUND", "There is no such set-up for a hotel.");
    return group as HotelSetupGroup;
  };
  async function done(session: VerifiedSession, meta: PlatformMeta, hotel: { id: string; name: string }, what: string): Promise<void> {
    await deps.unit.run(async (repos) => gate.audit(repos, await gate.actor(repos, session), meta, { ...probe(hotel.id, what), targetLabel: hotel.name }));
  }
  async function write(session: VerifiedSession, hotelId: string, meta: PlatformMeta, what: string) {
    await gate.superWrite(session, meta, probe(hotelId, what));
    browserOnly(session);
    const hotel = await hotelOf(hotelId);
    return { hotel, as: platformSetupSession(session, hotel.id) };
  }

  const razorpayOf = (): RazorpayService => {
    if (!deps.razorpay) throw new AppError("CONFLICT", "Online payments are not available on this server.");
    return deps.razorpay();
  };
  async function payFields(as: VerifiedSession, b: PayBusiness) {
    const prefix = `razorpay_${b}.`;
    return new Map((await deps.settings().overview(as, `razorpay_${b}`)).current.fields.map((f) => [f.key.slice(prefix.length), f]));
  }
  async function payViews(as: VerifiedSession): Promise<PaySetupView[]> {
    const [facts, tests] = await Promise.all([razorpayOf().setupFacts(as), lastTests(as.hotelId)]);
    return Promise.all(
      (["hotel", "food"] as const).map(async (b): Promise<PaySetupView> => {
        const f = await payFields(as, b);
        return {
          business: b,
          mode: f.get("mode")?.value === "live" ? "live" : "test",
          keyId: (f.get("key_id")?.value ?? "").trim(),
          keySecretSet: f.get("key_secret")?.set === true,
          webhookUrl: facts[b].webhookUrl,
          webhookSecretSet: f.get("webhook_secret")?.set === true,
          webhookSecretAt: f.get("webhook_secret")?.savedAt ?? null,
          enabled: f.get("enabled")?.value === "1",
          lastWebhookAt: facts[b].lastWebhookAt,
          lastPaymentAt: facts[b].lastPaymentAt,
          lastTest: tests[b],
        };
      }),
    );
  }
  const viewOf = async (as: VerifiedSession, b: PayBusiness): Promise<PaySetupView> => (await payViews(as)).find((v) => v.business === b) as PaySetupView;
  /** The hotel's own settings save, given every field of the group (a field not sent is read as empty there); an empty secret keeps the saved one. */
  async function savePay(as: VerifiedSession, b: PayBusiness, next: { enabled: boolean; mode: string; keyId: string; keySecret?: string; webhookSecret?: string }, clear: string[], meta: PlatformMeta) {
    const k = (name: string) => `razorpay_${b}.${name}`;
    const values: Record<string, string | boolean> = { [k("enabled")]: next.enabled, [k("mode")]: next.mode, [k("key_id")]: next.keyId, ...(next.keySecret ? { [k("key_secret")]: next.keySecret } : {}), ...(next.webhookSecret ? { [k("webhook_secret")]: next.webhookSecret } : {}) };
    await deps.settings().update(as, `razorpay_${b}`, { values, ...(clear.length ? { clear } : {}) }, meta);
  }

  async function backupFields(as: VerifiedSession) {
    return new Map((await deps.settings().overview(as, "backup")).current.fields.map((f) => [f.key.slice("backup.".length), f]));
  }
  async function backupView(as: VerifiedSession): Promise<BackupSetupView> {
    const [status, f] = await Promise.all([deps.backup().status(as), backupFields(as)]);
    return { ...status, clientId: (f.get("client_id")?.value ?? "").trim(), clientSecretSet: f.get("client_secret")?.set === true, keepDays: Number(f.get("keep_days")?.value) || 30 };
  }
  const TEST_REASON = (b: PayBusiness) => `setup:payments_${b}_test`;
  async function lastTests(hotelId: string): Promise<Record<PayBusiness, PaySetupView["lastTest"]>> {
    const one = async (b: PayBusiness): Promise<PaySetupView["lastTest"]> => {
      const row = (await deps.unit.run((repos) => repos.audit.activity({ hotelId, words: [TEST_REASON(b)] }, { offset: 0, limit: 1 }))).rows[0];
      if (!row) return null;
      const ok = row.reason === `${TEST_REASON(b)}:ok`;
      return { at: row.at.toISOString(), ok, message: ok ? "The keys worked." : "The keys did not work." };
    };
    const [hotel, food] = await Promise.all([one("hotel"), one("food")]);
    return { hotel, food };
  }

  return {
    /** One group as the hotel's Settings would draw it (secrets never returned, only whether one is saved). */
    async settings(session: VerifiedSession, hotelId: string, group: string) {
      gate.superRead(session);
      browserOnly(session);
      const key = groupOrFail(group);
      const hotel = await hotelOf(hotelId);
      return (await deps.settings().overview(platformSetupSession(session, hotel.id), key)).current;
    },

    async saveSettings(session: VerifiedSession, hotelId: string, group: string, body: SettingsBody, meta: PlatformMeta) {
      const key = groupOrFail(group);
      const { hotel, as } = await write(session, hotelId, meta, key);
      const result = await deps.settings().update(as, key, body, meta);
      await done(session, meta, hotel, key);
      return result;
    },

    async testEmail(session: VerifiedSession, hotelId: string, input: { to?: string }, meta: PlatformMeta) {
      const { as } = await write(session, hotelId, meta, "email_test");
      return deps.settings().testEmail(as, input, meta);
    },

    async testMailConnection(session: VerifiedSession, hotelId: string, meta: PlatformMeta) {
      const { as } = await write(session, hotelId, meta, "email_connection_test");
      return deps.settings().testMailConnection(as, meta);
    },

    async checkDomain(session: VerifiedSession, hotelId: string, meta: PlatformMeta) {
      const { as } = await write(session, hotelId, meta, "email_check_domain");
      return deps.settings().checkDomain(as);
    },

    /** Both online payment accounts (hotel, food) as the payments wizard draws them. */
    async payments(session: VerifiedSession, hotelId: string): Promise<{ items: PaySetupView[] }> {
      gate.superRead(session);
      browserOnly(session);
      const hotel = await hotelOf(hotelId);
      return { items: await payViews(platformSetupSession(session, hotel.id)) };
    },

    /**
     * One step of the payments wizard: the mode, the keys, or online payment on or off. The Key ID must belong to the mode (rzp_test_ or rzp_live_). Choosing the other mode
     * clears keys of the old mode, so the next step asks for the right ones. Switching on needs both keys saved.
     */
    async savePayments(session: VerifiedSession, hotelId: string, input: PaySaveInput, meta: PlatformMeta): Promise<PaySetupView> {
      const b = input.business;
      const { hotel, as } = await write(session, hotelId, meta, `payments_${b}`);
      const f = await payFields(as, b);
      const mode = input.mode ?? (f.get("mode")?.value === "live" ? "live" : "test");
      const word = mode === "live" ? "Live" : "Test";
      let keyId = input.keyId !== undefined ? input.keyId.trim() : (f.get("key_id")?.value ?? "").trim();
      const secret = (input.keySecret ?? "").trim();
      const clear: string[] = [];
      if (input.keyId !== undefined && keyId !== "" && !KEY_ID(mode).test(keyId)) {
        const msg = `This is not a ${word} Key ID. A ${word} Key ID starts with rzp_${mode}_ and is followed by letters and numbers.`;
        throw new AppError("VALIDATION_FAILED", msg, { fields: { keyId: msg } });
      }
      if (input.keyId === undefined && keyId !== "" && !keyId.startsWith(`rzp_${mode}_`)) {
        keyId = "";
        if (f.get("key_secret")?.set) clear.push(`razorpay_${b}.key_secret`);
      }
      if (secret !== "" && (secret.length > 200 || /\s/.test(secret))) {
        const msg = "The Key secret has a space in it or is too long. Copy it again from Razorpay.";
        throw new AppError("VALIDATION_FAILED", msg, { fields: { keySecret: msg } });
      }
      const secretSaved = secret !== "" || (f.get("key_secret")?.set === true && clear.length === 0);
      if (input.enabled === true && (keyId === "" || !secretSaved)) throw new AppError("CONFLICT", "Save the Key ID and the Key secret first, then switch online payment on.");
      const enabled = keyId === "" || !secretSaved ? false : (input.enabled ?? f.get("enabled")?.value === "1");
      await savePay(as, b, { enabled, mode, keyId, ...(secret ? { keySecret: secret } : {}) }, clear, meta);
      await done(session, meta, hotel, `payments_${b}`);
      return viewOf(as, b);
    },

    /** A new webhook secret, made here and shown ONCE in the answer (to paste in the Razorpay dashboard); afterwards only "saved on" is told. */
    async makeWebhookSecret(session: VerifiedSession, hotelId: string, b: PayBusiness, meta: PlatformMeta): Promise<{ secret: string; setup: PaySetupView }> {
      const { hotel, as } = await write(session, hotelId, meta, `payments_${b}_webhook_secret`);
      const f = await payFields(as, b);
      const secret = randomBytes(24).toString("base64url");
      await savePay(as, b, { enabled: f.get("enabled")?.value === "1", mode: f.get("mode")?.value === "live" ? "live" : "test", keyId: (f.get("key_id")?.value ?? "").trim(), webhookSecret: secret }, [], meta);
      await done(session, meta, hotel, `payments_${b}_webhook_secret`);
      return { secret, setup: await viewOf(as, b) };
    },

    /** Test: one read from Razorpay with the saved keys; nothing is charged. The answer is plain words and, when it failed, the next step. */
    async testPayments(session: VerifiedSession, hotelId: string, b: PayBusiness, meta: PlatformMeta): Promise<{ ok: boolean; message: string; hint: string | null }> {
      const { hotel, as } = await write(session, hotelId, meta, `payments_${b}_test`);
      const f = await payFields(as, b);
      if ((f.get("key_id")?.value ?? "").trim() === "" || f.get("key_secret")?.set !== true) return { ok: false, message: "The keys are not saved yet.", hint: "Go back to the Keys step and save the Key ID and the Key secret." };
      let result: { ok: boolean; message: string; hint: string | null };
      try {
        await razorpayOf().testKeys(as, b);
        result = { ok: true, message: f.get("mode")?.value === "live" ? "The keys work: Razorpay answered. Nothing was charged." : "The keys work in Test mode: Razorpay answered. No real money moves yet.", hint: null };
      } catch (e) {
        result = { ok: false, message: e instanceof AppError ? e.message : "Razorpay did not answer.", hint: e instanceof AppError ? PAY_FIX : "Try again in a minute. If it keeps failing, check that the server can reach the internet." };
      }
      await done(session, meta, hotel, `payments_${b}_test:${result.ok ? "ok" : "failed"}`);
      return result;
    },

    async backup(session: VerifiedSession, hotelId: string, step: BackupStep, meta: PlatformMeta) {
      if (step === "status") {
        gate.superRead(session);
        browserOnly(session);
        const hotel = await hotelOf(hotelId);
        return backupView(platformSetupSession(session, hotel.id));
      }
      const { hotel, as } = await write(session, hotelId, meta, `backup_${step}`);
      const b = deps.backup();
      const result = step === "connect" ? await b.connect(as) : step === "disconnect" ? await b.disconnect(as, meta) : step === "test" ? await b.test(as) : await b.run(as);
      if (step === "disconnect") await done(session, meta, hotel, "backup_disconnect");
      return result;
    },

    /** The backup wizard's Google client and how many days to keep; a field not sent keeps what is saved, the secret is never sent back. */
    async saveBackup(session: VerifiedSession, hotelId: string, input: BackupSaveInput, meta: PlatformMeta): Promise<BackupSetupView> {
      const { hotel, as } = await write(session, hotelId, meta, "backup");
      const f = await backupFields(as);
      const values: Record<string, string | boolean> = {
        "backup.enabled": f.get("enabled")?.value === "1",
        "backup.client_id": input.clientId !== undefined ? input.clientId.trim() : (f.get("client_id")?.value ?? ""),
        "backup.keep_days": String(input.keepDays ?? (Number(f.get("keep_days")?.value) || 30)),
        ...(input.clientSecret?.trim() ? { "backup.client_secret": input.clientSecret.trim() } : {}),
      };
      await deps.settings().update(as, "backup", { values }, meta);
      await done(session, meta, hotel, "backup");
      return backupView(as);
    },
    /** How this hotel's guest ID pictures are stored (MJ, 5 Nov 2026): a sharp copy under 500 KB (the default) or an exact copy (bigger files). */
    async idPhotos(session: VerifiedSession, hotelId: string): Promise<{ exactCopy: boolean }> {
      gate.superRead(session);
      browserOnly(session);
      const hotel = await hotelOf(hotelId);
      return { exactCopy: await deps.unit.run((repos) => repos.hotels.idPhotoExact(hotel.id)) };
    },

    /** The switch is saved and audited (before and after) in one unit; HMS copies it into each ID picture job (intake_jobs.lossless). */
    async saveIdPhotos(session: VerifiedSession, hotelId: string, exactCopy: boolean, meta: PlatformMeta): Promise<{ exactCopy: boolean }> {
      const { hotel } = await write(session, hotelId, meta, "id_photos");
      await deps.unit.run(async (repos) => {
        const before = await repos.hotels.idPhotoExact(hotel.id);
        await repos.hotels.setIdPhotoExact(hotel.id, exactCopy);
        await gate.audit(repos, await gate.actor(repos, session), meta, { ...probe(hotel.id, "id_photos"), targetLabel: hotel.name, before: { exactCopy: before }, after: { exactCopy } });
      });
      return { exactCopy };
    },

    /** The website's Google keys (Maps key, Business Profile sign-in client): never a secret back. */
    async website(session: VerifiedSession, hotelId: string) {
      gate.superRead(session);
      browserOnly(session);
      const hotel = await hotelOf(hotelId);
      return websiteOf().setupView(platformSetupSession(session, hotel.id));
    },

    async saveWebsite(session: VerifiedSession, hotelId: string, input: { gbpOauthClientId?: string; newGoogleMapsApiKey?: string; newGbpOauthClientSecret?: string }, meta: PlatformMeta) {
      const { hotel, as } = await write(session, hotelId, meta, "website_google");
      const result = await websiteOf().setupSave(as, input, meta);
      await done(session, meta, hotel, "website_google");
      return result;
    },

    async websiteGoogle(session: VerifiedSession, hotelId: string, step: "connect" | "disconnect", meta: PlatformMeta) {
      const { hotel, as } = await write(session, hotelId, meta, `website_google_${step}`);
      if (step === "connect") await websiteOf().googleConnect(as);
      else await websiteOf().googleDisconnect(as, meta);
      if (step === "disconnect") await done(session, meta, hotel, "website_google_disconnect");
      return websiteOf().setupView(as);
    },
  };
}

export type HotelSetupService = ReturnType<typeof createHotelSetupService>;
