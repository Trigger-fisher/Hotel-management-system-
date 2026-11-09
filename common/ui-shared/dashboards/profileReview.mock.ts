// The in-memory mock of profileReview.ts (dev and local-demo builds only): a few demo guests and companies that look alike across hotels, with the server's rules
// (merge keeps one and re-links the others' hotels; two profiles with their own sign-in cannot be merged; "not the same" hides the pair).
import type { MockClock } from './common';
import { mockCall, mockError, ok } from './common';
import type { DuplicateBy, DuplicateGroup, KeepApartInput, MergeInput, ProfileKind, ProfileReviewApi, ReviewProfile } from './profileReview';

interface Row extends ReviewProfile {
  kind: ProfileKind;
  mergedInto: string | null;
}

const A = { hotelId: 'h-1', hotelName: 'Hotel Sunrise, Rajkot' };
const B = { hotelId: 'h-2', hotelName: 'Sunrise Residency, Ahmedabad' };
const C = { hotelId: 'h-3', hotelName: 'Somnath Sagar Inn' };
const at = (d: string) => `${d}T05:30:00.000Z`;

export function createProfileReviewMock(clock: MockClock = {}): ProfileReviewApi {
  const call = <T>(fn: () => ReturnType<typeof ok<T>> | ReturnType<typeof mockError>) => mockCall(fn as never, clock) as never;
  const rows: Row[] = [
    { kind: 'guest', id: 'g-1', name: 'Amit Joshi', mobile: '+919825041236', email: 'amit@example.com', gstin: null, city: 'Ahmedabad', hasLogin: true, createdAt: at('2026-03-12'), hotels: [A], mergedInto: null },
    { kind: 'guest', id: 'g-2', name: 'Amit J.', mobile: '+919825041236', email: null, gstin: null, city: 'Rajkot', hasLogin: false, createdAt: at('2026-06-20'), hotels: [B], mergedInto: null },
    { kind: 'guest', id: 'g-3', name: 'Neha Shah', mobile: '+919898012345', email: 'neha@example.com', gstin: null, city: 'Surat', hasLogin: false, createdAt: at('2026-04-02'), hotels: [A], mergedInto: null },
    { kind: 'guest', id: 'g-4', name: 'Neha S. Shah', mobile: '+919898099999', email: 'neha@example.com', gstin: null, city: 'Surat', hasLogin: true, createdAt: at('2026-09-01'), hotels: [C], mergedInto: null },
    { kind: 'company', id: 'c-1', name: 'Tata Consultancy Services', mobile: null, email: 'travel@tcs.example', gstin: '24AAACT2727Q1ZW', city: null, hasLogin: true, createdAt: at('2026-02-01'), hotels: [A], mergedInto: null },
    { kind: 'company', id: 'c-2', name: 'TCS Ltd', mobile: null, email: null, gstin: '24AAACT2727Q1ZW', city: null, hasLogin: false, createdAt: at('2026-07-15'), hotels: [B, C], mergedInto: null },
  ];
  let kept: { kind: ProfileKind; left: string; right: string }[] = [];
  const view = (r: Row): ReviewProfile => ({ id: r.id, name: r.name, mobile: r.mobile, email: r.email, gstin: r.gstin, city: r.city, hasLogin: r.hasLogin, createdAt: r.createdAt, hotels: r.hotels.map((h) => ({ ...h })) });
  const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
  const groupsOf = (kind: ProfileKind): DuplicateGroup[] => {
    const live = rows.filter((r) => r.kind === kind && r.mergedInto === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const out: DuplicateGroup[] = [];
    for (const by of (kind === 'guest' ? ['mobile', 'email'] : ['gstin', 'email']) as DuplicateBy[]) {
      const map = new Map<string, Row[]>();
      for (const r of live) {
        const v = r[by];
        if (v) map.set(v, [...(map.get(v) ?? []), r]);
      }
      for (const [value, list] of map) {
        if (list.length < 2) continue;
        const ids = list.map((r) => r.id);
        const pairs = kept.filter((k) => k.kind === kind && ids.includes(k.left) && ids.includes(k.right)).map((k) => [k.left, k.right] as [string, string]);
        if (pairs.length >= (ids.length * (ids.length - 1)) / 2) continue;
        out.push({ key: `${kind}:${by}:${value}`, by, value, profiles: list.map(view), keptApart: pairs });
      }
    }
    return out;
  };
  return {
    duplicates: (q) =>
      call(() => {
        const s = (q.search ?? '').trim().toLowerCase();
        const all = groupsOf(q.kind).filter((g) => !s || `${g.value} ${g.profiles.map((p) => `${p.name} ${p.email ?? ''} ${p.mobile ?? ''}`).join(' ')}`.toLowerCase().includes(s));
        const pageSize = q.pageSize ?? 25;
        const page = Math.max(1, q.page ?? 1);
        return ok({ items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize });
      }),
    merge: (input: MergeInput) =>
      call(() => {
        if (input.reason.trim().length < 3) return mockError('VALIDATION_FAILED', { reason: 'Write why these are the same (at least 3 characters).' });
        const keep = rows.find((r) => r.id === input.keepId && r.kind === input.kind && r.mergedInto === null);
        const gone = input.mergeIds.map((id) => rows.find((r) => r.id === id && r.kind === input.kind && r.mergedInto === null));
        if (!keep || gone.some((g) => !g) || input.mergeIds.includes(input.keepId)) return mockError('NOT_FOUND');
        const logins = [keep, ...(gone as Row[])].filter((r) => r.hasLogin).length;
        if (logins > 1) return mockError('CONFLICT', undefined, { message: 'Both profiles have their own sign-in, so they are two people. They cannot be merged.' });
        let relinked = 0;
        for (const g of gone as Row[]) {
          relinked += g.hotels.length;
          keep.hotels = [...keep.hotels, ...g.hotels.filter((h) => !keep.hotels.some((k) => k.hotelId === h.hotelId))];
          keep.hasLogin = keep.hasLogin || g.hasLogin;
          g.mergedInto = keep.id;
        }
        return ok({ kept: view(keep), merged: gone.length, relinked });
      }),
    keepApart: (input: KeepApartInput) =>
      call(() => {
        const [left, right] = pair(input.leftId, input.rightId);
        if (kept.some((k) => k.kind === input.kind && k.left === left && k.right === right)) return ok({ kept: false });
        kept.push({ kind: input.kind, left, right });
        return ok({ kept: true });
      }),
    undoKeepApart: (input: KeepApartInput) =>
      call(() => {
        const [left, right] = pair(input.leftId, input.rightId);
        const before = kept.length;
        kept = kept.filter((k) => !(k.kind === input.kind && k.left === left && k.right === right));
        return ok({ undone: kept.length < before });
      }),
  };
}
