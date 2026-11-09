// WhatsApp campaigns on the REAL PostgreSQL (hotel 0058, platform 0185), throwaway hms_test only: the audience is the guests who agreed and are not opted out, enrolling fixes it once per number (an Indian
// 10-digit mobile gets 91), the real sender and a fake Meta send the approved message a batch at a time, the counters follow, and the platform's list of running campaigns works.
// Run with: npm run test:db
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CreatedHotel } from "../../../common/db/scripts/create-hotel";
import type { DbClient } from "../../../common/db/scripts/pg-db";
import { createDatabase, type Database } from "../../src/db";
import { createPgUnit } from "../../src/server/repos/postgres/unit";
import { pgCampaignRuns, pgCampaignStore } from "../../src/server/repos/postgres/whatsappCampaigns";
import { createPgWhatsAppSendStore } from "../../src/server/repos/postgres/whatsappSend";
import { stepCampaign } from "../../src/server/whatsapp/campaignRunner";
import { whatsappConfig } from "../../src/server/whatsapp/config";
import { createFakeMeta } from "../../src/server/whatsapp/fakeMeta";
import { createGraphClient } from "../../src/server/whatsapp/graph";
import { openToken, sealToken } from "../../src/server/whatsapp/seal";
import { createSender } from "../../src/server/whatsapp/send";
import { createTestHotel, removeAllTestHotels } from "./helpers/hotels";
import { appUrl, connectOwner, lockTestDatabase } from "./helpers/realDb";

const ENV = { WHATSAPP_APP_SECRET: "db-app-secret", WHATSAPP_VERIFY_TOKEN: "db-verify", HMS_HASH_KEY: randomBytes(32).toString("base64") };
const cfg = () => whatsappConfig(ENV)!;
const PHONE_ID = "1055550002222";
const T0 = new Date("2026-11-04T10:00:00Z");
let release: (() => Promise<void>) | undefined;
let owner: DbClient;
let database: Database;
let hotel: CreatedHotel;
let lineId = "";
let templateId = "";
const q = (text: string, params: unknown[] = []) => owner.query(text, params);
const clear = async (): Promise<void> => {
  for (const table of ["whatsapp_campaign_runs", "whatsapp_message_index", "whatsapp_line_hotels", "whatsapp_lines"]) await owner.query(`DELETE FROM platform.${table}`);
};

before(async () => {
  release = await lockTestDatabase();
  owner = await connectOwner();
  await clear();
  database = createDatabase({ databaseUrl: appUrl(), totalConnections: 4 });
  hotel = await createTestHotel(owner, "WhatsApp Campaign Hotel");
  lineId = String((await q("INSERT INTO platform.whatsapp_lines (kind, phone_number_id, waba_id, status, token_secret) VALUES ('shared', $1, '2055550009998', 'active', $2) RETURNING id", [PHONE_ID, sealToken(cfg().sealKey, "EAAG-test", PHONE_ID)])).rows[0].id);
  await q("INSERT INTO platform.whatsapp_line_hotels (line_id, hotel_id, rules_override) VALUES ($1, $2, '{\"recipients_stay_guests_only\":false,\"marketing_allowed\":true}')", [lineId, hotel.id]);
  await q("UPDATE platform.platform_settings SET value = 'true'::jsonb WHERE key = 'whatsapp.enabled'");
  const S = `"${hotel.schema}"`;
  // three guests who agreed (one writes the number with spaces and a 0), one who did not, one who sent STOP
  for (const [name, mobile, agreed] of [["Asha Patel", "98250 41236", true], ["Ravi Shah", "09825041237", true], ["Meera Jain", "+91 98250 41238", true], ["No Tick", "9825041239", false], ["Stopped", "9825041240", true]] as const) {
    await q(`INSERT INTO ${S}.customers (name, mobile, wa_consent_at) VALUES ($1, $2, $3)`, [name, mobile, agreed ? T0 : null]);
  }
  await q(`INSERT INTO ${S}.wa_optouts (phone_digits) VALUES ('919825041240')`);
  templateId = String((await q(`INSERT INTO ${S}.wa_templates (name, language, category, body, variables, status, line_id) VALUES ('diwali_offer', 'en', 'marketing', 'Hello {{1}}, enjoy a Diwali offer at our hotel this week.', '[{"index":1,"name":"guest_name","example":"Asha"}]', 'approved', $1) RETURNING id`, [lineId])).rows[0].id);
});
after(async () => {
  await database?.close();
  if (owner) {
    await q("UPDATE platform.platform_settings SET value = 'false'::jsonb WHERE key = 'whatsapp.enabled'").catch(() => undefined);
    await clear().catch(() => undefined);
    await removeAllTestHotels(owner).catch(() => undefined);
  }
  await owner?.end();
  await release?.();
});

describe("message languages on PostgreSQL (hotel 0059)", () => {
  test("English, Hinglish, Hindi and Gujarati are accepted for a message; anything else is refused by the table itself", async () => {
    const S = `"${hotel.schema}"`;
    for (const language of ["en", "hinglish", "hi", "gu"]) await q(`INSERT INTO ${S}.wa_templates (name, language, category, body) VALUES ($1, $2, 'utility', 'Hello there, your booking is confirmed.')`, [`lang_${language}`, language]);
    await assert.rejects(q(`INSERT INTO ${S}.wa_templates (name, language, category, body) VALUES ('lang_bad', 'klingon', 'utility', 'Hello there, your booking is confirmed.')`), /wa_templates_language_check/);
  });
});

describe("campaigns on PostgreSQL", () => {
  test("the audience, enrolling once per number, the real sender through a fake Meta, the counters and the running list", async () => {
    const unit = createPgUnit(database.withHotel, (tx) => ({ campaigns: pgCampaignStore(tx) }));
    const session = { hotelId: hotel.id, userId: "11111111-1111-4111-8111-111111111111", visit: undefined, scope: undefined };
    const meta = createFakeMeta();
    const store = createPgWhatsAppSendStore({ pool: database.pool, withHotel: database.withHotel, hashKey: cfg().hashKey });
    const sender = createSender({ store, graph: createGraphClient({ fetch: meta.fetch, timeoutMs: 300 }), openToken: (s, p) => openToken(cfg().sealKey, s, p), now: () => T0 });

    const made = await unit.run(session, async ({ campaigns }) => {
      assert.equal(await campaigns.audienceSize({}), 3, "agreed, not opted out");
      assert.equal(await campaigns.audienceSize({ stayedWithinDays: 30 }), 0, "nobody stayed");
      assert.equal((await campaigns.template(templateId))?.blanks, 1);
      const c = await campaigns.create({ name: "Diwali", templateId, audience: {}, variables: ["{guest_name}"] }, session.userId);
      assert.equal(await campaigns.enroll(c.id, {}), 3);
      assert.equal(await campaigns.enroll(c.id, {}), 0, "a second enrolment adds nobody");
      assert.deepEqual(await campaigns.update(c.id, { name: "Diwali 2026", templateId, audience: {}, variables: ["{guest_name}"] }).then((x) => x?.name), "Diwali 2026");
      await campaigns.setStatus(c.id, ["draft"], "running", null, T0);
      assert.equal(await campaigns.update(c.id, { name: "x", templateId, audience: {}, variables: [] }), null, "only a draft changes");
      return c;
    });

    assert.deepEqual(await stepCampaign({ unit, sender, now: () => T0 }, hotel.id, made.id), { kind: "done", sent: 3 });
    const sends = meta.sends();
    assert.equal(sends.length, 3);
    assert.deepEqual(sends.map((s) => s.body?.to).sort(), ["919825041236", "919825041237", "919825041238"], "digits with the country code");
    assert.ok(sends.every((s) => (s.body?.template as { name: string }).name === "diwali_offer"));
    assert.deepEqual(sends.map((s) => ((s.body?.template as { components: { parameters: { text: string }[] }[] }).components[0].parameters[0].text)).sort(), ["Asha", "Meera", "Ravi"]);

    const after = await unit.run(session, ({ campaigns }) => campaigns.get(made.id));
    assert.deepEqual([after?.status, after?.recipientCount, after?.sent, after?.failed, after?.skipped], ["done", 3, 3, 0, 0]);
    assert.equal((await q(`SELECT count(*)::int AS n FROM "${hotel.schema}".wa_usage WHERE category = 'marketing' AND sent = 3`)).rows[0].n, 1, "counted for the month's bill");
    assert.deepEqual(await stepCampaign({ unit, sender, now: () => T0 }, hotel.id, made.id), { kind: "inactive" });
    assert.equal(meta.sends().length, 3, "nothing is sent twice");

    // a finished campaign is removed with its guests; the platform's running list schedules, finds due, and removes
    assert.equal(await unit.run(session, ({ campaigns }) => campaigns.remove(made.id)), true);
    assert.equal((await q(`SELECT count(*)::int AS n FROM "${hotel.schema}".wa_campaign_recipients`)).rows[0].n, 0);
    const runs = pgCampaignRuns(database.pool);
    await runs.schedule(hotel.id, made.id, new Date(T0.getTime() + 60_000));
    assert.deepEqual(await runs.due(T0, 10), []);
    assert.deepEqual(await runs.due(new Date(T0.getTime() + 61_000), 10), [{ hotelId: hotel.id, campaignId: made.id }]);
    await runs.schedule(hotel.id, made.id, T0);
    assert.equal((await runs.due(T0, 10)).length, 1, "scheduling again moves the same row");
    await runs.remove(hotel.id, made.id);
    assert.deepEqual(await runs.due(new Date(T0.getTime() + 86_400_000), 10), []);
  });
});
