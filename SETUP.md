# Setup Guide — AIECOS Social CRM

Complete walkthrough from zero to running. **Total time: ~15 minutes** if you have Supabase + Node.js installed.

---

## Prerequisites

- **Node.js** 22+ (`node -v`)
- **Docker** (recommended for sync receiver) OR direct `npm start`
- **Supabase project**:
  - Cloud: [supabase.com](https://supabase.com) (free tier OK)
  - OR Self-host: [supabase/supabase docker](https://supabase.com/docs/guides/self-hosting/docker)
- **Chrome** for the extension
- **Pancake account** with at least 1 connected page ([pancake.vn](https://pancake.vn))

---

## Step 1 — Database

### 1.1 Create the schema

Run `sync-receiver/schema.sql` on your Supabase Postgres:

**Self-host:**
```bash
docker exec -i <postgres-container> psql -U postgres -d postgres < sync-receiver/schema.sql
```

**Cloud (Supabase SQL editor):**
- Open project → SQL Editor → paste contents of `schema.sql` → Run.

This creates schema `aiecos_social` with 4 tables: `pages`, `customers`, `conversations`, `messages`.

### 1.2 Expose schema via PostgREST

**Self-host:** Edit your Kong env in `docker-compose.yml` → `DB_SCHEMAS` to include `aiecos_social`:

```yaml
environment:
  DB_SCHEMAS: public,storage,graphql_public,aiecos_social
```

Then `docker compose up -d kong postgrest`.

**Cloud:** Settings → API → "Exposed schemas" → add `aiecos_social` → Save.

### 1.3 Get your credentials

You'll need:
- **`SUPABASE_URL`**: `https://<project>.supabase.co` (cloud) or `http://localhost:8000` (self-host)
- **`SUPABASE_SERVICE_KEY`**: service_role JWT (from project Settings → API)
- **`SUPABASE_ANON_KEY`**: public anon JWT (admin UI uses this — read-only)

---

## Step 2 — Sync Receiver

The Express server that accepts messages from the Chrome extension and writes to Supabase.

### Option A — Docker (recommended)

```bash
cd sync-receiver
cp .env.example .env
# Edit .env with your credentials

docker build -t aiecos-sync-receiver .
docker run -d --name aiecos-sync-receiver \
  --env-file .env \
  -p 3500:3500 \
  aiecos-sync-receiver

# Verify
curl http://localhost:3500/api/status
# {"status":"online","version":"1.5.0","schema":"aiecos_social",...}
```

### Option B — Direct Node

```bash
cd sync-receiver
cp .env.example .env  # edit credentials
npm install
npm start
```

### Set a strong API token

Generate a token:
```bash
openssl rand -hex 32
```

Put in `.env`:
```
API_TOKEN=<your-generated-token>
```

The Chrome extension will need this token to authenticate.

### Expose publicly (production)

If your Chrome runs on a different machine than the server, expose via:
- **Cloudflare Tunnel** (free, easy): `cloudflared tunnel --url http://localhost:3500`
- **nginx reverse proxy** (HTTPS preferred)
- **Caddy** (auto-HTTPS)

For local dev on same machine: extension can hit `http://localhost:3500` directly.

---

## Step 3 — Chrome Extension

```
1. Open chrome://extensions/
2. Toggle "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the chrome-extension/ folder
5. Pin the extension to toolbar
```

**Configure:**
- Click the extension icon
- Enter **Server URL**: `http://localhost:3500` (or your tunnel URL)
- Enter **API Token**: the one from `.env`
- Click **Save**

**Use:**
- Open `app.pancake.vn` and log in
- The extension auto-syncs new messages every minute
- Click **SYNC ALL** to walk through all conversations and backfill history

---

## Step 4 — Admin UI

The single-file HTML dashboard reads from Supabase REST directly.

```
open admin-ui/index.html
```

**On first load:**
1. Click **Settings** in sidebar
2. Paste:
   - **Supabase URL**: your project URL
   - **Anon / Service key**: anon key recommended (read-only)
   - **Schema**: `aiecos_social`
3. Click **Save + reload**

**Modules:**
- **Dashboard** — Total partners + activity trend + recent messages
- **Cần chăm sóc** (Triage) — Auto-alerts for At-Risk / Dormant partners
- **Pipeline** — Kanban view of 5 stages
- **Partner 360** — Full partner table with stages
- **Performance** — Customer vs Agent ratio + top partners
- **Settings** — Config

### Deploy admin UI

Since it's pure static HTML, deploy anywhere:
- **GitHub Pages** / **Cloudflare Pages** / **Vercel**: drag `admin-ui/` folder
- **Nginx**: serve as static file

---

## Step 5 — MCP Server (optional)

Lets Claude (or any MCP client) query your data conversationally.

```bash
cd mcp-server
npm install
```

### Register with Claude Code

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "aiecos-social-crm": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/aiecos-social-crm/mcp-server/index.js"],
      "env": {
        "AIECOS_SUPABASE_URL": "https://<your-project>.supabase.co",
        "AIECOS_SUPABASE_KEY": "eyJhbGc...your-service-key",
        "AIECOS_SCHEMA": "aiecos_social"
      }
    }
  }
}
```

Restart Claude Code. Now you can prompt:

> *"Use MCP aiecos-social-crm to show me top 5 most active partners this week"*
> *"List dormant partners and last contact dates"*
> *"Search messages containing 'pricing'"*

See [docs/MCP_USAGE.md](docs/MCP_USAGE.md) for all 8 tools.

---

## Step 6 — Verify end-to-end

1. Open Pancake in Chrome
2. Send a test message in a conversation
3. Wait ~30 seconds
4. Check sync receiver logs: `docker logs aiecos-sync-receiver --tail 10` → should see `[SYNC] BATCH ... inserted=1`
5. Refresh Admin UI → message should appear in Dashboard → Recent
6. Try MCP: ask Claude *"show summary of AIECOS social CRM"* → should return live counts

✅ All working? You're done.

---

## Troubleshooting

### Extension shows "Unauthorized"
- API_TOKEN in extension popup doesn't match server `.env`. Re-enter.

### "Could not find table 'customers' in schema cache"
- PostgREST hasn't loaded the schema. Restart PostgREST container. Verify `DB_SCHEMAS` includes `aiecos_social`.

### Sync receiver crashes on startup
- `SUPABASE_SERVICE_KEY` missing or invalid. Check `.env`.

### Admin UI shows "Not configured"
- Click Settings, enter credentials, save.

### MCP tool not appearing in Claude
- Restart Claude Code after editing `~/.claude.json`.
- Check path in config is absolute, not `~/`.

---

## Security checklist before going live

- [ ] Strong random `API_TOKEN` (32+ chars)
- [ ] Sync receiver behind HTTPS (Cloudflare Tunnel or reverse proxy)
- [ ] Admin UI uses **anon key**, not service key
- [ ] Supabase RLS policies enabled (anon = read-only)
- [ ] Service key never exposed to browser
- [ ] CORS restricted to your admin UI domain (currently `*` — tighten in `server.js`)

---

## Next steps

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand internals
- Read [docs/DEPLOY.md](docs/DEPLOY.md) for production deployment
- Extend with your own AI agent (suggested replies, lead scoring, etc.)

Questions? Open an issue on GitHub.
