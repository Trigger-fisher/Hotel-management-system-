import "server-only";
// What the cash services need from OUTSIDE the hotel's own schema: the platform's people. (Everything inside the hotel's schema comes
// through the repositories of the unit.)
export interface Person {
  id: string;
  /** Display name; Pallav shows a closed account's name followed by " (deleted)" (Models/User.php displayName). */
  name: string;
  /** The person's permission role in this hotel (roles.key / roles.level). */
  roleKey: string;
  roleLevel: number;
  deleted: boolean;
}

export interface PeopleDirectory {
  get(ids: readonly string[]): Promise<Map<string, Person>>;
}

export const displayName = (person: Person): string => (person.deleted ? `${person.name} (deleted)` : person.name);

/** The platform audit trail (force.override and friends: Pallav UserAuditLog::record). */
export interface PlatformAudit {
  record(event: { action: string; userId: string; hotelId: string; details: Record<string, unknown> }): Promise<void>;
}
