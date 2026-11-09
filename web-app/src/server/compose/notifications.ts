import "server-only";
import { getDatabase } from "../../db";
import { getConfig } from "../config/env";
import { createMemoryNotificationsHotel } from "../repos/memory/notifications";
import { createPgNotificationsUnit } from "../repos/postgres/notifications";
import type { NotificationsRepos } from "../repos/notifications";
import type { Unit } from "../repos/types";
import { createNotificationService, type NotificationService } from "../services/notifications/notificationService";
import { billingDefaults } from "./billing";
import { getMailQueue } from "./mailQueue";

// The composition root of the hotel's Notifications (Companies > Notifications): the companies' unit with the notifications repository on top (PostgreSQL when DATABASE_URL is
// set, the in-memory double otherwise), the people directory, the permission catalog, and the hotel mail queue for "also email" (kind `notification`, mail/routes.ts).
let service: NotificationService | null = null;

function build(): NotificationService {
  const { people, catalog, now } = billingDefaults();
  let unit: Unit<NotificationsRepos>;
  if (getConfig().DATABASE_URL) unit = createPgNotificationsUnit(getDatabase().withHotel);
  else unit = createMemoryNotificationsHotel().unit;
  return createNotificationService({ unit, people, catalog, now, mail: { queue: (m) => getMailQueue().queue(m) } });
}

export const getNotifications = (): NotificationService => (service ??= build());

/** Replaces the notifications service (start-up code and tests). */
export function configureNotifications(next: NotificationService | null): void {
  service = next;
}
