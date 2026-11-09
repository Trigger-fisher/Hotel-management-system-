import "server-only";
import { z } from "zod";

// The shapes the users, roles and profile routes accept (ui-shared admin.ts inputs). Strict: unknown keys refused, every string bounded; no id of
// another person, no password, no status can be sent. Pallav's rules and words are applied by the services. Spec: docs/specs/admin.md §7.
const text = (max: number) => z.string().max(max);
const level = z.enum(["none", "view", "create", "edit", "full"]);

export const userBody = z.strictObject({
  name: text(1000),
  username: text(1000),
  email: text(1000),
  mobile: text(1000),
  roleId: z.uuid(),
  overrides: z.array(z.strictObject({ module: text(100), level })).max(80).default([]),
});
export type UserBody = z.output<typeof userBody>;

/** A guest or company portal login made for a record of this hotel (the record's own page offers it). The username is made from the email when not given. */
export const portalInviteBody = z.strictObject({
  kind: z.enum(["guest", "company"]),
  recordId: z.uuid(),
  name: text(1000),
  email: text(1000),
  mobile: text(1000).default(""),
  username: text(1000).optional(),
});
export type PortalInviteBody = z.output<typeof portalInviteBody>;

export const overrideBody = z.strictObject({ module: text(100), level: z.union([level, z.null()]) });
export type OverrideBody = z.output<typeof overrideBody>;

export const userListQuery = z.strictObject({
  search: z.string().trim().max(200).optional(),
  tab: z.enum(["all", "active", "inactive", "locked"]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).default(25),
});
export type UserListQuery = z.output<typeof userListQuery>;

export const roleBody = z.strictObject({
  name: text(1000),
  description: text(5000).default(""),
  levels: z.record(z.string().max(100), level).refine((v) => Object.keys(v).length <= 120, "Too many modules"),
  /** Pallav AccessController: all three optional. */
  icon: text(200).optional(),
  accent: text(20).optional(),
  inherits: z.boolean().optional(),
  /** Where a NEW role goes in the ladder (never above the creator's own rung). */
  level: z.number().int().min(1).max(100).optional(),
});

export type RoleBody = z.output<typeof roleBody>;

/** The ladder reordered: every role once, the top rung first (Pallav AccessController::reorder). */
export const roleOrderBody = z.strictObject({ order: z.array(z.uuid()).min(1).max(100) });
export type RoleOrderBody = z.output<typeof roleOrderBody>;

export const profileBody = z.strictObject({ name: text(1000), email: text(1000), mobile: text(1000), username: text(1000).optional() });
export type ProfileBody = z.output<typeof profileBody>;

/** PUT profile/password (ui-shared PasswordChangeInput). The password rule itself is the credential side's (policy.ts). */
export const passwordChangeBody = z.strictObject({ current: text(1000), next: text(1000), confirm: text(1000) });
export type PasswordChangeBody = z.output<typeof passwordChangeBody>;

/** PUT profile/emailed-code: a SET command (on or off), never a toggle, so two clicks cannot cancel out. */
/** Decision 47: link a guest or company portal account to a record of this hotel. */
export const portalLinkBody = z.strictObject({ kind: z.enum(["guest", "company"]), recordId: z.uuid() });
export const portalOptionsQuery = z.strictObject({ q: z.string().trim().max(100).default("") });
export const emailedCodeBody = z.strictObject({ on: z.boolean() });
/** Decision 46: the person's own sign-in code switch; OFF needs the current password. */
export const signInCodeBody = z.strictObject({ enabled: z.boolean(), password: z.string().max(128).optional() });
export type EmailedCodeBody = z.output<typeof emailedCodeBody>;

export const signInQuery = z.strictObject({
  search: z.string().trim().max(200).optional(),
  ip: z.string().trim().max(45).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])).default(10),
});
export type SignInQuery = z.output<typeof signInQuery>;

/** A sign-in record's id: whatever the engine calls it (a number or a uuid), letters, digits and dashes only. */
export const signInIdParams = z.strictObject({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/) });
