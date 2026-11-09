import "server-only";
// Reads and checks the environment once, and fails fast with a clear message. Names only: a value (a password,
// a key, a connection string) is never put into a message, a log or a thrown error.
//
// What the running app may read is listed here and in docs/ENVIRONMENT.md. The root and owner URLs used by the
// database scripts are deliberately NOT here: the app never loads them (standard R5).
import path from "node:path";
import { z } from "zod";
import { parseHashKey } from "../crypto/hash";
import { parseDataKey } from "../crypto/fieldSeal";
import { parseSecretKey } from "../crypto/secretBox";

const postgresUrl = z.string().refine((value) => /^postgres(ql)?:\/\//.test(value), { message: "must be a postgres:// connection string" });

/** True when the check function accepts the value. Its error message (which names no value) is not used: a fixed message is. */
const accepts = (check: (value: string) => unknown) => (value: string): boolean => {
  try {
    check(value);
    return true;
  } catch {
    return false;
  }
};

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"], { message: "must be development, test or production" }).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"], { message: "must be debug, info, warn, error or silent" }).default("info"),
  /** Connection string for the limited app user (hms_app). Optional until the database exists. */
  DATABASE_URL: postgresUrl.optional(),
  DB_POOL_MAX: z.coerce.number({ message: "must be a number" }).int({ message: "must be a whole number" }).min(1, { message: "must be at least 1" }).max(100, { message: "must be 100 or less" }).default(20),
  /** Connections kept open between bursts (default 4; 0 for serverless, where each function instance is short-lived). */
  DB_POOL_MIN: z.coerce.number({ message: "must be a number" }).int({ message: "must be a whole number" }).min(0, { message: "must be 0 or more" }).max(100, { message: "must be 100 or less" }).default(4),
  /** Seconds an idle connection is kept (default 600; a few seconds on serverless). */
  DB_POOL_IDLE_SECONDS: z.coerce.number({ message: "must be a number" }).int({ message: "must be a whole number" }).min(1, { message: "must be at least 1" }).max(3600, { message: "must be 3600 or less" }).default(600),
  /** 1 when DATABASE_URL goes through a transaction pooler (the Supabase transaction pooler, PgBouncer): no connection startup options are sent (the hms_app role carries timezone=UTC itself). */
  DB_POOLED: z.enum(["1"], { message: "must be 1 or unset" }).optional(),
  /** Server secret for hashing one-time codes and sign-in identifiers (HMAC-SHA256): base64, at least 32 bytes. */
  HMS_HASH_KEY: z.string().refine(accepts(parseHashKey), { message: "must be base64 of at least 32 bytes" }).optional(),
  /** The key of the secret vault (AES-256-GCM): base64 of exactly 32 bytes. Separate from HMS_HASH_KEY. */
  HMS_SECRET_KEY: z.string().refine(accepts(parseSecretKey), { message: "must be base64 of exactly 32 bytes" }).optional(),
  /** The key of the sealed personal numbers (decision 74: ID, bank and IFSC numbers; AES-256-GCM plus a search index): base64 of exactly 32 bytes. Separate from HMS_SECRET_KEY and HMS_HASH_KEY. Becomes required in production when the numbers are switched to sealed storage. */
  HMS_DATA_KEY: z.string().refine(accepts(parseDataKey), { message: "must be base64 of exactly 32 bytes" }).optional(),
  /**
   * An OPTIONAL override of the key that seals the mail password (Platform settings > Mail, a hotel's Settings > Email; AES-256-GCM, a fresh random IV per value): base64 of
   * exactly 32 bytes. Unset (the normal case) = the key is derived from HMS_HASH_KEY with HKDF (mail/key.ts), so nothing extra has to be set up.
   */
  SMTP_SECRET_KEY: z.string().refine(accepts(parseSecretKey), { message: "must be base64 of exactly 32 bytes" }).optional(),
  /** The address people open in a browser (invitation links in e-mails are built from it): http(s), no path. Default http://localhost:3000. */
  HMS_PUBLIC_URL: z.string().refine((v) => /^https?:\/\/[^/\s]+\/?$/.test(v), { message: "must be an address without a path, like https://hms.example.in" }).optional(),
  /** How mail leaves: `log` (development: the terminal and db/.dev-mail.log, nothing is sent) or `smtp` (a real mail server). Default log. */
  MAIL_DRIVER: z.enum(["log", "smtp"], { message: "must be log or smtp" }).default("log"),
  /** The mail server (MAIL_DRIVER=smtp). A password here is read by the running app only; it is never logged or returned. */
  SMTP_HOST: z.string().regex(/^[A-Za-z0-9.-]+$/, { message: "must be a host name like smtp.example.com" }).optional(),
  SMTP_PORT: z.coerce.number({ message: "must be a number" }).int({ message: "must be a whole number" }).min(1, { message: "must be 1 to 65535" }).max(65535, { message: "must be 1 to 65535" }).default(587),
  /** true = TLS from the first byte (port 465); false = STARTTLS when the server offers it. Default: true only for port 465. */
  SMTP_SECURE: z.enum(["true", "false"], { message: "must be true or false" }).optional(),
  SMTP_USER: z.string().max(300).optional(),
  SMTP_PASS: z.string().max(1000).optional(),
  /** The sender address: `noreply@hotel.in` or `Hotel Pallav <noreply@hotel.in>`. Platform settings (mail.from_name / mail.from_email) win when set. */
  /** Where uploaded website photos are kept on disk (an absolute folder). Default web-app/.data/media. A hosted object store is a later adapter. */
  HMS_MEDIA_DIR: z.string().max(500).refine((v) => path.isAbsolute(v), { message: "must be an absolute folder path" }).optional(),
  /**
   * Where uploaded photos (website media, ID photos, menu photos, login photos) are kept: `local` (this server's disk), `db` (the platform database, table platform.media_files:
   * no bucket, nothing else to set up) or `s3` (an S3-compatible bucket). Unset: `db` on a hosted server (VERCEL) with a database, else `local` (mediaDriverOf).
   */
  MEDIA_DRIVER: z.enum(["local", "s3", "db"], { message: "must be local, db or s3" }).optional(),
  /**
   * The S3-compatible endpoint (MEDIA_DRIVER=s3): http(s), like https://s3.ap-south-1.amazonaws.com or https://<account>.r2.cloudflarestorage.com. Supabase Storage's has a fixed path,
   * https://<project>.storage.supabase.co/storage/v1/s3 (use S3_FORCE_PATH_STYLE=1 with it); no query and no fragment.
   */
  S3_ENDPOINT: z.string().refine((v) => /^https?:\/\/[^/\s?#]+(\/storage\/v1\/s3)?\/?$/.test(v), { message: "must be an address like https://s3.ap-south-1.amazonaws.com or https://<project>.storage.supabase.co/storage/v1/s3" }).optional(),
  S3_REGION: z.string().regex(/^[a-z0-9-]{1,40}$/, { message: "must be a region name like ap-south-1 (or auto)" }).optional(),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: "must be a bucket name (3 to 63 lower-case letters, digits, dots, dashes)" }).optional(),
  /** The bucket's access key (read by the running app only; never logged, never returned, never in an error). */
  S3_ACCESS_KEY_ID: z.string().min(1).max(200).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).max(500).optional(),
  /** 1 = path-style addresses (endpoint/bucket/key: MinIO and most self-hosted stores); unset = virtual-host style (bucket.endpoint/key). */
  S3_FORCE_PATH_STYLE: z.enum(["1"], { message: "must be 1 or unset" }).optional(),
  /** How the mail queue is sent: `in-process` (a timer in the server, default) or `cron` (no timer; a scheduler calls GET /api/v1/cron/mail with CRON_SECRET: serverless hosts). */
  HMS_MAIL_WORKER: z.enum(["in-process", "cron"], { message: "must be in-process or cron" }).default("in-process"),
  /** The bearer secret of the /api/v1/cron routes (at least 32 characters); unset = those routes answer 404. */
  CRON_SECRET: z.string().min(32, { message: "must be at least 32 characters" }).optional(),
  /** Hotel website templates (website-templates/docs/BACKEND.md): a GitHub token that may only START the "Create hotel site" workflow of GITHUB_SITES_REPO (fine-grained, Contents: read and write, or classic repo scope). Never logged or returned. */
  GITHUB_SITES_TOKEN: z.string().min(20, { message: "looks too short for a GitHub token" }).max(300).optional(),
  /** The repository that holds website-templates and the workflow, as owner/name. */
  GITHUB_SITES_REPO: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, { message: "must be owner/name, like acme/hms-sites" }).optional(),
  /** The shared secret the build job signs its reports with (HMAC-SHA256; at least 32 characters). The workflow holds the same value as the secret SITE_BUILD_SECRET. */
  SITE_BUILD_SECRET: z.string().min(32, { message: "must be at least 32 characters" }).optional(),
  /** Where error-level log lines are also POSTed as JSON (a Slack/Discord/Teams incoming webhook, Axiom, a monitor): https only, at most 20 a minute. Unset: no alerts. */
  HMS_ALERT_WEBHOOK: z.string().url({ message: "must be an https:// address" }).refine((v) => v.startsWith("https://"), { message: "must start with https://" }).optional(),
  /** Security alerts (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 7). Every one is optional: unset = that channel is dormant. Slack: an incoming webhook, https://hooks.slack.com/services/... */
  HMS_SECURITY_SLACK_WEBHOOK: z.string().regex(/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{8,120}$/, { message: "must be a Slack incoming webhook, https://hooks.slack.com/services/..." }).optional(),
  /** SMS for Critical alerts only: the provider, the numbers (E.164, comma separated) and that provider's keys. */
  HMS_SECURITY_SMS_PROVIDER: z.enum(["msg91", "twilio"], { message: "must be msg91 or twilio" }).optional(),
  HMS_SECURITY_SMS_TO: z.string().regex(/^\+[1-9]\d{7,14}(,\s*\+[1-9]\d{7,14})*$/, { message: "must be phone numbers like +919800000000, comma separated" }).optional(),
  MSG91_AUTH_KEY: z.string().min(8).max(200).optional(),
  MSG91_TEMPLATE_ID: z.string().min(4).max(100).optional(),
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-f]{32}$/i, { message: "must be the account SID, AC followed by 32 characters" }).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(16).max(100).optional(),
  TWILIO_FROM: z.string().regex(/^\+[1-9]\d{7,14}$/, { message: "must be a phone number like +12025550123" }).optional(),
  /** The Cloudflare zone for the layer 1 emergency reset: an API token limited to this zone (Zone Settings read, Firewall Services edit) and the zone id. */
  CLOUDFLARE_API_TOKEN: z.string().min(20).max(200).optional(),
  CLOUDFLARE_ZONE_ID: z.string().regex(/^[0-9a-f]{32}$/, { message: "must be the 32-character zone id" }).optional(),
  /** Cloudflare Turnstile on the sign-in forms. The secret key stays on the server (routes call http/turnstile.ts); the site key is public by design and is read by the browser. Set both or neither. */
  TURNSTILE_SECRET_KEY: z.string().regex(/^[0-9A-Za-z_-]{20,100}$/, { message: "must be the Turnstile secret key from the Cloudflare dashboard" }).optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().regex(/^[0-9A-Za-z_-]{10,100}$/, { message: "must be the Turnstile site key from the Cloudflare dashboard" }).optional(),
  /** Set by Vercel itself on its servers ("1"). Read only to know the app runs serverless: the mail worker must be cron, and a local media folder would not last. */
  VERCEL: z.string().optional(),
  /** DEVELOPMENT ONLY: relaxes the sign-in throttles for localhost. Refused (the app will not start) in production. */
  HMS_DEV_RELAX_LIMITS: z.enum(["1"], { message: "must be 1 or unset" }).optional(),
  /** Build-time switches of the web app, read here so production can refuse them: `NEXT_PUBLIC_HMS_LOCAL_DEMO=1` is the local demo build (mock data, no database). */
  NEXT_PUBLIC_HMS_LOCAL_DEMO: z.enum(["1"], { message: "must be 1 or unset" }).optional(),
  NEXT_PUBLIC_API: z.enum(["real", "mock"], { message: "must be real or mock" }).optional(),
  SMTP_FROM: z.string().max(300).refine((v) => /^([^<>"\r\n]+<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(v), { message: "must be an address like noreply@hotel.in or Name <noreply@hotel.in>" }).optional(),
});

/** The cross-field rules: a real mail server needs its host and a sender; a user without a password (or the reverse) is a mistake. */
const baseRules = (c: z.output<typeof baseSchema>, ctx: z.RefinementCtx): void => {
  if (c.MAIL_DRIVER === "smtp") {
    if (!c.SMTP_HOST) ctx.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "is required when MAIL_DRIVER is smtp" });
    if (!c.SMTP_FROM) ctx.addIssue({ code: "custom", path: ["SMTP_FROM"], message: "is required when MAIL_DRIVER is smtp" });
  }
  // the three website-template settings work only together: a token with no secret would start jobs whose reports could never be trusted
  const siteSet = [c.GITHUB_SITES_TOKEN, c.GITHUB_SITES_REPO, c.SITE_BUILD_SECRET].filter((v) => v !== undefined).length;
  if (siteSet > 0 && siteSet < 3) for (const name of ["GITHUB_SITES_TOKEN", "GITHUB_SITES_REPO", "SITE_BUILD_SECRET"] as const) if (c[name] === undefined) ctx.addIssue({ code: "custom", path: [name], message: "is required when any of GITHUB_SITES_TOKEN, GITHUB_SITES_REPO and SITE_BUILD_SECRET is set" });
  if (c.HMS_SECURITY_SMS_PROVIDER !== undefined) {
    const needs = c.HMS_SECURITY_SMS_PROVIDER === "msg91" ? (["HMS_SECURITY_SMS_TO", "MSG91_AUTH_KEY", "MSG91_TEMPLATE_ID"] as const) : (["HMS_SECURITY_SMS_TO", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"] as const);
    for (const name of needs) if (!c[name]) ctx.addIssue({ code: "custom", path: [name], message: `is required when HMS_SECURITY_SMS_PROVIDER is ${c.HMS_SECURITY_SMS_PROVIDER}` });
  }
  if ((c.CLOUDFLARE_API_TOKEN === undefined) !== (c.CLOUDFLARE_ZONE_ID === undefined)) ctx.addIssue({ code: "custom", path: [c.CLOUDFLARE_API_TOKEN === undefined ? "CLOUDFLARE_API_TOKEN" : "CLOUDFLARE_ZONE_ID"], message: "must be set together with " + (c.CLOUDFLARE_API_TOKEN === undefined ? "CLOUDFLARE_ZONE_ID" : "CLOUDFLARE_API_TOKEN") });
  if ((c.TURNSTILE_SECRET_KEY === undefined) !== (c.NEXT_PUBLIC_TURNSTILE_SITE_KEY === undefined)) ctx.addIssue({ code: "custom", path: [c.TURNSTILE_SECRET_KEY === undefined ? "TURNSTILE_SECRET_KEY" : "NEXT_PUBLIC_TURNSTILE_SITE_KEY"], message: "must be set together with " + (c.TURNSTILE_SECRET_KEY === undefined ? "NEXT_PUBLIC_TURNSTILE_SITE_KEY" : "TURNSTILE_SECRET_KEY") });
  if ((c.SMTP_USER === undefined) !== (c.SMTP_PASS === undefined)) ctx.addIssue({ code: "custom", path: [c.SMTP_USER === undefined ? "SMTP_USER" : "SMTP_PASS"], message: "must be set together with " + (c.SMTP_USER === undefined ? "SMTP_PASS" : "SMTP_USER") });
};

/**
 * PRODUCTION FAILS CLOSED. With NODE_ENV=production the app refuses to start unless the database, the hash key, an https public address and a real mail
 * server are all set, and no development switch is on. The one exception is the local demo build (NEXT_PUBLIC_HMS_LOCAL_DEMO=1: mock data on one machine):
 * it must have NO database, so a real database can never sit behind demo sign-ins. Every message names the variable and never a value.
 */
const productionRules = (c: z.output<typeof baseSchema>, ctx: z.RefinementCtx): void => {
  const issue = (name: string, message: string): void => void ctx.addIssue({ code: "custom", path: [name], message });
  if (c.NEXT_PUBLIC_HMS_LOCAL_DEMO === "1") {
    if (c.DATABASE_URL) issue("NEXT_PUBLIC_HMS_LOCAL_DEMO", "a local demo build must not be given a database (unset DATABASE_URL, or build without the demo flag)");
    return;
  }
  if (!c.DATABASE_URL) issue("DATABASE_URL", "is required in production");
  if (!c.HMS_HASH_KEY) issue("HMS_HASH_KEY", "is required in production");
  if (!c.HMS_SECRET_KEY) issue("HMS_SECRET_KEY", "is required in production");
  if (!c.HMS_PUBLIC_URL) issue("HMS_PUBLIC_URL", "is required in production");
  else if (!/^https:\/\//.test(c.HMS_PUBLIC_URL)) issue("HMS_PUBLIC_URL", "must start with https:// in production");
  else if (/^https:\/\/(localhost|127\.|\[::1\])/.test(c.HMS_PUBLIC_URL)) issue("HMS_PUBLIC_URL", "must be the public address, not localhost");
  if (c.MAIL_DRIVER !== "smtp") issue("MAIL_DRIVER", "must be smtp in production (the log driver prints one-time codes to a terminal)");
  if (c.HMS_DEV_RELAX_LIMITS !== undefined) issue("HMS_DEV_RELAX_LIMITS", "is a development switch and must not be set in production");
  if (c.NEXT_PUBLIC_API === "mock") issue("NEXT_PUBLIC_API", "mock is a development setting and must not be used in production");
  if (c.MEDIA_DRIVER === "s3") {
    for (const name of ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) if (!c[name]) issue(name, "is required in production when MEDIA_DRIVER is s3");
    if (c.S3_ENDPOINT && !/^https:\/\//.test(c.S3_ENDPOINT) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(c.S3_ENDPOINT)) issue("S3_ENDPOINT", "must start with https:// in production (plain http only to this machine)");
  }
  if (c.VERCEL && c.HMS_MAIL_WORKER !== "cron") issue("HMS_MAIL_WORKER", "must be cron on Vercel (a serverless function has no timer, so no sign-in code would ever be sent)");
  if (c.HMS_MAIL_WORKER === "cron" && !c.CRON_SECRET) issue("CRON_SECRET", "is required in production when HMS_MAIL_WORKER is cron (otherwise no mail is ever sent)");
};

const schema = baseSchema.superRefine(baseRules);
const productionSchema = baseSchema.superRefine((c, ctx) => {
  baseRules(c, ctx);
  if (c.NODE_ENV === "production") productionRules(c, ctx);
});

export type AppConfig = z.output<typeof schema>;

/**
 * Secrets that only the scripts in db/ may hold (they live in db/.env.local, which Next.js never loads). If the running
 * app's environment contains one, something is wrong (a copy in web-app/.env.local, or a shell that exports them), and in
 * production the app refuses to start. Only the NAME is ever reported.
 */
export const SCRIPT_ONLY_NAMES = ["PGSUPERUSER_URL", "PG_OWNER_URL", "PG_TEST_OWNER_URL", "PG_CONSOLE_URL", "PG_APP_DIRECT_URL"] as const;

/** Thrown when the environment is wrong. `problems` holds "NAME: what is wrong" lines, never values. */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** An empty string means "not set" (a blank line in an env file). */
function withoutBlanks(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(baseSchema.shape)) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}

/**
 * `build: true` is `next build` collecting page data: the production rules are not applied then (the build machine need not hold the secrets); they apply
 * the moment the server starts (src/instrumentation.ts).
 */
export function loadConfig(env: Env, options: { build?: boolean } = {}): AppConfig {
  if (env.NODE_ENV === "production") {
    const present = SCRIPT_ONLY_NAMES.filter((name) => (env[name] ?? "").trim() !== "");
    if (present.length > 0) throw new ConfigError(present.map((name) => `${name}: is a script-only secret and must not be in the app's environment (it belongs in db/.env.local)`));
  }
  const result = (options.build ? schema : productionSchema).safeParse(withoutBlanks(env));
  if (result.success) return result.data;
  throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join(".") || "(env)"}: ${issue.message}`));
}

let cached: AppConfig | undefined;

/** The checked config for this process (read once, then reused). */
export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env, { build: process.env.NEXT_PHASE === "phase-production-build" });
  return cached;
}

/** For tests only. */
export function resetConfigCache(): void {
  cached = undefined;
}

export const isDatabaseConfigured = (config: AppConfig): boolean => config.DATABASE_URL !== undefined;

/** Vercel (no lasting disk) with the local media driver and a real database: photos cannot be kept, so uploads are refused with a plain 503. */
/** The photo store in use: what MEDIA_DRIVER says; unset = `db` on a hosted server with a database (the disk does not last there), else `local`. */
export const mediaDriverOf = (config: Pick<AppConfig, "VERCEL" | "MEDIA_DRIVER" | "DATABASE_URL">): "local" | "s3" | "db" => config.MEDIA_DRIVER ?? (config.VERCEL && config.DATABASE_URL !== undefined ? "db" : "local");
/** A hosted server whose photo store is the disk (MEDIA_DRIVER=local set on purpose): nothing would last, so uploads are refused with a plain 503. */
export const photoStorageUnavailable = (config: Pick<AppConfig, "VERCEL" | "MEDIA_DRIVER" | "DATABASE_URL">): boolean => Boolean(config.VERCEL) && mediaDriverOf(config) === "local" && config.DATABASE_URL !== undefined;
