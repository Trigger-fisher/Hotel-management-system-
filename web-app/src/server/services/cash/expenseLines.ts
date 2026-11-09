import "server-only";
import { AppError } from "../../errors";
import { ratioDecimal, mulDecimal, toPaise, type Paise } from "../../money/paise";
import type { CatalogCategory, MiscLine, NewMiscLine } from "../../repos/expenses";

// The lines of a miscellaneous expense: quantity rounding, listed and custom pricing, the totals and the short names built from them.
// A port of Pallav's ExpenseController::resolveLines (:329-385) and ::summary (:388-397), golden-tested against the real PHP arithmetic
// (tests/server/cash.golden.test.ts, fixtures/cash-revenue.json: lineMath, summaries).
//   quantity            round(q, 3)
//   listed line         total = round(quantity x price, 2); the price comes from the CATALOGUE, or from what the line was saved with when it is an
//                       unchanged line already on the entry (so editing an old entry never quietly reprices it)
//   custom line         total = the amount typed; price for one = round(total / quantity, 2)
// Money is exact: paise and a three-decimal quantity, one rounding (half away from zero) at the end.

export interface LineInput {
  /** The saved line this row came from (edit), else null. */
  lineId: string | null;
  /** 'keep' = an old item no longer in the catalogue, kept exactly as saved. */
  categoryId: string;
  itemId: string;
  /** As typed. */
  quantity: string;
  pricing: "listed" | "custom";
  /** Custom pricing: what was paid for the whole line, in paise. */
  amountPaise: number | null;
}

const NUMERIC = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

/** PHP's is_numeric for the shapes a form sends: digits, an optional fraction, an optional exponent, surrounding spaces. */
function isNumeric(text: string): boolean {
  return NUMERIC.test(text);
}

/** The text as a plain decimal string (an exponent expanded), for exact arithmetic. */
function plainDecimal(text: string): string {
  const t = text.trim();
  if (!/[eE]/.test(t)) return t.startsWith("+") ? t.slice(1) : t;
  return Number(t).toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

/** round(q, 3) as a decimal string with exactly three places, halves away from zero ("1.0005" -> "1.001"). */
export function roundQuantity(text: string): string {
  const t = plainDecimal(text);
  const negative = t.startsWith("-");
  const [whole, fraction = ""] = (negative ? t.slice(1) : t).split(".");
  const digits = BigInt(`${whole || "0"}${fraction.padEnd(3, "0").slice(0, 3)}`);
  const round = fraction.length > 3 && fraction.charCodeAt(3) - 48 >= 5 ? BigInt(1) : BigInt(0);
  const milli = digits + round;
  const s = milli.toString().padStart(4, "0");
  return `${negative && milli > BigInt(0) ? "-" : ""}${s.slice(0, -3)}.${s.slice(-3)}`;
}

const quantityNumber = (rounded: string): number => Number(rounded);

interface PricedLine {
  quantity: string;
  pricePaise: Paise;
  totalPaise: Paise;
}

/** The price and total of one line. `listedPrice` is the catalogue (or saved) price in paise; `amount` is the custom total in paise. */
export function priceLine(args: { quantity: string; pricing: "listed" | "custom"; listedPrice: Paise; amountPaise: Paise | null }): PricedLine {
  const quantity = roundQuantity(args.quantity);
  if (args.pricing === "custom") {
    const total = args.amountPaise ?? BigInt(0);
    // price for one = round(total / quantity, 2); a zero quantity gives 0 (Pallav :367)
    const price = Number(quantity) > 0 ? ratioDecimal(total, "1", quantity) : BigInt(0);
    return { quantity, pricePaise: price, totalPaise: total };
  }
  return { quantity, pricePaise: args.listedPrice, totalPaise: mulDecimal(args.listedPrice, quantity) };
}

/** ExpenseController::summary: the names the old single-line columns keep, so lists and reports still read well. */
export function summarize(lines: readonly { item: string; category: string }[]): { expenseName: string; expenseHead: string } {
  const unique = (values: string[]): string[] => [...new Set(values)];
  const items = unique(lines.map((l) => l.item));
  const categories = unique(lines.map((l) => l.category));
  const name = items.slice(0, 2).join(", ") + (items.length > 2 ? ` +${items.length - 2} more` : "");
  const head = (categories[0] ?? "") + (categories.length > 1 ? ` +${categories.length - 1}` : "");
  return { expenseName: Array.from(name).slice(0, 100).join(""), expenseHead: Array.from(head).slice(0, 60).join("") };
}

/** Pallav's validation of the posted lines (rules():288-297) with Laravel's wording; field names are the ones the apps read (lines.N.quantity, ...). */
export function lineShapeErrors(posted: readonly LineInput[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (posted.length < 1) errors.lines = "The lines field must have at least 1 items.";
  else if (posted.length > 40) errors.lines = "The lines field must not have more than 40 items.";
  posted.forEach((l, i) => {
    const at = `lines.${i}`;
    if (l.categoryId === "") errors[`${at}.category`] = `The ${at}.category_id field is required.`;
    if (l.itemId === "") errors[`${at}.item`] = `The ${at}.item_id field is required.`;
    const q = l.quantity.trim();
    if (q === "") errors[`${at}.quantity`] = `The ${at}.quantity field is required.`;
    else if (!isNumeric(q)) errors[`${at}.quantity`] = `The ${at}.quantity field must be a number.`;
    else if (Number(q) < 0.001) errors[`${at}.quantity`] = `The ${at}.quantity field must be at least 0.001.`;
    else if (Number(q) > 1_000_000) errors[`${at}.quantity`] = `The ${at}.quantity field must not be greater than 1000000.`;
    if (l.pricing === "custom") {
      if (l.amountPaise === null) errors[`${at}.amount`] = `The ${at}.amount field is required when ${at}.pricing is custom.`;
      else if (l.amountPaise < 1) errors[`${at}.amount`] = `The ${at}.amount field must be at least 0.01.`;
      else if (l.amountPaise > 999_999_999_999) errors[`${at}.amount`] = `The ${at}.amount field must not be greater than 9999999999.99.`;
    }
  });
  return errors;
}

/**
 * Turns the posted lines into what is saved (resolveLines:329-385). Throws VALIDATION_FAILED with Pallav's two messages for a missing item.
 * `existing` are the lines already on the entry (an edit); `catalog` is the book's categories with priced items.
 */
export function resolveLines(posted: readonly LineInput[], catalog: readonly CatalogCategory[], existing: readonly MiscLine[] | null): NewMiscLine[] {
  const saved = new Map((existing ?? []).map((l) => [l.id, l]));
  const out: NewMiscLine[] = [];
  const errors: Record<string, string> = {};

  posted.forEach((line, i) => {
    const old = line.lineId ? saved.get(line.lineId) : undefined;
    let category: { id: string | null; name: string };
    let item: { id: string | null; name: string };
    let price: Paise;
    if (line.itemId === "keep") {
      // unchanged, and no longer in the catalogue: it stays exactly as saved
      if (!old) {
        errors[`lines.${i}.item`] = "Choose an item for this line.";
        return;
      }
      category = { id: old.categoryId, name: old.category };
      item = { id: old.itemId, name: old.item };
      price = old.pricePaise;
    } else {
      const found = catalog.find((c) => c.id === line.categoryId);
      const listed = found?.items.find((it) => it.id === line.itemId);
      if (!found || !listed) {
        errors[`lines.${i}.item`] = "Choose an item from the list.";
        return;
      }
      category = { id: found.id, name: found.name };
      item = { id: listed.id, name: listed.name };
      price = old && old.itemId === listed.id ? old.pricePaise : listed.pricePaise;
    }
    const priced = priceLine({ quantity: line.quantity, pricing: line.pricing, listedPrice: price, amountPaise: line.amountPaise === null ? null : toPaise(line.amountPaise) });
    out.push({ categoryId: category.id, itemId: item.id, category: category.name, item: item.name, pricing: line.pricing, quantity: quantityNumber(priced.quantity), pricePaise: priced.pricePaise, totalPaise: priced.totalPaise });
  });

  if (Object.keys(errors).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields: errors });
  return out;
}
