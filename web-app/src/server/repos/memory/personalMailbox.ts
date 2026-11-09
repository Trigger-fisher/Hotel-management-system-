import "server-only";
// A personal mailbox in memory (the double of repos/postgres/personalMailbox.ts): ONE store per login, so a login's work can only reach its own data, as row level security makes
// the database do. The unit refuses a session whose hotelId is not its own login id, as the PostgreSQL unit does.
import { AppError } from "../../errors";
import type { ConversationsRepos } from "../conversations";
import type { PersonalAddressRepo, PersonalMailboxRepos } from "../personalMailbox";
import type { Unit } from "../types";
import { bindConversations, emptyConversationsData, type ConversationsData } from "./conversations";
import { MemoryStore } from "./store";

export interface PersonalData extends ConversationsData {
  address: string | null;
  logs: { action: string; summary: string; userId: string }[];
}

export const emptyPersonalData = (): PersonalData => ({ ...emptyConversationsData(), address: null, logs: [] });

const noLinks = { byEmail: async () => null, byPhone: async () => null, search: async () => [], details: async () => null, exists: async () => null };

/** Addresses already recorded for a login, shared by every store of one memory world: one address, one login (the database's UNIQUE). */
export function bindPersonalAddress(data: PersonalData, held: Map<string, string>, loginId: string): PersonalAddressRepo {
  return {
    async get() {
      return data.address;
    },
    async save(address) {
      const holder = held.get(address);
      if (holder !== undefined && holder !== loginId) return false;
      if (data.address !== null) held.delete(data.address);
      data.address = address;
      held.set(address, loginId);
      return true;
    },
  };
}

export function bindPersonalMailbox(data: PersonalData, held: Map<string, string>, loginId: string, name = "Me"): PersonalMailboxRepos {
  const hub: ConversationsRepos = {
    conversations: bindConversations(data),
    matcher: noLinks,
    // there is no mailbox to read: the settings of a hotel's own mail do not exist for a person
    adminSettings: { get: async () => [] },
    hotelProfile: { header: async () => ({ name }) },
    systemLogs: {
      write: async (e) => {
        data.logs.push({ action: e.action, summary: e.summary, userId: e.userId ?? "" });
      },
    },
  };
  return { ...hub, address: bindPersonalAddress(data, held, loginId) };
}

/** The personal mailboxes in memory: one store, one entry per login (tests look inside through `store.dataFor(loginId)`). */
export function createMemoryPersonalMailbox(): { store: MemoryStore<PersonalData>; unit: Unit<PersonalMailboxRepos>; logins: () => string[] } {
  const store = new MemoryStore<PersonalData>(emptyPersonalData);
  const seen = new Set<string>();
  const held = new Map<string, string>();
  return {
    store,
    logins: () => [...seen],
    unit: {
      run: async (session, work) => {
        if (session.userId === "" || session.hotelId !== session.userId) throw new AppError("FORBIDDEN");
        seen.add(session.userId);
        return store.exclusive(session.userId, (data) => work(bindPersonalMailbox(data, held, session.userId)));
      },
    },
  };
}
