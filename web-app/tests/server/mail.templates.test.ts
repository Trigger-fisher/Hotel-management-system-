// The words of every email (mail/templates.ts): short subjects with the one fact that matters, dates "05 Nov 2026", times "3:05 pm", one button, a text part that reads alone.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dayOf, nightsOf, stayShort, whenOf } from "../../src/server/mail/templates";
import { renderMail } from "../../src/server/services/auth/mail";

const APP = "https://app.example.in";

describe("dates in mail", () => {
  test("a moment in IST with the time, a day as 05 Nov 2026, nights, a short stay for subjects", () => {
    assert.equal(whenOf("2026-11-12T09:35:00.000Z"), "12 Nov 2026, 3:05 pm");
    assert.equal(whenOf("10:30"), "10:30");
    assert.equal(dayOf("2026-11-05"), "05 Nov 2026");
    assert.equal(dayOf("05 Nov 2026"), "05 Nov 2026");
    assert.equal(nightsOf("2026-11-12", "2026-11-14"), 2);
    assert.equal(nightsOf("2026-11-14", "2026-11-12"), null);
    assert.equal(stayShort("2026-11-12", "2026-11-14"), "12-14 Nov");
    assert.equal(stayShort("2026-11-30", "2026-12-02"), "30 Nov-02 Dec");
    assert.equal(stayShort("2026-12-30", "2027-01-02"), "30 Dec 2026-02 Jan 2027");
    assert.equal(stayShort(undefined, "2026-12-02"), null);
  });
});

describe("guest mail", () => {
  const hotel = { name: "Hotel Aranya", phone: "+91 294 245 6789", email: "desk@aranya.example" };
  test("a booking confirmation: the dates and room in the subject, weekdays and nights in the table, the hotel's contact in the footer", () => {
    const m = renderMail("enquiry_confirmed", { name: "Kavya", hotelName: "Hotel Aranya", reference: "AR-1", roomName: "Deluxe Room", checkIn: "2026-11-12", checkOut: "2026-11-14" }, hotel);
    assert.equal(m.subject, "Booking confirmed: 12-14 Nov, Deluxe Room");
    assert.ok(m.text.includes("Reference: AR-1\nRoom: Deluxe Room\nCheck-in: Thu, 12 Nov 2026\nCheck-out: Sat, 14 Nov 2026\nNights: 2"));
    assert.ok(m.text.includes("--\nHotel Aranya\n+91 294 245 6789 | desk@aranya.example") && m.text.endsWith("Sent with Easy Hotel Solutions"));
    assert.equal(renderMail("enquiry_confirmed", { name: "K", reference: "AR-2" }).subject, "Booking confirmed: AR-2");
  });

  test("a payment link: the amount with the rupee sign and in words, what it is for, one Pay button; an old queued link keeps its message", () => {
    const m = renderMail("notification", { name: "Kavya", hotelName: "Hotel Aranya", subject: "Please pay ₹4,500.00", message: "₹4,500.00 for Advance", link: "https://rzp.example/i/x", amountPaise: 450000, forWhat: "Advance" }, hotel);
    assert.equal(m.subject, "Payment request from Hotel Aranya: ₹4,500.00");
    assert.ok(m.text.includes("Amount: ₹4,500.00\nIn words: Rupees Four Thousand Five Hundred Only\nFor: Advance"));
    assert.ok(m.html.includes(">Pay ₹4,500.00</a>") && (m.html.match(/<a /g) ?? []).length === 1);
    const old = renderMail("notification", { name: "K", hotelName: "Hotel Aranya", subject: "Please pay Rs 500", message: "Rs 500 for tea", link: "https://rzp.example/i/y" });
    assert.equal(old.subject, "Hotel Aranya: Please pay Rs 500");
    assert.ok(old.text.includes("sent you a payment link: Rs 500 for tea") && old.html.includes(">Pay now</a>"));
  });

  test("invoice and receipt keep their subjects (the number and the hotel) and say the PDF is attached", () => {
    assert.equal(renderMail("bill_invoice", { name: "K", hotelName: "Hotel Aranya", number: "1188" }).subject, "Your invoice 1188 from Hotel Aranya");
    const r = renderMail("advance_receipt", { name: "K", hotelName: "Hotel Aranya", number: "ADV-1" });
    assert.equal(r.subject, "Your receipt ADV-1 from Hotel Aranya");
    assert.ok(r.text.includes("attached to this email as a PDF") && r.text.includes("Receipt number: ADV-1"));
  });
});

describe("company mail", () => {
  test("a notice to a company: the hotel and the title in the subject, the notice quoted line by line, the portal named", () => {
    const m = renderMail("notification", { name: "Suresh", hotelName: "Hotel Aranya", subject: "Restaurant closed on 20 Nov", message: "Closed for a private event.\nBreakfast in the garden." });
    assert.equal(m.subject, "Hotel Aranya: Restaurant closed on 20 Nov");
    assert.ok(m.html.includes(">Restaurant closed on 20 Nov</h1>") && m.html.includes("Closed for a private event.<br>Breakfast in the garden."));
    assert.ok(m.text.includes("> Closed for a private event.\n> Breakfast in the garden.") && m.text.includes("company portal under Notifications"));
  });
});

describe("mail to the hotel's own team", () => {
  test("a new website enquiry: the guest and the dates in the subject, the guest's words quoted, where to answer it", () => {
    const m = renderMail("enquiry_new", { name: "Front office", hotelName: "Hotel Aranya", reference: "AR-1", guestName: "Kavya Menon", guestPhone: "+91 98450 12345", checkIn: "2026-11-12", checkOut: "2026-11-14", guests: 2, message: "A lake view, please." });
    assert.equal(m.subject, "New website enquiry: Kavya Menon, 12-14 Nov");
    assert.ok(m.text.includes("Name: Kavya Menon\nPhone: +91 98450 12345\nCheck-in: Thu, 12 Nov 2026") && m.text.includes("> A lake view, please.") && m.text.includes("Guests: 2"));
  });
  test("the daily summary: the hotel and the day in the subject, the report kept plain in the text part", () => {
    const m = renderMail("daily_summary", { name: "Team", hotelName: "Hotel Aranya", date: "2026-11-05", summary: "FRONT DESK\nArrivals 6" });
    assert.equal(m.subject, "Daily summary: Hotel Aranya, 05 Nov 2026");
    assert.ok(m.text.includes("Here is the day at Hotel Aranya (05 Nov 2026).\n\nFRONT DESK\nArrivals 6") && m.html.includes("FRONT DESK<br>Arrivals 6"));
  });
});

describe("dark mode", () => {
  test("the gold rule stays gold on the dark card", () => {
    assert.ok(renderMail("login_code", { name: "A", code: "1" }).html.includes(".hms-card{background:#1C1C21 !important;border-color:#34343B !important;border-top-color:#C9A227 !important;}"));
  });
});

describe("campaigns", () => {
  const U = "https://app.example.in/api/v1/public/unsubscribe?h=1&e=k&t=2";
  test("the hotel's own subject and paragraphs, a preheader from its first real paragraph, the unsubscribe link only here", () => {
    const m = renderMail("campaign", { name: "Kavya", hotelName: "Hotel Aranya", subject: "Diwali weekend: 20% off", text: "Dear Kavya,\n\nCelebrate Diwali by the lake with 20% off any room and breakfast on the terrace.\n\nWarm regards,\nHotel Aranya", unsubscribeUrl: U });
    assert.equal(m.subject, "Diwali weekend: 20% off");
    assert.ok(m.html.includes(">Celebrate Diwali by the lake with 20% off any room and breakfast on the terrace.&#847;"));
    assert.ok(!m.html.includes("<h1") && !m.text.startsWith("Hello"));
    assert.ok(m.text.includes(`To stop these emails, open: ${U}`) && m.html.includes(">Unsubscribe</a>"));
    assert.ok(m.html.includes('<html lang="en"'));
  });
  test("a campaign the hotel wrote in Hindi or Gujarati keeps its words and says its language", () => {
    const hi = renderMail("campaign", { name: "K", subject: "दिवाली पर 20% की छूट", text: "प्रिय कविता जी,\n\nइस दिवाली झील के किनारे हमारे साथ मनाइए।", unsubscribeUrl: U });
    assert.ok(hi.html.includes('<html lang="hi"') && hi.html.includes("इस दिवाली झील के किनारे हमारे साथ मनाइए।") && hi.text.includes("प्रिय कविता जी,"));
    assert.ok(renderMail("campaign", { name: "K", subject: "દિવાળી ઓફર", text: "નમસ્તે" }).html.includes('<html lang="gu"'));
    for (const kind of ["login_code", "enquiry_confirmed", "bill_invoice", "notification"] as const) assert.ok(!renderMail(kind, { name: "A", link: "https://x.example/p" }).html.includes("Unsubscribe"), kind);
  });
});

describe("invitations and onboarding", () => {
  const base = { name: "Arjun", invitedBy: "Meera Desai", link: "https://app.example.in/onboard?invite=x", validHours: 168 };
  test("a hotel, a group and a member hotel each get their own words; the link works for 7 days", () => {
    const hotel = renderMail("invitation", { ...base, hotelName: "Hotel Aranya", inviteType: "hotel" });
    assert.equal(hotel.subject, "Hotel Aranya is invited to join Easy Hotel Solutions");
    assert.ok(hotel.text.includes("Meera Desai from Easy Hotel Solutions invited Hotel Aranya to join Easy Hotel Solutions.") && hotel.text.includes("for 7 days"));
    const group = renderMail("invitation", { ...base, hotelName: "Saffron Stays", inviteType: "group" });
    assert.ok(group.text.includes("invited your hotel group, Saffron Stays,") && group.text.includes("Group: Saffron Stays"));
    const member = renderMail("invitation", { ...base, hotelName: "Saffron Kochi", inviteType: "member_hotel", groupName: "Saffron Stays" });
    assert.equal(member.subject, "Saffron Stays invited Saffron Kochi to Easy Hotel Solutions");
    assert.ok(member.text.includes("Meera Desai, the admin of Saffron Stays, invited Saffron Kochi to join the group") && member.html.includes(">Join Saffron Stays</h1>"));
    assert.ok(member.text.includes("Fill in the onboarding form:\nhttps://app.example.in/onboard?invite=x"));
  });
  test("approved: a subject that says you can sign in, the username and a Sign in button", () => {
    const m = renderMail("onboarding_approved", { name: "Vikram", hotelName: "Hotel Aranya", username: "vikram" }, null, { publicUrl: APP });
    assert.equal(m.subject, "Hotel Aranya is approved: you can sign in now");
    assert.ok(m.text.includes("Username: vikram") && m.html.includes(">Sign in to Easy Hotel Solutions</a>"));
  });
});

describe("sign-in and account mail", () => {
  test("the code is never in the subject or the preheader; it is in the body and the text part", () => {
    const m = renderMail("login_code", { name: "Ritika", code: "482915", minutes: 10 });
    assert.ok(!m.subject.includes("482915"));
    assert.ok(!/It works for 10 minutes\.[^<]*482915/.test(m.html.split("</div>")[0] ?? ""));
    assert.ok(m.html.includes(">482915</td>") && m.text.includes("    482915"));
  });

  test("a locked account says until when, as 12 Nov 2026, 3:05 pm", () => {
    const m = renderMail("account_locked", { name: "Ritika", until: "2026-11-12T09:35:00.000Z" });
    assert.equal(m.subject, "Your Easy Hotel Solutions account is locked for now");
    assert.ok(m.text.includes("Locked until: 12 Nov 2026, 3:05 pm"));
  });

  test("a new account and an admin reset: username and temporary password, and one Sign in button when the app's address is known", () => {
    for (const kind of ["temp_password", "admin_reset"] as const) {
      const m = renderMail(kind, { name: "Ritika", username: "ritika", tempPassword: "Tmp-1" }, null, { publicUrl: APP });
      assert.ok(m.text.includes("Username: ritika\nTemporary password: Tmp-1"));
      assert.equal((m.html.match(/<a class="hms-btn"/g) ?? []).length, 1);
      assert.ok(m.html.includes(`href="${APP}/"`) && m.html.includes(">Sign in to Easy Hotel Solutions</a>"));
      assert.ok(m.text.includes("1. Sign in with the username and temporary password above."));
    }
  });
});
