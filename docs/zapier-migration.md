# Zapier migration

Every active Zap moves to n8n or into the app, so Zapier can be cancelled. The plan was paid on 2026-10-02 and gives 25 days, so the deadline is **2026-10-27**. The target is everything off by **2026-10-20**, which leaves a week of buffer.

The source is the two Zap exports MDP shared on 2026-10-02: 24 Zaps in page 1 and 18 in page 2, 42 in total. Everything else in Zapier is already off and will be deleted. Zap ids below are `P1-n` / `P2-n`, meaning export page and the Zap's id in that file. The exports hold owner and partner email addresses, so they are not committed.

## Rules

- **Shadow first.** The replacement runs next to the Zap until its output matches. Shadow runs create tickets but don't post to Slack, so nobody gets two pings.
- **MDP turns each Zap off in Zapier.** Claude can't, and doesn't try. A Zap is marked `off` here only once MDP confirms it.
- **Fall back if the app isn't ready.** If an app replacement won't be ready by 10-17, port the Zap to n8n as it is (same Slack post, same sheet) so Zapier can still be cancelled. It moves into the app later.
- **Don't touch what's already built.** Follow `CLAUDE.md`: no edits to live n8n flows or existing tables' writers without sign-off.

## Lanes

| Lane | What | Zaps |
|---|---|---|
| **S. Shifts** | Already replaced by `Pique-Cleaning-Shifts-From-Bookings` | P1-25, P2-75, P2-14 (P2-31, P2-51 pending an answer) |
| **B. Booking events → tickets** | DB triggers on `reservations`, same pattern as `pet_fee` | P1-96, P2-92, P2-98, P2-103 + P1-127 |
| **E. Email → tickets** | One n8n Gmail flow with a rules table. Each rule makes a ticket, posts to its channel, and links the email. | P1-5, P1-8, P1-22, P1-85, P1-91, P1-94, P1-99, P2-26, P2-28, P2-87 |
| **C. Claims & damage** | Connecteam forms and Slack emoji → claim / maintenance tickets, payout tracked on the ticket | P1-18, P2-22, P1-109, P1-125, P1-111, P1-118 |
| **Q. QC & cleaning** | Review ratings → clean → cleaner from the DB; QC and supply forms → tickets | P1-71, P1-55, P1-76, P1-102, P2-90, P2-12 |
| **N. Straight port to n8n** | Plumbing and notifications for other systems; same behaviour | P1-1, P1-11, P1-13, P1-45, P1-88, P2-1, P2-6, P2-8, P2-10, P2-71 |

## Schedule

| When | What |
|---|---|
| 10-02 | Off: P1-25, P2-75, P2-14, P2-98 (MDP) |
| 10-03 → 10-07 | B and E built, in shadow |
| 10-06 → 10-10 | N ported (needs credentials, below) |
| 10-08 → 10-15 | B and E Zaps off after parity; C and Q built |
| 10-15 → 10-20 | C and Q Zaps off, or fall back to straight ports |
| 10-20 → 10-26 | Buffer; delete Zaps; cancel Zapier |

## Every Zap

Status: `todo` · `building` · `shadow` · `ready to turn off` · `off`

| Zap | Name | What it does today | Replacement | Lane | Status |
|---|---|---|---|---|---|
| P1-25 | New Main - Connecteam Accepted/Booking | New Edmonton/Calgary booking → creates an open Connecteam shift; moves an open one if found | Shifts-from-bookings flow (live). This Zap still creates a duplicate for nearly every new Edmonton booking (29 of 37 since go-live), which the flow then deletes. | S | off (10-02) |
| P2-75 | New Main - Connecteam Cancelled Booking | Edmonton booking cancelled → deletes the shift | Shifts-from-bookings flow `remove` | S | off (10-02) |
| P2-14 | Connecteam Cancelled - 268lw0o | Hospitable webhook (older payload format) on cancel → deletes the shift | Shifts-from-bookings flow `remove`. Once off, delete the webhook in Hospitable's settings that points at Zapier. | S | off (10-02) |
| P2-31 | New - Cleaning from Padmore to Connecteam | Hospitable "reservation" trigger on Padmore's own Hospitable login (a separate Zapier connection from the main account). New or changed accepted booking → finds the job in the property → Connecteam sheet (column B) → creates an open shift 12 h to 6 h before checkout, or moves an open one. | Active cleaning client (Laurice 10-02). Extend the shifts flow with that account's bookings and job rows. | S | todo |
| P2-51 | New - Cleaning from Stephan to Connecteam | Same trigger on Stephen's own Hospitable login (its own Zapier connection). Same steps; it searches for an existing shift 12 h to 9 h before checkout. | Active cleaning client. Same extension. Needs that login in n8n ("Hospitable API 2" may already be one of the two). | S | todo |
| P1-96 | Cancelled Reservation → Slack | Cancelled booking → tags 4 people to try to save it, ✅ when done | `save_booking` ticket from a `reservations` trigger; resolves on rebook or after the original check-in | B | off (10-06, after a mix-up with P1-45 on 10-05); Pique Bot live |
| P2-92 | New Reservations - 1 Guest Only | New booking with 1 guest → ask the guest for the real count, ✅ | `guest_count_check` ticket from a `reservations` trigger | B | off (10-05); Pique Bot live |
| P2-98 | New Reservations - Pet | New booking with a pet → ask for the pet fee, ✅ | `pet_fee` tickets already exist, and Pique Bot asks from 2 days before check-in. MDP 10-02: that's enough. | B | off (10-02) |
| P2-103 | 213 FML Parking Registration Reminder | 11 AM daily → reminds the group on check-in day to register the guest's vehicle | A `vehicle_registration` ticket for every 213 FML booking, not only when the form comes in; Pique Bot asks on check-in day | B | todo |
| P1-127 | 213 FML New Reservations → Sheet | Logs 213 FML bookings to a sheet for P2-103 | Not needed once P2-103 reads `reservations` | B | todo |
| P1-5 | Invoice To Slack - Email | Inbox subject contains "invoice" → finance channel, ✅ | Email rule → `invoice_review` ticket | E | off (10-06); Pique Bot live |
| P2-26 | Gmail Tagged 'Reviewed' → Notify Cristine | Label "Reviewed" → Cristine enters it in QBO and Plooto, ✅ | Same ticket, next step: label → "Enter in QBO/Plooto" item assigned to Cristine | E | off (10-06); Pique Bot live |
| P2-28 | e-Transfer To Slack - Email | Interac email → channel, ✅ | Email rule → ticket; later match to a pet fee / direct-booking ticket | E | off (10-06); Pique Bot live |
| P1-8 | MyKey Housing Request | Subject match → channel, ✅ | Email rule → ticket | E | off (10-05); Pique Bot live |
| P1-91 | Sinistar Rental Offer | Sender + subject match → channel, ✅ | Email rule → ticket | E | off (10-05); Pique Bot live |
| P1-99 | Ondilo Email | Ondilo support / one Booking.com contact → channel, ✅ | Email rule → ticket | E | off (10-05); Pique Bot live |
| P2-87 | Airbnb Support Email | Airbnb support messaging → tags 4, ✅ | Email rule → ticket | E | off (10-05); Pique Bot live |
| P1-85 | Reply from Robert | Email from Robert → tags 2, ✅ | Email rule → comment on the open `review_removal_escalation`, tick "Robert responded"; plain ticket if none open | E | off (10-05); Pique Bot live |
| P1-22 | Aircover Gmail | Labelled Aircover email → MDP, ✅ | Email rule → attach to the open claim, else a claim ticket | E / C | off (10-05); Pique Bot live |
| P1-94 | Truvi Resolution Email | Labelled Truvi email → MDP, ✅ | Same, for Truvi | E / C | off (10-05); Pique Bot live |
| P2-22 | Connecteam to Slack - Damages | Damage form + photos → "add to damages list", react with the Aircover / Truvi / maintenance emoji | Form → damage ticket with photos; the team picks Aircover / Truvi / maintenance in the app (or by the same emoji) | C | off (10-06); Pique Bot live |
| P1-18 | Connecteam - Linens Damaged by Guest | Linens form + photos → claim or wear-and-tear emoji, ✅ | Same as P2-22 | C | off (10-06); Pique Bot live |
| P1-109 | New Aircover Claim | Aircover emoji in the damages channel → "add to sheet, prepare claim" | Choosing Aircover on the damage ticket opens the claim ticket | C | replacement live 10-06; turn the Zap off ~10-08 (old emoji posts) |
| P1-125 | New Truvi Claim | Same for Truvi | Same | C | replacement live 10-06; turn the Zap off ~10-08 (old emoji posts) |
| P1-111 | Aircover Claim Payout Tracker | Claims sheet row paid → payout sheet + 🎉 to Cristine | Payout recorded on the claim ticket; summary view replaces the payout sheet | C | todo |
| P1-118 | Truvi Claim Payout Tracker | Same for Truvi | Same | C | todo |
| P1-55 | Clock out Tracker for reviews | Connecteam clock-out → sheet row (who cleaned which unit, when) | Already in `cleaning_shift_check` / `connecteam_shifts`; only fed the QC sheet, which nothing reads now | Q | replacement live 10-07; turn off |
| P1-76 | Finding Clean when Review is Submitted | Review row → finds the cleaner → congrats or needs-attention post + log | `reviews` trigger → `review_qc` (cleaner from the checkout clean, Edmonton only) → Pique Bot review feed posts each review to #quality-control-reviews; cleanliness < 5 opens a `cleaning_issue` ticket tagging Tammy (rule `review_qc`). Backfilled the 22 reviews missed since 10-02. | Q | replacement live 10-07; turn off (334164334) |
| P1-102 | Quality Control Reviews (Canmore and Calgary) | Same, for listed Canmore/Calgary units with no cleaner match | Same flow (Canmore / Calgary posts leave the cleaner out, MDP 10-07) | Q | replacement live 10-07; turn off (373307892) |
| P2-90 | Connecteam - Cleaning QC Form | QC form → Tammy + one other with the 3 checks | QC ticket on the clean, or straight port | Q | todo |
| P2-12 | Connecteam Order Form | Supply order form → channel, ✅ | `supply_order` ticket | Q | todo |
| P1-1 | Monthly Payout Emails | 25th, 6 AM → Gmail drafts of owner payout emails (amount left as `$****`) | n8n schedule → same drafts (later: fill the amount from owner statements) | N | todo |
| P1-11 | Pique N2P - IG & FB | N2P webhook → channel with CRM link | n8n webhook → same post (new URL set in N2P) | N | todo |
| P1-13 | Stripe Payment Success | Stripe `payment_intent.succeeded` → looks up the reservation in a sheet → channel | n8n Stripe trigger, reservation from `reservations` instead of the sheet | N | todo |
| P1-88 | Hospitable New Reservations → Sheet | Accepted booking → sheet (feeds P1-13) | Not needed once P1-13 reads `reservations`, unless someone uses the sheet | N | question |
| P1-45 | New Reservations | Hospitable webhook → booking post + GHL contact upsert | Booking post: Pique Bot booking feed (`src/lib/pique-bot/bookings.ts`, n8n `Pique-Bot-Bookings`), live 10-06 after the Zap stopped posting 10-05 ~2 PM. GHL upsert via API still to build | N | Slack post live; GHL todo |
| P1-71 | Reviews for Connecteam Clockouts | Hospitable review → sheet + CassidyAI webhook | Turned off by MDP 10-02 (Cassidy unused). Side effect: no new review rows reached the QC sheet, so P1-76 / P1-102 posted nothing 10-02 to 10-07; replaced by the review feed 10-07 (missed reviews backfilled). | Q | off (10-02) |
| P2-1 | Payment success → Sheet | Stripe (payfunnel) → sheet + Slack + Circle community invite | n8n straight port | N | todo |
| P2-6 | Stopped Timer | Hubstaff timer stop → #hubstaff-monitor | n8n straight port. In daily use (Laurice, Glenn, Cristine, Janina). | N | todo |
| P2-8 | Started Timer | Hubstaff timer start → #hubstaff-monitor | n8n straight port. In daily use. | N | todo |
| P2-10 | Zoom to Drive Recordings | New Zoom recording → Drive folder | n8n straight port | N | todo |
| P2-71 | Onboarding | GHL pipeline stage → Drive folder + copy of the owner guide | n8n straight port | N | todo |

## Credentials n8n needs

- ~~**Gmail, second account**~~ done 10-06: n8n credential "invoices" = invoices@piquepropertiesinc.com, for P1-5, P2-26, P2-28.

n8n already has: Hospitable (2 accounts), Connecteam, Supabase Postgres, Gmail (one account), Slack, Google Sheets, QuickBooks, Anthropic.

Still to add (MDP, in n8n → Credentials):
- **Stripe**, for each account that P1-13 and P2-1 read (likely two: Pique and payfunnel).
- **HighLevel / GHL**, for P1-45 and P2-71, plus the N2P location if it's separate.
- **Google Drive**, for P2-10 and P2-71.
- **Zoom**, for P2-10.
- **Hubstaff**, for P2-6 and P2-8.
- **Circle**, for P2-1.
- **Gmail:** confirm the existing credential is `info@piquepropertiesinc.com`, the inbox the email Zaps read.

## Pique Bot notification legend

MDP 10-02: this branch may extend Pique Bot (daily updates plus immediate posts for high-risk items). The levels and the four lists (Urgent / Today / Morning / FYI) are in `docs/pique-bot-notification-legend.md`, and each list is approved separately.

## Lookup sheets

Every lookup sheet a Zap reads, and what replaces it:
- **Bookings sheet**: "Stripe Payment Success Notification to Slack" finds the reservation code from the Stripe payment and gets the property and dates. Replaced by `reservations`.
- **213 FML sheet**: "213 FML Parking Registration Reminder" finds today's check-ins and gets the guest name and code. Replaced by `reservations`.
- **QC sheet**: "Finding Clean when Review is Submitted" finds the clean by reservation code and gets the cleaner and clean times. It also logs every congrats / needs-attention post on a third tab. Replaced by `reviews` + `connecteam_shifts` / `cleaning_shift_check`; the log is `review_qc` (10-07).
- **Property → Connecteam job sheet** (a fourth one): the shift Zaps find the Connecteam job for a property here (main account by column C, Padmore / Stephan by column B, the old cancel webhook by property id). Replaced by `cleaning_property_jobs` for the main account; Padmore / Stephan properties need rows added.

## Slack channels to retire (MDP 10-05, later)

Once the Zaps that post into a channel are replaced, check whether anything else still posts there and retire the channel. To list when lane B / E are done.

## Open questions

1. P2-6 / P2-8 (Hubstaff timers): Laurice isn't sure whether Michael and Katrina still use them.
2. Approve each list in `docs/pique-bot-notification-legend.md`.

Answered 10-02: P2-14 is a Hospitable webhook. Pet fee timing is fine. Cassidy is unused (P1-71 off). Padmore and Stephan are active cleaning clients. The three sheets exist only as lookups for the Zaps, so they retire with their replacements, and lookup data (Connecteam job ids, GHL ids) moves to DB tables (`cleaning_property_jobs` already covers Connecteam jobs).
