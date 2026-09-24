# Pique Ops App - PRD v1.2
### Ticketing & Conversations (internal ops platform, Phase 1)

**Status:** Build spec, partially built. See §0.1 for what exists today before planning any work.
**Owner:** MDP
**Last updated:** 2026-09-24 - v1.2 adds a reality-check of what's actually built (§0.1), replaces the single generic Queue with domain sections under a Tickets nav (§7.1), adds manual ticket creation (§7.8), adds the `review_flag` and `vehicle_registration` ticket types (§9), and adds a standing Open fixes list (§15) so audit findings aren't lost while new features are built.
v1.1 (2026-09-18) added the gaps found in a full review of the project conversation: maintenance tickets with rollover, checklist items, reservation stage/timeline view, dedup keys for automation-created tickets, the cleaning-table `reservation_id` fix, inbound-message intent classification, notifications spec, and build conventions. Wyze (self-hosted on the n8n VPS) and Robert (external, team ticket) decisions closed.

---

## 0. What this document is

This is the build spec for the first real piece of the Pique ops platform: an internal, login-required web app that gives the team one place to see and act on the things that currently fall through the cracks between Hospitable, Connecteam, Slack, GHL, Gmail, and memory.

It supersedes the phase ordering in the earlier "Reservation Spine" architecture doc in one way: **ticketing + conversations is now Phase 1**, not the console-plus-ingest phase described there. Everything else from that doc carries forward - the six-stage reservation spine is the organizing concept, the data-reuse philosophy drives the schema, and GPS/native app/payroll stay deferred.

Two rules that govern every decision below:
1. Don't build a new table for data that already exists, and don't build two tables that do the same job.
2. The unit of work is the reservation. Every ticket and conversation should be reachable from the reservation it belongs to.

### 0.1 Where the build actually is (as of 2026-09-24)

The architecture held up (generic `tickets` table, spine stages, Ask Pique), but only a narrow slice of the catalog is live. Plan from this, not from the milestone list alone.

- **Automatically created today (4 types):** `unanswered_message`, `cleaner_late_noshow`, `review_removal_case`, `review_flag`, all from exception-safe shadow-mirror triggers on existing automation tables (see CLAUDE.md). No GHL, Gmail parsing, Connecteam, or Wyze creation yet.
- **Manual creation (built 2026-09-24):** "New ticket" (top bar, every page) and "+ Add ticket" on a reservation create any type in `CREATABLE_TYPES` (`src/lib/pique-ui/domains.ts`) with its fields, default checklist, and computed due date (§7.8).
- **Tickets sections (built 2026-09-24):** `/tickets/reviews|maintenance|claims|requests` with the tap-to-expand rail menu (§7.1). Requests and Claims group by due date, Maintenance by property. `/queue` redirects. Hand-made tickets get status buttons and a tickable checklist in the drawer.
- **Actionable in-app today:** `review_flag` (appeal / don't appeal), `review_removal_case` (AI draft with evidence photos, manual log of past attempts), `unanswered_message` (mark answered), and every manually created type (status, checklist, comments, photos).
- **Not built yet per type:** type-specific tools beyond the checklist (e.g. claim evidence upload per checklist item, Robert escalation package, Slack ping on escalation). Maintenance rollover is built (manual "Roll over": partial resolve, follow-up with undone items, 3rd rollover escalates to urgent and reassigns to an `ops_manager` if one exists - no profile has that role yet), and every automated trigger other than the four above.
- **Milestones:** M0 done. M1 mostly done - but role-based RLS was deferred and never implemented (§15), SLA breach and Slack posting not wired. M2 partial - 4 shadow-mirrors, no Slack reaction-to-ticket, `guest_vetting` blocked (fraud-check workflow never persists a verdict). M3 schema only (`calls` table exists, no GHL code). M4/M5/M6 not started.
- **Automatic Requests tickets (built 2026-09-24):** direct-booking ID checks and pet fees open from reservations, pack 'n play from the existing `packnplay_requests` table, and parking from the GHL form; cancellations close them.
- **Team assignment (built 2026-09-25):** tickets can be assigned to a team (e.g. Maintenance) instead of one person, with a default team per ticket type; managed at /admin/teams.
- **Clocks and health (built 2026-09-24, §8.2):** every ticket has a start, due date and computed health; rows show "Day X of Y" and sort by health; recomputed on change and every 15 minutes. Backfill made the real backlog visible: most open review flags and removal cases are Behind.
- **Beyond the PRD, built:** Dashboard as landing page (portfolio spine, KPI tiles, trends, live activity), Ask Pique (§7.7 equivalent, built as designed), automated daily detection of reviews removed from Airbnb (`reviews.removed_at` / `pending_removed_since`, two-strike confirmation, n8n `Pique-Detect-Removed-Reviews-Daily`).

**Next build order (decided 2026-09-24):** ~~manual ticket creation (§7.8)~~ → ~~Tickets nav with domain sections (§7.1)~~ → deeper Maintenance, Claims, Requests tools → Reviews experience polish. Open fixes (§15) are worked alongside, not after.

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
- **Slack status bot ("scout")** - Phase 2, the delivery channel for §8.2 notifications. When a ticket turns Needs attention / Behind, DM its owner (or post in the relevant ops channel, e.g. maintenance) asking for status; write replies into the ticket history and tick checklist items the person confirms, so staff can keep work moving without opening the app. Needs a Slack bot token and `profiles.slack_user_id` filled in. Merges with the next item.
- **Slack-reading assistant for tickets** - Phase 2. Read maintenance/claims discussion in Slack and ask clarifying questions in-thread ("is this about the claim on unit 213?") to attach the conversation to the right ticket. Depends on the domain sections (§7.1) existing first.

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

**As built (differences from the sketch above):** `messages` is the existing Hospitable-synced table extended in place with `conversation_id`, `intent`, `intent_confidence` - not a new table. `reviews` (existing, Hospitable-synced) is not in the sketch but carries product logic: `removed_at` (confirmed removed from Airbnb, excluded from every rating average) and `pending_removed_since` (first-miss marker for two-strike confirmation). `ticket_attachments` also has `review_removal_draft_id` so evidence stays with a specific appeal attempt.

**Required changes to existing tables (carried over from the Reservation Spine doc - the one structural gap found in the database):**
- Add `reservation_id uuid fk -> reservations, nullable` to `cleaning_form_submission` and `cleaning_shift_check` (done). **Not** `cleaning_job_map` - it turned out to be a static job-to-property mapping, not per-occurrence. `cleaning_shift_check.reservation_id` is 0% populated so far; backfill still pending.

**Guest identity:** a Hospitable-synced `guests` table already existed; reuse it, don't add another. Guests are still identified through the reservation. When something arrives keyed only by a first name (an Airbnb email saying "Jessica's review won't be removed"), it is matched via the review text quoted in the email body against `reviews.text` -> `review_id` -> `reservation_id`. Name alone is never the key.

**Reservation spine:** every ticket and conversation carries `reservation_id` and tickets carry `stage`, so the per-reservation timeline (§7.5) is a query, not a separate table. The `reservation_timeline` pointer table from the earlier doc is not needed unless that query gets slow.

---

## 6. Auth & permissions

- Google OAuth via Supabase Auth, domain-restricted.
- **Proposed role model (2026-09-24, awaiting sign-off - replaces the five roles in §2):**

  | Role | Who | Access |
  |---|---|---|
  | `owner` | Michael, Katrina | Everything, including roles and company-level settings |
  | `admin` | MDP | Everything, including user management and clock rules |
  | `ops_manager` | Laurice | All ops work, receives escalations; no user management |
  | `team_member` | Everyone else on staff | Work tickets, reservations, inbox; no settings or user management |
  | `property_owner` (later) | House owners | Read-only, only their own properties' reservations and tickets - no other owners' data, no guest contact details beyond what's needed |

  Staff roles differ mostly in which settings and admin screens they see (enforced in the app and in admin server actions). The database-level wall that matters is `property_owner`: RLS limits them to rows whose `property_id` is in a new `property_owners (profile_id, property_id)` mapping. Rollout: (1) change the `profiles.role` constraint and map current roles (all `admin` today except Laurice = `ops_manager`), (2) replace the flat any-profile RLS policies with staff-role policies plus property-owner policies, (3) gate settings/admin screens by role. Steps 1-2 edit existing policies and the role list, so they need explicit sign-off (§15 #2).
- `profiles.role` drives RLS policies. Cleaning roles see cleaning ticket types; finance sees claims and fees; CS sees tickets and conversations; ops_manager and admin see all. **Not yet enforced** - every table currently grants full access to any signed-in profile (§15).
- No public surface. 100% internal.

---

## 7. Core product surfaces

### 7.1 Tickets - domain sections (replaces the single Queue, decided 2026-09-24)
One generic queue with a generic drawer made nothing feel actionable: every type has a different SOP, and the one type with a real workflow (review removal) was squeezed into a side drawer. Tickets are now split into a small, fixed set of **domain sections**, each with a screen built around that domain's actual workflow. The data model does not change - these are views over `tickets` grouped by `type`.

| Section | Ticket types | Built around |
|---|---|---|
| **Reviews** | `review_flag`, `review_removal_case`, `review_removal_escalation`, `review_action_item`, `guest_review_reminder` | Appeal decision, AI draft + evidence, attempt history, escalation to Robert. Includes a view of every review by removal stage (1st attempt / 2nd / escalated / removed) and a searchable history of successfully removed reviews (`reviews.removed_at`) - both asked for directly in Katrina's list |
| **Maintenance** | `maintenance_ticket`, `maintenance_access`, `property_security_check` | Per-unit issue checklist, assignee/technician, rollover, before-next-check-in deadline |
| **Claims** | `claim_tracker`, `guest_block_report` | Filing-deadline countdown, evidence checklist, claim status by platform |
| **Requests** | `vehicle_registration`, `pet_fee`, `pack_n_play`, `direct_booking_id_check`, `guest_vetting`, `extension_request` | Small SOP-driven tasks tied to a date on the reservation (usually check-in): a short checklist and a done button |

Not in these sections: `unanswered_message` and `missed_call` live in **Inbox**; `system_health` lives in Admin; **cleaning types are a later phase** (`cleaning_issue`, `qc_inspection`, `cleaner_late_noshow`, `incomplete_cleaning_form`, `cleaning_overtime_approval`, `smart_scheduling_suggestion`) - hidden from staff views and not part of the current build. When they're picked up (M5, after the Connecteam data audit) they likely get their own Cleaning section.

New ticket types go into one of these four sections. A fifth section is added only when a type genuinely fits none of them - "Requests" is the catch-all so the nav never grows a tab per problem.

**Navigation:** the rail has one **Tickets** item. Tapping it expands in place to Reviews / Maintenance / Claims / Requests (each its own route under `/tickets/…`). It opens on tap/click, never hover-only - hover doesn't exist on the phones the team uses, and hover-only menus fail WCAG 2.1.1 (keyboard) and 1.4.13 (content on hover). It is a button with `aria-expanded`, and stays expanded while any section is active. Each section shows its open count.

Within each section: "Mine", "Unassigned", "Breached" as one-tap views, filterable by property, stage, assignee.

### 7.2 Ticket detail
Status, assignee, due, stage, linked reservation and property, checklist items, comments, attachments, event history, and the linked conversation inline if there is one. Every action here writes a `ticket_events` row. Domain sections render type-specific tools in the detail view (e.g. the review appeal flow); the generic fields are the fallback, not the whole experience.

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

Tickets on a reservation are **grouped by the same domain sections as §7.1** (Reviews, Maintenance, Claims, Requests), open first, resolved kept for history. Opening one gives the same type-specific tools as opening it from its section - one place to handle a ticket, reachable two ways. "Everything about this stay is here" is the test.

### 7.8 Manual ticket creation
Staff can create any ticket type by hand ("+ New ticket" globally, and "+ Add" from a reservation or property, which pre-fills them). Picking a section and type shows only that type's fields and default checklist. Manual tickets set `source = 'manual'`, `created_by`, and no `external_ref`. Prerequisite for every non-automated type in §9 - today there is no way to create a ticket except through automation.

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

### 8.2 Clocks and health (decided 2026-09-24)

Due dates alone (Asana/Trello style) only say a date passed. Pique's work runs against real deadlines - a claim's 14 days start when the guest checks out, not when someone gets around to opening a ticket - so every ticket carries a clock and a computed health, SLA-style, but strict and per type.

**Every ticket has:**
- `started_at` - when the clock started, anchored to the real event (checkout for claims and guest-review reminders; otherwise when the ticket was created / the source record appeared).
- `due_at` - the deadline. Per type it is either **hard** (a platform cutoff or a guest arriving - miss it and it's gone) or **soft** (our own service level).
- `target_at` - optional internal target *before* a hard deadline, so there is buffer (claim filed by day 7 of 14).
- `health` - computed, never set by hand: **On track · Needs attention · Behind · Missed · Waiting**. Resolved tickets have none.

**Health rules (first match wins):**
1. Blocked on someone else, on a pausable soft clock → **Waiting** (the clock pauses; the due date moves out by the time spent waiting). Hard deadlines never pause.
2. Past `due_at` → **Missed** if hard, **Behind** if soft.
3. Past `target_at` → **Behind**.
4. Inside the type's critical window with checklist items still open → **Behind**.
5. Inside the type's warning window → **Needs attention**.
6. **Progress vs time:** more than a third of the window used ahead of checklist completion (e.g. day 10 of 14 with 1 of 5 evidence items done) → **Needs attention**. This is the part generic tools can't do - the checklist already exists.
7. Otherwise → **On track**.

Health is recomputed whenever a ticket or its checklist changes, and every 15 minutes for the passage of time. Each change is written to the ticket's history (becoming Behind or Missed is logged as an escalation). `sla_breached` mirrors Behind/Missed so the existing Breached views keep working. Notifying the assignee (Needs attention) and the ops manager (Behind) is the next step once in-app notifications / Slack posting exist - until then the history entry and the section sort are the signal.

**In the UI:** every row shows "Day X of Y" (or hours/minutes for short clocks) as a bar coloured by health, sections sort by health first, and the drawer shows started / target / due.

**Per-type defaults** live in the `ticket_type_clocks` table (editable later without code). Draft numbers - mark up anything that's wrong:

| Type | Clock starts | Due | Hard? | Internal target | Needs attention within | Behind within (items open) | Waiting pauses? |
|---|---|---|---|---|---|---|---|
| `review_flag` | flagged | +2 days | soft | - | 1 day | - | yes |
| `review_removal_case` | each attempt sent | +5 days (follow up) | soft | - | 1 day | - | yes |
| `review_removal_escalation` | created | +2 days | soft | - | 1 day | - | yes |
| `review_action_item` | created | +7 days | soft | - | 2 days | - | yes |
| `guest_review_reminder` | checkout | +14 days, 11pm | **hard** (Airbnb window) | day 10 | 4 days | 1 day | no |
| `unanswered_message` | alert | +30 min | soft | - | 10 min | - | no |
| `extension_request` | created | +2 hours | soft | - | 30 min | - | no |
| `missed_call` | created | +1 hour | soft | - | 15 min | - | no |
| `maintenance_ticket` | created | next check-in at the property, 3pm | **hard** | - | 1 day | 4 hours | no |
| `maintenance_access` | created | day before the visit, 9am | **hard** | - | 1 day | 4 hours | no |
| `property_security_check` | created | +12 hours | soft | - | 4 hours | - | no |
| `claim_tracker` | checkout | AirCover +14 / Truvi +30 days, 11pm | **hard** | AirCover day 7 / Truvi day 15 | 7 days | 2 days | no |
| `guest_block_report` | created | +1 day | soft | - | 4 hours | - | no |
| `vehicle_registration` | created | check-in day, noon | **hard** | - | 1 day | 4 hours | no |
| `pack_n_play`, `direct_booking_id_check`, `guest_vetting` | created | check-in day, noon | **hard** | - | 2 days | 1 day | no |
| `pet_fee` | created | +2 days | soft | - | 1 day | - | yes |
| cleaning types, `system_health` | created | +1 day | soft | - | 4 hours | - | no |

A manually set due date always wins over the default.

## 9. Ticket type catalog

`source` says whether a person or an automation creates it. `stage` is the default spine position. The section each type belongs to is in §7.1. Only `unanswered_message`, `cleaner_late_noshow`, `review_flag`, and `review_removal_case` are created today (§0.1).

| Type | Stage | Source | Key fields / items | Default SLA | Notes |
|---|---|---|---|---|---|
| `guest_vetting` | book | automation (existing fraud-check n8n) | history tier, flagged reason, DNH match | Before check-in | Existing workflow; now upserts a ticket (`external_ref = fraud:{reservation_id}`) in addition to Slack |
| `direct_booking_id_check` | book | automation | ID collected?, purpose of trip, pet count | Before check-in | Trigger: reservation with platform = direct. Items: ID, purpose, pets |
| `pet_fee` | book | automation | requested?, collected?, escalated to Airbnb? | 48h after booking | Trigger: pets flagged on the reservation (data already surfaces in the arrivals check) |
| `unanswered_message` | any | automation (conversations) | conversation_id, minutes since inbound | 30 min | |
| `extension_request` | stay | automation (intent classifier) | requested dates, responded? | 2h | |
| `missed_call` | any | automation (GHL) | call_id, caller, callback done? | 1h | Covers cleaners calling in, not just guests - match the number against Connecteam staff as well as guest conversations and set `staff_ref` when it's a cleaner |
| `maintenance_ticket` | stay / turnover | automation (intent classifier, review subscores) or manual | items (one per issue), staff_ref, rollover_count | Before next check-in | The missing piece from v1.0. One ticket per unit-visit, one item per issue (lamp, dishwasher, deck door). Partial completion rolls over per §8; 3rd rollover escalates to Tammy |
| `maintenance_access` | stay | linked to maintenance_ticket | guest notified at, 24h rule satisfied?, guest permission | Before technician visit | Child of a maintenance ticket, not standalone |
| `cleaning_issue` | turnover / accountability | automation (review cleanliness subscore <= 3, or intent classifier) or manual | complaint, staff_ref (cleaner from `cleaning_job_map` via reservation_id), photos | Same day | This is cleaner-to-review attribution. Depends on the `reservation_id` fix in §5 |
| `property_security_check` | any (nightly) | recurring (n8n) | items per device: each lock (online, locked, battery via Hospitable), each camera (online via wyze-sdk; optional nightly snapshot verdict) | Nightly | Locks via Hospitable are solid. Cameras via the self-hosted Wyze job on the n8n VPS (§12). Only devices that fail become open items; a fully green check auto-resolves |
| `vehicle_registration` | checkin | automation (parking form submission) or manual | property, plate, make/model/colour, form received?, registered with building?, registered_at | Before guest arrives on check-in day | Added v1.2. Buildings with managed parking (first case: Fire Mountain Lodge #213) fine unregistered vehicles ~$100 each. SOP: guest submits plate via the parking form after booking; on check-in day the team registers it with the building. Ticket opens when the form arrives (or at booking for opted-in properties if no form yet, with a "chase guest for plate" item), due the morning of check-in. Which properties require it is a per-property flag. Where the form submissions land is an open question (§12) |
| `pack_n_play` | checkin | automation (Canmore) | requested, delivered, penalty risk | Per existing reminder timing | Builds on the pack-n-play accountability design already scoped |
| `claim_tracker` | accountability | manual, possibly semi-automated via Gmail | claim type (Truvi/AirCover), status, charges summary, filing_deadline, evidence items | Deadline-driven | `filing_deadline` is auto-computed from checkout: AirCover 14 days, Truvi 30 days. SLA warnings at 7 and 2 days before. Items = the unified evidence checklist (timestamped before/after photos wide + close-up, receipts/estimates, third-party invoice, proof guest accepted house rules, police report if theft). Inbox already has Truvi and Airbnb Resolution labels - check whether their subjects are parseable like review emails are |
| `guest_block_report` | accountability | manual | reason, platform, case ID, blocked? | Same day | Airbnb has no API to block; ticket tracks that it was done in the Airbnb UI |
| `guest_review_reminder` | accountability | recurring (n8n) | platform, window deadline | Before window closes | Hospitable pending-review list is Airbnb-only; VRBO stays a manual reminder |
| `review_flag` | accountability | automation (shadow-mirror of existing `review_flags`) | severity, reason, our/their fault, decision | Rolling | Added v1.2 (built). The earlier "should we try to remove this review?" decision. Appeal starts a `review_removal_case`; don't-appeal writes `review_flags.status = 'suppressed'` like the existing Slack flow |
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
- **Data retention and deletion (broader than calls):** nothing is ever deleted today - every table accumulates via upsert, and there's no way to find and remove everything about one guest. Write a one-paragraph retention policy. Confirm the Anthropic API account is set to zero data retention, since guest messages and review-evidence photos go through Claude.
- **Parking form (`vehicle_registration`) - source answered 2026-09-24:** guest submissions come from a **GHL form** and land in a **Slack channel** (not via any n8n workflow). **Built 2026-09-24:** the GHL workflow "213 FML Parking Registration → Slack Notification" gets an added webhook action pointing at the n8n workflow `Pique-Parking-Form-To-Ticket` (id `8nKXAvhG1CVUKfIG`), which calls `public.upsert_parking_ticket(property_id, payload)`. That function finds the form fields by name pattern, matches the reservation (confirmation code → both stay dates → check-in date only if exactly one booking arrives that day → email → guest name; never a cancelled stay; unfilled `%merge_tag%` values ignored). Tested with a real GHL submission 2026-09-24: GHL sends every custom field in the account (mostly empty), and the form's hidden "Reservation code" field arrives as the literal `%reservation_code%` unless the form link is sent with the code filled in - filling it gives exact matches, and upserts a `vehicle_registration` ticket on `external_ref = 'parking:{reservation_id}'` (unmatched: `parking:unmatched:{submission}`, flagged in its history) with the plate filled in, "Plate received" ticked, and due noon on check-in day. The webhook URL carries a secret `key` (kept in n8n, not the repo) and a `property_id`, so other buildings can reuse it with their own property id. Still open: the form's exact fields (does it ask for the confirmation code?), which properties besides Fire Mountain Lodge #213 need registration, and how the building is notified (portal, email, phone).
- **`guest_vetting`:** the fraud-check workflow posts to Slack only and never saves a verdict, so there's nothing to mirror. Either add a write to that live workflow (a production edit - needs sign-off) or keep the type unbuilt.

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

---

## 15. Open fixes (from the 2026-09-24 audit)

Known problems in what's already built. Worked alongside new features, not deferred behind them. Remove a line only when it's fixed and pushed.

| # | Fix | Severity | Status |
|---|---|---|---|
| 1 | `suppressReviewFlag` trusted a client-supplied `review_flags` id with the RLS-bypassing admin client - any staff account could suppress an arbitrary flag | High | **Fixed** 2026-09-24 (id now derived server-side from the ticket) |
| 2 | Role-based RLS never implemented: every table grants full read/write to any signed-in profile regardless of `role` (§2, §6). Not reachable from outside the Workspace domain, but all roles can do everything | High | Open - changes existing policies, needs sign-off before applying |
| 3 | Review-removal evidence attachments weren't re-checked against the ticket before being sent to Claude vision or re-parented to an attempt - and the server fetched client-supplied URLs for PDFs (a server-side request forgery risk) | Medium | **Fixed** 2026-09-24 (client sends attachment ids; server scopes them to the ticket and signs URLs itself; re-parent/delete scoped to the ticket's unclaimed uploads) |
| 4 | TopBar search input does nothing (no handler) | Medium | **Fixed** 2026-09-24 (searches open tickets and reservations; keyboard combobox) |
| 5 | Ticket/reservation drawer: focus doesn't move in on open, isn't restored on close, no focus trap (WCAG 2.4.3) | Medium | **Fixed** 2026-09-24 (focus moves in, Tab stays inside, returns on close; closed drawer is inert) |
| 6 | Drawer form fields (manual-log textarea, status select, comment box) rely on placeholder text, no accessible label (WCAG 1.3.1 / 4.1.2) | Medium | Partial - assignee and comment labelled, new-ticket form fully labelled; review-removal panel fields still open |
| 7 | Queue-row severity stripe is colour-only (WCAG 1.4.1) | Low | **Fixed** 2026-09-24 (every row now has a text health badge next to the stripe) |
| 8 | Standing rule: every new `SECURITY DEFINER` function must `revoke execute from public` - otherwise it becomes a privilege-escalation path for Ask Pique's read-only SQL | Rule | **Done** 2026-09-24 - in CLAUDE.md build conventions |
| 9 | n8n workflows hold the service-role key in plaintext; its blast radius is the whole shared production database (~45 tables), not just this app. Consider n8n encrypted credentials | Awareness | Open |
| 10 | No record of production schema/data changes made outside the app (e.g. by an agent via MCP). Adopt: someone other than the changer sees prod changes before or shortly after | Process | Open |

---

## Appendix A. Katrina's list - coverage map

Source: Katrina's operational-gaps doc (Google Doc "Katrina's list", linked from the project). Every item maps to a ticket type or surface below. When the list changes, update this table.

| Katrina's item | Covered by | Section | Built? |
|---|---|---|---|
| ID + purpose of trip collected on direct bookings; was the guest vetted (purpose, pets) | `direct_booking_id_check` | Requests | No |
| Is there a current Truvi / AirCover claim, with a summary of charges | `claim_tracker` (charges summary field) | Claims | No |
| Pet fee: request sent? collected? escalate to Airbnb resolutions? | `pet_fee` | Requests | No |
| Cameras on and working at night; locks on and working | `property_security_check` (locks via Hospitable, cameras via Wyze job) | Maintenance | No |
| Maintenance visit: guest permission to enter / 24h heads-up rule | `maintenance_access` (child of `maintenance_ticket`) | Maintenance | No |
| Verified guest phone numbers (2FA), collecting them | **Dropped** - requiring guest phone verification / collecting contact details this way is against Airbnb's (and other platforms') terms of service. Not to be built | - | Won't build |
| Pack-n-plays for Canmore ($60+ if missed) | `pack_n_play` | Requests | No |
| Team never reviews guests on VRBO (manual) | `guest_review_reminder` (VRBO stays a manual reminder) | Reviews | No |
| Vet guests with no / few / bad reviews before they stay | `guest_vetting` (blocked - fraud check doesn't save a verdict, §12) | Requests | No |
| Initial guest message gets buried under the auto-reply | `unanswered_message` + intent classifier (§7.3) | Inbox | Partial - unanswered detection mirrored from existing alerts; classifier not built |
| Extension requests missed by CS | `extension_request` (intent classifier) | Requests | No |
| Blocking / reporting bad guests (case IDs, hostile guests) | `guest_block_report` | Claims | No |
| Reminder to write reviews for bad guests (mess, damage, late checkout, noise, hostility) | `guest_review_reminder` | Reviews | No |
| Database of reviews successfully removed | `reviews.removed_at` + removed-reviews history view (§7.1) | Reviews | Data yes (daily auto-detection), view no |
| Which reviews are on 1st / 2nd / 3rd attempt (escalation / Robert) | `review_removal_case` attempt history + `review_removal_escalation` | Reviews | Partial - attempts tracked, escalation not built |
| Visibility on review suggestions being fixed (pillows replaced: request, photos, orders, proof) | `review_action_item` | Reviews | No |
| Missed calls from cleaners | `missed_call` (cleaner numbers matched, `staff_ref`) | Inbox | No (GHL not integrated) |
| Missed calls generally; listen to voicemail in-app | `missed_call` + `calls.recording_url` / transcript | Inbox | No (GHL not integrated) |
| Cleaners starting shifts on time | `cleaner_late_noshow` | Later phase (Cleaning) | Partial - no-shows mirrored, lateness not |
| Cleaning forms fully filled out (hot tub often missed) | `incomplete_cleaning_form` | Later phase (Cleaning) | No |
| Cleaning overtime needs approval + reason + photos (chargeable to guest) | `cleaning_overtime_approval` | Later phase (Cleaning) | No |
| AI-assisted cleaning schedule, best cleaners get best cleans | `smart_scheduling_suggestion` (M6 stretch) | Later phase (Cleaning) | No |
| QC visibility and a real checklist (supplies, floors, counters, overall rating) | `qc_inspection` | Later phase (Cleaning) | No |

The one dropped item (guest phone verification) stays in this table so it isn't re-added by accident.

Not from Katrina's list but added since: `vehicle_registration` (Fire Mountain Lodge #213 parking fines), `review_flag` (existing suppression-decision stage).
