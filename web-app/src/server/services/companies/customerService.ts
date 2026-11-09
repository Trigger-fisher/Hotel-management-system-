import "server-only";
import type { Customer, CustomerList } from "@shared/dashboards/companies";
import type { PayrollDoc } from "@shared/dashboards/payrollPay";
import type { LookupItem } from "@shared/dashboards/common";
import { canWriteAnything, requirePermission } from "../../auth/permissions";
import { maskNumber } from "../../crypto/fieldSeal";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { centralMobile, lastChangeView, type CentralProfilesUnit } from "../../repos/centralProfiles";
import type { CompaniesRepos, CustomerFields, CustomerRecord } from "../../repos/companies";
import { RepoError } from "../../repos/types";
import { istMoment, monthRange } from "../cash/ist";
import type { Person } from "../cash/ports";
import { canManage, isAdmin, isSuperAdmin } from "../cash/rules";
import { createdEntry, deletedEntry, updatedEntry, type LogContext } from "../cash/syslog";
import { Check } from "../frontOffice/validate";
import { COMPANIES_LOG, type CompaniesDeps } from "./context";
import { customerProfileDoc } from "./profileDocuments";
import { sharedGuestFields } from "./sharedProfile";
import type { CustomerBody } from "./schemas";

// Customers (Pallav CustomerController, Models/Customer.php): guest records, hard-deleted. The ID proof number is stored sealed (decision 74) and every list and record shows only its last 4 characters;
// the whole number comes from `revealIdNumber` (an audited Show). The guest's own portal screen shortens it too (guestService.ts). The portal login lives on the platform through the GuestAccounts port (ruled). Spec: docs/specs/companies.md §3.

const MODULE = "companies";
const MOBILE = /^\d{10,15}$/;

export function createCustomerService(deps: CompaniesDeps) {
  const { unit, catalog, people, now, guestAccounts } = deps;
  const logCtx = (session: VerifiedSession, meta: RequestMeta, actor: Person | undefined): LogContext => ({ userId: session.userId, userName: actor?.name ?? "System", ip: meta.ip, traceId: meta.traceId });
  const people4 = (session: VerifiedSession, extra: (string | null)[] = []) => people.get([...new Set([session.userId, ...extra.filter((x): x is string => x !== null)])]);

  async function dtos(session: VerifiedSession, rows: CustomerRecord[]): Promise<Customer[]> {
    const names = await people.get([...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))]);
    const logins = await guestAccounts.lastLogins(session.hotelId, rows.map((r) => r.id));
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      mobile: c.mobile,
      email: c.email ?? "",
      address: c.address ?? "",
      city: c.city ?? "",
      idProofType: c.idProofType ?? "",
      // decision 74: only the last 4 leave the server here; the whole number is a separate, audited call (revealIdNumber)
      idProofNumber: maskNumber(c.idProofNumber),
      idProofMasked: Boolean(c.idProofNumber),
      notes: c.notes ?? "",
      isActive: c.isActive,
      source: c.source,
      lastLoginAt: logins.get(c.id)?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      createdBy: c.createdBy ? (names.get(c.createdBy)?.name ?? null) : null,
    }));
  }

  /** :44-70: spaces, dashes and + taken out of the mobile first, so it is stored the way it is looked up. */
  async function validated(repos: CompaniesRepos, input: CustomerBody, existing: CustomerRecord | null): Promise<Omit<CustomerFields, "source">> {
    const c = new Check(false);
    const name = c.required("name", "name", input.name);
    c.max("name", "name", name, 100);
    const mobile = input.mobile.replace(/\D+/g, "");
    if (mobile === "") c.fail("mobile", "The mobile field is required.");
    else if (!MOBILE.test(mobile)) c.fail("mobile", "Enter the mobile number as digits only, 10 to 15 of them.");
    else {
      const other = await repos.customers.byMobile(mobile);
      if (other && other.id !== existing?.id) c.fail("mobile", "A customer with this mobile number already exists.");
    }
    const email = c.email("email", input.email);
    const address = c.text("address", "address", input.address, 255);
    const city = c.text("city", "city", input.city, 100);
    const idProofType = c.text("idProofType", "id proof type", input.idProofType, 60);
    // absent = keep what is stored, "" = empty. The screens show the number masked, so the masked text sent back unchanged also keeps the stored number (never saved as the number)
    let number = input.idProofNumber === undefined ? undefined : c.text("idProofNumber", "id proof number", input.idProofNumber, 50);
    const stored = existing?.idProofNumber ?? null;
    if (number && stored && number === maskNumber(stored)) number = undefined;
    else if (number && number.includes("\u2022")) c.fail("idProofNumber", "Type the whole ID number again, or leave it as it is.");
    const notes = c.text("notes", "notes", input.notes, 2000);
    c.done();
    return {
      name: name ?? "",
      mobile,
      email,
      address,
      city,
      idProofType,
      idProofNumber: number === undefined ? (existing?.idProofNumber ?? null) : (number || null),
      notes,
      isActive: input.isActive,
    };
  }
  const mobileTaken = (error: unknown): never => {
    if (error instanceof RepoError && error.kind === "unique") throw new AppError("VALIDATION_FAILED", "A customer with this mobile number already exists.", { fields: { mobile: "A customer with this mobile number already exists." } });
    throw error;
  };
  /** The central tables, when this database has them (platform 0132). */
  const centralUnit = async (): Promise<CentralProfilesUnit | null> => (deps.central && (await deps.central.run((r) => r.ready())) ? deps.central : null);
  /** Staff see the guest's ONE common profile when this record is linked to one (the same the guest and every hotel see); else the hotel's record as it is. */
  async function withCommon(session: VerifiedSession, dto: Customer): Promise<Customer> {
    const central = await centralUnit();
    if (!central) return dto;
    const found = await central.run(async (r) => {
      const g = await r.guests.ofRecord(session.hotelId, dto.id);
      return g ? { g, last: await r.history.last("guest", g.id), hotels: await r.guests.hotelCount(g.id) } : null;
    });
    if (!found) return { ...dto, common: false };
    const { last, hotels } = found;
    // the desk shows the HOTEL'S OWN record (its edits never reach the central profile); the link, the number of hotels and the last change are information only
    return { ...dto, common: true, lastChange: lastChangeView(last), sharedHotels: hotels };
  }
  /**
   * A save of the shared fields at the desk changes the ONE profile too (the hotel's copy was just written, for search and bills), and the change is recorded in the same
   * transaction: which hotel, who, which fields (security review round 2, M1(a)). Never blocks the save.
   */
  async function syncCommon(session: VerifiedSession, id: string, v: Pick<CustomerFields, "name" | "email" | "address" | "city" | "mobile">, created: boolean, by: { name: string | null; traceId: string | null }): Promise<void> {
    const central = await centralUnit();
    if (!central) return;
    await central
      .run(async (r) => {
        const fields = sharedGuestFields(v);
        const change = { kind: "guest" as const, hotelId: session.hotelId, byUserId: session.userId, byName: by.name, via: "desk" as const, at: now(), traceId: by.traceId };
        const g = await r.guests.ofRecord(session.hotelId, id);
        if (g) {
          // already linked: a hotel's edit never changes the central profile (MJ, 3 Nov 2026)
          return;
        } else if (created) {
          // CENTRAL FIRST (MJ, 3 Nov 2026): a guest with this mobile may already have the ONE profile (made at another hotel): the hotel's new record joins it, and the profile is left as it is.
          // Only when there is none is a profile made (as the backfill would); a record that is merely not linked yet waits for the backfill
          const mobile = centralMobile(v.mobile);
          const known = mobile ? await r.guests.byMobile(mobile) : null;
          if (known) {
            await r.guests.link(session.hotelId, id, known.id);
            return;
          }
          const made = await r.guests.create({ ...fields, mobile, userId: null });
          await r.guests.link(session.hotelId, id, made.id);
          await r.history.record({ ...change, profileId: made.id, fields: [] });
        }
      })
      .catch(() => undefined);
  }
  /** Customer::editableBy: someone who can write, over a record they may manage (no creator: anyone who can write). */
  const editable = (session: VerifiedSession, creator: Person | null, hasCreator: boolean): boolean => canWriteAnything(session) && (!hasCreator || canManage(session, catalog, creator));
  const logFields = (c: CustomerRecord): Record<string, unknown> => ({ Name: c.name, Mobile: c.mobile, Email: c.email, Address: c.address, City: c.city, "Id proof type": c.idProofType, Notes: c.notes });

  return {
    /** One record as the apps get it (the CRM shows the customer a lead became). */
    dtoOne: async (session: VerifiedSession, c: CustomerRecord): Promise<Customer> => (await dtos(session, [c]))[0],

    async list(session: VerifiedSession, q: { search?: string; tab: "all" | "active" | "off"; page: number; pageSize: number }): Promise<CustomerList> {
      requirePermission(session, catalog, MODULE, "view");
      const words = [...(q.search ?? "").matchAll(/"[^"]+"|\S+/gu)].map((m) => m[0].replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);
      const monthFrom = new Date(`${monthRange(istMoment(now()).date).from}T00:00:00+05:30`);
      return unit.run(session, async (repos) => {
        const listed = await repos.customers.list({ words, active: q.tab === "all" ? undefined : q.tab === "active", page: q.page, pageSize: q.pageSize });
        const s = await repos.customers.stats(monthFrom);
        return {
          page: { items: await dtos(session, listed.rows), total: listed.total, page: q.page, pageSize: q.pageSize },
          counts: await repos.customers.counts(words),
          stats: { total: s.total, selfSignup: s.selfSignup, withEmail: s.withEmail, addedThisMonth: s.month },
        };
      });
    },

    async get(session: VerifiedSession, id: string): Promise<Customer> {
      requirePermission(session, catalog, MODULE, "view");
      const dto = await unit.run(session, async (repos) => {
        const c = await repos.customers.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        return (await dtos(session, [c]))[0];
      });
      return withCommon(session, dto);
    },

    /** The profile as the document the PDF draws: the SAME fields and permission as `get` (the ID number prints as its last 4 characters, decision 74). */
    async profileDocument(session: VerifiedSession, id: string): Promise<{ doc: PayrollDoc; filename: string }> {
      const customer = await this.get(session, id);
      const header = await unit.run(session, (repos) => repos.hotelProfile.header());
      return { doc: customerProfileDoc(header, customer), filename: `guest-${customer.name}` };
    },

    async lookup(session: VerifiedSession, q: { q: string; limit: number }): Promise<LookupItem[]> {
      requirePermission(session, catalog, MODULE, "view");
      return unit.run(session, async (repos) => (await repos.customers.lookup(q.q, Math.min(50, q.limit))).map((c) => ({ id: c.id, label: c.name, hint: c.mobile })));
    },

    /** store (:77-98): the record, then a portal login through the platform (a temporary password emailed). */
    async create(session: VerifiedSession, input: CustomerBody, meta: RequestMeta): Promise<{ customer: Customer; emailed: boolean }> {
      requirePermission(session, catalog, MODULE, "create");
      const names = await people4(session);
      const made = await unit.run(session, async (repos) => {
        const v = await validated(repos, input, null);
        const c = await repos.customers.create({ ...v, source: "admin", createdBy: session.userId }).catch(mobileTaken);
        await repos.systemLogs.write(createdEntry(logCtx(session, meta, names.get(session.userId)), "Customer", { id: c.id, label: c.name }, Object.fromEntries(Object.entries({ Mobile: c.mobile, Email: c.email }).filter(([, x]) => x !== null)), COMPANIES_LOG));
        const { emailed } = await guestAccounts.issue(session.hotelId, c);
        return { customer: (await dtos(session, [c]))[0], emailed, v };
      });
      // after the hotel's commit: the new guest's own ONE profile (platform 0132)
      await syncCommon(session, made.customer.id, made.v, true, { name: names.get(session.userId)?.name ?? null, traceId: meta.traceId });
      return { customer: await withCommon(session, made.customer), emailed: made.emailed };
    },

    /** update (:105-119) */
    async update(session: VerifiedSession, id: string, input: CustomerBody, meta: RequestMeta): Promise<Customer> {
      requirePermission(session, catalog, MODULE, "edit");
      const saved = await unit.run(session, async (repos) => {
        const c = await repos.customers.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        const names = await people4(session, [c.createdBy]);
        if (!editable(session, c.createdBy ? (names.get(c.createdBy) ?? null) : null, c.createdBy !== null)) throw new AppError("FORBIDDEN", "Only an Admin or whoever added this customer can edit it.");
        const v = await validated(repos, input, c);
        const updated = await repos.customers.update(c.id, v, session.userId).catch(mobileTaken);
        if (!updated) throw new AppError("NOT_FOUND");
        await repos.systemLogs.write(updatedEntry(logCtx(session, meta, names.get(session.userId)), "Customer", { id: c.id, label: updated.name }, logFields(c), logFields(updated), COMPANIES_LOG));
        return { dto: (await dtos(session, [updated]))[0], v, by: names.get(session.userId)?.name ?? null };
      });
      // after the hotel's commit: the shared fields of the ONE profile (platform 0132), when this record is linked to one
      await syncCommon(session, id, saved.v, false, { name: saved.by, traceId: meta.traceId });
      return withCommon(session, saved.dto);
    },

    /**
     * Show (decision 74): the whole ID number of one customer, for someone who may edit it. Every call is written to the Activity log (who, which customer, when), never the number.
     * Refused to platform staff during a visit and to API keys (visitAccess.ts, apiTokens.ts).
     */
    async revealIdNumber(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ idProofNumber: string }> {
      requirePermission(session, catalog, MODULE, "edit");
      return unit.run(session, async (repos) => {
        const c = await repos.customers.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        const names = await people4(session, [c.createdBy]);
        if (!editable(session, c.createdBy ? (names.get(c.createdBy) ?? null) : null, c.createdBy !== null)) throw new AppError("FORBIDDEN", "Only an Admin or whoever added this customer can see the whole ID number.");
        if (!c.idProofNumber) throw new AppError("CONFLICT", `${c.name} has no ID number saved.`);
        await repos.systemLogs.write({ ...updatedEntry(logCtx(session, meta, names.get(session.userId)), "Customer", { id: c.id, label: c.name }, {}, {}, COMPANIES_LOG), summary: `ID number shown for ${c.name}`, details: null });
        return { idProofNumber: c.idProofNumber };
      });
    },

    /** resetLogin (:122-139) */
    async resetLogin(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ emailed: boolean; message: string }> {
      requirePermission(session, catalog, MODULE, "edit");
      return unit.run(session, async (repos) => {
        const c = await repos.customers.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        const names = await people4(session, [c.createdBy]);
        if (!editable(session, c.createdBy ? (names.get(c.createdBy) ?? null) : null, c.createdBy !== null)) throw new AppError("FORBIDDEN", "Only an Admin or whoever added this customer can reset the login.");
        if (!c.email) throw new AppError("CONFLICT", `Add an email address for ${c.name} first: the new password is sent there.`);
        const { emailed } = await guestAccounts.reset(session.hotelId, c);
        await repos.systemLogs.write({ ...updatedEntry(logCtx(session, meta, names.get(session.userId)), "Customer", { id: c.id, label: c.name }, {}, {}, COMPANIES_LOG), summary: `Login reset for ${c.name}`, details: null });
        return { emailed, message: emailed ? `A new login was emailed to ${c.email}.` : "The password was reset, but the email could not be sent. Check Settings, Email." };
      });
    },

    /** destroy (:166-178): Full Access, and the SuperAdmin or an Admin (Customer::deletableBy). Hard delete. */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, MODULE, "full");
      if (!(isSuperAdmin(session) || isAdmin(session, catalog))) throw new AppError("FORBIDDEN", "Only an Admin can delete a customer.");
      const names = await people4(session);
      return unit.run(session, async (repos) => {
        const c = await repos.customers.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        await repos.customers.delete(c.id);
        await repos.systemLogs.write(deletedEntry(logCtx(session, meta, names.get(session.userId)), "Customer", { id: c.id, label: c.name }, Object.fromEntries(Object.entries({ Mobile: c.mobile, Email: c.email }).filter(([, x]) => x !== null)), COMPANIES_LOG));
        return { id: c.id };
      });
    },
  };
}

export type CustomerService = ReturnType<typeof createCustomerService>;
