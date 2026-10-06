# In-flight work

Several Claude chats work on this repo at the same time. This file is how they avoid building the same thing twice or undoing each other. Rules are in `.claude/skills/housekeeping/SKILL.md`; run `scripts/housekeeping.sh` to check.

- **Add your row** before you start building, and update it when you push.
- **Delete your row** once the work is merged to main and described in CLAUDE.md.
- If someone else's row covers what you were asked to do, **stop and tell the user** before building.

## Active

| Branch | Working on | Touches | Updated | Status |
|---|---|---|---|---|
| `claude/github-setup-question-9b4s3w` | Cleaning shifts from bookings (Zap replacement), calendar, review flag "no review" close | `cleaning_shift_*`, `cleaning_property_jobs`, `plan/run/complete_cleaning_shift_*`, `cleaning_schedule_*` views, `src/lib/data/calendar.ts`, `CalendarView.tsx`, `ReviewRemovalPanel.tsx` (flag decision only), `RemovalCaseOutcome.tsx` + `closeRemovalCase`/`escalateRemovalCase`, appeal counting (`reviewAppeals.ts`, `tally_review_removal_appeals`, case title), Robert message drafting (`reviewEscalation.ts`, `EscalationDraftPanel.tsx`; only exported `RUBRIC`/`WRITING_RULES` in `reviewRemoval.ts`, no behaviour change) | 2026-10-02 | Live; monitoring |
| `claude/github-setup-question-9b4s3w` | **Zapier migration** (all 42 active Zaps off by 2026-10-20; cancel by 10-27). Tracker: `docs/zapier-migration.md` | new n8n flows per lane, new ticket types and `reservations` triggers, `src/lib/pique-bot/` (tiers, `alerts.ts`, `bookings.ts`, morning channels), `pique_bot_booking_posts`, n8n `Pique-Bot-Bookings`, `pique_bot_posts.kind`, `email_alert_rules` / `email_alert_messages` / `record_email_alert`, n8n `Pique-Email-Alerts` + `Pique-Bot-Alerts`, `docs/zapier-migration.md` | 2026-10-06 | Damage forms → claims built, in shadow (`Pique-Damage-Forms`; live once Pique Bot is in the 3 channels and the 4 Zaps are off). Booking feed to #new-reservations live; booking events live; **open for the next chat:** (1) ~~silence check~~ done 10-06 (`Pique-Silence-Check`), (2) ~~changelog feed~~ done 10-06 (`#change-logs`), (3) ~~invoices inbox~~ live 10-06 (all 3 rules posting), (4) GHL contact upsert from P1-45 (needs a GHL API key); email alerts in shadow (7 info@ rules), invoices@ rules need a Gmail login |
| `claude/charming-franklin-q8mryy` | Pique Bot Slack check-ins, review removal drafting, cleaning chat check-ins | `src/lib/pique-bot/`, `pique_bot_posts`, `src/lib/ai/reviewRemoval.ts`, `connecteam_chat_messages` | 2026-09-29 | From commit history - owner chat please confirm |

## Who owns live automations

Only the owning chat edits these. Anyone else asks the user first, even for a one-line fix.

| Live thing | Owner branch | Emergency stop |
|---|---|---|
| n8n `Pique-Cleaning-Shifts-From-Bookings` (`TCsHEpxNcHxqFOKd`) | `claude/github-setup-question-9b4s3w` | `automation_flags.cleaning_shifts_mode = 'dry_run'` |
| n8n `Pique-Connecteam-Shifts-Sync` (`rfFercNzL7BUJQfM`) | `claude/github-setup-question-9b4s3w` | unpublish the workflow (read-only sync) |
| Pique Bot (`src/lib/pique-bot/`, Slack app) | `claude/charming-franklin-q8mryy`; `claude/github-setup-question-9b4s3w` may extend it for the Zapier migration (MDP, 2026-10-02): immediate posts and tiers, morning behaviour kept | ask the owner chat |
| `automation_flags` keys `front_desk_notices_*` | unknown - claim it | ask before changing |

## Shared conventions

- `automation_flags` keys are prefixed by feature (`cleaning_shifts_*`, `front_desk_notices_*`). Never reuse another feature's prefix.
- Migration file versions must be unique. Run the script before adding one, and pick a timestamp later than the newest file on main.
