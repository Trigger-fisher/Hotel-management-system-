import "server-only";
import type { IstMoment } from "./ist";

// The date and time stamp of an entry. A port of Pallav's CashLedger::stamp (golden-tested against the real PHP) and the model rule
// of LocksEntryStamp: only a person with the ability system.backdate may choose it; for everyone else a new entry gets the moment of
// saving and an edit keeps what it had, whatever was sent.
export interface Stamp {
  date: string;
  time: string;
}

/** CashLedger::stamp: the form fields after the "chosen by hand" rule. `date`/`time` undefined means "leave as it was" (an edit). */
export function cashLedgerStamp(input: { date: string; time: string }, chosenByHand: boolean, editing: boolean, now: IstMoment): { date?: string; time?: string } {
  if (!chosenByHand) return editing ? {} : { date: now.date, time: now.time };
  return { date: input.date, time: /^\d{2}:\d{2}$/.test(input.time) ? `${input.time}:00` : input.time };
}

/** What the entry is finally stamped with: `null` on an edit means keep the saved date and time. */
export function finalStamp(args: { chosen: Stamp | null; canBackdate: boolean; editing: boolean; now: IstMoment }): Stamp | null {
  const byHand = args.chosen !== null && args.canBackdate;
  const fields = cashLedgerStamp(args.chosen ?? { date: args.now.date, time: args.now.time.slice(0, 5) }, byHand, args.editing, args.now);
  return fields.date !== undefined && fields.time !== undefined ? { date: fields.date, time: fields.time } : null;
}

export const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export const DATE_SHAPE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
