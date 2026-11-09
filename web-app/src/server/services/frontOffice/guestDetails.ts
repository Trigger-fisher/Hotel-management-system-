import "server-only";
import type { StayGuestDetails, StayMember } from "../../repos/frontOffice";

// The main guest's further details at check-in, asked for the guest register (MJ: one entry per room, the main guest). Every field is
// optional: HMS never refuses a check-in for a missing one. Free text is kept as typed (trimmed); the date of birth
// is a real past date and the vehicle type one of the listed types.
export const VEHICLE_TYPES = ["Car", "Bike", "Bus", "Auto", "Other"] as const;

export interface GuestDetailsInput {
  dateOfBirth?: string;
  houseNo?: string;
  locality?: string;
  district?: string;
  zipCode?: string;
  state?: string;
  country?: string;
  phone?: string;
  comingFrom?: string;
  goingTo?: string;
  vehicleType?: string;
  vehicleRegistration?: string;
  /** The room's other guests (MJ: all members are saved). */
  members?: { fullName?: string; mobile?: string; idType?: string; idNumber?: string }[];
}

const LIMITS: Record<Exclude<keyof GuestDetailsInput, "members">, number> = {
  dateOfBirth: 10, houseNo: 60, locality: 120, district: 120, zipCode: 10, state: 80, country: 80, phone: 20, comingFrom: 120, goingTo: 120, vehicleType: 10, vehicleRegistration: 20,
};
const LABELS: Record<Exclude<keyof GuestDetailsInput, "members">, string> = {
  dateOfBirth: "Date of birth", houseNo: "House/flat no", locality: "Locality", district: "District", zipCode: "Zip code", state: "State", country: "Country", phone: "Phone",
  comingFrom: "Coming from", goingTo: "Going to", vehicleType: "Vehicle type", vehicleRegistration: "Vehicle registration",
};
const NO_CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The details to store (only the keys given; null when none), or the field errors. `today` is the IST calendar day; `guests` = adults + children (the
 * members are the others: at most guests - 1, never more than 19).
 */
export function guestDetailsOf(input: GuestDetailsInput, today: string, guests: number): { details: StayGuestDetails | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const out: StayGuestDetails = {};
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const value = (input[key] ?? "").trim();
    if (value === "") continue;
    if (value.length > LIMITS[key] || NO_CONTROL.test(value)) {
      errors[key] = `${LABELS[key]} must be at most ${LIMITS[key]} characters.`;
      continue;
    }
    if (key === "dateOfBirth") {
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      if (!valid) errors[key] = "Date of birth is not a valid date.";
      else if (value > today) errors[key] = "Date of birth cannot be in the future.";
      else if (value < "1900-01-01") errors[key] = "Date of birth is too far in the past.";
    } else if (key === "zipCode" && !/^[A-Za-z0-9 ]+$/.test(value)) errors[key] = "Zip code may hold letters, digits and spaces only.";
    else if (key === "phone" && !/^[0-9+\- ]+$/.test(value)) errors[key] = "Phone may hold digits, spaces, + and - only.";
    else if (key === "vehicleType" && !(VEHICLE_TYPES as readonly string[]).includes(value)) errors[key] = `Vehicle type must be one of ${VEHICLE_TYPES.join(", ")}.`;
    else if (key === "vehicleRegistration" && !/^[A-Za-z0-9 -]+$/.test(value)) errors[key] = "Vehicle registration may hold letters, digits, spaces and dashes only.";
    if (!errors[key]) out[key] = value;
  }
  const members = input.members ?? [];
  const most = Math.max(0, Math.min(19, guests - 1));
  if (members.length > most) errors.members = most === 0 ? "A room with one guest has no other guests to add." : `At most ${most} other guests for this room.`;
  else {
    const kept: StayMember[] = [];
    members.forEach((m, i) => {
      const fullName = (m.fullName ?? "").trim();
      const mobile = (m.mobile ?? "").trim();
      const idType = (m.idType ?? "").trim();
      const idNumber = (m.idNumber ?? "").trim();
      if (fullName === "") errors[`members.${i}.fullName`] = "Enter the guest's full name.";
      else if (fullName.length > 150 || NO_CONTROL.test(fullName)) errors[`members.${i}.fullName`] = "Full name must be at most 150 characters.";
      if (mobile !== "" && (mobile.length > 20 || !/^[0-9+\- ]+$/.test(mobile))) errors[`members.${i}.mobile`] = "Mobile may hold digits, spaces, + and - only (at most 20).";
      if (idType.length > 60 || NO_CONTROL.test(idType)) errors[`members.${i}.idType`] = "ID type must be at most 60 characters.";
      if (idNumber.length > 60 || NO_CONTROL.test(idNumber)) errors[`members.${i}.idNumber`] = "ID number must be at most 60 characters.";
      kept.push({ fullName, ...(mobile ? { mobile } : {}), ...(idType ? { idType } : {}), ...(idNumber ? { idNumber } : {}) });
    });
    if (kept.length > 0) out.members = kept;
  }
  return { details: Object.keys(out).length > 0 ? out : null, errors };
}
