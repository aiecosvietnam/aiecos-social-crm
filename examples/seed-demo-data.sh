#!/bin/bash
# ════════════════════════════════════════════════
#  Seed demo data — 5 partners with synthetic history
#  Useful for screenshots + first-time demo
# ════════════════════════════════════════════════

set -e

API_TOKEN="${API_TOKEN:-dev-token-change-me-in-prod}"
SYNC_URL="${SYNC_URL:-http://localhost:3500}"

NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Build helper
post_msg() {
  local thread_id="$1" customer="$2" sender="$3" sender_type="$4" content="$5" timestamp="$6" msg_id="$7"
  curl -sS -X POST "$SYNC_URL/api/sync" \
    -H "X-AIECOS-Token: $API_TOKEN" -H "Content-Type: application/json" \
    -d "{
      \"page_name\": \"demo_page_001\",
      \"channel\": \"zalo\",
      \"ten_khach\": \"$customer\",
      \"url\": \"https://app.pancake.vn/?$thread_id\",
      \"thread_id\": \"$thread_id\",
      \"messages\": [{
        \"content\": \"$content\",
        \"sender_type\": \"$sender_type\",
        \"sender_name\": \"$sender\",
        \"timestamp\": \"$timestamp\",
        \"pancake_msg_id\": \"$msg_id\"
      }]
    }" -o /dev/null -w "  %{http_code} "
  echo "$msg_id"
}

# Partner 1 — Active (today)
echo "Partner 1: Active"
post_msg "pzl_demo_001" "Shop Alpha" "Shop Alpha" "customer" "Đặt giúp shop 2 cái áo thun M nhé" "$(date -u -v-2H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '-2 hours' '+%Y-%m-%dT%H:%M:%SZ')" "demo_alpha_001"
post_msg "pzl_demo_001" "Shop Alpha" "AIECOS Demo" "agent" "Đã ghi nhận đơn. Bên em gửi xế chuyến 17h nhé" "$(date -u -v-1H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '-1 hour' '+%Y-%m-%dT%H:%M:%SZ')" "demo_alpha_002"

# Partner 2 — Sleeping (4 days ago)
echo "Partner 2: Sleeping"
post_msg "pzl_demo_002" "Shop Beta" "Shop Beta" "customer" "Còn size L màu xanh không em?" "$(date -u -v-4d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '-4 days' '+%Y-%m-%dT%H:%M:%SZ')" "demo_beta_001"

# Partner 3 — At-Risk (14 days ago)
echo "Partner 3: At-Risk"
post_msg "pzl_demo_003" "Shop Gamma" "Shop Gamma" "customer" "Bên em đã gửi hàng lô tuần trước" "$(date -u -v-14d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '-14 days' '+%Y-%m-%dT%H:%M:%SZ')" "demo_gamma_001"

# Partner 4 — Dormant (50 days ago)
echo "Partner 4: Dormant"
post_msg "pzl_demo_004" "Shop Delta" "Shop Delta" "customer" "Đợt tới mình nhập thêm 100 cái" "$(date -u -v-50d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '-50 days' '+%Y-%m-%dT%H:%M:%SZ')" "demo_delta_001"

# Partner 5 — Churned (120 days ago)
echo "Partner 5: Churned"
post_msg "pzl_demo_005" "Shop Epsilon" "Shop Epsilon" "customer" "Cảm ơn shop. Hẹn dịp sau." "$(date -u -v-120d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '-120 days' '+%Y-%m-%dT%H:%M:%SZ')" "demo_epsilon_001"

echo ""
echo "✓ Seeded 5 partners (Active / Sleeping / At-Risk / Dormant / Churned)"
echo "  Open http://localhost:8080 → Settings → connect Supabase → Dashboard"
