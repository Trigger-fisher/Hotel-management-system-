import "server-only";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import type { OptionItemRecord, OptionSetRecord } from "../../repos/admin";
import type { AdminUnitRepos } from "./context";
import { Rules } from "../payrollCore/validate";
import { businessNamesOf, conflict, notFound, refuse, type AdminDeps } from "./context";
import { CATALOGS, fold, GROUPS, naturalCompare, NAME_ONLY, placementOf, scopeBusiness, scopeOf, siblingFor, twinKeyOf, type Business, type Scope } from "./masterRules";
import type { OptionBody } from "./schemas";
import { matchWords } from "../../validation/listQuery";

// Master Data (Pallav MasterDataController): the lists every form offers. Only people with the masters module edit them; everyone else picks from
// what is here. A list that exists once per business (Revenue depositors, Expense receivers) opens on "Both businesses": what is added there is added
// to both, an entry counts as shared when both have one by the same name, and narrowing to one business edits that business only.
// The expense catalogues (categories and priced items) are a separate screen. Spec: docs/specs/admin.md §3.

const PART = "masters";

interface OptionRowDto {
  id: string;
  label: string;
  value: string;
  color: string | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  /** The other business has an entry by the same name too. */
  shared: boolean;
}

export interface RailEntry {
  key: string;
  name: string;
  icon: string;
  hint: string;
  count: number | null;
  grouped: boolean;
}

interface MasterListDto {
  set: { key: string; name: string; description: string | null; icon: string | null; input: string; isSystem: boolean; isNameOnly: boolean; isCatalog: boolean };
  /** Where the list sits when it exists once per business. */
  placement: { group: string; groupName: string; section: string; sectionLabel: string; business: Business; businessName: string } | null;
  /** The sections of its group (tabs), or empty when the group has one. */
  sections: { key: string; name: string; setKey: string; active: boolean }[];
  scope: Scope | null;
  rows: OptionRowDto[];
}

export function createMasterService(deps: AdminDeps) {
  const { unit, catalog, audit } = deps;
  const audited = (session: VerifiedSession, action: string, what: string): Promise<void> => audit.record({ action, userId: session.userId, hotelId: session.hotelId, details: { item: what } });

  async function setOr404(repos: AdminUnitRepos, key: string): Promise<OptionSetRecord> {
    const set = await repos.optionSets.setByKey(key);
    if (!set) throw notFound();
    return set;
  }

  /** The twin item on the other business's list, by value (BothBusinesses::twinItem). */
  async function twinOf(repos: AdminUnitRepos, set: OptionSetRecord, value: string): Promise<OptionItemRecord | null> {
    const p = placementOf(set.key);
    const twinKey = p ? twinKeyOf(p) : null;
    const twin = twinKey ? await repos.optionSets.setByKey(twinKey) : null;
    if (!twin) return null;
    return (await repos.optionSets.items(twin.id)).find((i) => fold(i.value) === fold(value)) ?? null;
  }

  const onBoth = (set: OptionSetRecord, scope: Scope): boolean => placementOf(set.key) !== null && scope === "both";

  /** "both businesses" or the one business a change reached. */
  function where(set: OptionSetRecord, both: boolean, names: Record<Business, string>): string {
    if (both) return "both businesses";
    const p = placementOf(set.key);
    return p ? `${GROUPS[p.group].sections[p.section].label} for ${names[p.business]}` : set.name;
  }

  /** itemRules (:262-310): a list of names keeps only the name; otherwise a blank value falls back to the label, and the duplicate check runs on what is stored. */
  async function validated(repos: AdminUnitRepos, set: OptionSetRecord, input: OptionBody, except?: string) {
    const v = new Rules();
    const label = v.max("label", "label", v.required("label", "label", input.label), 60);
    if (NAME_ONLY.has(set.key)) {
      const name = label === null ? null : label.trim();
      if (name !== null && (await repos.optionSets.valueTaken(set.id, name, except))) v.fail("label", "That name is already on this list.");
      v.done();
      return { label: name!, value: name!, color: null, isActive: true, isDefault: false };
    }
    const typed = Rules.clean(input.value);
    const value = typed ?? label;
    if (typed !== null) v.max("value", "value", typed, 60);
    if (value !== null && (await repos.optionSets.valueTaken(set.id, value.slice(0, 60), except))) v.fail("value", "The value has already been taken.");
    const color = v.max("color", "color", Rules.clean(input.color), 7);
    v.done();
    return { label: label!, value: (value as string).slice(0, 60), color, isActive: input.isActive, isDefault: input.isDefault };
  }

  return {
    /** The lists down the left: every list of a group collapses into one entry that opens on the group's first section for the hotel. */
    async rail(session: VerifiedSession): Promise<RailEntry[]> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const sets = await repos.optionSets.sets();
        const out: RailEntry[] = [];
        const seen = new Set<string>();
        for (const set of sets) {
          const p = placementOf(set.key);
          if (!p) {
            const count = (await repos.optionSets.items(set.id)).filter((i) => i.isActive).length;
            out.push({ key: set.key, name: set.name, icon: set.icon ?? "", hint: `${count} in use`, count, grouped: false });
            continue;
          }
          if (seen.has(p.group)) continue;
          seen.add(p.group);
          const def = GROUPS[p.group];
          const first = Object.values(def.sections)[0].sets.hotel;
          out.push({ key: sets.find((s) => s.key === first)?.key ?? set.key, name: def.name, icon: def.icon, hint: Object.values(def.sections).map((s) => s.label).join(" · "), count: null, grouped: true });
        }
        return out;
      });
    },

    /** index (:19-52) for one list: a grouped list reads the business the scope names, "both" keeps only the entries both businesses have. */
    async list(session: VerifiedSession, key: string, askedScope?: string, search?: string): Promise<MasterListDto> {
      requirePermission(session, catalog, PART, "view");
      return unit.run(session, async (repos) => {
        const asked = await setOr404(repos, key);
        const p = placementOf(asked.key);
        const scope: Scope | null = p ? scopeOf(askedScope) : null;
        const current = p && scope ? ((await repos.optionSets.setByKey(siblingFor(p, scopeBusiness(scope)) ?? "")) ?? asked) : asked;
        const cp = placementOf(current.key);
        const isCatalog = current.key in CATALOGS;
        let rows: OptionRowDto[] = [];
        if (!isCatalog) {
          const items = await repos.optionSets.items(current.id);
          const ordered = NAME_ONLY.has(current.key) ? [...items].sort((a, b) => naturalCompare(a.label, b.label)) : items;
          const twinKey = cp ? twinKeyOf(cp) : null;
          const twin = scope && twinKey ? await repos.optionSets.setByKey(twinKey) : null;
          const twinNames = new Set(twin ? (await repos.optionSets.items(twin.id)).map((i) => fold(i.value)) : []);
          rows = ordered
            .map((i) => ({ id: i.id, label: i.label, value: i.value, color: i.color, isActive: i.isActive, isDefault: i.isDefault, sortOrder: i.sortOrder, shared: scope !== null && twinNames.has(fold(i.value)) }))
            .filter((r) => !(scope === "both" && !r.shared));
          rows = matchWords(rows, search, (r) => [r.label, r.value]);
        }
        const sections = cp
          ? Object.entries(GROUPS[cp.group].sections).length < 2
            ? []
            : Object.entries(GROUPS[cp.group].sections).map(([sk, part]) => ({ key: sk, name: part.label, setKey: part.sets[cp.business], active: sk === cp.section }))
          : [];
        return {
          set: { key: current.key, name: current.name, description: current.description, icon: current.icon, input: current.input, isSystem: current.isSystem, isNameOnly: NAME_ONLY.has(current.key), isCatalog },
          placement: cp ? { group: cp.group, groupName: GROUPS[cp.group].name, section: cp.section, sectionLabel: GROUPS[cp.group].sections[cp.section].label, business: cp.business, businessName: (await businessNamesOf(repos))[cp.business] } : null,
          sections,
          scope,
          rows,
        };
      });
    },

    /** storeItem (:120-143) */
    async createItem(session: VerifiedSession, key: string, askedScope: string | undefined, input: OptionBody): Promise<{ item: OptionRowDto; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      return unit.run(session, async (repos) => {
        const set = await setOr404(repos, key);
        const data = await validated(repos, set, input);
        const item = await repos.optionSets.createItem(set.id, data);
        if (item.isDefault) await repos.optionSets.clearDefaultsExcept(set.id, item.id);
        const both = onBoth(set, scopeOf(askedScope));
        if (both) {
          const p = placementOf(set.key)!;
          const twin = await repos.optionSets.setByKey(twinKeyOf(p) ?? "");
          if (twin && !(await twinOf(repos, set, item.value))) await repos.optionSets.createItem(twin.id, { label: item.label, value: item.value, color: null, isActive: item.isActive, isDefault: false });
        }
        await audited(session, "master.item_created", `${set.name}: ${item.label}`);
        return { item: { id: item.id, label: item.label, value: item.value, color: item.color, isActive: item.isActive, isDefault: item.isDefault, sortOrder: item.sortOrder, shared: both }, message: `"${item.label}" added to ${where(set, both, await businessNamesOf(repos))}.` };
      });
    },

    /** updateItem (:145-162): the same name on the other business is kept in step. */
    async updateItem(session: VerifiedSession, id: string, askedScope: string | undefined, input: OptionBody): Promise<{ item: OptionRowDto; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      return unit.run(session, async (repos) => {
        const item = await repos.optionSets.item(id);
        if (!item) throw notFound();
        const set = (await repos.optionSets.sets()).find((s) => s.id === item.setId)!;
        const twin = onBoth(set, scopeOf(askedScope)) ? await twinOf(repos, set, item.value) : null;
        const data = await validated(repos, set, input, id);
        const saved = await repos.optionSets.updateItem(id, data);
        if (saved.isDefault) await repos.optionSets.clearDefaultsExcept(set.id, id);
        if (twin) await repos.optionSets.updateItem(twin.id, { label: saved.label, value: saved.value });
        await audited(session, "master.item_updated", `${set.name}: ${saved.label}`);
        return { item: { id, label: saved.label, value: saved.value, color: saved.color, isActive: saved.isActive, isDefault: saved.isDefault, sortOrder: saved.sortOrder, shared: twin !== null }, message: twin ? "Option updated for both businesses." : "Option updated." };
      });
    },

    /** toggleItem (:164-177): hidden from forms, but records that already use it keep it. */
    async toggleItem(session: VerifiedSession, id: string, askedScope: string | undefined): Promise<{ item: OptionRowDto; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      return unit.run(session, async (repos) => {
        const item = await repos.optionSets.item(id);
        if (!item) throw notFound();
        const set = (await repos.optionSets.sets()).find((s) => s.id === item.setId)!;
        const twin = onBoth(set, scopeOf(askedScope)) ? await twinOf(repos, set, item.value) : null;
        const saved = await repos.optionSets.updateItem(id, { isActive: !item.isActive });
        if (twin) await repos.optionSets.updateItem(twin.id, { isActive: saved.isActive });
        await audited(session, "master.item_updated", `${set.name}: ${saved.label}`);
        return { item: { id, label: saved.label, value: saved.value, color: saved.color, isActive: saved.isActive, isDefault: saved.isDefault, sortOrder: saved.sortOrder, shared: twin !== null }, message: saved.isActive ? `"${saved.label}" is offered on forms again.` : `"${saved.label}" is hidden from forms. Records that already use it keep it.` };
      });
    },

    /** moveItem (:179-193): swaps places with its neighbour; at an end nothing happens. */
    async moveItem(session: VerifiedSession, id: string, direction: "up" | "down"): Promise<{ id: string; moved: boolean }> {
      requirePermission(session, catalog, PART, "edit");
      return unit.run(session, async (repos) => {
        if (!(await repos.optionSets.item(id))) throw notFound();
        return { id, moved: await repos.optionSets.swap(id, direction) };
      });
    },

    /** destroyItem (:195-212) */
    async removeItem(session: VerifiedSession, id: string, askedScope: string | undefined): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, PART, "full");
      return unit.run(session, async (repos) => {
        const item = await repos.optionSets.item(id);
        if (!item) throw notFound();
        const set = (await repos.optionSets.sets()).find((s) => s.id === item.setId)!;
        const twin = onBoth(set, scopeOf(askedScope)) ? await twinOf(repos, set, item.value) : null;
        await repos.optionSets.removeItem(id);
        if (twin) await repos.optionSets.removeItem(twin.id);
        await audited(session, "master.item_deleted", `${set.name}: ${item.label}`);
        const p = placementOf(set.key);
        return { id, message: `"${item.label}" removed from ${twin ? "both businesses" : p ? (await businessNamesOf(repos))[p.business] : set.name}. Records that already use it are untouched.` };
      });
    },

    /** destroySet (:107-118): a list the app itself uses cannot be removed (its items can still change). */
    async removeSet(session: VerifiedSession, key: string): Promise<{ key: string; message: string }> {
      requirePermission(session, catalog, PART, "full");
      return unit.run(session, async (repos) => {
        const set = await setOr404(repos, key);
        if (set.isSystem) throw conflict("This list is used by the app itself and cannot be removed. You can still change what is in it.");
        await repos.optionSets.removeSet(set.id);
        await audited(session, "master.set_deleted", set.name);
        return { key, message: `List "${set.name}" removed.` };
      });
    },
  };
}

void refuse;
export type MasterService = ReturnType<typeof createMasterService>;
