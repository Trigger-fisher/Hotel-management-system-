import "server-only";
import type { Delivery, SecuritySeverity } from "../../repos/security";

// Outbound alerts of the security layer (plan section 7): Slack for Warning and Critical, plus an SMS for Critical. Dormant until configured (the variables are read by compose/security.ts):
// with nothing set every channel answers "skipped", never an error. Never throws: an alert that cannot be sent must not break the request that raised it. Repeats of the same alert are
// throttled in memory (per process) so a scanner hammering a honeypot cannot flood the channel or run up an SMS bill.

export type SmsConfig =
  | { provider: "msg91"; authKey: string; templateId: string; to: readonly string[] }
  | { provider: "twilio"; accountSid: string; authToken: string; from: string; to: readonly string[] };

export interface AlertConfig {
  /** Slack incoming webhook, https://hooks.slack.com/services/... only. */
  slackWebhook?: string;
  sms?: SmsConfig;
  fetch?: typeof fetch;
  now?: () => number;
  /** Same alert key within this time = throttled. Default: Slack 60 s, SMS 10 min. */
  slackEveryMs?: number;
  smsEveryMs?: number;
  timeoutMs?: number;
}

export interface AlertMessage {
  severity: SecuritySeverity;
  /** What repeats count as "the same alert". */
  key: string;
  text: string;
}

export interface AlertResult {
  slack: Delivery;
  sms: Delivery;
}

export const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{8,120}$/;
/** An Indian or international mobile number in E.164 form. */
export const PHONE = /^\+[1-9]\d{7,14}$/;

/** Slack treats & < > as markup (links, @channel): turned into text. */
export const slackEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function createAlertDispatcher(config: AlertConfig) {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const slackEvery = config.slackEveryMs ?? 60_000;
  const smsEvery = config.smsEveryMs ?? 600_000;
  const timeout = config.timeoutMs ?? 8_000;
  const lastSlack = new Map<string, number>();
  const lastSms = new Map<string, number>();

  const slackOn = config.slackWebhook !== undefined && SLACK_WEBHOOK.test(config.slackWebhook);
  const smsOn = config.sms !== undefined && config.sms.to.length > 0 && config.sms.to.every((p) => PHONE.test(p));

  /** True when the key was sent less than `every` ms ago; otherwise remembers it now. The map is bounded. */
  function throttled(map: Map<string, number>, key: string, every: number): boolean {
    const t = now();
    const prev = map.get(key);
    if (prev !== undefined && t - prev < every) return true;
    if (map.size >= 500) for (const [k, v] of map) if (t - v >= every) map.delete(k);
    if (map.size >= 500) map.clear();
    map.set(key, t);
    return false;
  }

  async function send(input: string, init: RequestInit): Promise<boolean> {
    try {
      const response = await doFetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(timeout) });
      await response.body?.cancel().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    }
  }

  async function slack(message: AlertMessage): Promise<Delivery> {
    if (!slackOn) return "skipped";
    if (throttled(lastSlack, message.key, slackEvery)) return "throttled";
    const icon = message.severity === "critical" ? ":rotating_light: *CRITICAL*" : ":warning: *Warning*";
    return (await send(config.slackWebhook!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `${icon} ${slackEscape(message.text)}` }) })) ? "sent" : "failed";
  }

  async function sms(message: AlertMessage): Promise<Delivery> {
    if (message.severity !== "critical" || !smsOn) return "skipped";
    if (throttled(lastSms, message.key, smsEvery)) return "throttled";
    const cfg = config.sms!;
    const body = message.text.slice(0, 140);
    if (cfg.provider === "msg91") {
      const ok = await send("https://control.msg91.com/api/v5/flow", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json", authkey: cfg.authKey },
        body: JSON.stringify({ template_id: cfg.templateId, short_url: "0", recipients: cfg.to.map((p) => ({ mobiles: p.replace("+", ""), var1: body })) }),
      });
      return ok ? "sent" : "failed";
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
    const auth = `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`;
    const results = await Promise.all(cfg.to.map((to) => send(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: auth }, body: new URLSearchParams({ To: to, From: cfg.from, Body: body }).toString() })));
    return results.every(Boolean) ? "sent" : "failed";
  }

  return {
    /** Which channels are switched on (for the Super Admin's status line; no value is ever shown). */
    channels: (): { slack: boolean; sms: boolean } => ({ slack: slackOn, sms: smsOn }),
    async dispatch(message: AlertMessage): Promise<AlertResult> {
      const [s, m] = await Promise.all([slack(message), sms(message)]);
      return { slack: s, sms: m };
    },
  };
}

export type AlertDispatcher = ReturnType<typeof createAlertDispatcher>;
