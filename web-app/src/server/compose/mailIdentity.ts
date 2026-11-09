import "server-only";
import { getDatabase } from "../../db";
import { mailAddressOf, sendingDomainOf } from "../mail/sendingDomain";

/**
 * A hotel's place on the platform's mail: its slug (the local part of its address) and the platform's sending domain, which is the domain of the From address saved in Platform settings > Mail
 * (the older mail.sending_domain row only counts while there is no such address). Both null while the hotel or the domain is not there. `address` is <slug>@<domain>: the address a hotel that
 * uses the platform's mail sends from; null for a reserved name (support, billing, ...).
 */
export async function platformMailIdentityOf(hotelId: string): Promise<{ slug: string | null; domain: string | null; address: string | null }> {
  const client = await getDatabase().pool.connect();
  try {
    const r = await client.query(
      "SELECT h.slug, (SELECT value #>> '{}' FROM platform.platform_settings WHERE key = 'mail.from_email') AS from_email, (SELECT value #>> '{}' FROM platform.platform_settings WHERE key = 'mail.sending_domain') AS domain FROM platform.hotels h WHERE h.id = $1 AND h.deleted_at IS NULL",
      [hotelId],
    );
    const slug = r.rows[0]?.slug ? String(r.rows[0].slug) : null;
    const domain = sendingDomainOf(r.rows[0]?.from_email ? String(r.rows[0].from_email) : null, r.rows[0]?.domain ? String(r.rows[0].domain) : null);
    return { slug, domain, address: mailAddressOf(slug, domain) };
  } finally {
    client.release();
  }
}
