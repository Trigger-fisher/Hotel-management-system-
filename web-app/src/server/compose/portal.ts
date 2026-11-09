import "server-only";
import { getDatabase } from "../../db";
import { createArgon2Hasher } from "../auth/password";
import { getConfig } from "../config/env";
import { getHashKey } from "../crypto";
import { createMemoryAuth } from "../repos/memory/auth";
import { createMemoryPortalHotel } from "../repos/memory/portal";
import { createPgPeopleDirectory } from "../repos/postgres/people";
import { createPgPortalUnit } from "../repos/postgres/portal";
import type { PortalRepos } from "../repos/portal";
import type { Unit } from "../repos/types";
import type { ProfileCredentials } from "../services/auth/credentialPort";
import { createCredentialService } from "../services/auth/credentialService";
import type { PeopleDirectory } from "../services/cash/ports";
import { createCorporateService, type CorporateService } from "../services/corporate/corporateService";
import { createGuestService, type GuestService } from "../services/guest/guestService";
import type { Memberships } from "../services/portal/multiHotel";
import type { CentralProfilesUnit } from "../repos/centralProfiles";
import { createPgCentralProfilesUnit } from "../repos/postgres/centralProfiles";
import { getAdminProfile } from "./admin";
import { getPlatformUnit } from "./auth";
import { getMailQueue } from "./mailQueue";
import { noGuestAccounts } from "./companies";

// The composition root of the guest and company portals: ONE hotel unit over the front office, companies (with billing), the website rooms and the
// portals' own reads (PostgreSQL when DATABASE_URL is set, the in-memory double otherwise: nobody can sign in then), the credential side for the
// guest's password change, the staff directory for who made a booking, and the GuestAccounts port for the last sign-in (a stub until it is built).

interface PortalServices {
  guest: GuestService;
  corporate: CorporateService;
}
let services: PortalServices | null = null;

function build(): PortalServices {
  const config = getConfig();
  const now = (): Date => new Date();
  let unit: Unit<PortalRepos>;
  let people: PeopleDirectory;
  let credentials: Pick<ProfileCredentials, "changeMyPassword">;
  if (config.DATABASE_URL && config.HMS_HASH_KEY) {
    const { withHotel, pool } = getDatabase();
    unit = createPgPortalUnit(withHotel);
    people = createPgPeopleDirectory(pool);
    credentials = createCredentialService({ unit: getPlatformUnit(), hasher: createArgon2Hasher(), now });
  } else {
    unit = createMemoryPortalHotel().unit;
    people = { get: async () => new Map() };
    credentials = createCredentialService({ unit: createMemoryAuth().unit, hasher: createArgon2Hasher(), now });
  }
  // decision 48: the hotels a portal login is linked to (PostgreSQL only; without a database the session's own hotel is the only one)
  const memberships: Memberships | undefined = config.DATABASE_URL && config.HMS_HASH_KEY ? { list: (userId, kind) => getPlatformUnit().run((r) => r.access.portalHotels(userId, kind)) } : undefined;
  // the ONE common guest and company profile (platform 0132; each service falls back to the hotel's record while the tables are not there) and the login's photo (0131)
  const central: CentralProfilesUnit | undefined = config.DATABASE_URL && config.HMS_HASH_KEY ? createPgCentralProfilesUnit(getDatabase().pool) : undefined;
  const photoName = (userId: string) => getAdminProfile().photoName(userId);
  return {
    guest: createGuestService({ unit, now, accounts: noGuestAccounts, credentials, memberships, mail: { queue: (m) => getMailQueue().queue(m) }, cursorSecret: config.HMS_HASH_KEY ? () => getHashKey() : undefined, central, photoName }),
    corporate: createCorporateService({ unit, now, people, memberships, cursorSecret: config.HMS_HASH_KEY ? () => getHashKey() : undefined, central, photoName }),
  };
}

export const getGuestPortal = (): GuestService => (services ??= build()).guest;
export const getCorporatePortal = (): CorporateService => (services ??= build()).corporate;

/** Replaces the portal services (start-up code and tests). */
export function configurePortal(next: PortalServices | null): void {
  services = next;
}
