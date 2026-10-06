---
name: housekeeping
description: Coordinate with the other Claude chats working on this repo at the same time. Use at the start of every session, before starting any new feature or fix, and before every push to main - and whenever the user mentions another chat, duplicate work, or something "the other Claude" built. Prevents duplicate features, duplicate migration versions, and one chat undoing another's work.
---

# Housekeeping between parallel chats

Several chats build on this repo and the same production systems (Supabase, n8n, Slack) at once. None of them can see the others' conversations. The repo is the only shared memory, so coordination happens through it:

- `docs/in-flight.md` - who is working on what, and who owns each live automation.
- `scripts/housekeeping.sh` - read-only check: commits on main you don't have, files changed both here and on main, duplicate migration versions.
- `CLAUDE.md` - the record of what's finished and how it works.

## 1. Start of a session, and before starting any piece of work

1. Run `scripts/housekeeping.sh`.
2. If main has commits you don't have, run `git merge origin/main` before writing code. Never rebase or force-push a shared branch.
3. Read `docs/in-flight.md`, the commits the script listed, and the `CLAUDE.md` sections for the area you're about to touch. Look for anything that overlaps the task: the same table, function, n8n workflow, Slack channel, page or component.
4. **If another chat already built or is building it, stop and tell the user before writing code.** Say what exists, where, and what you'd change. Offer to extend it rather than build a second version.
5. Add or update your row in `docs/in-flight.md` (branch, what, touches, date, status). Commit it with your first change.

## 2. While building

- Don't edit a live automation another branch owns (see "Who owns live automations"). Ask the user first, even for a small fix. Additive work next to it is fine.
- Migrations: run the script, then choose a version later than the newest file in `supabase/migrations/` on main. Never reuse one.
- New `automation_flags` keys get your feature's prefix.
- If you replace or supersede another chat's feature, say so in CLAUDE.md ("replaces X") and delete or update the old description in the same commit, so the docs don't describe two behaviours.

## 3. Before every push to main

1. `git fetch origin main && git merge origin/main`. Resolve conflicts by keeping both sides' intent; ask the user if both changed the same logic.
2. Run `scripts/housekeeping.sh`. It must exit 0 (no duplicate migration versions).
3. Run the repo's checks: `./node_modules/.bin/tsc --noEmit -p .` and `./node_modules/.bin/eslint <changed files>`.
4. Push your branch, then `git push origin HEAD:main`. If main moved while you were checking, go back to step 1.
5. Update `CLAUDE.md` / `docs/PRD.md` for what you shipped, and update your `docs/in-flight.md` row (or delete it when the work is done).
6. **Add a changelog entry** for what you just pushed. Pique Bot posts it to Slack `#change-logs` within 5 minutes, numbered. Run it through Supabase SQL:
   ```sql
   insert into changelog_entries (title, body, areas, commit_sha, branch) values (
     'Short title of the change',
     E'• What changed, in plain words for the team\n• Why, and anything they need to do',
     array['app','database','n8n'],   -- any of: app, database, n8n, zapier, slack, other
     '<git rev-parse HEAD>', '<your branch>');
   ```
   One entry per push (several bullets are fine). Also add one when you change a live automation without a code push: an n8n workflow published or edited, a Zap the user turned off, a Slack channel switched over. Write it for the team, not for engineers: no file paths or function names.

## 4. When you notice a mess another chat made

Duplicate migration versions, stale docs, or two versions of one feature: fix the purely mechanical ones (rename your own migration, correct a doc line about your own work). For anything in another chat's area, tell the user what you found and leave it, or fix it only after a yes.
