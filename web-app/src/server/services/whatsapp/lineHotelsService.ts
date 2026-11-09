import "server-only";
import { isPortalAccount } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import { CODE, codeFromSlug, type LineHotelsStore } from "../../whatsapp/lineHotels";
import { auditRow, createGate, type AuditInput, type Gate, type PlatformMeta } from "../platform/access";

// Hotels on the shared number (MJ, 4 Nov 2026): Super Admin and Platform Admin attach hotels to the shared guest number, give each its code, and detach it. Only the SHARED number takes hotels this way (a
// hotel's own number is attached when it is connected; the platform number has none). A code is what a guest types, or a wa.me link carries, to choose the hotel: it is unique among the hotels on a number.
// Every change is audited (who, which hotel, the code); an API key, an Enter-hotel visit and a portal account are refused first.
export interface LineHotelView {
  hotelId: string;
  hotelName: string;
  hotelCode: string | null;
  since: string;
  /** What a guest taps to start a chat with this hotel on the shared number (needs the number's phone). */
  chatText: string | null;
}

export interface LineHotelsView {
  attached: LineHotelView[];
  available: { hotelId: string; hotelName: string }[];
}

type Step = "hotel_attached" | "hotel_detached" | "hotel_code_changed";

export function createLineHotelsService(deps: { unit: PlatformConsoleUnit; store: LineHotelsStore; now: () => Date; gate?: Gate }) {
  const { unit, store, now } = deps;
  const gate = deps.gate ?? createGate(unit, now);
  const probe = (step: Step, id: string | null): AuditInput => ({ action: "settings_updated", entity: "platform", entityId: id, reason: `whatsapp:${step}` });

  function readGate(session: VerifiedSession): void {
    if (session.token !== undefined || session.visit !== undefined || isPortalAccount(session)) throw new AppError("FORBIDDEN");
    gate.superRead(session);
  }
  async function writeGate(session: VerifiedSession, meta: PlatformMeta, step: Step, id: string) {
    if (session.token !== undefined || session.visit !== undefined || isPortalAccount(session)) throw await gate.refuse(session, meta, probe(step, id), new AppError("FORBIDDEN"));
    await gate.superWrite(session, meta, probe(step, id));
  }
  async function audit(session: VerifiedSession, meta: PlatformMeta, step: Step, lineId: string, label: string, after: Record<string, unknown>): Promise<void> {
    await unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      await repos.audit.write(auditRow({ userId: actor.userId, name: actor.name, role: actor.role }, meta, { ...probe(step, lineId), targetLabel: label, reason: `whatsapp:${step}: ok`, after: { lineId, ...after } }, "success", now()));
    });
  }

  /** Only the shared number takes hotels this way. */
  async function sharedLine(lineId: string): Promise<void> {
    const kind = await store.lineKind(lineId);
    if (kind === null) throw new AppError("NOT_FOUND");
    if (kind !== "shared") throw new AppError("CONFLICT", "Hotels are attached to the shared guest number only. A hotel's own number is attached when it is connected.");
  }
  const cleanCode = (code: string): string => {
    const c = code.trim().toLowerCase();
    if (!CODE.test(c)) throw new AppError("VALIDATION_FAILED", undefined, { fields: { hotelCode: "A code is 3 to 24 letters and digits, with no spaces." } });
    return c;
  };
  const taken = (): never => {
    throw new AppError("CONFLICT", "That code is already used by another hotel on this number. Choose a different one.");
  };

  return {
    async list(session: VerifiedSession, lineId: string): Promise<LineHotelsView> {
      readGate(session);
      await unit.run((repos) => gate.actor(repos, session));
      await sharedLine(lineId);
      const attached = (await store.list(lineId)).map((h): LineHotelView => ({ hotelId: h.hotelId, hotelName: h.hotelName, hotelCode: h.hotelCode, since: h.since.toISOString(), chatText: h.hotelCode ? `${h.hotelCode}: ` : null }));
      return { attached, available: await store.available(lineId) };
    },

    /** Attach a hotel. Without a code, one is made from the hotel's slug (with a number added when taken). */
    async attach(session: VerifiedSession, lineId: string, input: { hotelId: string; hotelCode?: string | null }, meta: PlatformMeta): Promise<LineHotelView> {
      await writeGate(session, meta, "hotel_attached", lineId);
      await sharedLine(lineId);
      const info = await store.hotelInfo(input.hotelId);
      if (!info) throw new AppError("VALIDATION_FAILED", undefined, { fields: { hotelId: "That hotel was not found." } });
      const wanted = input.hotelCode ? cleanCode(input.hotelCode) : null;
      const candidates = wanted ? [wanted] : [codeFromSlug(info.slug), ...[2, 3, 4, 5, 6].map((n) => `${codeFromSlug(info.slug).slice(0, 22)}${n}`)];
      let code: string | null = null;
      for (const c of candidates) {
        const r = await store.attach(lineId, input.hotelId, c, now());
        if (r === "ok") {
          code = c;
          break;
        }
        if (r === "already") throw new AppError("CONFLICT", "That hotel is already on this number.");
        if (r === "no_hotel") throw new AppError("VALIDATION_FAILED", undefined, { fields: { hotelId: "That hotel was not found." } });
        if (wanted) return taken();
      }
      if (code === null) return taken();
      await audit(session, meta, "hotel_attached", lineId, info.name, { hotelId: input.hotelId, code });
      const row = (await store.list(lineId)).find((h) => h.hotelId === input.hotelId);
      return { hotelId: input.hotelId, hotelName: info.name, hotelCode: code, since: (row?.since ?? now()).toISOString(), chatText: `${code}: ` };
    },

    async detach(session: VerifiedSession, lineId: string, hotelId: string, meta: PlatformMeta): Promise<{ detached: true }> {
      await writeGate(session, meta, "hotel_detached", lineId);
      await sharedLine(lineId);
      const info = await store.hotelInfo(hotelId);
      if (!(await store.detach(lineId, hotelId, now()))) throw new AppError("NOT_FOUND");
      await audit(session, meta, "hotel_detached", lineId, info?.name ?? "Hotel", { hotelId });
      return { detached: true };
    },

    async setCode(session: VerifiedSession, lineId: string, hotelId: string, hotelCode: string | null, meta: PlatformMeta): Promise<{ hotelCode: string | null }> {
      await writeGate(session, meta, "hotel_code_changed", lineId);
      await sharedLine(lineId);
      const code = hotelCode === null || hotelCode.trim() === "" ? null : cleanCode(hotelCode);
      const r = await store.setCode(lineId, hotelId, code);
      if (r === "not_attached") throw new AppError("NOT_FOUND");
      if (r === "code_taken") return taken();
      await audit(session, meta, "hotel_code_changed", lineId, (await store.hotelInfo(hotelId))?.name ?? "Hotel", { hotelId, code });
      return { hotelCode: code };
    },
  };
}

export type LineHotelsService = ReturnType<typeof createLineHotelsService>;
