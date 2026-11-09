import "server-only";
import type { Paise } from "../money/paise";
import type { AccountingYearRepo, ForceLogRepo, MasterListRepo, SystemLogRepo } from "./cashSupport";
import type { VersionedResult } from "./types";

// Shift Handover (Pallav ShiftHandoverController + Models/ShiftHandover.php), table shift_handovers (hotel 0003). One running entry number for the
// whole hotel (not per book), the shift clock date and time, who handed over (the recorder) and to whom (an active employee, kept BY NAME so the
// record still reads right after they leave), the notes counted per denomination with their totals in paise, notes and instructions as JSON lists,
// soft delete (recycle bin) and a version. Plain records, no SQL. The in-memory double is repos/memory/handovers.ts; PostgreSQL repos/postgres/handovers.ts.

export const DENOMINATIONS = ["d500", "d200", "d100", "d50", "d20", "d10", "d5", "coins"] as const;
export type DenominationKey = (typeof DENOMINATIONS)[number];
/** Rupees per piece (ShiftHandover::DENOMINATIONS); coins are counted by their rupee value. */
export const DENOMINATION_RUPEES: Readonly<Record<DenominationKey, number>> = { d500: 500, d200: 200, d100: 100, d50: 50, d20: 20, d10: 10, d5: 5, coins: 1 };

export interface HandoverRecord {
  id: string;
  entryNo: number;
  /** YYYY-MM-DD and HH:MM:SS as written on the handover (the shift clock in IST). */
  date: string;
  time: string;
  userId: string;
  fullName: string | null;
  shift: string;
  /** Pieces counted per denomination (the *_count columns, stored as text by Pallav; integers here). */
  counts: Record<DenominationKey, number>;
  totalPaise: Paise;
  totalInWords: string | null;
  notes: string[];
  instructions: string[];
  /** Who took over: the employee picked (may be gone later) and the name kept on the record. */
  employeeId: string | null;
  handoverToName: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface NewHandover {
  date: string;
  time: string;
  userId: string;
  fullName: string | null;
  shift: string;
  counts: Record<DenominationKey, number>;
  totalPaise: Paise;
  totalInWords: string;
  notes: string[];
  instructions: string[];
  employeeId: string;
  handoverToName: string;
  createdBy: string;
}

/** An edit never changes who recorded it (Pallav ShiftHandoverController::update keeps user_id); date/time absent = keep. */
export type HandoverPatch = Partial<Pick<NewHandover, "date" | "time" | "shift" | "counts" | "totalPaise" | "totalInWords" | "notes" | "instructions" | "employeeId" | "handoverToName">>;

export interface HandoverRepo {
  /** Every row in the date window (live, or the recycle bin), unsorted: the service searches, sorts and pages them like Pallav. */
  rows(filter: { deleted?: "no" | "only"; from?: string; to?: string }): Promise<HandoverRecord[]>;
  /** The newest live handover of all: date, time, id descending (ShiftHandover::newestId, scopeLatestFirst). */
  newestId(): Promise<string | null>;
  /** A live row; recycle-bin rows only with `deleted: true`. Another hotel's id is simply not found. */
  get(id: string, options?: { deleted?: boolean }): Promise<HandoverRecord | null>;
  /** Takes the next entry number inside the same unit (max + 1 over every row, soft-deleted included) and inserts. */
  create(input: NewHandover): Promise<HandoverRecord>;
  update(id: string, expectedVersion: number, patch: HandoverPatch, actorId: string): Promise<VersionedResult<HandoverRecord>>;
  softDelete(id: string, expectedVersion: number, actorId: string): Promise<VersionedResult<HandoverRecord>>;
  restore(id: string, expectedVersion: number, actorId: string): Promise<VersionedResult<HandoverRecord>>;
  /** Removes a recycle-bin row for good (the table is marked -- hard-delete). Live rows are never purged. */
  purge(id: string): Promise<boolean>;
  /** Count and sum of live handovers dated in [from, to]. */
  totals(from: string, to: string): Promise<{ count: number; totalPaise: Paise }>;
}

/** Who a shift can be handed to: every ACTIVE employee of every payroll company (Pallav: not scoped to one company). */
export interface HandoverStaffMember {
  id: string;
  name: string;
  code: string;
  /** The payroll company's code: HP01 = the hotel, PF01 = food. */
  companyCode: string;
  email: string | null;
  mobile: string | null;
}

interface HandoverStaffRepo {
  /** Active, live employees of every company, by name. */
  active(): Promise<HandoverStaffMember[]>;
}

export interface HandoverRepos {
  handovers: HandoverRepo;
  handoverStaff: HandoverStaffRepo;
  masterLists: MasterListRepo;
  accountingYears: AccountingYearRepo;
  systemLogs: SystemLogRepo;
  forceLogs: ForceLogRepo;
  /** The hotel's name for the printed handover (Settings general.site_name, else the hotel payroll company's name). */
  hotelName(): Promise<string>;
}
