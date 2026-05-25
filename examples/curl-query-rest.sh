#!/bin/bash
# ════════════════════════════════════════════════
#  Query Supabase REST (PostgREST)
#  Read pages, customers, messages from aiecos_social schema
# ════════════════════════════════════════════════

SUPABASE_URL="${SUPABASE_URL:-http://localhost:3000}"
SUPABASE_KEY="${SUPABASE_KEY:-}"
SCHEMA="${SCHEMA:-aiecos_social}"

# Build header arg (only add if key set)
HDR=""
if [ -n "$SUPABASE_KEY" ]; then
  HDR="-H apikey:$SUPABASE_KEY -H Authorization:Bearer\ $SUPABASE_KEY"
fi

echo "=== Pages ==="
curl -sS "$SUPABASE_URL/pages?select=id,name,type,total_conversations,total_messages" \
  -H "Accept-Profile: $SCHEMA" $HDR | python3 -m json.tool

echo ""
echo "=== Customers ==="
curl -sS "$SUPABASE_URL/customers?select=id,name,page_id,last_seen_at&order=last_seen_at.desc.nullslast&limit=10" \
  -H "Accept-Profile: $SCHEMA" $HDR | python3 -m json.tool

echo ""
echo "=== Latest 10 messages ==="
curl -sS "$SUPABASE_URL/messages?select=conversation_id,sender_type,sender_name,content,created_time&order=created_time.desc&limit=10" \
  -H "Accept-Profile: $SCHEMA" $HDR | python3 -m json.tool

echo ""
echo "=== Sender_type distribution ==="
curl -sS "$SUPABASE_URL/messages?select=sender_type&limit=10000" \
  -H "Accept-Profile: $SCHEMA" $HDR | python3 -c "
import sys, json
from collections import Counter
data = json.loads(sys.stdin.read())
c = Counter(m['sender_type'] for m in data)
print(dict(c))
"
