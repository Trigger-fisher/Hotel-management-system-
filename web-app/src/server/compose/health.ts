import "server-only";
import { getDatabase } from "../../db";
import { pingDatabase } from "../ops/lifecycle";

/** Does the configured database answer within the time? (readiness; the route never touches the database layer itself). */
export const databaseAnswers = (): Promise<boolean> => pingDatabase(getDatabase().pool);