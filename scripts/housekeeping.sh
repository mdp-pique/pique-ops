#!/usr/bin/env bash
# Coordination check for parallel Claude chats working on this repo.
# Run at the start of a session, before starting a feature, and before pushing to main.
# Read-only: it fetches but never merges, commits or pushes. Exits 1 on a blocking problem.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
branch=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin main 2>/dev/null || echo "!! could not fetch origin/main (offline?) - results may be stale"

echo "== Branch: $branch"

behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
if [ "$behind" -gt 0 ]; then
  echo "!! main has $behind commit(s) you don't have. Merge before building on top:  git merge origin/main"
  git log --format='   %h %ad %s' --date=short HEAD..origin/main | head -20
else
  echo "ok up to date with main"
fi

# Files both this branch and main changed since they split: likely duplicate or conflicting work.
base=$(git merge-base HEAD origin/main 2>/dev/null || true)
if [ -n "$base" ] && [ "$behind" -gt 0 ]; then
  mine=$( (git diff --name-only "$base" HEAD; git diff --name-only; git diff --name-only --cached) | sort -u)
  theirs=$(git diff --name-only "$base" origin/main | sort -u)
  both=$(comm -12 <(echo "$mine") <(echo "$theirs") | grep -v '^$' || true)
  if [ -n "$both" ]; then
    echo "!! these files changed both here and on main since you branched - check for duplicate work:"
    echo "$both" | sed 's/^/   /'
  fi
fi

# Two migrations with the same version break the Supabase CLI and make history ambiguous.
dupes=$(ls supabase/migrations 2>/dev/null | sed -E 's/^([0-9]+)_.*/\1/' | sort | uniq -d)
if [ -n "$dupes" ]; then
  echo "XX duplicate migration versions (rename yours to an unused, later timestamp):"
  for v in $dupes; do ls supabase/migrations | grep "^${v}_" | sed 's/^/   /'; done
  fail=1
else
  echo "ok migration versions unique (latest: $(ls supabase/migrations | tail -1))"
fi

echo
echo "== In-flight work (docs/in-flight.md)"
if [ -f docs/in-flight.md ]; then
  sed -n '/^| Branch/,/^$/p' docs/in-flight.md
else
  echo "   (missing)"
fi

exit $fail
