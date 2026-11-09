import "server-only";
import { requirePermission } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import type { CatalogCategoryRecord } from "../../repos/admin";
import { RepoError } from "../../repos/types";
import type { AdminUnitRepos } from "./context";
import { businessNamesOf, notFound, type AdminDeps } from "./context";
import { BUSINESS_NAMES, CATALOGS, fold, scopeOf, type Business, type Scope } from "./masterRules";
import { matchWords, searchWords } from "../../validation/listQuery";

// The expense catalogue (Pallav ExpenseCatalogController, masters/_catalog): per business, categories (a name) with priced items under each. What a
// Miscellaneous expense picks from. Same module permission as Master Data (view / edit / full). With scope "both" a change is mirrored by name onto the
// other business: a category is shared when the other business has one by the same name, an item when that category has one by the same name. Removing
// is final (hard delete); expenses already recorded keep what they were saved with. Spec: docs/specs/admin.md §3, ui-shared/dashboards/admin.ts.

const PART = "masters";
const MAX_NAME = 80;
/** 9,999,999.99 rupees in paise. */
const MAX_PRICE_PAISE = 999_999_999;

interface CatalogItemDto { id: string; name: string; pricePaise: number; shared: boolean }
interface CatalogCategoryDto { id: string; name: string; shared: boolean; items: CatalogItemDto[] }
interface ExpenseCatalogDto { setKey: string; business: Business; scope: Scope; categories: CatalogCategoryDto[] }

const required = "The name field is required.";
const tooLong = `The name field must not be greater than ${MAX_NAME} characters.`;
const bad = (field: string, message: string): AppError => new AppError("VALIDATION_FAILED", message, { fields: { [field]: message } });

export function createCatalogService(deps: AdminDeps) {
  const { unit, catalog, audit } = deps;
  const audited = (session: VerifiedSession, action: string, what: string): Promise<void> => audit.record({ action, userId: session.userId, hotelId: session.hotelId, details: { item: what } });
  const other = (b: Business): Business => (b === "hotel" ? "food" : "hotel");
  const where = (b: Business, both: boolean, names: Record<Business, string>): string => (both ? "both businesses" : names[b]);

  function nameOf(raw: string): string {
    const name = (raw ?? "").trim();
    if (name === "") throw bad("name", required);
    if (Array.from(name).length > MAX_NAME) throw bad("name", tooLong);
    return name;
  }

  async function twinOf(repos: AdminUnitRepos, c: CatalogCategoryRecord): Promise<CatalogCategoryRecord | null> {
    return (await repos.expenseCatalog.categories(other(c.business))).find((x) => fold(x.name) === fold(c.name)) ?? null;
  }

  /** The database's own refusal (a name clash that slipped past the check) in the screen's words. */
  function clash(e: unknown, message: string): never {
    if (e instanceof RepoError && e.kind === "unique") throw bad("name", message);
    throw e;
  }

  return {
    /** getExpenseCatalog: one business's categories with their items; scope "both" keeps only what both businesses have. */
    async get(session: VerifiedSession, setKey: string, askedScope?: string, search?: string): Promise<ExpenseCatalogDto> {
      requirePermission(session, catalog, PART, "view");
      const business = CATALOGS[setKey];
      if (!business) throw notFound();
      const scope = scopeOf(askedScope);
      return unit.run(session, async (repos) => {
        const mine = await repos.expenseCatalog.categories(business);
        const theirs = await repos.expenseCatalog.categories(other(business));
        const categories = mine
          .map((c) => {
            const twin = theirs.find((x) => fold(x.name) === fold(c.name));
            const items = c.items.map((i) => ({ id: i.id, name: i.name, pricePaise: Number(i.pricePaise), shared: twin !== undefined && twin.items.some((x) => fold(x.name) === fold(i.name)) }));
            return { id: c.id, name: c.name, shared: twin !== undefined, items: scope === "both" ? items.filter((i) => i.shared) : items };
          })
          .filter((c) => scope !== "both" || c.shared)
          .map((c) => {
            // a category whose own name matches keeps all its items; otherwise only the items that match, and the category goes if none do
            if (matchWords([c], search, (x) => [x.name]).length > 0) return c;
            return { ...c, items: matchWords(c.items, search, (i) => [i.name, i.pricePaise / 100]) };
          })
          .filter((c) => searchWords(search).length === 0 || c.items.length > 0 || matchWords([c], search, (x) => [x.name]).length > 0);
        return { setKey, business, scope, categories };
      });
    },

    /** saveCatalogCategory, new: the name is checked against the business's categories (case-insensitively). */
    async createCategory(session: VerifiedSession, setKey: string, askedScope: string | undefined, rawName: string): Promise<{ category: { id: string; name: string }; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const business = CATALOGS[setKey];
      if (!business) throw notFound();
      const name = nameOf(rawName);
      const both = scopeOf(askedScope) === "both";
      return unit.run(session, async (repos) => {
        const mine = await repos.expenseCatalog.categories(business);
        if (mine.some((c) => fold(c.name) === fold(name))) throw bad("name", "That category is already on this list.");
        const made = await repos.expenseCatalog.createCategory(business, name).catch((e: unknown) => clash(e, "That category is already on this list."));
        if (both && !(await repos.expenseCatalog.categories(other(business))).some((c) => fold(c.name) === fold(name))) await repos.expenseCatalog.createCategory(other(business), name);
        await audited(session, "master.catalog_category_created", `${BUSINESS_NAMES[business]}: ${name}`);
        return { category: { id: made.id, name: made.name }, message: `"${name}" added to ${where(business, both, await businessNamesOf(repos))}.` };
      });
    },

    /** saveCatalogCategory, existing: rename; with scope "both" the twin on the other business is renamed too. */
    async renameCategory(session: VerifiedSession, id: string, askedScope: string | undefined, rawName: string): Promise<{ category: { id: string; name: string }; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const name = nameOf(rawName);
      const both = scopeOf(askedScope) === "both";
      return unit.run(session, async (repos) => {
        const c = await repos.expenseCatalog.category(id);
        if (!c) throw notFound();
        if ((await repos.expenseCatalog.categories(c.business)).some((x) => x.id !== id && fold(x.name) === fold(name))) throw bad("name", "That category is already on this list.");
        const twin = both ? await twinOf(repos, c) : null;
        const saved = await repos.expenseCatalog.renameCategory(id, name).catch((e: unknown) => clash(e, "That category is already on this list."));
        if (!saved) throw notFound();
        if (twin) await repos.expenseCatalog.renameCategory(twin.id, name).catch((e: unknown) => clash(e, "That category is already on this list."));
        await audited(session, "master.catalog_category_renamed", `${BUSINESS_NAMES[c.business]}: ${c.name} → ${name}`);
        return { category: { id, name: saved.name }, message: twin ? "Category renamed in both businesses." : "Category renamed." };
      });
    },

    /** deleteCatalogCategory: gone for good with its items (and the twin's, with scope "both"). */
    async removeCategory(session: VerifiedSession, id: string, askedScope: string | undefined): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, PART, "full");
      const both = scopeOf(askedScope) === "both";
      return unit.run(session, async (repos) => {
        const c = await repos.expenseCatalog.category(id);
        if (!c) throw notFound();
        const twin = both ? await twinOf(repos, c) : null;
        await repos.expenseCatalog.removeCategory(id);
        if (twin) await repos.expenseCatalog.removeCategory(twin.id);
        await audited(session, "master.catalog_category_deleted", `${BUSINESS_NAMES[c.business]}: ${c.name}`);
        return { id, message: `"${c.name}" removed from ${where(c.business, both, await businessNamesOf(repos))}. Expenses already recorded keep what they were saved with.` };
      });
    },

    /** saveCatalogItem: new (id null) or existing; the price is whole paise from 0 to 9,999,999.99. */
    async saveItem(session: VerifiedSession, categoryId: string, itemId: string | null, askedScope: string | undefined, input: { name: string; pricePaise: number | null }): Promise<{ item: { id: string; name: string; pricePaise: number }; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const fields: Record<string, string> = {};
      const name = (input.name ?? "").trim();
      if (name === "") fields.name = required;
      else if (Array.from(name).length > MAX_NAME) fields.name = tooLong;
      const price = input.pricePaise;
      if (price === null || price === undefined || !Number.isInteger(price)) fields.price = "The price field is required.";
      else if (price < 0) fields.price = "The price field must be at least 0.";
      else if (price > MAX_PRICE_PAISE) fields.price = "The price field must not be greater than 9999999.99.";
      const both = scopeOf(askedScope) === "both";
      return unit.run(session, async (repos) => {
        const c = await repos.expenseCatalog.category(categoryId);
        if (!c) throw notFound();
        if (!fields.name && c.items.some((x) => x.id !== itemId && fold(x.name) === fold(name))) fields.name = "That item is already in this category.";
        if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", Object.values(fields)[0], { fields });
        const paise = BigInt(price as number);
        const twinCat = both ? await twinOf(repos, c) : null;
        if (itemId) {
          const existing = c.items.find((x) => x.id === itemId);
          if (!existing) throw notFound();
          const twinItem = twinCat?.items.find((x) => fold(x.name) === fold(existing.name));
          const saved = await repos.expenseCatalog.updateItem(itemId, { name, pricePaise: paise }).catch((e: unknown) => clash(e, "That item is already in this category."));
          if (!saved) throw notFound();
          if (twinItem) await repos.expenseCatalog.updateItem(twinItem.id, { name, pricePaise: paise }).catch((e: unknown) => clash(e, "That item is already in this category."));
          await audited(session, "master.catalog_item_updated", `${BUSINESS_NAMES[c.business]}: ${c.name} / ${name}`);
          return { item: { id: saved.id, name: saved.name, pricePaise: Number(saved.pricePaise) }, message: twinItem ? "Item updated in both businesses." : "Item updated." };
        }
        const made = await repos.expenseCatalog.createItem(categoryId, name, paise).catch((e: unknown) => clash(e, "That item is already in this category."));
        if (twinCat && !twinCat.items.some((x) => fold(x.name) === fold(name))) await repos.expenseCatalog.createItem(twinCat.id, name, paise);
        await audited(session, "master.catalog_item_created", `${BUSINESS_NAMES[c.business]}: ${c.name} / ${name}`);
        return { item: { id: made.id, name: made.name, pricePaise: Number(made.pricePaise) }, message: `"${name}" added to ${where(c.business, both, await businessNamesOf(repos))}.` };
      });
    },

    /** saveCatalogItem for an existing item: its category is the one it sits in. */
    async updateItem(session: VerifiedSession, id: string, askedScope: string | undefined, input: { name: string; pricePaise: number | null }): Promise<{ item: { id: string; name: string; pricePaise: number }; message: string }> {
      requirePermission(session, catalog, PART, "edit");
      const found = await unit.run(session, (repos) => repos.expenseCatalog.item(id));
      if (!found) throw notFound();
      return this.saveItem(session, found.category.id, id, askedScope, input);
    },

    /** deleteCatalogItem */
    async removeItem(session: VerifiedSession, id: string, askedScope: string | undefined): Promise<{ id: string; message: string }> {
      requirePermission(session, catalog, PART, "full");
      const both = scopeOf(askedScope) === "both";
      return unit.run(session, async (repos) => {
        const found = await repos.expenseCatalog.item(id);
        if (!found) throw notFound();
        const twinCat = both ? await twinOf(repos, found.category) : null;
        await repos.expenseCatalog.removeItem(id);
        const twinItem = twinCat?.items.find((x) => fold(x.name) === fold(found.item.name));
        if (twinItem) await repos.expenseCatalog.removeItem(twinItem.id);
        await audited(session, "master.catalog_item_deleted", `${BUSINESS_NAMES[found.category.business]}: ${found.category.name} / ${found.item.name}`);
        return { id, message: `"${found.item.name}" removed from ${where(found.category.business, both, await businessNamesOf(repos))}. Expenses already recorded keep it.` };
      });
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
