import "server-only";
import { CONFIRM_SHARED_FIELD, sharedFieldsText } from "@shared/dashboards/profileReview";
import { AppError } from "../../errors";
import type { CentralCompanyFields, CentralGuestFields } from "../../repos/centralProfiles";
import type { CompanyFields, CustomerFields } from "../../repos/companies";

// The desk's side of the ONE common profile (platform 0132; security review round 2, M1(b)/(c)): the shared fields a desk save writes to the profile, and the 409 that asks the
// person to confirm before a shared change reaches every hotel (ui-shared profileReview.ts). Used by customerService and companyService.

/** A shared change asks first only when another hotel shares the profile (the guest's or company's own portal is the person themself). */
export const CONFIRM_FROM_HOTELS = 2;

/** The guest's shared fields as the desk writes them to the profile (the hotel's copy keeps its own form). */
export const sharedGuestFields = (v: Pick<CustomerFields, "name" | "email" | "address" | "city">): Pick<CentralGuestFields, "displayName" | "email" | "address" | "city"> => ({
  displayName: v.name.trim().slice(0, 100) || "Guest",
  email: v.email?.trim().toLowerCase() || null,
  address: v.address?.trim().slice(0, 255) || null,
  city: v.city?.trim().slice(0, 100) || null,
});

/** The company's shared fields as the desk writes them to the profile. */
export const sharedCompanyFields = (v: CompanyFields): Omit<CentralCompanyFields, "userId"> => ({
  name: v.name.trim().slice(0, 100) || "Company",
  mainContactName: v.contacts[0]?.name?.trim().slice(0, 100) || null,
  gstin: v.gstNumber?.trim().toUpperCase() || null,
  email: v.email?.trim().toLowerCase() || null,
  mobile: v.mobileNumber?.trim() || null,
  landline: v.phoneNumber?.trim() || null,
  address: v.address?.trim().slice(0, 100) || null,
  pincode: v.pincode?.trim() || null,
  country: v.country?.trim() || null,
  contacts: v.contacts.map((x) => ({ name: x.name, role: x.role, email: x.email, mobile: x.mobile })),
});

/** The history's field keys as the desk forms name them (the 409's details.fields). */
const FORM_FIELD: Record<string, string> = { gstin: "gstNumber", landline: "phone", mainContact: "contacts" };

/** M1(b): the 409 that asks to confirm a shared change: "This changes email and city for this guest at all 3 hotels." */
export function confirmSharedError(kind: "guest" | "company", fields: readonly string[], hotels: number): AppError {
  const sentence = `This changes ${sharedFieldsText(fields)} for this ${kind} at all ${hotels} hotels.`;
  const marks = Object.fromEntries(fields.map((f) => [FORM_FIELD[f] ?? f, `Shared with ${hotels} hotels`]));
  return new AppError("CONFLICT", sentence, { fields: { ...marks, [CONFIRM_SHARED_FIELD]: sentence } });
}
