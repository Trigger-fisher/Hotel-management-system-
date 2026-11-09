'use client';

// "Enter hotel" for every Platform screen: write the audit entry first, then ask the shell to open that hotel's dashboard.
// The shell's own enterHotel only switches dashboards and must not write a second audit entry.
// asActor: who the mock platform API acts as (name AND role), for every Platform screen.
import type { DashError } from '@shared/dashboards/common';
import { groupConsoleUsers } from '@shared/dashboards/nav';
import type { PlatformActor } from '@shared/dashboards/platform';
import type { ScreenProps } from '../../types';
import { platformApi } from './api';

type EnterProps = ScreenProps & { enterHotel?: ScreenProps['enterHotel'] };

/**
 * The signed-in person as the platform API's actor: Super Admin, Group Hotel Admin (the Group console's mock logins) or Platform
 * Admin. setActor({ name }) alone resets the role to platform_admin (review L10), so every screen should call asActor instead.
 */
export function actorOf(user: ScreenProps['user']): PlatformActor {
  if (user.role === 'super_admin') return { name: user.displayName, role: 'super_admin' };
  if (user.role === 'group_hotel_admin' || (user.username && groupConsoleUsers.includes(user.username.toLowerCase()))) {
    return { name: user.displayName, role: 'group_admin', ...(user.group?.id ? { groupId: user.group.id } : {}) };
  }
  return { name: user.displayName, role: 'platform_admin' };
}

/** Sets the platform API's actor from the signed-in person (see actorOf). */
export function asActor(user: ScreenProps['user']): void {
  platformApi.setActor(actorOf(user));
}

/** reason (required, 5 to 500 characters): the written reason from the Enter hotel window, kept in the audit log. onError: the refusal, to show it. */
export async function enterHotelAudited(props: ScreenProps, hotelId: string, reason: string, onError?: (e: DashError) => void): Promise<boolean> {
  const shellEnter = (props as EnterProps).enterHotel;
  if (!shellEnter) return false;
  const r = await platformApi.enterHotel(hotelId, reason);
  if (!r.ok) {
    onError?.(r.error);
    return false;
  }
  // The real server's own end of the visit (expiresAt, ISO): the shell shows it and exits at that time (the mock has none: the shell's 60-minute clock).
  // `access` says what the visit allows: 'view' (read only) or 'full' (the hotel's screens save, within the server's deny list); absent = view.
  shellEnter(hotelId, reason, r.data.expiresAt, r.data.access);
  return true;
}
