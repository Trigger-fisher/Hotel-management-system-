import "server-only";
// The store the WhatsApp connection manager stands on (plan part 28): a port here, an in-memory double in repos/memory/whatsappLines.ts for the tests, the PostgreSQL repository in
// repos/postgres/whatsappLines.ts. The sealed token and PIN travel as sealed text only; no read returns an opened value, and the "view" shapes of the service never carry them.
import type { WaLineKind, WaLineStatus } from "../../whatsapp/ports";

export type WaQuality = "green" | "yellow" | "red" | "unknown";

/** One row of platform.whatsapp_lines, with the sealed columns. Only the service sees this shape. */
export interface LineRecord {
  id: string;
  kind: WaLineKind;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string | null;
  displayName: string | null;
  status: WaLineStatus;
  quality: WaQuality;
  ownerLoginId: string | null;
  tokenSecret: string;
  pinSecret: string | null;
  managed: boolean;
  webhookSubscribed: boolean;
  subscribedFields: string[];
  lastEventAt: Date | null;
  registered: boolean;
  nameStatus: string | null;
  messagingTier: string | null;
  tokenCheckedAt: Date | null;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  tokenFailures: number;
  connectedBy: string | null;
  connectedByName: string | null;
  connectedAt: Date | null;
  createdAt: Date;
  /** Current whatsapp_line_hotels rows (valid_to is null). */
  hotelsAttached: number;
}

export interface NewLine {
  kind: WaLineKind;
  phoneNumberId: string;
  wabaId: string;
  tokenSecret: string;
  ownerLoginId: string | null;
  hotelId: string | null;
  connectedBy: string;
  at: Date;
}

export type CreateLineResult = { ok: true; line: LineRecord } | { ok: false; reason: "number_taken" | "platform_exists" | "hotel_has_own_line" };

/** The columns a step may change. Anything left out stays. */
export type LinePatch = Partial<
  Pick<LineRecord, "displayPhone" | "displayName" | "status" | "quality" | "tokenSecret" | "pinSecret" | "webhookSubscribed" | "subscribedFields" | "registered" | "nameStatus" | "messagingTier" | "tokenCheckedAt" | "lastVerifiedAt" | "lastErrorCode" | "lastErrorAt" | "tokenFailures">
>;

export interface LineAdminStore {
  /** Every line, oldest first, with who connected it and how many hotels are attached now. */
  list(): Promise<LineRecord[]>;
  get(id: string): Promise<LineRecord | null>;
  /** Refuses a number that is already attached (the unique phone number id), a second platform line and a hotel that already has its own line. */
  create(input: NewLine): Promise<CreateLineResult>;
  update(id: string, patch: LinePatch, at: Date): Promise<LineRecord | null>;
  /** The hotel exists (a person line's owner must be a login). */
  hotelExists(hotelId: string): Promise<boolean>;
  loginExists(loginId: string): Promise<boolean>;
}
