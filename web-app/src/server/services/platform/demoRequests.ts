import "server-only";
import { DEMO_REQUEST_STATUSES, demoRequestLimits as L, type DemoRequest, type DemoRequestInput, type DemoRequestPage, type DemoRequestStatus } from "@shared/dashboards/demoRequests";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import { createGate, type PlatformMeta } from "./access";

// Demo requests (platform 0169): the product website's form (/contact) saves one here; the Super Admin reads the list and marks each one contacted or closed (audited).
// The form is public: its input is checked again here, and a filled honeypot is answered as success and dropped.

export interface DemoRequestRow extends Omit<DemoRequest, "handledAt" | "createdAt"> {
  handledAt: Date | null;
  createdAt: Date;
}

export interface DemoRequestPorts {
  add(row: { name: string; email: string; phone: string | null; hotelName: string; city: string | null; rooms: number | null; properties: number | null; message: string | null }): Promise<void>;
  list(filter: { status: DemoRequestStatus | null; page: number; pageSize: number }): Promise<{ items: DemoRequestRow[]; total: number; counts: Record<DemoRequestStatus, number> }>;
  get(id: string): Promise<DemoRequestRow | null>;
  setStatus(id: string, status: DemoRequestStatus, by: { userId: string; name: string }, at: Date): Promise<DemoRequestRow | null>;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^[0-9+() -]{6,20}$/;

/** The visitor's input checked and trimmed; a field in error is named for the form. */
export function cleanDemoRequest(input: DemoRequestInput) {
  const fields: Record<string, string> = {};
  const text = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
  const name = text(input.name);
  if (name === "") fields.name = "Enter your name.";
  else if (name.length > L.name) fields.name = `Keep your name under ${L.name} characters.`;
  const email = text(input.email).toLowerCase();
  if (!EMAIL.test(email) || email.length > L.email) fields.email = "Enter a valid email address.";
  const phone = text(input.phone);
  if (phone !== "" && !PHONE.test(phone)) fields.phone = "Enter a valid phone number.";
  const hotelName = text(input.hotelName);
  if (hotelName === "") fields.hotelName = "Enter your hotel’s name.";
  else if (hotelName.length > L.hotelName) fields.hotelName = `Keep the name under ${L.hotelName} characters.`;
  const city = text(input.city);
  if (city.length > L.city) fields.city = `Keep the city under ${L.city} characters.`;
  const whole = (v: number | null | undefined, max: number, field: string, what: string) => {
    if (v === null || v === undefined) return null;
    if (!Number.isInteger(v) || v < 1 || v > max) fields[field] = `Enter ${what} between 1 and ${max}.`;
    return v;
  };
  const rooms = whole(input.rooms, L.rooms, "rooms", "the number of rooms");
  const properties = whole(input.properties, L.properties, "properties", "the number of properties");
  const message = (input.message ?? "").trim();
  if (message.length > L.message) fields.message = `Keep the message under ${L.message} characters.`;
  if (Object.keys(fields).length) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
  return { name, email, phone: phone || null, hotelName, city: city || null, rooms, properties, message: message || null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const view = (r: DemoRequestRow): DemoRequest => ({ ...r, handledAt: iso(r.handledAt), createdAt: r.createdAt.toISOString() });

export function createDemoRequestService(deps: { unit: PlatformConsoleUnit; now: () => Date; ports: DemoRequestPorts }) {
  const { unit, now, ports } = deps;
  const gate = createGate(unit, now);

  return {
    /** The website's form. A bot that filled the hidden field gets the same answer and nothing is saved. */
    async submit(input: DemoRequestInput): Promise<{ received: true }> {
      if ((input.website ?? "").trim() !== "") return { received: true };
      await ports.add(cleanDemoRequest(input));
      return { received: true };
    },

    async list(session: VerifiedSession, q: { status?: DemoRequestStatus | "all"; page?: number; pageSize?: number }): Promise<DemoRequestPage> {
      gate.superRead(session);
      const status = q.status && q.status !== "all" && DEMO_REQUEST_STATUSES.includes(q.status) ? q.status : null;
      const page = Math.max(1, Math.trunc(q.page ?? 1));
      const pageSize = Math.min(100, Math.max(5, Math.trunc(q.pageSize ?? 25)));
      const r = await ports.list({ status, page, pageSize });
      return { items: r.items.map(view), total: r.total, page, pageSize, counts: r.counts };
    },

    async setStatus(session: VerifiedSession, id: string, status: DemoRequestStatus, meta: PlatformMeta): Promise<DemoRequest> {
      await gate.superWrite(session, meta, { action: "demo_request_updated", entity: "platform", entityId: id });
      return unit.run(async (repos) => {
        const actor = await gate.actor(repos, session);
        if (!actor.isSuper) throw new AppError("FORBIDDEN");
        const before = await ports.get(id);
        if (!before) throw new AppError("NOT_FOUND");
        if (before.status === status) return view(before);
        const after = await ports.setStatus(id, status, { userId: actor.userId, name: actor.name }, now());
        if (!after) throw new AppError("NOT_FOUND");
        await gate.audit(repos, actor, meta, { action: "demo_request_updated", entity: "platform", entityId: id, targetLabel: before.hotelName, reason: status, before: { status: before.status }, after: { status } });
        return view(after);
      });
    },
  };
}

export type DemoRequestService = ReturnType<typeof createDemoRequestService>;
