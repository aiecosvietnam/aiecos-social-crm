# Setup Guide — AIECOS Social CRM

From zero to running in **~15 minutes**. Three paths:

| Path | Best for | Time |
|---|---|---|
| 🐳 **Docker** (recommended) | Try locally, learn the stack | 5 min |
| ☁ **Hosted Supabase** | Production, no infra burden | 10 min |
| 🏠 **Self-host full stack** | Air-gapped, full control | 30 min |

---

## Prerequisites

- **Node.js 22+** (`node -v`) — for MCP server + dev
- **Docker** (any recent version) — for sync receiver + dev DB
- **Chrome** browser — for the extension
- **Pancake account** with at least 1 connected page → [pancake.vn](https://pancake.vn)
- **Optional**: a Supabase project (cloud or self-host)

---

## Path 1 — Docker Quick Start (5 min)

The fastest way. Boots Postgres + PostgREST + sync receiver + admin UI in one command.

```bash
git clone https://github.com/aiecosvietnam/aiecos-social-crm.git
cd aiecos-social-crm
cp .env.example .env       # default values work for dev
docker compose up -d
```

**That's it.** Now:

| Service | URL |
|---|---|
| Admin UI | http://localhost:8080 |
| Sync receiver | http://localhost:3500 |
| PostgREST | http://localhost:3000 |
| Postgres | `localhost:5432` (user/pass: `postgres/postgres`) |

### Seed demo data
```bash
bash examples/seed-demo-data.sh
```
→ Creates 5 partners (Active / Sleeping / At-Risk / Dormant / Churned) with synthetic conversation history. Admin UI populates immediately.

### Verify
```bash
curl http://localhost:3500/api/status
# {"status":"online","version":"1.6.0","db":"ok","db_latency_ms":12,...}
```

Then open http://localhost:8080 → Settings → enter `http://localhost:3000` as Supabase URL → Save → Dashboard lights up.

---

## Path 2 — Hosted Supabase (production-ready, 10 min)

### Step 1 — Database

1. Create a project at [supabase.com](https://supabase.com)
2. SQL Editor → paste contents of [`sync-receiver/schema.sql`](sync-receiver/schema.sql) → Run
3. Settings → API → **Exposed schemas** → add `aiecos_social` → Save
4. Copy from Settings → API:
   - **URL**: `https://<project>.supabase.co`
   - **service_role key** (full access — sync receiver only, never expose to browser)
   - **anon key** (read-only — admin UI uses this)

### Step 2 — Sync Receiver

Run anywhere with internet access (your VPS / Cloud Run / Fly.io / Render):

```bash
docker run -d --name aiecos-sync \
  -p 3500:3500 \
  -e API_TOKEN="$(openssl rand -hex 32)" \
  -e SUPABASE_URL="https://<project>.supabase.co" \
  -e SUPABASE_SERVICE_KEY="eyJhbGc...service-role-key" \
  -e SUPABASE_SCHEMA="aiecos_social" \
  -e CORS_ORIGIN="https://your-admin-ui-domain.com" \
  ghcr.io/aiecosvietnam/aiecos-sync-receiver:latest
```

**Save the generated `API_TOKEN`** — extension needs it.

### Step 3 — Expose receiver publicly

The Chrome extension needs to reach the receiver. Pick one:

| Option | Cost | Setup |
|---|---|---|
| **Cloudflare Tunnel** | Free | `cloudflared tunnel create + DNS route` |
| **nginx + Let's Encrypt** | $5/mo VPS | classic reverse proxy |
| **Caddy** | Free | `caddy reverse-proxy --to :3500` auto-HTTPS |

→ End result: `https://sync.yourdomain.com → :3500` with HTTPS.

### Step 4 — Admin UI

Deploy `admin-ui/` (3 static files) to anywhere:

| Platform | How |
|---|---|
| **GitHub Pages** | Settings → Pages → Source = `docs/` folder |
| **Cloudflare Pages** | Connect repo, no build needed |
| **Vercel/Netlify** | Output dir = `admin-ui` |
| **Self-host nginx** | `location / { root /opt/aiecos/admin-ui; }` |

Open the deployed UI → Settings → paste Supabase URL + **anon key** (NOT service key) → Save.

### Step 5 — Chrome Extension

```
chrome://extensions/ → Developer mode ON → Load unpacked → chrome-extension/
```

Click extension icon → enter:
- **Server URL**: `https://sync.yourdomain.com`
- **API Token**: the one from Step 2

Open `app.pancake.vn` → extension auto-syncs every minute. Click **SYNC ALL** to backfill history.

---

## Path 3 — Self-host full stack

For airgapped or full-control deployments. Self-host Supabase using their official [docker stack](https://supabase.com/docs/guides/self-hosting/docker), then run sync receiver in the same Docker network so it can hit `http://supabase-kong:8000` internally.

See [docs/DEPLOY.md](docs/DEPLOY.md) for full guide.

---

## MCP Server (optional but recommended)

Lets Claude / Cursor / any MCP client query your CRM in natural language.

### Install
```bash
cd mcp-server && npm install
```

### Register with Claude Code
Edit `~/.claude.json` → add to `mcpServers`:
```json
{
  "mcpServers": {
    "aiecos-social-crm": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/aiecos-social-crm/mcp-server/index.js"],
      "env": {
        "AIECOS_SUPABASE_URL": "https://<project>.supabase.co",
        "AIECOS_SUPABASE_KEY": "eyJhbGc...service-role-key",
        "AIECOS_SCHEMA": "aiecos_social"
      }
    }
  }
}
```

Restart Claude Code → 8 tools available with `mcp__aiecos-social-crm__*` prefix.

**Try**: *"Use MCP aiecos-social-crm: show me summary + top 5 partners this week"*

Full guide: [docs/MCP_USAGE.md](docs/MCP_USAGE.md)

---

## Verify end-to-end

1. Send a test message in Pancake (any conversation)
2. Wait ~30 seconds
3. Sync receiver logs:
   ```bash
   docker logs aiecos-sync --tail 5
   # [SYNC] BATCH <page>: total=1 inserted=1 deduped=0 failed=0
   ```
4. Admin UI → Dashboard → **Recent activity** section shows the message
5. MCP test: ask Claude *"recent_activity limit 5"* → returns live data

✅ All working? You're production.

---

## Production checklist (before going live)

### Security
- [ ] `API_TOKEN` generated with `openssl rand -hex 32` (32+ chars)
- [ ] Sync receiver behind HTTPS (Cloudflare/Caddy/nginx)
- [ ] `CORS_ORIGIN` set to your admin UI domain (not `*`)
- [ ] Admin UI uses **anon key** (read-only), not service key
- [ ] Supabase RLS policies enabled on all 4 tables (anon = SELECT only)
- [ ] `service_role key` never exposed to browser/git
- [ ] Rate limits validated (`RATE_MAX=300` default — tighten for prod)

### Observability
- [ ] Health check monitor pings `/api/status` every minute
- [ ] Logs shipped to your aggregator (Datadog/Loki/CloudWatch)
- [ ] `/metrics` scraped by Prometheus (or similar)
- [ ] Alert on `db: "error"` in /api/status response

### Backup
- [ ] Postgres daily backup automated (Supabase cloud handles this)
- [ ] Backup tested with restore drill once

### Operational
- [ ] Set `working_hours_start/end` if you want time-of-day filtering
- [ ] Pancake token rotation plan (Pancake tokens expire)
- [ ] Extension auto-update plan (Chrome extensions need re-install on update)

---

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Extension popup "Unauthorized" | `API_TOKEN` mismatch | Copy exact token from server `.env` |
| Admin UI: "Could not find table" | PostgREST schema not exposed | Add `aiecos_social` to `DB_SCHEMAS` env, restart Kong |
| Sync receiver crashes on boot | `SUPABASE_SERVICE_KEY` missing | Check `.env` exists + has the key |
| MCP tool not appearing in Claude | Config not picked up | Restart Claude Code, check `~/.claude.json` path is absolute |
| Charts not rendering | Chart.js CDN blocked | Check browser console; if CDN blocked, bundle locally |
| Messages appearing duplicate | Extension v4.5 or earlier | Update to v4.6+ (pancake_msg_id dedup) |

---

## Next steps

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — internals + design decisions
- [docs/DEPLOY.md](docs/DEPLOY.md) — production deployment patterns
- [docs/MCP_USAGE.md](docs/MCP_USAGE.md) — MCP tool reference + prompts
- [examples/](examples/) — curl scripts + demo data seeder

Questions? [Open an issue](https://github.com/aiecosvietnam/aiecos-social-crm/issues).
