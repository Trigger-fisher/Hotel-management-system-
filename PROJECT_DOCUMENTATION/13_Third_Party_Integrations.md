# 13. Third-Party Integrations & External Services

| Service Name | Provider | Integration Purpose | Implementation File | Status |
|---|---|---|---|---|
| **Razorpay** | Razorpay Software Ltd | Payment links, QR codes, checkout folios, refunds, dispute webhooks | `web-app/src/server/services/razorpay/*` | Active & Verified |
| **Amazon SES** | Amazon Web Services | Outbound transactional emails (invoices, OTP codes, vouchers) & inbound parsing | `web-app/src/server/mail/*` | Active & Verified |
| **Amazon SNS** | Amazon Web Services | Webhook delivery notifications, bounce handling, spam complaint suppression | `web-app/src/app/api/v1/public/mail-events/*` | Active & Verified |
| **GSTIN Lookup API** | `gstinapi.in` | Automated company profile retrieval via 15-character GSTIN number | `web-app/src/server/services/gst/*` | Active & Verified |
| **Cloudflare** | Cloudflare Inc | DNS, TLS termination, CDN caching, Turnstile bot detection, edge resets | `security/docs/CLOUDFLARE-*` | Active & Configured |
| **Sharp** | `sharp` (libvips) | Server-side image resizing, decompression bomb protection, WebP compression | `web-app/src/server/media/*` | Active & Verified |
| **MSG91 / Twilio** | MSG91 / Twilio Inc | Critical security incident SMS alerts to platform administrators | `web-app/src/server/services/security/alerts.ts` | Code Ready (Awaiting keys) |
| **Google Drive** | Google LLC | Automated nightly database backup exports | `web-app/src/server/services/backup/*` | Active & Verified |
| **Supabase Storage** | Supabase / AWS S3 | Cloud storage of hotel photo galleries, room service menu images | `web-app/src/server/media/s3.ts` | Active & Verified |
