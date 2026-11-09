// Deliverability (platform migration 0130; MAIL-PROVIDERS-50K plan, session A's slice H1): the hold rules, the mail services' reports (Amazon SES through a signed SNS envelope, Brevo),
// the worker that never sends campaign mail to a suppressed address nor for a held hotel (system mail still goes), and the webhook and Super Admin routes through the real wrapper.
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { POST as mailEvents } from "../../src/app/api/v1/public/mail-events/[provider]/[key]/route";
import { GET as safetyGet, POST as safetySuppress } from "../../src/app/api/v1/platform/mail-safety/route";
import { POST as safetyRelease } from "../../src/app/api/v1/platform/mail-safety/hotels/[id]/release/route";
import { POST as safetyHold } from "../../src/app/api/v1/platform/mail-safety/hotels/[id]/hold/route";
import { POST as safetyRemove } from "../../src/app/api/v1/platform/mail-safety/suppressions/[id]/remove/route";
import { POST as rotateKey } from "../../src/app/api/v1/platform/mail-safety/webhooks/[provider]/rotate/route";
import { createArgon2Hasher } from "../../src/server/auth/password";
import { SESSION_COOKIE, hashSessionToken, newSessionToken } from "../../src/server/auth/tokens";
import { buildPlatformServices, configurePlatform, getPlatformMailSafety } from "../../src/server/compose/platform";
import { resetConfigCache } from "../../src/server/config/env";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import type { RouteDeps } from "../../src/server/http/wrapper";
import { createLogger } from "../../src/server/logger";
import { clearSnsCertCache, isSnsUrl, parseBrevoEvents, parseSesNotification, snsEnvelopeOf, snsStringToSign, verifySns, type SnsEnvelope } from "../../src/server/mail/events";
import { HOLD_LIMITS, holdVerdict, messageIdOf, outboxIdOfMessageId, rateWindowStart } from "../../src/server/mail/safety";
import { createMemoryProvisioner } from "../../src/server/provisioner/memory";
import type { PlatformUnit, UserRecord } from "../../src/server/repos/auth";
import { createMemoryAuth, memoryAuthRepos } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole, type MemHotelMeta } from "../../src/server/repos/memory/platformConsole";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { queueMail, runOutboxPass, type BulkPolicy, type MailMessage, type MailSender } from "../../src/server/services/auth/mail";
import { createSessionResolver } from "../../src/server/services/auth/sessionResolver";
import { webhookKey } from "../../src/server/services/platform/mailSafetyService";
import { catalog, makeSession } from "./helpers/session";

const T0 = new Date("2026-10-18T10:00:00Z");

describe("the hold rules (mail/safety.ts)", () => {
  test("too few mails are never judged; bounces over 5% of 200+ and complaints over 0.1% of 1000+ hold; the detail says the rate", () => {
    assert.equal(holdVerdict({ sent: HOLD_LIMITS.minSent - 1, bounced: 150, complained: 50 }), null);
    // at the limit is not over it
    assert.equal(holdVerdict({ sent: 1000, bounced: 50, complained: 1 }), null);
    assert.deepEqual(holdVerdict({ sent: 1000, bounced: 51, complained: 0 })?.reason, "bounces");
    assert.deepEqual(holdVerdict({ sent: 200, bounced: 11, complained: 0 })?.reason, "bounces");
    assert.match(holdVerdict({ sent: 400, bounced: 30, complained: 0 })?.detail ?? "", /bounces 7\.5% of 400 mails in 7 days/);
    assert.deepEqual(holdVerdict({ sent: 1000, bounced: 0, complained: 2 })?.reason, "complaints");
    assert.match(holdVerdict({ sent: 1000, bounced: 0, complained: 2 })?.detail ?? "", /complaints 0\.2% of 1000 mails .*limit 0\.1%/);
    // complaints need 1000 mails before they are judged: 2 in 999 is not a hold
    assert.equal(holdVerdict({ sent: HOLD_LIMITS.complaintMinSent - 1, bounced: 0, complained: 2 }), null);
    // complaints are judged first: they hurt the platform more
    assert.deepEqual(holdVerdict({ sent: 1000, bounced: 80, complained: 5 })?.reason, "complaints");
  });

  test("the window is the last seven days, or from the day after a release when that is later", () => {
    assert.equal(rateWindowStart(T0, null), "2026-10-12");
    assert.equal(rateWindowStart(T0, new Date("2026-10-01T09:00:00Z")), "2026-10-12");
    assert.equal(rateWindowStart(T0, new Date("2026-10-15T23:00:00Z")), "2026-10-16");
    assert.equal(rateWindowStart(T0, new Date("2026-10-18T09:00:00Z")), "2026-10-19", "released today: today's counts are left out");
  });

  test("our Message-ID names the outbox row and nothing else does", () => {
    const id = randomUUID();
    assert.equal(outboxIdOfMessageId(messageIdOf(id)), id);
    assert.equal(outboxIdOfMessageId(messageIdOf(id).slice(1, -1)), id, "without the angle brackets too");
    for (const other of [null, "", "<abc@mail.hms>", `<x.${id}@mail.hms>`, `<hms.${id}@other.host>`]) assert.equal(outboxIdOfMessageId(other), null, String(other));
  });
});

describe("the mail services' reports", () => {
  const ses = (over: Record<string, unknown>) => ({ mail: { messageId: "ses-1", commonHeaders: { messageId: "<hms.x@mail.hms>" } }, ...over });
  test("SES: a permanent bounce, a soft one, a complaint, the configuration-set form (eventType); deliveries are not events", () => {
    const hard = parseSesNotification(ses({ notificationType: "Bounce", bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ emailAddress: "A@Guest.In" }, { emailAddress: "not an address" }] } }));
    assert.deepEqual(hard, [{ kind: "bounce", email: "a@guest.in", permanent: true, detail: "Permanent/General", messageId: "<hms.x@mail.hms>" }]);
    assert.equal(parseSesNotification(ses({ notificationType: "Bounce", bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "b@g.in" }] } }))[0]?.permanent, false);
    assert.deepEqual(parseSesNotification(ses({ eventType: "Complaint", complaint: { complaintFeedbackType: "abuse", complainedRecipients: [{ emailAddress: "Name <c@g.in>" }] } })), [{ kind: "complaint", email: "c@g.in", permanent: false, detail: "complaint/abuse", messageId: "<hms.x@mail.hms>" }]);
    assert.deepEqual(parseSesNotification(ses({ notificationType: "Delivery" })), []);
    assert.deepEqual(parseSesNotification("junk"), []);
  });

  test("Brevo: hard and soft bounces, spam, unsubscribe, one event or a list; opens and clicks are not events", () => {
    const one = parseBrevoEvents({ event: "hard_bounce", email: "x@g.in", "message-id": "<m1>", reason: "550 no such user" });
    assert.deepEqual(one, [{ kind: "bounce", email: "x@g.in", permanent: true, detail: "hard_bounce/550 no such user", messageId: "<m1>" }]);
    const many = parseBrevoEvents([{ event: "soft_bounce", email: "s@g.in" }, { event: "spam", email: "p@g.in" }, { event: "unsubscribed", email: "u@g.in" }, { event: "opened", email: "o@g.in" }, { event: "spam" }]);
    assert.deepEqual(many.map((e) => [e.kind, e.email, e.permanent]), [["bounce", "s@g.in", false], ["complaint", "p@g.in", false], ["unsubscribe", "u@g.in", false]]);
  });

  describe("the SNS signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const CERT = "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem";
    const signed = (over: Partial<SnsEnvelope> = {}, version: "1" | "2" = "2"): SnsEnvelope => {
      const m: SnsEnvelope = { Type: "Notification", MessageId: randomUUID(), TopicArn: "arn:aws:sns:ap-south-1:1:hms-mail", Message: JSON.stringify({ notificationType: "Bounce" }), Timestamp: T0.toISOString(), SignatureVersion: version, Signature: "", SigningCertURL: CERT, ...over };
      m.Signature = createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256").update(snsStringToSign(m)).sign(privateKey, "base64");
      return m;
    };
    let fetched: string[] = [];
    const fetchCert = async (url: string) => {
      fetched.push(url);
      return pem;
    };
    beforeEach(() => {
      fetched = [];
      clearSnsCertCache();
    });

    test("a message signed with the certificate's key passes (versions 1 and 2, with and without a Subject); the certificate is fetched once", async () => {
      assert.equal(await verifySns(signed(), fetchCert, T0), true);
      assert.equal(await verifySns(signed({}, "1"), fetchCert, T0), true);
      assert.equal(await verifySns(signed({ Subject: "Amazon SES Email Event Notification" }), fetchCert, T0), true);
      const confirm = signed({ Type: "SubscriptionConfirmation", SubscribeURL: "https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=t", Token: "t" });
      assert.equal(await verifySns(confirm, fetchCert, T0), true);
      assert.deepEqual(fetched, [CERT]);
    });

    test("a changed message, an hour-old one, an unknown version or a certificate from anywhere but SNS fails (nothing is fetched for a wrong address)", async () => {
      const m = signed();
      assert.equal(await verifySns({ ...m, Message: m.Message.replace("Bounce", "Complaint") }, fetchCert, T0), false);
      assert.equal(await verifySns(signed(), fetchCert, new Date(T0.getTime() + 3_600_001)), false);
      assert.equal(await verifySns({ ...signed(), SignatureVersion: "3" }, fetchCert, T0), false);
      fetched = [];
      for (const url of ["http://sns.ap-south-1.amazonaws.com/a.pem", "https://sns.ap-south-1.amazonaws.com.evil.in/a.pem", "https://evil.in/sns.ap-south-1.amazonaws.com/a.pem", "https://sns.ap-south-1.amazonaws.com/a.txt", "https://sns.ap-south-1.amazonaws.com:8443/a.pem"]) {
        assert.equal(await verifySns(signed({ SigningCertURL: url }), fetchCert, T0), false, url);
      }
      assert.deepEqual(fetched, []);
    });

    test("only an SNS ConfirmSubscription address is opened; the envelope must have every signed field", () => {
      assert.equal(isSnsUrl("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x", "subscribe"), true);
      assert.equal(isSnsUrl("https://sns.us-east-1.amazonaws.com/?Action=Publish", "subscribe"), false);
      assert.equal(isSnsUrl("https://169.254.169.254/?Action=ConfirmSubscription", "subscribe"), false);
      assert.equal(snsEnvelopeOf({ Type: "Notification" }), null);
      assert.equal(snsEnvelopeOf({ ...signed(), Type: "Other" }), null);
      assert.ok(snsEnvelopeOf(signed()));
    });
  });
});

describe("the worker: held hotels and suppressed addresses", () => {
  const HOTEL = "11111111-1111-4111-8111-111111111111";
  function world() {
    const store = createMemoryAuth();
    const unit: PlatformUnit = { run: (work) => work(memoryAuthRepos(store.data())), read: (work) => work(memoryAuthRepos(store.data())) };
    const sent: MailMessage[] = [];
    const sender: MailSender = { send: async (m) => void sent.push(m) };
    const policy: BulkPolicy = { limitsOf: async () => ({ perSecond: 0, perDay: 0 }), sleep: async () => undefined };
    const pass = () => runOutboxPass({ unit, sender, now: () => T0, policy });
    const queue = (kind: "campaign" | "login_code", to: string) =>
      unit.run((r) => queueMail(r, { userId: null, kind, toEmail: to, payload: kind === "campaign" ? { name: "G", subject: "Offer", text: "t", unsubscribeUrl: "https://hms.test/api/v1/public/unsubscribe?x=1" } : { name: "S", code: "123456" }, hotelId: kind === "campaign" ? HOTEL : null }, T0));
    return { data: store.data, unit, sent, pass, queue };
  }

  test("a held hotel's campaign mail waits while a code still goes; after the release it goes", async () => {
    const w = world();
    await w.queue("campaign", "g1@x.in");
    await w.queue("login_code", "staff@x.in");
    await w.unit.run((r) => r.mailSafety.putOnHold({ hotelId: HOTEL, reason: "manual", detail: "test", heldBy: null }, T0));
    await w.pass();
    assert.deepEqual(w.sent.map((m) => m.to), ["staff@x.in"]);
    assert.equal(w.data().outbox.find((o) => o.toEmail === "g1@x.in")?.status, "pending");
    await w.unit.run((r) => r.mailSafety.release(HOTEL, randomUUID(), "fixed the list", T0));
    await w.pass();
    assert.deepEqual(w.sent.map((m) => m.to), ["staff@x.in", "g1@x.in"]);
  });

  test("campaign mail to a suppressed address (every hotel, or this hotel) fails at once as SUPPRESSED; others and system mail go", async () => {
    const w = world();
    await w.unit.run(async (r) => {
      await r.mailSafety.suppress({ email: "bounced@x.in", hotelId: null, reason: "bounce", source: "ses", detail: null, createdBy: null }, T0);
      await r.mailSafety.suppress({ email: "Spam@X.in", hotelId: HOTEL, reason: "complaint", source: "brevo", detail: null, createdBy: null }, T0);
      await r.mailSafety.suppress({ email: "other@x.in", hotelId: randomUUID(), reason: "complaint", source: "brevo", detail: null, createdBy: null }, T0);
    });
    for (const to of ["bounced@x.in", "SPAM@x.in", "other@x.in", "fine@x.in"]) await w.queue("campaign", to);
    await w.queue("login_code", "bounced@x.in");
    await w.pass();
    assert.deepEqual(w.sent.map((m) => m.to).sort(), ["bounced@x.in", "fine@x.in", "other@x.in"].sort());
    assert.equal(w.sent.filter((m) => m.to === "bounced@x.in").length, 1, "only the code went to the bounced address");
    const failed = w.data().outbox.filter((o) => o.status === "failed");
    assert.deepEqual(failed.map((o) => [o.toEmail, o.lastError, o.attempts, o.payload]).sort(), [["SPAM@x.in", "SUPPRESSED", 1, null], ["bounced@x.in", "SUPPRESSED", 1, null]]);
  });

  test("every mail carries our Message-ID; campaign mail also List-Unsubscribe", async () => {
    const w = world();
    await w.queue("campaign", "g@x.in");
    await w.queue("login_code", "s@x.in");
    await w.pass();
    const byTo = new Map(w.sent.map((m) => [m.to, m]));
    for (const [to, m] of byTo) assert.equal(outboxIdOfMessageId(m.messageId), w.data().outbox.find((o) => o.toEmail === to)?.id, to);
    assert.deepEqual(byTo.get("g@x.in")?.headers, { "List-Unsubscribe": "<https://hms.test/api/v1/public/unsubscribe?x=1>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    assert.equal(byTo.get("s@x.in")?.headers, undefined);
  });
});

describe("the webhook and the Super Admin's panel (routes)", () => {
  const ORIGIN = "https://hms.test";
  const HASH_KEY = randomBytes(32);
  const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
  const HOTEL = randomUUID();
  const COOKIES: Record<string, string> = {};
  let clock = T0;
  const now = (): Date => new Date(clock.getTime());

  function build() {
    const auth = createMemoryAuth();
    const cons = createMemoryPlatformConsole(auth);
    const data = auth.data();
    const viewer = randomUUID();
    data.roles.push({ id: viewer, hotelId: null, key: "viewer", level: 1, inherits: true });
    data.hotels.push({ id: HOTEL, name: "Hotel Sunrise", status: "active" } as never);
    const meta: MemHotelMeta = {
      slug: "hotel-sunrise", city: "Rajkot", state: "Gujarat", gstin: "24ABCDE1234F1Z5", timeZone: "Asia/Kolkata", createdAt: T0, provisionedAt: T0, submittedAt: null, approvedAt: null, rejectedAt: null,
      rejectReason: null, suspendedAt: null, suspendReason: null, archivedAt: null, archiveReason: null, restoreUntil: null, statusBeforeArchive: null, lastActivityAt: null, deletedAt: null,
    };
    cons.data.hotels.set(HOTEL, meta);
    const person = (key: string, over: Partial<UserRecord>): void => {
      const id = randomUUID();
      data.users.push({
        id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: "x", accountRole: "hotel_user", status: "active", mustChangePassword: false,
        passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId: viewer, ...over,
      });
      cons.data.accountMeta.set(id, { createdAt: T0, createdBy: null });
      const token = newSessionToken();
      COOKIES[key] = token;
      data.sessions.push({ id: randomUUID(), userId: id, hotelId: null, client: "web", tokenHash: hashSessionToken(token), deviceLabel: null, userAgent: null, ip: null, issuedAt: now(), lastSeenAt: now(), expiresAt: new Date(now().getTime() + 120 * 60_000), revokedAt: null, revokedReason: null });
    };
    person("sa", { accountRole: "super_admin", displayName: "Sonal Super" });
    person("pa", { accountRole: "platform_admin", displayName: "Priya Platform" });
    const services = buildPlatformServices({
      unit: cons.unit, credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }), now, hasher, publicUrl: ORIGIN,
      newToken: () => randomBytes(8).toString("hex"), hashKey: HASH_KEY, provisioner: createMemoryProvisioner({ auth: () => auth.data(), console: () => cons.data, now }),
    });
    configurePlatform(services);
    const resolver = createSessionResolver({ unit: auth.unit, catalog, now, hashKey: () => HASH_KEY });
    const deps: RouteDeps = { resolveSession: resolver.resolveSession, catalog, idempotency: createMemoryIdempotencyStore(), logger: createLogger({ level: "silent", write: () => undefined }) };
    configureRoutes(deps);
    return { auth, cons };
  }
  let w: ReturnType<typeof build>;
  // the panel shows the webhook addresses only with a public address configured
  let publicUrl: string | undefined;
  before(() => {
    publicUrl = process.env.HMS_PUBLIC_URL;
    process.env.HMS_PUBLIC_URL = ORIGIN;
    resetConfigCache();
  });
  after(() => {
    if (publicUrl === undefined) delete process.env.HMS_PUBLIC_URL;
    else process.env.HMS_PUBLIC_URL = publicUrl;
    resetConfigCache();
  });
  beforeEach(() => {
    clock = T0;
    w = build();
  });

  type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
  async function call(route: Route, method: string, url: string, as: string | null, opts: { body?: unknown; params?: Record<string, string>; contentType?: string } = {}): Promise<{ status: number; data: any; error: any }> {
    const h: Record<string, string> = { host: "hms.test", "user-agent": "node-test/1.0", "x-forwarded-for": "203.0.113.7" };
    if (as) {
      h.cookie = `${SESSION_COOKIE}=${COOKIES[as]}`;
      h.origin = ORIGIN;
    }
    if (opts.body !== undefined) h["content-type"] = opts.contentType ?? "application/json";
    const res = await route(new Request(`${ORIGIN}${url}`, { method, headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(opts.params ?? {}) });
    const j = (await res.json()) as { data?: unknown; error?: unknown };
    return { status: res.status, data: j.data, error: j.error };
  }
  const brevo = (events: unknown, key = webhookKey(HASH_KEY, "brevo")) => call(mailEvents, "POST", `/api/v1/public/mail-events/brevo/${key}`, null, { body: events, params: { provider: "brevo", key } });
  const sentMail = (to: string) => {
    const id = randomUUID();
    w.auth.data().outbox.push({ id, userId: null, hotelId: HOTEL, kind: "campaign", toEmail: to, template: "campaign-x", payload: null, status: "sent", attempts: 1, nextAttemptAt: T0, sentAt: T0, createdAt: T0, lastError: null });
    return id;
  };

  test("a wrong or missing key is a 404 and records nothing; the SES key does not open Brevo's door", async () => {
    for (const key of ["", "x", webhookKey(HASH_KEY, "ses"), webhookKey(randomBytes(32), "brevo")]) {
      const r = await brevo({ event: "hard_bounce", email: "x@g.in" }, key);
      assert.equal(r.status, 404, key);
    }
    assert.deepEqual(w.auth.data().suppressions, []);
  });

  test("Brevo: a hard bounce suppresses for every hotel; a complaint (found through our Message-ID) only for the hotel that sent it; counts go to that hotel", async () => {
    const id = sentMail("p@g.in");
    const r = await brevo([{ event: "hard_bounce", email: "X@g.in" }, { event: "spam", email: "p@g.in", "message-id": messageIdOf(id) }, { event: "delivered", email: "d@g.in" }]);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.deepEqual(r.data, { recorded: 2, held: 0, repeated: 0 });
    assert.deepEqual(w.auth.data().suppressions.map((s) => [s.email, s.hotelId, s.reason, s.source]).sort(), [["p@g.in", HOTEL, "complaint", "brevo"], ["x@g.in", null, "bounce", "brevo"]]);
    const day = T0.toISOString().slice(0, 10);
    assert.deepEqual(w.auth.data().sendCounts.map((c) => [c.scope, c.day, c.bounced, c.complained]).sort(), [["platform", day, 1, 0], [HOTEL, day, 0, 1]].sort());
    // the same report again changes nothing in the list (one row per address and hotel)
    await brevo([{ event: "hard_bounce", email: "x@g.in" }]);
    assert.equal(w.auth.data().suppressions.length, 2);
  });

  test("a hotel past the bounce limit is held automatically (one audit row), and the Super Admin sees it and releases it; a Platform Admin may not", async () => {
    const day = T0.toISOString().slice(0, 10);
    w.auth.data().sendCounts.push({ scope: HOTEL, day, sent: 400 });
    for (let i = 0; i < 21; i += 1) sentMail(`b${i}@g.in`);
    const r = await brevo(Array.from({ length: 21 }, (_, i) => ({ event: "hard_bounce", email: `b${i}@g.in` })));
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.held, 1);
    const holds = w.cons.data.audit.filter((a) => a.action === "mail_hold");
    assert.equal(holds.length, 1);
    assert.equal(holds[0].actorName, "Mail safety (automatic)");
    assert.match(String(holds[0].reason), /bounces 5\.3% of 400 mails/);
    // a second report while held does not hold again
    await brevo([{ event: "hard_bounce", email: "b0@g.in" }]);
    assert.equal(w.cons.data.audit.filter((a) => a.action === "mail_hold").length, 1);

    const view = await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa");
    assert.equal(view.status, 200, JSON.stringify(view.error));
    assert.equal(view.data.ready, true);
    assert.deepEqual(view.data.holds.map((h: { hotelName: string; held: boolean; reason: string; heldByName: string | null }) => [h.hotelName, h.held, h.reason, h.heldByName]), [["Hotel Sunrise", true, "bounces", null]]);
    assert.equal(view.data.suppressions.length, 21);
    assert.equal((await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "pa")).status, 403);

    const refused = await call(safetyRelease, "POST", `/api/v1/platform/mail-safety/hotels/${HOTEL}/release`, "pa", { body: { reason: "List cleaned" }, params: { id: HOTEL } });
    assert.equal(refused.status, 403);
    const released = await call(safetyRelease, "POST", `/api/v1/platform/mail-safety/hotels/${HOTEL}/release`, "sa", { body: { reason: "List cleaned" }, params: { id: HOTEL } });
    assert.equal(released.status, 200, JSON.stringify(released.error));
    assert.equal(w.auth.data().mailHolds[0].releasedAt?.getTime(), T0.getTime());
    // released today: today's counts no longer hold it again
    await brevo([{ event: "hard_bounce", email: "b1@g.in" }]);
    assert.equal(w.auth.data().mailHolds[0].releasedAt !== null, true);
    assert.equal((await call(safetyRelease, "POST", `/api/v1/platform/mail-safety/hotels/${HOTEL}/release`, "sa", { body: { reason: "again" }, params: { id: HOTEL } })).status, 409);
  });

  test("the Super Admin suppresses an address by hand and lifts it; a hold by hand; each an audit row", async () => {
    const add = await call(safetySuppress, "POST", "/api/v1/platform/mail-safety", "sa", { body: { email: " Someone@Guest.IN ", hotelId: null } });
    assert.equal(add.status, 201, JSON.stringify(add.error));
    assert.deepEqual(add.data, { suppressed: true });
    assert.equal((await call(safetySuppress, "POST", "/api/v1/platform/mail-safety", "sa", { body: { email: "x@g.in", hotelId: randomUUID() } })).status, 422);
    const row = w.auth.data().suppressions[0];
    assert.deepEqual([row.email, row.reason, row.source], ["someone@guest.in", "manual", "manual"]);
    const gone = await call(safetyRemove, "POST", `/api/v1/platform/mail-safety/suppressions/${row.id}/remove`, "sa", { params: { id: row.id } });
    assert.equal(gone.status, 200, JSON.stringify(gone.error));
    assert.deepEqual(w.auth.data().suppressions, []);
    const hold = await call(safetyHold, "POST", `/api/v1/platform/mail-safety/hotels/${HOTEL}/hold`, "sa", { body: { reason: "Complaint from a guest by phone" }, params: { id: HOTEL } });
    assert.equal(hold.status, 200, JSON.stringify(hold.error));
    assert.equal((await call(safetyHold, "POST", `/api/v1/platform/mail-safety/hotels/${HOTEL}/hold`, "sa", { body: { reason: "again please" }, params: { id: HOTEL } })).status, 409);
    assert.deepEqual(w.cons.data.audit.map((a) => a.action).filter((a) => a.startsWith("mail_")), ["mail_suppressed", "mail_unsuppressed", "mail_hold"]);
  });

  // security review round 2: M2 (key in the path, SNS topic pinned, repeats counted once) and L8 (each provider's key replaced on its own)
  test("an API key (read or full) never sees the webhook addresses (R3-3): the answer has webhooks null and no key material; the browser session still gets them", async () => {
    const sa = w.auth.data().users.find((u) => u.username === "sa")!;
    const asKey = (level: "read" | "full") => ({
      ...makeSession({ userId: sa.id, accountRole: "super_admin" }),
      client: "token" as const,
      token: { id: randomUUID(), name: "Test key", level, scope: "platform" as const, testMode: true, callsPerMinute: 60, ip: null, newIp: false },
    });
    const secret = webhookKey(HASH_KEY, "ses");
    for (const level of ["read", "full"] as const) {
      const view = await getPlatformMailSafety().view(asKey(level));
      assert.equal(view.webhooks, null, level);
      assert.ok(!JSON.stringify(view).includes(secret) && !JSON.stringify(view).includes(webhookKey(HASH_KEY, "brevo")), "no key material anywhere in the answer");
    }
    const browser = await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa");
    assert.ok(browser.data.webhooks.ses.endsWith(`/ses/${secret}`));
  });

  test("the key is a PATH segment and the panel shows it so; a repeated Brevo event counts once (the receipt), a new one counts", async () => {
    const view = await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa");
    assert.equal(view.data.webhooks.brevo, `${ORIGIN}/api/v1/public/mail-events/brevo/${webhookKey(HASH_KEY, "brevo")}`);
    assert.ok(!String(view.data.webhooks.ses).includes("?"), "no query string");
    assert.deepEqual([view.data.previousKeyUntil, view.data.snsTopicArn], [{ ses: null, brevo: null }, null]);
    const event = { id: 77, event: "hard_bounce", email: "dup@g.in", "message-id": "<m1@x>", ts_event: 1760781600 };
    assert.deepEqual((await brevo([event])).data, { recorded: 1, held: 0, repeated: 0 });
    assert.deepEqual((await brevo([event, event])).data, { recorded: 0, held: 0, repeated: 2 }, "a replay, and a list that repeats it");
    const day = T0.toISOString().slice(0, 10);
    assert.equal(w.auth.data().sendCounts.find((c) => c.scope === "platform" && c.day === day)?.bounced, 1, "counted once");
    assert.deepEqual((await brevo([{ ...event, id: 78, ts_event: 1760781700 }])).data, { recorded: 1, held: 0, repeated: 0 }, "another event of the same address counts");
    // receipts are kept a week, then forgotten
    clock = new Date(T0.getTime() + 8 * 86_400_000);
    assert.deepEqual((await brevo([event])).data.repeated, 0);
  });

  test("Replace key (Super Admin only): the new address works at once, the old one for one more day; the other provider keeps its key; audited", async () => {
    const old = webhookKey(HASH_KEY, "brevo");
    assert.equal((await call(rotateKey, "POST", "/api/v1/platform/mail-safety/webhooks/brevo/rotate", "pa", { params: { provider: "brevo" } })).status, 403);
    const r = await call(rotateKey, "POST", "/api/v1/platform/mail-safety/webhooks/brevo/rotate", "sa", { params: { provider: "brevo" } });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.previousUntil, new Date(T0.getTime() + 24 * 3_600_000).toISOString());
    const fresh = webhookKey(HASH_KEY, "brevo", 1);
    assert.notEqual(fresh, old);
    const view = (await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa")).data;
    assert.ok(view.webhooks.brevo.endsWith(`/brevo/${fresh}`));
    assert.ok(view.webhooks.ses.endsWith(`/ses/${webhookKey(HASH_KEY, "ses")}`), "SES keeps its key");
    assert.deepEqual(view.previousKeyUntil, { ses: null, brevo: r.data.previousUntil });
    const e = (n: number) => [{ id: n, event: "spam", email: `k${n}@g.in` }];
    assert.equal((await brevo(e(1), fresh)).status, 200);
    assert.equal((await brevo(e(2), old)).status, 200, "the old address, within the day");
    clock = new Date(T0.getTime() + 24 * 3_600_000 + 1000);
    assert.equal((await brevo(e(3), old)).status, 404, "the old address after the day");
    assert.equal((await brevo(e(4), fresh)).status, 200);
    const audit = w.cons.data.audit.find((a) => a.action === "settings_updated" && a.targetLabel === "Mail report address (Brevo)" && a.result === "success");
    assert.ok(w.cons.data.audit.some((a) => a.action === "settings_updated" && a.result === "failed" && a.actorRole === "platform_admin"), "the refused try is audited too");
    assert.match(String(audit?.reason), /New secret key; the old address works until/);
  });

  describe("Amazon SES through the route: signed, from the pinned topic, each message once", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const CERT = "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-route.pem";
    const TOPIC = "arn:aws:sns:ap-south-1:1:hms-mail";
    const envelope = (over: Partial<SnsEnvelope> = {}): SnsEnvelope => {
      const message = { notificationType: "Bounce", bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ emailAddress: "gone@g.in" }] }, mail: {} };
      const m: SnsEnvelope = { Type: "Notification", MessageId: randomUUID(), TopicArn: TOPIC, Message: JSON.stringify(message), Timestamp: new Date().toISOString(), SignatureVersion: "2", Signature: "", SigningCertURL: CERT, ...over };
      m.Signature = createSign("RSA-SHA256").update(snsStringToSign(m)).sign(privateKey, "base64");
      return m;
    };
    const ses = (body: SnsEnvelope, key = webhookKey(HASH_KEY, "ses")) => call(mailEvents, "POST", `/api/v1/public/mail-events/ses/${key}`, null, { body, params: { provider: "ses", key }, contentType: "text/plain; charset=UTF-8" });
    const realFetch = globalThis.fetch;
    beforeEach(() => {
      clearSnsCertCache();
      globalThis.fetch = (async (url: string | URL) => (String(url) === CERT ? new Response(pem) : new Response("no", { status: 404 }))) as typeof fetch;
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    test("the first signed message pins its topic; another topic is refused (403) and records nothing; a repeated MessageId counts once", async () => {
      const first = envelope();
      const r = await ses(first);
      assert.equal(r.status, 200, JSON.stringify(r.error));
      assert.deepEqual(r.data, { recorded: 1, held: 0, repeated: 0 });
      assert.equal((await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa")).data.snsTopicArn, TOPIC);
      assert.deepEqual((await ses(first)).data, { recorded: 0, held: 0, repeated: 1 }, "SNS delivered it again");
      const other = await ses(envelope({ TopicArn: "arn:aws:sns:ap-south-1:999:somebody-else" }));
      assert.equal(other.status, 403);
      assert.equal(w.auth.data().suppressions.length, 1);
      // replacing the SES key KEEPS the pin (R3-4): another topic is still refused through the new address and through the old one within its day
      assert.equal((await call(rotateKey, "POST", "/api/v1/platform/mail-safety/webhooks/ses/rotate", "sa", { params: { provider: "ses" } })).status, 200);
      assert.equal((await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa")).data.snsTopicArn, TOPIC);
      const elsewhere = () => envelope({ TopicArn: "arn:aws:sns:ap-south-1:1:hms-mail-2" });
      assert.equal((await ses(elsewhere(), webhookKey(HASH_KEY, "ses", 1))).status, 403);
      assert.equal((await ses(elsewhere(), webhookKey(HASH_KEY, "ses", 0))).status, 403);
      assert.equal((await ses(envelope(), webhookKey(HASH_KEY, "ses", 0))).status, 200, "the old address still carries the pinned topic's reports for its day");
      assert.equal((await ses(envelope(), webhookKey(HASH_KEY, "ses", 1))).status, 200);
    });

    test("the previous address (its day of grace) can never set the topic: with none pinned yet it is refused, the new address pins", async () => {
      assert.equal((await call(rotateKey, "POST", "/api/v1/platform/mail-safety/webhooks/ses/rotate", "sa", { params: { provider: "ses" } })).status, 200);
      const old = await ses(envelope({ TopicArn: "arn:aws:sns:ap-south-1:999:evil" }), webhookKey(HASH_KEY, "ses", 0));
      assert.equal(old.status, 403);
      assert.equal((await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa")).data.snsTopicArn, null, "nothing pinned by the old address");
      assert.equal((await ses(envelope(), webhookKey(HASH_KEY, "ses", 1))).status, 200);
      assert.equal((await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa")).data.snsTopicArn, TOPIC);
    });

    test("an unsigned or tampered message is refused before the topic is pinned", async () => {
      const m = envelope();
      assert.equal((await ses({ ...m, TopicArn: "arn:aws:sns:ap-south-1:999:evil" })).status, 403, "the signature covers the topic");
      assert.equal((await call(safetyGet, "GET", "/api/v1/platform/mail-safety", "sa")).data.snsTopicArn, null);
    });
  });
});
