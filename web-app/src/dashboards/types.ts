// Shared screen contract for every dashboard module (owned by the Lead; module agents never edit this).
import type { ComponentType } from 'react';
import type { HmsUser } from '@shared/auth-pallav/types';

export type Params = Record<string, string>;

export interface ScreenProps {
  user: HmsUser;
  /** Current view params, e.g. { id: 'r-12' } for a detail view. */
  params: Params;
  /** Open another view (nav id from ui-shared/dashboards/nav.ts, or a module's own detail id like "hotel.fo.reservation"). */
  navigate: (viewId: string, params?: Params) => void;
  /** Go back to the previous view (browser-style back inside the dashboard). */
  back: () => void;
  /** Ends the session and returns to the sign-in page (the same action as the user menu's "Sign out"). */
  signOut: () => void;
  /** Platform console (mock): opens a hotel's own dashboard for this session, with an "Exit" banner. Only switches dashboards: the audited call is the platform API's. */
  enterHotel: (hotelId: string, reason?: string, expiresAt?: string, access?: 'view' | 'full') => void;
  /** Leaves the hotel entered with `enterHotel` and returns to the platform console. */
  exitHotel: () => void;
}

/** Each module group exports this from groups/<group>/index. */
export type ScreenMap = Partial<Record<string, ComponentType<ScreenProps>>>;
