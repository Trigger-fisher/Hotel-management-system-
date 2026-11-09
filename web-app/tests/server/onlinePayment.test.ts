// The portals' per-hotel "can pay online" signal (MJ, 5 Nov 2026): the Set-up centre's payment status as a yes or no, and no hotel offers it while the portals' own pay
// calls still answer PAY_OFF.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { onlinePaymentAvailable, paymentSetUp, PORTAL_PAY_BUILT } from "../../src/server/payments/onlinePayment";

const of = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [`razorpay_hotel.${k}`, v] as [string, string]));
const ready = { enabled: "1", mode: "test", key_id: "rzp_test_Abc12345XYZ", key_secret: "s3cr3t" };

describe("online payment for guests and companies", () => {
  test("Working only when switched on, with a Key ID of the mode and a Key secret; Live only where the server allows live money", () => {
    assert.equal(paymentSetUp(of(ready)), true);
    assert.equal(paymentSetUp(of({ ...ready, enabled: "0" })), false);
    assert.equal(paymentSetUp(of({ ...ready, key_secret: "" })), false);
    assert.equal(paymentSetUp(of({ ...ready, key_id: "rzp_live_Abc12345XYZ" })), false);
    assert.equal(paymentSetUp(new Map()), false);
    const live = of({ ...ready, mode: "live", key_id: "rzp_live_Abc12345XYZ" });
    assert.equal(paymentSetUp(live, false), false);
    assert.equal(paymentSetUp(live, true), true);
  });

  test("the portals are told no while their pay calls are not built, even for a hotel set up", () => {
    assert.equal(PORTAL_PAY_BUILT, false);
    assert.equal(onlinePaymentAvailable(of(ready)), false);
  });
});
