import "server-only";
import type { CompanyList, CompanyProfile } from "@shared/dashboards/companies";
import type { PayrollDoc } from "@shared/dashboards/payrollPay";
import type { LookupItem } from "@shared/dashboards/common";
import { canUseRecycleBin } from "../../auth/access";
import { can, canWriteAnything, requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import { lastChangeView, type CentralProfilesUnit } from "../../repos/centralProfiles";
import type { CompaniesRepos, CompanyFields, CompanyRecord } from "../../repos/companies";
import { RepoError } from "../../repos/types";
import { istMoment, monthRange } from "../cash/ist";
import type { Person } from "../cash/ports";
import { canManage, isAdmin, isSuperAdmin } from "../cash/rules";
import { createdEntry, deletedEntry, updatedEntry, type LogContext } from "../cash/syslog";
import { Check } from "../frontOffice/validate";
import { COMPANIES_LOG, type CompaniesDeps } from "./context";
import { companyProfileDoc } from "./profileDocuments";
import { sharedCompanyFields } from "./sharedProfile";
import type { CompanyBody } from "./schemas";

// Company Profiles (Pallav CompanyProfileController, Models/CompanyProfile.php). Soft-deleted (recycle bin); the GST percentage and the other
// rates are display-only (B1 finding: nothing computes with them). Spec: docs/specs/companies.md §2.

const MODULE = "companies";

/** "12.5" from 12.5; decimal(5,2) text. */
const pctText = (v: number | null): string | null => (v === null ? null : (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, ""));
const pctNumber = (v: string | null): number | null => (v === null ? null : Number(v));

/** Pallav's columns, readable (SystemLogger::fieldName), for the log. */
const LABEL: Record<keyof CompanyFields, string> = {
  name: "Name", email: "Email", mobileNumber: "Mobile number", phoneNumber: "Phone number", country: "Country", nationality: "Nationality", pincode: "Pincode",
  gstNumber: "Gst number", address: "Address", discountPercentage: "Discount percentage", gstPercentage: "Gst percentage", tcsPercentage: "Tcs percentage",
  tdsPercentage: "Tds percentage", instruction: "Instruction", contacts: "Contacts",
};
const logView = (c: CompanyFields): Record<string, unknown> => Object.fromEntries((Object.keys(LABEL) as (keyof CompanyFields)[]).map((k) => [LABEL[k], k === "contacts" ? JSON.stringify(c.contacts) : c[k]]));

export function createCompanyService(deps: CompaniesDeps) {
  const { unit, catalog, people, now } = deps;

  const peopleOf = (rows: readonly { createdBy: string | null }[]) => people.get([...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))]);
  const dto = (c: CompanyRecord, names: ReadonlyMap<string, Person>): CompanyProfile => ({
    id: c.id,
    name: c.name,
    gstNumber: c.gstNumber ?? "",
    mobile: c.mobileNumber ?? "",
    phone: c.phoneNumber ?? "",
    email: c.email ?? "",
    address: c.address ?? "",
    country: c.country ?? "",
    pincode: c.pincode ?? "",
    nationality: c.nationality ?? "",
    discountPct: pctNumber(c.discountPercentage),
    gstPct: pctNumber(c.gstPercentage),
    tcsPct: pctNumber(c.tcsPercentage),
    tdsPct: pctNumber(c.tdsPercentage),
    instruction: c.instruction ?? "",
    contacts: c.contacts.map((p) => ({ ...p })),
    createdAt: c.createdAt.toISOString(),
    createdBy: c.createdBy ? (names.get(c.createdBy)?.name ?? "") : "",
  });
  const logCtx = (session: VerifiedSession, meta: RequestMeta, actor: Person | undefined): LogContext => ({ userId: session.userId, userName: actor?.name ?? "System", ip: meta.ip, traceId: meta.traceId });

  /** :99-150: the rules, Pallav's custom messages, and the contact rows tidied (empty rows the form left behind are dropped). */
  async function validated(repos: CompaniesRepos, input: CompanyBody, except?: string): Promise<CompanyFields> {
    const c = new Check(false);
    const name = c.required("name", "name", input.name);
    c.max("name", "name", name, 100);
    if (name && (await repos.companyProfiles.nameTaken(name, except))) c.fail("name", "The name has already been taken.");
    const address = c.text("address", "address", input.address, 100);
    const country = c.text("country", "country", input.country, 100);
    const nationality = c.text("nationality", "nationality", input.nationality, 100);
    const email = c.email("email", input.email);
    const pincode = c.text("pincode", "pincode", input.pincode, 20);
    const mobile = c.text("mobile", "mobile number", input.mobile, 15);
    const phone = c.text("phone", "phone number", input.phone, 15);
    for (const [key, label, v] of [["discountPct", "discount percentage", input.discountPct], ["gstPct", "gst percentage", input.gstPct], ["tcsPct", "tcs percentage", input.tcsPct], ["tdsPct", "tds percentage", input.tdsPct]] as const) {
      if (v !== null && (v < 0 || v > 100)) c.fail(key, `The ${label} field must be between 0 and 100.`);
    }
    const instruction = c.text("instruction", "instruction", input.instruction, 20_000);
    const gst = c.text("gstNumber", "gst number", input.gstNumber, 50);
    const contacts = input.contacts
      .map((p) => ({ role: p.role.trim(), name: p.name.trim(), email: p.email.trim(), mobile: p.mobile.trim() }))
      .filter((p) => p.name !== "" || p.email !== "" || p.mobile !== "");
    if (contacts.length === 0) c.fail("contacts", "Add at least one person to contact.");
    if (contacts.length > 30) c.fail("contacts", "The contacts field must not have more than 30 items.");
    contacts.forEach((p, i) => {
      if (p.name === "") c.fail(`contacts.${i}.name`, "Every contact person needs a name.");
      c.max(`contacts.${i}.name`, `contacts.${i}.name`, p.name || null, 100);
      c.max(`contacts.${i}.role`, `contacts.${i}.role`, p.role || null, 60);
      if (p.email !== "") c.email(`contacts.${i}.email`, p.email);
      c.max(`contacts.${i}.mobile`, `contacts.${i}.mobile`, p.mobile || null, 15);
    });
    c.done();
    // :157-159, :184-186 a GST number belongs to one company
    if (gst && (await repos.companyProfiles.withGstNumber(gst, except))) {
      throw new AppError("VALIDATION_FAILED", "A company with this GST number already exists.", { fields: { gstNumber: "A company with this GST number already exists." } });
    }
    return {
      name: name ?? "", email, mobileNumber: mobile, phoneNumber: phone, country, nationality, pincode, gstNumber: gst, address,
      discountPercentage: pctText(input.discountPct), gstPercentage: pctText(input.gstPct), tcsPercentage: pctText(input.tcsPct), tdsPercentage: pctText(input.tdsPct),
      instruction, contacts,
    };
  }
  const nameTaken = (error: unknown): never => {
    if (error instanceof RepoError && error.kind === "unique") throw new AppError("VALIDATION_FAILED", "The name has already been taken.", { fields: { name: "The name has already been taken." } });
    throw error;
  };
  const people4 = async (session: VerifiedSession, extra: (string | null)[] = []) => people.get([...new Set([session.userId, ...extra.filter((x): x is string => x !== null)])]);

  /** The central tables, when this database has them (platform 0132). */
  const centralUnit = async (): Promise<CentralProfilesUnit | null> => (deps.central && (await deps.central.run((r) => r.ready())) ? deps.central : null);
  /** Staff see the company's ONE common profile when this record is linked to one (the same the company and every hotel see); the prices stay this hotel's. */
  async function withCommon(session: VerifiedSession, p: CompanyProfile): Promise<CompanyProfile> {
    const central = await centralUnit();
    if (!central) return p;
    const found = await central.run(async (r) => {
      const c = await r.companies.ofRecord(session.hotelId, p.id);
      return c ? { c, last: await r.history.last("company", c.id), hotels: await r.companies.hotelCount(c.id) } : null;
    });
    if (!found) return { ...p, common: false };
    const { last, hotels } = found;
    // the desk shows the HOTEL'S OWN record (its edits never reach the central profile); the link, the count of hotels and the profile's last change are only information
    return { ...p, common: true, lastChange: lastChangeView(last), sharedHotels: hotels };
  }
  /**
   * Before a desk save of a record linked to the ONE profile (read inside the hotel's save, after its own checks, so a refused save changes nothing):
   *   M1(c) the GSTIN and the legal name are the company's identity at every hotel: only Full Access on Companies (a manager or the owner) may change them here (403);
   *   M1(b) a change of shared fields that other hotels share is refused (409) until the person confirms (`confirmShared`). Prices and the instruction never ask.
   */
  async function checkShared(session: VerifiedSession, id: string, v: CompanyFields, current: CompanyRecord): Promise<void> {
    // MJ, 3 Nov 2026: a hotel's edit changes the hotel's own record only (never the central profile), so there is no "this changes N hotels" step. The identity rule stays:
    // for a record linked to the ONE profile, the GSTIN and the name change only with Full Access on Companies.
    const central = await centralUnit();
    if (!central) return;
    const linked = await central.run(async (r) => (await r.companies.ofRecord(session.hotelId, id)) !== null);
    if (!linked || can(session, catalog, MODULE, "full")) return;
    if ((v.gstNumber ?? "") !== (current.gstNumber ?? "")) throw new AppError("FORBIDDEN", "Ask a manager to change the GSTIN.");
    if (v.name !== current.name) throw new AppError("FORBIDDEN", "Ask a manager to change the company name.");
  }
  /**
   * A save of the shared fields at the desk changes the ONE profile too (the hotel's copy was just written), and the change is recorded in the same transaction: which hotel,
   * who, which fields (security review round 2, M1(a)). A new record gets its own profile at once. Never blocks the save.
   */
  async function syncCommon(session: VerifiedSession, id: string, v: CompanyFields, created: boolean, by: { name: string | null; traceId: string | null }): Promise<void> {
    const central = await centralUnit();
    if (!central) return;
    const fields = sharedCompanyFields(v);
    await central
      .run(async (r) => {
        const change = { kind: "company" as const, hotelId: session.hotelId, byUserId: session.userId, byName: by.name, via: "desk" as const, at: now(), traceId: by.traceId };
        const c = await r.companies.ofRecord(session.hotelId, id);
        if (c) {
          // already linked: a hotel's edit never changes the central profile (MJ, 3 Nov 2026). Only a NEW record reaches this function's work.
          return;
        } else if (created) {
          // CENTRAL FIRST (MJ, 3 Nov 2026): a company with this GSTIN may already have the ONE profile (made at another hotel): the hotel's new record joins it, and the profile is left as it is
          const known = fields.gstin ? await r.companies.byGstin(fields.gstin) : null;
          if (known) {
            await r.companies.link(session.hotelId, id, known.id);
            return;
          }
          const made = await r.companies.create({ ...fields, userId: null });
          await r.companies.link(session.hotelId, id, made.id);
          await r.history.record({ ...change, profileId: made.id, fields: [] });
        }
      })
      .catch(() => undefined);
  }

  return {
    /** A record as the apps get it, for a caller already inside a unit (never open a second unit on the same hotel). */
    dtoOne: async (c: CompanyRecord): Promise<CompanyProfile> => dto(c, await peopleOf([c])),

    async list(session: VerifiedSession, q: { search?: string; page: number; pageSize: number; deleted: "no" | "only" }): Promise<CompanyList> {
      requirePermission(session, catalog, MODULE, "view");
      if (q.deleted === "only" && !canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      // every word, or a "quoted phrase" (:46-55)
      const words = [...(q.search ?? "").matchAll(/"[^"]+"|\S+/gu)].map((m) => m[0].replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);
      const monthFrom = new Date(`${monthRange(istMoment(now()).date).from}T00:00:00+05:30`);
      return unit.run(session, async (repos) => {
        const listed = await repos.companyProfiles.list({ words, deleted: q.deleted, page: q.page, pageSize: q.pageSize });
        const s = await repos.companyProfiles.stats(monthFrom);
        const names = await peopleOf(listed.rows);
        return { page: { items: listed.rows.map((c) => dto(c, names)), total: listed.total, page: q.page, pageSize: q.pageSize }, stats: { total: s.total, withGst: s.withGst, contacts: s.contacts, addedThisMonth: s.month } };
      });
    },

    async get(session: VerifiedSession, id: string): Promise<CompanyProfile> {
      requirePermission(session, catalog, MODULE, "view");
      const p = await unit.run(session, async (repos) => {
        const c = await repos.companyProfiles.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        return dto(c, await peopleOf([c]));
      });
      return withCommon(session, p);
    },

    /** The profile as the document the PDF draws: the SAME fields, limits and permission as `get`, on the hotel's header. */
    async profileDocument(session: VerifiedSession, id: string): Promise<{ doc: PayrollDoc; filename: string }> {
      const company = await this.get(session, id);
      const header = await unit.run(session, (repos) => repos.hotelProfile.header());
      return { doc: companyProfileDoc(header, company), filename: `company-${company.name}` };
    },

    /**
     * The forms' lists, from the hotel's data (never the apps' constants): ID proof types (id_proof_types), contact roles (Master Data
     * `company_contact_role`, CompanyProfileController.php:9-12).
     */
    async options(session: VerifiedSession): Promise<{ idTypes: string[]; contactRoles: string[] }> {
      requirePermission(session, catalog, MODULE, "view");
      return unit.run(session, async (repos) => {
        return {
          idTypes: await repos.idProofTypes.activeNames(),
          contactRoles: (await repos.optionLists.items("company_contact_role")).map((i) => i.value),
        };
      });
    },

    /**
     * The GST lookup asks this FIRST (MJ, 3 Nov 2026): is this GSTIN already one of THIS hotel's companies? Only the signed-in hotel is read; a person who may not see companies, or
     * has no hotel, gets null. `except` is the company being edited (it does not count as a duplicate of itself).
     */
    async byGstin(session: VerifiedSession, gstin: string, except?: string): Promise<{ id: string; name: string } | null> {
      if (session.hotelId === "" || !can(session, catalog, MODULE, "view")) return null;
      return unit.run(session, async (repos) => {
        const c = (await repos.companyProfiles.withGstNumber(gstin, except)) ?? (await repos.companyProfiles.withGstNumber(gstin.toLowerCase(), except));
        return c ? { id: c.id, name: c.name } : null;
      });
    },

    /** The company picker everywhere (decided shape): prefix, at most 50, id + label + GST number as the hint. */
    async lookup(session: VerifiedSession, q: { q: string; limit: number }): Promise<LookupItem[]> {
      requirePermission(session, catalog, MODULE, "view");
      return unit.run(session, async (repos) => (await repos.companyProfiles.lookup(q.q, Math.min(50, q.limit))).map((c) => ({ id: c.id, label: c.name, ...(c.gstNumber ? { hint: c.gstNumber } : {}) })));
    },

    /** store (:152-171) */
    async create(session: VerifiedSession, input: CompanyBody, meta: RequestMeta): Promise<CompanyProfile> {
      requirePermission(session, catalog, MODULE, "create");
      const names = await people4(session);
      const actor = names.get(session.userId);
      const made = await unit.run(session, async (repos) => {
        const v = await validated(repos, input);
        const c = await repos.companyProfiles.create({ ...v, createdBy: session.userId }).catch(nameTaken);
        await repos.systemLogs.write(createdEntry(logCtx(session, meta, actor), "Company", { id: c.id, label: c.name }, Object.fromEntries(Object.entries({ "GST number": c.gstNumber, Email: c.email, Mobile: c.mobileNumber, People: c.contacts.length }).filter(([, x]) => x !== null)), COMPANIES_LOG));
        return { profile: dto(c, names), v };
      });
      // after the hotel's commit: the new company's own ONE profile (platform 0132)
      await syncCommon(session, made.profile.id, made.v, true, { name: actor?.name ?? null, traceId: meta.traceId });
      return withCommon(session, made.profile);
    },

    /** update (:173-197): the SuperAdmin, an Admin or whoever added it (CompanyProfile::editableBy). */
    async update(session: VerifiedSession, id: string, input: CompanyBody, meta: RequestMeta): Promise<CompanyProfile> {
      requirePermission(session, catalog, MODULE, "edit");
      const saved = await unit.run(session, async (repos) => {
        const c = await repos.companyProfiles.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        const names = await people4(session, [c.createdBy]);
        const creator = c.createdBy ? (names.get(c.createdBy) ?? null) : null;
        if (!(canWriteAnything(session) && canManage(session, catalog, creator))) throw new AppError("FORBIDDEN", "Only an Admin or whoever added this company can edit it.");
        const v = await validated(repos, input, c.id);
        await checkShared(session, c.id, v, c);
        const updated = await repos.companyProfiles.update(c.id, v, session.userId).catch(nameTaken);
        if (!updated) throw new AppError("NOT_FOUND");
        await repos.systemLogs.write(updatedEntry(logCtx(session, meta, names.get(session.userId)), "Company", { id: c.id, label: updated.name }, logView(c), logView(updated), COMPANIES_LOG));
        return { profile: dto(updated, names), v, by: names.get(session.userId)?.name ?? null };
      });
      // after the hotel's commit: the shared fields of the ONE profile (platform 0132), when this record is linked to one
      await syncCommon(session, id, saved.v, false, { name: saved.by, traceId: meta.traceId });
      return withCommon(session, saved.profile);
    },

    /** destroy (:216-229): Full Access, and the SuperAdmin, or an Admin over a company a SuperAdmin did not add (CompanyProfile::deletableBy). */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string }> {
      requirePermission(session, catalog, MODULE, "full");
      return unit.run(session, async (repos) => {
        const c = await repos.companyProfiles.get(id);
        if (!c) throw new AppError("NOT_FOUND");
        const names = await people4(session, [c.createdBy]);
        const creator = c.createdBy ? names.get(c.createdBy) : undefined;
        const allowed = isSuperAdmin(session) || (isAdmin(session, catalog) && creator?.roleKey !== "super_admin");
        if (!allowed) throw new AppError("FORBIDDEN", "Only an Admin can delete a company.");
        await repos.companyProfiles.softDelete(c.id, session.userId);
        await repos.systemLogs.write(deletedEntry(logCtx(session, meta, names.get(session.userId)), "Company", { id: c.id, label: c.name }, Object.fromEntries(Object.entries({ "GST number": c.gstNumber, Email: c.email, Mobile: c.mobileNumber, People: c.contacts.length }).filter(([, x]) => x !== null)), COMPANIES_LOG));
        return { id: c.id };
      });
    },

    async restore(session: VerifiedSession, id: string, meta: RequestMeta): Promise<CompanyProfile> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      return unit.run(session, async (repos) => {
        const restored = await repos.companyProfiles.restore(id, session.userId).catch(nameTaken);
        if (!restored) throw new AppError("NOT_FOUND");
        const names = await people4(session, [restored.createdBy]);
        await repos.systemLogs.write(createdEntry(logCtx(session, meta, names.get(session.userId)), "Company", { id: restored.id, label: restored.name }, { "Restored by": names.get(session.userId)?.name ?? "System" }, "recycle-bin"));
        return dto(restored, names);
      });
    },

    async purge(session: VerifiedSession, id: string): Promise<{ id: string }> {
      if (!canUseRecycleBin(session)) throw new AppError("FORBIDDEN");
      return unit.run(session, async (repos) => {
        const gone = await repos.companyProfiles.purge(id).catch((error: unknown) => {
          if (error instanceof RepoError && error.kind === "check") throw new AppError("CONFLICT", "This company is named on bills or advances; it stays in the recycle bin.");
          throw error;
        });
        if (!gone) throw new AppError("NOT_FOUND");
        return { id };
      });
    },
  };
}

export type CompanyService = ReturnType<typeof createCompanyService>;
