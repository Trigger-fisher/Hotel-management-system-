import "server-only";
import { checkGstin, gstCopy, type GstLookupResult, type GstRegistryEntry, type GstStatus } from "@shared/dashboards/gst";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";

// GST lookup (MJ, 2 Nov 2026; platform 0167): a GSTIN typed in HMS is checked here first (free: shape, state, PAN, check character), then found in our own saved records (free), and only
// when it is not there (or is due for a re-check) asked of the GST lookup service, once; the answer is saved for every hotel. Every call to the service is logged (gst_lookups), never its
// key or its words. With no service set up, a valid GSTIN still answers with its state and PAN.

/** What the lookup service answers for one GSTIN (fields it does not give stay null). */
export interface GstProviderRecord {
  legalName: string | null;
  tradeName: string | null;
  status: GstStatus;
  taxpayerType: string | null;
  constitution: string | null;
  registeredOn: string | null;
  cancelledOn: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  natureOfBusiness: string[];
  blockStatus: string | null;
  stateJurisdiction: string | null;
  street: string | null;
  locality: string | null;
  buildingName: string | null;
  buildingNumber: string | null;
  floor: string | null;
  landmark: string | null;
  /** The service's whole answer about the company, kept as it came (without the billing fields beside it, and never the key). */
  raw: Record<string, unknown>;
}

export interface GstProvider {
  /** Its id (gst_registry.source, gst_lookups.provider): lower-case letters, digits, - and _. */
  id: string;
  lookup(gstin: string): Promise<{ found: true; record: GstProviderRecord } | { found: false }>;
}

export interface GstPorts {
  get(gstin: string): Promise<(GstRegistryEntry & { refreshAfter: string }) | null>;
  save(gstin: string, record: GstProviderRecord, source: string, fetchedAt: Date, refreshAfter: Date): Promise<GstRegistryEntry>;
  /** One more use of a saved record. */
  touch(gstin: string, at: Date): Promise<void>;
  log(row: { gstin: string; provider: string; outcome: "found" | "not_found" | "failed"; errorCode: string | null; tookMs: number; requestedBy: string | null; hotelId: string | null }): Promise<void>;
}

/** A saved record is looked up again after a year (a registration can be cancelled meanwhile). */
export const GST_REFRESH_DAYS = 365;

/** The hotel's own companies, asked first (the signed-in hotel only; a person who may not see companies, or has no hotel, gets null). `except` is the company being edited. */
export type HotelCompanyFinder = (session: VerifiedSession, gstin: string, except?: string) => Promise<{ id: string; name: string } | null>;

export function createGstService(deps: { ports: GstPorts; provider: GstProvider | null; now: () => Date; hotelCompany?: HotelCompanyFinder; log?: (message: string, fields: Record<string, unknown>) => void }) {
  const C = gstCopy;
  return {
    /**
     * The order: 1 the signed-in hotel's own companies (a GSTIN already there is said, with its company, and nothing is fetched), 2 the saved central record, 3 the lookup service, once, saved
     * centrally. The hotel's company is its own copy: this service never writes it, and nothing a hotel does reaches the central record.
     */
    async lookup(session: VerifiedSession, raw: string, options: { except?: string; refresh?: boolean } = {}): Promise<GstLookupResult> {
      // anyone signed in to HMS (hotel staff, the platform, a group); never an API key: each call can cost money
      if (session.client === "token" || session.token !== undefined) throw new AppError("FORBIDDEN");
      const check = checkGstin(raw);
      const providerReady = deps.provider !== null;
      if (!check.ok) return { check, entry: null, from: "none", providerReady, message: C.problems[check.problem ?? "format"] };
      const own = deps.hotelCompany && !options.refresh ? await deps.hotelCompany(session, check.gstin, options.except).catch(() => null) : null;
      if (own) return { check, entry: null, from: "hotel", inHotel: { id: own.id, name: own.name }, providerReady, message: C.inHotel(own.name) };
      const now = deps.now();
      const saved = await deps.ports.get(check.gstin);
      const fresh = saved !== null && Date.parse(saved.refreshAfter) > now.getTime() && !options.refresh;
      const answer = (entry: GstRegistryEntry, from: "saved" | "provider"): GstLookupResult => {
        const { refreshAfter: _r, ...plain } = entry as GstRegistryEntry & { refreshAfter?: string };
        void _r;
        return { check, entry: plain, from, providerReady, message: plain.status === "cancelled" ? C.cancelled : from === "saved" ? C.saved : C.found };
      };
      if (saved && (fresh || (!deps.provider && !options.refresh))) {
        await deps.ports.touch(check.gstin, now);
        return answer(saved, "saved");
      }
      if (!deps.provider) return { check, entry: null, from: "none", providerReady, message: C.notReady };
      const started = Date.now();
      const by = { requestedBy: session.userId || null, hotelId: session.hotelId || null };
      const provider = deps.provider;
      // the call log never changes the answer: a company already paid for is still shown and saved when its log row cannot be written
      const logCall = (outcome: "found" | "not_found" | "failed", errorCode: string | null, tookMs: number) =>
        deps.ports.log({ gstin: check.gstin, provider: provider.id, outcome, errorCode, tookMs, ...by }).catch((e: unknown) => deps.log?.("gst lookup log not written", { reason: (e as Error).message }));
      try {
        const got = await provider.lookup(check.gstin);
        const tookMs = Date.now() - started;
        if (!got.found) {
          await logCall("not_found", null, tookMs);
          return { check, entry: null, from: "none", providerReady, message: C.notFound };
        }
        const entry = await deps.ports.save(check.gstin, got.record, provider.id, now, new Date(now.getTime() + GST_REFRESH_DAYS * 86_400_000));
        await logCall("found", null, tookMs);
        return answer(entry, "provider");
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        const errorCode = typeof code === "string" && /^[A-Z_]{1,40}$/.test(code) ? code : "FAILED";
        await logCall("failed", errorCode, Date.now() - started);
        deps.log?.("gst lookup failed", { code: errorCode, reason: (error as Error).message });
        // a record due for a re-check still answers when the service does not
        if (saved) return answer(saved, "saved");
        return { check, entry: null, from: "none", providerReady, message: C.failed };
      }
    },
  };
}

export type GstService = ReturnType<typeof createGstService>;
