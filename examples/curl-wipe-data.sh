#!/bin/bash
# ════════════════════════════════════════════════
#  Wipe data — DESTRUCTIVE. Dev only.
#  Removes all messages, conversations, customers.
#  Keeps pages metadata (resets aggregates to 0).
# ════════════════════════════════════════════════

set -e

SUPABASE_URL="${SUPABASE_URL:-http://localhost:3000}"
SUPABASE_KEY="${SUPABASE_KEY:-}"
SCHEMA="${SCHEMA:-aiecos_social}"

if [ "${1:-}" != "--yes" ]; then
  echo "⚠  WARNING: This will DELETE all messages, conversations, customers."
  echo "   Re-run with --yes to confirm: bash $0 --yes"
  exit 1
fi

HDR=""
if [ -n "$SUPABASE_KEY" ]; then
  HDR_AUTH="-H apikey:$SUPABASE_KEY -H Authorization:Bearer\ $SUPABASE_KEY"
fi

for table in messages conversations customers; do
  echo "Wiping $table..."
  curl -sS -X DELETE "$SUPABASE_URL/$table?id=not.is.null" \
    -H "Accept-Profile: $SCHEMA" -H "Content-Profile: $SCHEMA" \
    -H "Prefer: return=minimal" $HDR_AUTH \
    -o /dev/null -w "  HTTP %{http_code}\n"
done

echo "Resetting pages aggregates..."
curl -sS -X PATCH "$SUPABASE_URL/pages?id=not.is.null" \
  -H "Accept-Profile: $SCHEMA" -H "Content-Profile: $SCHEMA" \
  -H "Prefer: return=minimal" -H "Content-Type: application/json" $HDR_AUTH \
  -d '{"total_conversations":0,"total_messages":0}' \
  -o /dev/null -w "  HTTP %{http_code}\n"

echo "✓ Wipe complete."
