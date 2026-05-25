# Changelog

All notable changes to AIECOS Social CRM.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org).

## [Unreleased]

### Added
- Dashboard: 6 new widgets (Inbox health, Response time p50/p95, New partners trend, Top hours, Reply rate per channel, Sentiment signals)
- Pipeline: channel filter chips + search box
- Partner 360: segment filter chips (All/Active/Sleeping/At-Risk/Dormant/Churned) + search + avatar circles + chevron action hint
- Mobile responsive sidebar with hamburger toggle + overlay
- Inline SVG favicon (gradient star)
- Open Graph meta tags
- Accessibility: `aria-label` on icon buttons, `:focus-visible` outlines

### Fixed
- Sparkline canvas inflating to viewport height — wrapped in `.spark-wrap` with bounded parent

## [1.6.0] — sync-receiver — 2026-05-25

### Added
- `helmet` security middleware
- `express-rate-limit` — 300 req/min per IP+token (configurable via `RATE_MAX`, `RATE_WINDOW_MS`)
- `morgan` request logging
- `/metrics` endpoint (Prometheus-compatible, 30s cache)
- Enhanced `/api/status` with DB ping latency + memory + node version
- Input validation: content max 5000 chars, sender_type whitelist, batch max 200 msgs
- Graceful shutdown on SIGTERM/SIGINT with 10s force-exit timeout
- `trust proxy 1` for Cloudflare/nginx
- JSON error responses with `request_id`
- Catch `unhandledRejection` + `uncaughtException`
- New env vars: `CORS_ORIGIN`, `RATE_WINDOW_MS`, `RATE_MAX`

## [1.0.0] — Initial public release — 2026-05-25

### Added
- **chrome-extension/** v4.6.0 — AIECOS Pancake Connector (Manifest V3)
  - DOM scanning via MutationObserver
  - `pancake_msg_id` dedup
  - Sticky-date timestamp parsing
  - Batch sync with hard deadline + size limit
  - Auto-walk all conversations
- **sync-receiver/** v1.5.0 — Express server
  - POST /api/sync (batch + single formats)
  - POST /api/channel/register
  - POST /api/admin/refresh-aggregates
  - Periodic 60s aggregate refresh
  - Dockerfile + schema.sql
- **mcp-server/** v1.0.0 — 8 tools for Claude
  - summary, list_partners, get_partner_messages
  - search_messages, get_at_risk_partners
  - pipeline_stats, top_partners_by_volume, recent_activity
- **admin-ui/** v1.0.0 — Single-file HTML dashboard
  - 6 modules: Dashboard, Triage, Inbox, Pipeline, Partner 360, Performance, Reports, Help, Settings
  - Demo mode (sample data when no Supabase config)
  - Dark mode toggle
  - Cmd+K global search
  - Partner detail drawer
  - Toast notifications
  - CSV/JSON/HTML report export
  - Lucide flat icons (24 unique)
  - 5 KPI sparklines
  - Inbox 3-pane (Pages / Conversations / Messages+CustomerInfo)
- **docker-compose.yml** — one-command dev stack
- **examples/** — curl scripts, demo seeder, MCP prompts
- **docs/** — ARCHITECTURE, DEPLOY, MCP_USAGE, SETUP
- **.github/workflows/** — CI (syntax / install / docker / secrets) + Pages deploy
- **README** with demo video (release asset) + donate section (MoMo QR)
- MIT licensed
