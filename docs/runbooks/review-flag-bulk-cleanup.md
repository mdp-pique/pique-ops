# Review flag bulk cleanup (for Laurice + her Claude)

Written 2026-09-24. Numbers are a snapshot from that day; the queries below recompute them.

## For Laurice

There are **209 open review flags** in the ops app's Reviews section, and 202 of them are marked Behind. Most don't need a decision:

| Group | Count | What to do |
|---|---|---|
| Airbnb, guest already left a review (all 4★+) | 77 | Close. Nothing to decide. |
| Airbnb, no review, 14-day review window closed | 71 | Close. The guest can't review anymore. |
| Airbnb, still inside the review window | 11 | Real decisions. Decide each one. |
| Vrbo / Booking.com / direct | 50 | Your call. Their review windows differ from Airbnb's. |

You have the context we don't: which ones you appealed, what Airbnb said, and what you decided. Paste the prompt below into your Claude (it needs the Supabase connector), attach your appeals and decisions (a spreadsheet, a doc, or pasted text is fine), and it will match them up, show you every change before it writes, and log what it did.

Closing a flag here closes its ticket in the app automatically. For a single one you can also open the ticket in the app and press **Don't appeal**, which does the same thing.

**Before you start, one thing only you know:** does anything else (n8n, Slack, Hospitable) react when `review_flags.status` changes to `suppressed`? The app and the Slack buttons both write it, and we don't think anything downstream acts on it. Confirm before bulk-closing flags that are still inside their review window.

---

## Prompt for Claude (copy everything below this line)

You're helping Laurice at Pique Properties bulk-close review flags in our production Supabase database. Work carefully: this database is shared with live automations. Read this whole brief before running anything.

### Where

- Supabase project ref **`fnapzaunhfjqftvbduma`** (org `pique-revenue-management`). Use the Supabase connector's SQL tool.
- It is **production** and shared with other tools (fraud checks, review pipeline, cleaning ops, revenue). No schema changes, no deletes, no edits to triggers, functions or policies, no n8n workflow edits.
- Timestamps are UTC; Pique operates in `America/Edmonton`.

### The tables

**`public.review_flags`** (one row per flagged stay; source of truth, written by Laurice's review pipeline and its Slack buttons)
- `id` bigint PK
- `reservation_code` text (platform confirmation code, the best key for matching)
- `reservation_uuid` text (our `reservations.id` stored as text; casts cleanly to uuid)
- `guest_name`, `property_name` text, `checkout_date` date
- `severity` (`low` / `medium` / `high`), `reason`, `evidence_snippet`, `agent_verdict` (`suppress` / `keep`)
- `existing_review` text, `existing_rating` numeric (the guest's review of us, if one was left)
- `status` text: currently only **`pending`** (open) or **`suppressed`** (decided/closed)
- `decided_by` text, `decided_at` timestamptz
- Leave every other column alone (`slack_ts`, `slack_channel`, `reminders_cancelled`, `review_handled`, the draft/suggested fields).

**`public.tickets`** (the ops app's tickets). Each flag has one ticket, `type = 'review_flag'`, `external_ref = 'review_flag:' || review_flags.id`.
- A trigger on `review_flags` (`mirror_review_flag_to_ticket`) keeps the ticket in sync. When a flag's `status` becomes `'suppressed'`, the trigger sets the ticket to `resolved` by itself. **Any other status value reopens the ticket**, so never write a status other than `pending` or `suppressed`.
- Never set `tickets.health`, `due_at`, or `sla_breached` by hand. Triggers own them.

**`public.ticket_comments`** (`ticket_id` uuid, `author_id` uuid, `body` text): a note on the ticket. Use it to record why each flag was closed.

**`public.ticket_events`** (`ticket_id`, `event_type`, `actor_id`, `from_value`, `to_value`, `note`): the audit log. Add a row whenever you change a ticket's status directly.

**`public.review_removal_drafts`** (one row per removal attempt sent to Airbnb)
- `review_id` uuid → **`public.reviews.id`** (not `guest_reviews`). Match a flag to its review with `reviews.reservation_id::text = review_flags.reservation_uuid`. Only about 85 of the 209 flags have a matching review row.
- `guest_name`, `property_name`, `review_rating`, `review_text`, `violation_types`, `draft_email` (the appeal text), `airbnb_response`, `attempt_number` int, `status`, `slack_thread_ts`
- `status` values in use: `pending`, `no_violation`, `removed`. The app also writes `sent` and `rejected`.
- A trigger mirrors these into one `review_removal_case` ticket per review (`external_ref = 'review_removal:' || review_id`). **Only `status = 'no_violation'` closes that ticket.** `removed` and `rejected` leave it open (known gap), so close finished cases directly on the ticket (step 6).

Laurice's app profile id, used for `author_id` / `actor_id`:
```sql
select p.id from public.profiles p join auth.users u on u.id = p.id
where u.email = 'laurice@piquepropertiesinc.com';
```
Use `decided_by = 'laurice@piquepropertiesinc.com'` (the same format the app writes).

### How to work

1. **Look first, write nothing.** Run the survey query, show Laurice the counts, and confirm they match what she expects.
   ```sql
   select
     case
       when rf.existing_review is not null or rf.existing_rating is not null then '1 already reviewed'
       when r.booking_source = 'airbnb' and rf.checkout_date < current_date - 14 then '2 airbnb window closed'
       when r.booking_source = 'airbnb' then '3 airbnb window open'
       else '4 other channel: ' || coalesce(r.booking_source, 'unknown')
     end as bucket,
     count(*)
   from public.review_flags rf
   left join public.reservations r on r.id::text = rf.reservation_uuid
   where rf.status = 'pending'
   group by 1 order by 1;
   ```
2. **Save the before-state.** Export `select id, status, decided_by, decided_at from public.review_flags where status = 'pending'` to a CSV and keep it. That file is the undo list.
3. **Match Laurice's files to flags.** Match on `reservation_code` first; fall back to guest name + property + checkout date. Build a table of flag id → proposed action → reason. List anything you couldn't match or that matched more than one flag, and ask her about those. Never guess.
4. **Show the plan, get a yes.** Show the proposed changes grouped by action with counts and a sample of rows. Write only after Laurice explicitly approves that batch.
5. **Close flags** (buckets 1–2, plus anything she decided not to pursue). Do batches of up to 50 ids in one transaction:
   ```sql
   begin;
   update public.review_flags
     set status = 'suppressed', decided_by = 'laurice@piquepropertiesinc.com', decided_at = now()
   where id in (/* ids */) and status = 'pending';
   insert into public.ticket_comments (ticket_id, author_id, body)
   select t.id, '<laurice profile id>', 'Bulk cleanup: ' || '<reason, e.g. guest already reviewed 5★ / review window closed>'
   from public.tickets t where t.external_ref in (/* 'review_flag:' || id for each id */);
   commit;
   ```
   Afterwards, check that those tickets now show `status = 'resolved'`.
6. **Appeals she already sent** (she has the appeal text):
   - Find `reviews.id` for the flag (see matching above). If there isn't one, tell her. It can't be logged as a removal attempt without a review row.
   - `attempt_number` = `coalesce(max(attempt_number), 0) + 1` from `review_removal_drafts` for that `review_id`.
   - Insert: `review_id`, `guest_name`, `property_name`, `review_rating` (from `reviews.overall_rating`), `review_text` (from `reviews.review_text`), `violation_types = 'logged manually'`, `draft_email` = her appeal text, `airbnb_response` = Airbnb's reply if any, `slack_thread_ts = ''`, `attempt_number`, and `status` = `'sent'` (no answer yet), `'rejected'`, or `'removed'`.
   - Then resolve the flag's ticket the way the app does, leaving `review_flags.status` as `pending`:
     ```sql
     update public.tickets set status = 'resolved', closed_at = now()
     where external_ref = 'review_flag:<id>' and status in ('open','in_progress','blocked');
     insert into public.ticket_events (ticket_id, event_type, actor_id, from_value, to_value, note)
     select id, 'status_change', '<laurice profile id>', 'open', 'resolved', 'Appeal logged from bulk cleanup'
     from public.tickets where external_ref = 'review_flag:<id>';
     ```
   - If the review was **removed**, inserting the attempt with `status = 'removed'` resolves the `review_removal_case` ticket by itself. If Laurice is **giving up** after a final rejection, close that ticket directly the same way (`external_ref = 'review_removal:<review_id>'`, `to_value 'resolved'`, a note saying it was finally rejected).
7. **Still undecided:** leave them `pending`. They stay in the app for her to handle one by one.
8. **Verify and report.** Re-run the survey query. Then confirm every flag you closed has a resolved ticket:
   ```sql
   select rf.id, rf.status, t.status as ticket_status
   from public.review_flags rf join public.tickets t on t.external_ref = 'review_flag:' || rf.id
   where rf.decided_at > now() - interval '1 day' and t.status not in ('resolved','closed');
   ```
   It should return nothing. Give Laurice a short summary: how many closed, how many appeals logged, and what's left.

### Undo

To reopen a flag closed by mistake, set it back to pending from the saved CSV. The trigger reopens its ticket.
```sql
update public.review_flags set status = 'pending', decided_by = null, decided_at = null where id in (/* ids */);
```

### Don'ts

- Don't write any `review_flags.status` value other than `pending` or `suppressed`.
- Don't delete rows, change columns, or touch triggers, functions, RLS policies or n8n workflows.
- Don't contact guests, post to Slack, or call Hospitable. This is database bookkeeping only.
- Don't set ticket `health`, due dates or `sla_breached`.
- If something doesn't fit this brief, stop and ask Laurice. Don't improvise.
