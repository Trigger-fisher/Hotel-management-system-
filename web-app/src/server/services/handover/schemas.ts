import "server-only";
import { z } from "zod";
import { versionField } from "../../validation/listQuery";
import { HANDOVER_SORTS } from "./handoverService";

// The shapes the Shift Handover routes accept (ui-shared HandoverInput). Strict and bounded; the service then applies Pallav's rules and words.
const count = z.number().int().min(-1_000_000_000).max(1_000_000_000);
const counts = z.strictObject({ d500: count, d200: count, d100: count, d50: count, d20: count, d10: count, d5: count, coins: count });
const stamp = z.strictObject({ date: z.string().max(10), time: z.string().max(8) });

const fields = {
  shift: z.string().max(100),
  handedToId: z.string().max(100),
  counts,
  notes: z.array(z.string().max(20_000)).max(200),
  instructions: z.array(z.string().max(10_000)).max(200),
  stamp: stamp.nullable(),
};

/** HandoverInput (a new handover has no version). */
export const handoverCreateBody = z.strictObject(fields);
/** HandoverInput with the version the person saw (contract request: HandoverInput has no `version` yet). */
export const handoverUpdateBody = z.strictObject({ ...fields, version: versionField });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));

/** index(): `q` is `search`; 10/25/50/100 a page (PER_PAGE), 25 by default; `deleted=only` is the recycle bin. */
export const handoverListQuery = z.strictObject({
  search: z.string().max(200).regex(NO_CONTROL).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  sort: z.enum(HANDOVER_SORTS).default("at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSize.default(25),
  deleted: z.enum(["exclude", "only"]).default("exclude"),
});
