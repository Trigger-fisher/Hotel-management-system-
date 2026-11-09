import "server-only";
import { z } from "zod";
import { HOTEL_OVERRIDE_KEYS } from "./rulesService";

// What the Rules routes accept: strict, bounded; the ranges are checked again by the service (the one that refuses).
const flag = z.boolean().nullable();
const cap = z.number().int().min(0).max(100000).nullable();
/** A profile's switches. null = unset (the built-in value applies). templates_only_for_new_messages is accepted so the service can refuse it with its plain reason. */
const profilePatch = z.strictObject({
  hotel_may_start_chats: flag.optional(),
  recipients_stay_guests_only: flag.optional(),
  templates_only_for_new_messages: flag.optional(),
  marketing_allowed: flag.optional(),
  daily_cap: cap.optional(),
  consent_required_for_automatic: flag.optional(),
  hotel_label_on_messages: flag.optional(),
  platform_blocklist_enabled: flag.optional(),
  wrong_hotel_button: flag.optional(),
  automatic_messages_one_way: flag.optional(),
});
export const rulesUpdateBody = z.strictObject({
  numbers: z.strictObject({
    routing_timeframe_minutes: z.number().int().min(5).max(1440).optional(),
    default_daily_cap: z.number().int().min(0).max(100000).optional(),
    hold_minutes: z.number().int().min(1).max(60).optional(),
    routing_mode: z.enum(["strict", "balanced"]).optional(),
    transition_days: z.number().int().min(1).max(365).optional(),
    media_max_mb: z.number().int().min(1).max(50).optional(),
    media_keep_days: z.number().int().min(1).max(365).optional(),
    media_keep_days_platform: z.number().int().min(1).max(365).optional(),
    backup_keep_days: z.number().int().min(1).max(365).optional(),
    default_language: z.enum(["en", "hinglish", "hi", "gu"]).optional(),
  }).optional(),
  profiles: z.strictObject({ shared: profilePatch.optional(), platform: profilePatch.optional(), own_default: profilePatch.optional() }).optional(),
  confirm: z.boolean().optional(),
});
export const hotelParams = z.strictObject({ hotelId: z.uuid() });
export const hotelOverrideBody = z.strictObject({ overrides: profilePatch.extend({ hotel_paused: flag.optional() }), confirm: z.boolean().optional() });
export const hotelClearQuery = z.strictObject({ key: z.enum(HOTEL_OVERRIDE_KEYS as [string, ...string[]]), confirm: z.enum(["true", "false"]).optional() });
export const killSwitchBody = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("global"), on: z.boolean(), confirm: z.boolean().optional() }),
  z.strictObject({ scope: z.literal("line"), id: z.uuid(), on: z.boolean(), confirm: z.boolean().optional() }),
  z.strictObject({ scope: z.literal("hotel"), id: z.uuid(), on: z.boolean(), confirm: z.boolean().optional() }),
]);
