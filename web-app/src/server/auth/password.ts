import "server-only";

// Password hashing: Argon2id only. The PasswordHasher is a port so the service never names the library; tests use the real one with cheap
// parameters. A wrong-username sign-in verifies against a dummy hash so it costs the same time as a wrong password.
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(encoded: string, password: string): Promise<boolean>;
  /** Spends the time a verify would, for an account that does not exist. */
  dummyVerify(password: string): Promise<void>;
}

interface Argon2Params {
  /** KiB */
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** OWASP's Argon2id minimum (19 MiB, 2 passes, 1 lane); raise it with the hardware, never lower it in production. */
const ARGON2_PRODUCTION: Argon2Params = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function createArgon2Hasher(params: Argon2Params = ARGON2_PRODUCTION): PasswordHasher {
  let dummy: Promise<string> | null = null;
  const lib = async () => (await import("argon2")).default;
  return {
    async hash(password) {
      const argon2 = await lib();
      return argon2.hash(password, { type: argon2.argon2id, ...params });
    },
    async verify(encoded, password) {
      const argon2 = await lib();
      try {
        return await argon2.verify(encoded, password);
      } catch {
        return false;
      }
    },
    async dummyVerify(password) {
      const argon2 = await lib();
      dummy ??= argon2.hash("not-a-real-password", { type: argon2.argon2id, ...params });
      try {
        await argon2.verify(await dummy, password);
      } catch {
        // only the time matters
      }
    },
  };
}
