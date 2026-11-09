// The SQL lint (PostgreSQL) reads migration and seed text only. First the REAL folders must be clean, then each rule is proven by feeding it a file
// that breaks that rule (and a good file that must pass). The rules are listed at the top of db/scripts/lint-sql.ts.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { formatViolations, lintDirectory, lintSql, type Kind, type Scope } from "../../../common/db/scripts/lint-sql";

const dbRoot = path.join(__dirname, "..", "..", "..", "common", "db");

const ROLLBACK = "-- rollback: DROP TABLE IF EXISTS platform.things;";
const STD = [
  "id uuid PRIMARY KEY DEFAULT uuidv7()",
  "created_at timestamptz NOT NULL DEFAULT now()",
  "updated_at timestamptz NOT NULL DEFAULT now()",
];

interface TableOptions {
  scope?: Scope;
  std?: string[];
  ifNotExists?: boolean;
  comment?: string;
  trigger?: boolean;
}

/** A CREATE TABLE with the standard columns, `cols` and `items` (keys, constraints) added, and the touch trigger; qualified by scope like the real files. */
function table(name: string, cols: string[] = [], items: string[] = [], opts: TableOptions = {}): string {
  const scope = opts.scope ?? "platform";
  const full = scope === "platform" ? `platform.${name}` : name;
  const body = [...(opts.std ?? STD), ...(scope === "hotel" && !(opts.std ?? []).length ? ["legacy_id bigint"] : []), ...cols, ...items];
  const trigger = opts.trigger === false ? "" : `\nDROP TRIGGER IF EXISTS ${name}_touch ON ${full};\nCREATE TRIGGER ${name}_touch BEFORE UPDATE ON ${full} FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`;
  const legacy = scope === "hotel" ? `\nCREATE UNIQUE INDEX IF NOT EXISTS ${name}_legacy_key ON ${full} (legacy_id) WHERE legacy_id IS NOT NULL;` : "";
  return `${opts.comment ? `${opts.comment}\n` : ""}CREATE TABLE ${opts.ifNotExists === false ? "" : "IF NOT EXISTS "}${full} (\n  ${body.join(",\n  ")}\n);${legacy}${trigger}`;
}

interface LintOptions {
  scope?: Scope;
  name?: string;
  kind?: Kind;
  /** Append a GRANT for every fixture table (default), so a test about another rule is not drowned by the grants rule. */
  grants?: boolean;
}

const FIXTURE_TABLES = ["things", "parents", "kids", "pairs", "notes", "tries", "others", "log"];

function lint(text: string, options: LintOptions = {}): string[] {
  const scope = options.scope ?? "platform";
  const grant = FIXTURE_TABLES.map((t) => `GRANT SELECT, INSERT, UPDATE ON platform.${t} TO hms_app;`).join("\n");
  const withGrants = scope === "platform" && options.grants !== false && (options.kind ?? "migration") === "migration" ? `${text}\n${grant}` : text;
  return lintSql([{ name: options.name ?? "0001_things.sql", text: withGrants }], { scope, kind: options.kind }).map((v) => `${v.rule}: ${v.message}`);
}

const rules = (text: string, options: LintOptions = {}): string[] => [...new Set(lint(text, options).map((l) => l.split(":")[0]))];
const good = (extra = ""): string => `${ROLLBACK}\n${table("things", ["name text NOT NULL"])}\n${extra}`;

describe("the real migrations and seeds", () => {
  test("platform migrations are clean", () => {
    const v = lintDirectory(path.join(dbRoot, "migrations", "platform"), "platform");
    assert.equal(v.length, 0, formatViolations(v));
  });
  test("hotel migrations are clean", () => {
    const v = lintDirectory(path.join(dbRoot, "migrations", "hotel"), "hotel");
    assert.equal(v.length, 0, formatViolations(v));
  });
  test("seed folders are clean", () => {
    for (const scope of ["platform", "hotel"] as const) {
      const v = lintDirectory(path.join(dbRoot, "seeds", scope), scope, "seed");
      assert.equal(v.length, 0, `${scope}: ${formatViolations(v)}`);
    }
  });
});

describe("a good file passes", () => {
  test("a minimal valid platform table", () => assert.deepEqual(lint(good()), []));

  test("a foreign key with its index, a status with its CHECK, money in paise, a partial unique index", () => {
    const text = `${ROLLBACK}
${table("parents", ["name text NOT NULL"])}
${table("kids", [
  "parent_id uuid NOT NULL REFERENCES platform.parents (id)",
  "status text NOT NULL CHECK (status IN ('open', 'closed'))",
  "fee_paise bigint NOT NULL CHECK (fee_paise >= 0)",
])}
CREATE INDEX IF NOT EXISTS kids_parent_idx ON platform.kids (parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS kids_open_key ON platform.kids (parent_id) WHERE status = 'open';`;
    assert.deepEqual(lint(text), []);
  });

  test("a forward-only rollback with a reason", () => {
    assert.deepEqual(lint(`-- rollback: forward-only because the table only grows and nothing reads it yet\n${table("things")}`), []);
  });

  test("comments and quoted text never trigger a rule", () => {
    const text = `${ROLLBACK}\n-- a float price and a serial id would be refused here\n${table("things", ["name text NOT NULL DEFAULT 'real float serial money'"])}`;
    assert.deepEqual(lint(text), []);
  });

  test("a hotel table is unqualified and needs legacy_id and its partial unique index", () => {
    assert.deepEqual(lint(`${ROLLBACK}\n${table("things", ["name text NOT NULL"], [], { scope: "hotel" })}`, { scope: "hotel" }), []);
  });
});

describe("each rule fails on a file that breaks it", () => {
  test("rollback: missing, vague, or forward-only with no reason", () => {
    assert.ok(rules(table("things")).includes("rollback"));
    assert.ok(rules(`-- some comment\n${table("things")}`).includes("rollback"));
    assert.ok(rules(`-- rollback: undo it\n${table("things")}`).includes("rollback"));
    assert.ok(rules(`-- rollback: forward-only because\n${table("things")}`).includes("rollback"));
  });

  test("file-name: bad names and an empty file", () => {
    for (const name of ["things.sql", "1_things.sql", "0001_Things.sql", "0001-things.sql", "0001_things.txt"]) assert.ok(rules(good(), { name }).includes("file-name"), name);
    assert.ok(rules(`${ROLLBACK}\n`, { grants: false }).includes("file-name"));
  });

  test("qualified-name: a platform table is written platform.<name>; a hotel table is unqualified", () => {
    assert.ok(rules(`${ROLLBACK}\n${table("things").replaceAll("platform.", "")}`).includes("qualified-name"));
    assert.ok(rules(`${ROLLBACK}\n${table("things", [], [], { scope: "platform" }).replace("platform.things", "hotel_x.things")}`, { scope: "hotel" }).includes("qualified-name"));
    assert.ok(rules(`${ROLLBACK}\n${table("things")}`, { scope: "hotel" }).includes("qualified-name"));
  });

  test("uuid-pk: no id, an integer id, an id kept as text", () => {
    for (const std of [STD.slice(1), ["id serial PRIMARY KEY", ...STD.slice(1)], ["id integer PRIMARY KEY", ...STD.slice(1)], ["id text PRIMARY KEY", ...STD.slice(1)]]) {
      assert.ok(rules(`${ROLLBACK}\n${table("things", [], [], { std })}`).includes("uuid-pk"), std[0]);
    }
  });

  test("timestamps: missing, nullable, or without a time zone", () => {
    assert.ok(rules(`${ROLLBACK}\n${table("things", [], [], { std: [STD[0]] })}`).includes("timestamps"));
    assert.ok(rules(`${ROLLBACK}\n${table("things", [], [], { std: [STD[0], "created_at timestamptz DEFAULT now()", STD[2]] })}`).includes("timestamps"));
    assert.ok(rules(`${ROLLBACK}\n${table("things", [], [], { std: [STD[0], "created_at timestamp NOT NULL DEFAULT now()", STD[2]] })}`).includes("types"));
  });

  test("updated-at-trigger: a table with updated_at needs its touch trigger", () => {
    assert.ok(rules(`${ROLLBACK}\n${table("things", [], [], { trigger: false })}`).includes("updated-at-trigger"));
  });

  test("fk-index: a foreign key column with no index is refused; a leading column of a unique key or a primary key counts; a partial index does not", () => {
    const fk = ["parent_id uuid NOT NULL REFERENCES platform.parents (id)"];
    assert.ok(rules(`${ROLLBACK}\n${table("parents")}\n${table("kids", fk)}`).includes("fk-index"));
    assert.ok(!rules(`${ROLLBACK}\n${table("parents")}\n${table("kids", fk, ["UNIQUE (parent_id, id)"])}`).includes("fk-index"));
    assert.ok(!rules(`${ROLLBACK}\n${table("parents")}\n${table("kids", fk)}\nCREATE INDEX IF NOT EXISTS kids_p ON platform.kids (parent_id);`).includes("fk-index"));
    assert.ok(rules(`${ROLLBACK}\n${table("parents")}\n${table("kids", fk)}\nCREATE INDEX IF NOT EXISTS kids_p ON platform.kids (parent_id) WHERE parent_id IS NOT NULL;`).includes("fk-index"));
    assert.ok(rules(`${ROLLBACK}\n${table("parents")}\n${table("kids", fk)}\nCREATE INDEX IF NOT EXISTS kids_p ON platform.kids (id, parent_id);`).includes("fk-index"));
  });

  test("types: float, double precision, real, serial, money and a timestamp without a zone are refused", () => {
    for (const type of ["float", "double precision", "real", "serial", "bigserial", "money", "timestamp", "timestamp without time zone"]) {
      assert.ok(rules(`${ROLLBACK}\n${table("things", [`x ${type}`])}`).includes("types"), type);
    }
    assert.ok(!rules(`${ROLLBACK}\n${table("things", ["x numeric(5,2)", "y timestamptz", "z jsonb"])}`).includes("types"));
  });

  test("the AI archive schema is the one other schema a platform migration may create tables in, and its US dollar cost is the one money column that is not in paise", () => {
    const archive = `${ROLLBACK}\n${table("things", ["cost_usd numeric(12,6) NOT NULL"]).replaceAll("platform.things", "ai_archive.things")}`;
    assert.deepEqual(rules(archive), []);
    // any other schema is still refused, and a US dollar column anywhere else is still refused
    assert.ok(rules(archive.replaceAll("ai_archive.things", "other_schema.things")).includes("qualified-name"));
    assert.ok(rules(`${ROLLBACK}\n${table("things", ["cost_usd numeric(12,6) NOT NULL"])}`).includes("money"));
    // and inside the archive an ordinary money name is still refused
    assert.ok(rules(archive.replace("cost_usd numeric(12,6)", "amount bigint")).includes("money"));
  });

  test("money: _paise must be bigint; a money-looking name must end _paise", () => {
    assert.ok(rules(`${ROLLBACK}\n${table("things", ["fee_paise integer NOT NULL"])}`).includes("money"));
    assert.ok(rules(`${ROLLBACK}\n${table("things", ["fee_paise numeric NOT NULL"])}`).includes("money"));
    for (const name of ["amount", "price", "total", "balance"]) assert.ok(rules(`${ROLLBACK}\n${table("things", [`${name} bigint NOT NULL`])}`).includes("money"), name);
    assert.ok(!rules(`${ROLLBACK}\n${table("things", ["fee_paise bigint NOT NULL"])}`).includes("money"));
  });

  test("status-check: a text status/kind/level/purpose/outcome/event/client column needs a CHECK", () => {
    for (const name of ["status", "kind", "level", "purpose", "outcome", "event", "client"]) {
      assert.ok(rules(`${ROLLBACK}\n${table("things", [`${name} text NOT NULL`])}`).includes("status-check"), name);
      assert.ok(!rules(`${ROLLBACK}\n${table("things", [`${name} text NOT NULL CHECK (${name} IN ('a', 'b'))`])}`).includes("status-check"), name);
    }
  });

  test("drop-if-exists: DROP and ALTER ... DROP need IF EXISTS", () => {
    assert.ok(rules(good("DROP INDEX kids_p;")).includes("drop-if-exists"));
    assert.ok(rules(good("ALTER TABLE platform.things DROP COLUMN name;")).includes("drop-if-exists"));
    assert.ok(!rules(good("DROP INDEX IF EXISTS kids_p;")).includes("drop-if-exists"));
  });

  test("unverifiable: a foreign key added with ADD COLUMN ... REFERENCES cannot be checked; an ADD FOREIGN KEY is checked against the folder's indexes", () => {
    assert.ok(rules(`${ROLLBACK}\n${table("parents")}\n${table("kids")}\nALTER TABLE platform.kids ADD COLUMN parent_id uuid REFERENCES platform.parents (id);`).includes("unverifiable"));
    assert.ok(rules(`${ROLLBACK}\n${table("parents")}\n${table("kids", ["parent_id uuid"])}\nALTER TABLE platform.kids ADD FOREIGN KEY (parent_id) REFERENCES platform.parents (id);`).includes("fk-index"));
    assert.ok(!rules(`${ROLLBACK}\n${table("parents")}\n${table("kids", ["parent_id uuid"])}\nCREATE INDEX IF NOT EXISTS kids_p ON platform.kids (parent_id);\nALTER TABLE platform.kids ADD FOREIGN KEY (parent_id) REFERENCES platform.parents (id);`).includes("fk-index"));
  });

  test("no-encryption: a column shaped for ciphertext or a blind index is refused (the values are plain text)", () => {
    for (const name of ["to_email_enc", "id_number_cipher", "account_sealed", "id_proof_number_index", "id_blind", "blind_index"]) {
      assert.ok(rules(`${ROLLBACK}\n${table("things", [`${name} text`])}`).includes("no-encryption"), name);
    }
    assert.ok(!rules(`${ROLLBACK}\n${table("things", ["to_email text NOT NULL", "payload text", "id_proof_number text"])}`).includes("no-encryption"));
  });

  test("no-encryption: only the decided sealed ID-number columns (decision 74) are allowed, and only on their own tables", () => {
    assert.ok(!rules(`${ROLLBACK}\n${table("customers", ["id_proof_number_sealed text", "id_proof_number_idx char(64)"])}`).includes("no-encryption"));
    assert.ok(!rules(`${ROLLBACK}\n${table("pms_stays", ["id_proof_number_sealed text", "id_proof_number_idx char(64)"])}`).includes("no-encryption"));
    assert.ok(!rules(`${ROLLBACK}\n${table("employees", ["id_proof_number_sealed text", "id_proof_number_idx char(64)", "account_number_sealed text", "ifsc_code_sealed text"])}`).includes("no-encryption"), "the staff numbers (decision 74) are decided too");
    assert.ok(rules(`${ROLLBACK}\n${table("deductions", ["id_proof_number_sealed text"])}`).includes("no-encryption"), "another table is still refused");
    assert.ok(rules(`${ROLLBACK}\n${table("employees", ["contact_number_sealed text"])}`).includes("no-encryption"), "another column of a decided table is still refused");
    assert.ok(rules(`${ROLLBACK}\n${table("customers", ["mobile_sealed text"])}`).includes("no-encryption"), "another column is still refused");
  });

  test("a file can break several rules at once and every one is reported", () => {
    const found = rules(`-- nothing\nCREATE TABLE things (id serial PRIMARY KEY, price float, fee_paise integer, status text);\nDROP TABLE other;`);
    for (const rule of ["rollback", "qualified-name", "uuid-pk", "timestamps", "types", "money", "status-check", "drop-if-exists"]) assert.ok(found.includes(rule), rule);
  });
});

describe("standard columns and append-only tables", () => {
  test("a counter table keyed by its natural key is exempt from the standard columns, with a reason", () => {
    const keyed = (comment: string) => `${ROLLBACK}\n${table("things", ["name text PRIMARY KEY", "next_no bigint NOT NULL"], [], { std: [], trigger: false, comment })}`;
    assert.ok(rules(keyed("")).some((r) => ["uuid-pk", "timestamps", "standard-columns"].includes(r)));
    assert.ok(!rules(keyed("-- no-standard-columns: a counter keyed by its book name")).some((r) => ["uuid-pk", "timestamps"].includes(r)));
  });

  const appendOnly = (extra: string[] = [], items: string[] = []) => `${ROLLBACK}\n${table("parents")}\n${table("log", ["at timestamptz NOT NULL DEFAULT now()", ...extra], items, { std: ["id uuid PRIMARY KEY DEFAULT uuidv7()"], trigger: false, comment: "-- append-only" })}`;

  test("an append-only table needs an at column instead of created_at/updated_at", () => {
    assert.ok(!rules(appendOnly()).includes("timestamps"));
    assert.ok(rules(appendOnly().replace("at timestamptz NOT NULL DEFAULT now()", "note text")).includes("timestamps"));
  });

  test("append-only-fk: SET NULL, CASCADE and SET DEFAULT foreign keys are refused; RESTRICT, NO ACTION and no clause are fine", () => {
    for (const action of ["SET NULL", "CASCADE", "SET DEFAULT"]) {
      assert.ok(rules(appendOnly([`parent_id uuid REFERENCES platform.parents (id) ON DELETE ${action}`], [])).includes("append-only-fk"), action);
    }
    for (const clause of ["ON DELETE RESTRICT", "ON DELETE NO ACTION", ""]) {
      assert.ok(!rules(appendOnly([`parent_id uuid REFERENCES platform.parents (id) ${clause}`])).includes("append-only-fk"), clause || "none");
    }
    const mutable = `${ROLLBACK}\n${table("parents")}\n${table("kids", ["parent_id uuid REFERENCES platform.parents (id) ON DELETE CASCADE"])}\nCREATE INDEX IF NOT EXISTS kids_p ON platform.kids (parent_id);`;
    assert.ok(!rules(mutable).includes("append-only-fk"), "a normal table may use CASCADE");
  });
});

describe("grants (platform only)", () => {
  const bare = `${ROLLBACK}\n${table("things")}`;

  test("a platform table with no GRANT anywhere is refused", () => assert.ok(rules(bare, { grants: false }).includes("grants")));

  test("a GRANT in the folder counts; so does -- no-app-access", () => {
    assert.ok(!rules(bare).includes("grants"));
    assert.ok(!rules(`${ROLLBACK}\n${table("things", [], [], { comment: "-- no-app-access" })}`, { grants: false }).includes("grants"));
  });

  test("a GRANT for another table does not cover this one; several tables in one GRANT all count", () => {
    assert.ok(rules(`${bare}\nGRANT SELECT ON platform.others TO hms_app;`, { grants: false }).includes("grants"));
    assert.ok(!rules(`${bare}\n${table("others")}\nGRANT SELECT ON platform.things, platform.others TO hms_app;`, { grants: false }).includes("grants"));
  });

  test("a table created in a file numbered 0100 or higher needs its own GRANT in that file", () => {
    assert.ok(rules(bare, { name: "0100_things.sql", grants: false }).includes("grants-own-file"));
    assert.ok(!rules(`${bare}\nGRANT SELECT ON platform.things TO hms_app;`, { name: "0100_things.sql", grants: false }).includes("grants-own-file"));
  });

  test("the grants rule is for platform only: a hotel file that grants anything is refused instead", () => {
    assert.ok(!rules(`${ROLLBACK}\n${table("things", [], [], { scope: "hotel" })}`, { scope: "hotel" }).includes("grants"));
    for (const statement of ["GRANT SELECT ON things TO hms_app;", "REVOKE ALL ON things FROM hms_app;", "ALTER DEFAULT PRIVILEGES IN SCHEMA x GRANT SELECT ON TABLES TO y;"]) {
      assert.ok(rules(`${ROLLBACK}\n${table("things", [], [], { scope: "hotel" })}\n${statement}`, { scope: "hotel" }).includes("hotel-grants"), statement);
    }
  });
});

describe("hotel rules", () => {
  const hotel = (cols: string[] = [], items: string[] = [], opts: TableOptions = {}) => `${ROLLBACK}\n${table("things", cols, items, { ...opts, scope: "hotel" })}`;

  test("legacy-id: a missing column, NOT NULL, a wrong type, or no partial unique key", () => {
    assert.ok(rules(hotel().replace("legacy_id bigint", "x int"), { scope: "hotel" }).includes("legacy-id"));
    assert.ok(rules(hotel().replace("legacy_id bigint", "legacy_id bigint NOT NULL"), { scope: "hotel" }).includes("legacy-id"));
    assert.ok(rules(hotel().replace("legacy_id bigint", "legacy_id integer"), { scope: "hotel" }).includes("legacy-id"));
    assert.ok(rules(hotel().replace(/CREATE UNIQUE INDEX[^\n]*\n/, ""), { scope: "hotel" }).includes("legacy-id"));
    assert.ok(!rules(hotel(), { scope: "hotel" }).includes("legacy-id"));
  });

  test("the version tables and the idempotency keys need no legacy_id", () => {
    const text = `${ROLLBACK}\n${table("schema_migrations", ["version text NOT NULL UNIQUE"], [], { scope: "hotel" }).replace("legacy_id bigint,\n  ", "")}`;
    assert.ok(!rules(text.replace(/\nCREATE UNIQUE INDEX[^\n]*/, ""), { scope: "hotel" }).includes("legacy-id"));
  });

  test("soft-delete and hard-delete: every Pallav soft-delete table needs deleted_at/deleted_by and a cited hard-delete marker", () => {
    const employees = (comment: string, cols: string[]) => `${ROLLBACK}\n${table("employees", cols, [], { scope: "hotel", comment }).replace("CREATE TABLE IF NOT EXISTS employees", "CREATE TABLE IF NOT EXISTS employees")}`;
    const soft = ["deleted_at timestamptz", "deleted_by uuid"];
    assert.ok(rules(employees("", soft), { scope: "hotel" }).includes("hard-delete"));
    assert.ok(rules(employees("-- hard-delete: because", soft), { scope: "hotel" }).includes("hard-delete"));
    assert.ok(!rules(employees("-- hard-delete: Pallav app/Models/Employee.php:12", soft), { scope: "hotel" }).includes("hard-delete"));
    assert.ok(rules(employees("-- hard-delete: Pallav app/Models/Employee.php:12", []), { scope: "hotel" }).includes("soft-delete"));
  });

  test("version-trigger: a table with a version column needs a BEFORE UPDATE trigger running enforce_version_step()", () => {
    assert.ok(rules(hotel(["version integer NOT NULL DEFAULT 1 CHECK (version >= 1)"]), { scope: "hotel" }).includes("version-trigger"));
    const withTrigger = `${hotel(["version integer NOT NULL DEFAULT 1 CHECK (version >= 1)"])}\nDROP TRIGGER IF EXISTS things_version_step ON things;\nCREATE TRIGGER things_version_step BEFORE UPDATE ON things FOR EACH ROW EXECUTE FUNCTION enforce_version_step();`;
    assert.ok(!rules(withTrigger, { scope: "hotel" }).includes("version-trigger"));
  });

  test("money columns and foreign key indexes still apply in hotel files", () => {
    assert.ok(rules(hotel(["fee_paise integer"]), { scope: "hotel" }).includes("money"));
    assert.ok(rules(hotel(["parent_id uuid REFERENCES parents (id)"]), { scope: "hotel" }).includes("fk-index"));
  });
});

describe("seed files", () => {
  const seed = (text: string, scope: Scope = "platform") => rules(text, { scope, kind: "seed", name: "0001_x.sql" });

  test("an idempotent INSERT ... ON CONFLICT passes", () => {
    assert.deepEqual(lint("-- seed: roles\nINSERT INTO platform.roles (key) VALUES ('a') ON CONFLICT (key) DO NOTHING;", { kind: "seed" }), []);
    assert.deepEqual(lint("-- seed: roles\nINSERT INTO platform.roles (key)\nSELECT v.key FROM (VALUES ('a')) AS v(key)\nON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key;", { kind: "seed" }), []);
  });

  test("seed-header: a missing or wrong first line", () => {
    assert.ok(seed("INSERT INTO platform.roles (key) VALUES ('a') ON CONFLICT DO NOTHING;").includes("seed-header"));
    assert.ok(seed("-- rollback: DELETE FROM platform.roles\nINSERT INTO platform.roles (key) VALUES ('a') ON CONFLICT DO NOTHING;").includes("seed-header"));
  });

  test("seed-statement: only INSERT ... ON CONFLICT: no plain INSERT, UPDATE, DELETE, TRUNCATE, DDL or GRANT", () => {
    for (const statement of ["INSERT INTO platform.roles (key) VALUES ('a');", "UPDATE platform.roles SET key = 'a';", "DELETE FROM platform.roles;", "TRUNCATE platform.roles;", "CREATE TABLE platform.x (id uuid);", "GRANT SELECT ON platform.roles TO hms_app;"]) {
      assert.ok(seed(`-- seed: x\n${statement}`).includes("seed-statement"), statement);
    }
  });

  test("seed-secret: no password hash, private key or token literal", () => {
    for (const secret of ["$argon2id$v=19$m=65536$abc", "-----BEGIN PRIVATE KEY-----"]) {
      assert.ok(seed(`-- seed: x\nINSERT INTO platform.users (password_hash) VALUES ('${secret}') ON CONFLICT DO NOTHING;`).includes("seed-secret"), secret);
    }
  });
});
