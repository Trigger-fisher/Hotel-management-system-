// Makes the canary decoy file (security/docs/SECURITY-INTEGRATION-PLAN-2026-11-01.md section 8): a fake guest list whose "photo link" column is a canary address on THIS server.
// Opening that address (or a script fetching every link) raises a Critical alert. Run:  HMS_HASH_KEY=... HMS_PUBLIC_URL=https://easyhotelsolutions.in npm run security:decoy -- driveexport out.csv
// The LABEL (letters and digits, up to 24) says where you plant the file, so the alert tells you which decoy was read. Keep the file OUT of the nightly backups and out of the project: put it
// where an intruder would look (an "old exports" folder on the server, a shared drive), never inside a hotel's data. It holds invented people only.
import { writeFileSync } from "node:fs";
import { parseHashKey } from "../src/server/crypto/hash";
import { canaryToken, canaryUrl, decoyGuestCsv, verifyCanary } from "../src/server/services/security/honeypot";

const [label, out] = process.argv.slice(2);
const secret = process.env.HMS_HASH_KEY;
const publicUrl = process.env.HMS_PUBLIC_URL;
if (!label || !/^[a-z0-9]{1,24}$/.test(label) || !out || !secret || !publicUrl || !/^https:\/\//.test(publicUrl)) {
  console.error("Usage: HMS_HASH_KEY=<server key> HMS_PUBLIC_URL=https://<your domain> npm run security:decoy -- <label a-z0-9, up to 24> <output.csv>");
  process.exit(1);
}
const key = parseHashKey(secret);
const token = canaryToken(key, label);
if (verifyCanary(key, token) !== label) throw new Error("the canary token does not verify");
writeFileSync(out, decoyGuestCsv(canaryUrl(publicUrl, token)), { mode: 0o600, flag: "wx" });
console.log(`Wrote ${out} (decoy "${label}"). Opening its link alerts you; the key itself is not in the file.`);
