import "server-only";
// The Daily Cash repositories on PostgreSQL: deposits, withdrawals, miscellaneous expenses (with their lines), the expense catalogue, Master Data
// lists, accounting years and the two log tables. Everything the cash services get inside one unit (CashRepos, repos/cashDeposit.ts).
import { toBigInt, toDecimalNumber } from "../../../db/convert";
import type { TxClient } from "../../../db/types";
import type { WithHotel } from "../../../db/withHotel";
import type { EntryNumberTable } from "../../data/entryNo";
import type { CashDepositPatch, CashDepositRecord, CashDepositSort, CashRepos, NewCashDeposit } from "../cashDeposit";
import type { CashBook } from "../entries";
import type { CashWithdrawalPatch, CashWithdrawalRecord, CashWithdrawalSort, CatalogCategory, MiscExpensePatch, MiscExpenseRecord, MiscExpenseSort, MiscLine, NewCashWithdrawal, NewMiscExpense } from "../expenses";
import type { Unit } from "../types";
import { pgEntryRepo, type PgEntryKind } from "./entries";
import { pgCashSupport } from "./support";
import { createPgUnit } from "./unit";

const tableFor = (hotel: EntryNumberTable, food: EntryNumberTable) => (book: CashBook): EntryNumberTable => (book === "hotel" ? hotel : food);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const depositKind: PgEntryKind<CashDepositRecord, NewCashDeposit, CashDepositPatch> = {
  table: tableFor("hotel_cash_deposits", "food_cash_deposits"),
  own: [["depositor", "depositor"], ["reason", "reason"]],
  searchable: ["depositor", "reason"],
  sorts: { entryNo: "entry_no", date: "date", time: "time", amountPaise: "amount_paise", depositor: "depositor" },
  read: (r) => ({ depositor: String(r.depositor), reason: text(r.reason) }),
};

const withdrawalKind: PgEntryKind<CashWithdrawalRecord, NewCashWithdrawal, CashWithdrawalPatch> = {
  table: tableFor("hotel_cash_withdrawals", "food_cash_withdrawals"),
  own: [["withdrawer", "withdrawer"], ["instruction", "instruction"]],
  searchable: ["withdrawer", "instruction"],
  sorts: { entryNo: "entry_no", date: "date", time: "time", amountPaise: "amount_paise", withdrawer: "withdrawer" },
  read: (r) => ({ withdrawer: String(r.withdrawer), instruction: text(r.instruction) }),
};

const lineOf = (r: Record<string, unknown>): MiscLine => ({
  id: String(r.id),
  categoryId: text(r.category_id),
  itemId: text(r.item_id),
  category: String(r.category),
  item: String(r.item),
  pricing: r.pricing as MiscLine["pricing"],
  quantity: toDecimalNumber(r.quantity),
  pricePaise: toBigInt(r.price_paise),
  totalPaise: toBigInt(r.total_paise),
});

const miscKind: PgEntryKind<MiscExpenseRecord, NewMiscExpense, MiscExpensePatch> = {
  table: tableFor("hotel_misc_expenses", "food_misc_expenses"),
  own: [["expenseName", "expense_name"], ["expenseHead", "expense_head"], ["instruction", "instruction"]],
  searchable: ["expense_name", "expense_head", "instruction"],
  sorts: { entryNo: "entry_no", date: "date", time: "time", amountPaise: "amount_paise", expenseName: "expense_name" },
  read: (r) => ({ expenseName: String(r.expense_name), expenseHead: text(r.expense_head), instruction: text(r.instruction), lines: [] }),
  async hydrate(tx, book, records) {
    if (records.length === 0) return;
    const lines = await tx.query("SELECT * FROM expense_lines WHERE business = $1 AND expense_id = ANY($2::uuid[]) ORDER BY created_at, id", [book, records.map((r) => r.id)]);
    const byExpense = new Map<string, MiscLine[]>();
    for (const l of lines.rows) {
      const list = byExpense.get(String(l.expense_id)) ?? [];
      list.push(lineOf(l));
      byExpense.set(String(l.expense_id), list);
    }
    for (const r of records) r.lines = byExpense.get(r.id) ?? [];
  },
  searchExtra: (book, n) =>
    `EXISTS (SELECT 1 FROM expense_lines l WHERE l.business = '${book === "hotel" ? "hotel" : "food"}' AND l.expense_id = e.id AND (position(${n}::text in lower(l.category)) > 0 OR position(${n}::text in lower(l.item)) > 0))`,
  // editing replaces every line (Pallav deletes the lines and creates the new ones); soft delete keeps them
  async afterWrite(tx, book, id, values) {
    const lines = (values as { lines?: readonly Omit<MiscLine, "id">[] }).lines;
    if (!lines) return;
    await tx.query("DELETE FROM expense_lines WHERE business = $1 AND expense_id = $2", [book, id]);
    for (const l of lines) {
      await tx.query(
        "INSERT INTO expense_lines (business, expense_id, category_id, item_id, category, item, quantity, price_paise, total_paise, pricing) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [book, id, l.categoryId, l.itemId, l.category, l.item, l.quantity, l.pricePaise.toString(), l.totalPaise.toString(), l.pricing],
      );
    }
  },
  async beforePurge(tx, book, id) {
    await tx.query("DELETE FROM expense_lines WHERE business = $1 AND expense_id = $2", [book, id]);
  },
};

function pgCashRepos(tx: TxClient): CashRepos {
  return {
    cashDeposits: pgEntryRepo<CashDepositRecord, NewCashDeposit, CashDepositPatch, CashDepositSort>(tx, depositKind),
    cashWithdrawals: pgEntryRepo<CashWithdrawalRecord, NewCashWithdrawal, CashWithdrawalPatch, CashWithdrawalSort>(tx, withdrawalKind),
    miscExpenses: pgEntryRepo<MiscExpenseRecord, NewMiscExpense, MiscExpensePatch, MiscExpenseSort>(tx, miscKind),
    expenseCatalog: {
      async forBook(book): Promise<CatalogCategory[]> {
        const categories = await tx.query("SELECT id, name FROM expense_categories WHERE business = $1 ORDER BY sort_order, name", [book]);
        const items = await tx.query(
          "SELECT i.id, i.expense_category_id, i.name, i.price_paise FROM expense_items i JOIN expense_categories c ON c.id = i.expense_category_id WHERE c.business = $1 ORDER BY i.sort_order, i.name",
          [book],
        );
        return categories.rows.map((c) => ({
          id: String(c.id),
          name: String(c.name),
          items: items.rows.filter((i) => String(i.expense_category_id) === String(c.id)).map((i) => ({ id: String(i.id), name: String(i.name), pricePaise: toBigInt(i.price_paise) })),
        }));
      },
    },
    masterLists: {
      async activeValues(setKey) {
        const r = await tx.query("SELECT i.value FROM option_items i JOIN option_sets s ON s.id = i.option_set_id WHERE s.key = $1 AND i.is_active ORDER BY i.sort_order, i.label", [setKey]);
        return r.rows.map((x) => String(x.value));
      },
    },
    ...pgCashSupport(tx),
  };
}

/** The cash unit on the real database. */
export function createPgCashUnit(withHotel: WithHotel): Unit<CashRepos> {
  return createPgUnit(withHotel, pgCashRepos);
}
