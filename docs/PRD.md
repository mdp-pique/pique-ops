# Pique Ops App - PRD v1.1
### Ticketing & Conversations (internal ops platform, Phase 1)

**Status:** Build-ready draft. Written to be handed directly to Claude Code as the build spec.
**Owner:** MDP
**Last updated:** 2026-09-18 - v1.1 adds the gaps found in a full review of the project conversation: maintenance tickets with rollover, checklist items, reservation stage/timeline view, dedup keys for automation-created tickets, the cleaning-table `reservation_id` fix, inbound-message intent classification, notifications spec, and build conventions. Wyze (self-hosted on the n8n VPS) and Robert (external, team ticket) decisions closed.

---

## 0. What this document is

This is the build spec for the first real piece of the Pique ops platform: an internal, login-required web app that gives the team one place to see and act on the things that currently fall through the cracks between Hospitable, Connecteam, Slack, GHL, Gmail, and memory.

It supersedes the phase ordering in the earlier "Reservation Spine" architecture doc in one way: **ticketing + conversations is now Phase 1**, not the console-plus-ingest phase described there. Everything else from that doc carries forward - the six-stage reservation spine is the organizing concept, the data-reuse philosophy drives the schema, and GPS/native app/payroll stay deferred.

Two rules that govern every decision below:
1. Don't build a new table for data that already exists, and don't build two tables that do the same job.
2. The unit of work is the reservation. Every ticket and conversation should be reachable from the reservation it belongs to.

---

## 1. Why this first

Katrina (co-owner) sent a list of operational gaps - the source for most ticket types in §9. Almost none of it is "we need a new system." Nearly all of it is "we need one place that makes sure this doesn't get missed," which is a ticketing and conversation problem.

Two threads run through her list:
- **Things get missed** because they live in a Slack scroll, a person's memory, or a platform inbox nobody is watching closely enough (initial guest messages buried under the auto-reply, missed calls, extension requests, guest blocking).
- **There's no record** of what stage something is at or whether it ever got resolved (review removal attempts, review-driven fixes, claim status, pet fee collection, maintenance items half-finished).

Both are solved by the same thing: a ticket with a status, an owner, a history, sub-items where needed, and the related conversation attached.

---

## 2. Users & roles

| Role | Who (today) | Access |
|---|---|---|
| `admin` | MDP, Michael & Katrina Stead | Everything, including user management |
| `ops_manager` | Tammy Formoe | Everything except user management; approves overtime, receives escalations |
| `customer_service` | CS team | Tickets, conversations, guest-facing actions |
| `cleaning_coordinator` | Janina | Cleaning ticket types, QC, scheduling |
| `finance` | Cristine, Laurice | Claims, pet fee, owner-statement-adjacent tickets |

Roles are enforced with Supabase Row Level Security, not just hidden in the UI.

**Cleaners and maintenance staff are not app users in Phase 1.** They stay in Connecteam. Tickets reference them by Connecteam user id (see §5 `staff_ref`), so cleaner-to-clean-to-review attribution works now and carries into the native app later.

---

## 3. Non-goals for v1 (explicitly deferred, not forgotten)

- GPS breadcrumbs, geofenced clock-in/out, native mobile app - Phase 3.
- Full Connecteam replacement - Connecteam stays system of record for time clock/scheduling; this app reads from it.
- Payroll build - QuickBooks Online Payroll owns Canadian payroll calculation; hours pushed via QuickBooks Time API in Phase 4.
- Replacing Hospitable - this app reads/writes through Hospitable's API.
- AI-assisted auto-scheduling - stretch milestone M6, not a launch requirement.
- **Superhost risk scoring / rating prediction** - Phase 2 (AI layer). The data to compute a trailing-12-month account rating already exists in `reviews`; the dashboard in §7.5 reserves a slot for it.
- **AI review of cleaning photos** - Phase 2.
- **SOP chat widget for field staff** (in their own language, escalates to a ticket when it can't answer) - Phase 3, native app.

---

## 4. Architecture & stack

- **Frontend/backend:** Next.js (App Router), hosted on **Vercel Pro** (~$20/mo). Server-rendered internal app. Mobile-responsive is a requirement, not a nice-to-have - the team checks this from phones.
- **Database/auth/storage:** **Supabase**, existing project `fnapzaunhfjqftvbduma` (already Pro). New tables live alongside existing tables in the same Postgres database. Supabase Storage for attachments (photos, documents, voicemail audio if GHL URLs expire).
- **Auth:** Google sign-in via Supabase Auth Google OAuth provider, restricted to the company Workspace domain. No self-serve signup; admin provisions `profiles` rows.
- **Automation layer:** existing n8n instance keeps running unchanged and gains one more destination: writing tickets. Recurring ticket creation (nightly security check, review-window reminders) is scheduled in n8n too, since that scheduler already exists and is monitored by `Pique-Error-Handler`.
- **AI:** Claude API (already in use) for inbound-message intent classification (§7.3) and review-email matching fallback (§10).
- **External APIs:** Hospitable (reservations, messages, reviews, smart-lock device status, webhooks), Connecteam (read-only time/shift data), GoHighLevel (calls/voicemail), Gmail (Airbnb decision emails), Wyze (cameras - caveat in §12).

---

## 5. Data model

Core principle: **one generic ticketing system, not twenty bespoke tables.** Every ticket type in §9 is a row in `tickets`, distinguished by `type`, with type-specific fields in `metadata` jsonb. Things that need to be queried, joined, or counted reliably get real columns; things that are just displayed live in `metadata`.

```
tickets
  id                 uuid pk
  type               text           -- see §9 catalog
  status             text           -- open | in_progress | blocked | resolved | closed
  priority           text           -- low | normal | high | urgent
  stage              text, nullable -- book | checkin | stay | checkout | turnover | accountability
                                    -- which point on the reservation spine this belongs to; drives the timeline view
  property_id        uuid fk -> properties
  reservation_id     uuid fk -> reservations, nullable
  conversation_id    uuid fk -> conversations, nullable
  guest_name         text, nullable
  staff_ref          text, nullable -- Connecteam user id of the cleaner/maintenance person this is about (not an app user)
  assignee_id        uuid fk -> profiles, nullable
  created_by         uuid fk -> profiles, nullable   -- null = automation
  source             text           -- manual | automation | guest_message | missed_call | email
  external_ref       text unique, nullable
                                    -- dedup key for automation-created tickets, e.g. 'fraud:{reservation_id}',
                                    -- 'noshow:{connecteam_shift_id}', 'review_removal:{review_id}'.
                                    -- Automations upsert on this; without it, every scheduled run creates duplicates.
  parent_ticket_id   uuid fk -> tickets, nullable    -- set when this ticket was rolled over from another
  rollover_count     int default 0
  due_at             timestamptz, nullable
  sla_breached       boolean default false
  metadata           jsonb
  created_at / updated_at / closed_at

ticket_items                        -- checklist sub-items; what makes "2 of 3 done -> roll over" computable
  id, ticket_id fk, label, is_done boolean default false, done_by fk -> profiles nullable, done_at, sort_order

ticket_comments
  id, ticket_id fk, author_id fk -> profiles (nullable = system), body, created_at

ticket_attachments
  id, ticket_id fk, storage_path, kind (photo|document|audio), uploaded_by, created_at

ticket_events                       -- full audit trail, not just status. "Accountability" is literally a spine stage.
  id, ticket_id fk, event_type (status_change|assignment|field_change|rollover|escalation|item_done|comment),
  actor_id fk -> profiles nullable, from_value, to_value, note, payload jsonb, created_at
  -- review_removal attempt count = count of events where event_type='status_change' and to_value='denied' on the same ticket

conversations
  id, reservation_id fk nullable, property_id fk nullable, guest_name, guest_phone,
  channel           text   -- hospitable_message | phone_call | sms
  external_id       text   -- Hospitable reservation uuid, or GHL contact/conversation id
  last_inbound_at, last_outbound_at, unanswered boolean default false, created_at

messages
  id, conversation_id fk, direction (inbound|outbound), author, body, sent_at,
  hospitable_message_id text unique nullable,
  intent            text, nullable  -- set by classifier: question | extension_request | complaint_cleaning |
                                    -- complaint_maintenance | early_checkin | late_checkout | other
  intent_confidence numeric, nullable

calls
  id, conversation_id fk nullable, phone_number, direction,
  call_status       text   -- missed | answered | voicemail
  duration_seconds, recording_url, transcript, occurred_at, provider, provider_call_id text unique

profiles
  id fk -> auth.users, role, display_name, slack_user_id nullable
```

**Required changes to existing tables (carried over from the Reservation Spine doc - the one structural gap found in the database):**
- Add `reservation_id uuid fk -> reservations, nullable` to `cleaning_form_submission`, `cleaning_shift_check`, and `cleaning_job_map`. Backfill by matching property + date to checkout. Without this, a cleanliness complaint in a review cannot be traced to the clean and the cleaner who did it - which was one of the first things asked for in this project.

**Guest identity:** there is no `guests` table on purpose. Guests are identified through the reservation. When something arrives keyed only by a first name (an Airbnb email saying "Jessica's review won't be removed"), it is matched via the review text quoted in the email body against `reviews.text` -> `review_id` -> `reservation_id`. Name alone is never the key.

**Reservation spine:** every ticket and conversation carries `reservation_id` and tickets carry `stage`, so the per-reservation timeline (§7.5) is a query, not a separate table. The `reservation_timeline` pointer table from the earlier doc is not needed unless that query gets slow.

---

## 6. Auth & permissions

- Google OAuth via Supabase Auth, domain-restricted.
- `profiles.role` drives RLS policies. Cleaning roles see cleaning ticket types; finance sees claims and fees; CS sees tickets and conversations; ops_manager and admin see all.
- No public surface. 100% internal.

---

## 7. Core product surfaces

### 7.1 Queue
The default screen. Filterable by type, status, assignee, property, stage, SLA state. "Mine", "Unassigned", "Breached" as one-tap views. This is what replaces scrolling Slack.

### 7.2 Ticket detail
Status, assignee, due, stage, linked reservation and property, checklist items, comments, attachments, event history, and the linked conversation inline if there is one. Every action here writes a `ticket_events` row.

### 7.3 Conversations
**Guest messaging (Hospitable):**
- Webhook-first sync of reservation messages into `conversations` + `messages`, with a polling fallback (every 5 min) in case a webhook is missed.
- `unanswered = true` when the latest message is inbound and no outbound (human or automation) followed within a configurable window (start at 30 min). Creates an `unanswered_message` ticket.
- **Inbound-message intent classifier (Claude):** every inbound message gets an `intent`. This is the engine behind several ticket types: `extension_request`, cleaning and maintenance complaints during a stay (auto-create `cleaning_issue` / `maintenance_ticket` with `stage = stay`), early check-in / late checkout asks. It is also what stops the initial message from being "buried": a message classified as a question with no human reply gets surfaced regardless of the auto-reply having fired.
- Reply from the app via `send-reservation-message`.

**Calls & voicemail (GoHighLevel):**
- Every call and voicemail becomes a `calls` row, matched to a conversation by phone number. Missed calls create a `missed_call` ticket.
- Voicemail playable in-app; transcript stored. If GHL recording URLs expire, copy the audio to Supabase Storage on ingest.
- Before M3, confirm GHL sub-account, that LC Phone is active, and API/webhook access.

### 7.4 Property page
Per property: open tickets, latest smart-lock status from Hospitable (`get-property-devices` - battery, online, locked; confirmed working), recent conversations, recent reviews with category subscores, QC history.

### 7.5 Reservation timeline
The screen that makes this an ops platform rather than a ticket queue. One reservation, six stages left to right (Book -> Check-in -> Stay -> Check-out -> Turnover -> Accountability), with the tickets and conversation events for that reservation pinned to their stage. Green when nothing is open, colored by the worst open ticket otherwise. This is the "Reservation Spine" diagram, made live. Status of the guest vetting check, the clean (and who did it), any maintenance, the review and its subscores, any removal case, and any claim are all visible here without leaving the page.

### 7.6 Dashboard
Counts by type and SLA state; unanswered conversations; missed calls awaiting callback; review-removal cases by attempt stage; claims approaching filing deadline; locks offline. One reserved tile for Phase 2: trailing-12-month account rating vs the 4.8 Superhost threshold.

---

## 8. Ticketing - core mechanics

- **Lifecycle:** `open -> in_progress -> (blocked) -> resolved -> closed`. Every transition is a `ticket_events` row.
- **Checklist items:** any ticket can have `ticket_items`. A ticket cannot be marked `resolved` while items are undone unless it is rolled over.
- **Rollover:** for `maintenance_ticket` (and any type that opts in), if the assignee closes their shift with items undone, the ticket is resolved as `partial`, a new ticket is created with `parent_ticket_id` set, the undone items copied, and `rollover_count + 1`. At `rollover_count = 3` an `escalation` event fires and the ticket is reassigned to `ops_manager` with a Slack ping.
- **Recurrence:** recurring tickets (`property_security_check` nightly, `guest_review_reminder` per review window) are created by an n8n schedule that upserts on `external_ref`, so re-runs never duplicate.
- **Dedup:** every automation writes `external_ref`. Upsert, never insert.
- **Assignment:** any ticket can be assigned; unassigned tickets are visible in the shared queue. Assignment writes an event and notifies the assignee.
- **SLA:** each type has a default clock (§9). Breach flips `sla_breached`, writes an event, and notifies per §8.1.
- **Comments & attachments:** on every ticket. Evidence for claims and review-driven fixes lives here, not in photo rolls and texts.

### 8.1 Notifications
- **Slack stays.** Every ticket create and SLA breach posts to the channel that type already uses today (fraud -> Customer Service subteam; cleaning -> Tammy's daily audit channels; pack-n-play -> the reminder channel), and every post carries a deep link to the ticket. Do not remove any channel the team currently watches - add links into them.
- **In-app:** notification list for assignment, @mention in a comment, escalation, and SLA breach.
- **Create from Slack (M2):** a reaction emoji on any Slack message creates a ticket with the message text as the body and a link back. This was designed once before (review-suppression "Component C") and stalled on agreeing the reaction scheme - pick one reaction, ship it, iterate.

---

## 9. Ticket type catalog

`source` says whether a person or an automation creates it. `stage` is the default spine position.

| Type | Stage | Source | Key fields / items | Default SLA | Notes |
|---|---|---|---|---|---|
| `guest_vetting` | book | automation (existing fraud-check n8n) | history tier, flagged reason, DNH match | Before check-in | Existing workflow; now upserts a ticket (`external_ref = fraud:{reservation_id}`) in addition to Slack |
| `direct_booking_id_check` | book | automation | ID collected?, purpose of trip, pet count | Before check-in | Trigger: reservation with platform = direct. Items: ID, purpose, pets |
| `pet_fee` | book | automation | requested?, collected?, escalated to Airbnb? | 48h after booking | Trigger: pets flagged on the reservation (data already surfaces in the arrivals check) |
| `unanswered_message` | any | automation (conversations) | conversation_id, minutes since inbound | 30 min | |
| `extension_request` | stay | automation (intent classifier) | requested dates, responded? | 2h | |
| `missed_call` | any | automation (GHL) | call_id, caller, callback done? | 1h | |
| `maintenance_ticket` | stay / turnover | automation (intent classifier, review subscores) or manual | items (one per issue), staff_ref, rollover_count | Before next check-in | The missing piece from v1.0. One ticket per unit-visit, one item per issue (lamp, dishwasher, deck door). Partial completion rolls over per §8; 3rd rollover escalates to Tammy |
| `maintenance_access` | stay | linked to maintenance_ticket | guest notified at, 24h rule satisfied?, guest permission | Before technician visit | Child of a maintenance ticket, not standalone |
| `cleaning_issue` | turnover / accountability | automation (review cleanliness subscore <= 3, or intent classifier) or manual | complaint, staff_ref (cleaner from `cleaning_job_map` via reservation_id), photos | Same day | This is cleaner-to-review attribution. Depends on the `reservation_id` fix in §5 |
| `property_security_check` | any (nightly) | recurring (n8n) | items per device: each lock (online, locked, battery via Hospitable), each camera (online via wyze-sdk; optional nightly snapshot verdict) | Nightly | Locks via Hospitable are solid. Cameras via the self-hosted Wyze job on the n8n VPS (§12). Only devices that fail become open items; a fully green check auto-resolves |
| `pack_n_play` | checkin | automation (Canmore) | requested, delivered, penalty risk | Per existing reminder timing | Builds on the pack-n-play accountability design already scoped |
| `claim_tracker` | accountability | manual, possibly semi-automated via Gmail | claim type (Truvi/AirCover), status, charges summary, filing_deadline, evidence items | Deadline-driven | `filing_deadline` is auto-computed from checkout: AirCover 14 days, Truvi 30 days. SLA warnings at 7 and 2 days before. Items = the unified evidence checklist (timestamped before/after photos wide + close-up, receipts/estimates, third-party invoice, proof guest accepted house rules, police report if theft). Inbox already has Truvi and Airbnb Resolution labels - check whether their subjects are parseable like review emails are |
| `guest_block_report` | accountability | manual | reason, platform, case ID, blocked? | Same day | Airbnb has no API to block; ticket tracks that it was done in the Airbnb UI |
| `guest_review_reminder` | accountability | recurring (n8n) | platform, window deadline | Before window closes | Hospitable pending-review list is Airbnb-only; VRBO stays a manual reminder |
| `review_removal_case` | accountability | automation (Gmail) + manual | grounds, attempt stage (1st / 2nd / escalated to Robert), outcome | Rolling | Airbnb sends three exact subjects from automated@airbnb.com: "We're reviewing your request to remove [Guest]'s review" (pending), "[Guest]'s review has been removed" (approved), "[Guest]'s review won't be removed" (denied). Matched to `review_id` via the quoted review text, not the name. Second denied event on the same review -> spawns a `review_removal_escalation` ticket (next row) |
| `review_removal_escalation` | accountability | automation (2nd denial) | packaged summary: property, dates, guest, review text + subscores, grounds argued, both denial emails, evidence attachments; items: "Sent to Robert", "Robert responded", "Outcome recorded" | Send within 2 days; follow up at 7 | Robert is external and does not log in. The team member picks this up, forwards the package, and records the outcome. `parent_ticket_id` points back to the removal case |
| `review_action_item` | accountability | manual or automation (review subscore) | complaint, action, proof attachment | 1 week | "Guest said bad pillows, we replaced them - show me" |
| `cleaner_late_noshow` | turnover | automation (existing Connecteam no-show check) | shift, staff_ref, minutes late | Same day | Gated on the Connecteam data audit (§11 M5) |
| `incomplete_cleaning_form` | turnover | automation | missing fields (e.g. hot tub), staff_ref | Same day | |
| `cleaning_overtime_approval` | turnover | manual (coordinator raises) | reason, photos, approved_by, guest charge? | Before next shift | Approval by `ops_manager` or `cleaning_coordinator` |
| `qc_inspection` | turnover | manual | items: supplies, floors, counters, bathroom, hot tub, overall rating | Per clean | |
| `system_health` | - | automation | integration, error | Same day | Hospitable PAT expires yearly, webhooks fail silently, GHL tokens rotate. The app files a ticket on itself instead of breaking quietly |
| `smart_scheduling_suggestion` | turnover | automation, stretch (M6) | suggested assignment, cleaner rating, accepted/overridden | - | Later |

---

## 10. Integration points

- **Hospitable API** (have access, PAT expires yearly - `system_health` ticket 30 days before): `get-reservations`, `get-reservation-messages` / `send-reservation-message`, webhooks for message and reservation events, `get-guest-reviews` / `submit-guest-review` / `respond-to-review`, `get-property-reviews` (category subscores drive `cleaning_issue` and `review_action_item`), `get-property-devices` (locks). Optional: mirror selected tickets as Hospitable tasks via `create-task` so teammates who live in Hospitable see them there too.
- **Existing Supabase tables** read directly: `reservations`, `reviews`, `review_flags`, `review_removal_drafts`, `guest_reviews`, `properties`, `property_mapping`, `cleaning_form_submission`, `cleaning_job_map`, `cleaning_shift_check`, `packnplay_requests`, `email_classifications`.
- **n8n:** existing workflows (`Pique-Guest-Fraud-Check`, cleaning no-show and form checks, review suppression) add one node: upsert into `tickets` on `external_ref`. Recurring tickets scheduled here. Errors route to `Pique-Error-Handler` as today.
- **Connecteam API:** read-only shifts and time activities for `cleaner_late_noshow`, `incomplete_cleaning_form`, and `staff_ref` resolution. No GPS work.
- **GoHighLevel:** conversation/call webhooks and API for `calls`. Confirm sub-account, LC Phone, credentials before M3.
- **Gmail:** already connected via `Pique-Inbox-Classifier`. Watch for the three Airbnb review-removal subjects; parse guest name and quoted review text; match to `reviews`; update the ticket. The existing "Review Removal Requests" label holds 20 threads, far fewer than raw search finds, so the app does this itself rather than trusting the label. Test the same approach on the Truvi and Airbnb Resolution labels.
- **Claude API:** message intent classification; fuzzy fallback for review-text matching.
- **Wyze:** no official API. Self-hosted job on the existing n8n VPS: `wyze-sdk` for per-camera online status (tier 1), optional `docker-wyze-bridge` nightly snapshot + Claude vision check (tier 2). Needs Pique's Wyze login plus an API key ID/key from Wyze's developer console. Details and risk in §12.
- **Slack:** existing channels, plus deep links and reaction-to-ticket.

---

## 11. Build milestones

1. **M0 - Foundations:** Next.js + Vercel, schema in §5 (including the cleaning-table `reservation_id` columns and backfill), Google SSO + roles + RLS, deployed skeleton, `system_health` ticket type.
2. **M1 - Core ticketing:** queue, ticket detail, items, comments, attachments, events, assignment, SLA clock, Slack post with deep link.
3. **M2 - Automation wiring + adoption:** existing n8n workflows upsert tickets; reaction-to-ticket from Slack; nightly recurring tickets. **Pilot with the CS team on `guest_vetting`, `unanswered_message`, and `review_removal_case` first** - the three highest-value automated flows - before rolling out cleaning types. Adoption fails if the team gets twenty new ticket types on day one.
4. **M3 - Conversations:** Hospitable message sync (webhook + poll), intent classifier, unanswered detection, reply from app; GHL calls and voicemail.
5. **M4 - Reservation timeline + domain types:** the §7.5 timeline view; `maintenance_ticket` with rollover; `claim_tracker` with computed deadlines and evidence items; pet fee, direct booking check, security check (locks), pack-n-play, block/report, review reminders, review action items.
6. **M5 - Cleaning ops types:** **prerequisite: audit Connecteam scheduling data** (known duplicates per day, inconsistent shift lengths, Zapier-patched lookups). Wiring `cleaner_late_noshow` to unaudited data produces false tickets and kills trust in the app. Then late/no-show, incomplete forms, overtime approval, QC inspection, `cleaning_issue` attribution.
7. **M6 - Stretch:** AI scheduling suggestions.

---

## 12. Open questions and known risks

- **GHL:** sub-account/plan, LC Phone active, API and webhook credentials. Needed before M3.
- **Wyze - decided: self-hosted, unofficial route.** Precise picture, since "no API" and "API key" sound contradictory: Wyze publishes **no documented developer API** - no endpoint docs, no SDK, no supported integration program. What Wyze does provide is an official **API Key ID + API Key** from its developer console (`developer-api-console.wyze.com`), mandatory since May 2024 for any third-party tool signing in with a Wyze account. That key is a login credential, not an API: it lets community tools (`wyze-sdk`, `docker-wyze-bridge`, Home Assistant) authenticate as your account against the same undocumented endpoints the Wyze app uses. Wyze tolerates this but does not promise stability. So camera checks run as a small service on the existing n8n VPS using those tools with Pique's Wyze login + API key. Two tiers, in order:
  - **Tier 1 (build first):** device online/offline status via `wyze-sdk`. No video at all. One scheduled job lists every camera and writes `is_online` per device into the nightly `property_security_check` ticket. This alone answers "are the cameras on and connected" for all properties at near-zero cost.
  - **Tier 2 (if wanted):** `docker-wyze-bridge` pulls one snapshot frame per camera per night, and Claude checks the frame is not black, obstructed, or pointing at a wall. One image per camera per day is cheap. **Do not stream video continuously** - ~170 streams to a VPS is expensive, fragile, and unnecessary for this requirement.
  - Tier 1 talks only to Wyze's cloud, so it works from the VPS regardless of camera networks - this is the reliable one. Tier 2 from a remote VPS reaches cameras through Wyze's P2P/relay rather than the local LAN; fine for one snapshot a night, not for streaming. No Cam Plus subscription needed.
  - Model support (per `docker-wyze-bridge`): V1-V4, Pan models, Outdoor, Doorbell, Floodlight are supported; OG and OG Telephoto are not; Battery Cam Pro, Floodlight Pro, Doorbell Pro are partial. **Inventory which Wyze models are installed across the 87 properties before building tier 2** - if a chunk are OG cams, tier 2 covers only tier-1-style status for those.
  - Risk to accept: both tools use Wyze's undocumented app endpoints and have broken before when Wyze changed auth. A failure files a `system_health` ticket rather than silently passing. Camera checks never block the locks half of the security check, which is solid via Hospitable.
- **Connecteam data quality:** must be audited before M5 (see above).
- **Direct bookings:** confirm how they arrive in Hospitable (platform field value) so the `direct_booking_id_check` trigger is exact.
- **Google Workspace domain** for SSO restriction.
- **VRBO reviews:** Hospitable pending list is Airbnb-only; VRBO stays manual.
- **Robert - decided: external, no app login.** On the second denied email for the same review, the app opens a `review_removal_escalation` ticket for the team (see §9) packaged with everything a team member needs to hand Robert in one message: property, reservation dates, guest, full review text and subscores, the grounds argued, both Airbnb denial emails, and any attached evidence. A checklist item "Sent to Robert" plus a follow-up SLA closes the loop.
- **Call recording retention:** decide how long voicemail audio and transcripts are kept. Guest PII lives in this system; write it down.

---

## 13. Build conventions (for Claude Code)

- Store timestamps in UTC; display in America/Edmonton. Every SLA and deadline computation uses the property's local date.
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HOSPITABLE_PAT`, `HOSPITABLE_WEBHOOK_SECRET`, `CONNECTEAM_API_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `GMAIL_*` (reuse the n8n credential path or a service account), `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `GOOGLE_WORKSPACE_DOMAIN`.
- All external writes (Hospitable message send, Slack post) are idempotent and logged as `ticket_events`.
- Webhook handlers verify signatures and are idempotent on the provider's event id.
- Migrations via Supabase CLI, committed to the repo. Never edit production schema by hand.
- Tests: schema constraints (unique `external_ref`, RLS per role), rollover logic, SLA computation, Airbnb email parsing against the three real subject patterns, intent classifier on a labeled sample of real messages.
- Errors from the app's own jobs create `system_health` tickets and post to the existing error channel.

---

## 14. What's explicitly out of scope, still

GPS breadcrumbs, geofencing, the native field app, in-house payroll calculation, Superhost prediction, AI photo review, the SOP chat widget. This PRD doesn't change those decisions - it moves ticketing and conversations in front of them and makes sure nothing built here has to be thrown away when they arrive.
