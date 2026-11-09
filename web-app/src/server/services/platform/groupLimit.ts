import "server-only";
import type { PlatformConsoleRepos } from "../../repos/platformConsole";

// The most hotels a group may have (platform 0133 hotel_groups.max_hotels): ONE count for every way a hotel joins (a group's invitation, its resend, the onboarding form
// it leads to, and the platform's "Add hotel"), so they cannot disagree. Call it with the group row locked (repos.groups.get(id, { forUpdate: true })).

/** The group's limit, or null for none (also while 0133 is not applied). */
export async function groupLimitOf(repos: PlatformConsoleRepos, groupId: string): Promise<number | null> {
  return (await repos.groups.maxHotels([groupId])).get(groupId) ?? null;
}

/** Places taken: the group's waiting, active and suspended hotels, plus its open member_hotel invitations (not yet expired); `exceptId` is the invitation being used or resent. */
export async function placesTaken(repos: PlatformConsoleRepos, groupId: string, at: Date, exceptId: string | null): Promise<number> {
  const open = (await repos.invitations.list()).filter((i) => i.type === "member_hotel" && i.groupId === groupId && i.id !== exceptId && i.status !== "accepted" && i.status !== "revoked" && i.status !== "expired" && i.expiresAt.getTime() > at.getTime()).length;
  return (await repos.groups.countTowardLimit(groupId)) + open;
}
