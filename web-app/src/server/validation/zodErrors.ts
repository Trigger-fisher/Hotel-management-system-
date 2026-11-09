import "server-only";
import { z } from "zod";
import { AppError } from "../errors/AppError";

/** Field name -> problem, in plain words. Never echoes what the caller sent. */
export function fieldsFromZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const base = issue.path.map(String);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields[[...base, key].join(".")] ??= "Unexpected field";
      continue;
    }
    const name = base.join(".") || "_";
    fields[name] ??= issue.code === "invalid_type" ? "Wrong type or missing" : "Not valid";
  }
  return fields;
}

/**
 * Parses untrusted input (body, query, params). Use z.strictObject so unknown keys are rejected.
 * Throws VALIDATION_FAILED with the failing field names; the caller's values are never echoed back.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError("VALIDATION_FAILED", undefined, { fields: fieldsFromZod(result.error) });
}
