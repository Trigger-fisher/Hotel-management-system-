import "server-only";
import { AppError } from "../../errors";
import { DATE_SHAPE, TIME_SHAPE, type Stamp } from "./stamp";

// Validation of a cash entry, with Pallav's messages word for word (RevenueController::rules/messages, ExpenseController::rules/messages and Laravel
// 11's default wording). The pieces every kind shares (the amount, the instruction, the hand-picked date and time) are functions here; each kind
// assembles its own. The field names are the ones the apps use: depositor, withdrawer, amount, instruction, date, time, lines.N.*.
export const MAX_AMOUNT_PAISE = 999_999_999_999;
const MIN_AMOUNT_PAISE = 1;

export type Fields = Record<string, string>;

const chars = (s: string): number => Array.from(s).length;

interface StampContext {
  /** Only a person with the ability system.backdate may choose the date and time; for everyone else the stamp is ignored, as in Pallav. */
  canBackdate: boolean;
  /** Today in IST, YYYY-MM-DD. */
  today: string;
}

/** `amount`: required, numeric, min 0.01, max 9999999999.99 (paise: 1 to 999,999,999,999). */
function amountProblem(amountPaise: number | null): string | null {
  if (amountPaise === null) return "The amount field is required.";
  if (!Number.isInteger(amountPaise)) return "The amount field must be a number.";
  if (amountPaise < MIN_AMOUNT_PAISE) return "The amount field must be at least 0.01.";
  if (amountPaise > MAX_AMOUNT_PAISE) return "The amount field must not be greater than 9999999999.99.";
  return null;
}

/** `instruction`: nullable, string, max N. Returns the trimmed text (null when empty) and any problem. */
export function instructionOf(text: string, max: number, fields: Fields): string | null {
  const trimmed = text.trim();
  if (chars(trimmed) > max) fields.instruction = `The instruction field must not be greater than ${max} characters.`;
  return trimmed === "" ? null : trimmed;
}

/** The date and time chosen by hand: `required, date, before_or_equal:today` and a time of day. Null when the person may not choose it. */
export function stampOf(stamp: { date: string; time: string } | null, ctx: StampContext, fields: Fields): Stamp | null {
  if (stamp === null || !ctx.canBackdate) return null;
  if (!DATE_SHAPE.test(stamp.date) || Number.isNaN(Date.parse(`${stamp.date}T00:00:00Z`))) fields.date = "The date field must be a valid date.";
  else if (stamp.date > ctx.today) fields.date = "The date field must be a date before or equal to today.";
  if (!TIME_SHAPE.test(stamp.time.trim())) fields.time = "The time field must match the format HH:MM.";
  return fields.date || fields.time ? null : { date: stamp.date, time: stamp.time.trim() };
}

/** A name that has to be on the book's Master Data list (an edit may also keep the name it already has). */
function listedName(args: { field: "depositor" | "withdrawer"; value: string; required: string; allowed: readonly string[]; keepName?: string; notListed: string }, fields: Fields): string {
  const value = args.value.trim();
  if (value === "") fields[args.field] = args.required;
  else if (chars(value) > 100) fields[args.field] = `The ${args.field} field must not be greater than 100 characters.`;
  else if (![...args.allowed, ...(args.keepName ? [args.keepName] : [])].includes(value)) fields[args.field] = args.notListed;
  return value;
}

export function failIfAny(fields: Fields): void {
  if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields });
}

// ---- a deposit (revenue) ----
interface DepositFields {
  depositor: string;
  amountPaise: number | null;
  instruction: string;
  stamp: { date: string; time: string } | null;
}

interface DepositContext extends StampContext {
  /** How the book is named in the message: Hotel or Food. */
  bookName: string;
  /** The ACTIVE values of the book's depositor list. */
  allowedDepositors: readonly string[];
  keepName?: string;
}

interface CleanDeposit {
  depositor: string;
  amountPaise: number;
  reason: string | null;
  stamp: Stamp | null;
}

export function validateDeposit(input: DepositFields, ctx: DepositContext): CleanDeposit {
  const fields: Fields = {};
  const depositor = listedName(
    { field: "depositor", value: input.depositor, required: "Choose who is depositing.", allowed: ctx.allowedDepositors, keepName: ctx.keepName, notListed: `Choose a depositor from the ${ctx.bookName} list. The SuperAdmin adds names in Master Data.` },
    fields,
  );
  const problem = amountProblem(input.amountPaise);
  if (problem) fields.amount = problem;
  const reason = instructionOf(input.instruction, 500, fields);
  const stamp = stampOf(input.stamp, ctx, fields);
  failIfAny(fields);
  return { depositor, amountPaise: input.amountPaise as number, reason, stamp };
}

// ---- a cash withdrawal (expense) ----
interface WithdrawalFields {
  withdrawer: string;
  amountPaise: number | null;
  instruction: string;
  stamp: { date: string; time: string } | null;
}

interface WithdrawalContext extends StampContext {
  bookName: string;
  /** The ACTIVE names of the book's receiver list (Master Data set cash_person_hotel / cash_person_food). */
  allowedReceivers: readonly string[];
  keepName?: string;
}

interface CleanWithdrawal {
  withdrawer: string;
  amountPaise: number;
  instruction: string | null;
  stamp: Stamp | null;
}

/** ExpenseController::rules('withdrawal') and messages(): the receiver must be on the book's list; the instruction may be 1000 characters. */
export function validateWithdrawal(input: WithdrawalFields, ctx: WithdrawalContext): CleanWithdrawal {
  const fields: Fields = {};
  const withdrawer = listedName(
    {
      field: "withdrawer",
      value: input.withdrawer,
      required: "Choose who is taking the cash.",
      allowed: ctx.allowedReceivers,
      keepName: ctx.keepName,
      notListed: `Choose a name from the ${ctx.bookName} list. The SuperAdmin adds names in Master Data, under Expense.`,
    },
    fields,
  );
  const problem = amountProblem(input.amountPaise);
  if (problem) fields.amount = problem;
  const instruction = instructionOf(input.instruction, 1000, fields);
  const stamp = stampOf(input.stamp, ctx, fields);
  failIfAny(fields);
  return { withdrawer, amountPaise: input.amountPaise as number, instruction, stamp };
}
