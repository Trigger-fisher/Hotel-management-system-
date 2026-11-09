import "server-only";
import { randomUUID } from "node:crypto";
import type { CampaignAudience, CampaignRecipient, CampaignRecord, CampaignStatus, RecipientState } from "./campaigns";

/** The approved message a campaign sends, as the campaign needs to know it. */
export interface CampaignTemplate {
  id: string;
  name: string;
  language: string;
  status: "draft" | "pending" | "approved" | "rejected" | "paused";
  category: "utility" | "authentication" | "marketing";
  /** How many blanks the message has. */
  blanks: number;
}

/** What the campaign runner and service need from one hotel's campaign tables (the unit binds it to the hotel). */
export interface CampaignStore {
  list(): Promise<CampaignRecord[]>;
  get(id: string): Promise<CampaignRecord | null>;
  create(input: { name: string; templateId: string; audience: CampaignAudience; variables: string[] }, by: string): Promise<CampaignRecord>;
  /** A draft only; null when it is not one (or does not exist). */
  update(id: string, input: { name: string; templateId: string; audience: CampaignAudience; variables: string[] }): Promise<CampaignRecord | null>;
  /** A draft, finished or cancelled campaign (its guests go with it). */
  remove(id: string): Promise<boolean>;
  template(id: string): Promise<CampaignTemplate | null>;
  /** How many guests the audience reaches now: agreed, with a mobile number, not opted out, and within the days when given. */
  audienceSize(audience: CampaignAudience): Promise<number>;
  /** Writes one queued row per guest of the audience (fixing it at this moment) and returns how many. */
  enroll(id: string, audience: CampaignAudience): Promise<number>;
  setStatus(id: string, from: readonly CampaignStatus[], to: CampaignStatus, reason: string | null, at: Date): Promise<CampaignRecord | null>;
  /** The next guests still queued, oldest first. */
  batch(id: string, size: number): Promise<CampaignRecipient[]>;
  /** Records what happened to one guest and moves the campaign's counters. */
  mark(campaignId: string, recipientId: string, state: Exclude<RecipientState, "queued">, reason: string | null, at: Date): Promise<void>;
  queued(id: string): Promise<number>;
}

/** The in-memory double (tests and the local demo): the same rules as the tables. `guests` is the hotel's guest list the audience is drawn from. */
export function createMemoryCampaignStore(guests: { name: string; digits: string; agreed: boolean; optedOut?: boolean; lastStayDaysAgo?: number | null }[] = [], templates: CampaignTemplate[] = [], now: () => Date = () => new Date()): CampaignStore & { campaigns: CampaignRecord[]; recipients: (CampaignRecipient & { campaignId: string; state: RecipientState; reason: string | null })[] } {
  const campaigns: CampaignRecord[] = [];
  const recipients: (CampaignRecipient & { campaignId: string; state: RecipientState; reason: string | null })[] = [];
  const inAudience = (a: CampaignAudience) => guests.filter((g) => g.agreed && !g.optedOut && g.digits.length >= 8 && (a.stayedWithinDays === undefined || (g.lastStayDaysAgo !== null && g.lastStayDaysAgo !== undefined && g.lastStayDaysAgo <= a.stayedWithinDays)));
  const copy = (c: CampaignRecord): CampaignRecord => ({ ...c, audience: { ...c.audience }, variables: [...c.variables] });
  const find = (id: string) => campaigns.find((c) => c.id === id);
  return {
    campaigns,
    recipients,
    async list() {
      return campaigns.map(copy).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async get(id) {
      const c = find(id);
      return c ? copy(c) : null;
    },
    async create(input, by) {
      const c: CampaignRecord = { id: randomUUID(), name: input.name, templateId: input.templateId, audience: input.audience, variables: input.variables, status: "draft", statusReason: null, recipientCount: 0, sent: 0, failed: 0, skipped: 0, createdBy: by, startedAt: null, finishedAt: null, createdAt: now() };
      campaigns.push(c);
      return copy(c);
    },
    async update(id, input) {
      const c = find(id);
      if (!c || c.status !== "draft") return null;
      Object.assign(c, input);
      return copy(c);
    },
    async remove(id) {
      const c = find(id);
      if (!c || !["draft", "done", "cancelled"].includes(c.status)) return false;
      campaigns.splice(campaigns.indexOf(c), 1);
      for (let i = recipients.length - 1; i >= 0; i--) if (recipients[i].campaignId === id) recipients.splice(i, 1);
      return true;
    },
    async template(id) {
      return templates.find((t) => t.id === id) ?? null;
    },
    async audienceSize(a) {
      return inAudience(a).length;
    },
    async enroll(id, a) {
      const c = find(id);
      if (!c) return 0;
      const rows = inAudience(a);
      for (const g of rows) recipients.push({ id: randomUUID(), campaignId: id, phoneDigits: g.digits, guestName: g.name, state: "queued", reason: null });
      c.recipientCount = rows.length;
      return rows.length;
    },
    async setStatus(id, from, to, reason, at) {
      const c = find(id);
      if (!c || !from.includes(c.status)) return null;
      c.status = to;
      c.statusReason = reason;
      if (to === "running" && c.startedAt === null) c.startedAt = at;
      if (to === "done" || to === "cancelled") c.finishedAt = at;
      return copy(c);
    },
    async batch(id, size) {
      return recipients.filter((r) => r.campaignId === id && r.state === "queued").slice(0, size).map((r) => ({ id: r.id, phoneDigits: r.phoneDigits, guestName: r.guestName }));
    },
    async mark(campaignId, recipientId, state, reason) {
      const r = recipients.find((x) => x.id === recipientId && x.campaignId === campaignId && x.state === "queued");
      const c = find(campaignId);
      if (!r || !c) return;
      r.state = state;
      r.reason = reason;
      if (state === "sent") c.sent += 1;
      else if (state === "failed") c.failed += 1;
      else c.skipped += 1;
    },
    async queued(id) {
      return recipients.filter((r) => r.campaignId === id && r.state === "queued").length;
    },
  };
}
