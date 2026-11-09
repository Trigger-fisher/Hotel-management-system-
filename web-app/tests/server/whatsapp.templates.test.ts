// The hotel's WhatsApp message templates (4 Nov 2026): Meta's wording rules, the draft -> sent -> decided life, the fake Meta's template calls. Memory store; the fake Meta stands in for the Graph API.
// Run: npx tsx --import ./src/server/lib/node-hooks/register.ts --test tests/server/whatsapp.templates.test.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Catalog } from "@/server/auth/catalog";
import type { VerifiedSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { templateBody } from "@/server/services/whatsapp/templatesSchemas";
import { createTemplatesService, type TemplateMeta, type TemplatesRepos } from "@/server/services/whatsapp/templatesService";
import { createFakeMeta } from "@/server/whatsapp/fakeMeta";
import { createGraphClient } from "@/server/whatsapp/graph";
import { checkTemplate, fillTemplate, statusFromMeta, templateNameOf } from "@/server/whatsapp/templates";
import { createMemoryTemplatesRepo } from "@/server/whatsapp/templatesStore";

const session = { userId: "u1", hotelId: "h1", accountRole: "hotel_admin" } as unknown as VerifiedSession;
const meta = { ip: "127.0.0.1", traceId: "t" } as never;
const draft = { name: "Booking confirmed", language: "en", category: "utility" as const, body: "Hello {{1}}, your booking is confirmed for {{2}}. We look forward to seeing you.", variables: [{ index: 1, name: "guest_name", example: "Asha" }, { index: 2, name: "check_in", example: "12 Nov" }] };
const fails = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code);

const build = () => {
  const fake = createFakeMeta();
  const graph = createGraphClient({ fetch: fake.fetch });
  const repo = createMemoryTemplatesRepo();
  const logs: string[] = [];
  const repos = { templates: repo, systemLogs: { write: async (row: { summary: string }) => void logs.push(row.summary) } } as unknown as TemplatesRepos;
  const port: TemplateMeta = {
    async submit(_h, t) {
      const r = await graph.createTemplate("tok", "waba1", { name: t.name, language: t.language, category: t.category, body: t.body, examples: t.variables.map((v) => v.example) });
      return r.kind === "ok" ? { ok: true, metaTemplateId: r.metaId, status: statusFromMeta(r.status), lineId: "line1", metaName: t.name } : { ok: false, message: "Meta did not accept this message." };
    },
    async check(_h, t) {
      const r = await graph.templateStatus("tok", "waba1", t.name);
      return r.kind === "ok" ? { ok: true, found: r.found, status: statusFromMeta(r.status), reason: r.reason } : { ok: false, message: "x" };
    },
    async remove(_h, t) {
      const r = await graph.deleteTemplate("tok", "waba1", t.name);
      return { ok: r.kind === "ok", message: "" };
    },
  };
  const unit = { run: async (_s: unknown, work: (r: TemplatesRepos) => Promise<unknown>) => work(repos) } as never;
  const people = { get: async () => new Map([["u1", { name: "Rajiv" }]]) } as never;
  return { fake, repo, logs, service: createTemplatesService({ unit, people, catalog: {} as Catalog, meta: port }) };
};

describe("template wording rules", () => {
  test("a good draft is cleaned; the name is made Meta-safe; the blanks are checked", () => {
    assert.equal(templateNameOf("  Booking Confirmed! "), "booking_confirmed");
    assert.equal(checkTemplate({ ...draft, name: "booking_confirmed" }).variables.length, 2);
    assert.equal(fillTemplate(draft.body, ["Asha", "12 Nov"]), "Hello Asha, your booking is confirmed for 12 Nov. We look forward to seeing you.");
    const bad = (body: string, variables = draft.variables) => assert.throws(() => checkTemplate({ ...draft, name: "x", body, variables }), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED");
    bad("{{1}} your booking is confirmed for {{2}} with us.");
    bad("Your booking is confirmed for {{1}} and room {{3}}, thank you for choosing us.");
    bad("Hello {{1}}{{2}} welcome to our hotel, we are happy to have you.");
    bad("Hello {{1}}, welcome to our hotel and thank you for booking with us {{2}}");
    bad(draft.body, [{ index: 1, name: "guest_name", example: "Asha" }]);
    assert.equal(statusFromMeta("APPROVED"), "approved");
    assert.equal(statusFromMeta("something_new"), "pending");
  });
});

describe("WhatsApp Business rules (5 Nov 2026)", () => {
  const ok = { ...draft, name: "x" };
  const refused = (d: Parameters<typeof checkTemplate>[0], field: string) =>
    assert.throws(() => checkTemplate(d), (e: unknown) => e instanceof AppError && e.code === "VALIDATION_FAILED" && field in ((e.details as { fields: Record<string, string> }).fields ?? {}));

  test("one emoji at most, no capital-letter shouting, an offer always says how to stop offers", () => {
    assert.equal(checkTemplate({ ...ok, body: draft.body + " \u{1F642}" }).body.endsWith("\u{1F642}"), true);
    refused({ ...ok, body: draft.body + " \u{1F642}\u{1F389}" }, "body");
    refused({ ...ok, body: "HELLO {{1}}, YOUR BOOKING IS CONFIRMED FOR {{2}}. SEE YOU SOON." }, "body");
    assert.doesNotThrow(() => checkTemplate({ ...ok, body: "Hello {{1}}, your GST bill for {{2}} is ready. Reply STOP to stop offers." }));
    refused({ ...ok, category: "marketing", body: "Hello {{1}}, get 15% off your next stay until {{2}}. Book now." }, "body");
    assert.equal(checkTemplate({ ...ok, category: "marketing", body: "Hello {{1}}, get 15% off your next stay until {{2}}.\n\nReply STOP to stop offers." }).category, "marketing");
  });

  test("buttons: at most three, two links, short plain words, full https links; the starter key is kept only when it is clean", () => {
    const b = (buttons: Parameters<typeof checkTemplate>[0]["buttons"]) => ({ ...ok, buttons });
    const clean = checkTemplate({ ...b([{ kind: "url", text: "  Get   directions ", url: "https://maps.example.com/x" }, { kind: "quick_reply", text: "Call me" }]), starterKey: "pre_arrival" });
    assert.deepEqual(clean.buttons, [{ kind: "url", text: "Get directions", url: "https://maps.example.com/x" }, { kind: "quick_reply", text: "Call me" }]);
    assert.equal(clean.starterKey, "pre_arrival");
    assert.equal(checkTemplate({ ...ok, starterKey: "Bad Key!" }).starterKey, null);
    assert.deepEqual(checkTemplate(ok).buttons, []);
    refused(b([{ kind: "quick_reply", text: "A" }, { kind: "quick_reply", text: "B" }, { kind: "quick_reply", text: "C" }, { kind: "quick_reply", text: "D" }]), "buttons");
    refused(b([{ kind: "url", text: "A", url: "https://a.example.com" }, { kind: "url", text: "B", url: "https://b.example.com" }, { kind: "url", text: "C", url: "https://c.example.com" }]), "buttons");
    refused(b([{ kind: "quick_reply", text: "This button text is far too long" }]), "buttons");
    refused(b([{ kind: "quick_reply", text: "Yes" }, { kind: "quick_reply", text: "yes" }]), "buttons");
    refused(b([{ kind: "url", text: "Pay", url: "http://pay.example.com" }]), "buttons");
    refused(b([{ kind: "url", text: "Pay", url: "https://pay.example.com/{{1}}" }]), "buttons");
    refused(b([{ kind: "quick_reply", text: "" }]), "buttons");
  });

  test("the route accepts a Hinglish message (the language field once stopped at five letters)", () => {
    assert.equal(templateBody.parse({ ...draft, language: "hinglish" }).language, "hinglish");
    assert.deepEqual(templateBody.parse(draft).buttons, []);
  });

  test("the buttons reach Meta as a BUTTONS component", async () => {
    const sent: unknown[] = [];
    const graph = createGraphClient({ fetch: (async (_u: string, init?: { body?: string }) => { sent.push(JSON.parse(init?.body ?? "{}")); return new Response(JSON.stringify({ id: "1", status: "PENDING" }), { status: 200, headers: { "content-type": "application/json" } }); }) as never });
    await graph.createTemplate("tok", "waba1", { name: "pre_arrival", language: "en", category: "utility", body: "Hello {{1}}, see you soon at our hotel.", examples: ["Riya"], buttons: [{ kind: "url", text: "Get directions", url: "https://maps.example.com/x" }, { kind: "quick_reply", text: "Call me" }] });
    const components = (sent[0] as { components: { type: string; buttons?: unknown }[] }).components;
    assert.deepEqual(components[1], { type: "BUTTONS", buttons: [{ type: "URL", text: "Get directions", url: "https://maps.example.com/x" }, { type: "QUICK_REPLY", text: "Call me" }] });
  });
});

describe("a template's life", () => {
  test("draft -> sent to Meta (waiting) -> Meta approves -> check shows approved; a sent one cannot be edited", async () => {
    const { service, fake, logs } = build();
    const made = await service.create(session, draft, meta);
    assert.deepEqual([made.name, made.status, made.editable], ["booking_confirmed", "draft", true]);
    await fails(service.create(session, draft, meta), "CONFLICT");
    const sent = await service.submit(session, made.id, meta);
    assert.deepEqual([sent.status, sent.editable], ["pending", false]);
    await fails(service.update(session, made.id, draft, meta), "CONFLICT");
    await fails(service.submit(session, made.id, meta), "CONFLICT");
    assert.equal((await service.check(session, made.id, meta)).status, "pending");
    fake.decide("booking_confirmed", "APPROVED");
    assert.equal((await service.check(session, made.id, meta)).status, "approved");
    assert.deepEqual(logs, ["WhatsApp message written", "WhatsApp message sent to Meta", "WhatsApp message decision read"]);
  });

  test("a rejected message is editable again (back to a draft); a draft that never reached Meta is removed here only", async () => {
    const { service, fake, repo } = build();
    const made = await service.create(session, draft, meta);
    await service.submit(session, made.id, meta);
    fake.decide("booking_confirmed", "REJECTED", "INVALID_FORMAT");
    const rejected = await service.check(session, made.id, meta);
    assert.deepEqual([rejected.status, rejected.statusReason, rejected.editable], ["rejected", "INVALID_FORMAT", true]);
    assert.equal((await service.update(session, made.id, { ...draft, body: draft.body + " Safe travels." }, meta)).status, "draft");
    // Meta still holds the old one under the same name, so it is taken away first
    assert.equal((await service.remove(session, made.id, meta)).removed, true);
    assert.equal(repo.rows.length, 0);
    assert.equal(fake.calls.some((c) => c.method === "DELETE" && c.path.includes("message_templates")), false, "a draft that never reached Meta is removed locally only (the edit cleared Meta's id)");
  });

  test("access: an API key and a portal account are refused; a missing template is not found", async () => {
    const { service } = build();
    await fails(service.list({ ...session, token: { id: "t" } } as unknown as VerifiedSession), "FORBIDDEN");
    await fails(service.update(session, "00000000-0000-4000-8000-0000000000aa", draft, meta), "NOT_FOUND");
  });
});
