import "server-only";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { RequestMeta } from "../../http/meta";
import { paiseToNumber } from "../../money/paise";
import type { PlanRateRecord } from "../../repos/admin";
import { istDate } from "../frontOffice/rules";
import { diffDetails } from "../cash/syslog";
import { Rules } from "../payrollCore/validate";
import { actorOf, logLine, notFound, type AdminDeps, type Who } from "./context";
import type { PlanRateBody } from "./schemas";
import { matchWords } from "../../validation/listQuery";

// Plan Rates (Pallav MealPlanRateController): what Pallav Food charges the hotel for one person's meals on each plan, per night, from a date. The
// plans themselves are the `hotel_plan` list in Master Data; a rate is dated and a new price is a new row from its date, so a bill already made
// keeps the price it was made with. Spec: docs/specs/admin.md §2.

const PART = "masters";
const PLAN_LIST = "hotel_plan";
const n = paiseToNumber;
const dmy = (d: string): string => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

interface PlanRateDto {
  id: string;
  plan: string;
  effectiveFrom: string;
  ratePaise: number;
  note: string;
  createdByName: string;
  createdAt: string;
}

export interface PlanRatesPanel {
  /** The active plans of the Plan list, in its order. */
  plans: { value: string; label: string }[];
  /** Every rate, newest date first, grouped by plan (the plan in lower case). */
  rates: Record<string, PlanRateDto[]>;
  today: string;
  /** Plan food the hotel owes Pallav Food for bills dated this month. */
  owedThisMonthPaise: number;
}

export function createPlanRateService(deps: AdminDeps) {
  const { unit, catalog, now } = deps;
  const who = async (session: VerifiedSession, meta: RequestMeta): Promise<Who> => ({ session, meta, actor: await actorOf(deps, session) });
  const held = (r: PlanRateRecord): Record<string, unknown> => ({ Plan: r.plan, "Rate per person": n(r.ratePaise) / 100, "Applies from": dmy(r.effectiveFrom), Note: r.note });
  const label = (r: Pick<PlanRateRecord, "plan" | "effectiveFrom">): string => `${r.plan} from ${dmy(r.effectiveFrom)}`;

  return {
    /** panelData (:26-34) */
    async panel(session: VerifiedSession, search?: string): Promise<PlanRatesPanel> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const set = await repos.optionSets.setByKey(PLAN_LIST);
        const plans = set ? (await repos.optionSets.items(set.id)).filter((i) => i.isActive).map((i) => ({ value: i.value, label: i.label })) : [];
        const rows = await repos.planRates.list();
        const names = await deps.people.get([...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))]);
        const rates: Record<string, PlanRateDto[]> = {};
        for (const r of matchWords(rows, search, (x) => [x.plan, x.effectiveFrom, x.note, Number(x.ratePaise) / 100, x.createdBy ? names.get(x.createdBy)?.name : "System"])) {
          (rates[r.plan.toLowerCase()] ??= []).push({ id: r.id, plan: r.plan, effectiveFrom: r.effectiveFrom, ratePaise: n(r.ratePaise), note: r.note ?? "", createdByName: r.createdBy ? (names.get(r.createdBy)?.name ?? "Removed user") : "System", createdAt: r.createdAt.toISOString() });
        }
        const today = istDate(now());
        const from = `${today.slice(0, 7)}-01`;
        const next = Number(today.slice(5, 7)) === 12 ? `${Number(today.slice(0, 4)) + 1}-01-01` : `${today.slice(0, 4)}-${String(Number(today.slice(5, 7)) + 1).padStart(2, "0")}-01`;
        return { plans, rates, today, owedThisMonthPaise: n(await repos.planRates.planFoodOwed(from, next)) };
      });
    },

    /** store (:36-63): one price per plan per date; a second one for the same date replaces it. */
    async save(session: VerifiedSession, input: PlanRateBody, meta: RequestMeta): Promise<{ rate: PlanRateDto; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const v = new Rules();
        const set = await repos.optionSets.setByKey(PLAN_LIST);
        const choices = set ? (await repos.optionSets.items(set.id)).filter((i) => i.isActive).map((i) => i.value) : [];
        const plan = v.max("plan", "plan", v.required("plan", "plan", input.plan), 100);
        if (plan !== null && !choices.includes(plan)) v.fail("plan", "The selected plan is invalid.");
        if (!Number.isInteger(input.ratePaise)) v.fail("ratePaise", "The rate per person field must be a number.");
        else if (input.ratePaise < 0) v.fail("ratePaise", "The rate per person field must be at least 0.");
        else if (input.ratePaise > 10_000_000) v.fail("ratePaise", "The rate per person field must not be greater than 100000.");
        const from = v.date("effectiveFrom", "effective from", v.required("effectiveFrom", "effective from", input.effectiveFrom));
        const note = v.text("note", "note", input.note, 255);
        v.done();
        const saved = await repos.planRates.upsert({ plan: plan!, effectiveFrom: from!, ratePaise: BigInt(input.ratePaise), note }, session.userId);
        const after = saved.record;
        const subject = { id: after.id, label: label(after) };
        if (saved.created) await repos.systemLogs.write(logLine(w, "masters", { action: "created", entity: "Plan rate", summary: `Added Plan rate: ${subject.label}`, subject, details: held(after) }));
        else {
          const changes = diffDetails({ rate_per_person: n(saved.before!.ratePaise) / 100, note: saved.before!.note }, { rate_per_person: n(after.ratePaise) / 100, note: after.note });
          await repos.systemLogs.write(logLine(w, "masters", { action: "updated", entity: "Plan rate", summary: `Changed Plan rate: ${subject.label} (${Object.keys(changes).join(", ") || "no change"})`, subject, details: changes }));
        }
        return { rate: { id: after.id, plan: after.plan, effectiveFrom: after.effectiveFrom, ratePaise: n(after.ratePaise), note: after.note ?? "", createdByName: w.actor?.name ?? "System", createdAt: after.createdAt.toISOString() }, message: `${after.plan} plan rate saved.` };
      });
    },

    /** destroy (:65-73): a bill already made keeps the amount it was saved with. */
    async remove(session: VerifiedSession, id: string, meta: RequestMeta): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, PART, "full");
      const w = await who(session, meta);
      return unit.run(session, async (repos) => {
        const r = await repos.planRates.get(id);
        if (!r) throw notFound();
        await repos.planRates.remove(id);
        await repos.systemLogs.write(logLine(w, "masters", { action: "deleted", entity: "Plan rate", summary: `Removed Plan rate: ${label(r)}`, subject: { id, label: label(r) }, details: held(r) }));
        return { id, message: "Rate removed. Bills already made keep the amount they were saved with." };
      });
    },
  };
}

export type PlanRateService = ReturnType<typeof createPlanRateService>;
