// Curated schema digest for Ask Pique (UI spec §10.2). Hand-written, not a
// raw catalog dump - only the tables/columns/gotchas that actually come up
// when someone asks a question in plain English. Kept in its own file so it
// can be extended without touching the agent loop, and so its size is easy
// to see (it's sent as a cached system-prompt block on every turn).

export const SCHEMA_DIGEST = `
### tickets
Pique Ops' central work-item table. One row per unit of work needing a human, whether created manually or shadow-mirrored from an existing automation table.
- id uuid (PK), type text, status text, priority text, stage text (nullable)
- property_id / reservation_id / conversation_id uuid (nullable FKs), guest_name text, staff_ref text
- assignee_id / created_by uuid (FK profiles), assignee_team_id uuid (FK teams - a ticket can be owned by a team, a person, or both), source text
- external_ref text (unique, nullable) - e.g. "unanswered:{hospitable_message_id}", "noshow:{shift_id}:{check_date}", "review_flag:{id}", "review_removal:{review_id}"
- parent_ticket_id uuid (self FK), rollover_count int
- due_at timestamptz, sla_breached boolean, metadata jsonb (free-form, varies by type)
- started_at / target_at timestamptz (clock start and optional internal target), health text: 'on_track' | 'attention' | 'behind' | 'missed' | 'waiting' (computed from the clock and checklist progress; null = resolved or no clock). Per-type clock rules live in ticket_type_clocks.
- created_at / updated_at / closed_at timestamptz

tickets.status: 'open' | 'in_progress' | 'blocked' | 'resolved' | 'closed'. "Open" for reporting purposes means status in ('open','in_progress','blocked').
tickets.priority: 'low' | 'normal' | 'high' | 'urgent'.
tickets.stage: 'book' | 'checkin' | 'stay' | 'checkout' | 'turnover' | 'accountability' - where the underlying reservation is in its lifecycle, not every ticket has one.
tickets.source: 'manual' | 'automation' | 'guest_message' | 'missed_call' | 'email'.
tickets.type (free text, no DB constraint - values in use today):
  maintenance_ticket, maintenance_access - stay-stage maintenance issues
  cleaning_issue, cleaner_late_noshow, incomplete_cleaning_form, qc_inspection, cleaning_overtime_approval - cleaning/turnover ops
  review_removal_case, review_removal_escalation, review_action_item, guest_review_reminder, review_flag - review handling (review_flag is the earlier suppression-decision stage, review_removal_case is the later "drafted a removal request" stage - distinct types)
  guest_vetting, direct_booking_id_check, pack_n_play, pet_fee - pre-arrival checks (guest_vetting has no rows yet - its source workflow never persists a verdict)
  claim_tracker - AirCover/insurance claims, due_at is the filing deadline
  unanswered_message, missed_call, extension_request - guest communication
  system_health - the app's own job failures
Note: cleaner_late_noshow, incomplete_cleaning_form, cleaning_overtime_approval, and other purely-internal cleaning-ops ticket types are intentionally hidden from the staff-facing queue UI, but they still exist in this table and are fair game to query directly.

### teams / team_members
- teams: id uuid, name text. team_members: team_id, profile_id. ticket_type_clocks.default_team_id sets which team new tickets of a type go to.

### ticket_events
Audit trail, one row per state change or note on a ticket.
- id uuid, ticket_id uuid not null, event_type text ('status_change'|'assignment'|'field_change'|'rollover'|'escalation'|'item_done'|'comment')
- from_value / to_value text, note text, payload jsonb, actor_id uuid (FK profiles, null for automation), created_at timestamptz

### ticket_comments
- id uuid, ticket_id uuid not null, author_id uuid (FK profiles), body text, created_at timestamptz

### reservations
- id uuid (PK), hospitable_reservation_id text, property_id uuid not null, guest_id uuid
- status text, check_in date, check_out date, nights numeric, guest_count int
- nightly_rate / cleaning_fee / taxes / total_nightly / total_revenue / host_payout numeric
- confirmation_code text, booking_source text, booked_at / cancelled_at timestamptz, cancellation_reason text, special_requests text
- created_at / updated_at timestamptz

### properties
- id uuid (PK), hospitable_property_id text, property_name text, public_name text
- address / city / state_province / country / postal_code text, market text, timezone text (Edmonton/Calgary/Canmore markets)
- property_type / room_type text, bedrooms / bathrooms / beds / max_guests numeric
- pets_allowed / events_allowed / smoking_allowed / is_active boolean
- listing_status text, airbnb_url / vrbo_url / booking_com_url text

### guests
- id uuid (PK), hospitable_guest_id text, first_name / last_name / full_name text, email / phone text
- average_rating numeric, reviews_count int, airbnb_member_since text

### messages
Guest-host messages, synced from Hospitable (~193k rows) plus app-added columns.
- id uuid, hospitable_message_id text, conversation_id uuid, reservation_id uuid, guest_id uuid, property_id uuid
- direction text, message_type text, subject / body text, sent_at / read_at timestamptz
- intent text, intent_confidence numeric (app-added, classifies message content, nullable/sparse)

### calls
GHL calls/voicemail (new surface, expect few or zero rows until that integration is live).
- id uuid, provider text, provider_call_id text, conversation_id uuid, direction text
- call_status text ('missed'|'answered'|'voicemail'), phone_number text, duration_seconds int, occurred_at timestamptz
- recording_url text, transcript text

### conversations
Thin grouping row that messages and calls attach to.
- id uuid, channel text, guest_id uuid, guest_name text, guest_phone text, property_id uuid, reservation_id uuid
- unanswered boolean, last_inbound_at / last_outbound_at timestamptz

### reviews
- id uuid, hospitable_review_id text, property_id uuid not null, reservation_id uuid, guest_id uuid
- overall_rating, cleanliness_rating, accuracy_rating, checkin_rating, communication_rating, location_rating, value_rating numeric (typically 1-5 or 1-10 depending on channel)
- review_text text, reviewer_name text, host_response text, review_date date, booking_source text
- removed_at timestamptz, null unless Airbnb has confirmed the review was taken down (staff mark this manually once removal is confirmed, e.g. after a review_removal_drafts attempt succeeds - Hospitable's sync never clears it). ALWAYS filter removed_at is null for any rating average/count query - a removed review is no longer live on Airbnb and must not count toward current ratings.

### profiles
Internal staff/app users, id is the auth.users FK.
- id uuid (PK), display_name text, role text, slack_user_id text

### cleaning_form_submission (no FK constraints - join carefully)
- form_submission_id text/uuid, check_date date, form_id / form_kind / option_id text, property_id uuid, reservation_id uuid, submitted_at timestamptz

### cleaning_shift_check (no FK constraints)
- shift_id text, check_date date, connecteam_job_id text, flag text ('ok'|'no_show'), assigned_count int, assigned_user_ids jsonb (array, only the first id is ever captured, not the full crew), shift_start / shift_end timestamptz, started / finished boolean
Note: reservation_id on this table is 0% populated - never join on it. Resolve property via cleaning_job_map.connecteam_job_id instead.

### cleaning_job_map (static mapping table, NOT per-occurrence - no check_date)
- id int (PK), connecteam_job_id text, connecteam_title text, property_id uuid (nullable), property_name text, market text, match_confidence text (includes 'unmatched' - roughly half of rows are unmatched with a null property_id, this is normal/expected, not a data quality bug to flag)

### review_flags (bigint id, no FK constraints)
Earlier suppression-decision stage - "should we even try to get this review removed."
- id bigint (PK), reservation_uuid text (free text, casts cleanly to reservations.id for current rows but has no FK constraint), guest_name text
- flagged boolean, status text (includes 'suppressed'), severity / reason text, our_fault / their_fault text
- existing_rating / draft_rating / suggested_rating numeric, existing_review / draft_review text
- decided_by text, decided_at timestamptz
Note: this table's own property_name column is decorative free text - join via reservation_uuid -> reservations -> properties for the real property.

### review_removal_drafts (no FK constraints)
Later stage - an actual drafted removal request sent toward Airbnb. One review can have several draft attempts.
- id uuid, review_id text not null (group by this - one logical case per review_id, not per row), guest_name / property_name text
- review_rating numeric, review_text text, violation_types text, draft_email text, airbnb_response text, attempt_number int, status text

### unanswered_message_alerts (being retired - still the live source table, don't write to it)
- id uuid, hospitable_message_id text, reservation_id uuid, alerted_at timestamptz, escalation_count int, resolved_at timestamptz, resolved_by text

General notes:
- All timestamps are stored in UTC. The team's properties and operations are in America/Edmonton (Mountain time) - convert when a question is about "today" or a specific local date.
- "Open" tickets almost always means status in ('open','in_progress','blocked'), not just 'open'.
- When a question is ambiguous between a ticket type and a raw source table (e.g. "no-shows" could mean cleaning_shift_check.flag='no_show' or cleaner_late_noshow tickets), prefer the tickets table - it's the unified, deduplicated view - unless the question is specifically about the automation's raw detection.

NOT queryable yet - these tables exist and are described above for context, but you have no read access to them (they're only readable by the backend automations that own them, not by staff through the app, and that hasn't been extended to you): cleaning_form_submission, cleaning_shift_check, cleaning_job_map, review_flags, unanswered_message_alerts. A query against any of these will come back empty even though rows exist - don't report that as "zero" or "none found". Instead, answer from the tickets table (cleaner_late_noshow, incomplete_cleaning_form, cleaning_overtime_approval, review_flag ticket types shadow-mirror this same data and ARE queryable), or tell the user this data isn't available to you yet if the tickets table doesn't cover what they asked.
`.trim();
