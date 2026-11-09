// The guest's own account pages (guest portal round 3 d, rebuilt on main 18 Oct 2026; docs/BACKEND.md "Guest profile and sign-ins").
// PUT /guest/profile (ProfileInput, unchanged body; the mobile stays reception's) now changes the guest's record in EVERY linked hotel and answers the profile plus
// GuestProfileSaved; 20 changes an hour (429 with a sentence). GET /guest/sign-ins?page=&pageSize=10|25|50 -> GuestSignInList (the guest's own, newest first).

/** What PUT /guest/profile adds to the profile it answers. */
export interface GuestProfileSaved {
  /** How many linked hotels' records were changed. */
  updatedHotels: number;
  /** Linked hotels that could not be reached now: they keep the old details until the next save. */
  unavailable: { hotelId: string; hotelName: string }[];
}

export interface GuestSignIn {
  id: string;
  at: string;
  /** false = a failed attempt on this account. */
  ok: boolean;
  /** "Chrome on Android". */
  device: string;
  ip: string;
  /** The session has ended (signed out or expired). */
  ended: boolean;
}

export interface GuestSignInList {
  items: GuestSignIn[];
  total: number;
  page: number;
  pageSize: number;
  totals: { all: number; success: number; failed: number };
}

export type GuestAccountApi = ReturnType<typeof import('./guestAccount.mock').createGuestAccountMock>;
