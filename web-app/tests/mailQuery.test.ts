// The Mailbox page's Gmail search, snooze times and keyboard map (src/dashboards/groups/conversations/mailQuery.ts).
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, test } from "node:test";

type NextResolve = (specifier: string, context?: unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks(hooks: { resolve(specifier: string, context: unknown, next: NextResolve): unknown }): void };
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

const { mailQuery, withoutChip, passesLocal, snoozeChoices, mailKey } = await import("../src/dashboards/groups/conversations/mailQuery.ts");

const LABELS = ["Booking", "Billing", "Follow up"];

describe("Gmail search on the Mailbox page", () => {
  test("plain words go to the server in the chosen folder", () => {
    const q = mailQuery("amit booking", "inbox", LABELS);
    assert.equal(q.words, "amit booking");
    assert.equal(q.folder, "inbox");
    assert.deepEqual(q.chips, []);
  });
  test("is:starred and is:unread pick the folder; Done reads the archive", () => {
    assert.equal(mailQuery("is:starred", "inbox", LABELS).folder, "starred");
    assert.equal(mailQuery("is:unread amit", "sent", LABELS).folder, "unread");
    assert.equal(mailQuery("", "done", LABELS).folder, "archive");
  });
  test("label: matches a known label, with dashes for spaces; an unknown label is ignored", () => {
    assert.equal(mailQuery("label:follow-up", "inbox", LABELS).label, "Follow up");
    assert.equal(mailQuery("label:billing", "inbox", LABELS).label, "Billing");
    assert.equal(mailQuery("label:nothing", "inbox", LABELS).label, null);
  });
  test("from: and subject: become words; every operator is a chip and can be removed", () => {
    const q = mailQuery("from:asha subject:invoice has:attachment", "inbox", LABELS);
    assert.equal(q.words, "asha invoice");
    assert.deepEqual(q.chips, ["from:asha", "subject:invoice", "has:attachment"]);
    assert.equal(withoutChip("from:asha subject:invoice has:attachment", "subject:invoice"), "from:asha has:attachment");
  });
  test("has:attachment keeps only rows with a file", () => {
    const q = mailQuery("has:attachment", "inbox", LABELS);
    assert.equal(passesLocal({ hasAttachments: true } as never, q), true);
    assert.equal(passesLocal({ hasAttachments: false } as never, q), false);
    assert.equal(passesLocal({ hasAttachments: false } as never, mailQuery("", "inbox", LABELS)), true);
  });
});

describe("snooze times", () => {
  test("a Thursday morning: later today 6 pm, tomorrow 8 am, Saturday 8 am, Monday 8 am", () => {
    const [later, tomorrow, weekend, nextWeek] = snoozeChoices(new Date(2026, 10, 5, 9, 30));
    assert.deepEqual([later.at.getDate(), later.at.getHours()], [5, 18]);
    assert.deepEqual([tomorrow.at.getDate(), tomorrow.at.getHours()], [6, 8]);
    assert.deepEqual([weekend.at.getDate(), weekend.at.getDay()], [7, 6]);
    assert.deepEqual([nextWeek.at.getDate(), nextWeek.at.getDay()], [9, 1]);
  });
  test("after 6 pm, later means tomorrow 8 am; on a Saturday the weekend is the next one", () => {
    assert.deepEqual([snoozeChoices(new Date(2026, 10, 5, 19, 0))[0].at.getDate(), snoozeChoices(new Date(2026, 10, 5, 19, 0))[0].at.getHours()], [6, 8]);
    assert.equal(snoozeChoices(new Date(2026, 10, 7, 10, 0))[2].at.getDate(), 14);
  });
});

describe("keyboard", () => {
  const k = (key: string, tagName = "DIV", extra = {}) => mailKey({ key, ctrlKey: false, metaKey: false, altKey: false, target: { tagName } as never, ...extra });
  test("Gmail's letters map; nothing fires while typing or with a modifier", () => {
    assert.equal(k("j"), "down");
    assert.equal(k("x"), "select");
    assert.equal(k("a"), "replyAll");
    assert.equal(k("/"), "search");
    assert.equal(k("j", "INPUT"), null);
    assert.equal(k("j", "TEXTAREA"), null);
    assert.equal(k("c", "DIV", { ctrlKey: true }), null);
    assert.equal(k("q"), null);
  });
});
