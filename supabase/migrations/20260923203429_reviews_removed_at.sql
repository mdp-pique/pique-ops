alter table public.reviews add column if not exists removed_at timestamptz;
comment on column public.reviews.removed_at is 'Set when Airbnb confirms the review was taken down (e.g. after a review_removal_drafts attempt succeeds). Hospitable''s sync only ever upserts and never clears this, so a removed review keeps its historical row but is excluded from rating averages/trends once flagged.';
