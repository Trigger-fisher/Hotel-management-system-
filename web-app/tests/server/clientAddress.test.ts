// The caller's address (security review round 3, R3-6): the entry of X-Forwarded-For that the trusted proxy ADDED (counted from the right), never the first one, which the caller may
// have written. One helper (http/clientAddress.ts) for the limits, the system log's address, the API key allow-list and the website enquiry.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clientAddress, trustedHops } from "../../src/server/http/clientAddress";
import { requestMeta } from "../../src/server/http/meta";

const req = (forwarded?: string) => new Request("https://hms.test/x", { headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded } });
const VERCEL = { VERCEL: "1" };
const ELSEWHERE = {};

describe("how many proxies are trusted", () => {
  test("Vercel is always 1; elsewhere HMS_PROXY_HOPS (0 to 5), 1 when missing or not a number", () => {
    assert.equal(trustedHops({ VERCEL: "1", HMS_PROXY_HOPS: "3" }), 1, "the platform sets the header itself, whatever the setting");
    assert.equal(trustedHops({}), 1);
    for (const [raw, hops] of [["0", 0], ["1", 1], ["2", 2], ["5", 5], [" 2 ", 2]] as const) assert.equal(trustedHops({ HMS_PROXY_HOPS: raw }), hops, raw);
    for (const raw of ["", "6", "9", "-1", "x", "1.5", "two"]) assert.equal(trustedHops({ HMS_PROXY_HOPS: raw }), 1, `"${raw}" falls back to 1`);
  });
});

describe("the caller's address", () => {
  test("on Vercel the platform's single entry; a client-written entry in front is ignored", () => {
    assert.equal(clientAddress(req("203.0.113.7"), VERCEL), "203.0.113.7");
    assert.equal(clientAddress(req("9.9.9.9, 203.0.113.7"), VERCEL), "203.0.113.7");
    assert.equal(clientAddress(req("2001:db8::7"), VERCEL), "2001:db8::7");
  });

  test("behind one proxy (Caddy replaces, nginx appends) it is the last entry, so a spoofed first one changes nothing", () => {
    assert.equal(clientAddress(req("203.0.113.7"), ELSEWHERE), "203.0.113.7", "Caddy: the only entry");
    assert.equal(clientAddress(req("10.0.0.1, 10.0.0.2, 203.0.113.7"), ELSEWHERE), "203.0.113.7", "nginx appends the address it saw last");
    assert.equal(clientAddress(req(" 6.6.6.6 ,  203.0.113.7 "), ELSEWHERE), "203.0.113.7", "spaces are cut");
  });

  test("two proxies in a row (a CDN, then Caddy): the entry two from the right is the caller", () => {
    assert.equal(clientAddress(req("6.6.6.6, 203.0.113.7, 198.51.100.4"), { HMS_PROXY_HOPS: "2" }), "203.0.113.7");
    assert.equal(clientAddress(req("203.0.113.7"), { HMS_PROXY_HOPS: "2" }), null, "fewer entries than proxies: not trusted, not guessed");
  });

  test("no proxy (0): the header is not trusted at all; no header: null", () => {
    assert.equal(clientAddress(req("203.0.113.7"), { HMS_PROXY_HOPS: "0" }), null);
    assert.equal(clientAddress(req(), ELSEWHERE), null);
    assert.equal(clientAddress(req(""), ELSEWHERE), null);
    assert.equal(clientAddress(req(" , ,"), ELSEWHERE), null);
  });
});

describe("what uses it", () => {
  test("the system log's address is the proxy's entry and only when it looks like an address", () => {
    assert.equal(requestMeta(req("6.6.6.6, 203.0.113.7"), "t").ip, "203.0.113.7");
    assert.equal(requestMeta(req("203.0.113.7, not-an-address"), "t").ip, null);
    assert.equal(requestMeta(req(), "t").ip, null);
  });
});
