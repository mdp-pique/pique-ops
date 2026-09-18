# Pique Ops App

Internal ticketing & conversations platform for Pique Properties. Full spec: `docs/PRD.md` — read it before working on any feature. This file is quick orientation + conventions; the PRD is the source of truth.

## Stack

- Next.js (App Router, TypeScript, Tailwind), deployed on Vercel.
- Supabase (project `fnapzaunhfjqftvbduma`, org `pique-revenue-management`) for Postgres, Auth, Storage. This is an **existing production database** shared with other internal tools (fraud checks, review pipeline, cleaning ops, revenue) — new tables live alongside ~45 existing tables. Never assume a clean slate; check `mcp__Supabase__list_tables` before adding anything.
- Google OAuth via Supabase Auth, restricted to the company Workspace domain.
- Migrations live in `supabase/migrations/`, applied via the Supabase CLI. Never hand-edit the production schema.

## Known schema overlap — read before touching §5 (Data model) in the PRD

The PRD's §5 schema was drafted without visibility into the existing database. A schema check on 2026-09-18 found overlap that changes how `conversations`/`messages` should be built:

- **`public.messages` already exists** (~193k rows) and already syncs Hospitable guest messages: `id, hospitable_message_id (unique), property_id, reservation_id, guest_id, direction, message_type, subject, body, sent_at, read_at, booking_source, raw_hospitable_data, last_synced_at, created_at, updated_at`. It has no `conversation_id` or `intent` column, and there is no `conversations` table — messages are flat, grouped only by `reservation_id`/`guest_id`.
- **`public.unanswered_message_alerts` already exists** (~45 rows) and already implements unanswered-message detection + Slack alerting: `id, hospitable_message_id (unique), reservation_id, alerted_at, slack_channel, slack_ts, resolved_at, resolved_by, last_escalated_at, escalation_count`.
- No `public.calls` table exists — GHL calls/voicemail is genuinely new.
- No `public.profiles` table exists — genuinely new, needed for app auth/roles (`id` FK to `auth.users`).
- No `public.conversations` table exists.
- `public.guests` already exists (uuid PK, Hospitable-synced) — this *is* the PRD's "no guests table on purpose" instinct already satisfied; don't create a second one.

**Decide explicitly, before writing the tickets/conversations migration, whether to:**
1. Extend `public.messages` in place (add `intent`, `intent_confidence`, maybe `conversation_id`) rather than creating a parallel `messages` table, and
2. Either retire `unanswered_message_alerts` in favor of the new `unanswered_message` ticket type, or keep it as the detector that ticket-creation hooks into — pick one, don't run both independently.

This is exactly the PRD's own rule #1 ("don't build two tables that do the same job") — resolve it deliberately rather than shipping a duplicate.

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
