import "server-only";
// How a person is made and changed (decision 72): the two database functions write the real tables (platform.logins, the role table of the person's role, platform.user_core and the email and
// mobile guard). Keys are the old column names (username, email, mobile, display_name, password_hash, role_id, account_role, status, ...); a key left out is not touched, a null clears it.
type Query = (text: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export async function createPerson(q: Query, fields: Record<string, unknown>): Promise<string> {
  const r = await q("SELECT platform.create_person($1::jsonb) AS id", [JSON.stringify(fields)]);
  return String(r.rows[0]?.id);
}

/** Changes the named fields of one person; true when the person exists (and, with onlyLive, is not deleted). */
export async function changePerson(q: Query, id: string, fields: Record<string, unknown>, onlyLive = false): Promise<boolean> {
  const r = await q("SELECT platform.change_person($1::uuid, $2::jsonb, $3::boolean) AS n", [id, JSON.stringify(fields), onlyLive]);
  return Number(r.rows[0]?.n) > 0;
}

const COLUMN_OF: Record<string, string> = { username: "username", displayName: "display_name", mobile: "mobile", email: "email" };
/** A patch in the contract's field names as the column keys change_person takes (only the fields that are present). */
export function personFieldsOf(patch: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) if (patch[name] !== undefined) out[COLUMN_OF[name] ?? name] = patch[name];
  return out;
}
