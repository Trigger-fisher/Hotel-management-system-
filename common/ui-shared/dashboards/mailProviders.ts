// Mail providers (MAIL-PROVIDERS-50K plan, 18 Oct 2026): the services a hotel (Settings > Email) and the platform (Platform settings > Mail) can send mail through, with what
// each form shows. The SAME list drives both screens, so a provider added here appears in both. The server (web-app/src/server/mail/provider.ts) holds the connection of each
// provider: the screens never send a host for Gmail, Brevo or Amazon SES.

export type MailProviderId = 'gmail' | 'brevo' | 'ses' | 'smtp' | 'domain';
export type MailSecurity = 'starttls' | 'ssl' | 'none';
/** A hotel can also choose the platform's own email: nothing to set up, its mail goes out with the hotel's name as the sender name and its address as the reply-to (email.provider = 'platform'). */
export type HotelMailChoice = MailProviderId | 'platform';
export const MAIL_PLATFORM_OPTION = { id: 'platform' as const, label: 'The platform\'s email (nothing to set up)', summary: 'Your mail goes out from the platform\'s address with your hotel\'s name as the sender name and your address as the reply-to.' };

export interface MailProviderOption {
  id: MailProviderId;
  label: string;
  /** Only a hotel can choose it (not the platform's own picker): domain = the hotel sends through the PLATFORM's mail from an address on its own verified domain, with no credentials of its own. */
  hotelOnly?: boolean;
  /** Amazon SES is the recommended service for volume (MJ, 18 Oct 2026): the picker lists it first and marks it. */
  recommended?: boolean;
  /** One line under the picker. */
  summary: string;
  /** Which extra fields the form shows for this provider (the login, the password, the sender name and the reply-to are always shown). */
  fields: {
    /** Host, port and security: only for another SMTP server. */
    server: boolean;
    /** The Amazon SES region. */
    region: boolean;
    /** A From address of its own: every provider but Gmail (Gmail sends as the account itself). */
    fromAddress: boolean;
  };
  labels: { user: string; password: string };
  placeholders: { user: string; password: string };
  /** The login is a mail address (Gmail); otherwise any text. */
  userIsEmail: boolean;
  /** About what the service allows a day for a new account, as plain words ('' = no fixed limit). */
  limitsText: string;
  /** The exact steps to get the login and the password, shown as a short numbered list. */
  steps: string[];
  /**
   * Reading this mailbox in Conversations (decision 66): 'fixed' = Gmail (imap.gmail.com, port 993, the same app password), 'server' = another SMTP server (its IMAP server and
   * port are typed), 'none' = the service only sends (Amazon SES, Brevo, My own domain).
   */
  reading: MailReadingKind;
}

export type MailReadingKind = 'fixed' | 'server' | 'none';

export const MAIL_PROVIDER_OPTIONS: readonly MailProviderOption[] = [
  {
    id: 'ses', label: 'Amazon SES', recommended: true, summary: 'For large volume (tens of thousands of mails): about $0.10 per 1,000 mails.',
    fields: { server: false, region: true, fromAddress: true },
    labels: { user: 'SES SMTP user name', password: 'SES SMTP password' }, placeholders: { user: 'AKIA…', password: '' }, userIsEmail: false,
    limitsText: 'Set by Amazon; a new account starts in a sandbox (verified addresses only) until you ask to leave it.',
    steps: [
      'In the AWS console open Amazon SES in the region you want (Mumbai is ap-south-1).',
      'Verify your domain (or the From address) and add the DNS records SES shows.',
      'Ask AWS to move the account out of the sandbox (Account dashboard > Request production access).',
      'Open SMTP settings > Create SMTP credentials and copy the SMTP user name and password (not your AWS login).',
      'Paste them here, choose the same region, type the From address, and save.',
    ],
    reading: 'none',
  },
  {
    id: 'brevo', label: 'Brevo', summary: 'The easiest start for newsletters: a free daily allowance, unsubscribe and bounce handling.',
    fields: { server: false, region: false, fromAddress: true },
    labels: { user: 'Brevo SMTP login', password: 'Brevo SMTP key' }, placeholders: { user: 'name@yourdomain.in', password: 'xsmtpsib-…' }, userIsEmail: false,
    limitsText: 'About 300 mails a day on the free plan; more on a paid plan.',
    steps: [
      'Make a free account at brevo.com and confirm your email.',
      'Add and verify your sender address or domain (Senders, domains & dedicated IPs).',
      'Open SMTP & API > SMTP and copy the SMTP login and make an SMTP key.',
      'Paste the login and the key here, type the From address you verified, and save.',
    ],
    reading: 'none',
  },
  {
    id: 'gmail', label: 'Gmail', summary: 'For a small volume. A Gmail or Google Workspace address and an app password.',
    fields: { server: false, region: false, fromAddress: false },
    labels: { user: 'Gmail address', password: 'App password' }, placeholders: { user: 'name@gmail.com', password: '16 letters' }, userIsEmail: true,
    limitsText: 'About 500 mails a day (2,000 with Google Workspace).',
    steps: [
      'Sign in to the Google account that will send the mail.',
      'Switch on 2-Step Verification (Google Account > Security).',
      'Open Google Account > Security > App passwords, make one called EasyHotelSolutions, and copy the 16 letters.',
      'Paste them in App password (spaces do not matter) and save.',
    ],
    reading: 'fixed',
  },
  {
    id: 'smtp', label: 'Other SMTP server', summary: 'ZeptoMail, Postmark, Mailgun or your own company mail server.',
    fields: { server: true, region: false, fromAddress: true },
    labels: { user: 'Login', password: 'Password' }, placeholders: { user: '', password: '' }, userIsEmail: false,
    limitsText: '',
    steps: [
      'Get the SMTP host, port and security type from your mail provider (usually smtp.<provider> on port 587 with STARTTLS, or port 465 with SSL/TLS).',
      'Type them here with your login and password.',
      'Type the From address that your provider has verified, and save.',
    ],
    reading: 'server',
  },
  {
    id: 'domain', label: 'My own domain (sent by the platform)', hotelOnly: true, summary: 'No account to open: the platform sends your mail from an address on YOUR domain once you have added a few DNS records.',
    fields: { server: false, region: false, fromAddress: true },
    labels: { user: '', password: '' }, placeholders: { user: '', password: '' }, userIsEmail: false,
    limitsText: 'Same as the platform\'s mail.',
    steps: [
      'Type the address your mail should come from, on a domain you own (for example frontdesk@yourhotel.in).',
      'The platform adds your domain to its mail service and the DNS records to add appear here.',
      'Add the records at the company that manages your domain, then press Check DNS.',
      'When every required record is found and the platform has confirmed the domain, your mail is sent from your address.',
    ],
    reading: 'none',
  },
] as const;

export const MAIL_SES_REGIONS: readonly { id: string; label: string }[] = [
  { id: 'ap-south-1', label: 'Mumbai (ap-south-1)' },
  { id: 'ap-southeast-1', label: 'Singapore (ap-southeast-1)' },
  { id: 'ap-southeast-2', label: 'Sydney (ap-southeast-2)' },
  { id: 'ap-northeast-1', label: 'Tokyo (ap-northeast-1)' },
  { id: 'eu-west-1', label: 'Ireland (eu-west-1)' },
  { id: 'eu-central-1', label: 'Frankfurt (eu-central-1)' },
  { id: 'us-east-1', label: 'N. Virginia (us-east-1)' },
  { id: 'us-west-2', label: 'Oregon (us-west-2)' },
];

export const MAIL_SECURITY_OPTIONS: readonly { id: MailSecurity; label: string }[] = [
  { id: 'starttls', label: 'STARTTLS (port 587)' },
  { id: 'ssl', label: 'SSL/TLS (port 465)' },
  { id: 'none', label: 'None (a private relay only)' },
];

/** The two IMAP ports HMS connects to (decision 66, A13): 993 with SSL/TLS from the start, or 143 upgraded with STARTTLS. Nothing else is accepted. */
export type MailImapPort = '993' | '143';
export const MAIL_IMAP_PORT_OPTIONS: readonly { id: MailImapPort; label: string }[] = [
  { id: '993', label: '993 (SSL/TLS)' },
  { id: '143', label: '143 (STARTTLS)' },
];

/**
 * Known mail services: their SMTP server and the IMAP server that reads the same mailbox. Gmail is fixed by the program (the form never sends its host); the others fill in the
 * IMAP server of "Other SMTP server" when the SMTP host matches (suggestImapHost). Every one reads on port 993.
 */
export const IMAP_PRESETS: readonly { id: string; label: string; smtpHost: string; imapHost: string; port: 993 }[] = [
  { id: 'gmail', label: 'Gmail and Google Workspace', smtpHost: 'smtp.gmail.com', imapHost: 'imap.gmail.com', port: 993 },
  { id: 'zoho', label: 'Zoho Mail (India)', smtpHost: 'smtp.zoho.in', imapHost: 'imap.zoho.in', port: 993 },
  { id: 'zoho-com', label: 'Zoho Mail', smtpHost: 'smtp.zoho.com', imapHost: 'imap.zoho.com', port: 993 },
  { id: 'outlook', label: 'Microsoft 365 and Outlook', smtpHost: 'smtp.office365.com', imapHost: 'outlook.office365.com', port: 993 },
  { id: 'yahoo', label: 'Yahoo Mail', smtpHost: 'smtp.mail.yahoo.com', imapHost: 'imap.mail.yahoo.com', port: 993 },
  { id: 'hostinger', label: 'Hostinger', smtpHost: 'smtp.hostinger.com', imapHost: 'imap.hostinger.com', port: 993 },
  { id: 'godaddy', label: 'GoDaddy Workspace', smtpHost: 'smtpout.secureserver.net', imapHost: 'imap.secureserver.net', port: 993 },
];

/**
 * The IMAP server to offer for an SMTP host: a known service's own reading server, else `smtp.<domain>` becomes `imap.<domain>` and a `mail.<domain>` host (one server for both)
 * stays as it is. '' when nothing sensible can be guessed (the person types it).
 */
export function suggestImapHost(smtpHost: string): string {
  const host = smtpHost.trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]{1,253}$/.test(host) || !host.includes('.')) return '';
  const known = IMAP_PRESETS.find((p) => p.smtpHost === host);
  if (known) return known.imapHost;
  if (host.startsWith('smtp.') && host.split('.').length >= 3) return `imap.${host.slice(5)}`;
  if (host.startsWith('mail.') && host.split('.').length >= 3) return host;
  return '';
}

/** One DNS record to add for a sender domain, with what the last DNS check found. state is 'unchecked' until the first check. */
export interface MailDnsRecord {
  id: 'dkim1' | 'dkim2' | 'dkim3' | 'spf' | 'dmarc';
  type: 'CNAME' | 'TXT';
  /** The full name to add the record at. */
  name: string;
  value: string;
  /** DKIM is required; SPF and DMARC are recommended. */
  required: boolean;
  purpose: string;
  state: 'ok' | 'missing' | 'wrong' | 'unchecked';
  /** What the check found there, cut to 200 characters. */
  found?: string;
}

/**
 * A sender identity: the domain mail is sent from, the DNS records it needs and where it stands. The platform has one (its sending domain); a hotel that chose domain has one (its own).
 * The plain nextStep sentence says what to do now.
 */
export interface MailSenderIdentity {
  /** 'platform' or a hotel id. */
  scope: string;
  hotelName: string | null;
  domain: string;
  /** The address on that domain a hotel sends from; null for the platform. */
  fromAddress: string | null;
  status: 'pending' | 'verified';
  /** The three DKIM names from Amazon SES are known (until then only SPF and DMARC can be shown). */
  dkimReady: boolean;
  /** The Super Admin confirmed that the domain exists in Amazon SES. */
  sesConfirmed: boolean;
  records: MailDnsRecord[];
  /** ISO time of the last DNS check, or null. */
  checkedAt: string | null;
  nextStep: string;
}

/** What the Super Admin saves for an identity: the three DKIM names SES showed, and that the domain exists in SES. */
export interface MailSenderIdentityInput {
  dkimTokens?: string[];
  sesConfirmed?: boolean;
}

/** The server a saved provider uses, as the status shows it. */
export interface MailServerInfo {
  host: string;
  port: number;
  security: MailSecurity;
  /** The Amazon SES region (the middle of the host name); '' for any other provider. */
  region: string;
}

/** What the provider allows, after the account's own daily limit and the Super Admin's cap: mails a second and a day (0 = no fixed daily limit). */
export interface MailLimitsInfo {
  perSecond: number;
  perDay: number;
}

export const mailProviderCopy = {
  picker: { label: 'Mail service', hint: 'Choose the service that sends your mail. You can change it later.' },
  server: { host: 'Server (host)', port: 'Port', security: 'Security' },
  region: 'Amazon SES region',
  fromAddress: { label: 'From address', hint: 'The address mail comes from. It must be verified with the service.' },
  dailyLimit: { label: 'Daily limit (optional)', hint: 'The most mails sent in a day through this account. Empty = the service\'s own limit. Larger campaigns go out over several days.' },
  limits: (l: MailLimitsInfo): string => `Up to ${l.perSecond} a second${l.perDay > 0 ? `, ${l.perDay.toLocaleString('en-IN')} a day` : ''}.`,
  sendingFrom: (label: string, address: string): string => `Sending from: ${label}, ${address}`,
  stepsTitle: (label: string): string => `How to set up ${label}`,
  errors: {
    host: 'Enter the mail server name, like smtp.example.com.',
    port: 'Enter a port between 1 and 65535.',
    security: 'Choose STARTTLS, SSL/TLS or none.',
    region: 'Choose an Amazon SES region.',
    fromAddress: 'Enter the From address (a valid email address).',
    dailyLimit: 'Enter a whole number, or leave it empty.',
    sendingDomain: 'Enter a domain like mail.example.in.',
    passwordNew: 'Enter the password or key of this service.',
  },
  /** Reading the mailbox in Conversations (decision 66): Settings > Email's Reading block and its Test connection. */
  reading: {
    title: 'Reading mail in Conversations',
    toggle: 'Read this mailbox in Conversations',
    toggleHint: 'HMS lists each new email (sender, subject, date, a short preview), never the whole email. Mail HMS itself sends (bills, receipts, codes) is never listed.',
    gmail: 'Uses the same app password as sending. When you switch it on, HMS brings in the last 14 days of mail, then new mail every 1 to 2 minutes while HMS is open.',
    gmailServer: 'Gmail reads from imap.gmail.com, port 993.',
    server: 'Uses the same login and password as sending. When you switch it on, HMS brings in the last 14 days of mail, then new mail every 1 to 2 minutes while HMS is open.',
    privacy: "Everyone with Conversations access can read every email in this mailbox, including password-reset emails. Use a front-desk address, not the owner's personal account.",
    imapHost: 'IMAP server (host)',
    imapHostHint: 'Only for your own mail server. Gmail is filled in for you.',
    imapPort: 'IMAP port',
    imapPortHint: '993 (SSL/TLS) or 143 (STARTTLS).',
    sendOnly: 'Your mail service only sends. Gmail or your own mail server is needed to read mail.',
    platformMail: "The platform's mail only sends. To read mail here, choose your own Gmail or mail server.",
    errors: {
      imapHost: 'Enter the public IMAP server name, like imap.example.com.',
      imapPort: 'The IMAP port is 993 (SSL/TLS) or 143 (STARTTLS).',
    },
    test: {
      button: 'Test connection',
      help: 'Signs in to the saved mailbox for reading and for sending. Nothing is sent.',
      saveFirst: 'Save first, then test.',
      checking: 'Checking...',
      imap: 'Reading (IMAP)',
      smtp: 'Sending (SMTP)',
      ok: 'Works',
      failed: 'Does not work',
      testedAt: (time: string): string => `Tested the saved settings, ${time}`,
      never: 'Not tested yet.',
    },
  },
} as const;

/** The plain check of an IMAP server name typed in the form (the server checks again and also refuses names that are not on the internet). */
export function imapHostError(host: string): string | null {
  const h = host.trim();
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(h) || !h.includes('.') || /^[0-9.]+$/.test(h) || /(^|\.)localhost$/i.test(h)) return mailProviderCopy.reading.errors.imapHost;
  return null;
}
