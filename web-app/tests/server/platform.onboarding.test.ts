// Invitations, the PUBLIC onboarding form and the approval of what it created (P3; docs/BACKEND.md 14.4, 14.1, 14.3): through the REAL route files on the
// in-memory double and the memory provisioner. No token or hash in any answer, single-use links, the pending account that cannot sign in, approval that builds
// the hotel and activates the account (and a retry that completes a half-done approval), rejection with a reason, expiry / resend / cancel, the local
// provisioner that fails closed.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { GET as openRoute, POST as submitRoute } from "../../src/app/api/v1/onboarding/[token]/route";
import { POST as approveGroupRoute } from "../../src/app/api/v1/platform/groups/[id]/approve/route";
import { POST as rejectGroupRoute } from "../../src/app/api/v1/platform/groups/[id]/reject/route";
import { GET as groupsRoute } from "../../src/app/api/v1/platform/groups/route";
import { POST as approveRoute } from "../../src/app/api/v1/platform/hotels/[id]/approve/route";
import { POST as rejectRoute } from "../../src/app/api/v1/platform/hotels/[id]/reject/route";
import { GET as hotelRoute } from "../../src/app/api/v1/platform/hotels/[id]/route";
import { GET as hotelsRoute } from "../../src/app/api/v1/platform/hotels/route";
import { GET as devLinksRoute } from "../../src/app/api/v1/platform/invitations/dev-links/route";
import { POST as cancelRoute } from "../../src/app/api/v1/platform/invitations/[id]/cancel/route";
import { POST as resendRoute } from "../../src/app/api/v1/platform/invitations/[id]/resend/route";
import { GET as invitationsRoute, POST as sendRoute } from "../../src/app/api/v1/platform/invitations/route";
import { createArgon2Hasher } from "../../src/server/auth/password";
import type { VerifiedSession } from "../../src/server/auth/session";
import { buildPlatformServices, configurePlatform } from "../../src/server/compose/platform";
import { createMemoryIdempotencyStore } from "../../src/server/http/idempotency";
import { configureRoutes } from "../../src/server/http/route";
import { createLogger } from "../../src/server/logger";
import { createLocalProvisioner } from "../../src/server/provisioner/local";
import { ProvisionError } from "../../src/server/provisioner/port";
import { createMemoryProvisioner } from "../../src/server/provisioner/memory";
import type { UserRecord } from "../../src/server/repos/auth";
import { createMemoryAuth } from "../../src/server/repos/memory/auth";
import { createMemoryPlatformConsole } from "../../src/server/repos/memory/platformConsole";
import { createCredentialService } from "../../src/server/services/auth/credentialService";
import { catalog, makeSession } from "./helpers/session";

const ORIGIN = "https://hms.test";
const hasher = createArgon2Hasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
let clock = new Date("2026-10-05T10:00:00+05:30");
const now = (): Date => new Date(clock.getTime());
const PASSWORD = "Sunrise#2026x";

const U: Record<string, string> = {};
const sessions = new Map<string, VerifiedSession>();
type World = ReturnType<typeof build>;
let w: World;
let tokenSeq = 0;

function build() {
  const auth = createMemoryAuth();
  const cons = createMemoryPlatformConsole(auth);
  const data = auth.data();
  const role = (key: string, level: number): string => {
    const id = randomUUID();
    data.roles.push({ id, hotelId: null, key, level, inherits: true });
    return id;
  };
  const viewer = role("viewer", 1);
  const admin = role("admin", 3);
  const superRole = role("super_admin", 4);
  const person = (key: string, over: Partial<UserRecord>): void => {
    const id = randomUUID();
    U[key] = id;
    data.users.push({
      id, username: key, email: `${key}@demo.hms`, mobile: null, displayName: key.toUpperCase(), passwordHash: "x", accountRole: "hotel_user", status: "active", mustChangePassword: false,
      passwordChangedAt: null, failedAttempts: 0, lockLevel: 0, lockedUntil: null, blockedAt: null, blockedKind: null, codeRequired: false, lastLoginAt: null, deletedAt: null, roleId: viewer, ...over,
    });
    cons.data.accountMeta.set(id, { createdAt: new Date("2026-09-01T10:00:00+05:30"), createdBy: null });
  };
  person("pa", { accountRole: "platform_admin", roleId: admin, displayName: "Priya Platform", codeRequired: true });
  person("sa", { accountRole: "super_admin", roleId: superRole, displayName: "Sonal Super", codeRequired: true });
  person("staff", { accountRole: "hotel_user" });
  const provisioner = createMemoryProvisioner({ auth: () => auth.data(), console: () => cons.data, now });
  const services = buildPlatformServices({
    unit: cons.unit, credentials: (repos) => createCredentialService({ unit: { run: (work) => work(repos.auth) }, hasher, now }), now, hasher, publicUrl: ORIGIN,
    newToken: () => `tok${++tokenSeq}x${randomBytes(6).toString("hex")}`, hashKey: randomBytes(32), provisioner,
  });
  configurePlatform(services);
  return { auth, cons, provisioner };
}

beforeEach(() => {
  clock = new Date("2026-10-05T10:00:00+05:30");
  sessions.clear();
  w = build();
  for (const [key, accountRole] of [["pa", "platform_admin"], ["sa", "super_admin"], ["staff", "hotel_user"]] as const) sessions.set(key, makeSession({ hotelId: "", userId: U[key], accountRole, roleKey: "admin", roleLevel: 3 }));
  configureRoutes({
    resolveSession: async (r) => sessions.get(r.headers.get("x-test-session") ?? "") ?? null,
    catalog,
    idempotency: createMemoryIdempotencyStore(),
    logger: createLogger({ level: process.env.DBG ? "debug" : "silent", write: (l: string) => { if (process.env.DBG) process.stderr.write(`${l}\n`); } }),
  });
});

function req(method: string, path: string, who: string | null, body?: unknown): Request {
  const h: Record<string, string> = { host: "hms.test", origin: ORIGIN, "user-agent": "node-test/1.0" };
  if (who) h["x-test-session"] = who;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
async function call(route: Route, method: string, path: string, who: string | null, opts: { body?: unknown; params?: Record<string, string> } = {}): Promise<{ status: number; data: any; error: any; raw: string }> {
  const res = await route(req(method, path, who, opts.body), { params: Promise.resolve(opts.params ?? {}) });
  const raw = await res.text();
  const j = JSON.parse(raw);
  return { status: res.status, data: j.data, error: j.error, raw };
}

const invite = (body: object, who = "pa") => call(sendRoute, "POST", "/api/v1/platform/invitations", who, { body });
const mailsOf = (kind: string) => w.auth.data().outbox.filter((o) => o.kind === kind);
/** The one-time link the invitation mail carried: the token is only ever there. */
const tokenOf = (n = -1): string => new URL(JSON.parse(mailsOf("invitation").at(n)!.payload as string).link).searchParams.get("invite") as string;
const open = (token: string) => call(openRoute, "GET", `/api/v1/onboarding/${token}`, null, { params: { token } });
const hotelForm = (over: Record<string, unknown> = {}, admin: Record<string, unknown> = {}) => ({
  kind: "hotel" as const,
  hotel: { name: "Moonlight Inn", address: "12 Race Course Road", city: "Rajkot", state: "Gujarat", pin: "360001", gstin: "24ABCDE1234F1Z5", phone: "0281 2456789", email: "Info@Moonlight.in", logoName: "logo.png", ...over },
  admin: { name: "Meera Shah", username: "meera.shah", email: "Meera@Moonlight.in", mobile: "98240 12399", password: PASSWORD, passwordConfirm: PASSWORD, ...admin },
});
const groupForm = (over: Record<string, unknown> = {}) => ({
  kind: "group" as const,
  group: { name: "Sunrise Group", legalName: "Sunrise Hotels Pvt Ltd", gstin: "24ABCDE1234F1Z5", address: "1 Ring Road", city: "Rajkot", state: "Gujarat", pin: "360001", phone: "02812456789", email: "office@sunrise.in", ...over },
  admin: { name: "Kavita Desai", username: "kavita.d", email: "kavita@sunrise.in", mobile: "9824012300", password: PASSWORD, passwordConfirm: PASSWORD },
});
const submit = (token: string, form: object) => call(submitRoute, "POST", `/api/v1/onboarding/${token}`, null, { body: form, params: { token } });

async function sendIndividual(): Promise<{ id: string; token: string }> {
  const r = await invite({ hotelName: "Moonlight Inn", contactName: "Meera Shah", email: "Meera@Moonlight.in" });
  assert.equal(r.status, 201);
  return { id: r.data.invitation.id, token: tokenOf() };
}

describe("sending invitations", () => {
  test("the invitation is mailed with a one-time link; the answer and the list never carry the token or a hash", async () => {
    const r = await invite({ hotelName: " Moonlight Inn ", contactName: "Meera Shah", email: "Meera@Moonlight.in" });
    assert.equal(r.status, 201);
    assert.equal(r.data.linkNote, "Invitation link sent by email (dev log)");
    const i = r.data.invitation;
    assert.deepEqual([i.hotelName, i.email, i.type, i.status, i.sentBy, i.invitedByRole, i.resendCount, i.groupId], ["Moonlight Inn", "meera@moonlight.in", "individual", "sent", "Priya Platform", "platform_admin", 0, null]);
    assert.equal(new Date(i.expiresAt).getTime() - new Date(i.createdAt).getTime(), 168 * 3_600_000);
    const mail = mailsOf("invitation");
    assert.equal(mail.length, 1);
    assert.equal(mail[0].userId, null);
    assert.equal(mail[0].toEmail, "meera@moonlight.in");
    const token = tokenOf();
    assert.match(JSON.parse(mail[0].payload as string).link, /^https:\/\/hms\.test\/\?invite=tok1x/);
    const list = await call(invitationsRoute, "GET", "/api/v1/platform/invitations", "pa");
    assert.equal(list.data.total, 1);
    assert.ok(!list.raw.includes(token) && !r.raw.includes(token), "no token in any answer");
    const stored = w.cons.data.links[0].tokenHash;
    assert.ok(!list.raw.includes(stored) && !r.raw.includes(stored), "no hash either");
    assert.notEqual(stored, token);
    assert.equal(w.cons.data.audit.filter((a) => a.action === "invitation_sent").length, 1);
    assert.deepEqual((await call(devLinksRoute, "GET", "/api/v1/platform/invitations/dev-links", "pa")).data, []);
  });

  test("field errors, duplicates, groupId and member_hotel are refused with the contract's sentences; staff are 403", async () => {
    const bad = await invite({ hotelName: "", contactName: "", email: "nope" });
    assert.deepEqual(Object.keys(bad.error.details.fields).sort(), ["contactName", "email", "hotelName"]);
    await sendIndividual();
    const dup = await invite({ hotelName: "moonlight inn", contactName: "Other", email: "other@x.in" });
    assert.equal(dup.error.details.fields.hotelName, "An open invitation already exists for a hotel with this name. Resend it from the list, or cancel it first.");
    const dupMail = await invite({ hotelName: "Another Hotel", contactName: "Other", email: "MEERA@moonlight.in" });
    assert.match(dupMail.error.details.fields.email, /open invitation was already sent to this email/);
    const withGroup = await invite({ hotelName: "Third", contactName: "T", email: "t@x.in", groupId: randomUUID() });
    assert.equal(withGroup.error.details.fields.groupId, "A Platform Admin does not invite a hotel into a group. The group’s admin does that.");
    const member = await invite({ type: "member_hotel", hotelName: "Fourth", contactName: "F", email: "f@x.in" });
    assert.equal(member.status, 409);
    assert.equal((await invite({ hotelName: "X", contactName: "Y", email: "z@x.in" }, "staff")).status, 403);
    assert.equal(mailsOf("invitation").length, 1, "refused invitations mail nothing");
    assert.equal((await invite({ hotelName: "Super's", contactName: "S", email: "s@x.in" }, "sa")).status, 201);
  });

  test("the list filters by status and type, with counts (pending = sent or opened)", async () => {
    const a = await sendIndividual();
    await invite({ type: "group", hotelName: "Coastal Group", contactName: "Gopal", email: "gopal@x.in" });
    await open(a.token);
    const all = await call(invitationsRoute, "GET", "/api/v1/platform/invitations", "pa");
    assert.deepEqual(all.data.counts, { all: 2, pending: 2, sent: 1, opened: 1, submitted: 0, expired: 0, cancelled: 0 });
    assert.deepEqual((await call(invitationsRoute, "GET", "/api/v1/platform/invitations?type=group", "pa")).data.items.map((i: { hotelName: string }) => i.hotelName), ["Coastal Group"]);
    assert.deepEqual((await call(invitationsRoute, "GET", "/api/v1/platform/invitations?status=opened", "pa")).data.items.map((i: { hotelName: string }) => i.hotelName), ["Moonlight Inn"]);
    assert.equal((await call(invitationsRoute, "GET", "/api/v1/platform/invitations?status=pending", "pa")).data.total, 2);
    assert.equal((await call(invitationsRoute, "GET", "/api/v1/platform/invitations?pageSize=7", "pa")).status, 422);
  });
});

describe("the public page", () => {
  test("opening marks it opened once (audited as the invited person); any bad token gets the same NOT_FOUND", async () => {
    const { token } = await sendIndividual();
    const r = await open(token);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { type: "individual", invitation: { hotelName: "Moonlight Inn", contactName: "Meera Shah", email: "meera@moonlight.in", groupName: null }, status: "opened", expiresAt: r.data.expiresAt });
    await open(token);
    const opened = w.cons.data.audit.filter((a) => a.action === "invitation_opened");
    assert.equal(opened.length, 1);
    assert.deepEqual([opened[0].actorName, opened[0].actorRole, opened[0].actorUserId], ["Meera Shah", null, null]);
    const unknown = await open("doesnotexist");
    const garbage = await call(openRoute, "GET", "/api/v1/onboarding/..%2F..%2Fetc", null, { params: { token: "../../etc" } });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.error.details.serverCode, "NOT_FOUND");
    assert.equal(garbage.status, 422, "a malformed token never reaches the lookup");
    assert.equal(unknown.error.message, (await open("another-unknown-one")).error.message);
  });
});

describe("the onboarding form", () => {
  test("a hotel form makes a PENDING hotel and a PENDING first admin; the invitation is used; the password is hashed and stored nowhere else", async () => {
    const { id, token } = await sendIndividual();
    const r = await submit(token, hotelForm({ legalName: "Moonlight Hospitality LLP", tradeName: "Moonlight", gstType: "composition", roomCount: 24, checkInTime: "12:00", checkOutTime: "25:99" }));
    assert.equal(r.status, 201);
    assert.deepEqual([r.data.kind, r.data.hotel.name, r.data.hotel.status, r.data.group, r.data.message], ["hotel", "Moonlight Inn", "pending_approval", null, "Waiting for approval"]);
    assert.ok(!r.raw.includes(PASSWORD), "the password is never returned");
    const hotelId = r.data.hotel.id;
    const stored = w.auth.data();
    const user = stored.users.find((u) => u.username === "meera.shah")!;
    assert.deepEqual([user.status, user.accountRole, user.mobile, user.email, user.codeRequired], ["pending_approval", "hotel_admin", "+919824012399", "meera@moonlight.in", false]);
    assert.match(user.passwordHash, /^\$argon2id\$/, "hashed with Argon2id");
    assert.ok(await hasher.verify(user.passwordHash, PASSWORD));
    const sub = w.cons.data.submissions.find((s) => s.hotelId === hotelId)!;
    assert.ok(!JSON.stringify(sub).includes(PASSWORD) && !JSON.stringify(sub).toLowerCase().includes("password"), "the stored form has no password");
    assert.equal((sub.payload.hotel as Record<string, unknown>).checkOutTime, null, "an invalid optional time is dropped, not refused");
    assert.equal((sub.payload.hotel as Record<string, unknown>).roomCount, 24);
    const hotels = await call(hotelsRoute, "GET", "/api/v1/platform/hotels?status=pending_approval", "pa");
    assert.deepEqual(hotels.data.items.map((h: { name: string; invitationId: string }) => [h.name, h.invitationId]), [["Moonlight Inn", id]]);
    const detail = await call(hotelRoute, "GET", `/api/v1/platform/hotels/${hotelId}`, "pa", { params: { id: hotelId } });
    assert.deepEqual([detail.data.onboarding.adminUsername, detail.data.onboarding.legalName, detail.data.onboarding.gstType, detail.data.onboarding.roomCount, detail.data.onboarding.checkInTime], ["meera.shah", "Moonlight Hospitality LLP", "composition", 24, "12:00"]);
    assert.equal(detail.data.admins[0].status, "pending");
    assert.equal(mailsOf("onboarding_waiting").length, 1);
    assert.equal(w.cons.data.statusHistory.at(-1)!.toStatus, "pending_approval");
    assert.equal(w.cons.data.audit.at(-1)!.action, "hotel_submitted");
    const inv = (await call(invitationsRoute, "GET", "/api/v1/platform/invitations", "pa")).data.items[0];
    assert.deepEqual([inv.status, inv.hotelId], ["submitted", hotelId]);
  });

  test("the link works once: a second submit and a second open are ALREADY_SUBMITTED", async () => {
    const { token } = await sendIndividual();
    assert.equal((await submit(token, hotelForm())).status, 201);
    const again = await submit(token, hotelForm({ name: "Moonlight Two" }, { username: "other.name", email: "o@x.in", mobile: "9824012300" }));
    assert.equal(again.status, 409);
    assert.equal(again.error.details.serverCode, "ALREADY_SUBMITTED");
    assert.equal((await open(token)).error.details.serverCode, "ALREADY_SUBMITTED");
    assert.equal(w.auth.data().hotels.length, 1);
  });

  test("validation: every field has the contract's words, nothing is created, the link stays usable", async () => {
    const { token } = await sendIndividual();
    const bad = await submit(token, hotelForm({ name: "", address: "", city: "", state: "Atlantis", pin: "12", gstin: "bad", phone: "1", email: "no", logoName: "x.exe" }, { name: "", username: "A", email: "no", mobile: "1", password: "weak", passwordConfirm: "different" }));
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.error.details.fields).sort(), [
      "admin.email", "admin.mobile", "admin.name", "admin.password", "admin.passwordConfirm", "admin.username",
      "hotel.address", "hotel.city", "hotel.email", "hotel.gstin", "hotel.logoName", "hotel.name", "hotel.phone", "hotel.pin", "hotel.state",
    ]);
    assert.equal(bad.error.details.fields["admin.password"], "Use 8 to 128 characters with an uppercase letter, a lowercase letter, a number and a special character.");
    const mismatch = await submit(token, hotelForm({ gstin: "27ABCDE1234F1Z5" }));
    assert.equal(mismatch.error.details.fields["hotel.gstin"], "A GSTIN in Gujarat starts with 24.");
    assert.equal(w.auth.data().hotels.length, 0);
    assert.equal((await submit(token, hotelForm())).status, 201, "the link was not spent");
  });

  test("a name already in use is a field error; a group form on a hotel invitation is a CONFLICT; unknown keys (a role) are refused", async () => {
    const { token } = await sendIndividual();
    const taken = await submit(token, hotelForm({}, { username: "STAFF", email: "staff@demo.hms" }));
    assert.equal(taken.error.details.fields["admin.username"], "This username is already in use.");
    assert.equal(taken.error.details.fields["admin.email"], "Another account already uses this email.");
    const wrongKind = await submit(token, groupForm());
    assert.equal(wrongKind.status, 409);
    assert.match(wrongKind.error.message, /does not match the invitation/);
    const extra = await submit(token, { ...hotelForm(), role: "super_admin" });
    assert.equal(extra.status, 422);
  });
});

describe("approval", () => {
  async function pendingHotel(): Promise<string> {
    const { token } = await sendIndividual();
    return (await submit(token, hotelForm())).data.hotel.id;
  }
  const approve = (id: string, who = "pa") => call(approveRoute, "POST", `/api/v1/platform/hotels/${id}/approve`, who, { params: { id } });
  const reject = (id: string, body: unknown, who = "pa") => call(rejectRoute, "POST", `/api/v1/platform/hotels/${id}/reject`, who, { body, params: { id } });

  test("approve builds the hotel once, activates the first admin, writes history, audit and the decision, and mails the person", async () => {
    const id = await pendingHotel();
    const r = await approve(id);
    assert.equal(r.status, 200);
    assert.equal(r.data.hotel.status, "active");
    assert.equal(r.data.note, "Approval email sent (dev log)");
    assert.equal(r.data.message, "Moonlight Inn is live. meera@moonlight.in was told by email.");
    assert.deepEqual(w.provisioner.calls, [id]);
    assert.deepEqual(w.auth.data().hotelSetup.map((x) => [x.hotelId, x.status]), [[id, "pending"]], "the approval starts the new admin's Set up your hotel checklist");
    assert.equal(w.auth.data().users.find((u) => u.username === "meera.shah")!.status, "active");
    assert.equal(w.cons.data.submissions[0].status, "approved");
    const h = w.cons.data.statusHistory.at(-1)!;
    assert.deepEqual([h.fromStatus, h.toStatus, h.actorRole], ["pending_approval", "active", "platform_admin"]);
    assert.equal(w.cons.data.hotels.get(id)!.approvedAt!.getTime(), clock.getTime());
    assert.equal(w.cons.data.audit.filter((a) => a.action === "hotel_approved").at(-1)!.actorName, "Priya Platform");
    const mail = mailsOf("onboarding_approved");
    assert.equal(mail.length, 1);
    assert.equal(JSON.parse(mail[0].payload as string).username, "meera.shah");
    assert.equal((await approve(id)).error.message, "Only a hotel that waits for approval can be approved or rejected.");
    assert.equal(w.provisioner.calls.length, 1, "never built twice");
    assert.equal((await approve(randomUUID())).status, 404);
  });

  test("only Platform Admin and Super Admin approve; staff are 403 and the refusal is audited", async () => {
    const id = await pendingHotel();
    assert.equal((await approve(id, "staff")).status, 403);
    assert.ok(w.cons.data.audit.some((a) => a.result === "failed" && a.action === "hotel_approved"));
    assert.equal(w.provisioner.calls.length, 0);
    assert.equal((await approve(id, "sa")).status, 200);
  });

  test("a failed build leaves the hotel pending and the account unable to sign in; the retry works", async () => {
    const id = await pendingHotel();
    w.provisioner.failNext = true;
    const r = await approve(id);
    assert.equal(r.status, 500);
    assert.equal(r.error.message, "Something went wrong while creating the hotel. Nothing was saved. Please try again.");
    assert.equal(w.auth.data().hotels.find((h) => h.id === id)!.status, "pending_approval");
    assert.equal(w.auth.data().users.find((u) => u.username === "meera.shah")!.status, "pending_approval");
    assert.ok(w.cons.data.audit.some((a) => a.result === "failed" && a.action === "hotel_approved"));
    assert.equal((await approve(id)).status, 200);
  });

  test("when the platform side fails after the build, the retry completes the approval without building again", async () => {
    const id = await pendingHotel();
    w.cons.data.failAuditWrites = true;
    assert.equal((await approve(id)).status, 500);
    assert.equal(w.auth.data().hotels.find((h) => h.id === id)!.status, "active", "the schema exists");
    assert.equal(w.auth.data().users.find((u) => u.username === "meera.shah")!.status, "pending_approval", "but nothing else was kept");
    w.cons.data.failAuditWrites = false;
    const r = await approve(id);
    assert.equal(r.status, 200);
    assert.equal(w.auth.data().users.find((u) => u.username === "meera.shah")!.status, "active");
    assert.equal(w.provisioner.calls.length, 1);
  });

  test("reject needs a reason, disables the pending account, tells the person why, and cannot be repeated", async () => {
    const id = await pendingHotel();
    for (const body of [{}, { reason: "  " }, { reason: "x".repeat(501) }]) {
      const bad = await reject(id, body);
      assert.equal(bad.status, 422);
      assert.ok(bad.error.details.fields.reason);
    }
    const r = await reject(id, { reason: "GSTIN does not match the address" });
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.hotel.status, r.data.hotel.rejectReason, r.data.message], ["rejected", "GSTIN does not match the address", "Moonlight Inn was rejected."]);
    assert.equal(w.auth.data().users.find((u) => u.username === "meera.shah")!.status, "disabled");
    assert.equal(w.cons.data.submissions[0].status, "rejected");
    assert.equal(JSON.parse(mailsOf("onboarding_rejected")[0].payload as string).reason, "GSTIN does not match the address");
    assert.equal(w.provisioner.calls.length, 0);
    assert.equal((await reject(id, { reason: "again" })).status, 409);
    assert.equal((await approve(id)).status, 409);
  });
});

describe("groups from an invitation", () => {
  async function pendingGroup(): Promise<string> {
    const sent = await invite({ type: "group", hotelName: "Sunrise Group", contactName: "Kavita Desai", email: "kavita@sunrise.in" });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.invitation.groupName, null, "no group yet");
    const r = await submit(tokenOf(), groupForm());
    assert.equal(r.status, 201);
    assert.deepEqual([r.data.kind, r.data.hotel, r.data.group.name, r.data.group.status], ["group", null, "Sunrise Group", "pending_approval"]);
    return r.data.group.id;
  }
  const decide = (route: Route, action: string, id: string, body?: unknown) => call(route, "POST", `/api/v1/platform/groups/${id}/${action}`, "pa", { body, params: { id } });

  test("the form makes a pending group with a pending Group Hotel Admin; approval activates both; the invitation then names the group", async () => {
    const id = await pendingGroup();
    const user = w.auth.data().users.find((u) => u.username === "kavita.d")!;
    assert.deepEqual([user.status, user.accountRole], ["pending_approval", "group_hotel_admin"]);
    const list = await call(groupsRoute, "GET", "/api/v1/platform/groups?status=pending_approval", "pa");
    assert.deepEqual(list.data.map((g: { name: string; legalName: string; groupAdmin: { name: string } }) => [g.name, g.legalName, g.groupAdmin.name]), [["Sunrise Group", "Sunrise Hotels Pvt Ltd", "Kavita Desai"]]);
    const inv = () => call(invitationsRoute, "GET", "/api/v1/platform/invitations", "pa").then((x) => x.data.items[0]);
    assert.equal((await inv()).groupName, null, "not before approval");
    const ok = await decide(approveGroupRoute, "approve", id);
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.data.group.status, ok.data.note, ok.data.message], ["active", "Approval email sent (dev log)", "Sunrise Group is active. kavita@sunrise.in was told by email."]);
    assert.equal(w.auth.data().users.find((u) => u.username === "kavita.d")!.status, "active");
    assert.equal((await inv()).groupName, "Sunrise Group");
    assert.equal(w.cons.data.groupHistory.at(-1)!.event, "approved");
    assert.equal((await decide(approveGroupRoute, "approve", id)).error.message, "Only a group that waits for approval can be approved or rejected.");
  });

  test("rejecting a group needs a reason and disables its admin", async () => {
    const id = await pendingGroup();
    assert.equal((await decide(rejectGroupRoute, "reject", id, {})).status, 422);
    const r = await decide(rejectGroupRoute, "reject", id, { reason: "Not a registered company" });
    assert.deepEqual([r.status, r.data.group.status, r.data.group.rejectReason, r.data.message], [200, "rejected", "Not a registered company", "Sunrise Group was rejected."]);
    assert.equal(w.auth.data().users.find((u) => u.username === "kavita.d")!.status, "disabled");
    assert.equal(mailsOf("onboarding_rejected").length, 1);
  });
});

describe("expiry, resend and cancel", () => {
  test("after 168 hours the link is EXPIRED; resend replaces the link (the old one is NOT_FOUND) and counts; the new one works", async () => {
    const { id, token } = await sendIndividual();
    clock = new Date(clock.getTime() + 168 * 3_600_000 + 1000);
    const expired = await open(token);
    assert.equal(expired.status, 409);
    assert.equal(expired.error.details.serverCode, "EXPIRED");
    assert.equal((await call(invitationsRoute, "GET", "/api/v1/platform/invitations?status=expired", "pa")).data.total, 1);
    const re = await call(resendRoute, "POST", `/api/v1/platform/invitations/${id}/resend`, "pa", { params: { id } });
    assert.equal(re.status, 200);
    assert.equal(re.data.invitation.resendCount, 1);
    assert.equal(re.data.invitation.status, "sent");
    assert.equal(mailsOf("invitation").length, 2);
    const fresh = tokenOf();
    assert.notEqual(fresh, token);
    assert.equal((await open(token)).error.details.serverCode, "EXPIRED", "the old link had already expired");
    assert.equal((await open(fresh)).status, 200);
    // a link replaced while it was still valid is gone, not expired
    const again = await call(resendRoute, "POST", `/api/v1/platform/invitations/${id}/resend`, "pa", { params: { id } });
    assert.equal(again.data.invitation.resendCount, 2);
    assert.equal((await open(fresh)).error.details.serverCode, "NOT_FOUND", "the replaced link is gone");
    assert.equal((await open(tokenOf())).status, 200);
    assert.equal(w.cons.data.links.filter((l) => l.invitationId === id && l.revokedAt === null && l.usedAt === null).length, 1, "one live link at a time");
  });

  test("cancel stops the link (CANCELLED), cannot be repeated, and a used invitation cannot be resent or cancelled", async () => {
    const a = await sendIndividual();
    const cancel = (id: string) => call(cancelRoute, "POST", `/api/v1/platform/invitations/${id}/cancel`, "pa", { params: { id } });
    const resend = (id: string) => call(resendRoute, "POST", `/api/v1/platform/invitations/${id}/resend`, "pa", { params: { id } });
    const c = await cancel(a.id);
    assert.equal(c.data.status, "cancelled");
    assert.equal((await open(a.token)).error.details.serverCode, "CANCELLED");
    assert.equal((await cancel(a.id)).error.message, "This invitation was already used or cancelled.");
    assert.equal((await resend(a.id)).error.message, "This invitation was already used or cancelled, so it cannot be sent again.");
    const b = await invite({ hotelName: "Moonlight Inn", contactName: "Meera Shah", email: "Meera@Moonlight.in" });
    assert.equal(b.status, 201, "after a cancel the name and e-mail are free again");
    await submit(tokenOf(), hotelForm());
    assert.equal((await cancel(b.data.invitation.id)).status, 409);
    assert.equal((await resend(b.data.invitation.id)).status, 409);
    assert.equal((await resend(randomUUID())).status, 404);
  });
});

describe("the local provisioner fails closed", () => {
  test("in production, or without an owner URL, it throws NOT_CONFIGURED and never connects", async () => {
    let connected = 0;
    const connect = (async () => {
      connected += 1;
      throw new Error("must not connect");
    }) as never;
    const prod = createLocalProvisioner({ nodeEnv: "production", dbRoot: "Z:/does/not/exist", connect });
    await assert.rejects(() => prod.provision({ hotelId: randomUUID() }), (e) => e instanceof ProvisionError && e.failure === "NOT_CONFIGURED");
    const noUrl = createLocalProvisioner({ nodeEnv: "development", dbRoot: "Z:/does/not/exist", connect });
    await assert.rejects(() => noUrl.provision({ hotelId: randomUUID() }), (e) => e instanceof ProvisionError && e.failure === "NOT_CONFIGURED");
    assert.equal(connected, 0);
  });
});
