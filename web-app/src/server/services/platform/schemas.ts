import "server-only";
import { z } from "zod";

// What the console routes accept. Strict and bounded (docs/BACKEND.md section 14): an unknown key, a repeated query name, a page size other than
// 10/25/50/100 or a control character is refused before a service runs.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const word = (max: number) => z.string().trim().max(max).regex(NO_CONTROL);
const text = (max: number) => z.string().max(max).regex(NO_CONTROL);
const blankable = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
const pageSize = z.coerce.number().pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]));
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const paging = { page, pageSize: pageSize.default(25) };
const bool = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());
const uuid = z.uuid();

const hotelStatuses = ["all", "active", "suspended", "pending_approval", "rejected", "archived"] as const;

export const hotelListQuery = z.strictObject({
  search: blankable(word(200)),
  status: blankable(z.enum(hotelStatuses)),
  kind: blankable(z.enum(["all", "individual", "group"])),
  groupId: blankable(uuid),
  createdMonth: blankable(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)),
  ...paging,
});

export const slugQuery = z.strictObject({ slug: word(60) });

/** Optional reason (suspend, archive); required for reject (checked by the service so the sentence is the contract's). */
export const reasonBody = z.strictObject({ reason: text(2000).optional() });

export const adminListQuery = z.strictObject({
  search: blankable(word(200)),
  status: blankable(z.enum(["all", "active", "disabled", "locked", "pending"])),
  hotelId: blankable(uuid),
  groupId: blankable(uuid),
  liveOnly: blankable(bool),
  includeArchived: blankable(bool),
  ...paging,
});

export const adminBody = z.strictObject({ name: text(200), username: text(100), email: text(300), mobile: text(40) });

export const groupListQuery = z.strictObject({ search: blankable(word(200)), status: blankable(z.enum(["all", "pending_approval", "active", "rejected"])) });
export const groupCreateBody = z.strictObject({ name: text(300), hotelIds: z.array(uuid).max(200).optional() });
export const groupHotelBody = z.strictObject({ hotelId: uuid });
export const groupAdminBody = z.strictObject({ adminId: uuid.nullable() });

export const activityQuery = z.strictObject({ search: blankable(word(200)), hotelId: blankable(uuid), groupId: blankable(uuid), ...paging });

export const invitationListQuery = z.strictObject({
  search: blankable(word(200)),
  status: blankable(z.enum(["all", "pending", "sent", "opened", "submitted", "expired", "cancelled"])),
  type: blankable(z.enum(["all", "individual", "group", "member_hotel"])),
  groupId: blankable(uuid),
  ...paging,
});
/** groupId is accepted so a Platform Admin who sends one gets the contract's field sentence, not a bare "unknown key". */
export const invitationBody = z.strictObject({
  type: z.enum(["individual", "group", "member_hotel"]).optional(),
  hotelName: text(300),
  contactName: text(300),
  email: text(400),
  groupId: z.string().max(100).nullable().optional(),
});

// The public onboarding form. Bounded strings; the optional "More about your hotel" answers are accepted as sent (the service normalises them and
// never refuses them). Both password fields are checked by the service and never stored.
const adminForm = z.strictObject({ name: text(200), username: text(100), email: text(400), mobile: text(40), password: z.string().max(300), passwordConfirm: z.string().max(300) });
export const onboardingBody = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("hotel"),
    hotel: z.strictObject({
      name: text(300), address: text(1000), city: text(300), state: text(100), pin: text(30), gstin: text(60), phone: text(60), email: text(400), logoName: text(300).nullable(),
      legalName: text(300).optional(), tradeName: text(300).optional(), gstType: z.enum(["regular", "composition", ""]).optional(),
      roomCount: z.number().nullable().optional(), checkInTime: text(10).optional(), checkOutTime: text(10).optional(),
    }),
    admin: adminForm,
  }),
  z.strictObject({
    kind: z.literal("group"),
    group: z.strictObject({ name: text(300), legalName: text(300), gstin: text(60), address: text(1000), city: text(300).optional(), state: text(100).optional(), pin: text(30).optional(), phone: text(60), email: text(400) }),
    admin: adminForm,
  }),
]);
export const tokenParams = z.strictObject({ token: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/) });

export const userListQuery = z.strictObject({
  search: blankable(word(200)),
  level: blankable(z.enum(["all", "super_admin", "platform_admin", "group_admin", "hotel_admin", "hotel_user"])),
  status: blankable(z.enum(["all", "active", "disabled", "locked", "pending"])),
  hotelId: blankable(uuid),
  groupId: blankable(uuid),
  ...paging,
});
export const staffListQuery = z.strictObject({ search: blankable(word(200)), status: blankable(z.enum(["all", "active", "disabled", "locked"])), ...paging });
const istDay = blankable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const auditFilters = {
  search: blankable(word(200)),
  from: istDay,
  to: istDay,
  action: blankable(z.string().regex(/^[a-z_]{1,60}$/)),
  hotelId: blankable(uuid),
  actor: blankable(word(120)),
};
export const auditQuery = z.strictObject({ ...auditFilters, ...paging });
export const auditExportQuery = z.strictObject(auditFilters);
export const signInQuery = z.strictObject({ search: blankable(word(200)), result: blankable(z.enum(["all", "success", "failed", "locked"])), ...paging });
export const archivedQuery = z.strictObject({ search: blankable(word(200)) });
export const settingsBody = z.strictObject({
  roleKeys: z.array(z.string().max(40)).max(20).optional(),
  defaultGstPercent: z.number().optional(),
  defaultTimeZone: text(64).optional(),
  mailFromName: text(300).optional(),
  mailFromEmail: text(400).optional(),
  mailFilesKeepHours: z.number().optional(),
  mailSendingDomain: text(400).optional(),
  /** The platform mail service (Platform settings > Mail): the main service, the Google backup and the failover rules. `password` is write-only; the service checks every field with the contract's sentences. */
  smtp: z
    .strictObject({
      provider: z.enum(["gmail", "brevo", "ses", "smtp"]).optional(),
      host: text(400).optional(),
      port: z.number().optional(),
      security: z.enum(["starttls", "ssl", "none"]).optional(),
      region: text(40).optional(),
      dailyLimit: z.number().nullable().optional(),
      user: text(400).optional(),
      replyTo: text(400).optional(),
      password: z.string().max(2000).optional(),
      clearPassword: z.boolean().optional(),
      backup: z.strictObject({ user: text(400).optional(), password: z.string().max(2000).optional(), clearPassword: z.boolean().optional() }).optional(),
      failover: z.strictObject({ enabled: z.boolean().optional(), returnMinutes: z.number().optional() }).optional(),
    })
    .optional(),
});
/** "Send test email": the address the Super Admin typed, and which service to test (the main one by default). */
/** The month of the mail usage report: `YYYY-MM`. */
export const mailUsageQuery = z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Enter the month as YYYY-MM.").optional() });
/** The Super Admin's daily mail cap for a hotel: a whole number, or null to remove it. */
export const mailCapBody = z.strictObject({ dailyCap: z.number().int().min(0).max(10_000_000).nullable() });
/** Which identity: the platform's own, or a hotel's (its id). */
export const identityScopeParams = z.strictObject({ scope: z.union([z.literal("platform"), uuid]) });
/** What the Super Admin saves for an identity: the three DKIM names Amazon SES showed (or none to clear them), and that the domain exists in SES. */
export const identityBody = z.strictObject({ dkimTokens: z.array(z.string().max(64)).max(3).optional(), sesConfirmed: z.boolean().optional() });
export const smtpTestBody = z.strictObject({ to: text(400), which: z.enum(["primary", "backup"]).optional() });
export const deleteBody = z.strictObject({ confirmSlug: text(120) });
/** An announcement (P4): the service checks the lengths and the last day with the contract's sentences. */
export const announcementBody = z.strictObject({ title: text(300), body: text(4000), audience: z.enum(["admins", "everyone"]), important: z.boolean().optional(), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
/** A hotel's own mail accounts (Platform > Hotel mail): the service checks every value with the contract's sentences. A part left out stays as it is. */
export const hotelMailBody = z.strictObject({
  ses: z.strictObject({ region: z.string().max(40).optional(), user: z.string().max(254).optional(), password: z.string().max(600).optional(), from: z.string().max(254).optional(), clear: z.boolean().optional() }).optional(),
  gmail: z.strictObject({ user: z.string().max(254).optional(), password: z.string().max(600).optional(), clear: z.boolean().optional() }).optional(),
  fromName: z.string().max(300).optional(),
  replyTo: z.string().max(254).optional(),
});
export const hotelMailTestBody = z.strictObject({ which: z.enum(["ses", "gmail"]), to: z.string().max(254) });
/** Pause or resume one hotel's or group's mail; the service checks the reason with the contract's sentence. */
export const mailPauseBody = z.strictObject({ paused: z.boolean(), reason: z.string().max(400).optional(), scope: z.enum(["all", "one"]).optional() });
/** Enter hotel: the written reason is required (the service checks 5 to 500 characters with the contract's sentences). */
export const enterBody = z.strictObject({ reason: z.string().max(2000) });
/** A platform admin's hotel access (platform 0135). */
export const hotelAccessBody = z.strictObject({ level: z.enum(["none", "view", "full"]), allHotels: z.boolean(), hotelIds: z.array(uuid).max(500).optional(), reason: z.string().max(2000) });
/** The Group Hotel Admin console's queries: the group is never named (it is the signed-in account's); no kind, no groupId. */
export const groupHotelListQuery = z.strictObject({ search: blankable(word(200)), status: blankable(z.enum(hotelStatuses)), createdMonth: blankable(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)), ...paging });
export const groupInvitationListQuery = z.strictObject({ search: blankable(word(200)), status: blankable(z.enum(["all", "pending", "sent", "opened", "submitted", "expired", "cancelled"])), ...paging });
export const groupAdminListQuery = z.strictObject({ search: blankable(word(200)), status: blankable(z.enum(["all", "active", "disabled", "locked", "pending"])), hotelId: blankable(uuid), liveOnly: blankable(bool), includeArchived: blankable(bool), ...paging });
export const groupActivityQuery = z.strictObject({ search: blankable(word(200)), ...paging });
/** The group console's invitation: always a member hotel of the caller's own group, so there is no type and no groupId. */
/** The most hotels a group may have; null = no limit. */
export const groupMaxHotelsBody = z.strictObject({ maxHotels: z.number().int().min(0).max(10000).nullable() });
export const groupInviteBody = z.strictObject({ hotelName: text(300), contactName: text(300), email: text(400) });
export const hotelIdParams = z.strictObject({ id: uuid });
export const hotelSetupGroupParams = z.strictObject({ id: uuid, group: z.enum(["email", "razorpay_hotel", "razorpay_food", "backup"]) });
export const hotelWebsiteGoogleParams = z.strictObject({ id: uuid, step: z.enum(["connect", "disconnect"]) });
export const idPhotosBody = z.strictObject({ exactCopy: z.boolean() });
export const websiteGoogleKeysBody = z.strictObject({ gbpOauthClientId: z.string().max(300).optional(), newGoogleMapsApiKey: z.string().max(300).optional(), newGbpOauthClientSecret: z.string().max(300).optional() });
export const mailAddressBody = z.strictObject({ pattern: z.enum(["org_name", "org_word", "name_number", "custom"]), word: z.string().max(64).optional() });
export const userMailAddressParams = z.strictObject({ id: uuid, addressId: uuid });
export const setupServiceParams = z.strictObject({ service: z.enum(["mail", "whatsapp", "hotel_mail", "payments_hotel", "payments_food", "backup"]) });
export const setupTestBody = z.strictObject({ to: z.string().max(254).optional(), hotelId: uuid.optional(), lineId: uuid.optional() });
export const hotelPayParams = z.strictObject({ id: uuid, business: z.enum(["hotel", "food"]) });
export const hotelPayBody = z.strictObject({ business: z.enum(["hotel", "food"]), mode: z.enum(["test", "live"]).optional(), keyId: z.string().max(64).optional(), keySecret: z.string().max(300).optional(), enabled: z.boolean().optional() });
export const hotelBackupBody = z.strictObject({ clientId: z.string().max(300).optional(), clientSecret: z.string().max(300).optional(), keepDays: z.number().int().min(1).max(365).optional() });
export const hotelBackupStepParams =z.strictObject({ id: uuid, step: z.enum(["connect", "disconnect", "test", "run"]) });
export const groupHotelParams = z.strictObject({ id: uuid, hotelId: uuid });
