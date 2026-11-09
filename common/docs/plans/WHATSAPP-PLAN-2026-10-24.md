# WhatsApp in HMS: plan (research, 24 Oct 2026)

**Status: design built, Meta not connected (24-25 Oct 2026), decision 66.** MJ: "whatsapp design for now and then I will integrate it". Decision 66 replaces **decision 60** for WhatsApp in Conversations and the 17 Oct "no outside service" rule for this channel. Built: the section 7 screens inside Conversations (bubbles, ticks, the 24-hour window, the template picker, media, "Sent from Phone"), Hotel Settings > WhatsApp and the console's WhatsApp settings, all on sample data in mock mode and the local demo; the live site shows "WhatsApp not connected yet" with a disabled Connect. Not built: Meta setup, the server adapter (`web-app/src/server/conversations/whatsapp.ts` holds only its interface), the webhook, tokens, templates on Meta and billing. The contracts already carry every state Meta produces, so connecting it adds a server adapter and a webhook route without changing the screens.

What MJ asked for (24 Oct 2026):
- every hotel uses **its own WhatsApp number** (guests see the hotel's name), and **MJ pays** for the messages;
- guest chats show **inside HMS**: staff read and answer them there (a WhatsApp-like screen);
- the **platform has one number of its own**, used by **Super Admin and Platform Admin with the same access**.

This mirrors the mail rule (`MAIL-ROUTING-PLAN-2026-10-17.md`): what the system says comes from the platform, what a hotel says comes from the hotel.

---

## 1. In one page

| | Platform number | Hotel numbers |
|---|---|---|
| Whose number | EasyHotelSolutions (one number) | each hotel's own (one per hotel) |
| Name the person sees | EasyHotelSolutions | the hotel's name |
| Used by | Super Admin and Platform Admin, **same access** | that hotel's staff only |
| Talks to | hotel owners and staff (onboarding, support, notices) | the hotel's guests |
| Meta account | MJ's own WhatsApp Business Account | the hotel's own WhatsApp Business Account, connected to HMS |
| Who pays Meta | MJ (his card on his account) | MJ (through a Solution Partner's credit line, section 4) |
| Screen in HMS | Console > WhatsApp | Hotel > WhatsApp |

Meta provides the **connect popup** and the **message API**. **The chat screen is ours**: Meta has no inbox to embed. It is built from Pallav's parts (decision 1).

## 2. Decisions MJ needs to take (defaults proposed)

| # | Question | Proposed default |
|---|---|---|
| D1 | Bring WhatsApp back (replaces decision 60)? | Yes, as this plan. |
| D2 | How MJ pays for hotels' messages | Through a **Meta Solution Partner** (multi-partner solution). MJ becomes a Tech Provider; the partner bills MJ monthly (section 4). |
| D3 | A hotel's number: phone app too, or HMS only? | **Coexistence** by default: the hotel keeps the WhatsApp Business app on its phone, and every chat also shows in HMS. HMS-only is offered for hotels that want it. |
| D4 | Which hotel roles see the hotel's chats | Hotel Admin always; Hotel Users only with a new permission "WhatsApp" (view, reply). |
| D5 | Does a Group Hotel Admin see the chats of its hotels? | Yes, per hotel, as for other hotel pages. |
| D6 | Do Super/Platform Admin see a hotel's guest chats (during a visit)? | **No.** Guest chats are personal; a visit does not open them. Support reads them only if the hotel shares a screen. |
| D7 | Charge the hotels for messages? | Count per hotel per month (section 9); price it later (in the plan fee or per message). |
| D8 | How long chats and photos are kept | 12 months for text, 90 days for photos and files, then deleted (like other personal data). |
| D9 | What the platform number is for | Onboarding messages, support chats with hotel owners and staff, notices (outage, new feature, bill due). Not for guests. |

## 3. How messages flow (the "live" part)

```
Guest's phone ──► Meta ──► HMS webhook (POST /api/v1/whatsapp/webhook)
                              │  1. check Meta's signature (X-Hub-Signature-256, app secret)
                              │  2. find the number (phone_number_id) -> the hotel, or the platform
                              │  3. save the message in that hotel's database (once: Meta's message id)
                              │  4. answer 200 at once
                              ▼
HMS chat screen ◄── asks every few seconds for new messages (as the Pathik page does) ──┘

Staff press Send ──► HMS server ──► Meta Cloud API ──► guest's phone
                                 ◄── status events: sent ✓, delivered ✓✓, read (blue ✓✓), failed
```

- **One webhook for everything.** Meta sends the events of every connected number to our one app webhook; the number decides whose message it is. A number HMS does not know is ignored (logged by id only).
- **With coexistence**, a reply typed on the hotel's phone also arrives (Meta's "echo" event) and shows in the HMS chat as sent by "Phone".
- **Speed:** polling every 3 to 5 seconds while the screen is open, and every 60 seconds for the unread count in the menu. A push connection (server-sent events) can come later; on Vercel it costs more.

### The 24-hour rule (Meta's, shown on the screen)
- A guest's message opens a **24-hour window**. Inside it, staff can write anything, and replies cost **nothing**.
- After 24 hours, only an **approved template** can be sent (for example "Hello {name}, your room is ready"), charged as a template. When the guest answers, the window opens again.
- The reply box shows the time left ("window open: 23 h left"). When it is closed, the box turns into a template picker.

### Messages HMS sends by itself (templates)
Utility templates per hotel, approved by Meta once per hotel (HMS submits them when the hotel connects):
booking confirmed, check-in welcome (with the guest portal link), bill or receipt link, check-out thank-you, advance received.
Each is sent only if the guest **agreed to WhatsApp** (a tick at check-in or booking, stored with the date and the staff member).

## 4. Who pays, and how (D2)

Meta charges per **template message**, by kind; replies inside the 24-hour window are free.

| Kind | Example | Meta's rate in India (approx., 2026) |
|---|---|---|
| Utility | booking confirmed, bill link | ₹0.12 to 0.15 |
| Authentication | a sign-in code | ₹0.12 to 0.15 |
| Marketing | offers, "come back" | about ₹0.86 |

Check the figures on Meta's own rate card before pricing anything; these are from partner blogs. Utility and authentication get cheaper with volume; marketing does not.

**Why a Solution Partner:** under Meta's rules a hotel's own WhatsApp account must have a way to pay. A **Tech Provider** (what MJ would be) cannot pay for its customers. A **Solution Partner** can, through its credit line. So:
1. MJ registers EasyHotelSolutions as a **Tech Provider** (section 5).
2. MJ signs with **one Solution Partner** (examples: Exotel, Gupshup, Infobip, 360dialog) and sets up a **multi-partner solution** in Meta's app dashboard.
3. Every hotel that connects through HMS's popup is then billed to **the partner's credit line**, and the partner bills **MJ** monthly, with their markup (one partner says 5 to 20% on Meta's rate; not confirmed).
4. Becoming a Solution Partner directly is **not** proposed: it is a Meta partner program for messaging companies, with sales and volume expectations.

**The platform number** is simpler: it lives in MJ's own WhatsApp Business Account, paid with MJ's card. No partner is needed for it.

**Example month** (for planning only): 20 hotels × 300 utility messages = 6,000 messages × about ₹0.15 = **about ₹900**, plus the partner's markup and fee. Guest chats answered within 24 hours add nothing.

## 5. Meta setup (MJ, once; about 2 to 4 weeks, mostly waiting)

1. **Meta Business portfolio** for EasyHotelSolutions in Business Manager, then **business verification** (GST or registration papers, the website, the domain). Usually 2 to 5 working days; sometimes longer.
2. **A Meta app** for HMS (Business type) with the WhatsApp product; privacy policy URL, app icon, category.
3. **App review to become a Tech Provider:** two screen recordings (a message sent from HMS arriving in WhatsApp; a template created). Expect a round or two of questions.
4. **Embedded Signup v4** configured in the app (v2 was switched off by Meta on 15 Oct 2026: build on v4 only).
5. **Solution Partner** contract and the multi-partner solution (section 4).
6. **Platform number:** a new SIM or virtual number that is **not** on normal WhatsApp; add it to MJ's WhatsApp Business Account; display name "EasyHotelSolutions"; Meta approves the name.
7. **Secrets on Vercel** (never in the code or chat): `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_CONFIG_ID` (the Embedded Signup configuration), the platform number's token, and a key to seal hotel tokens (`WHATSAPP_SECRET_KEY`, as `SMTP_SECRET_KEY` does for mail).

## 6. A hotel connects its number (the hotel, about 10 minutes plus Meta's checks)

1. Hotel Admin opens **Settings > WhatsApp** and presses **Connect WhatsApp**.
2. **Meta's popup** opens (Meta's own screen, not ours): sign in with Facebook, choose or create the hotel's business, verify the number by code. With coexistence, the hotel scans a QR code from its WhatsApp Business app and chooses whether to share its chat history.
3. HMS receives a one-time code, exchanges it for the hotel's token, **stores it sealed**, registers the number, subscribes to its events and submits the hotel's templates.
4. The page shows: connected number, display name and its approval, templates and their approval, quality rating, the last message sent and received.
5. **History sync** (coexistence): Meta sends the shared history and contacts once; it must finish **within 24 hours** of connecting or the hotel must connect again. HMS shows its progress.

Things a hotel must know before it starts:
- Meta also **verifies the hotel's business**; this can take days, and until then sending is limited.
- A number used in the normal (personal) WhatsApp app cannot be connected. A WhatsApp **Business app** number can, with coexistence.
- With coexistence, the phone app loses **broadcast lists, disappearing messages and view-once**, and sending is limited to 20 messages a second (plenty for a hotel).
- To disconnect a coexistence number, the hotel removes it in the phone app's settings; HMS then shows "disconnected".

## 7. The screens

**Update (MJ, 24 Oct 2026):** WhatsApp and email share ONE screen, Conversations (`CONVERSATIONS-PLAN-2026-10-24.md`). The chat screen below is how a WhatsApp thread looks inside it; the settings and console parts stay as written.

### Hotel > WhatsApp (staff)
```
┌ WhatsApp ───────────────────────────────────────────────────────────┐
│ 🔍 Search   [All] [Unread] [Guests in house]                        │
│────────────────────│────────────────────────────────────────────────│
│ ● Asha Rao    10:42│  Asha Rao · Room 204 · checks out tomorrow  ›  │
│   Room 204       2 │                 Can I get late check-out? 10:41│
│ ○ +91 98…     09:15│  Yes, until 1 pm at no charge.  10:42 ✓✓       │
│   not a guest      │  (sent from Phone)                             │
│ ○ Ravi Shah   Yest.│                                                │
│   Room 110         │  ── window open: 23 h left ──                  │
│                    │  [ Type a reply…           ] [📎] [Send]       │
└────────────────────┴────────────────────────────────────────────────┘
```
- Chat list with unread counts; a chat is **linked to the guest** when the phone number matches a stay or a guest (room, dates, link to the stay and the bill). An unknown number shows the number only, with "Link to a guest".
- Text, photos, documents, voice notes and locations are shown; staff can send text, a photo or a PDF (the bill).
- Who answered is shown on each staff reply (staff name; "Phone" for coexistence echoes).
- Phone layout: the list, then the chat full screen (the existing phone kit).
- The menu shows an unread badge.

### Hotel > Settings > WhatsApp (Hotel Admin)
Connect / disconnect, number and status, templates and their approval, which automatic messages are on (each one can be switched off), quality rating, this month's message count.

### Console > WhatsApp (Super Admin and Platform Admin, same access)
- The **same chat screen** for the platform number, with hotel owners and staff (linked to the hotel and the user when the number matches).
- **Settings:** the platform number's status and templates (onboarding approved, password reset help, support reply, notice).
- **Hotels overview:** each hotel's connection status, quality rating and message count per month (no chat content, decision D6).
- Both roles see and do the same things here (MJ, 24 Oct 2026). Every reply is still recorded with the person who sent it.

## 8. Who can do what

| | Super Admin | Platform Admin | Group Hotel Admin | Hotel Admin | Hotel User | Guest / Company portal |
|---|---|---|---|---|---|---|
| Platform chats: read, reply | ✓ | ✓ | – | – | – | – |
| Platform number settings, templates | ✓ | ✓ | – | – | – | – |
| Hotels' WhatsApp status and counts | ✓ | ✓ | its hotels | own hotel | – | – |
| A hotel's guest chats: read, reply | – (D6) | – (D6) | its hotels (D5) | ✓ | with the WhatsApp permission (D4) | – |
| Connect or disconnect a hotel number | – | – | – | ✓ | – | – |
| Turn automatic messages on or off | – | – | – | ✓ | – | – |
| Opt in or out of WhatsApp | – | – | – | at check-in, for the guest | at check-in, for the guest | the guest, in the portal profile |

API access keys (decision 65) never reach WhatsApp routes (added to the deny list): no key reads guest chats or sends a message.

## 9. Data, privacy and security

- **Where things are kept**
  - Platform database: the list of connected numbers (`phone_number_id` -> hotel or platform), each hotel's token **sealed** (as the Pathik login vault and the hotel SMTP password), template status, monthly counts per hotel.
  - Each hotel's own schema (the hotel isolation stays): chats, messages, media references, consent.
  - Photos and files: downloaded from Meta at once (Meta keeps them only a short time), stored in the bucket **sealed, hotel-only**, like the guest ID photos.
- **Never** in logs, audit text, exports or backups in plain form: message text, phone numbers, media. Logs carry ids only.
- **Webhook security:** every call's signature is checked with the app secret before anything is read; Meta's message id makes a repeat harmless; an unknown number is dropped.
- **Consent:** no automatic message without the guest's WhatsApp consent; a guest writing "STOP" is opted out and the automatic messages stop.
- **Retention** (D8): a nightly job deletes text after 12 months and photos/files after 90 days.
- **Privacy notice:** the hotel's and HMS's privacy text must say that guest chats are stored in HMS and for how long.
- **Security review** before go-live (as rounds 2 and 3 of 18 Oct): the webhook, the token vault, the media store, the permissions and the deny list.

## 10. What gets built (developer view)

| Part | Where | Notes |
|---|---|---|
| Webhook | `app/api/v1/whatsapp/webhook/route.ts` | GET: Meta's verify challenge. POST: signature, route by number, save, 200. No session (signed by Meta). |
| Connect flow | Hotel Settings > WhatsApp + `.../whatsapp/connect` | Embedded Signup v4 popup; code -> token exchange, register, subscribe, submit templates. |
| Sender | `server/whatsapp/` + an outbox lane like the mail lanes | Retries, rate limits, the 24-hour check, template or free text, status updates. |
| Templates | per hotel and platform | Submit, track approval, fill variables. |
| Chat screens | `dashboards/groups/whatsapp/` (hotel) and the console | Pallav parts only; polling as the Pathik page. |
| Guest link | front office | Match a number to a guest or stay; consent tick at check-in and booking. |
| Media | the existing bucket code | Download, seal, serve to staff only. |
| Usage | platform | Count per hotel per month per kind, for charging back. |
| Migrations | platform + hotel | New tables only. The old unused columns of decision 60 (`site_settings.whatsapp`, `reception_whatsapp`) can serve the website's "chat with us" link again. |
| Tests | as the project does | Signature, routing, isolation between hotels, the 24-hour rule, consent, the deny list, sealing. |

## 11. Effort and order

| Phase | What | Who | Time |
|---|---|---|---|
| 0 | MJ's decisions (section 2); start Meta business verification and partner talks | MJ | now (Meta's waiting runs in parallel) |
| 1 | Platform number: webhook, sender, console chat screen, templates | dev | 2 weeks |
| 2 | Hotel connect flow (Embedded Signup v4, coexistence, sealed tokens) | dev | 1.5 to 2 weeks |
| 3 | Hotel chat screen, guest linking, consent, automatic messages | dev | 2 to 3 weeks |
| 4 | Media, retention, usage counts, security review | dev | 1 week |
| 5 | Pilot with one hotel (MJ watching), then all hotels | MJ + dev | 1 to 2 weeks |

**About 7 to 9 weeks of development** for one developer, in parallel with **2 to 4 weeks of Meta and partner paperwork**. Phase 1 comes first because it needs no Solution Partner and proves the webhook, the sender and the screen.

**Difficulty:** medium to hard. The code is ordinary for this project; the slow and uncertain parts are Meta's approvals, each hotel's verification and the partner contract, which HMS does not control.

## 12. Risks

- **Meta approval delays** (business verification, app review, display names, templates). Start early.
- **One hotel's quality rating** falls if guests block or report it; Meta then limits that number (only that hotel, since numbers are separate). Keep automatic messages useful and few.
- **Coexistence sync** is "best effort": not a guaranteed complete archive.
- **Partner dependence:** changing partner later needs each hotel's credit line moved by hand.
- **Rules and prices change:** Meta changed billing on 1 Jul 2025 and India billing in rupees from 1 Jan 2026; check the rate card before pricing.
- **Vercel:** the webhook must answer fast; heavy work (media download) runs after the answer (`after()`), and the database region issue (the 24 Oct speed report) affects it too.

## 13. Open points to check with Meta's own documentation

- The exact rupee rates on Meta's current rate card.
- How far back coexistence history goes, and which message kinds sync (partner documents disagree).
- The current Tech Provider app review requirements and the Embedded Signup v4 details.
- Whether the chosen Solution Partner supports multi-partner solutions in India, its markup and fees.

## Sources (24 Oct 2026)
- Meta: [Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/), [Onboarding customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider), [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers), [Become a partner](https://business.whatsapp.com/partners/become-a-partner)
- Pricing: [Meta pricing docs (mirror)](https://support.chatarchitect.com/books/meta-whatsapp/page/pricing-on-the-whatsapp-business-platform-developer-documentation), [MyOperator 2026](https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026), [AiSensy 2026](https://m.aisensy.com/blog/whatsapp-business-pricing/)
- Partners and credit lines: [Exotel for Tech Providers](https://support.exotel.com/support/solutions/articles/3000126550-get-started-for-meta-tech-providers-with-exotel-for-whatsapp-isv-), [Whautomate: Tech Provider vs BSP](https://whautomate.com/whatsapp-tech-provider-vs-bsp), [Infobip Tech Provider setup](https://www.infobip.com/docs/whatsapp/tech-provider-program/setup-and-integration.md)
- Coexistence: [360dialog](https://docs.360dialog.com/partner/waba-management/phone-number-and-hosting/whatsapp-coexistence), [360dialog webhooks](https://docs.360dialog.com/partner/waba-management/phone-number-and-hosting/whatsapp-coexistence/coexistence-webhooks), [Telnyx](https://developers.telnyx.com/docs/messaging/whatsapp/coexistence.md)
