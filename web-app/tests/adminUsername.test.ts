import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { freeUsername, usernameFrom } from "../src/dashboards/groups/admin/username";

describe("username suggested from the name", () => {
  it("joins the words of the name with dots, lower case, letters and numbers only", () => {
    assert.equal(usernameFrom("Anita Shah"), "anita.shah");
    assert.equal(usernameFrom("  Ravi  K. Kumar  "), "ravi.k.kumar");
    assert.equal(usernameFrom("José D'Souza"), "jose.dsouza");
    assert.equal(usernameFrom(""), "");
  });
  it("takes the first free one", () => {
    const taken = new Set(["anita.shah", "anita.shah2"]);
    assert.equal(freeUsername("anita.shah", taken), "anita.shah3");
    assert.equal(freeUsername("ravi", taken), "ravi");
    assert.equal(freeUsername("", taken), "");
  });
});