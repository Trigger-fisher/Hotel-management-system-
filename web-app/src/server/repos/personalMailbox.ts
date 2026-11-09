import "server-only";
import type { ConversationsRepos } from "./conversations";

// A personal mailbox (platform 0178, 0179; MJ, 3 Nov 2026): every staff login's own mailbox on the platform's Amazon SES domain. Plain records, no SQL. The hub itself (list entries, threads,
// the whole email of each message, positions) is the SAME conversations repository as a hotel's and a group's, over the person's own rows; this file adds the one address row. Isolation is the
// database's job (row level security on login_id, set from the session only), and the in-memory double keeps one store per login.

export interface PersonalAddressRepo {
  /** The address recorded for this login, or null before the mailbox was first opened. */
  get(): Promise<string | null>;
  /** Records (or moves, when the username changed) the address of this login. False when another login already holds that address (a person since deleted): the address still works, it is just not recorded. */
  save(address: string): Promise<boolean>;
}

/** What one short unit of a personal mailbox hands the service: the hub repositories and the address. */
export interface PersonalMailboxRepos extends ConversationsRepos {
  address: PersonalAddressRepo;
}
