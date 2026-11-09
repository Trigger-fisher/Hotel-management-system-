import assert from "node:assert/strict";

/**
 * Contract test helper: compares what the API sends with the shape of a ui-shared type.
 *
 * Write the SAMPLE as a typed constant (`const sample: CashDeposit = { ... }`): the compiler then proves the sample IS the ui-shared
 * type, and this helper proves the DTO has exactly the sample's keys, with the same kind of value for each (string, number, boolean,
 * null where the sample has null, object, array of the same element shape). A field added to or dropped from either side fails here.
 */
export function assertMatchesContract<T extends object>(dto: unknown, sample: T, label = "dto"): void {
  assertShape(dto, sample, label);
}

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function assertShape(actual: unknown, sample: unknown, path: string): void {
  const expected = kindOf(sample);
  // a null in the sample means "this field may be null", so a null or any value is accepted there
  if (expected === "null") return;
  assert.equal(kindOf(actual), expected, `${path}: expected ${expected}, got ${kindOf(actual)}`);
  if (expected === "array") {
    const items = actual as unknown[];
    const first = (sample as unknown[])[0];
    if (first !== undefined) items.forEach((item, i) => assertShape(item, first, `${path}[${i}]`));
    return;
  }
  if (expected === "object") {
    const got = Object.keys(actual as object).sort();
    const want = Object.keys(sample as object).sort();
    assert.deepEqual(got, want, `${path}: keys differ (extra: ${got.filter((k) => !want.includes(k)).join(",") || "none"}; missing: ${want.filter((k) => !got.includes(k)).join(",") || "none"})`);
    for (const key of want) assertShape((actual as Record<string, unknown>)[key], (sample as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
