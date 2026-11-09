# Progress report procedure (for MJ: easy to understand, percentage first)

Used for the scheduled updates (06:00, 07:00, ...). Zero agents. No commit/push.

FORMAT: start with ONE big line "OVERALL: NN% complete, NN% pending". Then a plain table with a text progress bar per area, e.g. "Guest dashboard | web 100% | mobile 100% | ██████████". Plain English, very short sentences, no jargon. Under the table: DONE bullets, PENDING bullets, "Next", at most 3 questions for MJ.

COMPUTE: Guest 6 screens, Corporate 7, Hotel areas ~85 (overview 3, frontOffice ~10, billing 2, cash 3, companies ~7, payrollCore ~8, payrollPay ~14, website ~10, admin ~8), login connected to dashboards, backend per area (0% until the backend phase starts), data import, integrations (Razorpay, Google, email). Show: Screens on web, Screens on mobile, Login connected, Backend, Data import, Integrations, OVERALL (screens 50% weight, backend 40%, import and integrations 10%). A screen counts only if it exists in the groups folder AND the group registers it AND it passes type check. Also report: component library status (docs/COMPONENTS.md exists?), review findings received (docs/design/ui-review/12-*.md exists?).

STEPS
1. SendMessage Web UI 1, Mobile UI 1 and hms-7e: "MJ needs a progress update. Reply in 6 lines max: % done and % pending of your part, screens finished per area, what is in progress, blockers." Don't interrupt their work beyond that.
2. Measure from files: screen files in `web-app/src/dashboards/groups/<group>` and `Mobile App/src/dashboards/groups/<group>` for the 11 groups (guest, corporate, overview, frontOffice, billing, cash, companies, payrollCore, payrollPay, website, admin); whether each group's index registers its screens; whether `ui-shared/dashboards/<group>.ts` exists; work log `docs/sessions/reports/S03-work-log.md`; whether login is connected (search SignedInStep.tsx and Mobile App/src/steps/SignedIn.tsx for RoleDashboard); run `tsc --noEmit` in `web-app` and `Mobile App`. Web screen file names differ per group, so also trust the sessions' replies.
3. Write the report to `docs/sessions/WORK-REPORT-<date>-<HHMM>.md` and show it to MJ in the chat in the same format.
4. EMAIL to jungimihir1947@gmail.com ONLY (MJ's own address). Load Gmail tools with ToolSearch (`mcp__claude_ai_Gmail__send_message`, `mcp__claude_ai_Gmail__create_draft`). Send a clean HTML email, subject "HMS update: NN% complete (<date>, <time>)". If sending fails, create a draft. If Gmail asks to sign in, say so. Tell MJ exactly what happened (sent / drafted / failed).
5. If sessions have not replied yet, report from file measurements and say which numbers are still waiting.
