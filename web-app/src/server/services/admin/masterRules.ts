import "server-only";
// The fixed knowledge of Master Data (Pallav Models/OptionSet): which lists hold only names, which are expense catalogues, and how the lists that exist
// once per business are grouped ("Revenue", "Expense") so the screen shows one entry for both. Spec: docs/specs/admin.md §3.

/** Lists of people. All that is kept for each is the name: no separate value, colour, default or hidden state, and they read alphabetically. */
export const NAME_ONLY = new Set(["revenue_depositor_hotel", "revenue_depositor_food", "cash_person_hotel", "cash_person_food"]);

/** The expense catalogues: categories and priced items rather than a flat list. One per business. */
export const CATALOGS: Record<string, Business> = { expense_catalog_hotel: "hotel", expense_catalog_food: "food" };

export type Business = "hotel" | "food";
export type Scope = "both" | Business;

export interface GroupDef {
  name: string;
  icon: string;
  sections: Record<string, { label: string; sets: Record<Business, string> }>;
}

export const GROUPS: Record<string, GroupDef> = {
  revenue: { name: "Revenue", icon: "bi-cash-coin", sections: { names: { label: "Depositor Names", sets: { hotel: "revenue_depositor_hotel", food: "revenue_depositor_food" } } } },
  expense: {
    name: "Expense",
    icon: "bi-basket",
    sections: {
      names: { label: "Receiver Names", sets: { hotel: "cash_person_hotel", food: "cash_person_food" } },
      misc: { label: "Miscellaneous", sets: { hotel: "expense_catalog_hotel", food: "expense_catalog_food" } },
    },
  },
};

/** Neutral labels for audit lines only; screens and messages use the hotel's own names (businessNamesOf in context.ts). */
export const BUSINESS_NAMES: Record<Business, string> = { hotel: "Hotel", food: "Food" };

export interface Placement {
  group: string;
  section: string;
  business: Business;
}

/** Where a list sits, or null when it stands alone. */
export function placementOf(key: string): Placement | null {
  for (const [group, def] of Object.entries(GROUPS)) {
    for (const [section, part] of Object.entries(def.sections)) {
      for (const business of ["hotel", "food"] as const) if (part.sets[business] === key) return { group, section, business };
    }
  }
  return null;
}

/** The key of the same section in a business. */
export const siblingFor = (p: Placement, business: Business): string | null => GROUPS[p.group].sections[p.section].sets[business] ?? null;
export const twinKeyOf = (p: Placement): string | null => siblingFor(p, p.business === "hotel" ? "food" : "hotel");

export const scopeOf = (asked: string | undefined | null): Scope => (asked === "hotel" || asked === "food" ? asked : "both");
/** The business whose rows a scope reads: "both" reads Hotel Pallav and keeps only what Pallav Food has too. */
export const scopeBusiness = (scope: Scope): Business => (scope === "both" ? "hotel" : scope);

/** BothBusinesses::fold */
export const fold = (name: string | null | undefined): string => (name ?? "").trim().toLowerCase();

/** PHP's SORT_NATURAL | case-insensitive on a label (digit runs compare as numbers). */
export const naturalCompare = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase(), undefined, { numeric: true });
