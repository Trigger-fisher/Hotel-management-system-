import "server-only";
import type { CashDeposit } from "@shared/dashboards/cash";
import { paiseToNumber } from "../../money/paise";
import type { CashDepositRecord } from "../../repos/cashDeposit";
import { istInstant } from "./ist";
import { displayName, type Person } from "./ports";

/**
 * The deposit as the apps receive it (ui-shared CashDeposit): money in integer paise, dates as ISO UTC, the recorder's name, and the
 * fields only the server can work out (isLatest, version). Nothing from the table that the contract does not name leaves the server.
 */
export function toDepositDto(record: CashDepositRecord, ctx: { newestId: string | null; people: ReadonlyMap<string, Person> }): CashDeposit {
  const person = ctx.people.get(record.userId);
  return {
    id: record.id,
    version: record.version,
    entryNo: record.entryNo,
    at: istInstant(record.date, record.time).toISOString(),
    recordedBy: { id: record.userId, name: person ? displayName(person) : (record.fullName ?? "") },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    isLatest: record.id === ctx.newestId,
    book: record.book,
    depositor: record.depositor,
    amountPaise: paiseToNumber(record.amountPaise),
    instruction: record.reason,
  };
}
