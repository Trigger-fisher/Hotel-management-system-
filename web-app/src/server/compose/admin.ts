import "server-only";
import { smtpSecretKeyOf } from "../mail/key";
import { createBackupService, type BackupService } from "../services/admin/backupService";
import { createRazorpayService, type RazorpayService } from "../services/admin/razorpayService";
import { createMenuService, type MenuService } from "../services/admin/menuService";
import { createRestaurantHoursService, type RestaurantHoursService } from "../services/admin/restaurantHoursService";
import { createCatalogService, type CatalogService } from "../services/admin/catalogService";
import { createMasterService, type MasterService } from "../services/admin/masterService";
import { createProfileService, type ProfileService } from "../services/admin/profileService";
import { createSearchService, type SearchService } from "../services/admin/searchService";
import type { AdminPlatformUnit } from "../repos/adminPlatform";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import type { MailQueue } from "../services/auth/mail";
import { getMailQueue } from "./mailQueue";
import { getLogger } from "../logger";
import { createMemoryAdminPlatform } from "../repos/memory/adminPlatform";
import { createPgAdminPlatformUnit } from "../repos/postgres/adminPlatform";
import { getProfilePhotoStore } from "./profilePhotos";
import { createPgAdminUsersUnit } from "../repos/postgres/adminUsers";
import { createPgPortalRecords } from "../repos/postgres/portalRecords";
import { createPlanRateService, type PlanRateService } from "../services/admin/planRateService";
import { createRecycleService, type RecycleService, type RecycleSource } from "../services/admin/recycleService";
import { createBooksService, type BooksService } from "../services/admin/booksService";
import { createPgAdminBooksUnit } from "../repos/postgres/adminBooks";
import type { AdminBooksUnit } from "../repos/adminBooks";
import { createMemoryAdminBooks } from "../repos/memory/adminBooks";
import { createAccountService, type AccountService } from "../services/admin/accountService";
import { createRoleService, type RoleService } from "../services/admin/roleService";
import { createUserService, type UserService } from "../services/admin/userService";
import type { AdminUsersUnit } from "../repos/adminUsers";
import { createMemoryAdminUsers } from "../repos/memory/adminUsers";
import { createMemoryAuth } from "../repos/memory/auth";
import { createArgon2Hasher } from "../auth/password";
import type { CredentialService } from "../services/auth/credentialPort";
import { createCredentialService } from "../services/auth/credentialService";
import { getPlatformUnit } from "./auth";
import { hotelIdentityPort } from "./hotelIdentity";
import { hotelMailboxRegistry } from "./conversations";
import { createImapClientFactory } from "../mail/imap";
import { platformMailIdentityOf } from "./mailIdentity";
import { createSettingsService, type SettingsService } from "../services/admin/settingsService";
import { createSettingsMapService, type SettingsMapService } from "../services/admin/settingsMapService";
import type { AdminDeps } from "../services/admin/context";
import { billingDefaults, getBillingAdvances, getBillingBills } from "./billing";
import { getCompanies } from "./companies";
import { getReports } from "./overview";
import { billingRecycleSources, cashRecycleSources, companyRecycleSources, payrollRecycleSources } from "./recycle";
import { cashDefaults, getCashExpenses, getCashRevenue } from "./cash";
import { getPayrollAdjustments, getPayrollEmployees, getPayrollMeals, getPayrollSeparations } from "./payrollCore";
import { getHandovers, handoverDefaults } from "./handover";
import { handoverRecycleSources } from "./handoverRecycle";

// The composition root of the business-side Admin: the SAME hotel unit as billing and the rest (plan rates are what a bill is priced from, the option
// lists feed every form, the settings print on a bill), Credentials are NOT here: Admin reaches them
// only through the CredentialService port (services/auth/credentialPort.ts), which Backend 1 implements.
function adminDefaults(): AdminDeps {
  const base = billingDefaults();
  return base as unknown as AdminDeps;
}

interface AdminServices {
  profile: ProfileService;
  search: SearchService;
  planRates: PlanRateService;
  masters: MasterService;
  catalog: CatalogService;
  backup: BackupService;
  razorpay: RazorpayService;
  menu: MenuService;
  restaurantHours: RestaurantHoursService;
  settings: SettingsService;
  settingsMap: SettingsMapService;
  users: UserService;
  roles: RoleService;
  account: AccountService;
  books: BooksService;
  recycle: RecycleService;
}

/** The people side of Admin: the users/roles/sign-in repositories and the credential port (Backend 1's CredentialService). */
interface AdminPeople {
  unit: AdminUsersUnit;
  credentials: CredentialService;
}
let services: AdminServices | null = null;
let platformUnit: AdminPlatformUnit | null = null;
/** The platform data of Admin: PostgreSQL when DATABASE_URL is set (`platform.users.ui_theme`), the in-memory double otherwise. */
const defaultPlatform = (): AdminPlatformUnit => (platformUnit ??= getConfig().DATABASE_URL ? createPgAdminPlatformUnit(getDatabase().pool) : createMemoryAdminPlatform().unit);

let people: AdminPeople | null = null;
/**
 * PostgreSQL: the users/roles/sign-ins repositories (repos/postgres/adminUsers.ts) and the credentials are real.
 * Without a database: the in-memory double over one shared auth store.
 */
function defaultPeople(): AdminPeople {
  if (people) return people;
  const config = getConfig();
  if (config.DATABASE_URL && config.HMS_HASH_KEY) {
    const unit: AdminUsersUnit = createPgAdminUsersUnit(getDatabase().pool);
    return (people = { unit, credentials: createCredentialService({ unit: getPlatformUnit(), hasher: createArgon2Hasher(), now: () => new Date() }) });
  }
  const auth = createMemoryAuth();
  return (people = { unit: createMemoryAdminUsers(auth).unit, credentials: createCredentialService({ unit: auth.unit, hasher: createArgon2Hasher(), now: () => new Date() }) });
}

/** The recycle bin's kinds that have an adapter so far (docs/specs/admin.md §9): bills, guest advances, companies, the six cash kinds and the five payroll kinds (shift handover comes with its module). */
function defaultRecycleSources(deps: AdminDeps): RecycleSource[] {
  const unit = deps.unit as never;
  return [
    ...billingRecycleSources({ unit, bills: getBillingBills, advances: getBillingAdvances }),
    ...companyRecycleSources({ unit, companies: getCompanies }),
    ...cashRecycleSources({ unit: cashDefaults().unit, revenue: getCashRevenue, expenses: getCashExpenses }),
    ...payrollRecycleSources({ unit, employees: getPayrollEmployees, adjustments: getPayrollAdjustments, separations: getPayrollSeparations, meals: getPayrollMeals }),
    ...handoverRecycleSources({ unit: handoverDefaults().unit, handovers: getHandovers }),
  ];
}

let booksUnit: AdminBooksUnit | null = null;
/**
 * The books: PostgreSQL (repos/postgres/adminBooks.ts, Worker A) when DATABASE_URL is set, the in-memory double otherwise.
 */
function defaultBooks(): AdminBooksUnit {
  if (booksUnit) return booksUnit;
  const config = getConfig();
  if (config.DATABASE_URL) return (booksUnit = createPgAdminBooksUnit(getDatabase().withHotel));
  return (booksUnit = createMemoryAdminBooks().unit);
}

export function buildAdminServices(deps: AdminDeps, platform: AdminPlatformUnit = defaultPlatform(), who: AdminPeople = defaultPeople(), books: AdminBooksUnit = defaultBooks(), sources: readonly RecycleSource[] = defaultRecycleSources(deps)): AdminServices {
  const p = { platform: who.unit, credentials: who.credentials, catalog: deps.catalog, now: deps.now, portalRecords: getConfig().DATABASE_URL ? createPgPortalRecords(getDatabase().withHotel) : undefined };
  const profile = createProfileService({
    platform,
    photos: getProfilePhotoStore,
    // the line on the person's own "recent changes" (same audit trail as the other profile changes)
    audit: (session, action, meta) => who.unit.run((r) => r.audit.write({ actorUserId: session.userId, hotelId: session.hotelId === "" ? null : session.hotelId, action, entity: "user", entityId: session.userId, traceId: meta.traceId, detail: null }, deps.now())),
  });
  return {
    profile,
    search: createSearchService({ unit: deps.unit, catalog: deps.catalog, now: deps.now }),
    planRates: createPlanRateService(deps), masters: createMasterService(deps), catalog: createCatalogService(deps), backup: createBackupService({ ...deps, publicUrl: getConfig().HMS_PUBLIC_URL ?? "http://localhost:3000" }), settings: createSettingsService({ ...deps, secretKey: deps.smtpSecretKey !== undefined ? deps.smtpSecretKey : smtpSecretKeyOf(getConfig()), lastMailFailure: getConfig().DATABASE_URL ? (hotelId) => getPlatformUnit().run((r) => r.outbox.lastFailure(hotelId)) : undefined, identity: getConfig().DATABASE_URL ? hotelIdentityPort() : undefined, platformAddressOf: getConfig().DATABASE_URL ? (hotelId) => platformMailIdentityOf(hotelId).then((i) => i.address) : undefined, mailboxRegistry: getConfig().DATABASE_URL ? hotelMailboxRegistry() : undefined, imap: createImapClientFactory() }),
    menu: createMenuService(deps),
    restaurantHours: createRestaurantHoursService(deps),
    // a payment link's email goes out through the hotel's own mail (the outbox), not from Razorpay; without a database (the in-memory build) Razorpay sends it
    razorpay: createRazorpayService({ ...deps, publicUrl: getConfig().HMS_PUBLIC_URL ?? "http://localhost:3000", ...(deps.razorpayFetch ? { fetch: deps.razorpayFetch } : {}), ...(deps.razorpayMail ? { mail: deps.razorpayMail } : getConfig().DATABASE_URL ? { mail: { queue: (m: Parameters<MailQueue["queue"]>[0]) => getMailQueue().queue(m) } } : {}) }),
    users: createUserService(p), roles: createRoleService(p), account: createAccountService({ ...p, photoName: (userId) => profile.photoName(userId) }),
    settingsMap: createSettingsMapService({
      // the shared hotel unit binds every hotel repository (repos/postgres/hotel.ts, the memory hotel), the rooms included
      unit: deps.unit as never,
      users: (session) => who.unit.run((repos) => repos.users.counts(session.hotelId, deps.now())).then((c) => c.active),
      site: (session) => getPlatformUnit().run((r) => r.sites.byHotel(session.hotelId)).then((site) => (site ? { live: site.live, domains: site.domains.length } : null)),
    }),
    books: createBooksService({ unit: books, people: deps.people, now: deps.now, openingCash: (session, day) => getReports().openingCash(session, day) }),
    recycle: createRecycleService({ unit: deps.unit, people: deps.people, now: deps.now, sources, logger: { warn: (message, fields) => getLogger().warn(message, fields) } }),
  };
}

const all = (): AdminServices => (services ??= buildAdminServices(adminDefaults()));
/** The hotel unit of Admin (the mail worker reads a hotel's Email settings through it). */
export const getAdminUnit = (): AdminDeps["unit"] => adminDefaults().unit;
export const getAdminSettingsMap = (): SettingsMapService => all().settingsMap;
export const getAdminPlanRates = (): PlanRateService => all().planRates;
export const getAdminMasters = (): MasterService => all().masters;
export const getAdminCatalog = (): CatalogService => all().catalog;
export const getAdminBackup = (): BackupService => all().backup;
export const getAdminRazorpay = (): RazorpayService => all().razorpay;
export const getAdminMenu = (): MenuService => all().menu;
export const getAdminRestaurantHours = (): RestaurantHoursService => all().restaurantHours;
export const getAdminProfile = (): ProfileService => all().profile;
export const getAdminSearch = (): SearchService => all().search;
export const getAdminUsers = (): UserService => all().users;
export const getAdminRoles = (): RoleService => all().roles;
export const getAdminAccount = (): AccountService => all().account;
export const getAdminBooks = (): BooksService => all().books;
export const getAdminRecycle = (): RecycleService => all().recycle;
export const getAdminSettings = (): SettingsService => all().settings;

/** Replaces the admin services (start-up code and tests). */
export function configureAdmin(next: AdminServices | null): void {
  services = next;
}
