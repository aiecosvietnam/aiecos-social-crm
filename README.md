# AIECOS Social CRM

Open-source template to sync Pancake (Zalo OA / Facebook Messenger / Instagram) data into your own Supabase, with a built-in admin UI, MCP server for AI agents, and B2B partner classification.

**What it does:**
- 📥 Chrome extension reads Pancake DOM → POST to your sync receiver
- 💾 Sync receiver writes to Supabase schema (`pages`, `customers`, `conversations`, `messages`)
- 🖥 Standalone admin UI (single HTML file) reads from Supabase REST API
- 🤖 MCP server lets Claude / any MCP client query data directly via natural language
- 📊 5-stage partner classification: Active / Sleeping / At-Risk / Dormant / Churned

**Stack:** Node.js + Express, Supabase (Postgres + PostgREST), Chrome Manifest V3, MCP SDK.

---

## Architecture

```
┌─────────────────┐   POST       ┌──────────────────┐   upsert    ┌──────────────┐
│ Pancake DOM     │  ─────────▶  │ Sync Receiver    │  ────────▶  │ Supabase     │
│ (Chrome ext)    │              │ (Node + Express) │             │ aiecos_social│
└─────────────────┘              └──────────────────┘             └──────┬───────┘
                                                                         │ PostgREST
                                          ┌──────────────────────────────┘
                                          ▼
                                   ┌──────────────┐         ┌──────────────┐
                                   │ Admin UI     │         │ MCP Server   │
                                   │ (HTML/JS)    │         │ (for Claude) │
                                   └──────────────┘         └──────────────┘
```

---

## Folder structure

```
aiecos-social-crm/
├── README.md
├── SETUP.md                  ← Start here
├── LICENSE                   ← MIT
├── docker-compose.yml        ← One-command dev stack
├── .env.example              ← Root env (for docker compose)
├── chrome-extension/         ← AIECOS Pancake Connector (Manifest V3)
├── sync-receiver/            ← Express server + Dockerfile + schema.sql
├── mcp-server/               ← MCP server for Claude
├── admin-ui/                 ← Single-file HTML dashboard
├── examples/                 ← Curl scripts, seed data, MCP prompts
├── docs/
│   ├── DEPLOY.md             ← Production deployment guide
│   ├── MCP_USAGE.md          ← MCP tool reference
│   └── ARCHITECTURE.md       ← Internals
└── .github/workflows/
    └── ci.yml                ← Syntax + secret scan + docker build
```

---

## Quick start (1 minute — Docker)

```bash
# Boot the entire stack: Postgres + PostgREST + sync receiver + admin UI
cp .env.example .env
docker compose up -d

# Inject demo data (5 partners across all stages)
bash examples/seed-demo-data.sh

# Open admin UI
open http://localhost:8080
# → Settings → Supabase URL: http://localhost:3000 → Schema: aiecos_social → Save
```

Done. You can now see Active / Sleeping / At-Risk / Dormant / Churned partners in the kanban.

## Quick start (manual, step-by-step)

```bash
# 1. Set up Supabase (cloud or self-host) + run schema.sql
psql -f sync-receiver/schema.sql

# 2. Start sync receiver
cd sync-receiver
cp .env.example .env  # edit with your Supabase credentials
npm install
npm start

# 3. Open admin UI in browser
open admin-ui/index.html
# → Click Settings → paste your Supabase URL + anon key

# 4. Install Chrome extension
# chrome://extensions/ → Load unpacked → select chrome-extension/

# 5. (Optional) Wire MCP server to Claude
cd mcp-server && npm install
# Add to ~/.claude.json mcpServers, then restart Claude Code
```

Full step-by-step instructions: **[SETUP.md](SETUP.md)**

---

## Why this template?

Most CRMs lock you into their data silo. This template gives you:

| Feature | Benefit |
|---|---|
| Own your data | Self-host Supabase, full Postgres access |
| AI-ready | MCP server exposes data to Claude / any LLM |
| Multi-channel | Facebook + Zalo OA + Instagram via single Pancake account |
| Zero vendor lock | All code MIT, no proprietary deps |
| B2B-aware | Partner classification (Active → Churned) out of the box |
| Audit trail | Every message logged with timestamp + sender_type |

---

## Use cases

- **B2B distributors**: Track shop partners, alert when they go silent
- **D2C brands**: Multi-channel inbox aggregation
- **Agencies**: White-label social CRM for clients
- **AI assistants**: Feed conversation history to your AI agents

---

## Roadmap

- [ ] Add HubSpot / Salesforce sync
- [ ] Webhook out (Slack/Telegram alerts)
- [ ] Tag/segment management UI
- [ ] LLM-powered reply suggestions

---

## Credits

Built by **[AIECOS](https://aiecos.ai)** — open-source AI infrastructure for Vietnamese businesses.
Released under MIT. PRs welcome.
