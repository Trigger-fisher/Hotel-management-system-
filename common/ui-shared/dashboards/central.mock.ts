// In-memory mock of the Central tabs (central.ts): a few demo records per tab; dev and the local demo build only. Mobiles and emails are masked here exactly as the server masks them;
// Reveal answers a demo value. Nothing is editable.
import type {
  CentralApi, CentralCompanyDetail, CentralCompanyRow, CentralGstDetail, CentralGuestDetail, CentralGuestRow, CentralLoginDetail, CentralLookupRow, CentralPage, CentralQuery,
} from './central';
import { mockCall, mockError, ok, type MockClock } from './common';

const at = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const CONFIRM = 'Type the name exactly as shown to confirm.';
const noHistory = { mergedInto: null, mergedAt: null, mergedByName: null, mergedFrom: [] };

export function createCentralMock(clock: MockClock = {}): CentralApi {
  const logins: CentralLoginDetail[] = [
    { id: 'l1', username: 'sonal.super', displayName: 'Sonal Super', roleType: 'super_admin', status: 'active', hotels: [], lastLoginAt: at(0), locked: false, closed: false, createdAt: at(90), hotelLinks: [], blockedKind: null, blockedAt: null, lockedUntil: null, failedAttempts: 0, lockLevel: 0, mustChangePassword: false, codeRequired: true, passwordChangedAt: at(30), activeSessions: 1, profile: null },
    { id: 'l2', username: 'asha.admin', displayName: 'Asha Patel', roleType: 'hotel_admin', status: 'active', hotels: ['Hotel Sunrise'], lastLoginAt: at(2), locked: true, closed: false, createdAt: at(60), hotelLinks: [{ hotelId: 'h1', hotelName: 'Hotel Sunrise', status: 'active' }], blockedKind: 'auto', blockedAt: at(1), lockedUntil: null, failedAttempts: 5, lockLevel: 2, mustChangePassword: false, codeRequired: true, passwordChangedAt: at(40), activeSessions: 0, profile: null },
  ];
  const guests: CentralGuestDetail[] = [
    { id: 'g1', name: 'Amit Joshi', mobile: '+91 ••••• ••236', email: 'a•••@example.com', city: 'Surat', hotelCount: 2, hasLogin: true, mergedInto: null, deletedAt: null, deletedReason: null, createdAt: at(50), address: '12 Ring Road', hotels: [{ hotelId: 'h1', hotelName: 'Hotel Sunrise' }, { hotelId: 'h2', hotelName: 'Gir Lodge' }], loginUsername: 'amit.joshi', updatedAt: at(5), history: { ...noHistory, mergedFrom: [{ id: 'g0', name: 'Amit J.', mergedAt: at(10) }] } },
    { id: 'g2', name: 'Neha Shah', mobile: '+91 ••••• ••345', email: null, city: null, hotelCount: 1, hasLogin: false, mergedInto: null, deletedAt: null, deletedReason: null, createdAt: at(20), address: null, hotels: [{ hotelId: 'h1', hotelName: 'Hotel Sunrise' }], loginUsername: null, updatedAt: at(20), history: noHistory },
  ];
  const companies: CentralCompanyDetail[] = [
    { id: 'c1', name: 'Shah Textiles', gstin: '24ABCDE1234F1Z5', mainContactName: 'Ravi Shah', email: 'a•••@shahtextiles.in', mobile: '+91 ••••• ••210', hotelCount: 1, hasLogin: false, mergedInto: null, deletedAt: null, deletedReason: null, createdAt: at(30), landline: '••••• ••456', address: 'Udhna, Surat', pincode: '394210', country: 'India', contacts: [{ name: 'Ravi Shah', role: 'Owner', email: 'r•••@shahtextiles.in', mobile: '+91 ••••• ••210' }], hotels: [{ hotelId: 'h1', hotelName: 'Hotel Sunrise' }], loginUsername: null, updatedAt: at(3), history: noHistory },
  ];
  const gst: CentralGstDetail[] = [
    {
      id: 'r1', gstin: '24ABCDE1234F1Z5', legalName: 'SHAH TEXTILES PRIVATE LIMITED', tradeName: 'Shah Textiles', status: 'active', state: 'Gujarat', source: 'gstinapi', fetchedAt: at(12), refreshAfter: at(-353), timesUsed: 4, deletedAt: null, deletedReason: null, pan: 'ABCDE1234F', stateCode: '24',
      taxpayerType: 'Regular', constitution: 'Private Limited Company', registeredOn: '2018-04-02', cancelledOn: null, address: 'Udhna, Surat, Gujarat, 394210', city: 'Surat', district: 'Surat', pincode: '394210',
      natureOfBusiness: ['Wholesale Business'], blockStatus: 'Unblocked', stateJurisdiction: null, street: 'Main Road', locality: 'Udhna', buildingName: null, buildingNumber: '12', floor: null, landmark: null, raw: { legal_name: 'SHAH TEXTILES PRIVATE LIMITED', status: 'Active' }, lastUsedAt: at(1), createdAt: at(12), updatedAt: at(1),
    },
  ];
  const lookups: CentralLookupRow[] = [
    { id: 'w1', gstin: '24ABCDE1234F1Z5', provider: 'gstinapi', outcome: 'found', errorCode: null, tookMs: 830, hotelName: 'Hotel Sunrise', requestedBy: 'asha.admin', createdAt: at(12) },
    { id: 'w2', gstin: '27ABCDE1234F1Z3', provider: 'gstinapi', outcome: 'failed', errorCode: 'TIMEOUT', tookMs: 10000, hotelName: 'Gir Lodge', requestedBy: 'meena.admin', createdAt: at(3) },
  ];

  function pageOf<T>(all: T[], q: CentralQuery, text: (x: T) => (string | null)[]): CentralPage<T> {
    const s = (q.search ?? '').trim().toLowerCase();
    all = all.filter((x) => Boolean((x as { deletedAt?: string | null }).deletedAt) === (q.deleted === true));
    const rows = s ? all.filter((x) => text(x).some((v) => (v ?? '').toLowerCase().includes(s))) : all;
    const pageSize = q.pageSize ?? 25;
    const page = Math.max(1, q.page ?? 1);
    return { items: structuredClone(rows.slice((page - 1) * pageSize, page * pageSize)), total: rows.length, page, pageSize };
  }
  const one = <T extends { id: string }>(all: T[], id: string) => mockCall(() => { const x = all.find((r) => r.id === id); return x ? ok(structuredClone(x)) : mockError('NOT_FOUND'); }, clock);
  const list = <T>(all: T[], q: CentralQuery, text: (x: T) => (string | null)[]) => mockCall(() => ok(pageOf(all, q, text)), clock);

  return {
    logins: (q) => list(logins, q, (x) => [x.username, x.displayName, x.roleType]),
    guests: (q) => list<CentralGuestRow>(guests, q, (x) => [x.name, x.city]),
    companies: (q) => list<CentralCompanyRow>(companies, q, (x) => [x.name, x.gstin]),
    gst: (q) => list(gst, q, (x) => [x.gstin, x.legalName, x.tradeName, x.state]),
    lookups: (q) => list(lookups, q, (x) => [x.gstin, x.provider, x.outcome, x.hotelName]),
    login: (id) => one(logins, id),
    guest: (id) => one(guests, id),
    company: (id) => one(companies, id),
    gstRecord: (id) => one(gst, id),
    lookup: (id) => one(lookups, id),
    createLogin: (i) => mockCall(() => { const d: CentralLoginDetail = { ...logins[0], id: `l${logins.length + 1}`, username: i.username, displayName: i.displayName, roleType: i.roleType, hotels: [], hotelLinks: [] }; logins.push(d); return ok(structuredClone(d)); }, clock),
    updateLogin: (id, p) => mockCall(() => { const d = logins.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); if (p.displayName) d.displayName = p.displayName; return ok(structuredClone(d)); }, clock),
    deleteLogin: (id, i) => mockCall(() => { const k = logins.findIndex((x) => x.id === id); if (k < 0) return mockError('NOT_FOUND'); if (logins[k].username !== i.confirmName.trim()) return mockError('VALIDATION_FAILED', { confirmName: CONFIRM }); logins.splice(k, 1); return ok({ id }); }, clock),
    createGuest: (i) => mockCall(() => { const d: CentralGuestDetail = { ...guests[1], id: `g${guests.length + 1}`, name: i.name ?? 'New guest', mobile: i.mobile ? '+91 ••••• ••000' : null, email: null, hotels: [], hotelCount: 0 }; guests.push(d); return ok(structuredClone(d)); }, clock),
    updateGuest: (id, p) => mockCall(() => { const d = guests.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); if (p.name) d.name = p.name; if (p.city !== undefined) d.city = p.city; return ok(structuredClone(d)); }, clock),
    deleteGuest: (id, i) => mockCall(() => { const d = guests.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); if (d.name !== i.confirmName.trim()) return mockError('VALIDATION_FAILED', { confirmName: CONFIRM }); d.deletedAt = at(0); return ok({ id }); }, clock),
    restoreGuest: (id) => mockCall(() => { const d = guests.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); d.deletedAt = null; return ok(structuredClone(d)); }, clock),
    createCompany: (i) => mockCall(() => { const d: CentralCompanyDetail = { ...companies[0], id: `c${companies.length + 1}`, name: i.name ?? 'New company', gstin: i.gstin ?? null }; companies.push(d); return ok(structuredClone(d)); }, clock),
    updateCompany: (id, p) => mockCall(() => { const d = companies.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); if (p.name) d.name = p.name; return ok(structuredClone(d)); }, clock),
    deleteCompany: (id, i) => mockCall(() => { const d = companies.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); if (d.name !== i.confirmName.trim()) return mockError('VALIDATION_FAILED', { confirmName: CONFIRM }); d.deletedAt = at(0); return ok({ id }); }, clock),
    restoreCompany: (id) => mockCall(() => { const d = companies.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); d.deletedAt = null; return ok(structuredClone(d)); }, clock),
    createGst: (g) => mockCall(() => ok(structuredClone({ ...gst[0], id: `r${gst.length + 1}`, gstin: g })), clock),
    refreshGst: (id) => one(gst, id),
    deleteGst: (id, i) => mockCall(() => { const d = gst.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); if (d.gstin !== i.confirmName.trim()) return mockError('VALIDATION_FAILED', { confirmName: CONFIRM }); d.deletedAt = at(0); return ok({ id }); }, clock),
    restoreGst: (id) => mockCall(() => { const d = gst.find((x) => x.id === id); if (!d) return mockError('NOT_FOUND'); d.deletedAt = null; return ok(structuredClone(d)); }, clock),    reveal: (input) => mockCall(() => ok({ value: input.field.toLowerCase().includes('email') ? 'demo.person@example.com' : '+919800000000' }), clock),
  };
}
