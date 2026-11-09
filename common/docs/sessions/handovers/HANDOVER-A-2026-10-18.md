# Handover of session A (Backend, mail lane), 18 Oct 2026

Written on MJ's stop order. From here claude-d3 continues the remaining work alone. Nothing of A is uncommitted in the Pilot folder.

## Done (committed on main, tested)
| Slice | Commits | Migrations / Neon files | Tests |
|---|---|---|---|
| Gmail-only mail, seal key from HMS_HASH_KEY, saved settings beat env | 66fe186 | - | mail.shared, mail.key, platform.smtp, settings.email |
| Email bill / receipt PDF proof, dev log attachment line | aabdcb5 | - | mail.routing |
| Mail of a hotel that cannot be opened: NO_HOTEL, never retried | 3850f0f | - | mail.routing |
| Console writes no longer 500 on Idempotency-Key (live bug); FORBIDDEN never a 500 | af7a665 | - | wrapper |
| Mail services (SES, Brevo, Gmail, other SMTP), platform or own mail per hotel, lanes, daily caps, pacing, write-only secrets | b7f4c7c | platform 0125, 0126 + NEON-SQL-0125, -0126 | mail.lanes (incl. 50,000-row load test, fake provider), platform.smtp, settings.email, mail.hotel |
| Monthly usage per hotel, Super Admin daily cap per hotel | 707c652 | (tables of 0126) | mail.usage |
| Sender identities: platform sending domain, a hotel's own domain under the platform SES, DKIM/SPF/DMARC records, DNS check | 28ae2d0 | platform 0128 + NEON-SQL-0128 | mail.identity, settings.email |
| Copy no longer says Gmail only | 1263257 | - | - |
| Identity table probe SQL quote fix (would have broken the domain step on live); db tests for lanes, counts, caps, identities | 21a7902 | - | tests/db auth.repo, platformConsole.repo (hms_test) |
| Health: pending hotel migrations from the SET of files (gaps 0038 / 0040 are not pending) | 5bba8cf | - | provisioner.migrations, platform.superadmin; tests/db platformSuper.flow |

Contract for the screens: ui-shared/dashboards/mailProviders.ts (providers, records, identities), platform.ts / admin.ts and their mocks. Docs: docs/BACKEND.md sections 21 and 22.

## Neon SQL (live database) to run, in this order
1. NEON-SQL-0123-PLATFORM-SMTP.sql, 2. NEON-SQL-0124-OUTBOX-INVOICES.sql (if not yet run), 3. NEON-SQL-0125-MAIL-PROVIDERS.sql, 4. NEON-SQL-0126-MAIL-LANES-USAGE.sql, 5. (B's 0127, then 0129 as their owners say), 6. NEON-SQL-0128-SENDER-IDENTITIES.sql.
Each file checks the previous step and does nothing when already applied. The checksums were not re-verified against the runner after the last commits: H4 was to do that and was stopped (see below); check them before running.

## Not done (helpers stopped before anything was committed)
| Slice | State | Branch (no commits on it) |
|---|---|---|
| H1: suppression list, SES (SNS) and Brevo bounce/complaint webhooks, per-hotel rates, auto-pause, Super Admin resume | stopped while starting; nothing written that survived | worktree-agent-a46776717f1001ce7 (= a824dc9) |
| H2: campaign engine (chunks, pause/resume/cancel, progress, estimate, confirm), docs/MAIL-WORKER.md, scripts/mail-worker.mjs | stopped mid-way; its worktree was removed when it stopped, the uncommitted work is gone | worktree-agent-ae43e0d75afeab843 (= a824dc9) |
| H4: check Neon files against migrations (checksums), RUN-ORDER lines, BACKEND.md 21-22 against the code, contract notes for the mail screens | stopped; nothing committed | worktree-agent-ac1a68c518ba86005 (= a824dc9) |
| H3: 50,000-row load test with EXPLAIN on PostgreSQL | never started (it was to follow H1/H2) | - |

Reserved migration numbers, NOT created anywhere: platform 0130 (for H1's suppression tables) and hotel 0044 (for H2's campaign columns). The three helper branches are empty and can be deleted by whoever owns the clean-up; their worktree folders no longer exist (`git worktree prune` clears the entries).

## Next steps (for whoever continues)
1. Verify the checksums of NEON-SQL-0125 / 0126 / 0128 against db/scripts/migrate.ts (how it hashes, line endings) before MJ runs them; add their lines to docs/neon-sql/RUN-ORDER.
2. MJ's AWS step: Platform settings > Mail: SES + sending domain; Platform > Mail senders: paste the three DKIM names from SES, add the DNS records shown, Check now, confirm in SES (steps in BACKEND.md section 22).
3. Suppression + webhooks + auto-pause (platform 0130), then the campaign engine (hotel 0044, or the next free number at that time), as specified in the H1 / H2 briefs: the plan is docs/plans/MAIL-PROVIDERS-50K-PLAN-2026-10-18.md.
4. Mail worker on Vercel: the daily cron alone cannot finish a campaign (Pro: cron every minute on /api/v1/cron/mail, or a VPS worker calling it with CRON_SECRET).
5. Small: drop the stale SAFE entry "/api/v1/admin/menu/images/x" in web-app/tests/server/apiTokens.test.ts (no route matches it; promised to claude-11, not done).
6. Known: the PostgreSQL claim queries of the lanes were tested for correctness on hms_test, not measured at 50,000 rows (H3's job).
