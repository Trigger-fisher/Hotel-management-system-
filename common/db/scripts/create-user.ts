// create-user: the first sign-in account of a fresh database (and any later one an operator makes by hand). The person gets a TEMPORARY password that
// is Argon2id-hashed here and shown to the operator ONCE by the CLI; the account is 'invited' with must_change_password, so the first sign-in makes
// the person choose their own. Runs as hms_owner (the app cannot make users from nothing).
import type { MigrationClient } from "./migrate";

export interface CreateUserInput {
  username: string;
  displayName: string;
  email: string;
  /** One of the 8 account roles (picks the dashboard). */
  accountRole: string;
  /** The built-in hotel role key (picks the permissions inside a hotel). */
  roleKey: string;
  /** The hotel to attach the person to (and make their default), by slug. */
  hotelSlug?: string;
}

const ACCOUNT_ROLES = ["super_admin", "platform_admin", "group_hotel_admin", "hotel_admin", "hotel_user", "corporate_user", "guest_user"];
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const EMAIL = /^[^@\s]+@[^@\s]+$/;

export class CreateUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateUserError";
  }
}

export function validateUserInput(input: CreateUserInput): CreateUserInput {
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  if (!USERNAME.test(username)) throw new CreateUserError("The username must be 3 to 64 lower-case letters, digits, dots, dashes or underscores");
  if (!EMAIL.test(email) || email.length > 254) throw new CreateUserError("The email address is not valid");
  if (input.displayName.trim().length < 1 || input.displayName.length > 120) throw new CreateUserError("The name must be 1 to 120 characters");
  if (!ACCOUNT_ROLES.includes(input.accountRole)) throw new CreateUserError(`The account role must be one of: ${ACCOUNT_ROLES.join(", ")}`);
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(input.roleKey)) throw new CreateUserError("The role key is not valid");
  return { ...input, username, email, displayName: input.displayName.trim() };
}

/** Makes the account in one transaction. `passwordHash` is an Argon2id encoded string made by the caller. Returns the new user's id. */
export async function createUser(owner: MigrationClient, rawInput: CreateUserInput, passwordHash: string): Promise<string> {
  const input = validateUserInput(rawInput);
  await owner.query("BEGIN");
  try {
    const role = await owner.query("SELECT id FROM platform.roles WHERE key = $1 AND hotel_id IS NULL", [input.roleKey]);
    if (!role.rows[0]) throw new CreateUserError(`There is no built-in role "${input.roleKey}"`);
    const inserted = await owner.query(
      "SELECT platform.create_person($1::jsonb) AS id",
      [JSON.stringify({ username: input.username, email: input.email, display_name: input.displayName, password_hash: passwordHash, role_id: role.rows[0].id, account_role: input.accountRole, status: "invited", must_change_password: true })],
    );
    const id = String(inserted.rows[0].id);
    if (input.hotelSlug) {
      const hotel = await owner.query("SELECT id FROM platform.hotels WHERE slug = $1 AND deleted_at IS NULL", [input.hotelSlug]);
      if (!hotel.rows[0]) throw new CreateUserError(`There is no hotel with the slug "${input.hotelSlug}"`);
      await owner.query("INSERT INTO platform.user_hotels (user_id, hotel_id, is_default) VALUES ($1, $2, true)", [id, hotel.rows[0].id]);
    }
    await owner.query("INSERT INTO platform.audit_log (action, entity, entity_id, after) VALUES ('user.create', 'user', $1, $2::jsonb)", [id, JSON.stringify({ username: input.username, accountRole: input.accountRole, roleKey: input.roleKey })]);
    await owner.query("COMMIT");
    return id;
  } catch (error) {
    try {
      await owner.query("ROLLBACK");
    } catch {
      // the connection is gone; the server rolls back
    }
    if ((error as { code?: string }).code === "23505") throw new CreateUserError("That username or email address is already taken");
    throw error;
  }
}
