#!/bin/bash
# Regenerates supabase/all_migrations.sql from supabase/migrations/*.sql
cd "$(dirname "$0")/.." || exit 1
{ echo "-- Next Team: all migrations in one script (generated from supabase/migrations by scripts/combine-migrations.sh)."
  echo "-- Paste into Supabase > SQL Editor > New query > Run, once, on a new project."
  for f in supabase/migrations/*.sql; do echo; echo "-- ===== $(basename "$f") ====="; cat "$f"; done; } > supabase/all_migrations.sql
