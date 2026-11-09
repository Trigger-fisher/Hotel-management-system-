import "server-only";
import type { VerifiedSession } from "../../auth/session";
import type { Unit } from "../types";
import { labelVisitor } from "../visitLabel";

/**
 * The in-memory test double. One data object PER HOTEL ID (hotel isolation is structural: a unit for hotel A can only reach A's
 * data), one unit at a time per hotel (the advisory lock's effect), and a rollback of everything the unit did when it throws
 * (the transaction's effect). It honours the same rules as the migrations: entry numbers, soft delete, version checks, uniqueness.
 */
export class MemoryStore<Data> {
  private readonly hotels = new Map<string, Data>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly emptyData: () => Data) {}

  /** The hotel's data (created empty on first use). For tests that need to look inside. */
  dataFor(hotelId: string): Data {
    let data = this.hotels.get(hotelId);
    if (!data) {
      data = this.emptyData();
      this.hotels.set(hotelId, data);
    }
    return data;
  }

  /** Runs `work` alone on this hotel; restores the hotel's data if it throws. */
  async exclusive<T>(hotelId: string, work: (data: Data) => Promise<T>): Promise<T> {
    const previous = this.queues.get(hotelId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const data = this.dataFor(hotelId);
      const before = structuredClone(data);
      try {
        return await work(data);
      } catch (error) {
        this.hotels.set(hotelId, before);
        throw error;
      }
    });
    this.queues.set(hotelId, run);
    return run;
  }
}

/** A Unit over a MemoryStore: `bind` makes the repos for one hotel's data. */
export function createMemoryUnit<Data, Repos>(store: MemoryStore<Data>, bind: (data: Data) => Repos): Unit<Repos> {
  return {
    run: <T>(session: Pick<VerifiedSession, "hotelId" | "userId" | "visit">, work: (repos: Repos) => Promise<T>): Promise<T> =>
      store.exclusive(session.hotelId, (data) => work(labelVisitor(bind(data), session.visit))),
  };
}
