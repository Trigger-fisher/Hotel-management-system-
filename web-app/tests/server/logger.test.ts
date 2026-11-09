import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ALERTS_PER_MINUTE, BODY_OMITTED, REDACTED, alertingWrite, createLogger, redact, redactString } from "../../src/server/logger";

const SECRETS = [
  "ABCDE1234F",
  "4111111111111111",
  "123412341234",
  "1234 5678 9012",
  "1234-5678-9012",
  "SBIN0001234",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
  "v1:k1:aXZpdjEyMzQ1Ng==:dGFnMTIzNDU2Nzg5:Y2lwaGVydGV4dA==",
];

function lineOf(fn: (log: ReturnType<typeof createLogger>) => void): string {
  const lines: string[] = [];
  fn(createLogger({ level: "debug", write: (l) => lines.push(l) }));
  assert.equal(lines.length, 1);
  return lines[0];
}

describe("redact by key name", () => {
  test("passwords, tokens, codes, ID and bank numbers, card data", () => {
    const out = redact({
      password: "p1",
      newPassword: "p2",
      current_password: "p3",
      accessToken: "t1",
      refresh_token: "t2",
      Authorization: "Bearer abcdefghijk",
      cookie: "sid=abc",
      "set-cookie": "sid=abc",
      resetCode: "123456",
      otp: "654321",
      apiKey: "k",
      client_secret: "s",
      aadhaarNumber: "123412341234",
      idProofNumber: "ABCDE1234F",
      accountNumber: "00112233445566",
      ifscCode: "SBIN0001234",
      cardNumber: "4111111111111111",
      cvv: "123",
      pin: "1234",
    }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(out)) assert.equal(value, REDACTED, `${key} should be redacted`);
  });

  test("request and response bodies are never logged", () => {
    const out = redact({ body: { name: "Asha" }, requestBody: "x", payload: [1], formData: {}, rawBody: "y" }) as Record<string, unknown>;
    for (const value of Object.values(out)) assert.equal(value, BODY_OMITTED);
  });

  test("an error code field is not mistaken for a secret", () => {
    assert.deepEqual(redact({ code: "NOT_FOUND", status: 404, traceId: "trace-1" }), { code: "NOT_FOUND", status: 404, traceId: "trace-1" });
  });

  test("nested objects, arrays and errors", () => {
    const err = new Error("failed for password=hunter2 token=abc");
    const out = JSON.stringify(redact({ user: { name: "Asha", credentials: { password: "x" } }, list: [{ token: "t" }], err }));
    for (const leaked of ["hunter2", '"x"', '"t"', "token=abc"]) assert.ok(!out.includes(leaked), `leaked ${leaked}`);
    assert.ok(out.includes("Asha"));
  });

  test("does not mutate the input and survives cycles, bigint, buffers and dates", () => {
    const input: Record<string, unknown> = { password: "p", amount: BigInt(12345), at: new Date(0), blob: new Uint8Array(4) };
    input.self = input;
    const out = redact(input) as Record<string, unknown>;
    assert.equal(input.password, "p");
    assert.equal(out.password, REDACTED);
    assert.equal(out.amount, "12345");
    assert.equal(out.at, "1970-01-01T00:00:00.000Z");
    assert.equal(out.blob, "[binary]");
    assert.equal(out.self, "[Circular]");
  });

  test("caps depth, array length and string length", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    assert.ok(JSON.stringify(redact(deep)).includes("[Too deep]"));
    const arr = redact(Array.from({ length: 80 }, (_, i) => i)) as unknown[];
    assert.equal(arr.length, 51);
    assert.ok((redact("x".repeat(5000)) as string).length <= 2001);
  });
});

describe("redact by value shape", () => {
  test("secrets inside free text", () => {
    for (const secret of SECRETS) {
      const out = redactString(`user said ${secret} then left`);
      assert.ok(!out.includes(secret), `leaked ${secret}`);
    }
  });
  test("Bearer tokens, URL passwords and key=value pairs", () => {
    assert.ok(!redactString("Authorization: Bearer abcdef123456789").includes("abcdef123456789"));
    const url = redactString("connect postgres://hms_app:s3cr3tpw@localhost:5432/hms");
    assert.ok(!url.includes("s3cr3tpw") && url.includes("hms_app"));
    const mysql = redactString("connect mysql://hms_owner:An0therS3cret@127.0.0.1:3307/platform failed");
    assert.ok(!mysql.includes("An0therS3cret") && mysql.includes("hms_owner"));
    assert.ok(!redactString("GET /reset?token=abc123&x=1").includes("abc123"));
    assert.ok(!redactString("password=hunter2").includes("hunter2"));
  });
  test("epoch milliseconds: a number survives, the same digits as a string are redacted", () => {
    const epoch = 1760000000000; // 13 digits, like Date.now()
    const out = redact({ at: epoch, atText: String(epoch), note: `started ${epoch}` }) as Record<string, unknown>;
    assert.equal(out.at, epoch);
    assert.equal(out.atText, REDACTED);
    assert.ok(!String(out.note).includes(String(epoch)));
    assert.equal(typeof redact(Date.now()), "number");
  });
  test("guest data: a sealed vault value, an email and a mobile number inside text", () => {
    const sealed = "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.Cipher_text-1234";
    assert.ok(!redactString(`could not open ${sealed} for the hotel`).includes("Cipher_text"));
    assert.ok(!redactString("invalid value for guest.mail@example.co.in").includes("guest.mail"));
    for (const mobile of ["9000000001", "+91 90000 00001", "919000000001", "090000 00001", "90000-00001"]) {
      assert.ok(!redactString(`mobile ${mobile} was not accepted`).includes("90000"), `leaked ${mobile}`);
    }
    // not a mobile: a short number, a version, a decimal and an epoch-seconds style number starting with 1
    assert.equal(redactString("took 12345 ms, v2.5.3, ratio 98765.4321, at 1760000000"), "took 12345 ms, v2.5.3, ratio 98765.4321, at 1760000000");
  });
  test("guest field names are redacted by key", () => {
    const out = redact({ guestName: "A B", fullName: "A B", firstName: "A", lastName: "B", mobile: "9000000001", phone: "1", email: "a@b.co", address: "x", dateOfBirth: "1985-04-12", dob: "x", documentNumber: "ABCD1234", dataBase64: "AAAA", vehicleRegistration: "GJ03", roomNumber: "204" }) as Record<string, unknown>;
    for (const k of ["guestName", "fullName", "firstName", "lastName", "mobile", "phone", "email", "address", "dateOfBirth", "dob", "documentNumber", "dataBase64", "vehicleRegistration"]) assert.equal(out[k], REDACTED, k);
    assert.equal(out.roomNumber, "204");
  });
  test("ordinary text and short numbers are left alone", () => {
    assert.equal(redactString("Room 204 booked for 3 nights, bill 20260412"), "Room 204 booked for 3 nights, bill 20260412");
  });
});

describe("logger", () => {
  test("writes one JSON line with time, level, msg and fields, all redacted", () => {
    const line = lineOf((log) => log.info("sign in failed for 123412341234", { traceId: "trace-1", password: "hunter2", body: { a: 1 } }));
    const record = JSON.parse(line) as Record<string, unknown>;
    assert.equal(record.level, "info");
    assert.equal(record.traceId, "trace-1");
    assert.equal(record.password, REDACTED);
    assert.equal(record.body, BODY_OMITTED);
    assert.ok(!String(record.msg).includes("123412341234"));
    assert.ok(typeof record.time === "string" && !Number.isNaN(Date.parse(record.time)));
    assert.ok(!line.includes("hunter2"));
  });
  test("a caller field cannot overwrite level, msg or time", () => {
    const record = JSON.parse(lineOf((log) => log.warn("real", { level: "debug", msg: "fake", time: "never" }))) as Record<string, unknown>;
    assert.equal(record.level, "warn");
    assert.equal(record.msg, "real");
    assert.notEqual(record.time, "never");
  });
  test("child loggers add fields to every line", () => {
    const lines: string[] = [];
    const root = createLogger({ level: "info", write: (l) => lines.push(l) });
    root.child({ traceId: "trace-9", hotel: "h1" }).info("hello", { extra: 1 });
    assert.deepEqual(
      { traceId: (JSON.parse(lines[0]) as Record<string, unknown>).traceId, extra: (JSON.parse(lines[0]) as Record<string, unknown>).extra },
      { traceId: "trace-9", extra: 1 },
    );
  });
  test("levels filter, and silent writes nothing", () => {
    const lines: string[] = [];
    const warnLog = createLogger({ level: "warn", write: (l) => lines.push(l) });
    warnLog.debug("a");
    warnLog.info("b");
    warnLog.warn("c");
    warnLog.error("d");
    assert.equal(lines.length, 2);
    const quiet: string[] = [];
    const silent = createLogger({ level: "silent", write: (l) => quiet.push(l) });
    silent.error("nothing");
    assert.equal(quiet.length, 0);
  });
  test("an error object in the fields keeps its name and message but never leaks a secret in either", () => {
    const line = lineOf((log) => log.error("boom", { cause: new Error("bad token=abc123 for 4111111111111111") }));
    assert.ok(!line.includes("abc123") && !line.includes("4111111111111111"));
    assert.ok(line.includes("Error"));
  });
});

describe("the alert webhook (HMS_ALERT_WEBHOOK)", () => {
  test("every error line is POSTed once as {text, level, time, msg, traceId}; other levels are not; a failing post never throws; at most 20 a minute", async () => {
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    let fail = false;
    const write = alertingWrite("https://hooks.example.test/abc", async (url, body) => {
      if (fail) throw new Error("hook down");
      posts.push({ url, body: JSON.parse(body) as Record<string, unknown> });
    });
    const logger = createLogger({ level: "debug", write, now: () => new Date("2026-10-13T10:00:00Z") });
    logger.info("fine", { traceId: "t1" });
    logger.warn("hmm");
    logger.error("database refused", { traceId: "t2", password: "hunter2" });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(posts.length, 1);
    assert.deepEqual([posts[0].url, posts[0].body.text, posts[0].body.level, posts[0].body.msg, posts[0].body.traceId, posts[0].body.time], ["https://hooks.example.test/abc", "[HMS] database refused (trace t2)", "error", "database refused", "t2", "2026-10-13T10:00:00.000Z"]);
    assert.ok(!JSON.stringify(posts[0].body).includes("hunter2"), "the body is the redacted line's fields only");
    fail = true;
    assert.doesNotThrow(() => logger.error("still logged"));
    fail = false;
    for (let i = 0; i < 40; i += 1) logger.error(`burst ${i}`);
    await new Promise((r) => setTimeout(r, 5));
    // the failed post above took one of the minute's slots, so 19 more go out and the rest of the burst is only logged
    assert.equal(posts.length, ALERTS_PER_MINUTE - 1, "the rest of the burst is only logged");
  });
});
