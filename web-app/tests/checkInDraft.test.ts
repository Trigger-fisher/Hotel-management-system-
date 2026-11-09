// Unit tests for the pure part of the two-step check-in (src/dashboards/groups/frontOffice/checkInDraft.ts): the draft never carries an ID number and
// comes back over the prefilled form, bad drafts are ignored, the arrivals search, what a past guest fills, and the summary's money by the GST slab.
// Run with `node --test tests/checkInDraft.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
const shared = new URL("../../common/ui-shared/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@shared/")) return next(new URL(`${specifier.slice("@shared/".length)}.ts`, shared).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const {
  applyDraft, dateSpan, draftKey, fillFromLookup, filterArrivals, hasUnnamedMember, initialForm, membersInput, mobileDigits, nameOnlyNames, parseDraft, readDraft, stayEstimate, sweepDrafts, toDraft, writeDraft, dropDraft,
  DRAFT_MAX_AGE_MS,
} = await import("../src/dashboards/groups/frontOffice/checkInDraft.ts");
const { EMPTY_REGISTER_FIELDS } = await import("../../common/ui-shared/dashboards/frontOffice.ts");

const room = (id: string) => ({ id, number: id.slice(3), floor: '1', roomTypeId: 'rt-1', roomTypeName: 'Deluxe', notes: '', hkStatus: 'clean', outOfOrder: false, outOfOrderReason: null, hasHistory: false, currentStay: null, state: 'vacant' }) as never;
const reservation = (over: Record<string, unknown> = {}) =>
  ({
    id: 'res-1', version: 1, reference: 'RES-26-00104', guestName: 'Priya Shah', mobile: '98795 66021', email: 'priya@x.in', companyId: null, companyName: null, roomTypeId: 'rt-1', roomTypeName: 'Deluxe',
    rooms: 1, plan: 'CP', ratePaise: 340000, adults: 2, children: 0, checkIn: '2026-11-05', checkOut: '2026-11-07', nights: 2, roomTotalPaise: 680000, source: 'phone', enquiryRef: null, notes: 'Early arrival.',
    status: 'confirmed', cancelReason: null, advances: [], advancePaidPaise: 0, advanceBalancePaise: 0, stays: [], createdAt: '2026-11-01T06:00:00Z', ...over,
  }) as never;
const prefill = (res: unknown, gr = '2421') => ({ reservation: res, alreadyIn: 0, rooms: [room('rm-101'), room('rm-102')], suggestedGrNumber: gr }) as never;

describe("initialForm", () => {
  test("a booking fills the dates, guests, plan, rate, name and mobile; the G.R. number comes from the prefill; the room is not chosen for the desk", () => {
    const f = initialForm(prefill(reservation()), '2026-11-05');
    assert.equal(f.expectedCheckOut, '2026-11-07');
    assert.equal(f.adults, '2');
    assert.equal(f.rate, '3400');
    assert.equal(f.guestName, 'Priya Shah');
    assert.equal(f.grNumber, '2421');
    assert.equal(f.roomId, '');
    assert.equal(f.notes, 'Early arrival.');
  });
  test("a walk-in leaves tomorrow, two adults, Indian; a room given in the address is kept only when it is free", () => {
    const f = initialForm(prefill(null), '2026-11-05', 'rm-102');
    assert.equal(f.expectedCheckOut, '2026-11-06');
    assert.equal(f.roomId, 'rm-102');
    assert.equal(f.nationality, 'Indian');
    assert.equal(initialForm(prefill(null), '2026-11-05', 'rm-999').roomId, '');
  });
  test("a booking whose check-out is already past gets tomorrow", () => {
    assert.equal(initialForm(prefill(reservation({ checkOut: '2026-11-04' })), '2026-11-05').expectedCheckOut, '2026-11-06');
  });
});

describe("the draft", () => {
  const form = { ...initialForm(prefill(reservation()), '2026-11-05'), idProofType: 'Aadhaar', idProofNumber: '2341 0000 4821', city: 'Rajkot' };
  const members = [{ key: 'm1', fullName: 'Arjun Shah', mobile: '', idType: 'Aadhaar', idNumber: '9999 8888 7777', nameOnly: false }, { key: 'm2', fullName: 'Meera', mobile: '', idType: '', idNumber: '', nameOnly: true }];

  test("keys: one per reservation, walk-ins share one", () => {
    assert.equal(draftKey('res-1'), 'hms-checkin-draft:res-1');
    assert.equal(draftKey(''), 'hms-checkin-draft:walk-in');
  });
  test("never carries an ID number, of the lead guest or of a member, nor the room or the G.R. number; everything else is kept, with the time it was saved", () => {
    const d = toDraft({ ...form, roomId: 'rm-101' }, { ...EMPTY_REGISTER_FIELDS, dateOfBirth: '1991-03-14' }, members, 1000);
    const text = JSON.stringify(d);
    assert.ok(!text.includes('4821'));
    assert.ok(!text.includes('9999'));
    assert.ok(!text.includes('rm-101') && !text.includes('2421'));
    assert.ok(text.includes('Rajkot') && text.includes('Arjun Shah') && text.includes('1991-03-14'));
    assert.equal(d.savedAt, 1000);
  });
  test("comes back over the prefilled form with the ID numbers empty and the name-only mark kept", () => {
    const d = parseDraft(JSON.stringify(toDraft(form, EMPTY_REGISTER_FIELDS, members)));
    assert.ok(d);
    const back = applyDraft(initialForm(prefill(reservation()), '2026-11-05'), d);
    assert.equal(back.form.city, 'Rajkot');
    assert.equal(back.form.idProofType, 'Aadhaar');
    assert.equal(back.form.idProofNumber, '');
    assert.equal(back.members.length, 2);
    assert.equal(back.members[0]?.idNumber, '');
    assert.equal(back.members[1]?.nameOnly, true);
  });
  test("a draft with an empty value keeps the booking's; the roomId param and the fresh G.R. suggestion always win", () => {
    const d = parseDraft(JSON.stringify(toDraft({ ...form, email: '', notes: '' }, EMPTY_REGISTER_FIELDS, [])));
    assert.ok(d);
    const back = applyDraft(initialForm(prefill(reservation(), '2026120'), '2026-11-05', 'rm-102'), d);
    assert.equal(back.form.roomId, 'rm-102');
    assert.equal(back.form.grNumber, '2026120');
    assert.equal(back.form.email, 'priya@x.in');
    assert.equal(back.form.notes, 'Early arrival.');
    assert.equal(back.form.city, 'Rajkot');
  });
  test("bad JSON, another version, no saved time or a wrong shape is no draft", () => {
    assert.equal(parseDraft(null), null);
    assert.equal(parseDraft('{'), null);
    assert.equal(parseDraft(JSON.stringify({ v: 2, savedAt: 1, form: {}, register: {}, members: [] })), null);
    assert.equal(parseDraft(JSON.stringify({ v: 1, form: {}, register: {}, members: [] })), null);
    assert.equal(parseDraft(JSON.stringify({ v: 1, savedAt: 1, form: 'x', register: {}, members: [] })), null);
    const loose = parseDraft(JSON.stringify({ v: 1, savedAt: 1, form: { city: 7, notes: 'ok', idProofNumber: 'leak', roomId: 'rm-9', grNumber: '1' }, register: { state: 'GJ', bogus: 1 }, members: [{ key: 'a' }, { key: 'b', fullName: 'B', nameOnly: 'yes' }] }));
    assert.ok(loose);
    assert.deepEqual(loose.form, { notes: 'ok' });
    assert.equal(loose.register.state, 'GJ');
    assert.deepEqual(loose.members, [{ key: 'b', fullName: 'B', mobile: '', idType: '', nameOnly: false }]);
  });
  test("a draft older than a shift is dropped on read; the sweep keeps only today's bookings and leaves other keys alone", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), get length() { return mem.size; }, key: (i: number) => [...mem.keys()][i] ?? null };
    writeDraft(store, draftKey('res-1'), toDraft(form, EMPTY_REGISTER_FIELDS, [], 1000));
    assert.ok(readDraft(store, draftKey('res-1'), 1000 + DRAFT_MAX_AGE_MS));
    assert.equal(readDraft(store, draftKey('res-1'), 1001 + DRAFT_MAX_AGE_MS), null);
    assert.equal(mem.has(draftKey('res-1')), false);
    writeDraft(store, draftKey('res-1'), toDraft(form, EMPTY_REGISTER_FIELDS, []));
    writeDraft(store, draftKey('res-gone'), toDraft(form, EMPTY_REGISTER_FIELDS, []));
    mem.set('hms-shell', 'app');
    sweepDrafts(store, ['res-1']);
    assert.deepEqual([...mem.keys()].sort(), ['hms-checkin-draft:res-1', 'hms-shell']);
    sweepDrafts(store);
    assert.deepEqual([...mem.keys()], ['hms-shell']);
    assert.doesNotThrow(() => sweepDrafts({ getItem: () => null, setItem() {}, removeItem() {} }));
  });
  test("a store that throws or is missing loses the draft quietly", () => {
    const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    assert.equal(readDraft(boom, 'k'), null);
    assert.doesNotThrow(() => writeDraft(boom, 'k', toDraft(form, EMPTY_REGISTER_FIELDS, [])));
    assert.doesNotThrow(() => dropDraft(boom, 'k'));
    assert.equal(readDraft(null, 'k'), null);
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    writeDraft(store, 'k', toDraft(form, EMPTY_REGISTER_FIELDS, members));
    assert.equal(readDraft(store, 'k')?.members.length, 2);
    dropDraft(store, 'k');
    assert.equal(readDraft(store, 'k'), null);
  });
});

describe("arrivals and the lookup", () => {
  const list = [reservation(), reservation({ id: 'res-2', reference: 'RES-26-00105', guestName: 'Mohammed Arif Khan', mobile: '97277 30448', companyName: 'Atul Auto Ltd' })];
  test("the last ten digits of what is typed", () => {
    assert.equal(mobileDigits('+91 98795-66021'), '9879566021');
    assert.equal(mobileDigits('6021'), '6021');
  });
  test("search by name, digits, reference or company; every word must match", () => {
    assert.equal(filterArrivals(list, '').length, 2);
    assert.equal(filterArrivals(list, 'arif')[0]?.id, 'res-2');
    assert.equal(filterArrivals(list, '66021')[0]?.id, 'res-1');
    assert.equal(filterArrivals(list, '00105')[0]?.id, 'res-2');
    assert.equal(filterArrivals(list, 'atul auto')[0]?.id, 'res-2');
    assert.equal(filterArrivals(list, 'atul priya').length, 0);
  });
  test("a past guest fills only what is empty; the booking's name, email and a typed city stay", () => {
    const match = { guestName: 'P. Shah', mobile: '98795 66021', email: 'old@x.in', address: '14, Shanti Nagar', city: 'Rajkot', nationality: 'Indian', idProofType: 'Aadhaar', idProofNumber: '4821', dateOfBirth: '1990-01-02', stays: 2, lastRoomNumber: '104', lastCheckOut: '2026-08-10', companyId: 'co-1' };
    const base = { ...initialForm(prefill(reservation()), '2026-11-05'), city: 'Morbi' };
    const out = fillFromLookup(base, EMPTY_REGISTER_FIELDS, match);
    assert.equal(out.form.guestName, 'Priya Shah');
    assert.equal(out.form.email, 'priya@x.in');
    assert.equal(out.form.city, 'Morbi');
    assert.equal(out.form.address, '14, Shanti Nagar');
    assert.equal(out.form.idProofType, 'Aadhaar');
    assert.equal(out.form.idProofNumber, '4821');
    assert.equal(out.form.companyId, 'co-1');
    assert.equal(out.register.dateOfBirth, '1990-01-02');
  });
});

describe("members and the summary", () => {
  test("a name-only guest goes without an ID; a row with no name is dropped; the note names who carried none", () => {
    const rows = [{ key: 'a', fullName: ' Arjun ', mobile: '', idType: 'Aadhaar', idNumber: '1234', nameOnly: false }, { key: 'b', fullName: 'Meera', mobile: '', idType: 'Passport', idNumber: 'X1', nameOnly: true }, { key: 'c', fullName: '  ', mobile: '', idType: '', idNumber: '', nameOnly: false }];
    assert.deepEqual(membersInput(rows), [{ fullName: 'Arjun', mobile: '', idType: 'Aadhaar', idNumber: '1234' }, { fullName: 'Meera', mobile: '', idType: '', idNumber: '' }]);
    assert.equal(nameOnlyNames(rows), 'Meera');
  });
  test("a row with an ID, a mobile or a photo but no name is caught before the save; an empty row is not", () => {
    const empty = { key: 'e', fullName: '', mobile: '', idType: '', idNumber: '', nameOnly: false };
    assert.equal(hasUnnamedMember([empty]), false);
    assert.equal(hasUnnamedMember([{ ...empty, idNumber: '1234' }]), true);
    assert.equal(hasUnnamedMember([{ ...empty, idType: 'Aadhaar' }]), true);
    assert.equal(hasUnnamedMember([empty], ['e']), true);
    assert.equal(hasUnnamedMember([{ ...empty, fullName: 'Arjun', idNumber: '1234' }], ['e']), false);
  });
  test("GST 5% at 7,500 or under, 18% above; the advance comes off, never below zero", () => {
    const a = stayEstimate(360000, 2, 300000);
    assert.deepEqual(a, { roomPaise: 720000, gstPercent: 5, gstPaise: 36000, totalPaise: 756000, balancePaise: 456000 });
    assert.equal(stayEstimate(750000, 1, 0).gstPercent, 5);
    assert.equal(stayEstimate(750100, 1, 0).gstPercent, 18);
    assert.equal(stayEstimate(null, 1, 0).totalPaise, 0);
    assert.equal(stayEstimate(100000, 1, 999999).balancePaise, 0);
  });
  test("a date span reads as the desk says it", () => {
    assert.equal(dateSpan('2026-11-05', '2026-11-07'), '05 to 07 Nov 2026');
    assert.equal(dateSpan('2026-11-30', '2026-12-02'), '30 Nov to 02 Dec 2026');
    assert.equal(dateSpan('2026-12-31', '2027-01-02'), '31 Dec 2026 to 02 Jan 2027');
  });
});
