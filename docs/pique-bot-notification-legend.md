# Pique Bot notification legend

How Pique Bot decides when and where to post, so the team gets told about what matters without being flooded. Each ticket type gets one level in `src/lib/pique-bot/config.ts`, so moving an item between levels is a one-line change. Each list is approved separately. The Zap in quotes is the one the item replaces (see `docs/zapier-migration.md`).

## Levels

| Level | When it posts | Who's tagged | Follow-up |
|---|---|---|---|
| 🔴 Urgent | Right away | The person or team who owns it | One reminder in the thread if nobody taps Done / Not yet within 1 business hour; top of the next morning post |
| 🟡 Today | Right away, in its channel | The owner, if it's assigned to someone | None; in the next morning post if still open |
| ⚪ Morning | Only in the 7 AM post | Nobody | Comes back each morning until done |
| FYI | A plain post, no buttons, no ticket | Nobody | None |

Rules against overload:
- Each item posts right away at most once. Later changes edit that post instead of adding new ones.
- At most one reminder per item.
- Quiet hours are 21:00-07:00 Edmonton. Anything that comes in overnight waits for the morning post.
- One morning post per channel, sorted by level.

Unless a line says otherwise, each item posts to the same channel and tags the same people its Zap does today.

## 🔴 Urgent — status: proposed

| Item | Replaces |
|---|---|
| Cancelled booking: reach out and try to save it | "Cancelled Reservation -> Slack Notification" |
| Email from Airbnb Support | "Airbnb Support Email Notification to Slack" |
| Reply from Robert (attaches to the open escalation ticket and ticks "Robert responded") | "Reply from Robert Notification to Slack" |

## 🟡 Today — status: proposed

| Item | Replaces |
|---|---|
| Invoice email to review | "Invoice To Slack - Email" |
| Invoice tagged Reviewed: Cristine enters it in QBO / Plooto | "Gmail Tagged as 'Reviewed' --> Notify Cristine" |
| Interac e-Transfer received | "e-Transfer To Slack - Email" |
| New booking with a pet: request and collect the pet fee (moved from Morning 10-07; posted to #new-reservation-with-pet as it comes in to request the fee; #pique-team-chat's 7 AM post asks from 2 days before check-in until collected) | "New Reservations - Pet" (off) |
| Email from Chrangela / PEKA (built 10-07; replaces an n8n workflow that @channel'd #pique-team-chat) | n8n "Chrangela & PEKA Email → Slack Alert" |
| Aircover reimbursement email | "Aircover Gmail -> Slack Notification" |
| Truvi resolution email | "Truvi Resolution Email -> Slack Notification" |
| Damage reported by a cleaner (photos attached; buttons: AirCover claim / Truvi claim / Wear and tear; built 10-06) | "Connecteam to Slack - Damages" |
| Linens damaged by guest (photos attached; claim or wear and tear) | "Connecteam to Slack - Linens Damaged by Guest" |
| New Aircover / Truvi claim to prepare (opened by the choice on the damage ticket instead of an emoji; built 10-06) | "New Aircover Claim --> Slack Notification", "New Truvi Claim --> Slack Notification" |
| Claim approved: record the payout (Cristine) | "Aircover Claim Payout Tracker Spreadsheet", "Truvi Claim Payout Tracker Spreadsheet" |
| Supply order form | "Connecteam Order Form To Slack" |
| Cleaning QC form submitted | "Connecteam to Slack - Cleaning QC Form" |
| Review rated cleanliness below 5: clean needs attention (built 10-07: a cleaning issue ticket, no tag for now, cleaner named for Edmonton only) | "Finding Clean when Review is Submitted", "Quality Control Reviews (Canmore and Calgary)" |
| MyKey housing request | "MyKey Housing Request" |
| Sinistar rental offer | "Sinistar Rental Offer -> Slack Notification" |
| Email from Ondilo / Booking.com contact | "Ondilo Email -> Slack Notification" |
| Booking shows only 1 guest: confirm the count (moved from Morning 10-06: same-day bookings need asking right away) | "New Reservations - 1 Guest Only" |

## ⚪ Morning — status: proposed

| Item | Replaces |
|---|---|
| Direct booking ID (already live) | - |
| Parking registration, incl. 213 FML on check-in day (already live, extended to every 213 FML booking) | "213 FML Parking Registration Reminder -> Slack Notification" |
| Pack 'n play (already live) | - |

## FYI — status: proposed

| Item | Replaces |
|---|---|
| New booking summary, posted as each booking comes in, around the clock (live 10-06; the GHL contact update is still to build) | "New Reservations" |
| Every other guest review (5 for cleanliness: the cleaner might need a congrats), posted as it comes in (built 10-07; moved from Morning, same as the Zap did) | "Finding Clean when Review is Submitted", "Quality Control Reviews (Canmore and Calgary)" |
| Stripe payment received | "Stripe Payment Success Notification to Slack" |
| Payfunnel payment received (the Circle invite happens behind the scenes) | "Payment success -> Sheet" |
| Hubstaff timer started / stopped (pending: still wanted?) | "Started Timer", "Stopped Timer" |
| New N2P (IG / FB) message | "Pique N2P - IG & FB" |

## No post (background only)

These move to n8n or the database and never post: "Monthly Payout Emails" (Gmail drafts), "Zoom to Drive Recordings STR Wealth - Michael STR", "Onboarding" (GHL → Drive folder), "Hospitable New Reservations", "213 FML New Reservations", "Clock out Tracker for reviews - Connecteam", "New - Cleaning from Padmore to Connecteam", "New - Cleaning from Stephan to Connecteam".
