import "server-only";
import { centralTabPath, type CentralTab } from "@shared/dashboards/central";
import { z } from "zod";
import { AppError } from "../../errors";
import { searchParam } from "../../validation/listQuery";

// The inputs of the Central routes (contract ui-shared/dashboards/central.ts): the tab is one of five path names, an id is a UUID, a page is 10, 25 or 50 rows.
const TABS = Object.entries(centralTabPath) as [CentralTab, string][];

/** The tab named by a path segment, or undefined. */
export const tabOfPath = (segment: string): CentralTab | undefined => TABS.find(([, p]) => p === segment)?.[0];

const tabSegment = z.string().refine((s) => tabOfPath(s) !== undefined, "Unknown tab");

export const centralListParams = z.strictObject({ tab: tabSegment });
export const centralDetailParams = z.strictObject({ tab: tabSegment, id: z.uuid() });

export const centralListQuery = z.strictObject({
  search: searchParam,
  deleted: z.enum(["1"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => n === 10 || n === 25 || n === 50, "10, 25 or 50").default(25),
});

/** The three-part address of a write: `<tab>/<id>/<action>` (restore, refresh). */
export const centralActionParams = z.strictObject({ tab: tabSegment, id: z.uuid(), action: z.enum(["restore", "refresh"]) });

const text = (max = 300) => z.string().max(max);
const maybe = (max = 300) => z.string().max(max).nullable().optional();

const WRITE_BODIES = {
  logins: z.strictObject({ username: text(60), displayName: text(120), email: text(254), mobile: text(30), roleType: z.enum(["platform_admin", "hotel_admin", "hotel_user"]), hotelId: z.uuid().nullable().optional() }),
  guests: z.strictObject({ name: text(120).optional(), mobile: maybe(30), email: maybe(254), address: maybe(300), city: maybe(120) }),
  companies: z.strictObject({ name: text(120).optional(), gstin: maybe(60), mainContactName: maybe(120), email: maybe(254), mobile: maybe(30), landline: maybe(30), address: maybe(200), pincode: maybe(30), country: maybe(120) }),
  gst: z.strictObject({ gstin: text(40) }),
} as const;
const PATCH_BODIES = {
  logins: z.strictObject({ displayName: text(120).optional(), email: text(254).optional(), mobile: text(30).optional() }),
  guests: WRITE_BODIES.guests,
  companies: WRITE_BODIES.companies,
} as const;

export const deleteBody = z.strictObject({ confirmName: text(200), reason: text(300).optional() });
/** What a write route accepts: any object here; the tab's own strict shape is checked by `parseWrite` (a 422 with the field sentences). */
export const looseBody = z.record(z.string(), z.unknown());

export function parseWrite<T>(kind: "create" | "patch", tab: string, body: unknown): T {
  const schema = (kind === "create" ? WRITE_BODIES : PATCH_BODIES)[tab as keyof typeof PATCH_BODIES];
  if (!schema) throw new AppError("FORBIDDEN", "This tab cannot be changed.");
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "body"), "Check this value."]));
    throw new AppError("VALIDATION_FAILED", "Some details need fixing.", { fields });
  }
  return parsed.data as T;
}

export const revealBody = z.strictObject({
  kind: z.enum(["guest", "company"]),
  id: z.uuid(),
  field: z.enum(["mobile", "email", "landline", "contactMobile", "contactEmail"]),
  index: z.number().int().min(0).max(99).optional(),
});
