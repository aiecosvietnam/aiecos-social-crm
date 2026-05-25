#!/bin/bash
# ════════════════════════════════════════════════
#  Test sync receiver — POST 1 sample message
# ════════════════════════════════════════════════

API_TOKEN="${API_TOKEN:-dev-token-change-me-in-prod}"
SYNC_URL="${SYNC_URL:-http://localhost:3500}"

echo "=== POST 1 customer message ==="
curl -sS -X POST "$SYNC_URL/api/sync" \
  -H "X-AIECOS-Token: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "page_name": "demo_page_001",
    "channel": "zalo",
    "ten_khach": "Nguyen Van A",
    "url": "https://app.pancake.vn/?pzl_111111",
    "thread_id": "pzl_111111",
    "messages": [
      {
        "content": "Hi shop, do you have size M in stock?",
        "sender_type": "customer",
        "sender_name": "Nguyen Van A",
        "timestamp": "2026-05-25T10:00:00Z",
        "pancake_msg_id": "demo_msg_001"
      }
    ]
  }' | python3 -m json.tool

echo ""
echo "=== POST 1 agent reply ==="
curl -sS -X POST "$SYNC_URL/api/sync" \
  -H "X-AIECOS-Token: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "page_name": "demo_page_001",
    "channel": "zalo",
    "ten_khach": "Nguyen Van A",
    "url": "https://app.pancake.vn/?pzl_111111",
    "thread_id": "pzl_111111",
    "messages": [
      {
        "content": "Yes, size M is available. Would you like to place an order?",
        "sender_type": "agent",
        "sender_name": "AIECOS Demo Shop",
        "timestamp": "2026-05-25T10:01:30Z",
        "pancake_msg_id": "demo_msg_002"
      }
    ]
  }' | python3 -m json.tool

echo ""
echo "=== POST same msg again (should be deduped) ==="
curl -sS -X POST "$SYNC_URL/api/sync" \
  -H "X-AIECOS-Token: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "page_name": "demo_page_001",
    "channel": "zalo",
    "ten_khach": "Nguyen Van A",
    "url": "https://app.pancake.vn/?pzl_111111",
    "thread_id": "pzl_111111",
    "messages": [
      {
        "content": "Hi shop, do you have size M in stock?",
        "sender_type": "customer",
        "sender_name": "Nguyen Van A",
        "timestamp": "2026-05-25T10:00:00Z",
        "pancake_msg_id": "demo_msg_001"
      }
    ]
  }' | python3 -m json.tool
