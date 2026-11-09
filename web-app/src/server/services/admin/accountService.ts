import "server-only";
import type { Page } from "@shared/dashboards/common";
import type { Catalog } from "../../auth/catalog";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { RequestMeta } from "../../http/meta";
import type { AdminUsersUnit, SignInRow } from "../../repos/adminUsers";
import { Rules } from "../payrollCore/validate";
import type { CredentialService } from "../auth/credentialPort";
import type { EmailedCodeBody, PasswordChangeBody, ProfileBody, SignInQuery } from "./userSchemas";
import { matchWords } from "../../validation/listQuery";
import { profilePhotoUrl } from "./profileService";

// The signed-in person's OWN account (Pallav ProfileController): the details they may change (name, phone, e-mail, and the username for administrators),
// the recent changes to their account, the devices they are signed in on and their sign-in history. An e-mail address is a credential channel (the codes
// and the reset go to it), so a change goes through the credential port; the password and the emailed-code switch are the credential side's own screens.
// Spec: docs/specs/admin.md §7.

const ADMIN_ROLES = new Set(["super_admin", "platform_admin", "group_hotel_admin", "hotel_admin"]);

interface AdminProfileDto {
  name: string;
  username: string;
  email: string;
  mobile: string;
  roleName: string;
  hotelName: string;
  emailedCode: boolean;
  /** Decision 46: the same value under its new name (the emailed sign-in code is the person's own choice; default off). */
  codeRequired: boolean;
  /** Only administrators may rename their own username (Pallav). */
  canEditUsername: boolean;
  /** Decision 46: every account, administrators included, may switch its own emailed sign-in code (always true). */
  canSwitchEmailedCode: boolean;
  passwordChangedAt: string | null;
  /** The person's own photo (platform 0131): its address (GET /profile/photo, the query changes with every new photo), or null. */
  photoUrl: string | null;
}

interface SignInDto {
  id: string;
  at: string;
  device: string;
  ip: string;
  /** The place an address was looked up to; "" until a lookup exists. */
  place: string;
  result: "success" | "failed";
  ended: boolean;
}

export interface SignInList {
  page: Page<SignInDto>;
  totals: { all: number; success: number; failed: number };
  places: { place: string; count: number }[];
}

/** SignedInDevice::label: "Chrome on Windows", read from the browser's own words; nothing else is kept. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /HMS|okhttp|Expo/i.test(ua) ? "The EasyHotelSolutions app" : "A browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** A word that looks like a day, written the ways people write one (27-09-2026, 27/09/2026, 2026-09-27): as YYYY-MM-DD, or null. */
export function asDate(word: string): string | null {
  const patterns: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^(\d{2})-(\d{2})-(\d{4})$/, (m) => `${m[3]}-${m[2]}-${m[1]}`],
    [/^(\d{2})\/(\d{2})\/(\d{4})$/, (m) => `${m[3]}-${m[2]}-${m[1]}`],
    [/^(\d{4})-(\d{2})-(\d{2})$/, (m) => `${m[1]}-${m[2]}-${m[3]}`],
  ];
  for (const [re, make] of patterns) {
    const m = re.exec(word);
    if (!m) continue;
    const iso = make(m);
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) return iso;
  }
  return null;
}

const istDay = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

const SUMMARY: Record<string, string> = {
  "profile.updated": "Profile updated",
  "user.created": "Account created",
  "user.updated": "Account details changed",
  "user.activated": "Account activated",
  "user.deactivated": "Account deactivated",
  "user.unlocked": "Account unlocked",
  "user.password_reset": "A new password was emailed",
  "two_factor.disabled": "The emailed code was switched off",
  "two_factor.enabled": "The emailed code was switched on",
  "user.permission.grant": "A permission was given",
  "user.permission.revoke": "A permission was taken away",
  "user.permission.clear": "A permission change was cleared",
  "signin.deleted": "A sign-in record was removed",
  "profile.password_changed": "Password changed",
  // the credential side's own lines (services/auth/credentialService.ts)
  "user.password_changed": "Password changed",
  "user.two_factor_enabled": "The emailed code was switched on",
  "user.two_factor_disabled": "The emailed code was switched off",
  "user.email_changed": "Email address changed",
  "user.password_reset_by_admin": "A new password was emailed",
  "user.invite_issued": "Invitation sent",
  "profile.photo_changed": "Profile photo changed",
  "profile.photo_removed": "Profile photo removed",
};

export const EMAILED_CODE_NEEDS_EMAIL = "Add an email address to your profile first.";

const ACCOUNT_LEVEL_NAME: Record<string, string> = { super_admin: "Super Admin", platform_admin: "Platform Admin", group_hotel_admin: "Group Hotel Admin" };

interface AccountDeps {
  platform: AdminUsersUnit;
  credentials: CredentialService;
  catalog: Catalog;
  now: () => Date;
  /** The stored name of the person's photo (services/admin/profileService.ts); left out = no photo. */
  photoName?: (userId: string) => Promise<string | null>;
}

export function createAccountService(deps: AccountDeps) {
  const { platform, credentials, now } = deps;

  /** Platform staff and a Group Hotel Admin belong to no hotel (inside a visit they are only looking): their profile is their own account, not a hotel membership. */
  const hotelLess = (session: VerifiedSession): boolean => session.hotelId === "" || session.accountRole === "platform_admin" || session.accountRole === "super_admin" || session.accountRole === "group_hotel_admin";
  const meOf = (repos: Parameters<Parameters<typeof platform.run>[0]>[0], session: VerifiedSession) => (hotelLess(session) ? repos.users.own(session.userId) : repos.users.get(session.hotelId, session.userId));

  async function profileOf(session: VerifiedSession): Promise<AdminProfileDto> {
    const photoUrl = profilePhotoUrl((await deps.photoName?.(session.userId)) ?? null);
    return platform.run(async (repos) => {
      // platform staff belong to no hotel (inside an Enter-hotel visit they are only looking): their profile is their own account, not a hotel membership
      const u = await meOf(repos, session);
      if (!u) throw new AppError("NOT_FOUND");
      const admin = ADMIN_ROLES.has(u.accountRole);
      return {
        name: u.displayName,
        username: u.username,
        email: u.email ?? "",
        mobile: u.mobile ?? "",
        // a person with no hotel has no hotel role to name: the account's own level is their role
        roleName: hotelLess(session) ? (ACCOUNT_LEVEL_NAME[u.accountRole] ?? u.roleName) : u.roleName,
        hotelName: hotelLess(session) ? "" : await repos.users.hotelName(session.hotelId),
        emailedCode: u.codeRequired,
        codeRequired: u.codeRequired,
        canEditUsername: admin,
        canSwitchEmailedCode: true,
        passwordChangedAt: u.passwordChangedAt ? u.passwordChangedAt.toISOString() : null,
        photoUrl,
      };
    });
  }

  function matches(row: SignInRow, words: readonly string[]): boolean {
    return words.every((w) => {
      const date = asDate(w);
      return [row.ip ?? "", deviceLabel(row.userAgent), row.userAgent ?? ""].some((v) => v.toLowerCase().includes(w)) || (date !== null && istDay(row.at) === date);
    });
  }

  return {
    async profile(session: VerifiedSession): Promise<AdminProfileDto> {
      return profileOf(session);
    },

    /** update (:196-235): name, e-mail and phone are all asked for; the username only of an administrator. */
    async updateProfile(session: VerifiedSession, input: ProfileBody, meta: RequestMeta): Promise<{ profile: AdminProfileDto; message: string }> {
      let emailChange: string | null = null;
      let changed = false;
      await platform.run(async (repos) => {
        const me = await meOf(repos, session);
        if (!me) throw new AppError("NOT_FOUND");
        const v = new Rules();
        const name = v.max("name", "name", v.required("name", "name", input.name), 100);
        const email = v.max("email", "email", v.email("email", "email", v.required("email", "email", input.email)), 254)?.toLowerCase() ?? null;
        if (email !== null && !v.has("email") && (await repos.users.emailTaken(email, me.id))) v.fail("email", "The email has already been taken.");
        const phone = v.max("mobile", "phone", v.required("mobile", "phone", input.mobile), 20);
        let mobile: string | null = null;
        if (phone !== null) {
          const t = phone.replace(/[\s-]/g, "");
          if (!/^(?:\+?91)?[6-9]\d{9}$/.test(t)) v.fail("mobile", "Enter a 10-digit mobile number.");
          else mobile = `+91${t.slice(-10)}`;
        }
        let username: string | undefined;
        if (ADMIN_ROLES.has(me.accountRole)) {
          let u = v.required("username", "username", input.username);
          if (u !== null) {
            if (Array.from(u).length < 3) v.fail("username", "The username field must be at least 3 characters.");
            else if (Array.from(u).length > 50) v.fail("username", "The username field must not be greater than 50 characters.");
            else if (!/^[A-Za-z0-9._]+$/.test(u)) v.fail("username", "Username can only contain letters, numbers, dots and underscores.");
            u = u.toLowerCase();
            if (!v.has("username") && (await repos.users.usernameTaken(u, me.id))) v.fail("username", "That username is already taken.");
            username = u;
          }
        }
        v.done();
        const before: Record<string, string> = { name: me.displayName, mobile: me.mobile ?? "", username: me.username, email: me.email ?? "" };
        const patch = { displayName: name!, mobile, ...(username ? { username } : {}) };
        if (hotelLess(session)) await repos.users.updateOwn(me.id, patch);
        else await repos.users.update(session.hotelId, me.id, patch);
        if (email !== null && email !== (me.email ?? "").toLowerCase()) emailChange = email;
        const after: Record<string, string> = { name: name!, mobile: mobile ?? "", username: username ?? me.username, email: emailChange ?? before.email };
        const changes = Object.fromEntries(Object.entries(after).filter(([k, val]) => val !== before[k]).map(([k, val]) => [k, { from: before[k], to: val }]));
        changed = Object.keys(changes).length > 0;
        if (changed) await repos.audit.write({ actorUserId: me.id, hotelId: session.hotelId === "" ? null : session.hotelId, action: "profile.updated", entity: "user", entityId: me.id, traceId: meta.traceId, detail: changes }, now());
      });
      if (emailChange) {
        const result = await credentials.changeEmail(session.userId, emailChange);
        if (!result.ok) throw new AppError("VALIDATION_FAILED", result.message, { fields: { email: result.message } });
      }
      return { profile: await profileOf(session), message: changed ? "Profile updated." : "No changes to save." };
    },

    /**
     * changePassword (ProfileController::changePassword): the three fields are asked for and the two new ones must match; the credential side checks the
     * current password on the locked row, the rule and reuse, ends my OTHER sessions (this one stays) and mails me. A wrong current password is a field
     * error (422 on `current`), never a 401: the person is signed in and must stay signed in. Passwords are never trimmed (Laravel's TrimStrings skips them).
     */
    async changePassword(session: VerifiedSession, input: PasswordChangeBody, meta: RequestMeta): Promise<{ changedAt: string; message: string }> {
      const v = new Rules();
      if (input.current === "") v.fail("current", "The current password field is required.");
      if (input.next === "") v.fail("next", "The password field is required.");
      else if (input.confirm !== input.next) v.fail("confirm", "The password field confirmation does not match.");
      v.done();
      try {
        await credentials.changeMyPassword(session, { currentPassword: input.current, newPassword: input.next }, meta);
      } catch (error) {
        if (error instanceof AppError && error.code === "INVALID_CREDENTIALS") throw new AppError("VALIDATION_FAILED", error.message, { fields: { current: error.message } });
        if (error instanceof AppError && (error.code === "PASSWORD_TOO_WEAK" || error.code === "PASSWORD_REUSED")) throw new AppError(error.code, error.message, { fields: { next: error.message } });
        throw error;
      }
      const me = await platform.run((repos) => meOf(repos, session));
      return { changedAt: (me?.passwordChangedAt ?? now()).toISOString(), message: "Password changed." };
    },

    /**
     * The emailed sign-in code, switched by the person themselves (a SET: on or off). Decision 46: every account may, administrators included (the old
     * "administrators always" rule is gone). Turning it on needs an address to send the code to. The credential side writes it and the audit line. Answers the profile.
     */
    async setEmailedCode(session: VerifiedSession, input: EmailedCodeBody, meta: RequestMeta): Promise<AdminProfileDto> {
      // the old shape has no password field: turning it OFF through it is refused (it needs the password), turning it ON works
      const me = await platform.run((repos) => meOf(repos, session));
      if (!me) throw new AppError("NOT_FOUND");
      if (input.on && (me.email ?? "").trim() === "") throw new AppError("VALIDATION_FAILED", EMAILED_CODE_NEEDS_EMAIL, { fields: { email: EMAILED_CODE_NEEDS_EMAIL } });
      if (me.codeRequired !== input.on) await credentials.setMyTwoFactor(session, input.on, meta);
      return profileOf(session);
    },

    /**
     * Decision 46 (MJ, 12 Oct 2026): the emailed sign-in code is the person's OWN choice for every account, administrators included; the default is off. ON needs an
     * address to send the code to and nothing else; OFF needs the CURRENT PASSWORD (a wrong one counts like a wrong sign-in: INVALID_CREDENTIALS on `password`, five
     * tries, then the same lock). Only ever the caller's own account; nobody can switch another person's. Audited without any secret. Answers the profile.
     */
    async setSignInCode(session: VerifiedSession, input: { enabled: boolean; password?: string }, meta: RequestMeta): Promise<AdminProfileDto> {
      const me = await platform.run((repos) => meOf(repos, session));
      if (!me) throw new AppError("NOT_FOUND");
      if (input.enabled && (me.email ?? "").trim() === "") throw new AppError("VALIDATION_FAILED", EMAILED_CODE_NEEDS_EMAIL, { fields: { email: EMAILED_CODE_NEEDS_EMAIL } });
      if (me.codeRequired !== input.enabled) await credentials.setMyTwoFactor(session, input.enabled, meta, input.password);
      return profileOf(session);
    },

    /** The last ten things done to this account, newest first (sign-in rows are another list). */
    async recentChanges(session: VerifiedSession, search?: string): Promise<{ id: string; at: string; summary: string }[]> {
      return platform.run(async (repos) => matchWords((await repos.audit.aboutUser(session.userId, 10)).map((l) => ({ id: l.id, at: l.at.toISOString(), summary: SUMMARY[l.action] ?? l.action })), search, (c) => [c.summary, c.at]));
    },

    /** The devices still signed in, this one first (read only: no revoke, as Pallav). */
    async devices(session: VerifiedSession, search?: string): Promise<{ id: string; device: string; ip: string; place: string; lastActiveAt: string; current: boolean }[]> {
      return platform.run(async (repos) =>
        matchWords(
          (await repos.signIns.liveDevices(session.userId, session.sessionId, now()))
            .sort((a, b) => Number(b.current) - Number(a.current))
            .map((d) => ({ id: d.id, device: deviceLabel(d.userAgent), ip: d.ip ?? "", place: "", lastActiveAt: (d.lastSeenAt ?? d.issuedAt).toISOString(), current: d.current })),
          search,
          (d) => [d.device, d.ip, d.place, d.lastActiveAt],
        ),
      );
    },

    /** signIns (:55-91): the person's own sign-ins, an address singled out, every word matching the address, the browser or a day; 10, 25, 50 or 100 a page. */
    async signIns(session: VerifiedSession, q: SignInQuery): Promise<SignInList> {
      const words = (q.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return platform.run(async (repos) => {
        const all = await repos.signIns.list(session.userId, now());
        const filtered = all.filter((r) => (!q.ip || r.ip === q.ip) && matches(r, words));
        const counts = new Map<string, number>();
        for (const r of all) if (r.ip) counts.set(r.ip, (counts.get(r.ip) ?? 0) + 1);
        const items = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((r): SignInDto => ({ id: r.id, at: r.at.toISOString(), device: deviceLabel(r.userAgent), ip: r.ip ?? "", place: "", result: r.result, ended: r.ended }));
        return {
          page: { items, total: filtered.length, page: q.page, pageSize: q.pageSize },
          totals: { all: all.length, success: all.filter((r) => r.result === "success").length, failed: all.filter((r) => r.result === "failed").length },
          places: [...counts].map(([place, count]) => ({ place, count })).sort((a, b) => b.count - a.count || a.place.localeCompare(b.place)),
        };
      });
    },

    /** deleteSignIn (:131-146): only the person's own, only an ENDED one (never the session they are in); the fact is written to the audit trail. */
    async deleteSignIn(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string; message: string }> {
      return platform.run(async (repos) => {
        const rows = await repos.signIns.list(session.userId, now());
        const row = rows.find((r) => r.id === id);
        if (!row) throw new AppError("NOT_FOUND", "That record belongs to another account.");
        if (!row.ended) throw new AppError("CONFLICT", "That is the session you are in. It can be removed once it has ended.");
        await repos.signIns.removeEnded(session.userId, id, now());
        await repos.audit.write({ actorUserId: session.userId, hotelId: session.hotelId === "" ? null : session.hotelId, action: "signin.deleted", entity: "user", entityId: session.userId, traceId: meta.traceId, detail: { records: 1 } }, now());
        return { id, message: "That sign-in has been removed from your history." };
      });
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
