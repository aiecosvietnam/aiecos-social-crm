# Architecture

Internal design of AIECOS Social CRM.

## Components

```
┌────────────────────┐
│ Pancake (web app)  │  ← user logged in their Pancake account
└──────────┬─────────┘
           │ DOM scanning (MutationObserver + periodic scan)
           ▼
┌────────────────────┐
│ Chrome Extension   │  Manifest V3, content script + background SW
│  - content.js      │  Pancake-specific selectors:
│  - background.js   │    [id^="message_pzl_m_"], .media-current-customer
│  - popup.js        │    .system-msg-sticky (date headers)
└──────────┬─────────┘
           │ POST /api/sync (batched, every 5s or 50 msgs)
           │ Header: X-AIECOS-Token
           ▼
┌────────────────────┐
│ Sync Receiver      │  Node.js + Express + supabase-js
│ (Node + Docker)    │  - Dedup by pancake_msg_id (stable)
│  port 3500         │  - Upsert: pages → customers → conversations → messages
└──────────┬─────────┘
           │ supabase-js (service role)
           ▼
┌────────────────────┐
│ Supabase (Postgres)│  schema: aiecos_social
│  - PostgREST       │  4 tables + indexes
│  - Kong gateway    │  PostgREST exposes via /rest/v1/
└──────────┬─────────┘
           │ REST queries (anon key, read-only)
           ▼
    ┌──────┴──────┐
    │             │
┌─────────┐  ┌──────────┐
│ Admin UI│  │ MCP Srv  │  Both consume same REST API
│ (HTML)  │  │ (Node)   │  Stage classification logic shared
└─────────┘  └──────────┘
                  │
                  ▼
            ┌───────────┐
            │ Claude    │  Conversational queries via 8 tools
            └───────────┘
```

## Data flow

### Inbound (Pancake → DB)

1. User opens Pancake in Chrome (extension installed)
2. Content script auto-scans every conversation:
   - On page load
   - MutationObserver detects new msg
   - Periodic 10s rescan as fallback
3. For each msg, extension extracts:
   - `pancake_msg_id` (from `<div id="message_pzl_m_*">`)
   - `sender_type` (from class: `media-current-customer` = customer, else agent)
   - `timestamp` (from `system-msg-sticky` date headers, with DOM-index ordering within day)
   - `content` (text/sticker/attachment)
4. Batched into groups of ≤50 or flushed every 5s
5. POST to sync-receiver `/api/sync` with `X-AIECOS-Token` header
6. Server dedups by `pancake_msg_id` (priority) or sha1(conv|sender|content|ts|name)
7. Upsert: pages first, then customers, then conversations, then messages
8. Periodic 60s task refreshes `pages.total_conversations` + `pages.total_messages`

### Outbound (DB → UI / MCP)

- Admin UI queries Supabase REST directly using anon key
- MCP server uses service_role key for full schema access
- Both compute stage classification client-side from `customers.last_seen_at`:
  ```
  active   = ≤ 3 days since last_seen
  sleeping = 3-7 days
  at_risk  = 7-30 days
  dormant  = 30-90 days
  churned  = > 90 days
  ```

## Why these decisions

### Why Chrome extension instead of Pancake API?

Pancake API requires:
- Page-by-page access tokens (no org-wide token for groups)
- Tokens expire frequently
- Rate limits on `/conversations` endpoint
- No event webhooks for inbound

Extension scrapes DOM = always up-to-date, no token rot, real-time.

### Why pancake_msg_id dedup?

Each Pancake message has a unique DOM ID like `message_pzl_m_850957588213087660`. This is the Pancake/Zalo native message ID — stable across re-scans. Hashing prevents duplicate inserts.

Fallback: if extension is older (pre-v4.6), uses content+timestamp+sender hash.

### Why 5-stage classification?

B2B context — partners (shops) have different lifecycles than D2C customers:
- **Active** + **Sleeping**: healthy interaction
- **At-Risk**: outreach window (still recoverable)
- **Dormant**: needs revival campaign
- **Churned**: low ROI to re-engage

This classification drives Triage, Pipeline, Partner 360, and Performance modules — single source of truth.

### Why MCP server?

Modern AI agents (Claude, Cursor, etc.) speak Model Context Protocol. By exposing data via MCP, you get:
- Natural language queries: *"who hasn't replied in 2 weeks?"*
- Multi-step reasoning: *"find dormant partners + suggest re-engagement messages"*
- Composable with other MCP tools (Slack, email, etc.)

No need to build a custom chat UI — Claude is the UI.

## Trade-offs

| Decision | Pro | Con |
|---|---|---|
| Chrome extension scraping | No API limits, real-time | Requires Pancake tab open |
| Single-file admin UI | Zero build step | Limited if you need React state |
| Computed-not-stored stages | Always fresh | Slightly heavier on each load |
| Schema isolation (`aiecos_social`) | Multi-tenant ready | Requires PostgREST config |
| Pure REST + RLS | No backend lock | Auth = your responsibility |

## Extending

### Add a new channel (e.g., Instagram)
1. Update extension `content.js` with Instagram DOM selectors
2. `parseThreadType` in `server.js` already returns 'instagram' if URL matches
3. No schema changes needed

### Add lead scoring
1. Add column: `ALTER TABLE customers ADD COLUMN lead_score int;`
2. Background job: compute score from purchases / msg frequency / tags
3. Surface in admin UI Partner 360 table

### Add AI replies
1. New table: `suggested_replies (id, conv_id, text, confidence, created_at)`
2. Background worker: poll messages, call LLM, save to table
3. Admin UI inbox: show suggestions with "Send" button
