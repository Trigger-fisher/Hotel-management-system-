// Decision 71 (guest Account): the page's pure rules (ui-shared/dashboards/guestCopy/account.ts), the mock's ID proof save as the sheets send it, and the
// sign-ins pager. Run with `node --test tests/guest.account.test.ts`.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const ac = await import("../../common/ui-shared/dashboards/guestCopy/account");
const { createGuestApi } = await import("../../common/ui-shared/dashboards/guest.mock");
const { createGuestAccountMock } = await import("../../common/ui-shared/dashboards/guestAccount.mock");
type GuestProfile = import("../../common/ui-shared/dashboards/guest").GuestProfile;

const saved = { idProofType: "aadhaar" as const, idProofNumber: "XXXX XXXX 4321" };

describe("Account: pure rules", () => {
  test("initials and the ID proof row", () => {
    assert.equal(ac.initialsOf("  Amit  Kumar Joshi "), "AK");
    assert.equal(ac.initialsOf("Riya"), "R");
    assert.equal(ac.idProofValue(saved), "Aadhaar card · XXXX XXXX 4321");
    assert.equal(ac.idProofValue({ idProofType: "none", idProofNumber: "" }), "Not added yet");
  });

  test("the ID number field follows the type: a new type empties the masked number, the saved type brings it back", () => {
    assert.equal(ac.idNumberForType("passport", "XXXX XXXX 4321", saved), "");
    assert.equal(ac.idNumberForType("passport", "Z1234567", saved), "Z1234567");
    assert.equal(ac.idNumberForType("aadhaar", "", saved), "XXXX XXXX 4321");
    assert.equal(ac.idNumberForType("none", "anything", saved), "");
  });

  test("the ID proof check: a number unless none, never the masked one under a new type", () => {
    assert.equal(ac.checkIdProof("none", "", saved), undefined);
    assert.equal(ac.checkIdProof("aadhaar", "XXXX XXXX 4321", saved), undefined);
    assert.match(ac.checkIdProof("passport", " ", saved) ?? "", /Enter the ID number/);
    assert.equal(ac.checkIdProof("passport", "XXXX XXXX 4321", saved), ac.accountCopy.idNewType);
    assert.equal(ac.checkIdProof("passport", "Z1234567", saved), undefined);
  });

  test("profileInput sends every field back with one sheet's change on top", () => {
    const p = { name: "Amit Joshi", email: "a@b.in", city: "Rajkot", address: "1 Road", idProofType: "aadhaar", idProofNumber: "XXXX XXXX 4321", notifyEmail: true } as GuestProfile;
    assert.deepEqual(ac.profileInput(p, { city: "Surat" }), { name: "Amit Joshi", email: "a@b.in", city: "Surat", address: "1 Road", idProofType: "aadhaar", idProofNumber: "XXXX XXXX 4321", notifyEmail: true });
  });

  test("copy: Sign in words, stays count, sign-in status (never an IP)", () => {
    assert.equal(ac.accountCopy.guestSince("20 Dec 2025", 6), "Guest since 20 Dec 2025 · 6 stays");
    assert.equal(ac.accountCopy.guestSince("20 Dec 2025", 1), "Guest since 20 Dec 2025 · 1 stay");
    assert.equal(ac.accountCopy.edit("Full name"), "Change full name");
    assert.equal(ac.accountCopy.edit("ID proof"), "Change ID proof");
    assert.equal(ac.signInStatus({ ok: false, ended: true }), "Failed attempt");
    assert.equal(ac.signInStatus({ ok: true, ended: false }), "Active now");
    assert.equal(ac.signInStatus({ ok: true, ended: true }), "Signed out");
    const words = JSON.stringify(Object.values(ac.accountCopy).map((v) => (typeof v === "function" ? String(v) : v)));
    assert.doesNotMatch(words, /log ?in/i);
  });
});

describe("Account: the mock as the sheets use it", () => {
  test("a city change sends the masked ID back and keeps the ID number", async () => {
    const api = createGuestApi();
    const before = await api.getProfile();
    assert.ok(before.ok);
    const res = await api.updateProfile(ac.profileInput(before.data, { city: "Surat" }));
    assert.ok(res.ok);
    assert.equal(res.data.city, "Surat");
    assert.equal(res.data.idProofType, before.data.idProofType);
    assert.equal(res.data.idProofNumber, before.data.idProofNumber);
  });

  test("a new ID type with a new number is stored masked; an empty number is refused", async () => {
    const api = createGuestApi();
    const before = await api.getProfile();
    assert.ok(before.ok);
    const bad = await api.updateProfile(ac.profileInput(before.data, { idProofType: "passport", idProofNumber: "" }));
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.ok(bad.error.details?.fields?.idProofNumber);
    const res = await api.updateProfile(ac.profileInput(before.data, { idProofType: "passport", idProofNumber: "Z1234567" }));
    assert.ok(res.ok);
    assert.equal(res.data.idProofType, "passport");
    assert.equal(res.data.idProofNumber, "XXXX XXXX 4567");
  });

  test("the sign-ins pager: ten a page, newest first, failed attempts counted; other page sizes refused", async () => {
    const m = createGuestAccountMock();
    const first = await m.signIns({ page: 1, pageSize: 10 });
    assert.ok(first.ok);
    assert.equal(first.data.page, 1);
    assert.equal(first.data.pageSize, 10);
    assert.ok(first.data.items.length <= 10);
    assert.equal(first.data.totals.success + first.data.totals.failed, first.data.totals.all);
    const times = first.data.items.map((s) => Date.parse(s.at));
    assert.deepEqual(times, [...times].sort((x, y) => y - x));
    const past = await m.signIns({ page: 2, pageSize: 10 });
    assert.ok(past.ok);
    assert.equal(past.data.items.length, Math.max(0, first.data.total - 10));
    const odd = await m.signIns({ page: 1, pageSize: 7 });
    assert.equal(odd.ok, false);
  });
});
