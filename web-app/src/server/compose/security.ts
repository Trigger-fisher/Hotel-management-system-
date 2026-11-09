import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { getHashKey } from "../crypto";
import { getLogger } from "../logger";
import { createMemorySecurity } from "../repos/memory/security";
import { createPgSecurity } from "../repos/postgres/security";
import type { SecurityRepo } from "../repos/security";
import { createAlertDispatcher, type AlertDispatcher, type SmsConfig } from "../services/security/alerts";
import { createCloudflareExecutor, createUnconnectedExecutor } from "../services/security/executors";
import { createSecurityEvents, type SecurityEvents } from "../services/security/events";
import { createResetService, type ResetService } from "../services/security/resets";

// The composition root of the security layer (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md): PostgreSQL when DATABASE_URL is set, memory otherwise. Alerts and the Cloudflare reset are
// dormant until their variables are set; layers 2 and 3 stay "not connected" until the VPS and the Supabase project exist.
interface Security {
  repo: SecurityRepo;
  alerts: AlertDispatcher;
  events: SecurityEvents;
  resets: ResetService;
}

let security: Security | null = null;

function smsOf(c: ReturnType<typeof getConfig>): SmsConfig | undefined {
  const to = (c.HMS_SECURITY_SMS_TO ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (c.HMS_SECURITY_SMS_PROVIDER === "msg91" && c.MSG91_AUTH_KEY && c.MSG91_TEMPLATE_ID) return { provider: "msg91", authKey: c.MSG91_AUTH_KEY, templateId: c.MSG91_TEMPLATE_ID, to };
  if (c.HMS_SECURITY_SMS_PROVIDER === "twilio" && c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN && c.TWILIO_FROM) return { provider: "twilio", accountSid: c.TWILIO_ACCOUNT_SID, authToken: c.TWILIO_AUTH_TOKEN, from: c.TWILIO_FROM, to };
  return undefined;
}

export function getSecurity(): Security {
  if (security) return security;
  const config = getConfig();
  const repo = config.DATABASE_URL ? createPgSecurity(getDatabase().pool) : createMemorySecurity();
  const alerts = createAlertDispatcher({ slackWebhook: config.HMS_SECURITY_SLACK_WEBHOOK, sms: smsOf(config) });
  const events = createSecurityEvents({ repo, alerts, log: (message, fields) => getLogger().warn(message, fields) });
  const resets = createResetService({
    repo, events,
    executors: {
      1: createCloudflareExecutor({ token: config.CLOUDFLARE_API_TOKEN, zoneId: config.CLOUDFLARE_ZONE_ID }),
      2: createUnconnectedExecutor("Not connected: the application server (Hostinger VPS) does not exist yet, expected about 14 Nov 2026."),
      3: createUnconnectedExecutor("Not connected: the Supabase project is not set up yet, expected about 14 Nov 2026."),
    },
  });
  security = { repo, alerts, events, resets };
  return security;
}

/** The key canary tokens are signed with (HMS_HASH_KEY); null when the server has none (a canary then records nothing). */
export function canaryKey(): Buffer | null {
  try {
    return getConfig().HMS_HASH_KEY ? getHashKey() : null;
  } catch {
    return null;
  }
}

/** Replaces the security layer (tests). */
export function configureSecurity(next: Security | null): void {
  security = next;
}
