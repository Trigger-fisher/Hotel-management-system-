import "server-only";

// Which hotel migrations a schema still needs (Platform health). The SET of migration files this server has is compared with the SET of versions recorded in the schema's
// schema_migrations: a file with no row is pending, a row with no file is unknown (applied by a newer server, or a file that was removed). Gaps in the numbering (0038, 0040 never
// written) are not pending: only the files that exist count. Never "number of the last file minus the number of rows".
export interface MigrationState {
  /** Rows in schema_migrations. */
  applied: number;
  /** Files with no row, in file order. */
  pending: string[];
  /** Rows with no file, in version order. */
  unknown: string[];
}

export function compareMigrations(files: readonly string[], applied: readonly string[]): MigrationState {
  const have = new Set(applied);
  const known = new Set(files);
  return { applied: have.size, pending: files.filter((f) => !have.has(f)), unknown: [...have].filter((v) => !known.has(v)).sort() };
}