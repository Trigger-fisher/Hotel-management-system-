import "server-only";
import type { Level } from "./levels";

/** One row of Pallav's permission list: a module ("revenue"), a part of a module ("revenue.hotel") or a one-off ability ("users.set-password"). */
export interface CatalogEntry {
  key: string;
  kind: "module" | "part" | "ability";
  /** The module a part belongs to; null for modules and abilities. */
  parent: string | null;
  /** The highest level it offers (generated from Pallav's actions; see db/scripts/generate-permission-catalog.ts). */
  offers: Level;
}

export interface Catalog {
  get(key: string): CatalogEntry | undefined;
  partsOf(moduleKey: string): readonly CatalogEntry[];
  readonly entries: readonly CatalogEntry[];
}

export function createCatalog(entries: readonly CatalogEntry[]): Catalog {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const parts = new Map<string, CatalogEntry[]>();
  for (const e of entries) if (e.parent) parts.set(e.parent, [...(parts.get(e.parent) ?? []), e]);
  return { entries, get: (key) => byKey.get(key), partsOf: (moduleKey) => parts.get(moduleKey) ?? [] };
}
