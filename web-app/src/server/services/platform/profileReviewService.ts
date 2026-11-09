import "server-only";
import type { DuplicateGroup, DuplicatePage, KeepApartInput, MergeInput, MergeResult, ProfileKind, ReviewProfile } from "@shared/dashboards/profileReview";
import { profileReviewCopy } from "@shared/dashboards/profileReview";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { ProfileReviewUnit, ProfileSummary } from "../../repos/centralProfiles";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import { matchWords } from "../../validation/listQuery";
import { createGate, type PlatformMeta } from "./access";

// The Super Admin's "Possible duplicates" of the ONE common guest and company profile (platform 0132; docs/plans/CENTRAL-GUEST-COMPANY-PLAN-2026-10-18.md;
// contract ui-shared/dashboards/profileReview.ts). Nothing here ever merges on its own: the list is worked out when asked (live profiles sharing a mobile or an email; companies
// a GSTIN or an email), and every change is the Super Admin's decision, written to the audit log in the SAME transaction. A merge only re-points the hotels' links at the kept
// profile and keeps the others as history: no hotel schema is opened, so bills, stays and the hotels' own records cannot change. Two profiles that each have their own sign-in
// are two people: refused (409).

const MAX_MERGE = 10;
const REASON_MIN = 3;
const REASON_MAX = 300;

interface Deps {
  unit: ProfileReviewUnit;
  now: () => Date;
}

const iso = (d: Date): string => d.toISOString();
const view = (s: ProfileSummary): ReviewProfile => ({
  id: s.id, name: s.name, mobile: s.mobile, email: s.email, gstin: s.gstin, city: s.city, hasLogin: s.userId !== null, createdAt: iso(s.createdAt),
  hotels: s.hotels.map((h) => ({ hotelId: h.hotelId, hotelName: h.hotelName })),
});
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const kindOf = (v: unknown): ProfileKind => {
  if (v === "guest" || v === "company") return v;
  throw new AppError("VALIDATION_FAILED", "Choose guests or companies.", { fields: { kind: "Choose guests or companies." } });
};

export function createProfileReviewService(deps: Deps) {
  const { unit, now } = deps;
  // the gate's own refusals are audited in a unit of their own (the console part of the review unit)
  const consoleUnit: PlatformConsoleUnit = { run: (work) => unit.run((r) => work(r.console)) };
  const gate = createGate(consoleUnit, now);

  return {
    /** The groups of live profiles that share a value, oldest profile first; a group whose every pair is kept apart is left out. Super Admin only. */
    async duplicates(session: VerifiedSession, q: { kind: string; search?: string; page: number; pageSize: number }): Promise<DuplicatePage> {
      gate.superRead(session);
      const kind = kindOf(q.kind);
      const groups = await unit.run(async (r) => {
        await gate.actor(r.console, session);
        if (!(await r.central.ready())) return [] as DuplicateGroup[];
        const found = await r.central.review.duplicates(kind);
        const kept = new Set((await r.central.review.keptApart(kind)).map(([a, b]) => pairKey(a, b)));
        const ids = [...new Set(found.flatMap((g) => g.ids))];
        const byId = new Map((await r.central.review.summaries(kind, ids)).map((s) => [s.id, s]));
        const out: DuplicateGroup[] = [];
        for (const g of found) {
          const pairs: [string, string][] = [];
          let open = 0;
          for (let i = 0; i < g.ids.length; i += 1)
            for (let j = i + 1; j < g.ids.length; j += 1) {
              if (kept.has(pairKey(g.ids[i], g.ids[j]))) pairs.push(g.ids[i] < g.ids[j] ? [g.ids[i], g.ids[j]] : [g.ids[j], g.ids[i]]);
              else open += 1;
            }
          if (open === 0) continue;
          const profiles = g.ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => s !== undefined).map(view);
          out.push({ key: `${kind}:${g.by}:${g.value}`, by: g.by, value: g.value, profiles, keptApart: pairs });
        }
        return out;
      });
      const words = (q.search ?? "").trim();
      const matched = words === "" ? groups : matchWords(groups, words, (g) => [g.value, ...g.profiles.flatMap((p) => [p.name, p.email ?? "", p.mobile ?? "", p.gstin ?? "", p.city ?? "", ...p.hotels.map((h) => h.hotelName)])]);
      const start = (q.page - 1) * q.pageSize;
      return { items: matched.slice(start, start + q.pageSize), total: matched.length, page: q.page, pageSize: q.pageSize };
    },

    /** Merges 1 to 10 profiles into the kept one, with a written reason. One transaction: the re-links, the history marks and the audit row. */
    async merge(session: VerifiedSession, input: MergeInput, meta: PlatformMeta): Promise<MergeResult> {
      const kind = kindOf(input.kind);
      const reason = (input.reason ?? "").trim();
      const goneIds = [...new Set(input.mergeIds ?? [])];
      const fields: Record<string, string> = {};
      if (reason.length < REASON_MIN || reason.length > REASON_MAX) fields.reason = `Write why these are the same (${REASON_MIN} to ${REASON_MAX} characters).`;
      if (goneIds.length < 1 || goneIds.length > MAX_MERGE) fields.mergeIds = `Choose 1 to ${MAX_MERGE} profiles to merge into the one you keep.`;
      else if (goneIds.includes(input.keepId)) fields.mergeIds = "The profile you keep cannot also be merged.";
      if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
      await gate.superWrite(session, meta, { action: "profile_merged", entity: "platform", entityId: input.keepId, reason });
      return unit.run(async (r) => {
        const actor = await gate.actor(r.console, session);
        if (!(await r.central.ready())) throw new AppError("NOT_FOUND");
        const all = await r.central.review.summaries(kind, [input.keepId, ...goneIds]);
        const keep = all.find((s) => s.id === input.keepId && s.mergedInto === null);
        const gone = goneIds.map((id) => all.find((s) => s.id === id && s.mergedInto === null));
        if (!keep || gone.some((g) => !g)) throw new AppError("NOT_FOUND");
        if ([keep, ...gone].filter((s) => s?.userId).length > 1) throw new AppError("CONFLICT", profileReviewCopy.twoLogins);
        const at = now();
        let relinked = 0;
        for (const g of gone as ProfileSummary[]) relinked += (await r.central.review.merge(kind, keep.id, g.id, actor.userId, at)).relinked;
        await gate.audit(r.console, actor, meta, {
          action: "profile_merged",
          entity: "platform",
          entityId: keep.id,
          targetLabel: `${kind === "guest" ? "Guest" : "Company"} profile: ${keep.name}`,
          reason,
          before: { kind, kept: keep.id, merged: (gone as ProfileSummary[]).map((g) => ({ id: g.id, name: g.name, hotels: g.hotels.length, login: g.userId !== null })) },
          after: { kind, kept: keep.id, relinked },
        });
        const [kept] = await r.central.review.summaries(kind, [keep.id]);
        return { kept: view(kept), merged: gone.length, relinked };
      });
    },

    /** Marks a pair "not the same" (it stops showing); answers whether it is new. Audited. */
    async keepApart(session: VerifiedSession, input: KeepApartInput, meta: PlatformMeta): Promise<{ kept: boolean }> {
      const kind = kindOf(input.kind);
      if (!input.leftId || !input.rightId || input.leftId === input.rightId) throw new AppError("VALIDATION_FAILED", "Choose two different profiles.", { fields: { rightId: "Choose two different profiles." } });
      await gate.superWrite(session, meta, { action: "profile_kept_apart", entity: "platform", entityId: input.leftId });
      return unit.run(async (r) => {
        const actor = await gate.actor(r.console, session);
        const found = await r.central.review.summaries(kind, [input.leftId, input.rightId]);
        if (found.length !== 2) throw new AppError("NOT_FOUND");
        const kept = await r.central.review.keepApart(kind, input.leftId, input.rightId, actor.userId, now());
        if (kept) await gate.audit(r.console, actor, meta, { action: "profile_kept_apart", entity: "platform", entityId: input.leftId, targetLabel: `${found[0].name} / ${found[1].name}`, after: { kind, pair: [input.leftId, input.rightId] } });
        return { kept };
      });
    },

    /** Takes a "not the same" back: the pair shows again if it still shares a value. Audited. */
    async undoKeepApart(session: VerifiedSession, input: KeepApartInput, meta: PlatformMeta): Promise<{ undone: boolean }> {
      const kind = kindOf(input.kind);
      await gate.superWrite(session, meta, { action: "profile_kept_apart_undone", entity: "platform", entityId: input.leftId });
      return unit.run(async (r) => {
        const actor = await gate.actor(r.console, session);
        const undone = await r.central.review.undoKeepApart(kind, input.leftId, input.rightId);
        if (undone) await gate.audit(r.console, actor, meta, { action: "profile_kept_apart_undone", entity: "platform", entityId: input.leftId, after: { kind, pair: [input.leftId, input.rightId] } });
        return { undone };
      });
    },
  };
}

export type ProfileReviewService = ReturnType<typeof createProfileReviewService>;
