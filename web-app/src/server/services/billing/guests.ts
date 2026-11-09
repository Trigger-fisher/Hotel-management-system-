import "server-only";
import type { BillGuests } from "../../repos/billing";

// Who stayed, as every bill shows it (decision 52): adults, children and the names kept. A bill that came from a stay (check-out) knows its stay's counts and
// names (the main guest, then the room's other guests); a hand-made Bill Master bill knows only its "persons" figure and the guest it names.
export type BillPersons = BillGuests;

export function personsOf(stay: BillGuests | undefined, bill: { persons: number | null; guestName: string }): BillPersons {
  if (stay) return stay;
  // a bill imported from Pallav may have no guest name (the column is nullable): that is "no name", not a crash that takes the whole portal page down
  const name = (bill.guestName ?? "").trim();
  return { adults: bill.persons ?? 1, children: 0, names: name === "" ? [] : [name] };
}
