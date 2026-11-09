import "server-only";

// The hotel settings groups that hold a secret (a password or a key). They are all saved through ONE route, PATCH /api/v1/admin/settings/{group}, so a rule that
// matches paths must name the group (security review round 3, R3-1). Kept apart from settingsDefs.ts on purpose: the route wrapper and the API key rules import this
// file for every request and must not load the mail library that settingsDefs.ts pulls in. tests/server/visit.access.test.ts walks SETTING_GROUPS and fails when a
// group with a secret field is missing here.
export const SECRET_SETTING_GROUPS = ["email", "razorpay_hotel", "razorpay_food", "backup"] as const;

/** The path of one of those groups' routes (the group's own save, and the sub-routes under it such as email/test). Lower case: callers match lower-cased paths. */
export const SECRET_SETTING_PATH = new RegExp(`^/api/v1/admin/settings/(${SECRET_SETTING_GROUPS.join("|")})(/|$)`);

export const isSecretSettingGroup = (group: string): boolean => (SECRET_SETTING_GROUPS as readonly string[]).includes(group);

/** What a hotel session is told when it reaches a set-up that holds a secret (MJ, 5 Nov 2026: the Super Admin sets these up from the Set-up centre). */
export const PLATFORM_SETS_UP = "This is set up by the platform team.";

const setupSessions = new WeakSet<object>();

/**
 * The Super Admin working on ONE hotel's secret set-up from the Set-up centre (services/platform/hotelSetupService.ts): the Super Admin's own verified session, pointed at that hotel
 * with its top permission role, no visit, no key. Only sessions made here pass isPlatformSetupSession; a hotel's own top role, a visit and an API key never do.
 */
export function platformSetupSession<S extends { accountRole: string; hotelId: string; roleKey: string; roleLevel: number; visit?: unknown; token?: unknown }>(session: S, hotelId: string): S {
  if (session.accountRole !== "super_admin" || session.visit !== undefined || session.token !== undefined) throw new Error("platformSetupSession: the Super Admin's own browser session only");
  const made: S = { ...session, hotelId, roleKey: "super_admin", roleLevel: 4 };
  setupSessions.add(made);
  return made;
}

export const isPlatformSetupSession = (session: object): boolean => setupSessions.has(session);
