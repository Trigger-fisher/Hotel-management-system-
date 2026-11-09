// Hotel Pallav's own scratch demo rows (docs/sessions/assets/S08-fixtures/company_profiles.json) turned into the Companies mock's profiles, so the list and
// the profile form show the SAME companies as Pallav. Only used when the dev preview asks for it (`?data=s08`). Ids are the Pallav id as a string,
// the same scheme the billing and front-office adapters use. Pallav has no ledger table of its own (it is computed from bills), so it starts empty.
import type { CompaniesSeed, CompanyContact, CompanyProfile } from './companies';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const pct = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v) || 0);

export function companiesSeedFromFixtures(rows: Row[]): CompaniesSeed {
  const contactsOf = (r: Row): CompanyContact[] => {
    try {
      const x: unknown = JSON.parse(str(r.contacts) || '[]');
      if (Array.isArray(x)) {
        const list = (x as Row[]).map((c) => ({ role: str(c.role), name: str(c.name), email: str(c.email), mobile: str(c.mobile) }));
        if (list.length) return list;
      }
    } catch {
      /* fall through to the flat columns */
    }
    return [{ role: 'Main contact', name: str(r.name), email: str(r.email), mobile: str(r.mobile_number) }];
  };
  const companies: CompanyProfile[] = rows.filter((r) => !r.deleted_at).map((r) => ({
    id: String(Number(r.id)), name: str(r.name), gstNumber: str(r.gst_number), mobile: str(r.mobile_number), phone: str(r.phone_number), email: str(r.email),
    address: str(r.address), country: str(r.country), pincode: str(r.pincode), nationality: str(r.nationality), discountPct: pct(r.discount_percentage),
    gstPct: pct(r.gst_percentage), tcsPct: pct(r.tcs_percentage), tdsPct: pct(r.tds_percentage), instruction: str(r.instruction), contacts: contactsOf(r),
    createdAt: new Date(`${str(r.created_at).slice(0, 10)}T${str(r.created_at).slice(11, 19) || '00:00:00'}+05:30`).toISOString(), createdBy: 'Admin',
  }));
  return { companies };
}
