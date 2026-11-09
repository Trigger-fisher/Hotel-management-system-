# Conversations: one inbox for email and WhatsApp (plan, 24 Oct 2026)

**Status: built (24-25 Oct 2026), decision 66.** MJ approved it with C1 to C7 at their proposed defaults: email works end to end for every hotel and for the platform mailbox; WhatsApp is design only (sample data in mock mode, "WhatsApp not connected yet" on the live site) until MJ integrates Meta. Decision 66 also records what the review added (HMS's own mail and security mail never listed, the Other box, sender verification, public mail servers only, other modules' rights, nothing in exports, backups or the idempotency store). Live database: `docs/neon-sql/RUN-ORDER-2026-10-17.md` steps 38 and 39. Where this plan and decision 66 differ, decision 66 wins.

What MJ asked for (24 Oct 2026): "like GoHighLevel, all the communication in one place", **for now email and WhatsApp only**. Every hotel has its own; Super Admin and Platform Admin have one for the platform, with the same access.

Related: `WHATSAPP-PLAN-2026-10-24.md` (the WhatsApp channel in full: Meta setup, who pays, the 24-hour rule, coexistence). This plan is the **hub** both channels feed, and the **email channel**. Held for later (not in this plan): Instagram, Facebook, website chat, OTA messages, Google reviews, SMS, calls; the POS with Zomato/Swiggy; the channel manager.

---

## 1. In one page

- **One screen, Conversations**, where a hotel's emails and WhatsApp chats arrive together, grouped **by person**: a guest who emails and then sends a WhatsApp has one thread.
- **Reply on either channel** from the same box (default: the channel the person last used).
- **Linked to the guest**: the right panel shows the stay, room, dates and bills when the email address or phone number matches.
- **Team work**: assign a conversation to a staff member, internal notes the guest never sees, quick replies, unread and "waiting for reply".
- **Hotel and platform keep theirs apart**: a hotel's hub holds its guests' messages; the platform's hub (Super Admin and Platform Admin, same access) holds the platform mailbox and the platform WhatsApp number, for hotel owners and staff.
- **Cost**: email **₹0** (app password route); WhatsApp per Meta template message (replies within 24 hours free).

## 2. Decisions MJ needs to take (defaults proposed)

| # | Question | Proposed default |
|---|---|---|
| C1 | Build the hub as one screen for both channels? | Yes: Conversations, with a channel filter. The WhatsApp plan's own chat screen (its section 7) becomes this screen. |
| C2 | Email: app password (free) or "Connect Google" (Google review and a yearly paid security check)? | **App password first** (section 4). "Connect Google" later, only if enough hotels need it. |
| C3 | Keep whole emails in HMS? | **No.** Keep a list (sender, subject, date, link to the guest, a short preview); open the full email from the mail server when someone clicks it. WhatsApp messages are kept (Meta does not keep them for us). |
| C4 | Who sees a hotel's conversations | Hotel Admin always; Hotel Users with a new permission "Conversations" (view, reply); Group Hotel Admin for its hotels. Super/Platform Admin **not** (also not in a visit). |
| C5 | How long things are kept | WhatsApp text 12 months, photos and files 90 days; the email list 12 months (the emails themselves stay in the hotel's mailbox). |
| C6 | Which mailbox folders | Inbox and Sent only at first (not spam, not other folders). |
| C7 | Platform mailbox | One mailbox for the platform (for example support@), set in Super Admin > Platform settings > Mail, the same place as the platform's sending mail. |

## 3. The screen

```
┌ Conversations ────────────────────────────────────────────────────────────┐
│ 🔍  [All] [Unread] [Mine] [Unassigned]   Channel: [All ▾ | Email | WhatsApp]│
│─────────────────────────────│─────────────────────────────│───────────────│
│ ● Asha Rao   🟢 WA    10:42 │ Asha Rao                     │ GUEST         │
│   late check-out?         2 │ ── Email, 23 Oct ──          │ Room 204      │
│ ○ Ravi Shah  ✉ Email  09:15 │ Booking 12-14 Nov (subject)  │ 12-14 Nov     │
│   invoice please        📎  │ ── WhatsApp, 10:41 ──        │ Bill ₹8,400 › │
│ ○ +91 98…    🟢 WA    Yest. │ Can I get late check-out?    │ Assigned: Neha│
│   not a guest               │ ── window open: 23 h left ── │ Notes (staff) │
│                             │ Reply on: [WhatsApp ▾] [Send]│ [Link guest]  │
└─────────────────────────────┴─────────────────────────────┴───────────────┘
```

- **List**: one row per person (or per unknown address/number), newest first (decision 52), channel icons, unread count, attachment mark.
- **Thread**: email and WhatsApp messages in time order, each marked with its channel. Email shows the subject; replying keeps the email thread (Re: subject, In-Reply-To).
- **Reply box**: channel picker; for WhatsApp, the 24-hour window and the template picker when it is closed (WhatsApp plan section 3); for email, To/Cc, subject, attachments (a bill PDF from HMS in one click).
- **Right panel**: the linked guest, company or booking; assign; tags; internal notes; "Link guest" for an unknown sender.
- **Phone**: list, then the thread full screen (the existing phone kit).
- **Menu badge** with the unread count.
- Built from Pallav's parts (decision 1).

## 4. The email channel

### How it connects (C2: app password)
- The hotel's **Settings > Email** already holds its mail server, login and a sealed password, bound to the hotel (`web-app/src/server/mail/hotelSmtp.ts`). Sending already uses it.
- Reading adds **IMAP** to the same settings: IMAP host and port (filled in for Gmail and Google Workspace: `imap.gmail.com`, 993), the same login and password. For Gmail the password is a **Google app password** (needs 2-Step Verification on the Google account; the page shows the steps).
- **Test connection** button: signs in to IMAP and SMTP and says what failed in plain words (wrong password, IMAP turned off in Gmail, app passwords blocked by a Workspace admin).
- Works for any mail service that allows IMAP (Gmail, Workspace, Zoho, a hosting company's mail), not only Google.
- A hotel whose Workspace admin blocks app passwords cannot use this route; it waits for "Connect Google" (C2) or the admin allows app passwords.

### How new mail arrives
- Vercel cannot hold a mail connection open, so HMS **checks for new mail**: when someone opens Conversations, then every 1 to 2 minutes while HMS is open, and once a day from the cron. New mail shows within a minute or two while someone is working.
- HMS remembers where it stopped in each folder (IMAP UID), so a check reads only new mail.
- On the VPS later, a background loop can check every minute even when nobody has HMS open.

### What HMS keeps (C3)
- Per email: sender, recipients, subject, date, a short preview, the message ids (for threading and replies), the IMAP UID, the link to the guest. **Not** the full body or the attachments.
- Opening an email fetches it from the mailbox at that moment; it is shown and not stored.
- Sent replies go out through the hotel's SMTP (as today) and are also saved into the mailbox's Sent folder, so the hotel's own Gmail shows them too.

### "Connect Google" later (not in this plan's build)
Google's Gmail API with the hotel's Google sign-in: no app password, instant new-mail notices. Reading mail needs Google's "restricted" permissions: app verification (about 6 weeks) and a **yearly security assessment** by a Google-approved lab (third-party estimates: about $540 to $4,500 a year). Built behind the same email adapter when MJ decides.

## 5. The WhatsApp channel

As `WHATSAPP-PLAN-2026-10-24.md`, with one change: its chats show **in this hub** instead of a screen of their own. Its Meta setup, the hotel connect flow, coexistence, templates, consent, the 24-hour rule and who pays stay as written there. The Meta paperwork (business verification, Tech Provider review, the Solution Partner) should **start now**, because it takes weeks and does not wait for the code.

## 6. Who can do what

| | Super Admin | Platform Admin | Group Hotel Admin | Hotel Admin | Hotel User |
|---|---|---|---|---|---|
| Platform hub (platform mailbox and WhatsApp): read, reply, assign | ✓ | ✓ | – | – | – |
| Platform mailbox and number settings | ✓ | ✓ | – | – | – |
| A hotel's hub: read, reply, assign, notes | – (C4) | – (C4) | its hotels | ✓ | with "Conversations" (C4) |
| Hotel Settings > Email (incl. IMAP) and Settings > WhatsApp | – | – | – | ✓ | – |

API access keys (decision 65) never reach these routes (added to the deny list). Every reply records who sent it.

## 7. Data, privacy and security

- **Platform database**: channel accounts (the hotel's or the platform's mailbox and WhatsApp number), sealed secrets (the IMAP/SMTP password already sealed per hotel; WhatsApp tokens), the mail check position per folder.
- **Each hotel's own schema** (hotel isolation stays): contacts' links, conversations, the email list, WhatsApp messages, assignments, notes.
- **Never** in logs, audit text, exports or backups in plain form: message text, email subjects and previews, addresses, phone numbers. Logs carry ids only.
- **Retention** (C5): a nightly job removes what is past its time.
- **Privacy notice**: the hotel's and HMS's privacy text must say that guest messages are handled in HMS and for how long.
- **Security review** before go-live: the IMAP reader (no HTML or script from an email can run in HMS: emails are shown sanitised, remote images blocked until "Show images"), attachments opened safely, the webhook, the permissions, the deny list.

## 8. What gets built (developer view)

| Part | Notes |
|---|---|
| Hub core | contacts and their addresses/numbers, conversations, messages (channel, direction, status), assignment, notes, tags, unread; one service, one set of routes |
| Channel adapter: email | IMAP read (new mail by UID, fetch one message on open), SMTP send (the existing sender), save to Sent, threading by message ids |
| Channel adapter: WhatsApp | as the WhatsApp plan section 10 |
| Screen | Conversations (hotel) and the console's Conversations (platform); polling as the Pathik page |
| Settings | IMAP fields and Test connection in Settings > Email (hotel) and Platform settings > Mail; Settings > WhatsApp |
| Guest linking | match by email address and phone number to guests, stays, companies; "Link guest" by hand |
| Migrations | new tables only, platform and hotel |
| Tests | isolation between hotels, permissions, the deny list, threading, the 24-hour rule, sanitising of email HTML, no secrets in logs |

One adapter interface (receive, send, status) so a later channel (Instagram, website chat, OTA messages) plugs in without changing the screen.

## 9. Order, effort and cost

| Phase | What | Time (one developer) | Running cost |
|---|---|---|---|
| 0 | MJ's decisions; **start Meta paperwork** (WhatsApp plan section 5) | now | ₹0 |
| 1 | Hub core + screen + **email** (hotel and platform) | 4 to 5 weeks | ₹0 |
| 2 | **WhatsApp** in the hub (platform number first, then hotels' numbers) | 4 to 6 weeks | Meta per template message; Solution Partner markup |
| 3 | Pilot with one hotel (MJ watching), then all hotels | 1 to 2 weeks | |

**About 9 to 13 weeks** in all. Phase 1 gives hotels a working shared inbox for email at no running cost, while Meta's approvals for WhatsApp are in progress.

## 10. Risks

- **App passwords blocked** by some Workspace admins: those hotels need "Connect Google" (Google's review and yearly assessment) or their admin's permission.
- **Email is checked, not pushed**: a minute or two of delay; fine for a hotel, but it should be said in the screen ("checked 1 min ago").
- **Unsafe emails**: phishing and malicious HTML; the reader must sanitise and never run anything from an email.
- **Meta approvals** for WhatsApp take weeks (see the WhatsApp plan's risks).
- **The database region** (24 Oct speed report): every check and every message is a database write; the region fix matters here too.

## Sources (24 Oct 2026)
- Gmail access: [Gmail API scopes](https://www.unipile.com/gmail-api-scopes-guide/), [CASA before launch (GitHub issue)](https://github.com/YehudaBriskman/WindoM/issues/321), [Google OAuth verification and CASA](https://www.agenticfabriq.com/blog/google-oauth-verification-casa), [Google Workspace IMAP/SMTP and app passwords](https://univik.com/email-settings/google-workspace.html), [Gmail IMAP/SMTP and app passwords](https://univik.com/email-settings/gmail.html), [Gmail OAuth changes and app passwords](https://www.getmailbird.com/gmail-oauth-changes-app-password-phase-out/)
- WhatsApp: see the sources of `WHATSAPP-PLAN-2026-10-24.md`.
