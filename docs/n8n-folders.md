# n8n folders

How the n8n workflows are organized (MDP 10-14). Every new workflow goes into its folder when it's
created (`create_workflow_from_code` with `projectId` `sZHbRxIiUZjsfgte` + `folderId`; find the id
with `search_folders`). Keep this list current when you add, rename or retire a workflow.

The existing "Laurice" folder is left as it is.

## Hospitable & Bookings
- Hospitable-Sync-Calendar-Daily
- Hospitable-Sync-Messages-Daily
- Hospitable-Sync-Properties-Daily
- Hospitable-Sync-Reservations-Daily
- Hospitable-Sync-Reviews-Daily
- Hospitable-Webhook-Receiver
- Pique-Client-Bookings-Sync
- Pique-Client-Bookings-Sync-Padmore
- Pique-Bot-Bookings

## Guest Messages
- Pique-Inbox-Classifier
- Pique-Inbox-Morning-Nudge
- Pique-Unanswered-Message-Followup
- Pique-NightShift-Brief-Morning
- Pique-Front-Desk-Confirmations
- Pique-Front-Desk-Notices
- Pique-Guest-Fraud-Check

## Cleaning & Connecteam
- Pique-Cleaning-Shifts-From-Bookings
- Pique-Client-Cleaning-Shifts
- Pique-Cleaning-Clock
- Pique-Cleaning-Chat-Checkins
- Pique-Cleaning-Form-Check
- Pique-Cleaning-Noshow-Check
- Pique-Cleaning-Summary-Daily
- Connecteam-Chat-Capture
- Pique-Connecteam-Directory-Sync
- Pique-Connecteam-Shifts-Sync
- Pique-Connecteam-Forms
- Pique-Damage-Forms
- Guest Checkout → Slack Notification
- Canmore Pack 'n Play Daily Check

## Reviews
- Airbnb Review Removal Monitor - Phase 1
- Pique-Review-Suppression-Scan-v2
- Pique-Review-Suppression-Actor-C
- Pique-Detect-Removed-Reviews-Daily
- Pique-Bot-Reviews
- Pique-Guest-Reviews-Sync

## Claims
- Pique-Claim-Payouts
- Aircover Claim Deadline Reminder
- Truvi Claim Deadline Reminders

## Pique-a-choo & Alerts
- Pique-Bot-Alerts
- Pique-Bot-Morning
- Pique-Email-Alerts
- Pique-Parking-Form-To-Ticket
- Pique-Slack-Chat-Capture
- Pique-Slack-Directory-Sync

## Sales & Onboarding
- Pique-N2P-Social-Messages
- Pique-Lifestyle-Contact-Us
- Pique-Onboarding-Folder

## System & Reports
- Pique-Error-Handler
- Pique-Silence-Check
- Pique-Changelog
- Pique-Pipeline-Health-Check
- Pique-Ticket-Health-Refresh
- Pique-Recalculate-Property-Metrics
- Pique-Executive-Summary-Daily

## Old (turned off)
- Chrangela & PEKA Email → Slack Alert
- Damage Claim Automation
- Hospitable-Backfill-Reservations-2025
- MyKey Housing Request → Slack Alert
- Pique-Bot-Preview
- Pique-Cleaning-Form-Option-Sync
- Pique-Cleaning-Job-Map-Sync
- Pique-Cleaning-Property-Form-Sync
- Pique-Connecteam-Form-Dropdown-Options
- Pique-Connecteam-Inspect-FormSubmissions
- Pique-Connecteam-List-Forms
- Pique-Connecteam-List-Jobs (helper, read-only: job ids and titles)
- Pique-DM-Once-Laurice-Coastal-Calm (one-off DM, sent 10-14)
- Pique-Connecteam-List-Schedulers
- Pique-Connecteam-List-TimeClocks
- Pique-Connecteam-Users-Sync
- Pique-Offboard-Properties
- Pique-Requeue-Fallbacks
- Pique-Slack-Channel-Audit
- QBO Expense Pull - Purchases + Bills
- QBO Transaction Pull - Purchases (proof)
- Review Removal Retry
- STR-Wealth-Slack-Channel-Export
- VR Platform Statement Pull
- z-Hospitable-Backfill-Queue
