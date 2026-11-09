import "server-only";
// A guest's agreement to automatic WhatsApp messages: customers.wa_consent_at / wa_consent_by (hotel 0057). The sender reads it by the guest's mobile number (whatsappSend.ts hasConsent).
type Query = { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WaConsent {
  on: boolean;
  at: string | null;
  /** The guest has no mobile number on the record: a message could never be matched to the consent. */
  hasMobile: boolean;
}

export interface WaConsentRepo {
  get(customerId: string): Promise<WaConsent | null>;
  /** Records (or withdraws) the agreement; null when the customer does not exist. */
  set(customerId: string, on: boolean, by: string, at: Date): Promise<WaConsent | null>;
}

const consentOf = (x: Record<string, unknown>): WaConsent => ({ on: x.wa_consent_at !== null && x.wa_consent_at !== undefined, at: x.wa_consent_at ? (x.wa_consent_at as Date).toISOString() : null, hasMobile: /[0-9]{8}/.test(String(x.mobile ?? "").replace(/[^0-9]/g, "")) });

export function pgWaConsentRepo(db: Query): WaConsentRepo {
  return {
    async get(customerId) {
      if (!UUID.test(customerId)) return null;
      const r = await db.query("SELECT wa_consent_at, mobile FROM customers WHERE id = $1", [customerId]);
      return r.rows[0] ? consentOf(r.rows[0]) : null;
    },
    async set(customerId, on, by, at) {
      if (!UUID.test(customerId)) return null;
      const r = await db.query("UPDATE customers SET wa_consent_at = $2, wa_consent_by = $3 WHERE id = $1 RETURNING wa_consent_at, mobile", [customerId, on ? at.toISOString() : null, on ? by : null]);
      return r.rows[0] ? consentOf(r.rows[0]) : null;
    },
  };
}

/** The in-memory double (tests and the local demo server). */
export function memoryWaConsentRepo(customers: Record<string, { mobile: string | null }> = {}): WaConsentRepo & { state: Map<string, { at: Date | null; by: string | null }> } {
  const state = new Map<string, { at: Date | null; by: string | null }>();
  const read = (id: string): WaConsent | null => {
    const c = customers[id];
    if (!c) return null;
    const at = state.get(id)?.at ?? null;
    return { on: at !== null, at: at ? at.toISOString() : null, hasMobile: /[0-9]{8}/.test((c.mobile ?? "").replace(/[^0-9]/g, "")) };
  };
  return {
    state,
    async get(id) {
      return read(id);
    },
    async set(id, on, by, at) {
      if (!customers[id]) return null;
      state.set(id, on ? { at, by } : { at: null, by: null });
      return read(id);
    },
  };
}
