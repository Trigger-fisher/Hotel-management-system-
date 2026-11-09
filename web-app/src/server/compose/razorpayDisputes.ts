import "server-only";
import { getDatabase } from "../../db";
import { AppError } from "../errors";
import { getConfig } from "../config/env";
import { createPgRazorpayUnit } from "../repos/postgres/razorpay";
import { createRazorpayDisputeService, type RazorpayDisputeService } from "../services/razorpay/disputeService";
import type { Memberships } from "../services/portal/multiHotel";
import { getPlatformUnit } from "./auth";
import { billingDefaults } from "./billing";
import { getMailQueue } from "./mailQueue";

// The composition root of problems with online payments (guest and company portals, and the hotel's staff on the Razorpay screen): the Razorpay hotel unit and the people directory.
// It needs the database: the guest's "own payments only" is decided by row-level security there.
let service: RazorpayDisputeService | null = null;

function build(): RazorpayDisputeService {
  const config = getConfig();
  if (!config.DATABASE_URL) throw new AppError("CONFLICT", "Online payment problems need the database.");
  const { people, now, catalog } = billingDefaults();
  const memberships: Memberships | undefined = config.HMS_HASH_KEY ? { list: (userId, kind) => getPlatformUnit().run((r) => r.access.portalHotels(userId, kind)) } : undefined;
  return createRazorpayDisputeService({ unit: createPgRazorpayUnit(getDatabase().withHotel), people, now, catalog, memberships, mail: { queue: (m) => getMailQueue().queue(m) } });
}

export const getRazorpayDisputes = (): RazorpayDisputeService => (service ??= build());

/** Replaces the service (start-up code and tests). */
export function configureRazorpayDisputes(next: RazorpayDisputeService | null): void {
  service = next;
}
