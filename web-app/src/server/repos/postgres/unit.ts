import "server-only";
// A Unit (repos/types.ts) over the real database: every `run` is ONE withHotel transaction (BEGIN, SET LOCAL ROLE, search_path, the work, COMMIT),
// and the repositories it hands to the work are bound to that transaction. The hotel comes from the verified session, never from a request.
// A session inside an Enter-hotel visit (platform staff looking, BACKEND.md 14.7) gets a READ ONLY transaction: the database refuses a write even if the
// route wrapper's guard were bypassed.
import type { TxClient } from "../../../db/types";
import type { RunOptions, WithHotel } from "../../../db/withHotel";
import { AppError } from "../../errors";
import type { Unit } from "../types";
import { labelVisitor } from "../visitLabel";

export function createPgUnit<Repos>(withHotel: WithHotel, bind: (tx: TxClient, hotelId: string) => Repos, options: RunOptions = {}): Unit<Repos> {
  return {
    run: (session, work) => {
      // a Group Hotel Admin or platform staff outside a visit has no hotel: a hotel route answers a plain 403, never a database error
      if (session.hotelId === "") return Promise.reject(new AppError("FORBIDDEN", "This account is not inside a hotel. Open a hotel first, or use the console."));
      // a VIEW visit is read only in the database itself; a FULL visit (platform 0135) writes, within the wrapper's deny list, and its log rows name the visitor
      const readOnly = session.visit !== undefined && session.visit.access !== "full";
      return withHotel({ hotelId: session.hotelId, readOnly, scope: session.scope }, (tx) => work(labelVisitor(bind(tx, session.hotelId), session.visit)), options);
    },
  };
}
