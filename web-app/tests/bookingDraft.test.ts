// Unit tests for the pure part of the two-step booking form (src/dashboards/groups/frontOffice/bookingDraft.ts): the first values, the draft and what it
// keeps, what a past guest fills, the day strip, the plan rate and the estimate. Run with `node --test tests/bookingDraft.test.ts`.
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
  applyDraft, bookingEstimate, draftKey, dropDraft, fillFromMatch, initialForm, nightsOf, parseDraft, pickDay, rateFromPlan, readDraft, showCompany, stripDays, stripStart, sweepBookingDrafts, toDraft, writeDraft,
} = await import("../src/dashboards/groups/frontOffice/bookingDraft.ts");

const reservation = (over: Record<string, unknown> = {}) =>
  ({
    id: 'res-1', version: 1, reference: 'RES-26-00104', guestName: 'Priya Shah', mobile: '98795 66021', email: 'priya@x.in', companyId: null, companyName: null, roomTypeId: 'rt-1', roomTypeName: 'Deluxe',
    rooms: 2, plan: 'CP', ratePaise: 340000, adults: 2, children: 1, checkIn: '2026-11-12', checkOut: '2026-11-14', nights: 2, roomTotalPaise: 1360000, source: 'website', enquiryRef: null, notes: 'Late arrival.',
    status: 'confirmed', cancelReason: null, advances: [], advancePaidPaise: 0, advanceBalancePaise: 0, stays: [], createdAt: '2026-11-01T06:00:00Z', ...over,
  }) as never;
const types = [
  { id: 'rt-1', name: 'Deluxe', plans: [{ code: 'EP', name: 'Room only', singlePaise: 300000, doublePaise: 360000 }, { code: 'CP', name: 'With breakfast', singlePaise: 340000, doublePaise: 400000 }] },
  { id: 'rt-2', name: 'Standard', plans: [{ code: 'EP', name: 'Room only', singlePaise: 180000, doublePaise: 210000 }] },
] as never;
const match = (over: Record<string, unknown> = {}) => ({ guestName: 'Priya Nair', mobile: '98250 67890', email: 'priya.n@example.in', address: '', city: 'Bengaluru', nationality: '', idProofType: '', idProofNumber: '', dateOfBirth: '', stays: 2, lastRoomNumber: '204', lastCheckOut: '2026-09-02', companyId: null, ...over }) as never;

const TODAY = '2026-11-05';

describe("initialForm", () => {
  test("a new booking: tonight for one night, two adults, one room, by phone, no rate", () => {
    const f = initialForm(null, TODAY);
    assert.equal(f.checkIn, TODAY);
    assert.equal(f.checkOut, '2026-11-06');
    assert.deepEqual([f.adults, f.children, f.rooms, f.source, f.rate, f.rateEdited], ['2', '0', '1', 'phone', '', false]);
  });
  test("an existing booking fills everything and keeps its rate as typed", () => {
    const f = initialForm(reservation(), TODAY);
    assert.deepEqual([f.guestName, f.checkIn, f.checkOut, f.rooms, f.children, f.plan, f.rate, f.source, f.rateEdited], ['Priya Shah', '2026-11-12', '2026-11-14', '2', '1', 'CP', '3400', 'website', true]);
  });
});

describe("the draft", () => {
  const base = initialForm(null, TODAY);
  test("keys: one per booking, new bookings share one", () => {
    assert.equal(draftKey('res-1'), 'hms-booking-draft:res-1');
    assert.equal(draftKey(''), 'hms-booking-draft:new');
  });
  test("comes back over the base form; typed values win, empty ones leave the base", () => {
    const typed = { ...base, guestName: 'Arjun', mobile: '9898989898', notes: 'Prefers a quiet floor.', rate: '2500', rateEdited: true };
    assert.equal('notes' in toDraft(typed, 5).form, false);
    const d = parseDraft(JSON.stringify(toDraft(typed, 5)), initialForm(reservation(), TODAY));
    assert.ok(d);
    assert.equal(d.savedAt, 5);
    const back = applyDraft(initialForm(reservation(), TODAY), d);
    assert.equal(back.guestName, 'Arjun');
    assert.equal(back.notes, 'Late arrival.');
    assert.equal(back.rate, '2500');
    assert.equal(back.rateEdited, true);
  });
  test("bad text, another version or a made-up source is no draft", () => {
    assert.equal(parseDraft('{', base), null);
    assert.equal(parseDraft(JSON.stringify({ v: 2, savedAt: 1, form: {} }), base), null);
    const d = parseDraft(JSON.stringify({ v: 1, savedAt: 1, form: { source: 'fax', guestName: 'X' } }), base);
    assert.equal(d?.form.source, 'phone');
    assert.equal(d?.form.guestName, 'X');
  });
  test("the store: written, read back, too old is dropped, removed on save; a throwing store is ignored", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    writeDraft(store, draftKey(''), toDraft({ ...base, guestName: 'Meera' }, 1000));
    assert.equal(readDraft(store, draftKey(''), base, 2000)?.form.guestName, 'Meera');
    assert.equal(readDraft(store, draftKey(''), base, 1000 + 13 * 60 * 60 * 1000), null);
    assert.equal(mem.size, 0);
    writeDraft(store, draftKey('r'), toDraft(base));
    dropDraft(store, draftKey('r'));
    assert.equal(mem.size, 0);
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    assert.doesNotThrow(() => writeDraft(bad, 'k', toDraft(base)));
    assert.equal(readDraft(bad, 'k', base), null);
  });
  test("sign-out sweeps every booking draft and nothing else; a store without key() is left alone", () => {
    const mem = new Map<string, string>([['hms-shell', 'app'], ['hms-checkin-draft:res-1', '{}']]);
    const store = {
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
      get length() { return mem.size; }, key: (i: number) => [...mem.keys()][i] ?? null,
    };
    writeDraft(store, draftKey(''), toDraft(base));
    writeDraft(store, draftKey('res-1'), toDraft(base));
    sweepBookingDrafts(store);
    assert.deepEqual([...mem.keys()], ['hms-shell', 'hms-checkin-draft:res-1']);
    assert.doesNotThrow(() => sweepBookingDrafts({ getItem: () => null, setItem() {}, removeItem() {} }));
  });
});

describe("a past guest", () => {
  test("fills only the empty name, email and company; the source stays the desk's", () => {
    const f = fillFromMatch({ ...initialForm(null, TODAY), guestName: 'P. Nair' }, match({ companyId: 'co-1' }));
    assert.equal(f.guestName, 'P. Nair');
    assert.equal(f.email, 'priya.n@example.in');
    assert.equal(f.companyId, 'co-1');
    assert.equal(f.source, 'phone');
  });
  test("the company box shows for a company booking, a chosen company or a match with one", () => {
    const f = initialForm(null, TODAY);
    assert.equal(showCompany(f, null), false);
    assert.equal(showCompany({ ...f, source: 'company' }, null), true);
    assert.equal(showCompany({ ...f, companyId: 'co-1' }, null), true);
    assert.equal(showCompany(f, match({ companyId: 'co-2' })), true);
  });
});

describe("the day strip", () => {
  test("starts today for a check-in within two weeks, else on the booking's check-in", () => {
    assert.equal(stripStart(TODAY, TODAY), TODAY);
    assert.equal(stripStart(TODAY, '2026-11-18'), TODAY);
    assert.equal(stripStart(TODAY, '2026-11-19'), '2026-11-19');
    assert.equal(stripStart(TODAY, '2026-11-01'), '2026-11-01');
    assert.equal(stripDays(TODAY).length, 14);
    assert.equal(stripDays(TODAY)[13], '2026-11-18');
  });
  test("first tap is the check-in, the next a later check-out, a tap on or before the check-in starts again", () => {
    const f = { checkIn: TODAY, checkOut: '2026-11-06' };
    const a = pickDay(f, '2026-11-12', 'in');
    assert.deepEqual(a, { checkIn: '2026-11-12', checkOut: '2026-11-13', phase: 'out' });
    const b = pickDay(a, '2026-11-14', 'out');
    assert.deepEqual(b, { checkIn: '2026-11-12', checkOut: '2026-11-14', phase: 'in' });
    const c = pickDay(b, '2026-11-10', 'out');
    assert.deepEqual(c, { checkIn: '2026-11-10', checkOut: '2026-11-14', phase: 'out' });
    assert.equal(nightsOf(c), 4);
    assert.equal(nightsOf({ checkIn: TODAY, checkOut: TODAY }), 0);
  });
});

describe("the plan rate", () => {
  test("a category fills its first plan's double rate; a plan or the adults change it; a typed rate is never overwritten", () => {
    const f = rateFromPlan({ ...initialForm(null, TODAY), roomTypeId: 'rt-1' }, types);
    assert.deepEqual([f.plan, f.rate], ['EP', '3600']);
    assert.equal(rateFromPlan({ ...f, plan: 'CP' }, types).rate, '4000');
    assert.equal(rateFromPlan({ ...f, adults: '1' }, types).rate, '3000');
    assert.equal(rateFromPlan({ ...f, roomTypeId: 'rt-2', plan: 'CP' }, types).plan, 'EP');
    assert.equal(rateFromPlan({ ...f, rate: '3333', rateEdited: true, plan: 'CP' }, types).rate, '3333');
  });
  test("the estimate: rooms x nights at the rate, 5% up to 7,500 a night and 18% above", () => {
    assert.deepEqual(bookingEstimate(360000, 2, 1), { roomPaise: 720000, gstPercent: 5, gstPaise: 36000, totalPaise: 756000 });
    assert.deepEqual(bookingEstimate(800000, 1, 2), { roomPaise: 1600000, gstPercent: 18, gstPaise: 288000, totalPaise: 1888000 });
    assert.equal(bookingEstimate(null, 0, 0).totalPaise, 0);
  });
});
