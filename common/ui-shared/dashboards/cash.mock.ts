// The in-memory mock of cash.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MockClock, ListQuery, DashResult, Page } from './common';
import type { CashSeed } from './cash.fixtures';
import { mockEmptyHotel, mockCall, ok, mockError } from './common';
import { formatDateTime, formatMonth, amountInWords, formatINR } from './format';
import { addDays, canDeleteCashEntry, canEditCashEntry, cashBookNames, emptyCounts, entryLabel, expenseKindNames, expenseTypeNames, expenseTypeOf, handoverTotalPaise, istDateOf, istIso, istToday, lineFigures, monthOptions, parseQuantity, shiftAt, shifts, validateDeposit, validateExpense, validateHandover, type CashActor, type CashBook, type CashBookFilter, type CashDeposit, type CashExpense, type CashList, type CashLookups, type CashPerson, type CashStats, type DepositInput, type DepositQuery, type ExpenseCategory, type ExpenseInput, type ExpenseKind, type ExpenseLine, type ExpenseQuery, type ExpenseType, type HandoverInput, type HandoverList, type HandoverOptions, type Shift, type ShiftHandover, type StaffMember, type StampInput } from './cash';

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */

const depositorsSeed: Record<CashBook, string[]> = {
  hotel: ['Ramesh Patel', 'Kiran Joshi', 'Neha Shah', 'Front desk night shift', 'Bhavesh Kumar Chandrakant Trivedi'],
  food: ['Vikram Rathod', 'Pooja Mehta', 'Restaurant cashier', 'Banquet counter'],
};

const receiversSeed: Record<CashBook, string[]> = {
  hotel: ['Ashok Desai (Manager)', 'Mihir Jungiwala (Owner)', 'Bank deposit (HDFC Rajkot)', 'Suresh Vaghela'],
  food: ['Hitesh Parmar (Chef)', 'Mihir Jungiwala (Owner)', 'Bank deposit (HDFC Rajkot)'],
};

/** A brand-new hotel's default depositor and receiver names (no people from the demo hotel). */
const newHotelDepositors: Record<CashBook, string[]> = {
  hotel: ['Front desk', 'Front desk night shift'],
  food: ['Restaurant cashier', 'Banquet counter'],
};
const newHotelReceivers: Record<CashBook, string[]> = {
  hotel: ['Manager', 'Owner', 'Bank deposit'],
  food: ['Chef', 'Owner', 'Bank deposit'],
};

const staffSeed: StaffMember[] = [
  { id: 'st-h1', name: 'Ramesh Patel', code: 'HS001', book: 'hotel' },
  { id: 'st-h2', name: 'Kiran Joshi', code: 'HS002', book: 'hotel' },
  { id: 'st-h3', name: 'Neha Shah', code: 'HS003', book: 'hotel' },
  { id: 'st-h4', name: 'Suresh Vaghela', code: 'HS004', book: 'hotel' },
  { id: 'st-h5', name: 'Anjali Solanki', code: 'HS005', book: 'hotel' },
  { id: 'st-h6', name: 'Mahendra Singh Jadeja', code: 'HS006', book: 'hotel' },
  { id: 'st-h7', name: 'Farhan Shaikh', code: 'HS007', book: 'hotel' },
  { id: 'st-f1', name: 'Vikram Rathod', code: 'FS001', book: 'food' },
  { id: 'st-f2', name: 'Pooja Mehta', code: 'FS002', book: 'food' },
  { id: 'st-f3', name: 'Hitesh Parmar', code: 'FS003', book: 'food' },
  { id: 'st-f4', name: 'Lakshmi Iyer', code: 'FS004', book: 'food' },
  { id: 'st-f5', name: 'Gopal Chauhan', code: 'FS005', book: 'food' },
];

const cat = (id: string, book: CashBook, name: string, items: [string, string, string, number][]): ExpenseCategory => ({
  id,
  book,
  name,
  items: items.map(([iid, iname, unit, rupees]) => ({ id: iid, name: iname, unit, pricePaise: rupees * 100 })),
});

const catalogueSeed: ExpenseCategory[] = [
  cat('c-h1', 'hotel', 'Housekeeping', [
    ['i-h1', 'Detergent powder 1 kg', 'pack', 180],
    ['i-h2', 'Phenyl 5 L', 'can', 350],
    ['i-h3', 'Garbage bags (30)', 'roll', 120],
    ['i-h4', 'Room freshener', 'piece', 95],
  ]),
  cat('c-h2', 'hotel', 'Maintenance', [
    ['i-h5', 'LED bulb 9 W', 'piece', 110],
    ['i-h6', 'Plumber visit', 'visit', 500],
    ['i-h7', 'Electrician visit', 'visit', 450],
  ]),
  cat('c-h3', 'hotel', 'Office', [
    ['i-h8', 'A4 paper ream', 'ream', 290],
    ['i-h9', 'Printer ink', 'bottle', 650],
    ['i-h10', 'Courier', 'parcel', 80],
  ]),
  cat('c-h4', 'hotel', 'Guest supplies', [
    ['i-h11', 'Drinking water 1 L (case of 12)', 'case', 240],
    ['i-h12', 'Toiletry kit', 'kit', 45],
  ]),
  cat('c-f1', 'food', 'Vegetables', [
    ['i-f1', 'Onion', 'kg', 40],
    ['i-f2', 'Tomato', 'kg', 35],
    ['i-f3', 'Potato', 'kg', 30],
    ['i-f4', 'Coriander', 'bunch', 10],
  ]),
  cat('c-f2', 'food', 'Dairy', [
    ['i-f5', 'Milk 1 L', 'litre', 66],
    ['i-f6', 'Paneer', 'kg', 420],
    ['i-f7', 'Curd', 'kg', 80],
  ]),
  cat('c-f3', 'food', 'Gas and fuel', [['i-f8', 'LPG cylinder 19 kg (commercial)', 'cylinder', 1850]]),
  cat('c-f4', 'food', 'Groceries', [
    ['i-f9', 'Groundnut oil 15 L tin', 'tin', 2350],
    ['i-f10', 'Basmati rice 25 kg', 'bag', 1600],
    ['i-f11', 'Spices (mixed)', 'pack', 260],
  ]),
];

const recorders: CashPerson[] = [
  { id: 'u-h-01', name: 'Ramesh Patel' },
  { id: 'u-h-02', name: 'Kiran Joshi' },
  { id: 'u-h-03', name: 'Ashok Desai' },
  { id: 'u-h-04', name: 'Pooja Mehta' },
];

/** Small deterministic random, so the mock looks the same every run. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function pick<T>(r: () => number, list: readonly T[]): T {
  const v = list[Math.floor(r() * list.length)];
  if (v === undefined) throw new Error('pick from empty list');
  return v;
}

interface Store {
  deposits: (CashDeposit & { deletedAt?: string })[];
  expenses: (CashExpense & { deletedAt?: string })[];
  handovers: (ShiftHandover & { deletedAt?: string })[];
  seq: number;
}

function seed(nowMs: number): Store {
  // A brand-new hotel (mock): no deposits, expenses, withdrawals, staff advances or handovers; numbers start at #0001.
  if (mockEmptyHotel()) return { deposits: [], expenses: [], handovers: [], seq: 1000 };
  const r = rng(20261005);
  const today = istToday(nowMs);
  const nowIso = new Date(nowMs).toISOString();
  /** A moment `daysAgo` days back at hh:mm IST, never later than now. */
  const at = (daysAgo: number, hh: number, mm: number): string => {
    const iso = istIso(addDays(today, -daysAgo), hh, mm, Math.floor(r() * 60));
    return iso > nowIso ? new Date(nowMs - 30 * 60_000 * (1 + daysAgo)).toISOString() : iso;
  };

  // Revenue: 28 deposits over ~5 weeks, both books.
  const deposits: CashDeposit[] = [];
  const instr = [
    null,
    'Room 204 checkout, cash settled at front desk.',
    'Counter sales, evening.',
    null,
    'Banquet advance from Shah family wedding (balance due on 20 Oct).',
    'Walk-in guests, 3 rooms, paid in cash. Counted twice with Kiran at the desk before depositing in the safe.',
    null,
    'Parcel orders.',
    'Room 118 extra bed and laundry, paid on departure.',
    null,
    'Restaurant lunch covers, 41 guests.',
    'Tour group balance, 6 rooms, Mehta Travels.',
    null,
    'Breakfast buffet cash collections.',
    'Late checkout charge, room 302.',
    null,
    'Banquet hall booking token, Desai engagement.',
    'Room 207 advance for the weekend.',
    'Sweet counter and takeaway sales.',
    null,
    'Taxi desk commission settled.',
    'Corporate guest paid the difference in cash.',
  ];
  const depSeq: Record<CashBook, number> = { hotel: 0, food: 0 };
  for (let i = 0; i < 28; i++) {
    const book: CashBook = i % 3 === 2 ? 'food' : 'hotel';
    const daysAgo = Math.floor((27 - i) * 1.3);
    const when = at(daysAgo, 9 + Math.floor(r() * 13), Math.floor(r() * 60));
    const rupees = [850, 2500, 4200, 12500, 6800, 1500, 32000, 950, 18750][Math.floor(r() * 9)] ?? 1000;
    const paise = rupees * 100 + (i % 7 === 0 ? 50 : 0);
    const who = pick(r, recorders);
    depSeq[book] += 1;
    deposits.push({
      id: `dep-${i + 1}`,
      version: 1,
      entryNo: depSeq[book],
      book,
      at: when,
      depositor: i === 3 ? 'Old counter (no longer listed)' : pick(r, depositorsSeed[book]),
      amountPaise: paise,
      instruction: instr[(i * 5 + 3) % instr.length] ?? null,
      recordedBy: who,
      createdAt: when,
      updatedAt: when,
      isLatest: false,
    });
  }

  // Expenses: 26 entries across the 5 types.
  const expenses: CashExpense[] = [];
  const expSeq: Record<ExpenseType, number> = {
    'hotel-withdrawal': 0, 'food-withdrawal': 0, 'hotel-misc': 0, 'food-misc': 0, 'staff-advance': 0,
  };
  const months = monthOptions(nowMs, 2, 0);
  const lineOf = (id: string, catId: string, itemId: string, qty: number, custom?: number): ExpenseLine => {
    const c = catalogueSeed.find((x) => x.id === catId);
    const it = c?.items.find((x) => x.id === itemId);
    const price = custom !== undefined ? Math.round(custom / qty) : (it?.pricePaise ?? 0);
    return {
      id,
      categoryId: catId,
      categoryName: c?.name ?? 'Festival',
      itemId,
      itemName: it?.name ?? 'Diwali diyas',
      pricing: custom !== undefined ? 'custom' : 'listed',
      quantity: qty,
      pricePaise: c && it ? price : 1500,
      totalPaise: custom !== undefined ? custom : Math.round(qty * (c && it ? price : 1500)),
    };
  };
  const plan: { kind: ExpenseKind; book: CashBook }[] = [];
  for (let i = 0; i < 26; i++) {
    const kind: ExpenseKind = i % 5 === 4 ? 'advance' : i % 2 === 0 ? 'withdrawal' : 'misc';
    plan.push({ kind, book: i % 3 === 1 ? 'food' : 'hotel' });
  }
  plan.forEach((p, i) => {
    const type = expenseTypeOf(p.kind, p.book);
    expSeq[type] += 1;
    const daysAgo = Math.floor((25 - i) * 1.4);
    const when = at(daysAgo, 10 + Math.floor(r() * 11), Math.floor(r() * 60));
    const who = pick(r, recorders);
    let lines: ExpenseLine[] = [];
    let amount = 0;
    let withdrawer: string | null = null;
    let employee: StaffMember | null = null;
    let yearMonth: string | null = null;
    if (p.kind === 'withdrawal') {
      withdrawer = pick(r, receiversSeed[p.book]);
      amount = ([5000, 10000, 2500, 25000, 7500][Math.floor(r() * 5)] ?? 5000) * 100;
    } else if (p.kind === 'misc') {
      lines =
        p.book === 'food'
          ? [
              lineOf(`ln-${i}-1`, 'c-f1', 'i-f1', 12.5),
              lineOf(`ln-${i}-2`, 'c-f2', 'i-f6', 2),
              ...(i % 4 === 1 ? [lineOf(`ln-${i}-3`, 'c-f3', 'i-f8', 1, 192000)] : []),
            ]
          : [
              lineOf(`ln-${i}-1`, 'c-h1', 'i-h1', 3),
              lineOf(`ln-${i}-2`, 'c-h2', 'i-h5', 6),
              ...(i === 7 ? [lineOf(`ln-${i}-3`, 'c-old', 'i-old', 40)] : []),
            ];
      amount = lines.reduce((s, l) => s + l.totalPaise, 0);
    } else {
      const people = staffSeed.filter((s) => s.book === p.book);
      employee = pick(r, people);
      yearMonth = pick(r, months).value;
      amount = ([2000, 3000, 5000, 1500][Math.floor(r() * 4)] ?? 2000) * 100;
    }
    expenses.push({
      id: `exp-${i + 1}`,
      entryNo: expSeq[type],
      type,
      kind: p.kind,
      book: p.book,
      at: when,
      withdrawer,
      employee,
      yearMonth,
      lines,
      amountPaise: amount,
      instruction:
        i % 3 === 0 ? null : p.kind === 'advance' ? 'Recover in two parts if salary is short.' : p.kind === 'misc' ? 'Bought from Gundawadi market.' : 'Handed over in an envelope, counted in front of the manager.',
      recordedBy: who,
      createdAt: when,
      updatedAt: when,
      isLatest: false,
    });
  });

  // Shift handovers: 16 over the last 6 days.
  const handovers: ShiftHandover[] = [];
  const notesPool = [
    'Room 105 AC remote is with housekeeping.',
    'Laundry bags for 2nd floor collected, return expected by 4 pm.',
    'Petty cash box key is in the drawer under the desk.',
    'Guest in 302 asked for a late checkout (1 pm), approved by manager.',
  ];
  const instrPool = [
    'VIP guest in 301: keep the suite ready by 11 am.',
    'Collect ₹2,500 balance from room 208 before checkout.',
    'Call the plumber for the 4th floor leak first thing.',
  ];
  const slots: [number, Shift, number][] = [
    [0, 'Morning', 11], [0, 'Afternoon', 16], [1, 'Morning', 11], [1, 'Afternoon', 16], [1, 'Evening', 21], [1, 'Night', 5],
    [2, 'Morning', 11], [2, 'Evening', 21], [3, 'Afternoon', 16], [3, 'Night', 5], [4, 'Morning', 11], [4, 'Evening', 21],
    [5, 'Afternoon', 16], [5, 'Night', 5], [6, 'Morning', 11], [6, 'Evening', 21],
  ];
  slots
    .slice()
    .reverse()
    .forEach(([daysAgo, shift, hh], i) => {
      const counts = emptyCounts();
      if (i !== 4) {
        counts.d500 = Math.floor(r() * 30);
        counts.d200 = Math.floor(r() * 20);
        counts.d100 = Math.floor(r() * 40);
        counts.d50 = Math.floor(r() * 20);
        counts.d20 = Math.floor(r() * 25);
        counts.d10 = Math.floor(r() * 30);
        counts.d5 = Math.floor(r() * 6);
        counts.coins = Math.floor(r() * 80);
      }
      const when = at(daysAgo, hh, 40 + Math.floor(r() * 19));
      const by = pick(r, recorders);
      const to = pick(r, staffSeed.filter((s) => s.name !== by.name));
      handovers.push({
        id: `ho-${i + 1}`,
        entryNo: i + 1,
        at: when,
        shift,
        handedBy: by,
        handedTo: i === 1 ? null : { id: to.id, name: to.name },
        counts,
        totalPaise: handoverTotalPaise(counts),
        notes: i % 3 === 0 ? [] : notesPool.slice(0, 1 + (i % notesPool.length)),
        instructions: i % 4 === 2 ? instrPool.slice(0, 1 + (i % instrPool.length)) : [],
        createdAt: when,
        updatedAt: when,
        isLatest: false,
      });
    });

  // A few more rows for today (and this week), so the Hotel Dashboard and both books show cash in and cash out today.
  // Added after the generated rows so the rows above stay exactly the same.
  const person = (name: string): CashPerson => recorders.find((p) => p.name === name) ?? recorders[0]!;
  /** hh:mm IST `daysAgo` back, as written (may still be later than now; see `settleExtras`). */
  const rawAt = (daysAgo: number, hh: number, mm: number): string => istIso(addDays(today, -daysAgo), hh, mm, Math.floor(r() * 60));
  /**
   * Pulls any extra row later than now back to now − (k+1)·5 min (k = 0 for the latest), so stamps stay distinct
   * and in order, then numbers the rows by time per group, continuing after the generated rows.
   */
  let pulled = 0; // shared across deposits and expenses so no two pulled-back rows share a stamp
  const settleExtras = <G extends string>(rows: { at: string; group: G; entryNo: number }[], seqOf: Record<G, number>): void => {
    rows
      .filter((x) => x.at > nowIso)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .forEach((x) => { pulled += 1; x.at = new Date(nowMs - pulled * 5 * 60_000).toISOString(); });
    rows
      .map((x, i) => ({ x, i }))
      .sort((a, b) => (a.x.at < b.x.at ? -1 : a.x.at > b.x.at ? 1 : a.i - b.i))
      .forEach(({ x }) => { seqOf[x.group] += 1; x.entryNo = seqOf[x.group]; });
  };
  const extraDeposits: [CashBook, number, number, number, string, number, string | null, string][] = [
    [ 'hotel', 0, 8, 15, 'Front desk night shift', 980000, 'Night walk-ins, rooms 101 and 214, paid in cash at checkout.', 'Ramesh Patel' ],
    [ 'food', 0, 9, 5, 'Restaurant cashier', 642000, 'Breakfast buffet and morning parcel orders.', 'Pooja Mehta' ],
    [ 'food', 0, 10, 20, 'Banquet counter', 1500000, 'Advance from Trivedi family for the 18 Oct kitty party (40 plates).', 'Pooja Mehta' ],
  ];
  const depTimes = extraDeposits.map(([book, daysAgo, hh, mm]) => ({ at: rawAt(daysAgo, hh, mm), group: book, entryNo: 0 }));
  settleExtras(depTimes, depSeq);
  extraDeposits.forEach(([book, , , , depositor, paise, instruction, by], i) => {
    const { at: when, entryNo } = depTimes[i]!;
    deposits.push({
      id: `dep-${29 + i}`, version: 1, entryNo, book, at: when, depositor, amountPaise: paise, instruction,
      recordedBy: person(by), createdAt: when, updatedAt: when, isLatest: false,
    });
  });

  const staffOf = (id: string): StaffMember | null => staffSeed.find((s) => s.id === id) ?? null;
  const extraExpenses: { kind: ExpenseKind; book: CashBook; daysAgo: number; hh: number; mm: number; by: string; amount?: number; withdrawer?: string; employee?: string; lines?: ExpenseLine[]; instruction: string | null }[] = [
    { kind: 'advance', book: 'hotel', daysAgo: 3, hh: 12, mm: 10, by: 'Ashok Desai', amount: 150000, employee: 'st-h7', instruction: 'Advance for school fees, recover from October salary.' },
    { kind: 'withdrawal', book: 'food', daysAgo: 2, hh: 18, mm: 30, by: 'Pooja Mehta', amount: 300000, withdrawer: 'Hitesh Parmar (Chef)', instruction: 'Cash for Sunday vegetable market purchase.' },
    { kind: 'withdrawal', book: 'hotel', daysAgo: 0, hh: 9, mm: 40, by: 'Kiran Joshi', amount: 500000, withdrawer: 'Ashok Desai (Manager)', instruction: 'Petty cash top-up for the front desk.' },
    {
      kind: 'misc', book: 'hotel', daysAgo: 0, hh: 10, mm: 5, by: 'Ramesh Patel',
      lines: [lineOf('ln-x4-1', 'c-h1', 'i-h2', 2), lineOf('ln-x4-2', 'c-h1', 'i-h3', 3), lineOf('ln-x4-3', 'c-h4', 'i-h11', 2)],
      instruction: 'Bought from Patel Provision Store, Yagnik Road.',
    },
    { kind: 'advance', book: 'food', daysAgo: 0, hh: 10, mm: 45, by: 'Ashok Desai', amount: 200000, employee: 'st-f4', instruction: 'Medical advance, recover in two parts.' },
    {
      kind: 'misc', book: 'food', daysAgo: 5, hh: 11, mm: 20, by: 'Pooja Mehta',
      lines: [lineOf('ln-x6-1', 'c-f4', 'i-f9', 1), lineOf('ln-x6-2', 'c-f4', 'i-f11', 3)],
      instruction: 'Bought from Shree Ram Kirana, Dhebar Road.',
    },
    { kind: 'withdrawal', book: 'food', daysAgo: 4, hh: 19, mm: 15, by: 'Pooja Mehta', amount: 1200000, withdrawer: 'Bank deposit (HDFC Rajkot)', instruction: 'Weekend restaurant cash deposited in the current account.' },
    {
      kind: 'misc', book: 'food', daysAgo: 0, hh: 8, mm: 50, by: 'Pooja Mehta',
      lines: [lineOf('ln-x8-1', 'c-f2', 'i-f5', 20), lineOf('ln-x8-2', 'c-f2', 'i-f7', 5), lineOf('ln-x8-3', 'c-f1', 'i-f4', 6)],
      instruction: 'Morning milk and curd from Amul parlour, coriander from the lari.',
    },
    { kind: 'withdrawal', book: 'food', daysAgo: 0, hh: 11, mm: 30, by: 'Kiran Joshi', amount: 250000, withdrawer: 'Hitesh Parmar (Chef)', instruction: 'Cash for the banquet grocery run.' },
  ];
  const expTimes = extraExpenses.map((x) => ({ at: rawAt(x.daysAgo, x.hh, x.mm), group: expenseTypeOf(x.kind, x.book), entryNo: 0 }));
  settleExtras(expTimes, expSeq);
  extraExpenses.forEach((x, i) => {
    const type = expenseTypeOf(x.kind, x.book);
    const { at: when, entryNo } = expTimes[i]!;
    const lines = x.lines ?? [];
    expenses.push({
      id: `exp-${27 + i}`, entryNo, type, kind: x.kind, book: x.book, at: when,
      withdrawer: x.withdrawer ?? null, employee: x.employee ? staffOf(x.employee) : null, yearMonth: x.kind === 'advance' ? today.slice(0, 7) : null,
      lines, amountPaise: x.amount ?? lines.reduce((s, l) => s + l.totalPaise, 0), instruction: x.instruction,
      recordedBy: person(x.by), createdAt: when, updatedAt: when, isLatest: false,
    });
  });

  return { deposits, expenses, handovers, seq: 1000 };
}

/* ------------------------------------------------------------------ */
/* Mock API                                                            */
/* ------------------------------------------------------------------ */

function sumPaise<T>(rows: T[], f: (x: T) => number): number {
  return rows.reduce((s, x) => s + f(x), 0);
}

function byNewest<T extends { at: string; entryNo: number }>(a: T, b: T): number {
  return a.at === b.at ? b.entryNo - a.entryNo : a.at < b.at ? 1 : -1;
}

function textMatch(fields: (string | null | undefined)[], search: string): boolean {
  const words = search.split(/\s+/).filter(Boolean);
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  const digits = hay.replace(/,/g, '');
  return words.every((w) => {
    const plain = w.replace(/[₹,#]/g, '');
    return hay.includes(w) || (plain !== '' && digits.includes(plain));
  });
}

function paged<T>(all: T[], q: ListQuery): Page<T> {
  const pageSize = q.pageSize ?? 20;
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
}

function moneyFields(paise: number): string[] {
  return [formatINR(paise), String(paise / 100)];
}

function cleanText(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

export function createCashApi(clock: MockClock = {}, fixtureSeed?: CashSeed) {
  const store: Store = fixtureSeed
    ? { deposits: fixtureSeed.deposits, expenses: fixtureSeed.expenses, handovers: fixtureSeed.handovers, seq: fixtureSeed.seq }
    : seed(Date.now());
  const now = () => Date.now();
  const nextId = (p: string) => `${p}-${++store.seq}`;

  const lookups: CashLookups = fixtureSeed?.lookups ?? (mockEmptyHotel()
    // A brand-new hotel keeps the defaults (depositor and receiver names, expense categories, shifts) but has no staff yet.
    ? { depositors: newHotelDepositors, receivers: newHotelReceivers, staff: [], catalogue: catalogueSeed, shifts }
    : { depositors: depositorsSeed, receivers: receiversSeed, staff: staffSeed, catalogue: catalogueSeed, shifts });

  const liveDeposits = () => store.deposits.filter((d) => !d.deletedAt);
  const liveExpenses = () => store.expenses.filter((d) => !d.deletedAt);
  const liveHandovers = () => store.handovers.filter((d) => !d.deletedAt);

  /** Pallav `CashLedger::newestId`: the newest entry of a book by date, then time, then id (NOT the highest number). */
  const idNum = (id: string) => Number(id.replace(/\D/g, '')) || 0;
  const markDeposit = (d: CashDeposit): CashDeposit => {
    const inBook = liveDeposits().filter((x) => x.book === d.book);
    const newest = inBook.reduce<CashDeposit | null>(
      (best, x) => (!best || x.at > best.at || (x.at === best.at && idNum(x.id) > idNum(best.id)) ? x : best),
      null,
    );
    return { ...d, isLatest: newest?.id === d.id };
  };
  const markExpense = (e: CashExpense): CashExpense => {
    const newest = Math.max(0, ...liveExpenses().filter((x) => x.type === e.type).map((x) => x.entryNo));
    return { ...e, isLatest: e.entryNo === newest, lines: e.lines.map((l) => ({ ...l })) };
  };
  const markHandover = (h: ShiftHandover): ShiftHandover => {
    const newest = Math.max(0, ...liveHandovers().map((x) => x.entryNo));
    return { ...h, isLatest: h.entryNo === newest, counts: { ...h.counts }, notes: [...h.notes], instructions: [...h.instructions] };
  };

  const stampOf = (stamp: StampInput | null, fallback: string): string => {
    if (!stamp) return fallback;
    const [hh, mm] = stamp.time.trim().split(':').map(Number);
    return istIso(stamp.date, hh ?? 0, mm ?? 0, 0);
  };

  const monthRange = () => {
    const t = istToday(now());
    return { today: t, month: t.slice(0, 7) };
  };

  function cashStats<T extends { at: string; book: CashBook; amountPaise: number }>(rows: T[], book: CashBookFilter, monthOnlyFilter: (x: T) => boolean = () => true): CashStats {
    const { today, month } = monthRange();
    const inBook = rows.filter((x) => book === 'all' || x.book === book);
    const inMonth = (x: T) => istDateOf(x.at).slice(0, 7) === month;
    return {
      todayPaise: sumPaise(inBook.filter((x) => istDateOf(x.at) === today), (x) => x.amountPaise),
      monthPaise: sumPaise(inBook.filter(inMonth), (x) => x.amountPaise),
      hotelMonthPaise: sumPaise(rows.filter((x) => x.book === 'hotel' && inMonth(x) && monthOnlyFilter(x)), (x) => x.amountPaise),
      foodMonthPaise: sumPaise(rows.filter((x) => x.book === 'food' && inMonth(x) && monthOnlyFilter(x)), (x) => x.amountPaise),
    };
  }

  function inRange(at: string, q: ListQuery): boolean {
    const d = istDateOf(at);
    return (!q.from || d >= q.from) && (!q.to || d <= q.to);
  }

  /* ---------------- Revenue ---------------- */

  const depositFields = (d: CashDeposit) => [
    d.depositor, d.instruction, d.recordedBy.name, cashBookNames[d.book], 'deposit', entryLabel(d.entryNo), `#${d.entryNo}`,
    formatDateTime(d.at), istDateOf(d.at), ...moneyFields(d.amountPaise),
  ];

  async function listDeposits(q: DepositQuery = {}): Promise<DashResult<CashList<CashDeposit>>> {
    return mockCall(() => {
      const book = q.book ?? 'all';
      const s = (q.search ?? '').trim().toLowerCase();
      const source = q.deleted === 'only' ? store.deposits.filter((d) => d.deletedAt) : liveDeposits();
      const all = source.map(markDeposit).sort(byNewest);
      const matched = all.filter((d) => inRange(d.at, q) && (!s || textMatch(depositFields(d), s)));
      const shown = matched.filter((d) => book === 'all' || d.book === book);
      return ok({
        ...paged(shown, q),
        stats: cashStats(all, book),
        counts: { all: matched.length, hotel: matched.filter((d) => d.book === 'hotel').length, food: matched.filter((d) => d.book === 'food').length },
        shownTotalPaise: sumPaise(shown, (d) => d.amountPaise),
      });
    }, clock);
  }

  async function getDeposit(id: string): Promise<DashResult<CashDeposit>> {
    return mockCall(() => {
      const d = liveDeposits().find((x) => x.id === id);
      return d ? ok(markDeposit(d)) : mockError('NOT_FOUND');
    }, clock);
  }

  async function createDeposit(input: DepositInput, actor: CashActor): Promise<DashResult<CashDeposit>> {
    return mockCall(() => {
      const errors = validateDeposit(input, lookups, undefined, now());
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      const ts = new Date(now()).toISOString();
      const entryNo = Math.max(0, ...store.deposits.filter((x) => x.book === input.book).map((x) => x.entryNo)) + 1;
      const d: CashDeposit = {
        id: nextId('dep'),
        version: 1,
        entryNo,
        book: input.book,
        at: stampOf(input.stamp, ts),
        depositor: input.depositor,
        amountPaise: input.amountPaise ?? 0,
        instruction: cleanText(input.instruction),
        recordedBy: { id: actor.id, name: actor.name },
        createdAt: ts,
        updatedAt: ts,
        isLatest: true,
      };
      store.deposits.push(d);
      return ok(markDeposit(d));
    }, clock);
  }

  async function updateDeposit(id: string, input: DepositInput, actor: CashActor): Promise<DashResult<CashDeposit>> {
    return mockCall(() => {
      const d = liveDeposits().find((x) => x.id === id);
      if (!d) return mockError('NOT_FOUND');
      if (!canEditCashEntry(markDeposit(d), actor)) return mockError('FORBIDDEN');
      if (input.version !== undefined && input.version !== d.version) {
        return mockError('CONFLICT', undefined, { currentVersion: d.version });
      }
      if (input.book !== d.book) return mockError('VALIDATION_FAILED', { book: 'The cash book of a saved deposit cannot change.' });
      const errors = validateDeposit(input, lookups, d.depositor, now());
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      d.depositor = input.depositor;
      d.amountPaise = input.amountPaise ?? 0;
      d.instruction = cleanText(input.instruction);
      d.at = stampOf(input.stamp, d.at);
      d.updatedAt = new Date(now()).toISOString();
      d.version += 1;
      return ok(markDeposit(d));
    }, clock);
  }

  /** Recycle bin: bring a deleted deposit back (backend contract request 5). */
  async function restoreDeposit(id: string, actor: CashActor): Promise<DashResult<CashDeposit>> {
    return mockCall(() => {
      const d = store.deposits.find((x) => x.id === id && x.deletedAt);
      if (!d) return mockError('NOT_FOUND');
      if (!canDeleteCashEntry(actor)) return mockError('FORBIDDEN');
      delete d.deletedAt;
      d.version += 1;
      return ok(markDeposit(d));
    }, clock);
  }

  /** Recycle bin: delete for ever (admin only; real data goes after 30 days or by this). */
  async function purgeDeposit(id: string, actor: CashActor): Promise<DashResult<{ id: string }>> {
    return mockCall(() => {
      const i = store.deposits.findIndex((x) => x.id === id && x.deletedAt);
      if (i < 0) return mockError('NOT_FOUND');
      if (!canDeleteCashEntry(actor)) return mockError('FORBIDDEN');
      store.deposits.splice(i, 1);
      return ok({ id });
    }, clock);
  }

  /**
   * Delete MUST send the version the user saw (`{ version }` in the body; backend contract request 5).
   * An entry dated in a closed accounting year is refused with details.fields.date (Pallav's text).
   */
  async function deleteDeposit(id: string, actor: CashActor, version?: number): Promise<DashResult<{ id: string }>> {
    return mockCall(() => {
      const d = liveDeposits().find((x) => x.id === id);
      if (!d) return mockError('NOT_FOUND');
      if (!canDeleteCashEntry(actor)) return mockError('FORBIDDEN');
      if (version !== undefined && version !== d.version) return mockError('CONFLICT', undefined, { currentVersion: d.version });
      d.deletedAt = new Date(now()).toISOString();
      return ok({ id });
    }, clock);
  }

  /* ---------------- Expenses ---------------- */

  const expenseFields = (e: CashExpense) => [
    e.withdrawer, e.employee?.name, e.employee?.code, e.instruction, e.recordedBy.name, cashBookNames[e.book],
    expenseKindNames[e.kind], expenseTypeNames[e.type], entryLabel(e.entryNo), `#${e.entryNo}`, formatDateTime(e.at), istDateOf(e.at),
    e.yearMonth ? formatMonth(e.yearMonth) : null, ...e.lines.flatMap((l) => [l.categoryName, l.itemName]), ...moneyFields(e.amountPaise),
  ];

  async function listExpenses(q: ExpenseQuery = {}): Promise<DashResult<CashList<CashExpense>>> {
    return mockCall(() => {
      const book = q.book ?? 'all';
      const kind = q.kind ?? 'all';
      const s = (q.search ?? '').trim().toLowerCase();
      const all = liveExpenses().map(markExpense).sort(byNewest);
      const matched = all.filter((e) => (kind === 'all' || e.kind === kind) && inRange(e.at, q) && (!s || textMatch(expenseFields(e), s)));
      const shown = matched.filter((e) => book === 'all' || e.book === book);
      return ok({
        ...paged(shown, q),
        // The per-business month figures count withdrawals and misc only (no advances), as their label says.
        stats: cashStats(all, book, (e) => e.kind !== 'advance'),
        counts: { all: matched.length, hotel: matched.filter((e) => e.book === 'hotel').length, food: matched.filter((e) => e.book === 'food').length },
        shownTotalPaise: sumPaise(shown, (e) => e.amountPaise),
      });
    }, clock);
  }

  async function getExpense(id: string): Promise<DashResult<CashExpense>> {
    return mockCall(() => {
      const e = liveExpenses().find((x) => x.id === id);
      return e ? ok(markExpense(e)) : mockError('NOT_FOUND');
    }, clock);
  }

  function buildLines(input: ExpenseInput, existing?: CashExpense): ExpenseLine[] {
    const saved = existing?.lines ?? [];
    return input.lines.map((l) => {
      const f = lineFigures(l, catalogueSeed, saved);
      const old = l.lineId ? saved.find((s) => s.id === l.lineId) : undefined;
      const keep = l.itemId === 'keep' && old;
      const qty = parseQuantity(l.quantity) ?? 0;
      return {
        id: old?.id ?? nextId('ln'),
        categoryId: keep ? old.categoryId : l.categoryId,
        categoryName: f.categoryName,
        itemId: keep ? old.itemId : l.itemId,
        itemName: f.itemName,
        pricing: l.pricing,
        quantity: qty,
        pricePaise: f.pricePaise ?? 0,
        totalPaise: f.totalPaise,
      };
    });
  }

  function applyExpense(target: CashExpense, input: ExpenseInput, existing?: CashExpense): void {
    target.withdrawer = input.kind === 'withdrawal' ? input.withdrawer : null;
    const person = lookups.staff.find((s) => s.id === input.employeeId);
    target.employee = input.kind === 'advance' && person ? { ...person } : null;
    target.yearMonth = input.kind === 'advance' ? input.yearMonth : null;
    target.lines = input.kind === 'misc' ? buildLines(input, existing) : [];
    target.amountPaise = input.kind === 'misc' ? sumPaise(target.lines, (l) => l.totalPaise) : (input.amountPaise ?? 0);
    target.instruction = cleanText(input.instruction);
  }

  async function createExpense(input: ExpenseInput, actor: CashActor): Promise<DashResult<CashExpense>> {
    return mockCall(() => {
      const errors = validateExpense(input, lookups, undefined, now());
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      const ts = new Date(now()).toISOString();
      const type = expenseTypeOf(input.kind, input.book);
      const entryNo = Math.max(0, ...store.expenses.filter((x) => x.type === type).map((x) => x.entryNo)) + 1;
      const e: CashExpense = {
        id: nextId('exp'),
        entryNo,
        type,
        kind: input.kind,
        book: input.book,
        at: stampOf(input.stamp, ts),
        withdrawer: null,
        employee: null,
        yearMonth: null,
        lines: [],
        amountPaise: 0,
        instruction: null,
        recordedBy: { id: actor.id, name: actor.name },
        createdAt: ts,
        updatedAt: ts,
        isLatest: true,
      };
      applyExpense(e, input);
      store.expenses.push(e);
      return ok(markExpense(e));
    }, clock);
  }

  async function updateExpense(id: string, input: ExpenseInput, actor: CashActor): Promise<DashResult<CashExpense>> {
    return mockCall(() => {
      const e = liveExpenses().find((x) => x.id === id);
      if (!e) return mockError('NOT_FOUND');
      if (!canEditCashEntry(markExpense(e), actor)) return mockError('FORBIDDEN');
      if (input.kind !== e.kind || (e.kind !== 'advance' && input.book !== e.book)) {
        return mockError('VALIDATION_FAILED', { kind: 'The kind and cash book of a saved entry cannot change.' });
      }
      const errors = validateExpense(input, lookups, e, now());
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      const before = markExpense(e);
      applyExpense(e, input, before);
      e.book = input.book;
      e.at = stampOf(input.stamp, e.at);
      e.updatedAt = new Date(now()).toISOString();
      // Pallav: an edit by anyone but the top admin takes over the "recorded by".
      if (!actor.isAdmin) e.recordedBy = { id: actor.id, name: actor.name };
      return ok(markExpense(e));
    }, clock);
  }

  async function deleteExpense(id: string, actor: CashActor, version?: number): Promise<DashResult<{ id: string }>> {
    return mockCall(() => {
      const e = liveExpenses().find((x) => x.id === id);
      if (!e) return mockError('NOT_FOUND');
      if (!canDeleteCashEntry(actor)) return mockError('FORBIDDEN');
      void version;
      e.deletedAt = new Date(now()).toISOString();
      return ok({ id });
    }, clock);
  }

  /* ---------------- Shift handover ---------------- */

  const handoverFields = (h: ShiftHandover) => [
    h.handedBy.name, h.handedTo?.name, h.shift, ...h.notes, ...h.instructions, amountInWords(h.totalPaise),
    entryLabel(h.entryNo), `#${h.entryNo}`, formatDateTime(h.at), istDateOf(h.at), ...moneyFields(h.totalPaise),
  ];

  async function listHandovers(q: ListQuery = {}): Promise<DashResult<HandoverList>> {
    return mockCall(() => {
      const s = (q.search ?? '').trim().toLowerCase();
      const all = liveHandovers().map(markHandover).sort(byNewest);
      const shown = all.filter((h) => inRange(h.at, q) && (!s || textMatch(handoverFields(h), s)));
      const { today, month } = monthRange();
      const todays = all.filter((h) => istDateOf(h.at) === today);
      const months = all.filter((h) => istDateOf(h.at).slice(0, 7) === month);
      return ok({
        ...paged(shown, q),
        stats: {
          todayCount: todays.length,
          todayCashPaise: sumPaise(todays, (h) => h.totalPaise),
          monthCount: months.length,
          monthCashPaise: sumPaise(months, (h) => h.totalPaise),
          latest: all[0] ?? null,
        },
      });
    }, clock);
  }

  async function getHandover(id: string): Promise<DashResult<ShiftHandover>> {
    return mockCall(() => {
      const h = liveHandovers().find((x) => x.id === id);
      return h ? ok(markHandover(h)) : mockError('NOT_FOUND');
    }, clock);
  }

  function applyHandover(h: ShiftHandover, input: HandoverInput): void {
    const to = lookups.staff.find((s) => s.id === input.handedToId);
    h.shift = input.shift === '' ? 'Morning' : input.shift;
    h.handedTo = to ? { id: to.id, name: to.name } : null;
    h.counts = { ...input.counts };
    h.totalPaise = handoverTotalPaise(input.counts);
    h.notes = input.notes.map((n) => n.trim()).filter(Boolean);
    h.instructions = input.instructions.map((n) => n.trim()).filter(Boolean);
  }

  async function createHandover(input: HandoverInput, actor: CashActor): Promise<DashResult<ShiftHandover>> {
    return mockCall(() => {
      const errors = validateHandover(input, lookups.staff, now());
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      const ts = new Date(now()).toISOString();
      const h: ShiftHandover = {
        id: nextId('ho'),
        entryNo: Math.max(0, ...store.handovers.map((x) => x.entryNo)) + 1,
        at: stampOf(input.stamp, ts),
        shift: 'Morning',
        handedBy: { id: actor.id, name: actor.name },
        handedTo: null,
        counts: emptyCounts(),
        totalPaise: 0,
        notes: [],
        instructions: [],
        createdAt: ts,
        updatedAt: ts,
        isLatest: true,
      };
      applyHandover(h, input);
      store.handovers.push(h);
      return ok(markHandover(h));
    }, clock);
  }

  async function updateHandover(id: string, input: HandoverInput, actor: CashActor): Promise<DashResult<ShiftHandover>> {
    return mockCall(() => {
      const h = liveHandovers().find((x) => x.id === id);
      if (!h) return mockError('NOT_FOUND');
      const marked = markHandover(h);
      if (!canEditCashEntry({ isLatest: marked.isLatest, recordedBy: h.handedBy }, actor)) return mockError('FORBIDDEN');
      const errors = validateHandover(input, lookups.staff, now());
      if (Object.keys(errors).length) return mockError('VALIDATION_FAILED', errors);
      applyHandover(h, input);
      h.at = stampOf(input.stamp, h.at);
      h.updatedAt = new Date(now()).toISOString();
      return ok(markHandover(h));
    }, clock);
  }

  async function deleteHandover(id: string, actor: CashActor, version?: number): Promise<DashResult<{ id: string }>> {
    void version;
    return mockCall(() => {
      const h = liveHandovers().find((x) => x.id === id);
      if (!h) return mockError('NOT_FOUND');
      if (!canDeleteCashEntry(actor)) return mockError('FORBIDDEN');
      h.deletedAt = new Date(now()).toISOString();
      return ok({ id });
    }, clock);
  }

  async function getLookups(): Promise<DashResult<CashLookups>> {
    return mockCall(() => ok(lookups), { ...clock, latencyMs: Math.min(clock.latencyMs ?? 500, 250) });
  }

  async function getHandoverOptions(): Promise<DashResult<HandoverOptions>> {
    return mockCall(() => ok({ staff: lookups.staff, shifts: [...lookups.shifts], currentShift: shiftAt(now()) }), { ...clock, latencyMs: Math.min(clock.latencyMs ?? 500, 250) });
  }

  return {
    getLookups, getHandoverOptions,
    listDeposits, getDeposit, createDeposit, updateDeposit, deleteDeposit, restoreDeposit, purgeDeposit,
    listExpenses, getExpense, createExpense, updateExpense, deleteExpense,
    listHandovers, getHandover, createHandover, updateHandover, deleteHandover,
  };
}
