import "server-only";
import type { AdminPlatformRepos, AdminPlatformUnit, UiTheme } from "../adminPlatform";

// The in-memory double of the platform side of Admin (the person's own preferences). Every transaction runs one at a time and a failed one leaves
// nothing behind, like the unit of the other doubles.
interface AdminPlatformData {
  uiTheme: Map<string, UiTheme | null>;
  photo: Map<string, string>;
}

const emptyAdminPlatformData = (): AdminPlatformData => ({ uiTheme: new Map(), photo: new Map() });

function bindAdminPlatform(data: AdminPlatformData): AdminPlatformRepos {
  return {
    photo: {
      get: async (userId) => data.photo.get(userId) ?? null,
      set: async (userId, file) => {
        const before = data.photo.get(userId) ?? null;
        if (file === null) data.photo.delete(userId);
        else data.photo.set(userId, file);
        return before;
      },
    },
    preferences: {
      get: async (userId) => ({ uiTheme: data.uiTheme.get(userId) ?? null }),
      set: async (userId, patch) => {
        if (patch.uiTheme !== undefined) data.uiTheme.set(userId, patch.uiTheme);
        return { uiTheme: data.uiTheme.get(userId) ?? null };
      },
    },
  };
}

export function createMemoryAdminPlatform(): { unit: AdminPlatformUnit; data: AdminPlatformData } {
  const data = emptyAdminPlatformData();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    data,
    unit: {
      run: <T>(work: (repos: AdminPlatformRepos) => Promise<T>): Promise<T> => {
        const next = tail.then(async () => {
          const before = structuredClone(data.uiTheme);
          const photoBefore = structuredClone(data.photo);
          try {
            return await work(bindAdminPlatform(data));
          } catch (error) {
            data.uiTheme = before;
            data.photo = photoBefore;
            throw error;
          }
        });
        tail = next.catch(() => undefined);
        return next;
      },
    },
  };
}
