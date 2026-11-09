import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { createPgProfileReviewUnit } from "../repos/postgres/centralProfiles";
import { createProfileReviewService, type ProfileReviewService } from "../services/platform/profileReviewService";

// The composition root of the Super Admin's "Possible duplicates" (the one common guest and company profile, platform 0132): the review unit (central profiles + the console's
// accounts and audit log on one connection). Without a database there are no profiles to review: every call answers 503 with a sentence.
let service: ProfileReviewService | null = null;

export function getProfileReview(): ProfileReviewService {
  if (service) return service;
  if (!getConfig().DATABASE_URL) {
    const off = async (): Promise<never> => {
      throw new AppError("NETWORK_OFFLINE", "Possible duplicates needs the database.");
    };
    return { duplicates: off, merge: off, keepApart: off, undoKeepApart: off };
  }
  service = createProfileReviewService({ unit: createPgProfileReviewUnit(getDatabase().pool), now: () => new Date() });
  return service;
}

/** Replaces the service (tests). */
export function configureProfileReview(next: ProfileReviewService | null): void {
  service = next;
}
