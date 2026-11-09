// Unit tests for the email thread shown as a chat (src/dashboards/groups/conversations/emailThread.ts): who is in the conversation, Reply all, the Cc suggestions and the tick.
// Run with `node --test tests/conversations.emailThread.test.ts` (Node's built-in runner; Node strips the TypeScript types).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void;
};
const shared = new URL("../../common/ui-shared/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@shared/")) return next(new URL(`${specifier.slice("@shared/".length)}.ts`, shared).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { addressOf, ccSuggestions, emailTick, looksLikeAddress, nameOf, replyAllRecipients, splitAddresses, threadParticipants } = await import("../src/dashboards/groups/conversations/emailThread.ts");

const mail = (o: { id: string; direction: "in" | "out"; from: string; to: string[]; cc?: string[] }) =>
  ({ kind: "email", id: o.id, direction: o.direction, status: "received", at: `2026-11-03T0${o.id}:00:00Z`, from: o.from, replyTo: null, to: o.to, cc: o.cc ?? [], subject: "Booking", preview: "", hasAttachments: false, sentBy: null, sentFrom: "contact", verified: null }) as const;

const thread = [
  mail({ id: "1", direction: "in", from: "Rohan Sharma <rohan@abc.com>", to: ["reservations@hotel.in", "Priya Mehta <priya@abc.com>"], cc: ["Accounts <acc@abc.com>"] }),
  mail({ id: "2", direction: "out", from: "reservations@hotel.in", to: ["rohan@abc.com"], cc: ["acc@abc.com", "boss@abc.com"] }),
];

describe("addresses", () => {
  test("the address and the name come out of a display form", () => {
    assert.equal(addressOf('"Rohan S" <Rohan@ABC.com>'), "rohan@abc.com");
    assert.equal(nameOf('"Rohan S" <rohan@abc.com>'), "Rohan S");
    assert.equal(nameOf("rohan@abc.com"), "rohan@abc.com");
  });
  test("typed text is split on commas, semicolons and spaces, without repeats", () => {
    assert.deepEqual(splitAddresses("a@x.com, b@x.com; A@x.com  <c@x.com>"), ["a@x.com", "b@x.com", "c@x.com"]);
    assert.deepEqual(splitAddresses("  "), []);
  });
  test("only an address-shaped text is a chip", () => {
    assert.equal(looksLikeAddress("a@x.com"), true);
    assert.equal(looksLikeAddress("a@x"), false);
    assert.equal(looksLikeAddress("a b@x.com"), false);
  });
});

describe("the people in the conversation", () => {
  const people = threadParticipants(thread, ["rohan@abc.com"]);
  test("the contact is first and the hotel's own mailbox is not a person", () => {
    assert.equal(people[0].address, "rohan@abc.com");
    assert.equal(people[0].contact, true);
    assert.equal(people.some((p) => p.address === "reservations@hotel.in"), false);
  });
  test("a person who was only Cc'd carries the Cc mark; one who is also on a To line does not", () => {
    const by = Object.fromEntries(people.map((p) => [p.address, p]));
    assert.equal(by["boss@abc.com"].ccOnly, true);
    assert.equal(by["acc@abc.com"].ccOnly, true);
    assert.equal(by["priya@abc.com"].ccOnly, false);
    assert.equal(by["rohan@abc.com"].ccOnly, false);
  });
  test("a name seen later replaces a bare address, and nobody is listed twice", () => {
    assert.equal(people.filter((p) => p.address === "acc@abc.com").length, 1);
    assert.equal(people.find((p) => p.address === "acc@abc.com")?.name, "Accounts");
  });
});

describe("Reply all", () => {
  test("fills the newest email's Cc and other To, without the person replied to or the mailbox", () => {
    const last = mail({ id: "3", direction: "in", from: "rohan@abc.com", to: ["reservations@hotel.in", "priya@abc.com"], cc: ["boss@abc.com", "Rohan <rohan@abc.com>"] });
    assert.deepEqual(replyAllRecipients(last, "rohan@abc.com", [...thread, last]), ["boss@abc.com", "priya@abc.com"]);
  });
  test("no email, no one; and never more than the server allows", () => {
    assert.deepEqual(replyAllRecipients(undefined, null, []), []);
    const many = mail({ id: "4", direction: "in", from: "r@x.com", to: ["m@h.in"], cc: ["1@x.com", "2@x.com", "3@x.com", "4@x.com", "5@x.com", "6@x.com"] });
    assert.equal(replyAllRecipients(many, "r@x.com", [many]).length, 5);
  });
});

describe("Cc suggestions", () => {
  const people = threadParticipants(thread, ["rohan@abc.com"]);
  test("the thread's people, minus those chosen and the reply's own To", () => {
    const s = ccSuggestions("", ["boss@abc.com"], people, [], "rohan@abc.com").map((x) => x.address);
    assert.deepEqual(s.sort(), ["acc@abc.com", "priya@abc.com"]);
  });
  test("typing narrows by address or name, and known contacts follow", () => {
    assert.deepEqual(ccSuggestions("acc", [], people, ["Zed <zed@acc.in>"], null).map((x) => x.address), ["acc@abc.com", "zed@acc.in"]);
  });
});

describe("the tick of our own email", () => {
  test("a read receipt never shows for an email", () => {
    assert.equal(emailTick("read"), "delivered");
    assert.equal(emailTick("sent"), "sent");
    assert.equal(emailTick("failed"), "failed");
    assert.equal(emailTick("pending"), "pending");
  });
});
