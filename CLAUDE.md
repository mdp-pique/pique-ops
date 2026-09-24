# Pique Ops App

Internal ticketing & conversations platform for Pique Properties. Full spec: `docs/PRD.md` — read it before working on any feature. This file is quick orientation + conventions; the PRD is the source of truth.

## Stack

- Next.js (App Router, TypeScript, Tailwind), deployed on Vercel.
- Supabase (project `fnapzaunhfjqftvbduma`, org `pique-revenue-management`) for Postgres, Auth, Storage. This is an **existing production database** shared with other internal tools (fraud checks, review pipeline, cleaning ops, revenue) — new tables live alongside ~45 existing tables. Never assume a clean slate; check `mcp__Supabase__list_tables` before adding anything.
- Google OAuth via Supabase Auth, restricted to the company Workspace domain.
- Migrations live in `supabase/migrations/`, applied via the Supabase CLI. Never hand-edit the production schema.

## Known schema overlap — resolved 2026-09-18

The PRD's §5 schema was drafted without visibility into the existing database. A schema check found overlap with `public.messages` (~193k rows, already syncs Hospitable guest messages) and `public.unanswered_message_alerts` (~45 rows, already does unanswered-message detection + Slack alerting). Decisions made and implemented:

1. **`public.messages` extended in place** (migration `20260918200000_ticketing_foundation.sql`): added nullable `conversation_id`, `intent`, `intent_confidence` columns rather than creating a parallel `messages` table. A new thin `conversations` table was added for grouping (calls attach to it too).
2. **`public.unanswered_message_alerts` is being retired, but not yet cut over.** Two live n8n workflows still own this feature and must NOT be edited until the new app is tested and trusted:
   - `Hospitable-Webhook-Receiver` (id `MRtl3ONWIiY5GnuW`) — on every inbound guest message, waits 10 min, classifies with Claude, upserts `unanswered_message_alerts`, posts to Slack `pique-team-chat-missed`.
   - `Pique-Unanswered-Message-Followup` (id `Lm0ATrPHvnP3lrDP`) — every 10 min, escalates or auto-resolves unresolved alerts.

   Instead, migration `20260918210000_shadow_unanswered_alerts_to_tickets.sql` adds a **Postgres trigger** (`mirror_unanswered_alert_to_ticket`, AFTER INSERT OR UPDATE on `unanswered_message_alerts`) that shadow-copies every alert into `tickets` (`type = 'unanswered_message'`, `external_ref = 'unanswered:{hospitable_message_id}'`) in real time. The trigger is wrapped in its own exception handler — a bug in it can never block or roll back the original write to `unanswered_message_alerts`, so the two n8n workflows are provably unaffected. Backfilled all 45 existing alerts on migration (verified 1:1 against the source table: 9 open / 36 resolved in both).

   **Do not edit either n8n workflow, and do not drop `unanswered_message_alerts` or this trigger, until the ticket queue UI has been used to verify parity with the existing Slack alert flow.** The actual cutover (n8n writes/reads `tickets` directly, old table and trigger removed) is a separate, deliberate step requiring explicit sign-off — see the "never edit what's already working" rule below.
3. No `public.calls` table existed — created new (GHL calls/voicemail, genuinely new surface).
4. No `public.profiles` table existed — created new (app auth/roles, `id` FK to `auth.users`).
5. `public.guests` already existed (uuid PK, Hospitable-synced) — this *is* the PRD's "no guests table on purpose" instinct already satisfied; nothing new needed there.
6. PRD §5 also called for adding `reservation_id` to `cleaning_job_map`, but that table is a **static** Connecteam-job-to-property mapping (verified: every `connecteam_job_id` appears exactly once, no `check_date`), not a per-occurrence record — a reservation-level FK doesn't make sense there. Only `cleaning_form_submission` and `cleaning_shift_check` (both have `check_date` in their composite PK, genuinely per-occurrence) got the `reservation_id` column.

## Shadow-mirrored automation flows — as of 2026-09-18

Beyond unanswered-message alerts (above), three more existing automated flows are now shadow-mirrored into `tickets` via exception-safe Postgres triggers (migration `20260918233000_shadow_mirror_cleaning_review_flows.sql`), same guarantee: zero edits to any live n8n workflow, a bug in the trigger can never block the source table's original write.

- **`cleaning_shift_check`** (`flag = 'no_show'`) → `cleaner_late_noshow` tickets, `external_ref = 'noshow:{shift_id}:{check_date}'`, `property_id` resolved via `cleaning_job_map.connecteam_job_id` (roughly half of `cleaning_job_map` rows are `match_confidence = 'unmatched'` with a null `property_id` — tolerate null property on these tickets, don't require it). `reservation_id` on `cleaning_shift_check` is 0% populated currently — don't join on it. Ticket auto-resolves when `flag` reverts to `'ok'`. Staff-facing, so `guest_name` stays null; `staff_ref` is the first id in `assigned_user_ids` (a jsonb array — only one cleaner captured, not the full crew).
- **`review_flags`** → a **new `review_flag` ticket type** (the PRD's catalog had no exact match for this suppression-decision stage — `review_removal_case` below is the distinct, later "drafted an actual removal request" stage). `external_ref = 'review_flag:{id}'`. `reservation_uuid` is `text` but casts cleanly to `reservations.id` for all current rows (wrapped in its own exception handler regardless, since it's an unconstrained free-text column). `property_id`/`guest_name` derived via the reservation join, not the table's own decorative `property_name` text column.
- **`review_removal_drafts`** → `review_removal_case` tickets (matches the PRD name/semantics directly). **One ticket per `review_id`**, not per draft row — `attempt_number`/`draft_status`/`airbnb_response` roll up into the same ticket's `metadata` as new attempts arrive, matching the PRD's rollover/parent-ticket model for this type. `external_ref = 'review_removal:{review_id}'`.

**Explicitly not mirrored: `guest_vetting`/fraud-check.** `Pique-Guest-Fraud-Check` (id `VVicBoPrc7zVCI7r`) never persists its verdict to any table — both its stages terminate in Slack posts to `#fraud-check` only. There is no source-of-truth row to shadow-mirror from. Building `guest_vetting` tickets requires either (a) adding a new write to that *live* workflow (a production edit needing explicit sign-off, not an additive shadow-mirror — same bar as the eventual cutover below), or (b) skipping this ticket type for now. Left undecided/unbuilt until the team picks one.

## Parking form → `vehicle_registration` tickets — as of 2026-09-24

The GHL form "213 FML Parking Registration" already posts to Slack from a GHL workflow (unchanged). A webhook action added to that GHL workflow calls the new n8n workflow `Pique-Parking-Form-To-Ticket` (id `8nKXAvhG1CVUKfIG`, webhook path `pique-parking-form`, requires `?key=` secret and `?property_id=`), which runs `select public.upsert_parking_ticket($1::uuid, $2::jsonb)` over the existing "Supabase Postgres" n8n credential - no service key in the workflow. All matching/upsert logic lives in that SQL function (migrations `20260924190000_*`, `20260924193000_*`, `20260924200000_*`); execute is revoked from public/anon/authenticated. Idempotent on `external_ref = 'parking:{reservation_id}'`.

## `review_flag` tickets are now actionable in-app — as of 2026-09-21

Previously `review_flag` tickets were read-only in the UI — nothing to click, no way to progress or close one from the app, which was confusing since they look identical to actionable `review_removal_case` tickets in the queue. Fixed additively, no changes to the existing `review_flags` table's own automation:

- Opening a still-undecided `review_flag` ticket now shows a **Start the appeal** / **Don't appeal** choice (`ReviewRemovalPanel.tsx`, gated by `flagReviewFlagsId`).
- **Don't appeal** writes `review_flags.status = 'suppressed'` plus `decided_by`/`decided_at`, via the admin (service_role) client — the exact same columns and value the existing Slack-based suppression flow already writes when a human decides there via Slack, so this is a second writer using the same contract, not a new one. The already-live `mirror_review_flag_to_ticket` trigger then resolves the ticket itself, same as it would for a decision made through Slack. `review_flags` has no authenticated write policy (only `service_role`), same reason `markUnansweredMessageResolved` uses the admin client for `unanswered_message_alerts`.
- **Start the appeal** reveals the same AI-draft tool `review_removal_case` tickets already had. Saving a draft (AI-generated or logged manually) also auto-resolves the originating `review_flag` ticket, since the attempt is now tracked on its own `review_removal_case` ticket instead.
- New: **"Already sent something for this?"** — a plain paste-and-log form (no AI call) for removal requests that were already sent before this tool existed, or off to the side. Inserts into `review_removal_drafts` exactly like an AI-generated attempt (`logManualAttempt` in `reviewRemovalActions.ts`), so it rolls into the same one-ticket-per-review history either way. Available from both a `review_flag` ticket and an existing `review_removal_case` ticket.

## Operating rule: never edit what's already working

The team's explicit rule for this project: build and extend freely and fast, but **never edit an existing, currently-working system** (a live n8n workflow, an existing table's current writers/readers, existing behavior anyone depends on) without stopping and getting explicit sign-off first. Additive changes (new tables, new nullable columns, new triggers that are exception-safe and don't change existing return values, new n8n workflows) are fine to do proactively. Editing something that already runs in production (an active n8n workflow, an existing RLS policy, dropping/renaming an existing column) is not — flag it and wait for a yes, however good the reason.

## Schema conventions (existing tables, follow for new ones)

- snake_case tables and columns.
- Core domain entities: `uuid` PK, `gen_random_uuid()` default (newer tables) or `extensions.uuid_generate_v4()` (older tables) — prefer `gen_random_uuid()` for anything new.
- Log/audit/mapping tables: `bigint identity` PK is also an accepted pattern (e.g. `review_flags`), but prefer real FK constraints for new tables — several existing ops tables (`review_flags`, `review_removal_drafts`, `guest_reviews`, `cleaning_form_submission`) skip FK constraints on columns that look like they should have them. Don't repeat that for new tables.
- `created_at` / `updated_at`: `timestamptz default now()`. Pure calendar fields (`check_in`, `review_date`) are `date`.
- External IDs from Hospitable: `hospitable_<entity>_id text unique`, separate from the internal `id` uuid PK.
- FK constraint naming: `<table>_<column>_fkey`.
- RLS is enabled on every table in this database — new tables must ship with policies, not rely on being hidden in the UI.

## Build conventions

- Store timestamps in UTC; display in `America/Edmonton`. SLA/deadline computations use the property's local date.
- All external writes (Hospitable message send, Slack post) are idempotent and logged as `ticket_events`.
- Webhook handlers verify signatures and are idempotent on the provider's event id.
- Automation-created tickets always set `external_ref` and upsert on it — never plain insert — or scheduled runs duplicate.
- Errors from the app's own jobs create `system_health` tickets and post to the existing error channel.
- Every new `SECURITY DEFINER` function must `revoke execute on function ... from public` (then grant only to the roles that need it). Ask Pique's read-only SQL can call any function it has execute on, and a definer function runs with its owner's privileges - forgetting the revoke turns it into a privilege-escalation path.
- Server actions that use the admin (service_role) client must derive the target row id server-side from something RLS-checked (e.g. the ticket), never take it from the client.
- Open fixes from the audit are tracked in `docs/PRD.md` §15 - check it before starting new work, and update it when one is fixed.

## Env vars

See `.env.example`.
