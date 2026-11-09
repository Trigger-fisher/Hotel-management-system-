import "server-only";
import type { ConversationsRepo } from "../repos/conversations";
import type { Unit } from "../repos/types";
import type { ChangeWhat, ConvChange, LiveBox } from "./convLive";

// The one place every change of a hub is seen: its repository. A unit wrapped here notes which conversations a piece of work changed (new mail or a WhatsApp message taken
// in, a reply recorded, read or unread, assign, done, labels, star, snooze, notes, links) and publishes them AFTER the work returned, so a page that asks again finds the
// saved state. Work that failed publishes nothing.

type Note = (ids: readonly string[], what: ChangeWhat) => void;
type Session = Parameters<Unit<unknown>["run"]>[0];

/** The repository with every write noted (ids only). */
export function liveRepo(repo: ConversationsRepo, note: Note): ConversationsRepo {
  const flag =
    <A extends unknown[]>(fn: (...a: A) => Promise<boolean>, what: ChangeWhat, idOf: (...a: A) => string | null) =>
    async (...a: A): Promise<boolean> => {
      const done = await fn(...a);
      if (done) {
        const id = idOf(...a);
        note(id ? [id] : [], what);
      }
      return done;
    };
  return {
    ...repo,
    async ingest(entries, own, matcher, at) {
      const r = await repo.ingest(entries, own, matcher, at);
      if (r.added > 0) note(r.conversationIds, "message");
      return r;
    },
    async recordOutgoing(conversationId, message) {
      const r = await repo.recordOutgoing(conversationId, message);
      note([conversationId], "message");
      return r;
    },
    async addNote(conversationId, authorId, body, at) {
      const r = await repo.addNote(conversationId, authorId, body, at);
      note([conversationId], "meta");
      return r;
    },
    setAssignee: flag((id: string, userId: string | null, by: string, at: Date) => repo.setAssignee(id, userId, by, at), "meta", (id) => id),
    setStatus: flag((id: string, status: "open" | "done") => repo.setStatus(id, status), "meta", (id) => id),
    setBox: flag((id: string, box: Parameters<ConversationsRepo["setBox"]>[1]) => repo.setBox(id, box), "meta", (id) => id),
    setExtras: flag((id: string, patch: Parameters<ConversationsRepo["setExtras"]>[1]) => repo.setExtras(id, patch), "meta", (id) => id),
    markRead: flag((id: string) => repo.markRead(id), "read", (id) => id),
    markUnread: flag((id: string) => repo.markUnread(id), "read", (id) => id),
    removeNote: flag((conversationId: string, noteId: string) => repo.removeNote(conversationId, noteId), "meta", (id) => id),
    // a contact's link or mute changes every conversation of that person: the box is named, not the ids
    setMuted: flag((contactId: string, muted: boolean) => repo.setMuted(contactId, muted), "meta", () => null),
    setLink: flag((contactId: string, link: Parameters<ConversationsRepo["setLink"]>[1], by: string, at: Date) => repo.setLink(contactId, link, by, at), "meta", () => null),
    clearLink: flag((contactId: string) => repo.clearLink(contactId), "meta", () => null),
    async purge(before) {
      const n = await repo.purge(before);
      if (n > 0) note([], "meta");
      return n;
    },
  };
}

/** Collects the notes of one piece of work and hands them over once it returned. */
function collector(box: LiveBox | null): { note: Note; changes: () => ConvChange[] } {
  const out: ConvChange[] = [];
  return {
    note: (ids, what) => {
      if (box) out.push({ box, ids: [...ids], what });
    },
    changes: () => out,
  };
}

/** A hub's unit (a hotel's, a group's, a person's) whose work publishes its changes; `boxOf` names the box from the unit's session. */
export function liveUnit<R extends { conversations: ConversationsRepo }>(unit: Unit<R>, boxOf: (session: Session) => LiveBox | null, publish: (changes: ConvChange[]) => void): Unit<R> {
  return {
    ...unit,
    async run(session, work) {
      const c = collector(boxOf(session));
      const result = await unit.run(session, (repos) => work({ ...repos, conversations: liveRepo(repos.conversations, c.note) }));
      const changes = c.changes();
      if (changes.length > 0) publish(changes);
      return result;
    },
  };
}

/** The platform's hub: one box, a unit without a session. */
export function liveRunner<R extends { conversations: ConversationsRepo }, U extends { run<T>(work: (repos: R) => Promise<T>): Promise<T> }>(unit: U, box: LiveBox, publish: (changes: ConvChange[]) => void): U {
  return {
    ...unit,
    async run<T>(work: (repos: R) => Promise<T>): Promise<T> {
      const c = collector(box);
      const result = await unit.run((repos: R) => work({ ...repos, conversations: liveRepo(repos.conversations, c.note) }));
      const changes = c.changes();
      if (changes.length > 0) publish(changes);
      return result;
    },
  };
}
