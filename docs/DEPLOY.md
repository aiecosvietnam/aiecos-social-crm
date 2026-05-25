# Deployment Guide

Production deployment patterns for AIECOS Social CRM.

## Architecture options

### Option 1 — All on one VPS (small team)

```
VPS (Docker Compose):
  ├── supabase stack (kong, postgres, postgrest, studio)
  ├── aiecos-sync-receiver (container, port 3500)
  └── nginx / Cloudflare Tunnel
```

### Option 2 — Hosted Supabase + own server (recommended)

```
Supabase Cloud  (managed Postgres + Auth + REST)
VPS              (sync receiver only, much smaller)
GitHub Pages     (admin UI — static)
```

### Option 3 — Serverless

```
Supabase Cloud
Cloudflare Worker / Vercel Edge  (port sync-receiver to serverless)
GitHub Pages                      (admin UI)
```

---

## Production sync-receiver

### Docker Compose example

```yaml
# docker-compose.yml
version: '3'
services:
  sync-receiver:
    image: ghcr.io/<your-org>/aiecos-sync-receiver:1.5.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:3500:3500"  # bind to localhost, expose via reverse proxy
    environment:
      PORT: 3500
      API_TOKEN: ${API_TOKEN}
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
      SUPABASE_SCHEMA: aiecos_social
```

### nginx reverse proxy

```nginx
server {
  listen 443 ssl http2;
  server_name sync.yourdomain.com;

  ssl_certificate     /etc/letsencrypt/live/sync.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sync.yourdomain.com/privkey.pem;

  client_max_body_size 20M;  # batch payload can be ~10MB

  location / {
    proxy_pass http://127.0.0.1:3500;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Cloudflare Tunnel (no public IP needed)

```bash
cloudflared tunnel create aiecos-sync
cloudflared tunnel route dns aiecos-sync sync.yourdomain.com
```

`~/.cloudflared/config.yml`:
```yaml
tunnel: aiecos-sync
ingress:
  - hostname: sync.yourdomain.com
    service: http://localhost:3500
  - service: http_status:404
```

Then: `cloudflared tunnel run aiecos-sync`

---

## Production admin UI

The UI is a single static HTML file — deploy anywhere.

### GitHub Pages
```bash
# In your fork
mkdir -p docs && cp admin-ui/index.html docs/
git add docs/ && git commit -m "deploy admin ui"
# Repo Settings → Pages → Source: docs/ folder → Save
```

### Cloudflare Pages / Vercel
- Connect GitHub repo
- Build command: *(none)*
- Output directory: `admin-ui`

### Self-hosted nginx
```nginx
location /admin/ {
  alias /opt/aiecos-social-crm/admin-ui/;
  index index.html;
}
```

---

## Supabase setup

### Self-host (Docker)

Follow [official guide](https://supabase.com/docs/guides/self-hosting/docker), then:

```bash
# After supabase is up
cd supabase/docker
# Edit .env: add to DB_SCHEMAS
sed -i 's/DB_SCHEMAS=public/DB_SCHEMAS=public,aiecos_social/' .env
docker compose restart kong postgrest

# Run schema
docker exec -i supabase-db psql -U postgres -d postgres < /path/to/aiecos-social-crm/sync-receiver/schema.sql
```

### Cloud

1. Create project at [supabase.com](https://supabase.com)
2. SQL Editor → paste `schema.sql` → Run
3. Settings → API → Exposed schemas → add `aiecos_social`
4. Copy URL + anon key + service_role key

---

## Update / rollback

### Update sync-receiver
```bash
docker pull ghcr.io/<your-org>/aiecos-sync-receiver:latest
docker compose up -d sync-receiver
```

### Rollback
```bash
docker compose up -d sync-receiver:1.4.0  # previous version
```

### DB migration
Add new SQL to `schema.sql` with `IF NOT EXISTS` clauses, re-run.

---

## Monitoring

### Health check
```bash
curl https://sync.yourdomain.com/api/status
# {"status":"online","version":"1.5.0",...}
```

### Logs
```bash
docker logs aiecos-sync-receiver --tail 50 -f
# Look for: [SYNC] BATCH ... inserted=N deduped=N
```

### Supabase usage
- Dashboard → Reports → Database → Disk + Row counts
- Watch for `messages` table growth → archive old data if needed

---

## Backup

### Daily Postgres dump
```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
docker exec supabase-db pg_dump -U postgres \
  --schema=aiecos_social postgres > backup-$DATE.sql
# Rotate: keep last 30 days
find . -name "backup-*.sql" -mtime +30 -delete
```

### Restore
```bash
docker exec -i supabase-db psql -U postgres -d postgres < backup-20260520.sql
```

---

## Security

See **[SETUP.md Security checklist](../SETUP.md#security-checklist-before-going-live)**.

Quick wins:
- HTTPS everywhere (use Cloudflare or Caddy for free certs)
- Rotate `API_TOKEN` quarterly
- Enable Supabase RLS on all 4 tables
- Restrict CORS in `server.js` (currently `*` for dev convenience)
- Use anon key in admin UI, not service key
