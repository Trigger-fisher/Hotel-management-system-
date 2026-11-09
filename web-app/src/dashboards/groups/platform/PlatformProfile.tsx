'use client';

// platform.profile: My Profile of the Platform Admin (docs/plans/PLAN-PLATFORM-CONSOLE.md, page 7). The hotel dashboard's own My Profile
// screen (groups/admin/Profile.tsx: details, password, emailed code, sign-in history) runs unchanged here; nothing is copied.
// Mock: it reads the Administration mock's profile, like the hotel dashboard does, until the platform account has a /me route of its own.
import type { ScreenProps } from '../../types';
import { Profile } from '../admin/Profile';

export function PlatformProfile(props: ScreenProps) {
  return <Profile {...props} />;
}
