import "server-only";
import type { VerifiedSession } from "../auth/session";

// A FULL Enter-hotel visit (platform 0135) writes inside the hotel: the hotel's own System Log then names the visitor as such ("Super Admin Sonal (visiting)"), so the hotel
// can always tell its own staff's changes from the platform's. Applied by the units (repos/postgres/unit.ts, repos/memory/store.ts) to the repositories of a visiting session.

const ROLE_LABEL: Record<string, string> = { super_admin: "Super Admin", platform_admin: "Platform Admin", group_hotel_admin: "Group Admin" };

export const visitorLabel = (role: string, name: string): string => `${ROLE_LABEL[role] ?? "Platform"} ${name} (visiting)`;

interface LogWriter {
  write(entry: { userName: string } & Record<string, unknown>): Promise<unknown>;
}

/** The same repositories, with the System Log's writer naming the visitor; unchanged for anything but a full visit, or repositories without a System Log. */
export function labelVisitor<R>(repos: R, visit: VerifiedSession["visit"]): R {
  if (!visit || visit.access !== "full" || repos === null || typeof repos !== "object") return repos;
  const logs = (repos as { systemLogs?: LogWriter }).systemLogs;
  if (!logs || typeof logs.write !== "function") return repos;
  const write: LogWriter["write"] = (entry) => logs.write({ ...entry, userName: entry.userName.endsWith("(visiting)") ? entry.userName : visitorLabel(visit.by, entry.userName) });
  return { ...repos, systemLogs: { ...logs, write } } as R;
}
