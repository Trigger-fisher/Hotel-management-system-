import "server-only";
import { AppError } from "../../errors";
import { isDate } from "../billing/advanceValidate";

// Laravel 11's rules and default wording for the payroll forms (TrimStrings + ConvertEmptyStringsToNull first, so "" is missing). The label is
// Pallav's attribute with underscores as spaces ("employee code"); the key is the apps' field. The first failure of a field wins, as Laravel
// shows it. Spec: docs/specs/payroll-core.md.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const chars = (s: string): number => Array.from(s).length;

export class Rules {
  readonly fields: Record<string, string> = {};

  fail(key: string, message: string): void {
    this.fields[key] ??= message;
  }
  has(key: string): boolean {
    return key in this.fields;
  }

  /** Trimmed text, "" as null (the two middlewares). */
  static clean(value: string | null | undefined): string | null {
    const v = (value ?? "").trim();
    return v === "" ? null : v;
  }

  required(key: string, label: string, value: string | null | undefined, message?: string): string | null {
    const v = Rules.clean(value);
    if (v === null) this.fail(key, message ?? `The ${label} field is required.`);
    return v;
  }
  /** `nullable|string|max:n` (or after `required`). */
  max(key: string, label: string, value: string | null, max: number): string | null {
    if (value !== null && chars(value) > max) this.fail(key, `The ${label} field must not be greater than ${max} characters.`);
    return value;
  }
  text(key: string, label: string, value: string | null | undefined, max: number): string | null {
    return this.max(key, label, Rules.clean(value), max);
  }
  email(key: string, label: string, value: string | null): string | null {
    if (value !== null && !EMAIL.test(value)) this.fail(key, `The ${label} field must be a valid email address.`);
    return value;
  }
  date(key: string, label: string, value: string | null): string | null {
    if (value !== null && !isDate(value)) this.fail(key, `The ${label} field must be a valid date.`);
    return value;
  }
  /** `in:...` */
  oneOf(key: string, label: string, value: string | null, allowed: readonly string[]): string | null {
    if (value !== null && !allowed.includes(value)) this.fail(key, `The selected ${label} is invalid.`);
    return value;
  }
  atLeast(key: string, label: string, value: number, min: number): number {
    if (value < min) this.fail(key, `The ${label} field must be at least ${min}.`);
    return value;
  }
  atMost(key: string, label: string, value: number, max: number): number {
    if (value > max) this.fail(key, `The ${label} field must not be greater than ${max}.`);
    return value;
  }

  /** Throws VALIDATION_FAILED with every field (the first message is the error's). */
  done(): void {
    const first = Object.values(this.fields)[0];
    if (first !== undefined) throw new AppError("VALIDATION_FAILED", first, { fields: { ...this.fields } });
  }
}

/** One field's refusal, thrown at once (a uniqueness or business rule found after the shape checks). */
export const fieldError = (key: string, message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { [key]: message } });
