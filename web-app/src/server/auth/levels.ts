import "server-only";

/** MJ's four access levels, lowest first: view = View Only, create = View & Create, edit = View & Edit, full = Full Access. */
export const LEVELS = ["view", "create", "edit", "full"] as const;
export type Level = (typeof LEVELS)[number];

const RANK: Record<Level, number> = { view: 1, create: 2, edit: 3, full: 4 };

export const rankOf = (level: Level): number => RANK[level];
export const isLevel = (value: unknown): value is Level => typeof value === "string" && Object.hasOwn(RANK, value);

/** The lower of two levels. */
export const minLevel = (a: Level, b: Level): Level => (RANK[a] <= RANK[b] ? a : b);
/** The higher of two levels. */
export const maxLevel = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);
/** Does `have` reach `need`? */
export const reaches = (have: Level, need: Level): boolean => RANK[have] >= RANK[need];
