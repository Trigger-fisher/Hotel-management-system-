# 07 - How a review runs

Set by the Lead (hms-c0), 2026-10-05, and changed by MJ the same day: **work goes back until it feels premium** ([00-PREMIUM-STANDARD.md](00-PREMIUM-STANDARD.md)). MJ's gates (MASTER R1, R2, R9) always apply.

## 1. The flow

```
Web UI 1 ──report──┐                         ┌── "must fix" list ──> Web UI 1
                   ├──> UI Review (me) ──────┤
Mobile UI 1 ─report┘        │                └── "must fix" list ──> Mobile UI 1
                            │   (no round limit: until it passes the premium bar)
                            └── when clean: ONE short report ──> Lead (hms-c0) ──> MJ
```

1. A team sends its completion report (what was built, how to run it, screenshots, open questions).
2. I review against [07-CHECKLIST-AUTH-S02.md](07-CHECKLIST-AUTH-S02.md), in this order:
   1. Quality gates (lint, type check, build). If these fail, stop and send them back first.
   2. Spec match, screen by screen (all 16 steps).
   3. States: loading, error, offline, rate-limited, success (walk every demo account).
   4. Accessibility.
   5. Web vs mobile consistency (needs both reports).
   6. Code quality for the framework version.
   7. **Premium scorecard**: score every screen on the 10 dimensions; check the instant send-back list.
3. I send each team its own list. Only their files, only real problems, each with file:line and the fix.
4. They fix and reply. I re-check **only** the listed items plus anything their fix touched.
5. No round limit (MJ, 2026-10-05). If the **same** item fails 3 times, I tell the Lead and MJ with 2 options (MASTER 6.3) and the work still goes back.

## 2. Severity

| Level | Meaning | Examples |
|---|---|---|
| **Must fix** | Breaks the spec, a MASTER rule, WCAG 2.1 AA, or a gate. Blocks "clean" | Lint/type/build fails; missing state; raw error shown; label missing; text not from `copy.ts`; contrast fail; double submit possible; dark mode leaks in; token left in URL |
| **Should fix** | Works but is clearly worse than the agreement or best practice | Wrong gap size; focus lands on the wrong element; animation ignores reduced motion on one screen |
| **Note** | Idea or question, does not block | Better wording to suggest to the Lead; future feature |

"Must fix" items and any premium score below 4 block. "Should fix" items are sent too and listed in the final report if still open.

## 3. Finding format (to a team)

```
## UI Review - <Web UI 1 | Mobile UI 1> - round <n>
Gates: lint ✅/❌  types ✅/❌  build ✅/❌
| # | Severity | Screen | File:line | Problem | Fix |
|---|---|---|---|---|---|
| 1 | Must fix | signIn | src/... :42 | Password field has no autocomplete | add autoComplete="current-password" |
Re-check on reply: items 1-n. Please reply "fixed 1-n" with any you disagree with and why.
```

Rules for findings:
- One problem per row. Point to the exact place. Say the fix in one line.
- Quote the spec line when the spec decides it ("agreement §3 PasswordField").
- No style opinions that the spec does not back. Those go to the Lead as a "Note".
- If the spec itself is wrong or silent, do not invent a rule: ask the Lead.

## 4. Report to the Lead (when both teams are clean)

Short, plain English (MASTER §12, R12):

```
## Authentication UI - step 3 review
Status: Clean / Needs MJ
| Built | web: 16 steps ...  mobile: 16 steps ... |
| Checks | web lint/types/build ✅  mobile lint/types ✅  Expo web runs ✅ |
| Premium score | web: avg x.x (lowest x), mobile: avg x.x (lowest x) |
| Rounds | web: n, mobile: n |
| Left (should fix / notes) | ... |
Questions for MJ (max 5, each with my recommendation): ...
```

## 5. What I never do

- Review backend, API, database or server security (MJ: frontend only).
- Edit the teams' files, `ui-shared/` or `docs/` (Lead's files).
- Start another feature, or review anything outside the NOW feature (R1).
- Talk to MJ on behalf of the Lead's process unless MJ talks to me directly (this session is MJ's too).
- Commit or push (R9).
