// withHotel against a FAKE pool (no database): the statements it sends and their order, the single-statement guard, rollback, a broken connection,
// timeouts and the one retry on a deadlock. The real behaviour (a hotel role that cannot read another hotel's schema) runs on the PostgreSQL
// instance in tests/db/isolation.test.ts.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";
import { createWithHotel, DEFAULT_QUERY_TIMEOUT_MS, type ClientPool, type PooledClient } from "../../src/db/withHotel";
import { AppError } from "../../src/server/errors";

const A = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5b";
const B = "0198a3b2-7c4d-7e5f-8a9b-0c1d2e3f4a5c";
const HEX = A.replaceAll("-", "");
/** The one prelude statement: the role and the search path as parameters, transaction-local (schemaName.ts HOTEL_PRELUDE_SQL). */
const PRELUDE = `SELECT set_config('role', $1, true), set_config('search_path', $2, true) ["hotel_${HEX}_rw","hotel_${HEX}, pg_catalog"]`;

class Conn extends EventEmitter implements PooledClient {
  readonly log: string[] = [];
  released: boolean | undefined;
  failOn = new Map<string, Error>();
  async query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
    this.log.push(params ? `${text} ${JSON.stringify(params)}` : text);
    if (text === "SELECT hang") return new Promise(() => undefined);
    const failure = [...this.failOn].find(([needle]) => text.includes(needle));
    if (failure) throw failure[1];
    if (text.startsWith("INSERT")) return { rows: [], rowCount: 1 };
    return { rows: text.startsWith("SELECT") ? [{ x: 1 }] : [], rowCount: text.startsWith("SELECT") ? 1 : null };
  }
  release(destroy?: boolean): void {
    this.released = destroy === true;
  }
}

function pool(conn: Conn): ClientPool & { connects: number } {
  const p = { connects: 0, connect: async (): Promise<PooledClient> => (p.connects++, conn) };
  return p;
}

describe("withHotel with a schema directory (readable schemas, platform 0172)", () => {
  test("the search path is the schema the directory names; the role is still the hotel's id-based role", async () => {
    const conn = new Conn();
    const asked: string[] = [];
    await createWithHotel(pool(conn), { schemaOf: async (id) => (asked.push(id), "sunrise_group_hotel_sunrise_rajkot") })({ hotelId: A }, async (tx) => {
      assert.equal(tx.schema, "sunrise_group_hotel_sunrise_rajkot");
    });
    assert.deepEqual(asked, [A]);
    assert.deepEqual(conn.log, ["BEGIN", `SELECT set_config('role', $1, true), set_config('search_path', $2, true) ["hotel_${HEX}_rw","sunrise_group_hotel_sunrise_rajkot, pg_catalog"]`, "COMMIT"]);
  });

  test("a name the directory returns that is not a safe hotel schema never reaches the database; an unknown hotel is 'not available'", async () => {
    for (const bad of ["platform", "public", "pg_catalog", "x, platform", 'a"; DROP SCHEMA platform; --']) {
      const conn = new Conn();
      await assert.rejects(() => createWithHotel(pool(conn), { schemaOf: async () => bad })({ hotelId: A }, async () => undefined), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN", bad);
      assert.deepEqual(conn.log, [], `${bad}: nothing was sent`);
    }
    const conn = new Conn();
    await assert.rejects(() => createWithHotel(pool(conn), { schemaOf: async () => { throw new AppError("FORBIDDEN", "Hotel is not available"); } })({ hotelId: A }, async () => undefined), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    assert.equal(conn.log.length, 0);
  });
});
describe("withHotel", () => {
  test("BEGIN, the one prelude (the hotel's role and the search path), the work, COMMIT, release: in that order", async () => {
    const conn = new Conn();
    const result = await createWithHotel(pool(conn))({ hotelId: A }, async (tx) => {
      await tx.query("SELECT 1");
      assert.equal(tx.schema, `hotel_${HEX}`);
      return 42;
    });
    assert.equal(result, 42);
    assert.deepEqual(conn.log, ["BEGIN", PRELUDE, "SELECT 1", "COMMIT"]);
    assert.equal(conn.released, false);
  });

  test("the role and the search path are transaction-local (set_config(..., true)) and parameters, never text: a pooled connection never carries a hotel to the next request", async () => {
    const conn = new Conn();
    await createWithHotel(pool(conn))({ hotelId: B.replaceAll("-", "") }, async () => undefined);
    assert.match(conn.log[1], /^SELECT set_config\('role', \$1, true\), set_config\('search_path', \$2, true\) \[/);
    assert.ok(!conn.log.some((l) => /^SET (LOCAL )?(ROLE|search_path)/i.test(l)), "no session-level SET");
    const params = JSON.parse(conn.log[1].slice(conn.log[1].indexOf(" [") + 1)) as string[];
    assert.deepEqual(params, [`hotel_${B.replaceAll("-", "")}_rw`, `hotel_${B.replaceAll("-", "")}, pg_catalog`]);
  });

  test("a guest or company account's record scope is part of the same prelude, transaction-local (T8, the row-level security policies read it); staff send none; a bad scope never reaches the database", async () => {
    const conn = new Conn();
    await createWithHotel(pool(conn))({ hotelId: A, scope: { kind: "guest", id: B.toUpperCase() } }, async (tx) => tx.query("SELECT 1"));
    assert.deepEqual(conn.log, ["BEGIN", `SELECT set_config('role', $1, true), set_config('search_path', $2, true), set_config('hms.scope_kind', $3, true), set_config('hms.scope_id', $4, true) ["hotel_${HEX}_rw","hotel_${HEX}, pg_catalog","guest","${B}"]`, "SELECT 1", "COMMIT"]);
    const staff = new Conn();
    await createWithHotel(pool(staff))({ hotelId: A }, async () => undefined);
    assert.ok(!staff.log.some((l) => l.includes("hms.scope")), "no scope statement for staff");
    const bad = new Conn();
    await assert.rejects(() => createWithHotel(pool(bad))({ hotelId: A, scope: { kind: "guest", id: "not-a-uuid" } }, async () => undefined), (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    assert.equal(bad.log.length, 0, "refused before a connection was used");
  });

  test("an error in the work rolls back, rethrows the same error and releases a healthy connection", async () => {
    const conn = new Conn();
    const boom = new Error("boom");
    await assert.rejects(
      () => createWithHotel(pool(conn))({ hotelId: A }, async () => {
        throw boom;
      }),
      (e: unknown) => e === boom,
    );
    assert.equal(conn.log.at(-1), "ROLLBACK");
    assert.ok(!conn.log.includes("COMMIT"));
    assert.equal(conn.released, false);
  });

  test("if ROLLBACK itself fails the connection is destroyed, not returned to the pool", async () => {
    const conn = new Conn();
    conn.failOn.set("ROLLBACK", new Error("connection lost"));
    await assert.rejects(
      () => createWithHotel(pool(conn))({ hotelId: A }, async () => {
        throw new Error("first");
      }),
      /first/,
    );
    assert.equal(conn.released, true);
  });

  test("a hotel role that does not exist (22023) is 'Hotel is not available', never the server's text", async () => {
    const conn = new Conn();
    conn.failOn.set("set_config('role'", Object.assign(new Error('role "hotel_x_rw" does not exist'), { code: "22023" }));
    let ran = false;
    await assert.rejects(
      () => createWithHotel(pool(conn))({ hotelId: A }, async () => void (ran = true)),
      (e: unknown) => e instanceof AppError && e.code === "FORBIDDEN" && !e.message.includes("does not exist"),
    );
    assert.equal(ran, false);
  });

  test("a hostile hotel id is refused BEFORE a connection is taken", async () => {
    const conn = new Conn();
    const p = pool(conn);
    for (const bad of [`${A}'; DROP ROLE hms_owner; --`, "", "platform", A.toUpperCase(), null, undefined, 5, {}]) {
      await assert.rejects(() => createWithHotel(p)({ hotelId: bad as never }, async () => undefined), AppError, JSON.stringify(bad));
    }
    assert.equal(p.connects, 0);
    assert.equal(conn.log.length, 0);
  });

  test("a request-supplied value can only ever be a parameter", async () => {
    const conn = new Conn();
    const hostile = "x'; DROP TABLE employees; --";
    await createWithHotel(pool(conn))({ hotelId: A }, async (tx) => {
      await tx.query("SELECT * FROM employees WHERE name = $1", [hostile]);
    });
    const line = conn.log.find((l) => l.startsWith("SELECT * FROM employees"))!;
    assert.ok(line.startsWith("SELECT * FROM employees WHERE name = $1 "));
    assert.ok(!line.split(" [")[0].includes("DROP"));
  });
});

describe("the single-statement guard", () => {
  test("a second statement is refused before the server sees it (an injected `; SET ROLE another_hotel`)", async () => {
    const conn = new Conn();
    await assert.rejects(
      () => createWithHotel(pool(conn))({ hotelId: A }, async (tx) => {
        await tx.query("SELECT 1; SET ROLE hotel_other_rw");
      }),
      (e: unknown) => e instanceof AppError && e.code === "SERVER_ERROR",
    );
    assert.ok(!conn.log.some((l) => l.includes("SET ROLE hotel_other_rw")));
    assert.equal(conn.log.at(-1), "ROLLBACK");
  });

  test("a semicolon inside a string, a quoted name, a dollar-quote or a comment is fine; a trailing semicolon is fine", async () => {
    const conn = new Conn();
    await createWithHotel(pool(conn))({ hotelId: A }, async (tx) => {
      await tx.query("SELECT 'a;b' AS x");
      await tx.query('SELECT 1 AS "a;b"');
      await tx.query("SELECT $$a; b$$ AS x");
      await tx.query("SELECT 1 -- a; SET ROLE x\n");
      await tx.query("SELECT 1 /* a; b */");
      await tx.query("SELECT 1;");
    });
    assert.equal(conn.log.at(-1), "COMMIT");
  });
});

describe("retry on a deadlock", () => {
  test("retryOnDeadlock runs the unit once more after 40P01 or 40001, only when asked, never twice", async () => {
    for (const code of ["40P01", "40001"]) {
      const conn = new Conn();
      let runs = 0;
      const work = async (): Promise<string> => {
        runs += 1;
        if (runs === 1) throw Object.assign(new Error("deadlock detected"), { code });
        return "done";
      };
      assert.equal(await createWithHotel(pool(conn))({ hotelId: A }, work, { retryOnDeadlock: true }), "done");
      assert.equal(runs, 2, code);
      assert.equal(conn.log.filter((l) => l === "BEGIN").length, 2);
      assert.equal(conn.log.filter((l) => l === "ROLLBACK").length, 1);
    }
    // not asked: the error goes straight out
    let single = 0;
    await assert.rejects(
      () => createWithHotel(pool(new Conn()))({ hotelId: A }, async () => {
        single += 1;
        throw Object.assign(new Error("deadlock"), { code: "40P01" });
      }),
      /deadlock/,
    );
    assert.equal(single, 1);
    // asked, but it fails again: only one retry
    let twice = 0;
    await assert.rejects(
      () => createWithHotel(pool(new Conn()))({ hotelId: A }, async () => {
        twice += 1;
        throw Object.assign(new Error("deadlock"), { code: "40P01" });
      }, { retryOnDeadlock: true }),
      /deadlock/,
    );
    assert.equal(twice, 2);
  });

  test("other errors are never retried, even when asked", async () => {
    let runs = 0;
    await assert.rejects(
      () => createWithHotel(pool(new Conn()))({ hotelId: A }, async () => {
        runs += 1;
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }, { retryOnDeadlock: true }),
      /duplicate/,
    );
    assert.equal(runs, 1);
  });
});

describe("a broken connection (A1)", () => {
  test("an error listener is attached for the whole time the connection is ours, and removed before it goes back", async () => {
    const conn = new Conn();
    assert.equal(conn.listenerCount("error"), 0);
    await createWithHotel(pool(conn))({ hotelId: A }, async () => {
      assert.equal(conn.listenerCount("error"), 1);
    });
    assert.equal(conn.listenerCount("error"), 0);
  });

  test("an error event in the middle of a transaction does not crash the process: the request fails and the connection is destroyed", async () => {
    const conn = new Conn();
    await assert.rejects(() =>
      createWithHotel(pool(conn))({ hotelId: A }, async (tx) => {
        await tx.query("SELECT 1");
        conn.emit("error", new Error("terminating connection due to administrator command"));
        await tx.query("SELECT 2");
      }),
    );
    assert.equal(conn.released, true);
  });

  test("a statement that answers 'connection lost' (08006, ECONNRESET) marks the connection broken", async () => {
    for (const code of ["08006", "ECONNRESET", "57P01"]) {
      const conn = new Conn();
      conn.failOn.set("SELECT 1", Object.assign(new Error("lost"), { code }));
      await assert.rejects(() => createWithHotel(pool(conn))({ hotelId: A }, async (tx) => void (await tx.query("SELECT 1"))), /lost/);
      assert.equal(conn.released, true, code);
    }
  });

  test("an error event while the work is not using the connection never throws out of the emitter; the request fails at COMMIT and the connection is destroyed", async () => {
    const conn = new Conn();
    await assert.rejects(() =>
      createWithHotel(pool(conn))({ hotelId: A }, async () => {
        conn.emit("error", new Error("socket closed"));
      }),
    );
    assert.equal(conn.released, true);
  });

  test("a statement that never answers times out, fails the request and destroys the connection", async () => {
    const conn = new Conn();
    await assert.rejects(
      () => createWithHotel(pool(conn), { queryTimeoutMs: 30 })({ hotelId: A }, async (tx) => void (await tx.query("SELECT hang"))),
      (e: unknown) => e instanceof AppError && e.code === "SERVER_ERROR",
    );
    assert.equal(conn.released, true);
  });

  test("a fast statement is not affected by the timeout", async () => {
    const conn = new Conn();
    assert.equal(await createWithHotel(pool(conn), { queryTimeoutMs: 1000 })({ hotelId: A }, async (tx) => (await tx.query("SELECT 1")).rows[0].x), 1);
    assert.equal(conn.released, false);
  });

  test("the timeout covers BEGIN too (a hung server at the first statement)", async () => {
    const conn = new Conn();
    conn.query = () => new Promise(() => undefined);
    await assert.rejects(() => createWithHotel(pool(conn), { queryTimeoutMs: 30 })({ hotelId: A }, async () => undefined), AppError);
    assert.equal(conn.released, true);
  });

  test("the process-wide default is longer than the role's own 15 s statement_timeout", () => {
    assert.ok(DEFAULT_QUERY_TIMEOUT_MS > 15_000);
  });

  test("DML results carry affectedRows, SELECT results carry rows", async () => {
    const conn = new Conn();
    await createWithHotel(pool(conn))({ hotelId: A }, async (tx) => {
      assert.deepEqual(await tx.query("INSERT INTO t VALUES (1)"), { rows: [], affectedRows: 1 });
      assert.deepEqual(await tx.query("SELECT 1"), { rows: [{ x: 1 }], affectedRows: 1 });
    });
  });
});
