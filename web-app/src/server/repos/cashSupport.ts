import "server-only";

// The small repositories the cash services need beside the deposit books, all inside the hotel's own schema (one unit).

/** Master Data lists (option_sets / option_items): the ACTIVE values of a list, in their order (Pallav Support/Masters.php values()). */
export interface MasterListRepo {
  activeValues(setKey: string): Promise<string[]>;
}

export interface AccountingYear {
  id: string;
  label: string;
  /** YYYY-MM-DD */
  startsOn: string;
  endsOn: string;
}

/** The accounting years, oldest first (Pallav Support/Books.php years()). The newest is the current one. */
export interface AccountingYearRepo {
  list(): Promise<AccountingYear[]>;
}

/** One row of system_logs (Pallav Support/SystemLogger.php). `details` is plain JSON; money in it is in paise. */
export interface SystemLogEntry {
  module: string;
  action: "created" | "updated" | "deleted";
  entity: string;
  subjectId: string | null;
  subjectLabel: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  userId: string | null;
  userName: string;
  ipAddress: string | null;
  traceId: string | null;
}

export interface SystemLogRepo {
  write(entry: SystemLogEntry): Promise<void>;
}

/** One row of force_logs (Pallav Support/ForceMode.php audit()). */
export interface ForceLogEntry {
  userId: string;
  userName: string;
  action: "lock" | "bypass";
  module: string;
  summary: string;
  details: Record<string, unknown> | null;
  route: string | null;
  method: string | null;
  ipAddress: string | null;
}

export interface ForceLogRepo {
  write(entry: ForceLogEntry): Promise<void>;
}
