import "server-only";
import { AppError } from "../../errors";
import { clean, isDate, type Fields } from "../billing/advanceValidate";

// Front-office validation with Pallav's rules and Laravel 11's wording (RoomController::validated :111-119, ReservationController::validated
// :159-182, StayController::store :71-92, charge :149-155, move :185, extend :204, checkout :225-233, ReservationController::advance :126-134),
// Pallav's own custom messages where it has them. Field keys are the apps' (ui-shared frontOffice.ts inputs). Force mode relaxes required/max/
// min/exists and keeps the types (ForceMode::relax). Spec: docs/specs/front-office.md.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const chars = (s: string): number => Array.from(s).length;

export class Check {
  readonly fields: Fields = {};
  constructor(private readonly force: boolean) {}

  /** `required` text (trimmed; empty is missing). */
  required(key: string, label: string, value: string, message?: string): string | null {
    const v = clean(value);
    if (v === null && !this.force) this.fields[key] ??= message ?? `The ${label} field is required.`;
    return v;
  }
  max(key: string, label: string, value: string | null, max: number): string | null {
    if (!this.force && value !== null && chars(value) > max) this.fields[key] ??= `The ${label} field must not be greater than ${max} characters.`;
    return value;
  }
  text(key: string, label: string, value: string, max: number): string | null {
    return this.max(key, label, clean(value), max);
  }
  email(key: string, value: string): string | null {
    const v = clean(value);
    // `email` and `max:150` both step aside under force (ForceMode::relax keeps only the type rules)
    if (v !== null && !this.force && !EMAIL.test(v)) this.fields[key] ??= "The email field must be a valid email address.";
    return this.max(key, "email", v, 150);
  }
  /** `required, date` (stays a type rule under force; an empty one becomes `fallback` under force). */
  date(key: string, label: string, value: string, fallback: string, message?: string): string {
    const v = clean(value);
    if (v === null) {
      if (this.force) return fallback;
      this.fields[key] ??= message ?? `The ${label} field is required.`;
      return "";
    }
    if (!isDate(v)) this.fields[key] ??= `The ${label} field must be a valid date.`;
    return v;
  }
  /** `integer, min, max` on a number the shape already made whole. */
  between(key: string, label: string, value: number, min: number, max: number): number {
    if (!this.force) {
      if (value < min) this.fields[key] ??= `The ${label} field must be at least ${min}.`;
      else if (value > max) this.fields[key] ??= `The ${label} field must not be greater than ${max}.`;
    }
    return value;
  }
  /** `numeric, min:0` money in paise (the shape made it whole); null stays null. Money never goes below zero, even under force. */
  money(key: string, label: string, value: number | null): bigint | null {
    if (value === null) return null;
    if (value < 0) this.fields[key] ??= `The ${label} field must be at least 0.`;
    return BigInt(Math.max(0, value));
  }
  fail(key: string, message: string): void {
    this.fields[key] ??= message;
  }
  done(): void {
    if (Object.keys(this.fields).length > 0) throw new AppError("VALIDATION_FAILED", undefined, { fields: this.fields });
  }
}

/** A decimal quantity "1.5" with Laravel's numeric min:0.01 max:9999 (StayController.php:153). */
export function quantity(c: Check, key: string, value: number, force: boolean): string {
  const text = Number.isFinite(value) ? value.toFixed(2).replace(/\.?0+$/, "") : "0";
  if (!force && value < 0.01) c.fail(key, "The quantity field must be at least 0.01.");
  else if (!force && value > 9999) c.fail(key, "The quantity field must not be greater than 9999.");
  // decimal(8,2): more places are not stored
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) c.fail(key, "The quantity field must have 0-2 decimal places.");
  return text;
}

/** A GST percent 0..28 as decimal text (StayController.php:230-231). */
export function gstPercent(c: Check, key: string, label: string, value: number, force: boolean): string {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(String(value))) c.fail(key, `The ${label} field must be a number.`);
  else if (!force && value > 28) c.fail(key, `The ${label} field must not be greater than 28.`);
  return String(value);
}

export const isPlainDate = isDate;
