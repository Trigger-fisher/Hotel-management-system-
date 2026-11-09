import "server-only";

// Whether a guest or a company can pay a hotel online (MJ, 5 Nov 2026): the Set-up centre's per-hotel payment status, read from the hotel's own settings. Only a yes or no
// leaves the server; a key is never sent.

/** The hotel's own Razorpay account (rooms and stays): switched on, its mode, its Key ID and whether a Key secret is saved. */
export const ONLINE_PAYMENT_KEYS: readonly string[] = ["razorpay_hotel.enabled", "razorpay_hotel.mode", "razorpay_hotel.key_id", "razorpay_hotel.key_secret"];

/** The portals' own pay calls do not reach Razorpay yet (they answer PAY_OFF). True once they do; until then every portal says "Pay at the front desk". */
export const PORTAL_PAY_BUILT = false;

/** The Set-up centre's Working: switched on, a Key ID of the chosen mode, a Key secret saved; Live only where the server allows live money. */
export function paymentSetUp(values: ReadonlyMap<string, string | null>, liveAllowed = process.env.HMS_RAZORPAY_LIVE === "1"): boolean {
  const v = (k: string) => (values.get(k) ?? "").trim();
  if (!["1", "true", "yes", "on"].includes(v("razorpay_hotel.enabled").toLowerCase())) return false;
  const mode = v("razorpay_hotel.mode") === "live" ? "live" : "test";
  if (mode === "live" && !liveAllowed) return false;
  return v("razorpay_hotel.key_id").startsWith(`rzp_${mode}_`) && v("razorpay_hotel.key_secret") !== "";
}

/** What the portals are told per hotel. */
export const onlinePaymentAvailable = (values: ReadonlyMap<string, string | null>): boolean => PORTAL_PAY_BUILT && paymentSetUp(values);
