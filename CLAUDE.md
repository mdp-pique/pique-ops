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

## Env vars

See `.env.example`.
