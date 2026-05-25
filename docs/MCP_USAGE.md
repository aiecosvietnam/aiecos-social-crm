# MCP Server — Usage Guide

The MCP server exposes 8 tools to query your AIECOS Social CRM data conversationally.

## Setup

See [SETUP.md](../SETUP.md#step-5--mcp-server-optional).

After registering in `~/.claude.json` and restarting Claude Code, tools appear with prefix `mcp__aiecos-social-crm__`.

## Tools

### `summary`
Overall stats: pages, customers, messages, partner stage distribution, sender ratio, latest activity.

**Example:** *"Show me the AIECOS social CRM summary"*

---

### `list_partners(stage?, limit?)`
List partners with optional stage filter.

| Arg | Type | Default | Description |
|---|---|---|---|
| `stage` | string | — | `active` / `sleeping` / `at_risk` / `dormant` / `churned` |
| `limit` | number | 50 | Max results |

**Example:** *"List at-risk partners"*

---

### `get_partner_messages(conversation_id, limit?)`
Conversation history for one partner.

**Example:** *"Show last 50 messages from conversation `<page_id>__<customer_slug>`"*

---

### `search_messages(query, limit?)`
Case-insensitive substring search across message content.

**Example:** *"Find messages containing 'invoice'"*

---

### `get_at_risk_partners(min_days?, max_days?, limit?)`
Partners with `last_seen` between min and max days. Default 7-30d (At-Risk).

**Example:** *"Partners silent 14 to 21 days"*

---

### `pipeline_stats`
Distribution of partners across 5 stages with counts + percentages.

**Example:** *"What does the B2B pipeline look like right now?"*

---

### `top_partners_by_volume(limit?, days?)`
Top partners ranked by message volume in last N days.

**Example:** *"Top 5 partners by messages this week"* → `limit=5, days=7`

---

### `recent_activity(limit?)`
Most recent messages across all conversations.

**Example:** *"Show last 30 messages to verify sync is working"*

---

## Stage criteria

```
active   = last_seen ≤ 3 days
sleeping = 3-7 days
at_risk  = 7-30 days
dormant  = 30-90 days
churned  = > 90 days
```

These match the admin UI logic — single source of truth.

## Environment variables

| Var | Default | Description |
|---|---|---|
| `AIECOS_SUPABASE_URL` | `http://localhost:8000` | Supabase REST endpoint |
| `AIECOS_SUPABASE_KEY` | *(required)* | service_role JWT |
| `AIECOS_SCHEMA` | `aiecos_social` | Schema name |

## Example multi-tool prompts

> *"Use MCP aiecos-social-crm: give me summary + top 3 partners by volume this week"*

> *"Find all dormant partners + show their last 5 messages"*

> *"Compare At-Risk (7-30d) vs Dormant (30-90d) — counts + percentages"*

> *"Search messages with 'order delay' from last 7 days"*
