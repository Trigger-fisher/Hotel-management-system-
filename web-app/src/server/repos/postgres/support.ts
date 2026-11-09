import "server-only";
// The small tables most modules read or write beside their own: accounting years, the system log and the force log. One implementation, bound to
// the unit's transaction, shared by the cash, billing and later repositories.
import type { TxClient } from "../../../db/types";
import type { AccountingYearRepo, ForceLogRepo, SystemLogRepo } from "../cashSupport";

export function pgCashSupport(tx: TxClient): { accountingYears: AccountingYearRepo; systemLogs: SystemLogRepo; forceLogs: ForceLogRepo } {
  return {
    accountingYears: {
      async list() {
        const r = await tx.query("SELECT id, label, starts_on, ends_on FROM accounting_years ORDER BY starts_on, id");
        return r.rows.map((y) => ({ id: String(y.id), label: String(y.label), startsOn: String(y.starts_on), endsOn: String(y.ends_on) }));
      },
    },
    systemLogs: {
      async write(e) {
        await tx.query(
          "INSERT INTO system_logs (module, user_id, user_name, action, entity, subject_id, subject_label, summary, details, ip_address, trace_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)",
          [e.module, e.userId, e.userName, e.action, e.entity, e.subjectId, e.subjectLabel, e.summary, e.details === null ? null : JSON.stringify(e.details), e.ipAddress, e.traceId],
        );
      },
    },
    forceLogs: {
      async write(e) {
        await tx.query("INSERT INTO force_logs (user_id, user_name, action, module, summary, details, route, method, ip_address) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)", [
          e.userId, e.userName, e.action, e.module, e.summary, e.details === null ? null : JSON.stringify(e.details), e.route, e.method, e.ipAddress,
        ]);
      },
    },
  };
}
