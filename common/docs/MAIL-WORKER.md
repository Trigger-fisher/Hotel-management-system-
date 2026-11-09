# The mail worker: how campaign mail actually goes out

HMS never sends mail inside a request. Every mail is a row in `platform.outbox`, and a **worker** sends it later. This page explains who runs that worker on each kind of host. A campaign of 50,000 mails needs the worker to keep running for hours, so read the section for your host.

## What one worker pass does

`GET /api/v1/cron/mail` (with `Authorization: Bearer <CRON_SECRET>`) runs passes for up to 40 seconds. The code is in `web-app/src/server/compose/mail.ts`, function `drain`. Each pass:

1. **Feeds the campaigns.** It moves the next recipients of each running campaign into the outbox (`services/companies/campaignFeed.ts`). At most 200 campaign mails per hotel wait in the queue at once. A hotel never gets more than it may still send today: the lowest of its mail service's daily limit, its own limit and the Super Admin's cap. Paused campaigns and held hotels get nothing.
2. **Sends system mail first.** Sign-in codes, resets, invoices and receipts always go before any campaign mail, so a big campaign can never delay a code.
3. **Sends campaign mail.** It goes out at each hotel's mail-service pace (mails per second), never to a suppressed address, and never for a hotel on hold.

The answer is `{ sent, failed, remaining }`.

## On Vercel

- **When a mail is queued**, the same request runs one pass right after its answer (`HMS_MAIL_WORKER=cron`). That is why codes and invoices arrive at once.
- **The cron in `web-app/vercel.json`** calls `/api/v1/cron/mail` once a day (`0 2 * * *`). The Hobby (free) plan allows nothing more frequent.
- **A campaign does NOT finish on the free plan with the daily cron alone.** Each call sends for at most 40 seconds. Pick one of the two options below.

### Option A: Vercel Pro, cron every minute

In `web-app/vercel.json`, change the mail line to:

```json
{ "path": "/api/v1/cron/mail", "schedule": "* * * * *" }
```

Each minute then sends for up to 40 seconds. At 14 mails a second (SES) that is about 33,000 mails an hour. The hotel's own limits still apply.

### Option B: any machine that stays on (a VPS, the hotel's PC), with the small loop

`scripts/mail-worker.mjs` needs Node 18 or later and no packages. It has no database access; it only calls the route.

```sh
HMS_URL=https://your-site.example CRON_SECRET=the-same-value-as-on-Vercel node scripts/mail-worker.mjs
```

- **Pace:** it calls the route again within 2 seconds while mail is still waiting, otherwise every `HMS_MAIL_EVERY` seconds (default 30).
- **What it prints:** only counts. The secret is never printed.
- **Stopping:** Ctrl+C. It also stops by itself when the server refuses the secret.
- **Keeping it running on a VPS:** use a service manager. For example, systemd with `Restart=always` and the two variables in an `EnvironmentFile` that only root can read.

## On a VPS running the whole app

Leave `HMS_MAIL_WORKER` unset (in-process mode). The app starts its own worker when the server starts: a pass every 5 seconds, and a quarter of a second after a mail is queued. Nothing else is needed. The cron route still works as a safety net.

## Deliverability (platform migration 0130)

- **Reports:** the mail services report bounces and complaints to `POST /api/v1/public/mail-events/ses` and `/brevo`. The full addresses, with their secret key, are shown under Super Admin > Platform settings > Mail > Bounces and holds.
- **Suppression:**
  - a hard bounce keeps the address off every hotel's campaigns;
  - a complaint keeps it off that one hotel's campaigns;
  - an unsubscribe through the service does the same for that hotel.
- **Holds:**
  - A hotel is held when, over 7 days, bounces pass 5% of at least 200 mails, or complaints pass 0.1% of at least 1,000 mails.
  - A held hotel's campaign mail stops; its system mail still goes.
  - The Super Admin releases it with a reason, and its rates are counted again from the next day.
- **SES setup:** create an SNS topic and subscribe the SES address above over HTTPS (HMS confirms the subscription by itself). Then choose that topic for the Bounce and Complaint notifications of the SES identity. Every SNS message must carry AWS's signature; anything else is refused.

## Checking it

- Super Admin > Platform settings > Mail > Bounces and holds: the holds and the suppressed addresses.
- Companies > Email Marketing: for each campaign, how many have been handed to the queue, delivered, failed or are still waiting.
- `GET /api/v1/cron/mail` with the secret: `remaining` is what still waits in the queue.
