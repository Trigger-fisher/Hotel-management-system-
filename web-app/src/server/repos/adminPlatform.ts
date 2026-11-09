import "server-only";

// The platform side of the business Admin: what belongs to a PERSON (not to one hotel). Slice 3: the person's own display preferences. The users,
// roles, grants and sign-in history are in repos/adminUsers.ts. Plain records, no SQL. The PostgreSQL implementation reads and writes the platform
// tables (`platform.users.ui_theme`); the in-memory double is repos/memory/adminPlatform.ts.

export type UiTheme = "light" | "dark";

interface PreferencesRepo {
  /** The person's choice, or null when they have not made one. */
  get(userId: string): Promise<{ uiTheme: UiTheme | null }>;
  set(userId: string, patch: { uiTheme?: UiTheme | null }): Promise<{ uiTheme: UiTheme | null }>;
}

/** The person's profile photo (platform.users.photo_file, migration 0131): only the stored file name; the picture is in the private profile-photo store. */
interface PhotoRepo {
  /** The stored name, or null when there is no photo (or the database does not have migration 0131 yet). */
  get(userId: string): Promise<string | null>;
  /** Sets (or clears, with null) the name and answers the name it replaced. A database without migration 0131 answers PROFILE_PHOTO_UPDATE_MISSING. */
  set(userId: string, file: string | null): Promise<string | null>;
}

export interface AdminPlatformRepos {
  preferences: PreferencesRepo;
  photo: PhotoRepo;
}

/** One transaction on the platform data. */
export interface AdminPlatformUnit {
  run<T>(work: (repos: AdminPlatformRepos) => Promise<T>): Promise<T>;
}
