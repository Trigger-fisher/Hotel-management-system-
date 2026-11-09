import "server-only";
import { smtpChecks } from "../../mail/smtp";
// The settings the SuperAdmin manages (Pallav Support/Settings::groups): general details, the bill header's GSTINs, email, the two Razorpay accounts, backup
// and the recycle bin's keep time. Secrets are stored as typed and never returned: only whether one is set. HMS leaves out chat-app messaging and the encryption screens (MJ), and
// adds the bill header group (MJ #20 A). Spec: docs/specs/admin.md §4.

export type FieldType = "text" | "email" | "number" | "password" | "select" | "toggle" | "textarea";

export interface FieldDef {
  label: string;
  type: FieldType;
  secret?: boolean;
  default?: string;
  options?: Record<string, string>;
  help?: string;
  placeholder?: string;
  /** HMS: an extra check on the typed value (returns the message, or null when fine). */
  check?: (value: string) => string | null;
}

export interface GroupDef {
  label: string;
  icon: string;
  about: string;
  fields: Record<string, FieldDef>;
}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const gstin = (label: string) => (value: string): string | null => (value === "" || GSTIN.test(value.toUpperCase()) ? null : `${label} must be a valid GSTIN, for example 24ABCDE1234F1Z5.`);
const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
/** A list of up to ten addresses, separated by commas, semicolons or spaces. */
const addresses = (label: string) => (value: string): string | null => {
  const list = value.split(/[\s,;]+/).filter(Boolean);
  if (list.length > 10) return `${label} can hold at most 10 addresses.`;
  const bad = list.find((a) => !ADDRESS.test(a));
  return bad ? `${label}: "${bad}" is not a valid email address.` : null;
};
const hhmm = (label: string) => (value: string): string | null => (value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : `${label} must be a 24-hour time such as 12:00.`);

const razorpay = (book: "hotel" | "food", name: string, holds: string): GroupDef => ({
  label: `Razorpay · ${name}`,
  icon: book === "hotel" ? "bi-building" : "bi-cup-hot",
  about: `The Razorpay account that receives ${name} payments. ${holds}`,
  fields: {
    [`razorpay_${book}.enabled`]: { label: `Take online payments for ${name}`, type: "toggle" },
    [`razorpay_${book}.mode`]: { label: "Mode", type: "select", options: { test: "Test", live: "Live" }, default: "test" },
    [`razorpay_${book}.key_id`]: { label: "Key ID", type: "text", placeholder: "rzp_test_xxxxxxxx" },
    [`razorpay_${book}.key_secret`]: { label: "Key secret", type: "password", secret: true },
    [`razorpay_${book}.webhook_secret`]: { label: "Webhook secret", type: "password", secret: true, help: "Set the same value in the Razorpay dashboard webhook for this account." },
  },
});

/** The groups in the order the screen shows them. */
export const SETTING_GROUPS: Record<string, GroupDef> = {
  general: {
    label: "General",
    icon: "bi-sliders",
    about: "How the site presents itself to guests and companies.",
    fields: {
      "general.site_name": { label: "Site name", type: "text", default: "{hotel}" },
      "general.food_name": { label: "Food business name", type: "text", placeholder: "{hotel} Food", help: "The name of the food business on screens and bills. Empty means the name of the food payroll company (the hotel name followed by Food)." },
      "general.support_email": { label: "Support email", type: "email" },
      "general.support_phone": { label: "Support phone", type: "text" },
      "general.address": { label: "Address on bills", type: "textarea" },
      "general.check_in_time": { label: "Check-in time", type: "text", default: "12:00", help: "Hours and minutes, for example 12:00 for noon or 14:30 for 2:30 pm.", check: hhmm("Check-in time") },
      "general.check_out_time": { label: "Check-out time", type: "text", default: "11:00", check: hhmm("Check-out time") },
      "general.portal_enabled": { label: "Guest and company portal", type: "toggle", help: "Lets guests and companies sign in to see bills and book rooms." },
    },
  },
  billing: {
    label: "Bill header",
    icon: "bi-receipt",
    about: "The GSTINs printed under each business's name on bills and receipts.",
    fields: {
      "billing.hotel_gstin": { label: "Hotel GSTIN", type: "text", placeholder: "24ABCDE1234F1Z5", check: gstin("Hotel GSTIN") },
      "billing.food_gstin": { label: "Food business GSTIN", type: "text", placeholder: "24ABCDE1234F2Z4", check: gstin("Food business GSTIN") },
    },
  },
  email: {
    label: "Email",
    icon: "bi-envelope-at",
    about: "Where credentials, statements and receipts are sent from.",
    fields: {
      "email.mode": { label: "Mail", type: "select", options: { platform: "Use the platform's mail", own: "Use my own mail" }, default: "platform", help: "The platform's mail needs nothing from you: your mail goes out from an address made from your hotel's name, with your hotel's name as the sender name and your address as the reply-to. With your own mail you bring a mail service and its login." },
      "email.provider": { label: "Mail service", type: "select", options: { ses: "Amazon SES", brevo: "Brevo", gmail: "Gmail", smtp: "Other SMTP server", domain: "My own domain (sent by the platform)" }, default: "ses", help: "Only for your own mail: the service that sends it. \"My own domain\" needs no account: the platform sends from your address once your domain is verified." },
      "email.username": { label: "Login", type: "text", placeholder: "name@gmail.com", help: "Gmail: the Gmail address. Brevo, Amazon SES and other servers: the SMTP login.", check: (v) => (smtpChecks.user(v) ? null : "The login is too long.") },
      "email.password": { label: "Password / key", type: "password", secret: true, help: "A Google app password, a Brevo SMTP key, the SES SMTP password or the server's password, saved encrypted. Leave empty to keep the saved one." },
      "email.host": { label: "Server (host)", type: "text", placeholder: "smtp.example.com", help: "Only for another SMTP server." },
      "email.port": { label: "Port", type: "number", default: "587", help: "Only for another SMTP server." },
      "email.encryption": { label: "Security", type: "select", options: { tls: "STARTTLS (port 587)", ssl: "SSL/TLS (port 465)", none: "None (a private relay only)" }, default: "tls", help: "Only for another SMTP server." },
      "email.region": { label: "Amazon SES region", type: "select", options: { "ap-south-1": "Mumbai (ap-south-1)", "ap-southeast-1": "Singapore (ap-southeast-1)", "ap-southeast-2": "Sydney (ap-southeast-2)", "ap-northeast-1": "Tokyo (ap-northeast-1)", "eu-west-1": "Ireland (eu-west-1)", "eu-central-1": "Frankfurt (eu-central-1)", "us-east-1": "N. Virginia (us-east-1)", "us-west-2": "Oregon (us-west-2)" }, default: "ap-south-1", help: "Only for Amazon SES." },
      "email.from_address": { label: "From address", type: "email", help: "The address mail comes from, verified with the service. Not used for Gmail (Gmail sends from the Gmail address)." },
      "email.from_name": { label: "Sender name", type: "text", default: "{hotel}", help: "{hotel} stands for this hotel's name." },
      "email.reply_to": { label: "Reply-to (optional)", type: "email", help: "Replies go here. Empty = to the From address." },
      "email.daily_limit": { label: "Daily limit (optional)", type: "number", help: "The most mails sent in a day through this account. Empty = the service's own limit. Larger campaigns go out over several days." },
      "email.daily_summary_to": { label: "Daily summary to", type: "text", placeholder: "owner@hotel.in, manager@hotel.in", help: "Every evening at 9 pm a summary of the day (cash, front desk, handovers, what needs attention) is sent to these addresses from this mail server. Leave empty for none.", check: addresses("Daily summary to") },
      // Conversations (decision 66): reading the SAME mailbox (the same login and sealed password) for the hub; Gmail, or another mail server with its IMAP server
      "email.imap": { label: "Read this mailbox in Conversations", type: "toggle", default: "0", help: "HMS checks this mailbox's Inbox and Sent for new mail (when Conversations is open, every 1 to 2 minutes while HMS is open, and once a day). It keeps a list of each email (sender, subject, date, a short preview), never the whole email. Mail HMS itself sends (bills, receipts, codes) is never listed. Everyone with Conversations access can read every email in this mailbox, including password-reset emails: use a front-desk address, not the owner's personal account." },
      "email.imap_host": { label: "IMAP server (host)", type: "text", placeholder: "imap.example.com", help: "Only for your own mail server. Gmail is filled in for you." },
      "email.imap_port": { label: "IMAP port", type: "select", options: { "993": "993 (SSL/TLS)", "143": "143 (STARTTLS)" }, default: "993", help: "993 (SSL/TLS) or 143 (STARTTLS)." },
    },
  },
  razorpay_hotel: razorpay("hotel", "{hotel}", "Rooms, laundry and advances."),
  razorpay_food: razorpay("food", "{food}", "Restaurant and room service."),
  backup: {
    label: "Backup and restore",
    icon: "bi-cloud-arrow-up",
    about: "Every night the database and all uploaded files are zipped and sent to a Google Drive folder.",
    fields: {
      "backup.enabled": { label: "Back up to Google Drive every night", type: "toggle", help: "Runs at 2:00 AM." },
      "backup.client_id": { label: "Google client ID", type: "text", help: "From Google Cloud Console, Credentials, OAuth client ID (Web application)." },
      "backup.client_secret": { label: "Google client secret", type: "password", secret: true },
      "backup.keep_days": { label: "Keep backups for (days)", type: "number", default: "30" },
    },
  },
  recycle: {
    label: "Recycle bin",
    icon: "bi-recycle",
    about: "Deleted records wait here and can be restored.",
    fields: {
      "recycle.days": { label: "Keep deleted records for (days)", type: "number", default: "30", help: "After this many days a deleted record is removed for good, along with its uploaded files." },
    },
  },
};

export const SETTING_KEYS: Record<string, string> = Object.fromEntries(Object.entries(SETTING_GROUPS).flatMap(([g, def]) => Object.keys(def.fields).map((k) => [k, g])));
