import "server-only";
import { randomUUID } from "node:crypto";
import type { SupportRepo, SupportRequestRecord } from "../supportRequests";
import { RepoError } from "../types";

// The in-memory double of the support requests (repos/supportRequests.ts): a unique number; an answered request has a reply; the desk's open queue oldest first, the rest newest first.

export interface SupportData {
  supportRequests: SupportRequestRecord[];
}
export const emptySupportData = (): SupportData => ({ supportRequests: [] });

const copy = <T>(r: T): T => structuredClone(r);
const newest = (a: SupportRequestRecord, b: SupportRequestRecord) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);

export function bindSupport(data: SupportData): SupportRepo {
  const all = () => (data.supportRequests ??= []);
  return {
    async create(i) {
      if (all().some((s) => s.number === i.number)) throw new RepoError("unique", "support_requests_number_key");
      const row: SupportRequestRecord = { ...copy(i), id: randomUUID(), status: "open", reply: null, repliedAt: null, repliedBy: null, repliedByName: null };
      all().push(row);
      return copy(row);
    },
    async get(id) {
      const s = all().find((x) => x.id === id);
      return s ? copy(s) : null;
    },
    async forCustomer(customerId, limit) {
      return all().filter((s) => s.customerId === customerId).sort(newest).slice(0, limit).map(copy);
    },
    async openCount(customerId) {
      return all().filter((s) => s.customerId === customerId && s.status === "open").length;
    },
    async list(query) {
      const rows = all()
        .filter((s) => !query.status || s.status === query.status)
        .filter((s) => {
          const hay = [s.number, s.guestName, s.subject, s.message, s.billRef ?? "", s.orderRef ?? ""].join(" ").toLowerCase();
          return !query.words || query.words.every((w) => hay.includes(w.toLowerCase()));
        })
        .sort((a, b) => (query.status === "open" ? -newest(a, b) : newest(a, b)));
      return { rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map(copy), total: rows.length };
    },
    async respond(id, input) {
      const s = all().find((x) => x.id === id);
      if (!s) return null;
      if (input.status === "answered" && !(input.reply ?? "").trim()) throw new RepoError("check", "support_requests_answer_pair");
      Object.assign(s, { status: input.status, reply: input.reply, repliedAt: input.at, repliedBy: input.by.id, repliedByName: input.by.name.slice(0, 150) });
      return copy(s);
    },
  };
}
