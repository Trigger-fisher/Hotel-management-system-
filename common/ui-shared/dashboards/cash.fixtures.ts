// Hotel Pallav's own scratch demo rows (docs/sessions/S08-fixtures) turned into the cash mock's store, so Revenue, Expenses and Shift Handover can be
// compared with Pallav on the same data. Only used when the dev preview asks for it (`?data=s08`). The dates stay exactly as Pallav stores them (Pallav
// groups by the real day too), so both sides agree whenever they are viewed on the same day; `shiftDays` moves every date if they are not.
import {
  addDays, expenseTypeOf, istIso, shifts,
  type CashBook, type CashDeposit, type CashExpense, type CashLookups, type CashPerson, type DenominationCounts, type ExpenseCategory, type ShiftHandover, type StaffMember,
} from './cash';

type Row = Record<string, unknown>;

export interface CashFixtures {
  /** Move every date by this many days (default 0). */
  shiftDays?: number;
  users: Row[];
  employees: Row[];
  depositsHotel: Row[];
  depositsFood: Row[];
  withdrawalsHotel: Row[];
  withdrawalsFood: Row[];
  miscHotel: Row[];
  miscFood: Row[];
  staffAdvances: Row[];
  categories: Row[];
  handovers: Row[];
}

/** What `createCashApi` starts from instead of its own made-up rows. */
export interface CashSeed {
  deposits: CashDeposit[];
  expenses: CashExpense[];
  handovers: ShiftHandover[];
  lookups: CashLookups;
  seq: number;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => Number(v ?? 0) || 0;
const paise = (v: unknown): number => Math.round(num(v) * 100);

export function cashSeedFromFixtures(f: CashFixtures): CashSeed {
  const days = f.shiftDays ?? 0;
  /** "2026-10-05 00:00:00" + "11:00:00" -> ISO instant, shifted to today's calendar. */
  const at = (date: unknown, time: unknown): string => {
    const [hh = 0, mm = 0, ss = 0] = str(time).split(':').map(Number);
    return istIso(addDays(str(date).slice(0, 10), days), hh, mm, ss);
  };
  const created = (stamp: unknown): string => {
    const d = str(stamp);
    return at(d.slice(0, 10), d.slice(11, 19) || '00:00:00');
  };
  const person = (r: Row): CashPerson => ({ id: `u-${num(r.user_id)}`, name: str(r.full_name) || str(f.users.find((u) => u.id === r.user_id)?.name) });

  const deposits: CashDeposit[] = [];
  const addDeposits = (rows: Row[], book: CashBook) => {
    for (const r of rows) {
      deposits.push({
        id: `dep-${book[0]}${num(r.id)}`, version: 1, entryNo: num(r.entry_no), book, at: at(r.date, r.time), depositor: str(r.depositor), amountPaise: paise(r.amount),
        instruction: str(r.reason) || str(r.revenue_source) || null, recordedBy: person(r), createdAt: created(r.created_at), updatedAt: created(r.updated_at), isLatest: false,
      });
    }
  };
  addDeposits(f.depositsHotel, 'hotel');
  addDeposits(f.depositsFood, 'food');

  const staff: StaffMember[] = f.employees.map((e) => ({
    id: `emp-${num(e.id)}`, name: str(e.name), code: str(e.employee_code), book: num(e.payroll_company_id) === 2 ? 'food' : 'hotel',
  }));

  const expenses: CashExpense[] = [];
  const base = (r: Row, kind: 'withdrawal' | 'misc' | 'advance', book: CashBook, key: string) => ({
    id: `exp-${key}${num(r.id)}`, entryNo: num(r.entry_no), type: expenseTypeOf(kind, book), kind, book, at: at(r.date, r.time), recordedBy: person(r),
    createdAt: created(r.created_at), updatedAt: created(r.updated_at), isLatest: false, employee: null, withdrawer: null, yearMonth: null, lines: [],
  });
  const addWithdrawals = (rows: Row[], book: CashBook) => {
    for (const r of rows) expenses.push({ ...base(r, 'withdrawal', book, `w${book[0]}`), withdrawer: str(r.withdrawer), amountPaise: paise(r.amount), instruction: str(r.instruction) || null });
  };
  addWithdrawals(f.withdrawalsHotel, 'hotel');
  addWithdrawals(f.withdrawalsFood, 'food');
  const addMisc = (rows: Row[], book: CashBook) => {
    for (const r of rows) expenses.push({ ...base(r, 'misc', book, `m${book[0]}`), expenseName: str(r.expense_name), amountPaise: paise(r.amount), instruction: str(r.instruction) || null });
  };
  addMisc(f.miscHotel, 'hotel');
  addMisc(f.miscFood, 'food');
  for (const r of f.staffAdvances) {
    const who = staff.find((s) => s.id === `emp-${num(r.employee_id)}`) ?? null;
    const book: CashBook = r.business === 'food' ? 'food' : 'hotel';
    expenses.push({ ...base(r, 'advance', book, 'a'), employee: who, yearMonth: str(r.year_month), amountPaise: paise(r.amount), instruction: str(r.instruction) || null });
  }

  const list = (v: unknown): string[] => {
    try {
      const x: unknown = JSON.parse(str(v) || '[]');
      return Array.isArray(x) ? x.map(String) : [];
    } catch {
      return [];
    }
  };
  const handovers: ShiftHandover[] = f.handovers.map((r) => {
    const counts: DenominationCounts = {
      d500: num(r.d500_count), d200: num(r.d200_count), d100: num(r.d100_count), d50: num(r.d50_count),
      d20: num(r.d20_count), d10: num(r.d10_count), d5: num(r.d5_count), coins: num(r.coins_count),
    };
    return {
      id: `ho-${num(r.id)}`, entryNo: num(r.entry_no), at: at(r.date, r.time), shift: (shifts.includes(str(r.shift) as never) ? str(r.shift) : 'Morning') as ShiftHandover['shift'],
      handedBy: person(r), handedTo: r.handover_to_name ? { id: `emp-${num(r.employee_id)}`, name: str(r.handover_to_name) } : null, counts, totalPaise: paise(r.total),
      notes: list(r.notes), instructions: list(r.instructions), createdAt: created(r.created_at), updatedAt: created(r.updated_at), isLatest: false,
    };
  });

  const distinct = (rows: CashDeposit[] | CashExpense[], pick: (x: never) => string | null): string[] => [...new Set((rows as never[]).map(pick).filter((x): x is string => !!x))];
  const catalogue: ExpenseCategory[] = f.categories.map((c) => ({ id: `cat-${num(c.id)}`, book: c.business === 'food' ? 'food' : 'hotel', name: str(c.name), items: [] }));
  const lookups: CashLookups = {
    depositors: {
      hotel: distinct(deposits.filter((d) => d.book === 'hotel'), (d: CashDeposit) => d.depositor),
      food: distinct(deposits.filter((d) => d.book === 'food'), (d: CashDeposit) => d.depositor),
    },
    receivers: {
      hotel: distinct(expenses.filter((e) => e.kind === 'withdrawal' && e.book === 'hotel'), (e: CashExpense) => e.withdrawer),
      food: distinct(expenses.filter((e) => e.kind === 'withdrawal' && e.book === 'food'), (e: CashExpense) => e.withdrawer),
    },
    staff,
    catalogue,
    shifts,
  };

  return { deposits, expenses, handovers, lookups, seq: 1000 };
}
