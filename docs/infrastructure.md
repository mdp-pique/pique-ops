# Infrastructure

Record of deployment and auth configuration that lives outside the code. Any change to these settings must be noted here.

## Deploys (Vercel + GitHub)

Owner: MDP.

- **2026-09-24:** Vercel production branch set to `main`; GitHub default branch set to `main`. Live site: ops.piquepropertiesinc.com.
- Work happens on feature branches (currently `claude/github-setup-question-9b4s3w`); every push gets a Vercel preview URL. Merging (or fast-forwarding) into `main` is what publishes to live.
- Rollback: promote the previous production deployment in Vercel.

## Auth / Supabase config

Owner: MDP.

- **2026-09-24:** Supabase Auth redirect URLs now include `https://pique-*-pique-ops.vercel.app/**` so Vercel preview deployments can sign in. Replaced the broader `https://*.vercel.app/**`, which would have let any Vercel-hosted site receive our login redirects.
- Previews share the production Supabase database on purpose - they're for checking screens, not a data sandbox.
- Entries `https://pique-*-ops-pique-ops.vercel.app` and `https://pique-*-ops-pique-ops.vercel.app/**` look unused (they don't match real preview URLs like `pique-xod6qtbom-pique-ops.vercel.app`) and should be cleaned up later.
- Revisit a separate Supabase project or branch for previews once the team uses the app daily.

## Scheduled / automation workflows the app depends on (n8n)

- `Pique-Ticket-Health-Refresh` (`wFFvcYMRoY3AeJo6`) - every 15 min, `select public.refresh_ticket_health()`.
- `Pique-Parking-Form-To-Ticket` (`8nKXAvhG1CVUKfIG`) - GHL parking form webhook → `public.upsert_parking_ticket`. Webhook URL carries a secret `key` (kept in n8n and GHL, not in the repo).
- `Pique-Connecteam-Shifts-Sync` (`rfFercNzL7BUJQfM`) - hourly at :07, read-only copy of Connecteam Job Scheduler shifts (-7d to +6 months) into `connecteam_shifts` for the calendar and the booking-vs-shift comparison. Never writes to Connecteam.
- `Pique-Cleaning-Shifts-From-Bookings` (`TCsHEpxNcHxqFOKd`) - every 10 min, `select * from public.run_cleaning_shift_planner()`; creates / moves / deletes Connecteam shifts from bookings. Live since 2026-09-25. Setting `automation_flags.cleaning_shifts_mode` to `dry_run` is the emergency stop. Reads access info live from the "Connecteam Lookup" sheet; posts claimed-shift cancellations to Slack.
- `Pique-Detect-Removed-Reviews-Daily` (`6qNqQbphBc1eVCGx`) - daily review-removal detection.
All attached to the shared error handler `Pique-Error-Handler`.

## Zapier (cleaning shifts Zap turned off 2026-09-25)

- Zap "Hospitable reservation → Connecteam shift" creates cleaning shifts from Hospitable `reservation.changed` events (Edmonton + Calgary), looking up the Connecteam job by exact property name in the Google Sheet "Connecteam Lookup" (worksheet Jobs). **Turned off 2026-09-25 16:18 MT**, replaced by n8n `Pique-Cleaning-Shifts-From-Bookings` (PRD §7.9). Do not turn it back on while that workflow is live: both would create shifts.
