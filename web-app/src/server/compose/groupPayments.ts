import "server-only";
import { getDatabase } from "../../db";
import { AppError } from "../errors";
import { getConfig } from "../config/env";
import { pgAdminRepos } from "../repos/postgres/admin";
import { pgRazorpayDisputeRepo } from "../repos/postgres/razorpay";
import { createGroupPaymentsService, type GroupPaymentsService } from "../services/razorpay/groupPaymentsService";
import { getGroupConsole } from "./platform";

// The composition root of the Group Hotel Admin's payments page: the member hotels come from the group console (which proves they are the signed-in admin's group), each is read in a
// read-only transaction of its own. Needs the database.
let service: GroupPaymentsService | null = null;

function build(): GroupPaymentsService {
  // the group console answers first (403 for anyone who is not an active Group Hotel Admin); only a hotel that has to be read needs the database
  return createGroupPaymentsService({
    hotels: async (session) => (await getGroupConsole().myHotels(session, { page: 1, pageSize: 100 })).items.filter((h) => h.status === "active").map((h) => ({ id: h.id, name: h.name })),
    readHotel: (hotelId, work) => {
      if (!getConfig().DATABASE_URL) throw new AppError("CONFLICT", "The group payments page needs the database.");
      return getDatabase().withHotel({ hotelId, readOnly: true }, (tx) => work({ razorpay: pgAdminRepos(tx).razorpay, disputes: pgRazorpayDisputeRepo(tx) }));
    },
    now: () => new Date(),
  });
}

export const getGroupPayments = (): GroupPaymentsService => (service ??= build());

/** Replaces the service (start-up code and tests). */
export function configureGroupPayments(next: GroupPaymentsService | null): void {
  service = next;
}