import "server-only";
import { can } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { VerifiedSession } from "../../auth/session";
import type { Catalog } from "../../auth/catalog";
import type { BillingRepos } from "../../repos/billing";
import type { CompaniesRepos } from "../../repos/companies";
import type { FrontOfficeRepos } from "../../repos/frontOffice";
import type { PayrollCoreRepos } from "../../repos/payrollCore";
import type { Unit } from "../../repos/types";
import type { WebsiteRepos } from "../../repos/website";
import { istDate } from "../frontOffice/rules";

// The global search box (HMS): one question, the answers from every module the signed-in person may read. Permission-aware: a source the person has
// no view on is never asked, so nothing leaks through the search. Each source is the SAME repository search its own screen uses (every word must
// match, case-insensitive, as Pallav), capped per source and in all. Plain text only, so there is no blind index to maintain. Spec: docs/specs/admin.md §6.

const SEARCH_LIMIT = 50;
const PER_SOURCE = 8;
export const MIN_QUERY = 2;

export type SearchKind = "bill" | "advance" | "company" | "customer" | "staff" | "reservation" | "stay" | "enquiry";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  /** Staff are inside a payroll company: the screen needs it to open them. */
  companyId?: string;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  /** Hits per kind, so the screen can group them; a kind the person cannot read is absent. */
  counts: Partial<Record<SearchKind, number>>;
}

export type SearchRepos = Pick<BillingRepos, "bills" | "advances"> & Pick<CompaniesRepos, "companyProfiles" | "customers"> & Pick<PayrollCoreRepos, "payrollCompanies" | "employees"> & Pick<FrontOfficeRepos, "reservations" | "stays"> & Pick<WebsiteRepos, "siteEnquiries">;

interface SearchDeps {
  unit: Unit<SearchRepos>;
  catalog: Catalog;
  now: () => Date;
}

const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
const dmy = (d: string | null): string => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");

export function createSearchService(deps: SearchDeps) {
  const { unit, catalog, now } = deps;
  return {
    async search(session: VerifiedSession, raw: string): Promise<SearchResult> {
      // the staff search: a guest or company account has no business in the hotel's records (and no grants, so it would only be an empty answer)
      if (session.accountRole === "guest_user" || session.accountRole === "corporate_user") throw new AppError("FORBIDDEN");
      const query = raw.trim().replace(/\s+/g, " ").slice(0, 100);
      const w = words(query);
      if (query.length < MIN_QUERY) return { query, hits: [], counts: {} };
      const may = (key: string): boolean => can(session, catalog, key, "view");
      // the page only: the search never shows a total, so no list counts every match (on 10,000 bills that count was half the time)
      const page = { page: 1, pageSize: PER_SOURCE, countTotal: false };
      return unit.run(session, async (repos) => {
        const hits: SearchHit[] = [];
        const add = (kind: SearchKind, rows: SearchHit[]): void => void hits.push(...rows.map((r) => ({ ...r, kind })));

        if (may("bills.bills")) {
          const r = await repos.bills.list({ words: w, ...page, sort: "billDate", dir: "desc", deleted: "no" });
          add("bill", r.rows.map((b) => ({ kind: "bill", id: b.id, title: `Bill ${b.billNumber}`, subtitle: [b.guestName, dmy(b.billDate)].filter(Boolean).join(" · ") })));
        }
        if (may("bills.advances")) {
          const r = await repos.advances.list({ words: w, ...page, sort: "paymentDate", dir: "desc", deleted: "no" });
          add("advance", r.rows.map((a) => ({ kind: "advance", id: a.id, title: `Advance ${a.receiptNumber}`, subtitle: [a.guestName, dmy(a.paymentDate)].filter(Boolean).join(" · ") })));
        }
        if (may("companies")) {
          const c = await repos.companyProfiles.list({ words: w, deleted: "no", ...page });
          add("company", c.rows.map((x) => ({ kind: "company", id: x.id, title: x.name, subtitle: x.gstNumber ?? "" })));
          const u = await repos.customers.list({ words: w, ...page });
          add("customer", u.rows.map((x) => ({ kind: "customer", id: x.id, title: x.name, subtitle: x.mobile })));
        }
        if (may("payroll.staff")) {
          const companies = await repos.payrollCompanies.list({});
          for (const company of companies) {
            if (hits.filter((h) => h.kind === "staff").length >= PER_SOURCE) break;
            const e = await repos.employees.list(company.id, { words: w, deleted: "no", sort: "name", ...page });
            add("staff", e.rows.map((x) => ({ kind: "staff", id: x.id, title: x.name, subtitle: `${x.employeeCode} · ${company.name}`, companyId: company.id })));
          }
        }
        if (may("pms.reservations")) {
          const r = await repos.reservations.list({ view: "all", today: istDate(now()), words: w, ...page });
          add("reservation", r.rows.map((x) => ({ kind: "reservation", id: x.id, title: x.guestName, subtitle: `${x.reference}${x.mobile ? ` · ${x.mobile}` : ""}` })));
        }
        if (may("pms.stays")) {
          for (const view of ["in_house", "past"] as const) {
            const s = await repos.stays.list({ view, words: w, ...page });
            add("stay", s.rows.map((x) => ({ kind: "stay", id: x.id, title: x.guestName, subtitle: `${x.grNumber ? `GR ${x.grNumber}` : "Stay"}${x.mobile ? ` · ${x.mobile}` : ""}` })));
          }
        }
        if (may("website.enquiries")) {
          const r = await repos.siteEnquiries.list({ tab: "all", words: w, ...page });
          add("enquiry", r.rows.map((x) => ({ kind: "enquiry", id: x.id, title: x.name, subtitle: x.reference })));
        }
        const out = hits.slice(0, SEARCH_LIMIT);
        const counts: Partial<Record<SearchKind, number>> = {};
        for (const h of out) counts[h.kind] = (counts[h.kind] ?? 0) + 1;
        return { query, hits: out, counts };
      });
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
